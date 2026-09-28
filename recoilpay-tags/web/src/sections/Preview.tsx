import { AnimatePresence, motion, useInView } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Check } from '../components/Check.tsx';
import { Eyebrow, Reveal } from '../components/Reveal.tsx';
import { T, useMotion } from '../lib/motion.ts';

const SENDS = [
  { amount: '25', token: 'USDC', address: '0x9aE2…41bd', route: 'USDC on Base' },
  { amount: '0.5', token: 'ETH', address: '0x71C7…976F', route: 'ETH on Ethereum' },
];
const CYCLE_MS = 3600;

/**
 * A mock of the future send, not an input. Same tag, two tokens, two
 * different addresses — that contrast is the whole concept. It is inert on
 * purpose: no cursor, no focus, no hover, hidden from the tab order.
 */
export function Preview() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.5 });
  const { reduced, t } = useMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!inView || reduced) return;
    const id = setInterval(() => setI((n) => (n + 1) % SENDS.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [inView, reduced]);

  const shownSends = reduced ? SENDS : [SENDS[i]];

  return (
    <section aria-label="Preview of sending to a tag" className="border-t border-hairline">
      <Reveal as="div" className="mx-auto max-w-[1120px] px-5 py-24 sm:px-8 sm:py-32">
        <Reveal.Item>
          <Eyebrow>/preview</Eyebrow>
        </Reveal.Item>
        <Reveal.Item>
          <h2 className="heading mt-5 max-w-[20ch] text-[clamp(30px,4vw,48px)]">What your tag becomes.</h2>
        </Reveal.Item>
        <Reveal.Item>
          <p className="mt-5 max-w-[52ch] text-[16px] text-secondary">
            Send isn’t live yet. When it is, paying you looks like this — and the same tag lands in a different wallet depending on what’s sent.
          </p>
        </Reveal.Item>

        <Reveal.Item className="mt-12 max-w-[640px]">
          <div
            ref={ref}
            aria-hidden="true"
            // React 18 has no typed `inert`; the empty string sets the attribute.
            {...{ inert: '' }}
            className="pointer-events-none relative cursor-default select-none rounded-lg border border-hairline bg-[color-mix(in_srgb,var(--color-ground)_78%,black)] p-2"
          >
            <span className="mono absolute -top-2.5 right-4 rounded-sm border border-hairline bg-ground px-1.5 text-[11px] leading-[18px] text-muted">
              preview
            </span>
            <div className="flex flex-col gap-2">
              {shownSends.map((s) => (
                <div key={reduced ? s.token : 'row'} className="rounded-md border border-hairline/70 bg-surface/60 px-5 py-4">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={s.token} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t(T.fade)}>
                      <p className="mono text-[clamp(16px,2.2vw,20px)] text-ink">
                        <span className="text-muted">send</span> {s.amount} {s.token} <span className="text-muted">to</span> @jasonobb
                      </p>
                      <Resolution key={`${s.token}-${inView}`} address={s.address} route={s.route} />
                    </motion.div>
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </div>
        </Reveal.Item>
      </Reveal>
    </section>
  );
}

/** The resolved address opening beneath the send line. */
function Resolution({ address, route }: { address: string; route: string }) {
  const { reduced, t } = useMotion();
  return (
    <motion.div
      className="overflow-hidden"
      initial={{ height: reduced ? 'auto' : 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      transition={reduced ? t(T.expand) : { ...T.expand, delay: 0.5 }}
    >
      <p className="mono flex items-center gap-2 pt-3 text-[13px] text-secondary">
        <span className="text-success">
          <Check size={13} delay={0.8} />
        </span>
        <span className="text-muted">to</span> → {address} <span className="text-muted">·</span> {route}
      </p>
    </motion.div>
  );
}
