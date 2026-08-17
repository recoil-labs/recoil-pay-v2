import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Clock, Layers3, Network, Route, Wallet, type LucideIcon } from 'lucide-react';
import RevealSection from './RevealSection';

const PAIN_ICONS: LucideIcon[] = [Network, ArrowLeftRight, Wallet, Route, Layers3, Clock];

export default function Problem() {
  const { t } = useTranslation();
  const pains = t('problem.pains', { returnObjects: true }) as string[];

  return (
    <section className="section-shell px-5 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-start gap-10 min-[901px]:grid-cols-[0.82fr_1.18fr] min-[901px]:gap-16">
        <RevealSection>
          <div className="mb-7 h-0.5 w-10 rounded-sm bg-primary shadow-[0_0_14px_var(--primary-dim)]" />
          <span className="section-eyebrow">
            {t('problem.label')}
          </span>
          <h2 className="section-heading mb-5 mt-4 max-w-[520px] text-[clamp(32px,4vw,54px)] tracking-normal">
            {t('problem.h2')}
          </h2>
          <p className="m-0 max-w-[430px] text-base leading-[1.75] text-text-secondary">
            {t('problem.desc')}
          </p>
        </RevealSection>

        <RevealSection delay={120}>
          <div className="grid grid-cols-1 gap-3 min-[581px]:grid-cols-2">
            {pains.map((pain, index) => {
              const Icon = PAIN_ICONS[index % PAIN_ICONS.length];

              return (
                <div
                  key={pain}
                  className="glass-card hover-tile group relative overflow-hidden rounded-2xl p-4 transition-[background,box-shadow,transform] duration-200 hover:bg-red-soft"
                >
                  <div className="absolute right-4 top-4 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted opacity-50">
                    0{index + 1}
                  </div>
                  <div className="flex items-center gap-3 pr-8">
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-red/30 bg-red-soft text-red transition-transform duration-200 group-hover:scale-105">
                      <Icon size={18} aria-hidden="true" />
                    </span>
                    <span className="font-sans text-[15px] font-semibold leading-[1.35] text-text-secondary transition-colors duration-200 group-hover:text-app-text">
                      {pain}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </RevealSection>
      </div>
    </section>
  );
}
