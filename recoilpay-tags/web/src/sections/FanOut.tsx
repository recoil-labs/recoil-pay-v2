import { AnimatePresence, motion, useInView } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Eyebrow, Reveal } from '../components/Reveal.tsx';
import { EASE_OUT, T, useMotion } from '../lib/motion.ts';

const DESTINATIONS = [
  { token: 'ETH', chain: 'Ethereum', address: '0x71C7…976F' },
  { token: 'USDC', chain: 'Base', address: '0x9aE2…41bd' },
  { token: 'USDC', chain: 'Arbitrum', address: '0x9aE2…41bd' },
  { token: 'USDC', chain: 'Polygon', address: '0x71C7…976F' },
  { token: 'ETH', chain: 'Base', address: '0x71C7…976F' },
];

// Connector geometry, in the SVG's own units. Cards are CARD_H tall with GAP
// between them; the SVG is stretched to the card column's height.
const CARD_H = 56;
const GAP = 12;
const H = DESTINATIONS.length * CARD_H + (DESTINATIONS.length - 1) * GAP;
const W = 240;
const yOf = (i: number) => CARD_H / 2 + i * (CARD_H + GAP);
const pathOf = (i: number) => `M0 ${H / 2} C${W * 0.5} ${H / 2}, ${W * 0.5} ${yOf(i)}, ${W} ${yOf(i)}`;

const CHIP_AT = 0;
const DRAW_AT = 0.35;
const STAGGER = 0.08;
const LOOP_MS = 4000;
/** The static state under reduced motion: USDC on Base, a different address. */
const STATIC_CHOSEN = 1;

export function FanOut() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const { reduced, t } = useMotion();
  const [looping, setLooping] = useState(false);
  const [paused, setPaused] = useState(false);
  const [chosen, setChosen] = useState(STATIC_CHOSEN);

  const shown = inView || reduced;

  // The travel loop starts once the entrance has landed.
  useEffect(() => {
    if (!inView || reduced) return;
    const id = setTimeout(() => setLooping(true), (DRAW_AT + STAGGER * DESTINATIONS.length + 0.9) * 1000);
    return () => clearTimeout(id);
  }, [inView, reduced]);

  useEffect(() => {
    if (!looping || paused || reduced) return;
    const id = setInterval(() => setChosen((c) => (c + 1) % DESTINATIONS.length), LOOP_MS);
    return () => clearInterval(id);
  }, [looping, paused, reduced]);

  const active = looping || reduced ? chosen : -1;
  const d = DESTINATIONS[chosen];

  return (
    <section aria-label="One tag, every token" className="border-t border-hairline">
      <Reveal as="div" className="mx-auto max-w-[1120px] px-5 py-24 sm:px-8 sm:py-32">
        <Reveal.Item>
          <Eyebrow>/one-tag</Eyebrow>
        </Reveal.Item>
        <Reveal.Item>
          <h2 className="heading mt-5 max-w-[18ch] text-[clamp(30px,4vw,48px)]">One tag, every token.</h2>
        </Reveal.Item>
        <Reveal.Item>
          <p className="mt-5 max-w-[52ch] text-[16px] text-secondary">
            Map each token and chain to the address you want it in. Whoever pays you just types your tag — the right address is chosen for them.
          </p>
        </Reveal.Item>

        <div
          ref={ref}
          className="mt-14 grid items-center gap-8 md:grid-cols-[minmax(180px,1fr)_minmax(120px,240px)_minmax(280px,340px)] md:gap-0"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {/* The chip, and what's being sent right now. */}
          <div className="flex flex-col items-start gap-3 md:items-end md:pr-4">
            <motion.div
              className="mono rounded-md border border-hairline bg-raised px-4 py-3 text-[18px] text-ink"
              initial={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.96 }}
              animate={shown ? { opacity: 1, y: 0, scale: 1 } : undefined}
              transition={reduced ? t(T.settle) : { ...T.settle, delay: CHIP_AT }}
            >
              @jasonobb
            </motion.div>
            <div className="mono h-5 text-[12px] text-muted" aria-live="off">
              <AnimatePresence mode="wait" initial={false}>
                {active >= 0 && (
                  <motion.span
                    key={chosen}
                    className="block"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={t(T.swap)}
                  >
                    sending {d.token} on {d.chain}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Connectors — desktop only; on narrow screens the list reads top-down. */}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="hidden w-full md:block"
            style={{ height: H }}
            aria-hidden="true"
          >
            {DESTINATIONS.map((_, i) => (
              <motion.path
                key={i}
                d={pathOf(i)}
                fill="none"
                stroke="var(--color-hairline)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                initial={{ pathLength: reduced ? 1 : 0 }}
                animate={shown ? { pathLength: 1 } : undefined}
                transition={reduced ? { duration: 0 } : { ...T.draw, delay: DRAW_AT + i * STAGGER }}
              />
            ))}
            {active >= 0 &&
              (reduced ? (
                <path d={pathOf(active)} fill="none" stroke="var(--color-accent)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ) : (
                <motion.path
                  key={active}
                  d={pathOf(active)}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={1.25}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  initial={{ pathLength: 0.2, pathOffset: 0, opacity: 0 }}
                  animate={{ pathLength: 1, pathOffset: 0, opacity: [0, 1, 1] }}
                  transition={{ duration: 1.1, ease: EASE_OUT }}
                />
              ))}
          </svg>

          <ul className="flex flex-col border-l border-hairline pl-4 md:border-l-0 md:pl-0" style={{ gap: GAP }}>
            {DESTINATIONS.map((dest, i) => {
              const isChosen = i === active;
              return (
                <motion.li
                  key={i}
                  className={`flex items-center justify-between gap-4 rounded-md border bg-surface px-4 transition-colors duration-500 ${
                    isChosen ? 'border-accent/60' : 'border-hairline'
                  }`}
                  style={{ height: CARD_H }}
                  initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                  animate={shown ? { opacity: 1, y: 0 } : undefined}
                  transition={reduced ? t(T.swap) : { ...T.damped, delay: DRAW_AT + i * STAGGER + 0.55 }}
                >
                  <span className="text-[14px] text-ink">
                    {dest.token} <span className="text-muted">on {dest.chain}</span>
                  </span>
                  <span className={`mono text-[13px] transition-colors duration-500 ${isChosen ? 'text-accent' : 'text-secondary'}`}>
                    → {dest.address}
                  </span>
                </motion.li>
              );
            })}
          </ul>
        </div>
      </Reveal>
    </section>
  );
}
