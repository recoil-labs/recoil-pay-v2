import { Suspense, lazy, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import IntentBar from './IntentBar';
import { CHAIN_ALIASES } from '../intent/registry';
import { useSolvers } from '../hooks/useSolvers';
import { CountUp } from './motion/Reveal';

// The particle field pulls in WebGL setup and ~20KB of shader/noise code.
// The intent bar is what people came for and should paint first; the field
// fills in a beat later behind it rather than holding up first render.
const ParticleField = lazy(() => import('./motion/ParticleField'));

/* ── the hero ─────────────────────────────────────────────────────────────
   One very large, light-weight headline with the *action word* typed live
   in an inline chip, a single lede, and the product directly beneath. No
   gradient text, no glass pills, no trust badges.

   The chip is a real typewriter, not a crossfade: characters arrive one at a
   time, the word holds, then erases, then the next one types. The verbs are
   the ones the parser actually accepts, so the animation is naming what the
   input below will take. */

const VERBS = ['swap', 'send', 'bridge', 'pay'] as const;

type Phase = 'typing' | 'holding' | 'erasing' | 'pausing';

function useTypewriter(
  words: readonly string[],
  { type = 95, erase = 48, hold = 1500, pause = 320 } = {},
) {
  const [wordIdx, setWordIdx] = useState(0);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('typing');
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    // Under reduced motion the chip shows the first verb and holds still.
    if (reduced) return;
    const word = words[wordIdx];
    let id: number;

    if (phase === 'typing') {
      id = text.length < word.length
        ? window.setTimeout(() => setText(word.slice(0, text.length + 1)), type)
        : window.setTimeout(() => setPhase('holding'), 0);
    } else if (phase === 'holding') {
      id = window.setTimeout(() => setPhase('erasing'), hold);
    } else if (phase === 'erasing') {
      // Erasing runs faster than typing: the reader has already read it.
      id = text.length > 0
        ? window.setTimeout(() => setText(word.slice(0, text.length - 1)), erase)
        : window.setTimeout(() => setPhase('pausing'), 0);
    } else {
      id = window.setTimeout(() => {
        setWordIdx(i => (i + 1) % words.length);
        setPhase('typing');
      }, pause);
    }

    return () => clearTimeout(id);
  }, [text, phase, wordIdx, words, reduced, type, erase, hold, pause]);

  return { text: reduced ? words[0] : text, reduced, holding: phase === 'holding' };
}

/** Distinct chains the parser will resolve, derived from the registry so
 *  the number can never drift from what the input actually accepts. */
const CHAIN_COUNT = new Set(Object.values(CHAIN_ALIASES).map(c => c.id)).size;

/** Widest verb, so the chip is sized once and the line never reflows while
 *  a word types in or out. */
const LONGEST = Math.max(...VERBS.map(v => v.length));

export default function Hero() {
  const { t } = useTranslation();
  const { text, reduced, holding } = useTypewriter(VERBS);
  const { activeCount: solvers } = useSolvers();

  return (
    <section className="relative isolate overflow-hidden px-5 pb-16 pt-14 sm:px-8 sm:pb-20 sm:pt-20 lg:px-10">
      {/* Blueprint grid on the ground layer, particles above it. The grid
          gives the field something to sit on — alone on flat ground the
          particles read as sparse rather than as spacious. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 [background-image:linear-gradient(var(--grid-line)_1px,transparent_1px),linear-gradient(90deg,var(--grid-line)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(70%_58%_at_50%_36%,#000_0%,transparent_80%)]"
      />
      <div
        className="pointer-events-none absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,#000_60%,transparent_100%)]"
        aria-hidden="true"
      >
        <Suspense fallback={null}>
          <ParticleField className="h-full w-full" />
        </Suspense>
      </div>

      <div className="mx-auto flex max-w-[1100px] flex-col items-center text-center">
        <p className="font-mono text-xs text-primary" style={{ letterSpacing: 'var(--tracking-ui)' }}>
          <span className="opacity-50">/</span>intents
        </p>

        <h1
          className="mt-5 max-w-[24ch] font-sans text-[clamp(36px,6.4vw,76px)] text-app-text"
          style={{
            fontWeight: 'var(--font-heading-weight)' as unknown as number,
            lineHeight: 'var(--leading-hero)',
            letterSpacing: 'var(--tracking-hero)',
          }}
        >
          {t('hero.lead', 'Tell your wallet to')}{' '}
          {/* Left-aligned in a fixed-width slot: a word types from its left
              edge, so centring would shift the whole word on every keystroke.
              The caret only blinks while the word is holding — while typing
              or erasing it stays solid, the way a real cursor behaves. */}
          {/* Bare text, no chip: the word types directly into the sentence
              in the accent colour. The fixed-width slot still reserves the
              widest verb so the rest of the line never reflows. */}
          <span
            className="inline-flex items-baseline align-baseline leading-none text-primary"
            style={{ minWidth: `${LONGEST + 0.6}ch` }}
            aria-live="polite"
            aria-label={text}
          >
            <span>{text}</span>
            {!reduced && (
              <span
                aria-hidden="true"
                className={`ms-[0.06em] inline-block w-[0.06em] self-stretch rounded-sm bg-primary ${holding ? 'hero-caret' : ''}`}
              />
            )}
          </span>{' '}
          {t('hero.tail', 'and it handles the rest')}
        </h1>

        <p
          className="mt-5 max-w-[560px] font-sans text-[clamp(15px,1.3vw,18px)] text-text-secondary"
          style={{ lineHeight: 'var(--leading-body)', letterSpacing: 'var(--tracking-body)' }}
        >
          {t('hero.subtitle', 'Type what you want in plain English. Solvers compete to route it across chains — no bridges to babysit, no gas to juggle.')}
        </p>

        <div className="mt-10 flex w-full justify-center">
          <IntentBar />
        </div>

        {/* Only numbers that can be defended: live solver count from the
            aggregator, chain count from the parser's own registry. */}
        <dl className="mt-8 flex flex-wrap items-baseline justify-center gap-x-10 gap-y-3">
          {solvers !== null && (
            <div className="flex items-baseline gap-2">
              <dt className="sr-only">Solvers online</dt>
              <dd className="font-sans text-2xl tabular-nums text-app-text" style={{ letterSpacing: 'var(--tracking-display)' }}><CountUp to={solvers} /></dd>
              <dd className="font-sans text-xs text-text-muted" style={{ letterSpacing: 'var(--tracking-ui)' }}>solvers online</dd>
            </div>
          )}
          <div className="flex items-baseline gap-2">
            <dt className="sr-only">Chains</dt>
            <dd className="font-sans text-2xl tabular-nums text-app-text" style={{ letterSpacing: 'var(--tracking-display)' }}><CountUp to={CHAIN_COUNT} /></dd>
            <dd className="font-sans text-xs text-text-muted" style={{ letterSpacing: 'var(--tracking-ui)' }}>chains</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="sr-only">Custody</dt>
            <dd className="font-sans text-2xl tabular-nums text-app-text" style={{ letterSpacing: 'var(--tracking-display)' }}>0</dd>
            <dd className="font-sans text-xs text-text-muted" style={{ letterSpacing: 'var(--tracking-ui)' }}>custody</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
