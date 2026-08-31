import { useTranslation } from 'react-i18next';

import { Section, SectionHeading } from './SectionHeading';

/* ── how it works ─────────────────────────────────────────────────────────
   This was four glass cards each springing in on scroll with a 110ms
   stagger, an auto-advancing "active" step on an interval, a pulsing icon
   on whichever step was active, a gradient bar sweeping along a connector
   line, and a hover lift. Five motions on one section, none of them telling
   the reader anything — and because the cards were reveal-gated, the
   section rendered as an empty void until scrolled to.

   Now: the steps, numbered, on one hairline grid. The only motion left is
   the rest of the page scrolling past it. A process is something to read
   in order; it does not need to perform. */

interface Step {
  title: string;
  desc: string;
}

export default function HowItWorks() {
  const { t } = useTranslation();
  const raw = t('how.steps', { returnObjects: true }) as unknown;
  const steps: Step[] = Array.isArray(raw) ? (raw as Step[]) : [];

  return (
    <Section id="how">
      <SectionHeading
        align="center"
        eyebrow={t('how.label', 'how it works')}
        title={t('how.h2', 'Built around intents')}
        lede={t('how.lede', 'You say the outcome. The network works out the route, competes on it, and settles it — one signature.')}
      />

      <ol className="mx-auto mt-14 grid max-w-5xl grid-cols-1 gap-x-10 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <li
            key={step.title}
            // A top rule on every step gives the row a spine without cards.
            className="border-t border-border pt-5 pb-8"
          >
            <p className="font-mono text-[11px] tabular-nums text-primary" style={{ letterSpacing: 'var(--tracking-ui)' }}>
              {String(i + 1).padStart(2, '0')}
            </p>
            <h3
              className="mt-3 font-sans text-lg text-app-text"
              style={{
                fontWeight: 'var(--font-heading-weight)' as unknown as number,
                lineHeight: 'var(--leading-display)',
                letterSpacing: 'var(--tracking-display)',
              }}
            >
              {step.title}
            </h3>
            <p
              className="mt-2 max-w-[32ch] font-sans text-sm text-text-secondary"
              style={{ lineHeight: 'var(--leading-body)', letterSpacing: 'var(--tracking-body)' }}
            >
              {step.desc}
            </p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
