import { ArrowRight, AtSign, Check, ExternalLink } from 'lucide-react';
import { TAGS_URL } from '@/lib/links';

interface Props {
  action: 'swap' | 'send';
  receiveAmount: string;
  receiveSymbol: string;
  dstChainName: string;
  explorerUrl: string | null;
  queueTotal?: number;
  onClose: () => void;
}

export default function SwapCompleteModal({
  action,
  receiveAmount,
  receiveSymbol,
  dstChainName,
  explorerUrl,
  queueTotal = 1,
  onClose,
}: Props) {
  const isSend = action === 'send';
  const isMulti = queueTotal > 1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay p-5 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="glass-panel flex w-full max-w-[400px] flex-col items-center gap-2 rounded-[22px] px-6 py-7 text-center"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isSend ? 'Transfer complete' : 'Swap complete'}
      >
        <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full border border-mint/40 bg-mint-soft text-mint shadow-[0_0_34px_var(--mint-soft)]">
          <Check size={32} aria-hidden="true" />
        </div>

        <h3 className="m-0 font-display text-[24px] font-bold text-app-text">
          {isMulti ? `All ${queueTotal} intents complete` : (isSend ? 'Transfer complete' : 'Swap complete')}
        </h3>
        <p className="m-0 max-w-[310px] font-sans text-sm leading-[1.6] text-text-secondary">
          {isSend ? 'They received' : 'You received'}{' '}
          <strong className="font-semibold text-app-text">
            {receiveAmount} {receiveSymbol}
          </strong>{' '}
          on {dstChainName}.
        </p>

        <div className="mt-4 flex w-full flex-col gap-2.5">
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary bg-primary px-4 py-[11px] text-center font-sans text-sm font-semibold text-btn-primary-text no-underline transition-[box-shadow,filter,transform] duration-200 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_0_24px_var(--primary-dim)]"
            >
              View in explorer
              <ExternalLink size={15} aria-hidden="true" />
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-xl border border-border-subtle bg-surface-input px-4 py-[11px] font-sans text-sm font-semibold text-app-text transition-colors duration-200 hover:border-border-cyan hover:text-accent-cyan"
          >
            Done
          </button>
        </div>

        {/* The moment someone has just moved money is the moment a name
            instead of a 0x address means most. Reservation only: sending
            to a tag isn't live yet, so the copy says "next time". */}
        <a
          href={TAGS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex w-full items-center gap-3 rounded-xl border border-border-subtle bg-surface-input px-4 py-3 text-left no-underline transition-colors duration-200 hover:border-border-cyan"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-dim text-primary">
            <AtSign size={16} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 font-sans text-[13px] leading-[1.45] text-text-secondary">
            Next time, send to a name, not an address.{' '}
            <span className="font-semibold text-primary">Reserve your @tag</span>
          </span>
          <ArrowRight size={15} className="shrink-0 text-text-muted" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
