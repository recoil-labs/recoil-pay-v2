import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';

/* ── the page's one motion vocabulary ─────────────────────────────────────
   Every below-the-fold entrance on the site draws from here, so the whole
   page moves with one accent: a short rise on a critically damped spring —
   no bounce, no scale, no blur — with children arriving on a 70ms stagger.
   li.fi and Rubic both do exactly this much and no more, and it is why
   their pages feel alive without feeling animated. */

const SPRING = { type: 'spring', duration: 0.55, bounce: 0 } as const;

export const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

export const item: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: SPRING },
};

/** The hairline a list item sits on, drawn left-to-right as it enters. */
export const hairline: Variants = {
  hidden: { scaleX: 0 },
  show: { scaleX: 1, transition: { type: 'spring', duration: 0.8, bounce: 0 } },
};

export const VIEWPORT = { once: true, margin: '-70px' } as const;

/** One block that rises in when scrolled to. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={VIEWPORT}
      variants={{
        hidden: { opacity: 0, y: 18 },
        show: { opacity: 1, y: 0, transition: { ...SPRING, delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

/** Counts up from zero when it enters the viewport. Numbers that move once
 *  read as measured, not decorative — and under reduced motion or before
 *  hydration it simply shows the value. */
export function CountUp({ to, duration = 900 }: { to: number; duration?: number }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || started) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setStarted(true);
          io.disconnect();
        }
      },
      { rootMargin: '-40px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    if (reduced || to === 0) {
      setValue(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, to, duration, reduced]);

  return (
    <span ref={ref} className="tabular-nums">
      {value}
    </span>
  );
}
