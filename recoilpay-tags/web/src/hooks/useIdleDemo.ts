import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import type { AvailabilityState } from './useAvailability.ts';

// Real lookups, not a script: if one of these gets reserved the demo says so.
const AVAILABLE_SAMPLES = ['tolu', 'amara', 'kwame', 'jasonobb', 'lena_eth', 'mei', 'diego', 'ngozi'];
// Held-back names, so the one-in-four "taken" cycle is genuinely taken.
const TAKEN_SAMPLES = ['satoshi', 'vitalik'];

const TYPE_MS = 95;
const ERASE_MS = 48;
const HOLD_MS = 1500;
const BETWEEN_MS = 320;
const START_DELAY_MS = 900;
/** Long enough for the checking bar to read as a check, not a flicker. */
const MIN_CHECK_MS = 450;

export type DemoPhase = 'idle' | 'typing' | 'holding' | 'erasing';

/**
 * Types sample tags into the untouched claim field, resolves them for real,
 * holds, erases, and cycles. One cycle in four resolves as taken. Turning
 * `enabled` off aborts on the spot — the caller does that on any keypress,
 * pointer-down or user focus.
 */
export function useIdleDemo(enabled: boolean) {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<DemoPhase>('idle');
  const [result, setResult] = useState<AvailabilityState>({ status: 'idle' });

  useEffect(() => {
    if (!enabled) {
      setText('');
      setPhase('idle');
      setResult({ status: 'idle' });
      return;
    }
    const ctrl = new AbortController();
    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const id = setTimeout(resolve, ms);
        ctrl.signal.addEventListener('abort', () => (clearTimeout(id), reject(new DOMException('aborted', 'AbortError'))), { once: true });
      });

    (async () => {
      await sleep(START_DELAY_MS);
      for (let cycle = 0, a = 0, t = 0; ; cycle++) {
        const sample = cycle % 4 === 3 ? TAKEN_SAMPLES[t++ % TAKEN_SAMPLES.length] : AVAILABLE_SAMPLES[a++ % AVAILABLE_SAMPLES.length];

        setPhase('typing');
        for (let i = 1; i <= sample.length; i++) {
          setText(sample.slice(0, i));
          await sleep(TYPE_MS);
        }

        setResult({ status: 'checking', tag: sample });
        const [res] = await Promise.all([api.availability(sample, ctrl.signal).catch((e) => (ctrl.signal.aborted ? Promise.reject(e) : null)), sleep(MIN_CHECK_MS)]);
        setResult(res ?? { status: 'idle' });
        setPhase('holding');
        await sleep(HOLD_MS);

        setResult({ status: 'idle' });
        setPhase('erasing');
        for (let i = sample.length - 1; i >= 0; i--) {
          setText(sample.slice(0, i));
          await sleep(ERASE_MS);
        }
        setPhase('idle');
        await sleep(BETWEEN_MS);
      }
    })().catch(() => {});

    return () => ctrl.abort();
  }, [enabled]);

  return { text, phase, result };
}
