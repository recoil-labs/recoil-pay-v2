import { ArrowRight, Check, Loader2 } from 'lucide-react';
import type { IntentPhase, IntentPreview } from '../hooks/useIntent';
import { cn } from '@/lib/utils';

interface Props {
  preview: IntentPreview;
  phase: IntentPhase;
  needsApproval: boolean;
  isConnected: boolean;
  error: string | null;
  onConfirm: () => void;
  onConnect: () => void;
  onCancel: () => void;
}

const shortAddr = (address: string): string => (
  address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address
);

const isBusy = (phase: IntentPhase): boolean =>
  phase === 'switchingChain' ||
  phase === 'approving' ||
  phase === 'signing' ||
  phase === 'submitting';

function buttonLabel(
  phase: IntentPhase,
  isConnected: boolean,
  needsApproval: boolean,
  paySymbol: string,
): string {
  if (!isConnected || phase === 'needsWallet') return 'Connect Wallet';
  switch (phase) {
    case 'switchingChain':
      return 'Switching network';
    case 'approving':
      return `Approving ${paySymbol}`;
    case 'signing':
      return 'Confirm in wallet';
    case 'submitting':
      return 'Submitting intent';
    case 'error':
      return 'Try again';
    default:
      return needsApproval ? `Approve ${paySymbol}` : 'Confirm and sign';
  }
}

export default function IntentConfirmCard({
  preview,
  phase,
  needsApproval,
  isConnected,
  error,
  onConfirm,
  onConnect,
  onCancel,
}: Props) {
  const busy = isBusy(phase);
  const send = preview.action === 'send';
  const label = buttonLabel(phase, isConnected, needsApproval, preview.paySymbol);

  const onClick = () => {
    if (!isConnected || phase === 'needsWallet') return onConnect();
    return onConfirm();
  };

  return (
    <div className="glass-panel w-full max-w-[540px] overflow-hidden rounded-[22px]">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
        <div>
          <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            Review intent
          </div>
          <div className="mt-1 font-display text-lg font-semibold text-app-text">
            Best solver route
          </div>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-border-cyan bg-primary-dim px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-cyan">
          <Check size={13} aria-hidden="true" />
          Quoted
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-5">
        <RouteAmount
          label={send ? 'You send' : 'You pay'}
          amount={preview.payAmount}
          symbol={preview.paySymbol}
          chain={preview.srcChainName}
        />

        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-border-cyan bg-primary-dim text-accent-cyan">
          <ArrowRight size={17} aria-hidden="true" />
        </span>

        <RouteAmount
          align="right"
          label={send ? 'They receive' : 'You receive'}
          amount={preview.receiveAmount ? `~${preview.receiveAmount}` : '~'}
          symbol={preview.receiveSymbol}
          chain={preview.dstChainName}
        />
      </div>

      <div className="mx-5 mb-5 grid grid-cols-1 gap-2 rounded-2xl bg-surface-input p-3 sm:grid-cols-3">
        <MetaItem label="Settlement" value={preview.etaSeconds ? `~${preview.etaSeconds}s` : 'Fast'} />
        <MetaItem label="Solvers" value={`${preview.solverCount}`} accent />
        <MetaItem label="Action" value={send ? 'Send' : 'Swap'} />
      </div>

      {send && preview.recipient && (
        <div className="mx-5 mb-5 rounded-2xl bg-surface-input px-4 py-3 font-sans text-[12.5px] text-text-secondary">
          Recipient <span className="font-mono text-app-text">{shortAddr(preview.recipient)}</span>
        </div>
      )}

      {error && (
        <div className="mx-5 mb-4 rounded-2xl bg-red-soft px-4 py-3 font-sans text-[12.5px] leading-[1.45] text-red">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-border-subtle px-5 py-5">
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          className={cn(
            'inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary bg-primary py-[13px] font-sans text-[15px] font-semibold text-btn-primary-text transition-[box-shadow,opacity,transform] duration-200',
            busy
              ? 'cursor-default opacity-70'
              : 'cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_0_24px_var(--primary-dim)]'
          )}
        >
          {busy && <Loader2 size={17} className="animate-spin" aria-hidden="true" />}
          {label}
        </button>

        {!busy && (
          <button
            type="button"
            onClick={onCancel}
            className="self-center border-none bg-transparent p-0 font-sans text-[12.5px] font-semibold text-text-muted transition-colors duration-200 hover:text-accent-cyan"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function RouteAmount({
  label,
  amount,
  symbol,
  chain,
  align = 'left',
}: {
  label: string;
  amount: string;
  symbol: string;
  chain: string;
  align?: 'left' | 'right';
}) {
  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right')}>
      <div className="font-sans text-xs uppercase tracking-[0.06em] text-text-muted">{label}</div>
      <div className="mt-1 truncate font-display text-[22px] font-bold leading-[1.15] text-app-text">
        {amount} {symbol}
      </div>
      <div className="mt-1 truncate font-sans text-[12.5px] text-text-secondary">on {chain}</div>
    </div>
  );
}

function MetaItem({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">{label}</div>
      <div className={cn('mt-1 font-sans text-[13px] font-semibold', accent ? 'text-accent-cyan' : 'text-app-text')}>
        {value}
      </div>
    </div>
  );
}
