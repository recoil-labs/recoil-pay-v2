import { useState } from 'react';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Section, SectionHeading } from './SectionHeading';
import { Reveal, VIEWPORT, container, item } from './motion/Reveal';
import { cn } from '@/lib/utils';
import { DROP_IN_DOCS_URL, NPM_URL, WIDGET_CDN_URL } from '@/lib/links';

/* ── for developers ───────────────────────────────────────────────────────
   Three ways in, most to least ready-made: the intent bar at the top of
   this page as a script tag, the same bar as a React component, or the
   four API routes it calls. The best pitch for the first two is the page
   itself — the visitor has just used the thing they'd be embedding. The
   API tab is the live surface this site calls, against the same
   aggregator origin, so the copy-paste path works on the first try. */

const AGGREGATOR = (import.meta.env.VITE_OIF_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

const ROUTES = [
  { method: 'GET', path: '/api/v1/solvers', what: 'registered solvers + supported assets' },
  { method: 'POST', path: '/api/v1/quotes', what: 'competing quotes for an intent' },
  { method: 'POST', path: '/api/v1/orders', what: 'submit a signed order' },
  { method: 'GET', path: '/api/v1/orders/{id}', what: 'settlement status' },
] as const;

const SNIPPETS = {
  widget: `<script type="module"
  src="${WIDGET_CDN_URL}"></script>

<recoilpay-intent
  hf-access-token="YOUR_HF_TOKEN"
  walletconnect-project-id="YOUR_REOWN_PROJECT_ID"
></recoilpay-intent>`,
  react: `npm i @recoilpay/intent-react viem

import { RecoilIntent } from '@recoilpay/intent-react';
import '@recoilpay/intent-react/styles.css';

<RecoilIntent
  hfAccessToken={HF_TOKEN}
  wallet={wallet}
  onConnectWallet={openConnectModal}
/>`,
} as const;

type Tab = 'widget' | 'react' | 'api';

export default function ForDevelopers() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('widget');

  const tabs: { id: Tab; label: string; hint: string }[] = [
    { id: 'widget', label: t('devs.tabWidget', 'Script tag'), hint: t('devs.hintWidget', 'any website') },
    { id: 'react', label: t('devs.tabReact', 'React'), hint: t('devs.hintReact', 'your wallet setup') },
    { id: 'api', label: t('devs.tabApi', 'API'), hint: t('devs.hintApi', 'your own UI') },
  ];

  return (
    <Section id="developers">
      <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <Reveal>
          <SectionHeading
            eyebrow="developers"
            title={t('devs.h2', 'Put this intent bar in your product')}
            lede={t(
              'devs.lede',
              'The bar at the top of this page ships on npm. Drop it into any site with one script tag, into a React app as a component, or skip the UI and call the same four routes this page does.',
            )}
          />
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={DROP_IN_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-primary bg-primary px-4 py-2.5 font-sans text-sm font-semibold text-btn-primary-text transition-[filter] hover:brightness-110"
            >
              {t('devs.ctaDocs', 'Integration docs')}
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
            <a
              href={NPM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2.5 font-sans text-sm text-app-text transition-colors hover:bg-surface-hover"
            >
              {t('devs.ctaNpm', 'View on npm')}
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="rounded-lg border border-border bg-surface shadow-[0_18px_60px_-52px_var(--shadow-color)]">
            <div role="tablist" aria-label={t('devs.tabsLabel', 'Ways to integrate')} className="flex border-b border-border px-2">
              {tabs.map(({ id, label, hint }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`devs-tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls={`devs-panel-${id}`}
                  onClick={() => setTab(id)}
                  className={cn(
                    '-mb-px flex flex-col items-start border-b-2 px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/70',
                    tab === id ? 'border-primary text-app-text' : 'border-transparent text-text-muted hover:text-text-secondary',
                  )}
                >
                  <span className="font-sans text-[13px] font-semibold">{label}</span>
                  <span className="font-mono text-[10px] opacity-80" style={{ letterSpacing: 'var(--tracking-ui)' }}>
                    {hint}
                  </span>
                </button>
              ))}
            </div>

            <div role="tabpanel" id={`devs-panel-${tab}`} aria-labelledby={`devs-tab-${tab}`}>
              {tab === 'api' ? <ApiPanel /> : <CodePanel code={SNIPPETS[tab]} />}
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

function CodePanel({ code }: { code: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard blocked (insecure origin, permissions): the code is still selectable.
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? t('devs.copied', 'Copied') : t('devs.copy', 'Copy code')}
        className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-colors hover:text-app-text"
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
      <pre className="m-0 overflow-x-auto px-5 py-4 pr-14 font-mono text-[12px] leading-[1.7] text-text-secondary">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function ApiPanel() {
  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="font-mono text-[11px] text-text-muted" style={{ letterSpacing: 'var(--tracking-ui)' }}>
          <span className="opacity-50">/</span>api/v1
        </span>
        <span className="hidden truncate font-mono text-[11px] text-text-muted sm:block">{AGGREGATOR.replace(/^https?:\/\//, '')}</span>
      </div>
      {/* The API surface as a terminal card: mono, one route per row,
          each row arriving on the shared stagger. */}
      <motion.ul className="px-5 py-2" initial="hidden" whileInView="show" viewport={VIEWPORT} variants={container}>
        {ROUTES.map((r) => (
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
    </>
  );
}
