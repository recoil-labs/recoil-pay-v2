import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';

import { Section, SectionHeading } from './SectionHeading';
import { Reveal } from './motion/Reveal';

/* ── solver marketplace ───────────────────────────────────────────────────
   This used to render a staged auction: "Solver A / B / C" with invented
   bids and ETAs, a "Live quote" label, and a trophy on the pre-chosen winner.
   None of it was connected to anything.

   It now lists the solvers that are actually registered with the aggregator,
   fetched live. There are few of them, and that is fine — three real solvers
   say more than three fictional ones, and the number grows on its own as
   operators onboard through the portal linked below. */

const PORTAL = 'https://recoil-solver-portal-675174162902.us-central1.run.app';

interface Solver {
  solverId: string;
  name?: string;
  adapterId?: string;
  status?: string;
  lastSeen?: string;
}

function useSolvers() {
  const [solvers, setSolvers] = useState<Solver[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const base = (import.meta.env.VITE_OIF_API_BASE_URL as string | undefined)?.replace(/\/$/, '');
    if (!base) { setFailed(true); return; }
    const ac = new AbortController();
    fetch(`${base}/api/v1/solvers`, { signal: ac.signal })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => setSolvers(Array.isArray(d) ? d : (d?.solvers ?? [])))
      .catch(() => { if (!ac.signal.aborted) setFailed(true); });
    return () => ac.abort();
  }, []);

  return { solvers, failed };
}

/** Operators register under their wallet address, which is what the
 *  aggregator stores as the name. Shortened the way a block explorer would. */
function shortAddress(s: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(s) ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function relative(iso?: string): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export default function SolverMarketplace() {
  const { t } = useTranslation();
  const benefits = t('market.benefits', { returnObjects: true }) as string[];
  const { solvers, failed } = useSolvers();
  const active = (solvers ?? []).filter(s => s.status === 'active');

  return (
    <Section id="marketplace">
      <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <Reveal>
          <SectionHeading
            eyebrow="solvers"
            title={t('market.h2')}
            lede={t('market.desc')}
          />
          <ul className="mt-8 grid max-w-[520px] grid-cols-1 gap-2 sm:grid-cols-2">
            {(Array.isArray(benefits) ? benefits : []).map(b => (
              <li key={b} className="flex items-start gap-2.5 py-1.5">
                <Check size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="font-sans text-sm text-text-secondary" style={{ lineHeight: 'var(--leading-body)' }}>{b}</span>
              </li>
            ))}
          </ul>
          <a
            href={PORTAL}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-8 inline-flex items-center gap-2 rounded-md border border-border px-4 py-2.5 font-sans text-sm text-app-text transition-colors hover:bg-surface-hover"
            style={{ letterSpacing: 'var(--tracking-ui)' }}
          >
            {t('market.runSolver', 'Run a solver')}
            <span aria-hidden="true">→</span>
          </a>
        </Reveal>

        <Reveal delay={0.08}>
        <div className="rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="font-mono text-[11px] text-text-muted" style={{ letterSpacing: 'var(--tracking-ui)' }}>
              <span className="opacity-50">/</span>registered
            </span>
            {solvers && (
              <span className="font-sans text-xs tabular-nums text-text-secondary">
                {active.length} active
              </span>
            )}
          </div>

          {solvers === null && !failed && (
            <ul className="px-5">
              {[0, 1, 2].map(i => (
                <li key={i} className="border-b border-border py-4 last:border-b-0">
                  <div className="h-5 w-2/3 animate-pulse rounded bg-surface-hover" />
                </li>
              ))}
            </ul>
          )}

          {failed && (
            <p className="px-5 py-10 text-center font-sans text-sm text-text-muted">
              {t('market.unavailable', 'Solver registry unavailable right now.')}
            </p>
          )}

          {solvers && solvers.length === 0 && (
            <p className="px-5 py-10 text-center font-sans text-sm text-text-muted">
              {t('market.none', 'No solvers registered yet.')}
            </p>
          )}

          {solvers && solvers.length > 0 && (
            <ul className="px-5">
              {solvers.map(s => {
                const isActive = s.status === 'active';
                const seen = relative(s.lastSeen);
                return (
                  <li key={s.solverId} className="flex items-center gap-4 border-b border-border py-3.5 last:border-b-0">
                    {/* Status as a dot, not a "LIVE" pill. */}
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: isActive ? '#3fb98f' : 'var(--text-muted)' }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[13px] text-app-text">
                        {shortAddress(s.name || s.solverId)}
                      </span>
                      <span className="block font-sans text-xs text-text-muted">
                        {s.adapterId ?? 'oif'}{seen ? ` · seen ${seen}` : ''}
                      </span>
                    </span>
                    <span className="font-sans text-xs text-text-secondary" style={{ letterSpacing: 'var(--tracking-ui)' }}>
                      {isActive ? 'active' : (s.status ?? 'unknown')}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        </Reveal>
      </div>
    </Section>
  );
}
