import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useAccount,
  useChainId,
  useSignTypedData,
  useSwitchChain,
  useWriteContract,
  useSendTransaction,
} from 'wagmi';
import { createPublicClient, formatUnits, http } from 'viem';
import type { PublicClient } from 'viem';

import {
  buildSupportedSet,
  findAsset,
  normalizeToken,
  parseIntent,
  resolveIntent,
  validateIntent,
} from '../intent';
import type {
  RawIntent,
  ResolvedIntent,
  ValidationIssue,
} from '../intent/types';
import {
  buildOrderRequest,
  buildQuoteRequest,
} from '../oif/buildQuoteRequest';
import { getOrder, getQuote, getSupportedAssets, submitOrder } from '../oif/client';
import {
  buildPermit2ApproveRequest,
  hasPermit2Allowance,
} from '../oif/permit2';
import { signQuote } from '../oif/sign';
import type { TypedDataSigner } from '../oif/sign';
import type { OrderResponse, OrderStatus, Quote } from '../oif/types';
import { CHAINS } from '../wallet/chains';

/**
 * State-machine phases for the intent flow.
 *
 *   idle         — nothing submitted yet
 *   offTemplate  — parse failed; show the template hint
 *   invalid      — parsed but validation found issues
 *   needsWallet  — valid, but no wallet connected (gate on connect)
 *   quoting      — resolving + fetching quotes
 *   quoted       — a quote is ready to confirm
 *   switchingChain / approving / signing / submitting — confirm() progress
 *   tracking     — order submitted, polling its status
 *   done         — order reached a terminal status
 *   error        — anything threw
 */
export type IntentPhase =
  | 'idle'
  | 'parsing'
  | 'offTemplate'
  | 'invalid'
  | 'needsWallet'
  | 'quoting'
  | 'quoted'
  | 'switchingChain'
  | 'approving'
  | 'signing'
  | 'submitting'
  | 'tracking'
  | 'done'
  | 'error';

/** Human-readable summary the confirm card renders (no addresses / base units). */
export interface IntentPreview {
  action: 'swap' | 'send';
  payAmount: string;
  paySymbol: string;
  srcChainName: string;
  receiveAmount: string;
  receiveSymbol: string;
  dstChainName: string;
  recipient?: string;
  etaSeconds?: number;
  solverCount: number;
}

export interface UseIntentState {
  phase: IntentPhase;
  /** Supported-asset set still loading from the aggregator. */
  assetsLoading: boolean;
  /** Supported assets failed to load (offline / aggregator down). */
  assetsError: boolean;
  /** True once the support set is available and the bar can accept input. */
  ready: boolean;
  /** Off-template hint (phase === 'offTemplate'). */
  hint: string | null;
  /** Validation issues (phase === 'invalid'). */
  issues: ValidationIssue[];
  resolved: ResolvedIntent | null;
  quote: Quote | null;
  preview: IntentPreview | null;
  /** Escrow route only: an ERC-20 → Permit2 approval is required first. */
  needsApproval: boolean;
  orderId: string | null;
  status: OrderStatus | null;
  /** Destination-chain explorer link (fill tx if known, else recipient address). */
  explorerUrl: string | null;
  error: string | null;
  /** Whether a wallet is connected (drives the confirm button label). */
  isConnected: boolean;
  queueIndex: number;
  queueTotal: number;
  run: (sentence: string) => void;
  confirm: () => void;
  reset: () => void;
}

const errMessage = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : 'Something went wrong.';

const chainName = (id: number): string =>
  CHAINS.find((c) => c.id === id)?.name ?? `Chain ${id}`;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/** Format a base-unit string/bigint into a tidy decimal. */
function fmtUnits(amount: bigint | string | undefined, decimals: number): string {
  if (amount === undefined) return '';
  const human = formatUnits(typeof amount === 'bigint' ? amount : BigInt(amount), decimals);
  const n = Number(human);
  if (!Number.isFinite(n)) return human;
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

/** A viem public client bound to a specific chain, for read-only allowance checks. */
function publicClientFor(chainId: number): PublicClient | null {
  const chain = CHAINS.find((c) => c.id === chainId);
  if (!chain) return null;
  return createPublicClient({ chain, transport: http() }) as PublicClient;
}

function directTransferQuote(): Quote {
  return {
    quoteId: 'direct-transfer',
    solverId: 'wallet',
    order: {
      type: 'direct-transfer',
      payload: {
        signatureType: 'eip712',
        domain: {
          name: 'Direct Transfer',
          chainId: 0,
          verifyingContract: ZERO_ADDRESS,
        },
        primaryType: 'DirectTransfer',
        message: {},
        types: {
          DirectTransfer: [],
        },
      },
    },
    partialFill: false,
    preview: {
      inputs: [],
      outputs: [],
    },
    integrityChecksum: 'direct-transfer',
  };
}

function directTransferOrder(hash: `0x${string}`): OrderResponse {
  const now = new Date().toISOString();

  return {
    orderId: hash,
    status: 'finalized',
    createdAt: now,
    updatedAt: now,
    inputAmounts: [],
    outputAmounts: [],
    orderType: 'direct-transfer',
    settlement: {
      type: 'resourceLock',
      data: { kind: 'direct-transfer' },
    },
    fillTransaction: { hash },
  };
}

function isTerminal(status: OrderStatus): boolean {
  if (typeof status === 'object') return 'failed' in status;
  return status === 'finalized' || status === 'refunded';
}

/**
 * Fetch the freshest quote for a resolved intent. Quotes are short-lived
 * (validUntil ~60s) and the signed-authorization deadline starts ticking at
 * quote time, so confirm() re-quotes immediately before signing rather than
 * reusing the quote shown on the card.
 */
async function fetchBestQuote(resolvedIntent: ResolvedIntent): Promise<Quote> {
  const res = await getQuote(buildQuoteRequest(resolvedIntent));
  const best = res.quotes?.[0];
  if (!best) throw new Error('The quote expired and no fresh quote is available — try again.');
  return best;
}

/** Best-effort tx hash from the order's (untyped) fillTransaction field. */
function extractFillTxHash(order: OrderResponse | null): string | null {
  const f = (order as { fillTransaction?: unknown } | null)?.fillTransaction;
  if (!f || typeof f !== 'object') return null;
  const rec = f as Record<string, unknown>;
  const h = rec.hash ?? rec.transactionHash ?? rec.txHash;
  return typeof h === 'string' && /^0x[0-9a-fA-F]+$/.test(h) ? h : null;
}

/** Destination-chain block-explorer URL: the fill tx if known, else the recipient address. */
function buildExplorerUrl(resolved: ResolvedIntent | null, order: OrderResponse | null): string | null {
  if (!resolved) return null;
  const base = CHAINS.find((c) => c.id === resolved.dstChainId)?.blockExplorers?.default?.url;
  if (!base) return null;
  const hash = extractFillTxHash(order);
  return hash ? `${base}/tx/${hash}` : `${base}/address/${resolved.recipient}`;
}

const TERMINAL_POLL_MS = 2500;



export function useIntent(): UseIntentState {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();

  // ── Live support set ──────────────────────────────────────────────────────
  const {
    data: assets,
    isLoading: assetsLoading,
    isError: assetsError,
  } = useQuery({
    queryKey: ['oif-supported-assets'],
    queryFn: getSupportedAssets,
    staleTime: 60_000,
  });
  const supported = useMemo(() => buildSupportedSet(assets ?? []), [assets]);
  const ready = !assetsLoading && assets !== undefined;

  // ── Flow state ────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<IntentPhase>('idle');
  const [hint, setHint] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [resolved, setResolved] = useState<ResolvedIntent | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [preview, setPreview] = useState<IntentPreview | null>(null);
  const [needsApproval, setNeedsApproval] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [intentQueue, setIntentQueue] = useState<RawIntent[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);

  // Latest pending raw intent, for auto-continuing after a connect.
  const pendingRawRef = useRef<RawIntent | null>(null);

  const reset = useCallback(() => {
    pendingRawRef.current = null;
    setIntentQueue([]);
    setQueueIndex(0);
    setPhase('idle');
    setHint(null);
    setIssues([]);
    setResolved(null);
    setQuote(null);
    setPreview(null);
    setNeedsApproval(false);
    setOrderId(null);
    setStatus(null);
    setOrder(null);
    setError(null);
  }, []);

  // Resolve → quote → (escrow) allowance check → quoted.
  const quoteFor = useCallback(
    async (raw: RawIntent, user: string, solUser?: string | null) => {
      try {
        setError(null);
        setPhase('quoting');
        const resolvedIntent = resolveIntent(raw, supported, user, solUser);
        
        const inAsset = findAsset(supported, resolvedIntent.srcChainId, normalizeToken(raw.tokenIn) ?? '');
        const outSymbol =
          raw.action === 'swap' ? normalizeToken(raw.tokenOut) ?? '' : (inAsset?.symbol ?? '');
        const outAsset = findAsset(supported, resolvedIntent.dstChainId, outSymbol);

        // If it's a same-chain send, OIF solvers won't quote it. Do a direct wallet transfer.
        if (resolvedIntent.action === 'send' && resolvedIntent.srcChainId === resolvedIntent.dstChainId) {
          const newPreview: IntentPreview = {
            action: raw.action,
            payAmount: fmtUnits(resolvedIntent.inputAmount, resolvedIntent.inputDecimals),
            paySymbol: inAsset?.symbol ?? (outSymbol || '?'),
            srcChainName: chainName(resolvedIntent.srcChainId),
            receiveAmount: fmtUnits(resolvedIntent.inputAmount, resolvedIntent.inputDecimals),
            receiveSymbol: inAsset?.symbol ?? (outSymbol || '?'),
            dstChainName: chainName(resolvedIntent.dstChainId),
            recipient: resolvedIntent.recipient,
            etaSeconds: 15,
            solverCount: 1, // meaning the user's own wallet
          };

          pendingRawRef.current = null;
          setResolved(resolvedIntent);
          setQuote(directTransferQuote());
          setPreview(newPreview);
          setNeedsApproval(false);
          setPhase('quoted');
          return;
        }

        const req = buildQuoteRequest(resolvedIntent);
        const res = await getQuote(req);
        const best = res.quotes?.[0];
        if (!best) throw new Error('No solver returned a quote for this route yet.');

        const outAmount = best.preview.outputs?.[0]?.amount;

        const newPreview: IntentPreview = {
          action: raw.action,
          payAmount: fmtUnits(resolvedIntent.inputAmount, resolvedIntent.inputDecimals),
          paySymbol: inAsset?.symbol ?? (outSymbol || '?'),
          srcChainName: chainName(resolvedIntent.srcChainId),
          receiveAmount: fmtUnits(outAmount, outAsset?.decimals ?? resolvedIntent.inputDecimals),
          receiveSymbol: outAsset?.symbol ?? (outSymbol || inAsset?.symbol || '?'),
          dstChainName: chainName(resolvedIntent.dstChainId),
          recipient: raw.action === 'send' ? resolvedIntent.recipient : undefined,
          etaSeconds: best.eta,
          solverCount: res.totalQuotes || res.quotes.length || 1,
        };

        // Escrow route needs a Permit2 approval; 3009 (the live route) does not.
        let approvalNeeded = false;
        if (best.order.type === 'oif-escrow-v0') {
          const pc = publicClientFor(resolvedIntent.srcChainId);
          if (pc) {
            try {
              approvalNeeded = !(await hasPermit2Allowance(
                pc,
                resolvedIntent.inputToken as `0x${string}`,
                resolvedIntent.user as `0x${string}`,
                resolvedIntent.inputAmount,
              ));
            } catch {
              approvalNeeded = true; // assume needed if the read fails
            }
          }
        }

        pendingRawRef.current = null;
        setResolved(resolvedIntent);
        setQuote(best);
        setPreview(newPreview);
        setNeedsApproval(approvalNeeded);
        setPhase('quoted');
      } catch (e) {
        setError(errMessage(e));
        setPhase('error');
      }
    },
    [supported],
  );

  const quoteForRef = useRef(quoteFor);
  quoteForRef.current = quoteFor;

  const advanceQueue = useCallback(() => {
    if (intentQueue && queueIndex < intentQueue.length - 1) {
      const nextIndex = queueIndex + 1;
      setQueueIndex(nextIndex);
      pendingRawRef.current = intentQueue[nextIndex];
      if (address) {
        void quoteFor(intentQueue[nextIndex], address);
      }
      return true;
    }
    return false;
  }, [intentQueue, queueIndex, address, quoteFor]);

  const advanceQueueRef = useRef(advanceQueue);
  advanceQueueRef.current = advanceQueue;

  const run = useCallback(
    async (sentence: string) => {
      setError(null);
      setPhase('parsing');
      const parsed = await parseIntent(sentence);
      if (!parsed.ok) {
        pendingRawRef.current = null;
        setIssues([]);
        setHint(parsed.message);
        setPhase('offTemplate');
        return;
      }
      
      // Validate all intents
      for (const intent of parsed.intents) {
        const found = validateIntent(intent, supported);
        if (found.length > 0) {
          pendingRawRef.current = null;
          setHint(null);
          setIssues(found);
          setPhase('invalid');
          return;
        }
      }

      setHint(null);
      setIssues([]);
      setIntentQueue(parsed.intents);
      setQueueIndex(0);
      pendingRawRef.current = parsed.intents[0];
      if (!isConnected || !address) {
        setPhase('needsWallet');
        return;
      }
      void quoteFor(parsed.intents[0], address);
    },
    [supported, isConnected, address, quoteFor],
  );

  // Once a wallet connects while we're gated, continue automatically.
  useEffect(() => {
    if (phase === 'needsWallet' && isConnected && address && pendingRawRef.current) {
      void quoteForRef.current(pendingRawRef.current, address);
    }
  }, [phase, isConnected, address]);

  // wagmi-backed typed-data signer adapter for signQuote. viem rejects an
  // `EIP712Domain` entry inside `types`, so strip it before signing.
  const signer: TypedDataSigner = useCallback(
    (args) => {
      const types: Record<string, ReadonlyArray<{ name: string; type: string }>> = {};
      for (const [name, fields] of Object.entries(args.types)) {
        if (name !== 'EIP712Domain') types[name] = fields;
      }
      return signTypedDataAsync({
        domain: args.domain,
        types,
        primaryType: args.primaryType,
        message: args.message,
      } as Parameters<typeof signTypedDataAsync>[0]);
    },
    [signTypedDataAsync],
  );

  const confirm = useCallback(async () => {
    if (!resolved || !quote) return;
    try {
      setError(null);

      // 1. Wallet must be on the source chain (if EVM)
      if (resolved.srcChainId !== 9000000001 && chainId !== resolved.srcChainId) {
        setPhase('switchingChain');
        await switchChainAsync({ chainId: resolved.srcChainId });
      }

      // If the source chain is Solana, we would build the InputSettler transaction here.
      if (resolved.srcChainId === 9000000001) {
         throw new Error("Solana Input Settler transaction building is not yet fully integrated in the UI. Waiting for Aggregator to return base64 tx.");
      }

      // 1b. Handle same-chain direct transfers
      if (quote.order.type === 'direct-transfer') {
        setPhase('signing');
        const isNative = !resolved.inputToken || /^0x0{40}$/i.test(resolved.inputToken) || /^0xe{40}$/i.test(resolved.inputToken);
        let hash: `0x${string}`;
        
        if (isNative) {
           hash = await sendTransactionAsync({
              to: resolved.recipient as `0x${string}`,
              value: BigInt(resolved.inputAmount),
           });
        } else {
           hash = await writeContractAsync({
              address: resolved.inputToken as `0x${string}`,
              abi: ERC20_TRANSFER_ABI,
              functionName: 'transfer',
              args: [resolved.recipient as `0x${string}`, BigInt(resolved.inputAmount)]
           });
        }
        
        setPhase('submitting');
        setOrderId(hash);
        setOrder(directTransferOrder(hash));
        setStatus('finalized');
        
        if (!advanceQueue()) {
          setPhase('done');
        }
        return;
      }

      // 2. Escrow route only: approve Permit2 to spend the input token.
      if (quote.order.type === 'oif-escrow-v0') {
        const pc = publicClientFor(resolved.srcChainId);
        const stillNeeds = pc
          ? !(await hasPermit2Allowance(
              pc,
              resolved.inputToken as `0x${string}`,
              resolved.user as `0x${string}`,
              resolved.inputAmount,
            ))
          : needsApproval;
        if (stillNeeds) {
          setPhase('approving');
          const approve = buildPermit2ApproveRequest(resolved.inputToken as `0x${string}`);
          const hash = await writeContractAsync({
            ...approve,
            chainId: resolved.srcChainId,
          } as Parameters<typeof writeContractAsync>[0]);
          if (pc) await pc.waitForTransactionReceipt({ hash });
          setNeedsApproval(false);
        }
      }

      // 3. Re-quote immediately before signing — the approval tx above can take
      //    tens of seconds, and quotes/authorizations are short-lived, so sign the
      //    freshest quote rather than the (possibly stale) one shown on the card.
      setPhase('signing');
      const freshQuote = await fetchBestQuote(resolved);
      const signature = await signQuote(freshQuote, signer);

      // 4. Submit the signed order.
      setPhase('submitting');
      const order = await submitOrder(buildOrderRequest(freshQuote, signature));
      setOrderId(order.orderId);
      setStatus(order.status);
      setPhase('tracking');
    } catch (e) {
      setError(errMessage(e));
      setPhase('error');
    }
  }, [resolved, quote, chainId, needsApproval, switchChainAsync, writeContractAsync, sendTransactionAsync, signer, advanceQueue]);

  // ── Poll order status until terminal ──────────────────────────────────────
  useEffect(() => {
    if (phase !== 'tracking' || !orderId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const o = await getOrder(orderId);
        if (!active) return;
        setStatus(o.status);
        setOrder(o);
        if (isTerminal(o.status)) {
          if (!advanceQueueRef.current()) {
            setPhase('done');
          }
          return;
        }
      } catch {
        // transient — keep polling
      }
      if (active) timer = setTimeout(poll, TERMINAL_POLL_MS);
    };

    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, orderId]);

  const explorerUrl = buildExplorerUrl(resolved, order);

  return {
    phase,
    assetsLoading,
    assetsError,
    ready,
    hint,
    issues,
    resolved,
    quote,
    preview,
    needsApproval,
    orderId,
    status,
    explorerUrl,
    error,
    isConnected,
    queueIndex,
    queueTotal: intentQueue.length,
    run,
    confirm: () => void confirm(),
    reset,
  };
}
