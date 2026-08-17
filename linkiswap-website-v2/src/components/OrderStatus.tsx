import { Check, Loader2, X } from 'lucide-react';
import type { OrderStatus as OrderStatusValue } from '../oif/types';
import { cn } from '@/lib/utils';

interface Props {
  orderId: string;
  status: OrderStatusValue | null;
}

const STEPS = ['pending', 'executing', 'executed', 'settled', 'finalized'] as const;

function stepIndex(status: OrderStatusValue | null): number {
  if (!status || typeof status === 'object') return 0;
  switch (status) {
    case 'created':
    case 'pending':
      return 0;
    case 'executing':
      return 1;
    case 'executed':
      return 2;
    case 'settled':
    case 'settling':
      return 3;
    case 'finalized':
      return 4;
    default:
      return 0;
  }
}

function isFailed(status: OrderStatusValue | null): status is { failed: [string, string] } {
  return !!status && typeof status === 'object' && 'failed' in status;
}

const isRefunded = (status: OrderStatusValue | null): boolean => status === 'refunded';

export default function OrderStatus({ orderId, status }: Props) {
  const failed = isFailed(status);
  const refunded = isRefunded(status);
  const terminalBad = failed || refunded;
  const finalized = status === 'finalized';
  const active = stepIndex(status);

  const headClass = terminalBad
    ? 'text-red'
    : finalized
      ? 'text-accent-cyan'
      : 'text-app-text';

  const headText = failed
    ? 'Order failed'
    : refunded
      ? 'Refunded'
      : finalized
        ? 'Settled and finalized'
        : 'Settlement in progress';

  return (
    <div className="glass-panel w-full max-w-[540px] overflow-hidden rounded-[22px]">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
        <div>
          <span className={cn('font-display text-lg font-semibold', headClass)}>
            {headText}
          </span>
          <div className="mt-1 font-sans text-xs text-text-muted">Open Intents settlement rail</div>
        </div>
        <span className="rounded-full border border-border-subtle bg-surface-input px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
          Order
        </span>
      </div>

      <div className="px-5 py-5">
        <div className="flex items-center gap-0">
          {STEPS.map((step, index) => {
            const done = index < active || finalized;
            const current = index === active && !terminalBad && !finalized;
            const dotClass = terminalBad
              ? 'border-red bg-red-soft text-red'
              : done
                ? 'border-border-cyan bg-accent-cyan text-app-bg'
                : current
                  ? 'border-border-cyan bg-primary text-btn-primary-text'
                  : 'border-border-subtle bg-surface-input text-text-muted';
            const textClass = terminalBad
              ? 'text-text-muted'
              : current
                ? 'font-semibold text-app-text'
                : done
                  ? 'text-text-secondary'
                  : 'text-text-muted';
            const leftBarClass = index === 0
              ? 'bg-transparent'
              : done || current
                ? 'bg-accent-cyan'
                : 'bg-border-subtle';
            const rightBarClass = index === STEPS.length - 1
              ? 'bg-transparent'
              : done
                ? 'bg-accent-cyan'
                : 'bg-border-subtle';

            return (
              <div key={step} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex w-full items-center">
                  <div className={cn('h-0.5 flex-1', leftBarClass)} />
                  <div className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border', dotClass)}>
                    {terminalBad ? (
                      <X size={13} aria-hidden="true" />
                    ) : done ? (
                      <Check size={13} aria-hidden="true" />
                    ) : current ? (
                      <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    )}
                  </div>
                  <div className={cn('h-0.5 flex-1', rightBarClass)} />
                </div>
                <span className={cn('font-sans text-[10.5px] capitalize', textClass)}>
                  {step}
                </span>
              </div>
            );
          })}
        </div>

        {failed && (
          <div className="mt-4 rounded-2xl bg-red-soft px-4 py-3 font-sans text-[12.5px] leading-[1.4] text-red">
            {status.failed[0]}: {status.failed[1]}
          </div>
        )}

        <div className="mt-4 break-all rounded-2xl bg-surface-input px-4 py-3 font-mono text-[11.5px] text-text-muted">
          ID {orderId}
        </div>
      </div>
    </div>
  );
}
