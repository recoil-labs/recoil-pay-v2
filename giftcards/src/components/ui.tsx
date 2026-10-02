import type { ReactNode } from 'react';

/* Small shared primitives. Depth is carried by surface steps and hairlines,
   never shadows — that is the one rule in this design system that a
   component can break without anyone noticing until the whole page looks
   wrong next to the rest of RecoilPay. */

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[14px] border border-hairline bg-surface ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, detail, action }: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
      <div>
        <h2 className="text-[15px] text-ink">{title}</h2>
        {detail && <p className="mt-1 text-[13px] text-muted">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-ground hover:brightness-110',
  secondary: 'bg-raised text-ink border border-hairline hover:border-accent/50',
  ghost: 'text-secondary hover:text-ink',
  danger: 'text-danger hover:bg-danger/10',
};

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...rest
}: {
  children: ReactNode;
  variant?: ButtonVariant;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-[8px] px-3.5 py-2 text-[13px] transition-all duration-200 ease-[var(--ease-recoil)] disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_STYLES[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] text-muted">{label}</span>
      {children}
      {/* An error replaces the hint rather than stacking under it: two lines
          of small grey text with one of them important is a line nobody
          reads. */}
      {error ? (
        <span className="text-[12px] text-danger">{error}</span>
      ) : (
        hint && <span className="text-[12px] text-muted/70">{hint}</span>
      )}
    </label>
  );
}

export const inputClass =
  'w-full rounded-[8px] border border-hairline bg-raised px-3 py-2 text-[13px] text-ink placeholder:text-muted/60 transition-colors duration-200 focus:border-accent focus:outline-none';

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const tones = {
    neutral: 'border-hairline text-secondary',
    success: 'border-success/40 text-success',
    warning: 'border-warning/40 text-warning',
    danger: 'border-danger/40 text-danger',
    accent: 'border-accent/40 text-accent',
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-[4px] border px-1.5 py-0.5 text-[11px] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, detail, action }: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="text-[14px] text-secondary">{title}</p>
      <p className="max-w-[46ch] text-[13px] text-muted">{detail}</p>
      {action}
    </div>
  );
}
