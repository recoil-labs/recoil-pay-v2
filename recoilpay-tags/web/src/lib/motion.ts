import { useReducedMotion, type Transition } from 'framer-motion';

/**
 * The page's whole motion vocabulary. Everything is damped — springs have
 * bounce 0 and nothing overshoots. Under reduced motion every transition
 * collapses to a 120ms fade (see `useMotion`).
 */
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

export const T = {
  /** Section entrance and hairline draws. */
  damped: { type: 'spring', bounce: 0, duration: 0.8 } as Transition,
  /** Availability swap. */
  swap: { duration: 0.16, ease: 'easeOut' } as Transition,
  /** Card height between steps. */
  card: { type: 'spring', bounce: 0, duration: 0.55 } as Transition,
  /** Card content cross-fade. */
  fade: { duration: 0.2, ease: 'easeOut' } as Transition,
  /** Resolution expand in the preview. */
  expand: { duration: 0.42, ease: EASE_OUT } as Transition,
  /** Chip settle: scale 0.96 → 1, no overshoot. */
  settle: { type: 'spring', bounce: 0, duration: 0.5 } as Transition,
  /** Connector draw. */
  draw: { duration: 0.7, ease: EASE_OUT } as Transition,
  /** Success reveal. */
  reveal: { type: 'spring', bounce: 0, duration: 0.5 } as Transition,
  /** Additional route rows opening. */
  row: { duration: 0.3, ease: EASE_OUT } as Transition,
};

export const REDUCED: Transition = { duration: 0.12, ease: 'linear' };

export function useMotion() {
  const reduced = useReducedMotion() ?? false;
  return {
    reduced,
    /** Use the given transition, or the reduced-motion fade. */
    t: (transition: Transition): Transition => (reduced ? REDUCED : transition),
  };
}
