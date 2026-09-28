import { useEffect, useState } from 'react';
import { validateTag } from '../../../shared/tag.ts';
import { api } from '../lib/api.ts';

export type AvailabilityState =
  | { status: 'idle' }
  | { status: 'checking'; tag: string }
  | { status: 'available'; tag: string }
  | { status: 'taken'; tag: string; reserved: boolean; suggestions: string[] }
  | { status: 'invalid'; tag: string; reason: string }
  | { status: 'error'; tag: string; message: string };

export const AVAILABILITY_DEBOUNCE_MS = 350;

/**
 * Resolves a tag 350ms after typing stops. While typing, the state drops to
 * idle so a stale result is never shown against a newer value. `immediate`
 * skips the debounce (the idle demo, suggestion clicks).
 */
export function useAvailability(tag: string, opts: { immediate?: boolean } = {}): AvailabilityState {
  const [state, setState] = useState<AvailabilityState>({ status: 'idle' });

  useEffect(() => {
    if (!tag) {
      setState({ status: 'idle' });
      return;
    }
    setState({ status: 'idle' });
    const ctrl = new AbortController();
    const timer = setTimeout(
      async () => {
        const v = validateTag(tag);
        if (!v.ok) {
          setState({ status: 'invalid', tag, reason: v.reason });
          return;
        }
        setState({ status: 'checking', tag });
        try {
          setState(await api.availability(tag, ctrl.signal));
        } catch (err) {
          if ((err as Error).name === 'AbortError') return;
          setState({ status: 'error', tag, message: (err as Error).message });
        }
      },
      opts.immediate ? 0 : AVAILABILITY_DEBOUNCE_MS,
    );
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [tag, opts.immediate]);

  return state;
}
