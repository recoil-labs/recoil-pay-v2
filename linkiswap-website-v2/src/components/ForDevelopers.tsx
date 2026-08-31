import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';

import { Section, SectionHeading } from './SectionHeading';
import { Reveal, VIEWPORT, container, item } from './motion/Reveal';

/* ── for developers ───────────────────────────────────────────────────────
   li.fi gives its API a full split section and it earns the space: the
   people most likely to land on an intents site are the ones who might
   build on it. Everything shown here is the live surface this site itself
   calls — the same four routes src/oif/client.ts wraps — against the same
   aggregator origin, so the copy-paste path works on the first try. */

const AGGREGATOR = (import.meta.env.VITE_OIF_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

const ROUTES = [
  { method: 'GET', path: '/api/v1/solvers', what: 'registered solvers + supported assets' },
  { method: 'POST', path: '/api/v1/quotes', what: 'competing quotes for an intent' },
  { method: 'POST', path: '/api/v1/orders', what: 'submit a signed order' },
  { method: 'GET', path: '/api/v1/orders/{id}', what: 'settlement status' },
] as const;

export default function ForDevelopers() {
  const { t } = useTranslation();

  return (
    <Section id="developers">
      <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <Reveal>
          <SectionHeading
            eyebrow="developers"
            title={t('devs.h2', 'The same API this page runs on')}
            lede={t('devs.lede', 'Four routes: list solvers, ask them all for quotes, submit the signed order, watch it settle. ERC-7683 intents underneath — no SDK required.')}
          />
          <a
            href={`${AGGREGATOR}/api/v1/solvers`}
            target="_blank"
            rel="noreferrer"
            className="mt-8 inline-flex items-center gap-2 rounded-md border border-border px-4 py-2.5 font-sans text-sm text-app-text transition-colors hover:bg-surface-hover"
          >
            {t('devs.cta', 'Call it right now')}
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </Reveal>

        {/* The API surface as a terminal card: mono, one route per row,
            each row arriving on the shared stagger. */}
        <Reveal delay={0.08}>
          <div className="rounded-lg border border-border bg-surface shadow-[0_18px_60px_-52px_var(--shadow-color)]">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="font-mono text-[11px] text-text-muted" style={{ letterSpacing: 'var(--tracking-ui)' }}>
                <span className="opacity-50">/</span>api/v1
              </span>
              <span className="hidden truncate font-mono text-[11px] text-text-muted sm:block">
                {AGGREGATOR.replace(/^https?:\/\//, '')}
              </span>
            </div>
            <motion.ul
              className="px-5 py-2"
              initial="hidden"
              whileInView="show"
              viewport={VIEWPORT}
              variants={container}
            >
              {ROUTES.map(r => (
                <motion.li
                  key={`${r.method} ${r.path}`}
                  variants={item}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border py-3.5 last:border-b-0"
                >
                  <span className="w-11 shrink-0 font-mono text-[11px] text-primary">{r.method}</span>
                  <code className="font-mono text-[13px] text-app-text">{r.path}</code>
                  <span className="ms-auto font-sans text-xs text-text-muted" style={{ letterSpacing: 'var(--tracking-ui)' }}>
                    {r.what}
                  </span>
                </motion.li>
              ))}
            </motion.ul>
            <div className="border-t border-border px-5 py-3.5">
              <code className="block overflow-x-auto whitespace-nowrap font-mono text-[12px] leading-relaxed text-text-secondary">
                <span className="text-text-muted">$</span> curl {AGGREGATOR}/api/v1/solvers
              </code>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
