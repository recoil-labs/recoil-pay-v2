import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, Sparkles, X } from 'lucide-react';
import RevealSection from './RevealSection';

export default function Solution() {
  const { t } = useTranslation();
  const before = t('solution.before', { returnObjects: true }) as string[];
  const after = t('solution.after', { returnObjects: true }) as string[];

  return (
    <section className="section-shell px-5 sm:px-8 lg:px-10">
      <RevealSection>
        <div className="mx-auto mb-14 max-w-[760px] text-center">
          <span className="section-eyebrow">
            {t('solution.label')}
          </span>
          <h2 className="section-heading mx-auto mt-4 max-w-[740px] text-[clamp(32px,4.5vw,58px)] tracking-normal">
            {t('solution.h2Line1')} {t('solution.h2Line2')}
          </h2>
        </div>
      </RevealSection>

      <RevealSection delay={80}>
        <div className="mx-auto grid max-w-[1120px] grid-cols-1 items-stretch gap-4 min-[901px]:grid-cols-[1fr_auto_1fr] min-[901px]:gap-6">
          <div className="glass-panel hover-card overflow-hidden rounded-[22px] p-5">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                  {t('solution.beforeLabel')}
                </div>
                <div className="mt-1 font-display text-xl font-semibold text-app-text">
                  {t('solution.manualPathing', 'Manual pathing')}
                </div>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-red/30 bg-red-soft text-red">
                <X size={18} aria-hidden="true" />
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {before.map((step, index) => (
                <div
                  key={step}
                  className="flex items-center gap-3 rounded-xl bg-surface-input px-3.5 py-3 font-sans text-[13.5px] text-faint line-through decoration-red/50"
                >
                  <span className="font-mono text-[11px] text-text-muted">0{index + 1}</span>
                  {step}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center py-2 min-[901px]:py-0">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border-cyan bg-primary-dim text-primary shadow-[0_0_28px_var(--primary-dim)]">
              <ArrowRight size={20} aria-hidden="true" />
            </span>
          </div>

          <div className="hover-card overflow-hidden rounded-[22px] border border-border-cyan bg-primary-dim p-5 shadow-[0_30px_100px_-70px_var(--primary)] backdrop-blur-xl">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-cyan">
                  {t('solution.afterLabel')}
                </div>
                <div className="mt-1 font-display text-xl font-semibold text-app-text">
                  {t('solution.outcomeRouting', 'Outcome routing')}
                </div>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border-cyan bg-surface-glass text-accent-cyan">
                <Sparkles size={18} aria-hidden="true" />
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {after.map(step => (
                <div
                  key={step}
                  className="flex items-center gap-3 rounded-xl bg-surface-glass-strong px-3.5 py-3 font-sans text-[13.5px] font-semibold text-app-text"
                >
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-mint-soft text-mint">
                    <Check size={13} aria-hidden="true" />
                  </span>
                  {step}
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl bg-surface-glass px-4 py-3 font-sans text-xs leading-[1.55] text-text-secondary">
              {t('solution.note')}
            </div>
          </div>
        </div>
      </RevealSection>
    </section>
  );
}
