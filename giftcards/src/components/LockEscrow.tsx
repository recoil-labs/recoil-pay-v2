import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { Button, Pill } from './ui';
import {
  BOND_ABI,
  ERC20_ABI,
  ESCROW_ABI,
  loadChains,
  resolveSettlement,
  tradeIdHash,
  type Settlement,
} from '../chain/escrow';
import { fromMinorUnits } from '../types/giftcards';
import type { Trade } from '../types/trades';

/* Locking the money leg.
 *
 * Previously this component asked for a transaction hash and trusted the
 * person to have produced one by hand — approve the token, hash the trade id
 * to bytes32, call `lock` with the right counterparty. Nobody can do that,
 * so the flow was unusable by anyone who was not holding the ABI.
 *
 * It now does the whole thing: resolve the contracts from the registry,
 * switch network, approve only if the allowance is short, lock, wait for the
 * receipt, and hand the hash to the aggregator — which independently
 * verifies the lock really landed with the right token, amount and parties
 * before the trade advances.
 */

type Step = 'idle' | 'switching' | 'approving' | 'locking' | 'confirming' | 'submitting';

const STEP_COPY: Record<Exclude<Step, 'idle'>, string> = {
  switching: 'Switch network in your wallet…',
  approving: 'Approve the token…',
  locking: 'Confirm the lock…',
  confirming: 'Waiting for the transaction…',
  submitting: 'Verifying on-chain…',
};

export function LockEscrow({
  trade,
  onFunded,
}: {
  trade: Trade;
  /** Called with the lock's transaction hash once it is mined. */
  onFunded: (txHash: string) => Promise<void>;
}) {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);

  const baseUrl =
    localStorage.getItem('recoil_gc_base_url') || import.meta.env.VITE_API_BASE_URL || '';

  useEffect(() => {
    let live = true;
    void loadChains(baseUrl)
      .then((chains) => {
        if (!live) return;
        const r = resolveSettlement(chains, trade.payoutChain, trade.payoutAsset);
        if ('error' in r) setResolveError(r.error);
        else setSettlement(r.ok);
      })
      .catch((e) => live && setResolveError(e instanceof Error ? e.message : 'registry unavailable'));
    return () => {
      live = false;
    };
  }, [baseUrl, trade.payoutChain, trade.payoutAsset]);

  /** The party on the other side — what `lock` records as the counterparty,
   *  and the only address besides the funder the escrow will ever pay. */
  const counterparty = (
    trade.funder === 'user' ? trade.merchantAddress : trade.userAddress
  ) as `0x${string}`;

  const run = useCallback(async () => {
    if (!settlement || !address || !publicClient) return;
    setError(null);
    try {
      if (chainId !== settlement.chainId) {
        setStep('switching');
        await switchChainAsync({ chainId: settlement.chainId });
      }

      const amount = BigInt(trade.payoutMinorUnits);
      const id = tradeIdHash(trade.id);

      // Refuse early rather than after an approval the person has paid gas
      // for. The balance check is the common case — a testnet wallet that
      // was never funded with the payout token.
      const balance = (await publicClient.readContract({
        address: settlement.token.address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      })) as bigint;
      if (balance < amount) {
        throw new Error(
          `You have ${fromMinorUnits(balance.toString(), settlement.token.decimals)} ` +
            `${settlement.token.symbol} but this trade needs ` +
            `${fromMinorUnits(amount.toString(), settlement.token.decimals)}.`,
        );
      }

      // Approve only if the allowance is short. Re-approving every time is
      // an extra transaction and an extra wallet prompt for nothing.
      const allowance = (await publicClient.readContract({
        address: settlement.token.address,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, settlement.escrow],
      })) as bigint;

      if (allowance < amount) {
        setStep('approving');
        const approveTx = await writeContractAsync({
          address: settlement.token.address,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [settlement.escrow, amount],
        });
        setStep('confirming');
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }

      setStep('locking');
      const lockTx = await writeContractAsync({
        address: settlement.escrow,
        abi: ESCROW_ABI,
        functionName: 'lock',
        args: [id, settlement.token.address, amount, counterparty],
      });

      setStep('confirming');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: lockTx });
      if (receipt.status !== 'success') throw new Error('the lock transaction reverted');

      // The aggregator re-verifies this independently — it does not take
      // the hash on trust — so a mismatch is reported by name here.
      setStep('submitting');
      await onFunded(lockTx);
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'could not fund escrow';
      setError(
        /user rejected|denied/i.test(raw)
          ? 'You cancelled the transaction.'
          : /LockExists/i.test(raw)
            ? 'This trade is already locked on-chain. Refresh the page.'
            : raw,
      );
    } finally {
      setStep('idle');
    }
  }, [
    settlement, address, publicClient, chainId, switchChainAsync,
    writeContractAsync, trade, counterparty, onFunded,
  ]);

  if (resolveError) {
    return (
      <p className="text-[13px] text-danger">
        {resolveError}. Nothing has been charged — this trade cannot settle on
        that chain yet.
      </p>
    );
  }

  if (!settlement) {
    return <p className="text-[13px] text-muted">Loading contract details…</p>;
  }

  const amountLabel = `${fromMinorUnits(trade.payoutMinorUnits, settlement.token.decimals)} ${settlement.token.symbol}`;

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-secondary">
        <ShieldCheck size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
        <span>
          Locking <strong className="text-ink">{amountLabel}</strong> into escrow.
          It can only ever go to you or to the other party — the contract will
          not send it anywhere else, and it returns to you automatically if
          they never deliver.
        </span>
      </p>

      {error && <p className="text-[12px] text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={step !== 'idle'}>
          {step === 'idle' ? `Lock ${amountLabel}` : STEP_COPY[step]}
        </Button>
        {chainId !== settlement.chainId && step === 'idle' && (
          <Pill tone="warning">Wrong network — we'll switch you</Pill>
        )}
      </div>
    </div>
  );
}

/** Staking a merchant's bond.
 *
 *  A merchant with no bond has zero capacity and every trade against them is
 *  refused, so this is the first thing a new merchant has to do. It was
 *  previously two `cast send` commands in a deploy guide, which is fine for
 *  an operator testing and impossible for a merchant signing up. */
export function StakeBond({
  payoutChain,
  payoutAsset,
  onStaked,
}: {
  payoutChain: string;
  payoutAsset: string;
  onStaked?: () => void;
}) {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [staked, setStaked] = useState<bigint | null>(null);
  const [amount, setAmount] = useState('1000');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);

  const baseUrl =
    localStorage.getItem('recoil_gc_base_url') || import.meta.env.VITE_API_BASE_URL || '';

  const refresh = useCallback(
    async (s: Settlement) => {
      if (!address || !publicClient) return;
      try {
        const v = (await publicClient.readContract({
          address: s.bond,
          abi: BOND_ABI,
          functionName: 'availableBond',
          args: [address, s.token.address],
        })) as bigint;
        setStaked(v);
      } catch {
        setStaked(null);
      }
    },
    [address, publicClient],
  );

  useEffect(() => {
    let live = true;
    void loadChains(baseUrl)
      .then((chains) => {
        if (!live) return;
        const r = resolveSettlement(chains, payoutChain, payoutAsset);
        if ('ok' in r) {
          setSettlement(r.ok);
          void refresh(r.ok);
        } else {
          setError(r.error);
        }
      })
      .catch(() => live && setError('could not load the chain registry'));
    return () => {
      live = false;
    };
  }, [baseUrl, payoutChain, payoutAsset, refresh]);

  async function stake() {
    if (!settlement || !address || !publicClient) return;
    setError(null);
    try {
      if (chainId !== settlement.chainId) {
        setStep('switching');
        await switchChainAsync({ chainId: settlement.chainId });
      }

      const units = BigInt(
        Math.round(Number(amount) * 10 ** settlement.token.decimals),
      );
      if (units <= 0n) throw new Error('enter an amount above zero');

      const allowance = (await publicClient.readContract({
        address: settlement.token.address,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, settlement.bond],
      })) as bigint;

      if (allowance < units) {
        setStep('approving');
        const tx = await writeContractAsync({
          address: settlement.token.address,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [settlement.bond, units],
        });
        setStep('confirming');
        await publicClient.waitForTransactionReceipt({ hash: tx });
      }

      setStep('locking');
      const tx = await writeContractAsync({
        address: settlement.bond,
        abi: BOND_ABI,
        functionName: 'deposit',
        args: [address, settlement.token.address, units],
      });
      setStep('confirming');
      await publicClient.waitForTransactionReceipt({ hash: tx });

      await refresh(settlement);
      onStaked?.();
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'could not stake';
      setError(/user rejected|denied/i.test(raw) ? 'You cancelled the transaction.' : raw);
    } finally {
      setStep('idle');
    }
  }

  if (!settlement) {
    return <p className="text-[13px] text-muted">{error ?? 'Loading…'}</p>;
  }

  const stakedLabel =
    staked === null
      ? '—'
      : `${fromMinorUnits(staked.toString(), settlement.token.decimals)} ${settlement.token.symbol}`;
  const capacity =
    staked === null
      ? '—'
      : `${fromMinorUnits((staked * 5n).toString(), settlement.token.decimals)} ${settlement.token.symbol}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-6 text-[13px]">
        <span className="text-muted">
          Staked <span className="ml-1.5 text-ink">{stakedLabel}</span>
        </span>
        <span className="text-muted">
          Trade capacity <span className="ml-1.5 text-ink">{capacity}</span>
        </span>
      </div>
      <p className="text-[12px] leading-relaxed text-muted">
        Your stake backs your promises: open trades are capped at five times
        it, and a dispute decided against you is paid out of it. A slash is
        proposed and held for 24 hours before it can be taken, so you always
        see it coming.
      </p>

      {error && <p className="text-[12px] text-danger">{error}</p>}

      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-muted">Add to stake ({settlement.token.symbol})</span>
          <input
            className="w-[160px] rounded-[8px] border border-hairline bg-raised px-3 py-2 text-[13px] text-ink focus:border-accent focus:outline-none"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
          />
        </label>
        <Button onClick={stake} disabled={step !== 'idle'}>
          {step === 'idle' ? 'Stake' : STEP_COPY[step]}
        </Button>
      </div>
    </div>
  );
}
