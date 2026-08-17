import { useTranslation } from 'react-i18next';
import { Cloud, Network, Search, Sparkles, type LucideIcon } from 'lucide-react';
import RevealSection from './RevealSection';
import { cn } from '@/lib/utils';

const VISION_ICONS: LucideIcon[] = [Search, Cloud, Network];

function getPillars(tagline: string, highlight: string): string[] {
  const normalized = tagline.replace(/\u00c2?\u00b7/g, '|');
  const parts = normalized
    .split(/[|/]/)
    .map(part => part.trim())
    .filter(Boolean);

  return [...parts.slice(0, 2), highlight].filter(Boolean);
}

export default function Vision() {
  const { t } = useTranslation();
  const pillars = getPillars(t('vision.tagline'), t('vision.taglineHighlight'));

  return (
    <section id="vision" className="section-shell relative overflow-hidden px-5 sm:px-8 lg:px-10">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[min(900px,110vw)] -translate-x-1/2 -translate-y-1/2 rounded-full [background:radial-gradient(ellipse,var(--primary-dim)_0%,transparent_70%)]" />

      <RevealSection className="relative">
        <div className="mx-auto max-w-[960px] text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border-cyan bg-surface-glass px-3.5 py-2 font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-cyan backdrop-blur-xl">
            <Sparkles size={14} aria-hidden="true" />
            {t('vision.label')}
          </span>

          <h2 className="section-heading mx-auto mb-10 mt-6 max-w-[860px] text-[clamp(38px,5.4vw,72px)] leading-[1.02] tracking-normal">
            {t('vision.h2')}
          </h2>

          <div className="mb-10 h-px w-full bg-[linear-gradient(90deg,transparent,var(--border-blue)_50%,transparent)]" />

          <div className="grid grid-cols-1 gap-4 text-left min-[901px]:grid-cols-3">
            {pillars.map((text, index) => {
              const Icon = VISION_ICONS[index % VISION_ICONS.length];
              const highlight = index === pillars.length - 1;

              return (
                <div
                  key={text}
                  className={cn(
                    'rounded-[22px] p-5 backdrop-blur-xl',
                    highlight
                      ? 'bg-primary-dim shadow-[0_0_42px_var(--accent-cyan-soft)]'
                      : 'glass-card'
                  )}
                >
                  <div className={cn(
                    'mb-5 flex h-10 w-10 items-center justify-center rounded-xl border',
                    highlight ? 'border-border-cyan bg-surface-glass text-accent-cyan' : 'border-border-subtle bg-surface-input text-text-muted'
                  )}>
                    <Icon size={18} aria-hidden="true" />
                  </div>
                  <p className={cn(
                    'm-0 font-sans text-[15px] leading-[1.65]',
                    highlight ? 'font-semibold text-app-text' : 'font-medium text-text-secondary'
                  )}>
                    {text}
                  </p>
                </div>
              );
            })}
          </div>

          <p className="mx-auto mt-10 max-w-[620px] text-base leading-[1.75] text-text-secondary">
            {t('vision.desc')}
          </p>
        </div>
      </RevealSection>
    </section>
  );
}
