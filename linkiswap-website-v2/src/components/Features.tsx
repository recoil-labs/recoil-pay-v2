import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Gift, Landmark, Send, Sparkles, Wallet, type LucideIcon } from 'lucide-react';
import RevealSection from './RevealSection';

const FEATURE_ICONS: LucideIcon[] = [ArrowLeftRight, Send, Wallet, Landmark, Gift, Sparkles];

export default function Features() {
  const { t } = useTranslation();
  const items = t('features.items', { returnObjects: true }) as { title: string; desc: string }[];

  return (
    <section id="features" className="section-shell border-y border-border bg-section-tint px-5 sm:px-8 lg:px-10">
      <RevealSection>
        <div className="mx-auto mb-14 max-w-[720px] text-center">
          <span className="section-eyebrow">
            {t('features.label')}
          </span>
          <h2 className="section-heading mt-4 text-[clamp(32px,4vw,54px)] tracking-normal">
            {t('features.h2')}
          </h2>
        </div>
      </RevealSection>

      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-4 min-[581px]:grid-cols-2 min-[901px]:grid-cols-3">
        {items.map((item, index) => {
          const Icon = FEATURE_ICONS[index % FEATURE_ICONS.length];

          return (
            <RevealSection key={item.title} delay={index * 80}>
              <div className="glass-panel group flex min-h-[230px] flex-col justify-between overflow-hidden rounded-[22px] p-6 transition-[box-shadow,transform,background] duration-300 hover:-translate-y-1 hover:shadow-[0_28px_100px_-70px_var(--primary)]">
                <div>
                  <div className="mb-6 flex items-center justify-between gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border-blue bg-primary-dim text-text-muted transition-[background,border-color,color,transform] duration-300 group-hover:scale-105 group-hover:border-border-cyan group-hover:text-accent-cyan">
                      <Icon size={21} aria-hidden="true" />
                    </div>
                    <span className="font-mono text-[11px] font-semibold text-text-muted opacity-60">
                      0{index + 1}
                    </span>
                  </div>
                  <div className="font-display text-[21px] font-semibold leading-[1.15] text-app-text">
                    {item.title}
                  </div>
                  <div className="mt-3 text-sm leading-[1.7] text-text-secondary">
                    {item.desc}
                  </div>
                </div>

                <div className="mt-8 h-px w-full bg-[linear-gradient(90deg,var(--border-cyan),transparent)] opacity-70" />
              </div>
            </RevealSection>
          );
        })}
      </div>
    </section>
  );
}
