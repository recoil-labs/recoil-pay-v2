import { useTranslation } from 'react-i18next';
import { ArrowDown, Check, Gauge, Radio, Route, Trophy } from 'lucide-react';
import RevealSection from './RevealSection';
import { cn } from '@/lib/utils';

const SOLVERS = [
  { name: 'Solver A', bid: '0.42%', eta: '41s', winner: false },
  { name: 'Solver B', bid: '0.31%', eta: '27s', winner: true },
  { name: 'Solver C', bid: '0.38%', eta: '34s', winner: false },
];

export default function SolverMarketplace() {
  const { t } = useTranslation();
  const benefits = t('market.benefits', { returnObjects: true }) as string[];

  return (
    <section id="marketplace" className="section-shell px-5 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-12 min-[901px]:grid-cols-[0.9fr_1.1fr] min-[901px]:gap-16">
        <RevealSection>
          <div className="mb-7 h-0.5 w-10 rounded-sm bg-primary shadow-[0_0_14px_var(--primary-dim)]" />
          <span className="section-eyebrow">
            {t('market.label')}
          </span>
          <h2 className="section-heading mb-5 mt-4 max-w-[520px] text-[clamp(30px,3.8vw,50px)] leading-[1.06] tracking-normal">
            {t('market.h2')}
          </h2>
          <p className="mb-7 max-w-[500px] text-[15.5px] leading-[1.75] text-text-secondary">
            {t('market.desc')}
          </p>
          <div className="grid max-w-[520px] grid-cols-1 gap-2 sm:grid-cols-2">
            {benefits.map(benefit => (
              <div key={benefit} className="glass-card flex items-center gap-3 rounded-xl px-3.5 py-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-dim text-accent-cyan">
                  <Check size={14} aria-hidden="true" />
                </span>
                <span className="text-[14px] font-semibold text-text-secondary">{benefit}</span>
              </div>
            ))}
          </div>
        </RevealSection>

        <RevealSection delay={120}>
          <div className="glass-panel hover-card overflow-hidden rounded-[26px] p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border-cyan bg-primary-dim text-accent-cyan">
                  <Radio size={19} aria-hidden="true" />
                </span>
                <div>
                  <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    {t('market.auctionLabel', 'Open auction')}
                  </div>
                  <div className="font-display text-lg font-semibold text-app-text">
                    {t('market.biddingLane', 'Solver bidding lane')}
                  </div>
                </div>
              </div>
              <span className="rounded-full border border-border-cyan bg-primary-dim px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-cyan">
                {t('market.liveQuote', 'Live quote')}
              </span>
            </div>

            <div className="rounded-2xl bg-surface-input p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="font-sans text-[13px] font-semibold text-text-secondary">
                  {t('market.userIntent')}
                </span>
                <span className="font-mono text-[11px] text-text-muted">
                  {t('market.routePair', 'USDC to USDC')}
                </span>
              </div>
              <div className="mt-3 rounded-xl bg-primary-dim px-4 py-3 font-display text-[20px] font-semibold text-app-text">
                {t('market.sampleRoute', 'OP Sepolia to Polygon Amoy')}
              </div>
            </div>

            <div className="my-4 flex justify-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle bg-surface text-primary">
                <ArrowDown size={18} aria-hidden="true" />
              </span>
            </div>

            <div className="rounded-2xl bg-primary px-4 py-3 text-center font-sans text-sm font-semibold text-btn-primary-text shadow-[0_18px_50px_-34px_var(--primary)]">
              {t('market.marketplaceLabel')}
            </div>

            <div className="my-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {SOLVERS.map((solver, index) => (
                <div
                  key={solver.name}
                  className={cn(
                    'hover-tile rounded-2xl p-3 text-left transition-colors duration-200',
                    solver.winner
                      ? 'bg-mint-soft shadow-[0_0_28px_var(--mint-soft)]'
                      : 'bg-surface-input'
                  )}
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className={cn(
                      'font-sans text-[13px] font-semibold',
                      solver.winner ? 'text-mint' : 'text-text-secondary'
                    )}>
                      {t(`market.solverNames.${index}`, solver.name)}
                    </span>
                    {solver.winner && <Trophy size={15} className="text-mint" aria-hidden="true" />}
                  </div>
                  <div className="font-display text-[24px] font-semibold leading-none text-app-text">
                    {solver.bid}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[11px] text-text-muted">
                    <span>{t('market.feeLabel', 'fee')}</span>
                    <span>{solver.eta}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="rounded-2xl bg-surface-input p-4">
                <div className="mb-2 flex items-center gap-2 font-sans text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                  <Route size={14} className="text-accent-cyan" aria-hidden="true" />
                  {t('market.routeNote')}
                </div>
                <div className="font-sans text-sm text-text-secondary">
                  {t('market.routeDesc', 'Bridge, swap, and settle behind one signature.')}
                </div>
              </div>
              <div className="rounded-2xl bg-primary-dim p-4">
                <div className="mb-2 flex items-center gap-2 font-sans text-[12px] font-semibold uppercase tracking-[0.1em] text-accent-cyan">
                  <Gauge size={14} aria-hidden="true" />
                  {t('market.winner')}
                </div>
                <div className="font-sans text-sm text-text-secondary">
                  {t('market.winnerDesc', 'Best fee and fastest ETA selected automatically.')}
                </div>
              </div>
            </div>
          </div>
        </RevealSection>
      </div>
    </section>
  );
}
