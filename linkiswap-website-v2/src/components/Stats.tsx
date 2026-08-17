import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Network, Sparkles, Timer, TrendingUp, type LucideIcon } from 'lucide-react';
import RevealSection from './RevealSection';

interface StatData {
  prefix: string;
  target: number;
  suffix: string;
  decimals: number;
  icon: LucideIcon;
  key: string;
}

const STATS_DATA: StatData[] = [
  { prefix: '$', target: 1.4, suffix: 'B+', decimals: 1, icon: TrendingUp, key: 'volume' },
  { prefix: '', target: 14, suffix: '', decimals: 0, icon: Network, key: 'chains' },
  { prefix: '<', target: 50, suffix: 'ms', decimals: 0, icon: Timer, key: 'settlement' },
  { prefix: '', target: 8, suffix: '+', decimals: 0, icon: Sparkles, key: 'solvers' },
];

function useCountUp(target: number, decimals: number, duration: number, triggered: boolean) {
  const [value, setValue] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!triggered) return;
    setFinished(false);
    const startTime = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(parseFloat((target * eased).toFixed(decimals)));
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        setValue(target);
        setFinished(true);
      }
    };
    requestAnimationFrame(tick);
  }, [triggered, target, decimals, duration]);

  return { value, finished };
}

function StatCard({
  prefix,
  target,
  suffix,
  decimals,
  icon: Icon,
  label,
  delay,
}: Omit<StatData, 'key'> & { label: string; delay: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [triggered, setTriggered] = useState(false);
  const { value, finished } = useCountUp(target, decimals, 1800, triggered);
  const [showRing, setShowRing] = useState(false);
  const display = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();
  const { t } = useTranslation();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setTriggered(true);
        obs.disconnect();
      }
    }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!finished) return;
    setShowRing(true);
    const id = setTimeout(() => setShowRing(false), 950);
    return () => clearTimeout(id);
  }, [finished]);

  return (
    <RevealSection delay={delay}>
      <div
        ref={ref}
        className="glass-panel stat-card group relative flex min-h-[220px] flex-col justify-between overflow-hidden rounded-[22px] p-6 text-left"
      >
        <div className="stat-card__bar absolute left-[18%] right-[18%] top-0 h-px bg-[linear-gradient(90deg,transparent,var(--accent-cyan),transparent)] opacity-70" />

        <div className="flex items-start justify-between gap-4">
          <div className="stat-card__glyph relative flex h-12 w-12 items-center justify-center rounded-2xl border border-border-blue bg-primary-dim text-text-muted">
            <Icon size={22} aria-hidden="true" />
            {showRing && (
              <div className="pointer-events-none absolute inset-[-6px] rounded-full border border-border-cyan animate-stat-glow motion-reduce:animate-none" />
            )}
          </div>
          <span className="rounded-full border border-border-subtle bg-surface-input px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">
            {t('stats.live', 'Live')}
          </span>
        </div>

        <div>
          <div className="gradient-text stat-card__number font-display text-[clamp(34px,4vw,54px)] font-semibold leading-none">
            {prefix}{display}{suffix}
          </div>
          <div className="mt-3 font-sans text-[11px] font-semibold uppercase leading-[1.4] tracking-[0.14em] text-text-secondary">
            {label}
          </div>
        </div>
      </div>
    </RevealSection>
  );
}

export default function Stats() {
  const { t } = useTranslation();
  const labels = [t('stats.volume'), t('stats.chains'), t('stats.settlement'), t('stats.solvers')];

  return (
    <section className="border-y border-border-subtle px-5 py-16 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-3 sm:gap-[18px] min-[901px]:grid-cols-4">
        {STATS_DATA.map((stat, index) => (
          <StatCard
            key={stat.key}
            prefix={stat.prefix}
            target={stat.target}
            suffix={stat.suffix}
            decimals={stat.decimals}
            icon={stat.icon}
            label={labels[index]}
            delay={index * 90}
          />
        ))}
      </div>
    </section>
  );
}
