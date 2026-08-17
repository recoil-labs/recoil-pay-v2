import { useTranslation } from 'react-i18next';
import { Activity, BadgeCheck, Layers3, ShieldCheck, Sparkles } from 'lucide-react';
import IntentBar from './IntentBar';
import pattern from '../assets/pattern.png';

const TRUST_ICONS = [ShieldCheck, Layers3, Activity];
const FALLBACK_TRUST_MARKERS = [
  'Non-custodial execution',
  'Cross-chain routing',
  'Solver price discovery',
];

const HERO_METRIC_VALUES = [
  { value: '12+', fallbackLabel: 'Chains indexed' },
  { value: '<50ms', fallbackLabel: 'Intent parse' },
  { value: '8+', fallbackLabel: 'Solvers per route' },
];

export default function Hero() {
  const { t } = useTranslation();
  const translatedTrustMarkers = t('hero.trustMarkers', { returnObjects: true }) as unknown;
  const translatedMetricLabels = t('hero.metrics', { returnObjects: true }) as unknown;
  const trustMarkers = Array.isArray(translatedTrustMarkers) ? translatedTrustMarkers : FALLBACK_TRUST_MARKERS;
  const metricLabels = Array.isArray(translatedMetricLabels) ? translatedMetricLabels : [];

  return (
    <section className="relative isolate overflow-hidden px-5 pb-20 pt-12 sm:px-8 sm:pb-24 sm:pt-16 lg:px-10 lg:pb-28">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-0 [background-image:linear-gradient(var(--grid-line)_1px,transparent_1px),linear-gradient(90deg,var(--grid-line)_1px,transparent_1px)] [background-size:64px_64px] [-webkit-mask-image:radial-gradient(72%_60%_at_50%_38%,#000_0%,transparent_78%)] [mask-image:radial-gradient(72%_60%_at_50%_38%,#000_0%,transparent_78%)]" />
        <div
          className="absolute left-1/2 top-0 aspect-[2880/2580] w-[1500px] max-w-[150%] -translate-x-1/2 bg-contain bg-top bg-no-repeat opacity-[0.08] [-webkit-mask-image:linear-gradient(to_bottom,#000_0%,rgba(0,0,0,0.38)_36%,transparent_66%)] [mask-image:linear-gradient(to_bottom,#000_0%,rgba(0,0,0,0.38)_36%,transparent_66%)]"
          style={{ backgroundImage: `url(${pattern})` }}
        />
        <div className="absolute left-1/2 top-[34%] h-[720px] w-[min(1120px,120vw)] -translate-x-1/2 -translate-y-1/2 rounded-full [background:radial-gradient(46%_52%_at_50%_44%,var(--primary-dim),transparent_70%),radial-gradient(38%_30%_at_50%_30%,var(--accent-cyan-soft),transparent_72%)]" />
      </div>

      <div className="mx-auto flex max-w-[1160px] flex-col items-center text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border-cyan bg-surface-glass px-3.5 py-2 font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-cyan shadow-[0_18px_60px_-44px_var(--shadow-color)] backdrop-blur-xl">
          <Sparkles size={14} aria-hidden="true" />
          {t('hero.eyebrow')}
        </div>

        <h1 className="mt-7 max-w-[950px] font-display text-[clamp(42px,7vw,82px)] font-bold leading-[0.98] tracking-normal text-app-text">
          {t('hero.h1Line1')} {t('hero.h1Line2')}
          <span className="mt-2 block bg-[image:var(--gradient-text)] bg-clip-text text-transparent [-webkit-text-fill-color:transparent]">
            {t('hero.h1Gradient')}
          </span>
        </h1>

        <p className="mt-6 max-w-[660px] font-sans text-[clamp(16px,1.5vw,19px)] leading-[1.7] text-text-secondary">
          {t('hero.subtitle')}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
          {TRUST_ICONS.map((Icon, index) => {
            const label = typeof trustMarkers[index] === 'string'
              ? trustMarkers[index]
              : FALLBACK_TRUST_MARKERS[index];

            return (
              <span
                key={label}
                className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-glass px-3 py-2 font-sans text-xs font-semibold text-text-secondary backdrop-blur-xl"
              >
                <Icon size={14} className="text-accent-cyan" aria-hidden="true" />
                {label}
              </span>
            );
          })}
        </div>

        <div className="mt-10 flex w-full justify-center">
          <IntentBar />
        </div>

        <div className="glass-card mt-8 grid w-full max-w-[760px] grid-cols-1 overflow-hidden rounded-2xl sm:grid-cols-3">
          {HERO_METRIC_VALUES.map((metric, index) => (
            <div
              key={metric.value}
              className="border-b border-border-subtle px-5 py-4 text-left last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
            >
              <div className="font-display text-[24px] font-semibold leading-none text-app-text">
                {metric.value}
              </div>
              <div className="mt-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                {typeof metricLabels[index] === 'string' ? metricLabels[index] : metric.fallbackLabel}
              </div>
              {index === 1 && (
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-alt">
                  <div className="h-full w-4/5 rounded-full bg-[image:var(--gradient-cta)]" />
                </div>
              )}
            </div>
          ))}
        </div>

        <p className="mt-7 inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-glass px-3.5 py-2 font-sans text-[13px] text-text-muted backdrop-blur-xl">
          <BadgeCheck size={15} className="text-accent-cyan" aria-hidden="true" />
          {t('hero.trustLine')}
        </p>
      </div>
    </section>
  );
}
