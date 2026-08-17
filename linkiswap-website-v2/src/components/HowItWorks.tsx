import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, PenLine, Search, Zap, type LucideIcon } from 'lucide-react';
import RevealSection from './RevealSection';
import { cn } from '@/lib/utils';

const STEP_ICONS: LucideIcon[] = [PenLine, Search, Zap, CheckCircle2];

export default function HowItWorks() {
  const { t } = useTranslation();
  const steps = t('how.steps', { returnObjects: true }) as { title: string; desc: string }[];
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    if (steps.length === 0) return;
    const id = setInterval(() => setActiveStep(step => (step + 1) % steps.length), 2400);
    return () => clearInterval(id);
  }, [steps.length]);

  return (
    <section id="how" className="section-shell border-y border-border bg-section-tint px-5 sm:px-8 lg:px-10">
      <RevealSection>
        <div className="mx-auto mb-16 max-w-[720px] text-center">
          <span className="section-eyebrow">
            {t('how.label')}
          </span>
          <h2 className="section-heading mt-4 text-[clamp(32px,4vw,54px)] tracking-normal">
            {t('how.h2')}
          </h2>
        </div>
      </RevealSection>

      <div className="relative mx-auto grid max-w-[1200px] grid-cols-1 gap-5 min-[581px]:grid-cols-2 min-[901px]:grid-cols-4 min-[901px]:gap-4 min-[901px]:before:absolute min-[901px]:before:left-[calc(12.5%+4px)] min-[901px]:before:right-[calc(12.5%+4px)] min-[901px]:before:top-[31px] min-[901px]:before:h-px min-[901px]:before:bg-[linear-gradient(90deg,var(--primary-dim),var(--border-cyan)_30%,var(--border-cyan)_70%,var(--primary-dim))] min-[901px]:before:content-['']">
        <div className="pointer-events-none absolute left-[calc(12.5%+4px)] right-[calc(12.5%+4px)] top-[29px] z-[2] hidden h-[5px] overflow-hidden min-[901px]:block">
          <div className="absolute top-0 h-full w-[28%] animate-timeline-scan bg-[linear-gradient(90deg,transparent,var(--accent-cyan),transparent)] motion-reduce:hidden" />
        </div>

        {steps.map((step, index) => {
          const isActive = index === activeStep;
          const Icon = STEP_ICONS[index % STEP_ICONS.length];
          const stepNumber = String(index + 1).padStart(2, '0');

          return (
            <RevealSection key={step.title} delay={index * 110}>
              <button
                type="button"
                onClick={() => setActiveStep(index)}
                className={cn(
                  'group flex h-full w-full cursor-pointer flex-col items-center rounded-[22px] p-5 text-center transition-[background,transform,box-shadow] duration-300 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/70',
                  isActive
                    ? 'glass-panel'
                    : 'glass-card'
                )}
              >
                <div className={cn(
                  'relative z-[3] mb-5 flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full border transition-[background,border-color,box-shadow,color] duration-300',
                  isActive
                    ? 'animate-node-pulse border-transparent bg-[image:var(--gradient-cta)] text-btn-primary-text motion-reduce:animate-none'
                    : 'border-border-cyan bg-surface text-text-muted'
                )}>
                  <Icon size={20} aria-hidden="true" />
                </div>

                <div className={cn(
                  'mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors duration-300',
                  isActive ? 'text-accent-cyan' : 'text-text-muted'
                )}>
                  {t('how.stepLabel', { number: stepNumber, defaultValue: `Step ${stepNumber}` })}
                </div>
                <div className={cn(
                  'mb-2.5 font-display text-lg font-semibold leading-[1.2] transition-colors duration-300',
                  isActive ? 'text-app-text' : 'text-faint'
                )}>
                  {step.title}
                </div>
                <div className={cn(
                  'text-sm leading-[1.6] transition-colors duration-300',
                  isActive ? 'text-text-secondary' : 'text-faint-2'
                )}>
                  {step.desc}
                </div>
              </button>
            </RevealSection>
          );
        })}
      </div>

    </section>
  );
}
