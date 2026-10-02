import type { ReactNode } from 'react';

/* ── shared section furniture (ported from v1) ────────────────────────────
   Every section below the hero used to invent its own eyebrow, heading size
   and rhythm. One primitive is what makes the page read as a single document
   rather than as stacked templates — and it is the same primitive v1 uses,
   so the two properties share a spine.

   The eyebrow is a slash-prefixed mono label. Small, but it is the detail
   that stops the page reading as a generic template: it signals engineering
   and it is cheap to keep consistent. */

interface SectionHeadingProps {
  /** Rendered after a "/" — lowercase reads better. */
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: 'start' | 'center';
  className?: string;
}

export function SectionHeading({ eyebrow, title, lede, align = 'start', className }: SectionHeadingProps) {
  const centered = align === 'center';
  return (
    <div className={`${centered ? 'mx-auto max-w-2xl text-center' : 'max-w-xl'} ${className ?? ''}`}>
      <p className="mb-3 font-mono text-xs text-primary" style={{ letterSpacing: 'var(--tracking-ui)' }}>
        <span className="opacity-50">/</span>
        {eyebrow}
      </p>
      <h2
        className="font-sans text-[26px] text-app-text sm:text-[34px]"
        style={{
          fontWeight: 'var(--font-heading-weight)' as unknown as number,
          lineHeight: 'var(--leading-display)',
          letterSpacing: 'var(--tracking-display)',
        }}
      >
        {title}
      </h2>
      {lede && (
        <p
          className="mt-3 font-sans text-sm text-text-secondary sm:text-base"
          style={{ lineHeight: 'var(--leading-body)', letterSpacing: 'var(--tracking-body)' }}
        >
          {lede}
        </p>
      )}
    </div>
  );
}

/** Vertical rhythm for a below-the-fold section. Generous padding is doing
 *  most of the work — cramped sections were a large part of why the old page
 *  felt busy at fifteen of them. */
export function Section({
  id,
  children,
  divide = true,
  className,
}: {
  id?: string;
  children: ReactNode;
  divide?: boolean;
  className?: string;
}) {
  return (
    <section id={id} className={`${divide ? 'border-b border-border' : ''} ${className ?? ''}`}>
      <div className="mx-auto max-w-[1320px] px-5 py-16 sm:px-8 sm:py-24 lg:px-10">{children}</div>
    </section>
  );
}
