import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Reveal } from './motion/Reveal';

const SOLVER_PORTAL_URL = 'https://recoil-solver-portal-675174162902.us-central1.run.app';

/* ── the close ────────────────────────────────────────────────────────────
   li.fi and Rubic both end on a call, and they are right to: after five
   sections of evidence the page should ask for the action it was built
   for. Ours scrolls back to the composer — the product IS the input at
   the top — with running a solver as the second door. */

export default function ClosingCTA() {
  const { t } = useTranslation();

  const toComposer = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Focus lands after the scroll settles, so the caret is waiting.
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    }, 650);
  };

  return (
    <section className="border-t border-border px-5 py-24 sm:px-8 sm:py-32">
      <Reveal className="mx-auto flex max-w-[1320px] flex-col items-center text-center">
        <p className="font-mono text-xs text-primary" style={{ letterSpacing: 'var(--tracking-ui)' }}>
          <span className="opacity-50">/</span>go
        </p>
        <h2
          className="mt-5 max-w-[18ch] font-sans text-[clamp(30px,4.6vw,54px)] text-app-text"
          style={{
            fontWeight: 'var(--font-heading-weight)' as unknown as number,
            lineHeight: 'var(--leading-hero)',
            letterSpacing: 'var(--tracking-hero)',
          }}
        >
          {t('cta.h2', 'Say it. Sign it. Settled.')}
        </h2>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={toComposer}
            className="rounded-md bg-primary px-6 py-3 font-sans text-sm text-app-bg transition-opacity hover:opacity-90"
            style={{ letterSpacing: 'var(--tracking-ui)' }}
          >
            {t('cta.primary', 'Write an intent')}
          </button>
          <a
            href={SOLVER_PORTAL_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-border px-6 py-3 font-sans text-sm text-app-text transition-colors hover:bg-surface-hover"
            style={{ letterSpacing: 'var(--tracking-ui)' }}
          >
            {t('cta.secondary', 'Run a solver')}
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </div>
      </Reveal>
    </section>
  );
}
