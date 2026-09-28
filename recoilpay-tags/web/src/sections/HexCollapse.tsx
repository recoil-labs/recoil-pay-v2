import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { Eyebrow } from '../components/Reveal.tsx';
import { EASE_OUT, T, useMotion } from '../lib/motion.ts';

const ADDRESS = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
const TAG = '@jasonobb';

/**
 * The pitch in one gesture. The first line is the address as it stays; the
 * second starts as the same address, collapses from both ends toward the
 * centre, and the tag rises into the space it leaves. The end state (address
 * above, tag below, each labelled) says it all with motion off.
 */
export function HexCollapse() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const { reduced, t } = useMotion();
  const done = inView || reduced;

  return (
    <section aria-label="Why a tag" className="border-t border-hairline">
      <div ref={ref} className="mx-auto max-w-[1120px] px-5 py-24 sm:px-8 sm:py-32">
        <Eyebrow>/why</Eyebrow>

        <div className="mt-10 grid gap-10 sm:gap-12">
          <div>
            <p className="mono text-[12px] text-muted">what you send today</p>
            <p className="mono mt-3 break-all text-[clamp(15px,2.3vw,26px)] leading-[1.3] text-secondary">{ADDRESS}</p>
          </div>

          <div>
            <p className="mono text-[12px] text-muted">what you’ll send instead</p>
            {/* Sized by the address, so the tag lands exactly where it was. */}
            <div className="relative mt-3 flex min-h-[clamp(44px,6vw,72px)] max-w-fit items-center">
              <motion.p
                aria-hidden="true"
                className="mono break-all text-[clamp(15px,2.3vw,26px)] leading-[1.3] text-ink"
                initial={{ clipPath: 'inset(0 0% 0 0%)', opacity: reduced ? 0 : 1 }}
                animate={done ? { clipPath: 'inset(0 50% 0 50%)', opacity: 0 } : undefined}
                transition={reduced ? t(T.swap) : { clipPath: { duration: 0.6, ease: EASE_OUT }, opacity: { duration: 0.2, delay: 0.5 } }}
              >
                {ADDRESS}
              </motion.p>
              <motion.p
                className="mono absolute inset-0 flex items-center justify-center text-[clamp(34px,5.4vw,62px)] leading-none tracking-[-0.02em] text-ink"
                initial={{ opacity: 0, y: reduced ? 0 : 10 }}
                animate={done ? { opacity: 1, y: 0 } : undefined}
                transition={reduced ? t(T.swap) : { ...T.damped, delay: 0.42 }}
              >
                {TAG}
              </motion.p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
