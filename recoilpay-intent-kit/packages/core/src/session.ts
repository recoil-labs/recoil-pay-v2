import { formatUnits, type Abi, type Address } from 'viem';
import { createApiClient, type ApiClient, type ApiOptions, type ChainInfo } from './api';
import { chainName, explorerUrl, rpcReaders, SOLANA_CHAIN_IDS, type ChainReader } from './chains';
import { buildSupportedSet, EMPTY_SUPPORTED, findAsset, normalizeToken, type SupportedSet } from './intent/registry';
import { resolveIntent } from './intent/resolve';
import type { RawIntent, ResolvedIntent, ValidationIssue } from './intent/types';
import { validateIntent } from './intent/validate';
import { buildOrderRequest, buildQuoteRequest } from './oif/buildQuoteRequest';
import { buildPermit2ApproveRequest, hasPermit2Allowance } from './oif/permit2';
import { signQuote } from './oif/sign';
import type { OrderResponse, OrderStatus, Quote } from './oif/types';
import type { IntentWallet } from './wallet';

/**
 * Where the flow is.
 *
 *   idle          nothing submitted yet
 *   parsing       turning the text into intents
 *   offTemplate   couldn't parse; show `hint`
 *   invalid       parsed, but `issues` need fixing
 *   needsWallet   ready to quote once a wallet is set
 *   quoting       resolving and racing solvers
 *   quoted        `preview` is ready to confirm
 *   switchingChain / approving / signing / submitting   confirm() progress
 *   tracking      order submitted, polling its status
 *   done          every intent reached a terminal status
 *   error         something threw; see `error`
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

/** What a confirm card shows: human amounts and names, no addresses or base units. */
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
  /** Quotes received (1 for a direct wallet transfer). */
  solverCount: number;
  solversQueried?: number;
  raceMs?: number;
}

export interface IntentState {
  phase: IntentPhase;
  assetsLoading: boolean;
  assetsError: boolean;
  /** The supported-asset set has loaded, so input can be accepted. */
  ready: boolean;
  hint: string | null;
  issues: ValidationIssue[];
  resolved: ResolvedIntent | null;
  /**
   * `solver` goes through the aggregator. `direct` is a same-chain send,
   * which solvers don't quote, so the wallet transfers it itself.
   */
  route: 'solver' | 'direct' | null;
  quote: Quote | null;
  preview: IntentPreview | null;
  /** Escrow route only: an ERC-20 approval to Permit2 comes first. */
  needsApproval: boolean;
  orderId: string | null;
  status: OrderStatus | null;
  order: OrderResponse | null;
  /** Destination-chain explorer link: the fill tx when known, else the recipient. */
  explorerUrl: string | null;
  error: string | null;
  isConnected: boolean;
  /** Multi-intent sentences run one after another. */
  queueIndex: number;
  queueTotal: number;
}

export interface IntentSession {
  getState(): IntentState;
  /** Called after every state change. Returns an unsubscribe function. */
  subscribe(listener: (state: IntentState) => void): () => void;
  run(text: string): Promise<void>;
  confirm(): Promise<void>;
  reset(): void;
  /** Connect, switch or disconnect. A pending intent continues automatically. */
  setWallet(wallet: IntentWallet | null): void;
  refreshAssets(): Promise<void>;
  /** Stop polling and drop listeners. */
  destroy(): void;
}

export interface SessionOptions extends ApiOptions {
  /** Share one client across sessions; otherwise built from `apiUrl`/`fetch`. */
  api?: ApiClient;
  wallet?: IntentWallet | null;
  /** Order-status polling interval. Default 2500ms. */
  pollIntervalMs?: number;
  /** Chain reads (Permit2 allowance, receipts). Defaults to the aggregator's RPCs. */
  chainReader?: (chainId: number) => Promise<ChainReader | null>;
}

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
] as const satisfies Abi;

const errMessage = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : 'Something went wrong.';

function fmtUnits(amount: bigint | string | undefined, decimals: number): string {
  if (amount === undefined) return '';
  const human = formatUnits(typeof amount === 'bigint' ? amount : BigInt(amount), decimals);
  const n = Number(human);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 6 }) : human;
}

export function isTerminalStatus(status: OrderStatus): boolean {
  if (typeof status === 'object') return 'failed' in status;
  return status === 'finalized' || status === 'refunded';
}

function fillTxHash(order: OrderResponse | null): string | null {
  const f = (order as { fillTransaction?: unknown } | null)?.fillTransaction;
  if (!f || typeof f !== 'object') return null;
  const rec = f as Record<string, unknown>;
  const h = rec.hash ?? rec.transactionHash ?? rec.txHash;
  return typeof h === 'string' && /^0x[0-9a-fA-F]+$/.test(h) ? h : null;
}

const isNativeToken = (token: string) => !token || /^0x0{40}$/i.test(token) || /^0xe{40}$/i.test(token);

const INITIAL: IntentState = {
  phase: 'idle',
  assetsLoading: true,
  assetsError: false,
  ready: false,
  hint: null,
  issues: [],
  resolved: null,
  route: null,
  quote: null,
  preview: null,
  needsApproval: false,
  orderId: null,
  status: null,
  order: null,
  explorerUrl: null,
  error: null,
  isConnected: false,
  queueIndex: 0,
  queueTotal: 0,
};

/**
 * The whole intent flow as a framework-free store: parse → validate →
 * resolve → quote → (approve) → sign → submit → track. UI layers subscribe
 * and render `getState()`; they never talk to the aggregator themselves.
 */
export function createIntentSession(options: SessionOptions = {}): IntentSession {
  const api = options.api ?? createApiClient(options);
  const pollMs = options.pollIntervalMs ?? 2500;

  let chainsPromise: Promise<ChainInfo[]> | null = null;
  const chains = () => (chainsPromise ??= api.getChains().catch((e) => ((chainsPromise = null), Promise.reject(e))));
  const reader = options.chainReader ?? rpcReaders(chains);

  let wallet: IntentWallet | null = options.wallet ?? null;
  let supported: SupportedSet = EMPTY_SUPPORTED;
  let queue: RawIntent[] = [];
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  // Bumped by run() and reset(). Async work captures it and drops its result
  // if a newer flow has started, so a slow quote can't overwrite a fresh one.
  let generation = 0;

  let state: IntentState = { ...INITIAL, isConnected: Boolean(wallet) };
  const listeners = new Set<(s: IntentState) => void>();

  function set(patch: Partial<IntentState>) {
    if (destroyed) return;
    const next = { ...state, ...patch };
    next.explorerUrl = buildExplorerUrl(next);
    state = next;
    for (const l of listeners) l(state);
  }

  function buildExplorerUrl(s: IntentState): string | null {
    if (!s.resolved) return null;
    const base = explorerUrl(s.resolved.dstChainId);
    if (!base) return null;
    const hash = s.route === 'direct' ? s.orderId : fillTxHash(s.order);
    return hash ? `${base}/tx/${hash}` : `${base}/address/${s.resolved.recipient}`;
  }

  const stopPolling = () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = undefined;
  };

  async function refreshAssets() {
    set({ assetsLoading: true, assetsError: false });
    try {
      supported = buildSupportedSet(await api.getSupportedAssets());
      set({ assetsLoading: false, ready: true });
    } catch {
      set({ assetsLoading: false, assetsError: true });
    }
  }

  async function quoteFor(raw: RawIntent, gen: number) {
    if (!wallet) return set({ phase: 'needsWallet' });
    try {
      set({ phase: 'quoting', error: null });
      const resolved = resolveIntent(raw, supported, wallet.address, wallet.solanaAddress);
      const inAsset = findAsset(supported, resolved.srcChainId, normalizeToken(raw.tokenIn) ?? '');
      const outSymbol = raw.action === 'swap' ? (normalizeToken(raw.tokenOut) ?? '') : (inAsset?.symbol ?? '');
      const outAsset = findAsset(supported, resolved.dstChainId, outSymbol);
      const infos = await chains().catch(() => [] as ChainInfo[]);
      const name = (id: number) => chainName(id, infos.find((c) => c.chain_id === id));
      const paySymbol = inAsset?.symbol ?? (outSymbol || '?');

      // Solvers don't quote a same-chain send; the wallet does it directly.
      if (resolved.action === 'send' && resolved.srcChainId === resolved.dstChainId) {
        if (gen !== generation) return;
        const amount = fmtUnits(resolved.inputAmount, resolved.inputDecimals);
        return set({
          phase: 'quoted',
          resolved,
          route: 'direct',
          quote: null,
          needsApproval: false,
          preview: {
            action: raw.action,
            payAmount: amount,
            paySymbol,
            srcChainName: name(resolved.srcChainId),
            receiveAmount: amount,
            receiveSymbol: paySymbol,
            dstChainName: name(resolved.dstChainId),
            recipient: resolved.recipient,
            etaSeconds: 15,
            solverCount: 1,
          },
        });
      }

      const res = await api.getQuotes(buildQuoteRequest(resolved));
      const best = res.quotes?.[0];
      if (!best) throw new Error('No solver returned a quote for this route yet.');

      // The escrow route needs Permit2 allowance on the input token.
      let needsApproval = false;
      if (best.order.type === 'oif-escrow-v0') {
        const pc = await reader(resolved.srcChainId).catch(() => null);
        needsApproval = pc
          ? !(await hasPermit2Allowance(pc as never, resolved.inputToken as Address, resolved.user as Address, resolved.inputAmount).catch(() => false))
          : true;
      }

      if (gen !== generation) return;
      set({
        phase: 'quoted',
        resolved,
        route: 'solver',
        quote: best,
        needsApproval,
        preview: {
          action: raw.action,
          payAmount: fmtUnits(resolved.inputAmount, resolved.inputDecimals),
          paySymbol,
          srcChainName: name(resolved.srcChainId),
          receiveAmount: fmtUnits(best.preview.outputs?.[0]?.amount, outAsset?.decimals ?? resolved.inputDecimals),
          receiveSymbol: outAsset?.symbol ?? (outSymbol || inAsset?.symbol || '?'),
          dstChainName: name(resolved.dstChainId),
          recipient: raw.action === 'send' ? resolved.recipient : undefined,
          etaSeconds: best.eta,
          solverCount: res.totalQuotes || res.quotes.length || 1,
          solversQueried: res.metadata?.solversQueried,
          raceMs: res.metadata?.totalDurationMs,
        },
      });
    } catch (e) {
      if (gen === generation) set({ phase: 'error', error: errMessage(e) });
    }
  }

  /** Move to the next intent of a multi-intent sentence. False when none are left. */
  function advanceQueue(gen: number): boolean {
    const next = state.queueIndex + 1;
    if (next >= queue.length) return false;
    set({ queueIndex: next, route: null, quote: null, preview: null, orderId: null, status: null, order: null });
    void quoteFor(queue[next], gen);
    return true;
  }

  function track(orderId: string, gen: number) {
    stopPolling();
    const poll = async () => {
      try {
        const order = await api.getOrder(orderId);
        if (gen !== generation) return;
        set({ status: order.status, order });
        if (isTerminalStatus(order.status)) {
          if (!advanceQueue(gen)) set({ phase: 'done' });
          return;
        }
      } catch {
        // Transient — keep polling.
      }
      if (gen === generation && !destroyed) pollTimer = setTimeout(poll, pollMs);
    };
    void poll();
  }

  async function confirm() {
    const { resolved, route } = state;
    const w = wallet;
    if (!resolved || !route || !w) return;
    const gen = generation;
    try {
      set({ error: null });

      if (SOLANA_CHAIN_IDS.has(resolved.srcChainId)) {
        throw new Error('Swaps from Solana are not supported yet.');
      }
      if ((await w.getChainId()) !== resolved.srcChainId) {
        set({ phase: 'switchingChain' });
        await w.switchChain(resolved.srcChainId);
      }

      if (route === 'direct') {
        set({ phase: 'signing' });
        const hash = isNativeToken(resolved.inputToken)
          ? await w.sendTransaction({ chainId: resolved.srcChainId, to: resolved.recipient as Address, value: resolved.inputAmount })
          : await w.writeContract({
              chainId: resolved.srcChainId,
              address: resolved.inputToken as Address,
              abi: ERC20_TRANSFER_ABI,
              functionName: 'transfer',
              args: [resolved.recipient as Address, resolved.inputAmount],
            });
        if (gen !== generation) return;
        set({ orderId: hash, status: 'finalized', order: null });
        if (!advanceQueue(gen)) set({ phase: 'done' });
        return;
      }

      if (state.quote?.order.type === 'oif-escrow-v0') {
        const pc = await reader(resolved.srcChainId).catch(() => null);
        const stillNeeds = pc
          ? !(await hasPermit2Allowance(pc as never, resolved.inputToken as Address, resolved.user as Address, resolved.inputAmount))
          : state.needsApproval;
        if (stillNeeds) {
          set({ phase: 'approving' });
          const approve = buildPermit2ApproveRequest(resolved.inputToken as Address);
          const hash = await w.writeContract({ chainId: resolved.srcChainId, ...approve, abi: approve.abi as unknown as Abi });
          if (pc) await pc.waitForTransactionReceipt({ hash });
          set({ needsApproval: false });
        }
      }

      // Quotes and their signed deadlines are short-lived, and approval can
      // take a while, so sign a fresh quote rather than the one on screen.
      set({ phase: 'signing' });
      const fresh = (await api.getQuotes(buildQuoteRequest(resolved))).quotes?.[0];
      if (!fresh) throw new Error('The quote expired and no fresh quote is available — try again.');
      const signature = await signQuote(fresh, w.signTypedData);

      set({ phase: 'submitting' });
      const order = await api.submitOrder(buildOrderRequest(fresh, signature));
      if (gen !== generation) return;
      set({ phase: 'tracking', quote: fresh, orderId: order.orderId, status: order.status, order });
      track(order.orderId, gen);
    } catch (e) {
      if (gen === generation) set({ phase: 'error', error: errMessage(e) });
    }
  }

  async function run(text: string) {
    const gen = ++generation;
    stopPolling();
    set({ ...INITIAL, assetsLoading: state.assetsLoading, assetsError: state.assetsError, ready: state.ready, isConnected: Boolean(wallet), phase: 'parsing' });

    const parsed = await api.parse(text);
    if (gen !== generation) return;
    if (!parsed.ok) return set({ phase: 'offTemplate', hint: parsed.message });

    for (const intent of parsed.intents) {
      const issues = validateIntent(intent, supported);
      if (issues.length) return set({ phase: 'invalid', issues });
    }

    queue = parsed.intents;
    set({ queueIndex: 0, queueTotal: queue.length });
    await quoteFor(queue[0], gen);
  }

  function reset() {
    generation++;
    stopPolling();
    queue = [];
    set({ ...INITIAL, assetsLoading: state.assetsLoading, assetsError: state.assetsError, ready: state.ready, isConnected: Boolean(wallet) });
  }

  function setWallet(next: IntentWallet | null) {
    const changedAccount = wallet?.address !== next?.address;
    wallet = next;
    set({ isConnected: Boolean(next) });
    // Continue a flow that was waiting for a wallet, or re-quote for the new
    // account: a quote is bound to the address it was built for.
    if (next && (state.phase === 'needsWallet' || (changedAccount && state.phase === 'quoted')) && queue.length) {
      void quoteFor(queue[state.queueIndex], generation);
    }
  }

  void refreshAssets();

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run,
    confirm,
    reset,
    setWallet,
    refreshAssets,
    destroy() {
      generation++;
      stopPolling();
      destroyed = true;
      listeners.clear();
    },
  };
}
