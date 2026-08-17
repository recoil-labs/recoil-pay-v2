import { useTranslation } from 'react-i18next';
import { CheckCircle2, Eye, Hammer, PenTool, type LucideIcon } from 'lucide-react';
import RevealSection from './RevealSection';
import { cn } from '@/lib/utils';

interface RoadmapPhase {
  version: string;
  status: string;
  title: string;
  desc: string;
}

type PhaseState = 'completed' | 'current' | 'upcoming';

const CURRENT_PHASE_INDEX = 1;
const PHASE_ICONS: LucideIcon[] = [CheckCircle2, Hammer, PenTool, Eye];

function getPhaseState(index: number): PhaseState {
  if (index < CURRENT_PHASE_INDEX) return 'completed';
  if (index === CURRENT_PHASE_INDEX) return 'current';
  return 'upcoming';
}

function getNodeClass(state: PhaseState): string {
  if (state === 'completed') {
    return 'border-border-cyan bg-accent-cyan text-app-bg shadow-[0_0_22px_var(--border-cyan)]';
  }

  if (state === 'current') {
    return 'animate-node-pulse border-transparent bg-[image:var(--gradient-cta)] text-btn-primary-text shadow-[0_0_34px_var(--primary-dim)] ring-4 ring-[var(--accent-cyan-soft)] motion-reduce:animate-none';
  }

  return 'border-border-subtle bg-surface-input text-text-muted';
}

function getCardClass(state: PhaseState): string {
  if (state === 'current') {
    return 'bg-primary-dim shadow-[0_34px_110px_-62px_var(--primary),0_0_36px_var(--accent-cyan-soft)]';
  }

  if (state === 'completed') {
    return 'bg-surface-glass-strong shadow-[0_24px_90px_-70px_var(--shadow-color)]';
  }

  return 'bg-surface-glass shadow-[0_18px_70px_-62px_var(--shadow-color)] opacity-90';
}

function getTopLineClass(index: number): string {
  if (index === 0) return 'bg-transparent';
  if (index <= CURRENT_PHASE_INDEX) return 'bg-accent-cyan';
  return 'bg-border-subtle';
}

function getBottomLineClass(index: number, phaseCount: number): string {
  if (index === phaseCount - 1) return 'bg-transparent';
  if (index < CURRENT_PHASE_INDEX) return 'bg-accent-cyan';
  if (index === CURRENT_PHASE_INDEX) {
    return 'bg-[linear-gradient(to_bottom,var(--accent-cyan),var(--border-subtle))]';
  }
  return 'bg-border-subtle';
}

export default function Roadmap() {
  const { t } = useTranslation();
  const phases = t('roadmap.phases', { returnObjects: true }) as RoadmapPhase[];

  return (
    <section id="roadmap" className="section-shell border-y border-border bg-section-tint px-5 transition-colors duration-200 sm:px-8 lg:px-10">
      <RevealSection>
        <div className="mx-auto mb-16 max-w-[720px] text-center">
          <span className="section-eyebrow">
            {t('roadmap.label')}
          </span>
          <h2 className="section-heading mt-4 text-[clamp(32px,4vw,54px)] tracking-normal transition-colors duration-200">
            {t('roadmap.h2')}
          </h2>
        </div>
      </RevealSection>

      <div className="relative mx-auto max-w-[1120px]">
        <div className="pointer-events-none absolute bottom-0 left-[21px] top-0 w-px bg-border-subtle md:left-1/2 md:-translate-x-1/2" aria-hidden="true" />

        <div className="flex flex-col">
          {phases.map((phase, index) => {
            const state = getPhaseState(index);
            const Icon = PHASE_ICONS[index % PHASE_ICONS.length];
            const alignLeft = index % 2 === 0;

            return (
              <RevealSection key={phase.version} delay={index * 110}>
                <div className="relative grid min-h-[220px] grid-cols-[44px_minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] md:gap-6">
                  <div className="col-start-1 row-start-1 flex flex-col items-center md:col-start-2">
                    <div className={cn('w-px flex-1', getTopLineClass(index))} aria-hidden="true" />
                    <div className={cn(
                      'relative z-[2] flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border transition-[background,border-color,box-shadow,color,transform] duration-300 md:h-14 md:w-14',
                      getNodeClass(state),
                    )}>
                      {state === 'current' && (
                        <span className="absolute -inset-2 rounded-full border border-border-cyan/60 opacity-70" aria-hidden="true" />
                      )}
                      <Icon size={state === 'current' ? 22 : 19} aria-hidden="true" />
                    </div>
                    <div className={cn('w-px flex-1', getBottomLineClass(index, phases.length))} aria-hidden="true" />
                  </div>

                  <div className={cn(
                    'col-start-2 row-start-1 self-center md:row-start-1',
                    alignLeft ? 'md:col-start-1' : 'md:col-start-3',
                    )}>
                    <div className={cn(
                      'roadmap-phase group relative overflow-hidden rounded-[24px] px-4 py-9 text-left backdrop-blur-xl transition-[box-shadow,transform,background] duration-300 hover:-translate-y-1 sm:px-5 sm:py-10',
                      getCardClass(state),
                    )}>
                      {state === 'current' && (
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--accent-cyan),transparent)]" aria-hidden="true" />
                      )}

                      <div className="min-w-0 mb-6">
                        <div className={cn(
                          'font-display text-[34px] font-semibold leading-none transition-colors duration-200',
                          state === 'upcoming' ? 'text-faint' : 'text-app-text',
                        )}>
                          {phase.version}
                        </div>
                        <h3 className={cn(
                          'mt-4 font-sans text-base font-semibold leading-[1.35] transition-colors duration-200',
                          state === 'upcoming' ? 'text-faint' : 'text-app-text',
                        )}>
                          {phase.title}
                        </h3>
                        <p className="mt-2 max-w-[420px] text-[13.5px] leading-[1.65] text-text-secondary transition-colors duration-200">
                          {phase.desc}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </RevealSection>
            );
          })}
        </div>
      </div>
    </section>
  );
}
