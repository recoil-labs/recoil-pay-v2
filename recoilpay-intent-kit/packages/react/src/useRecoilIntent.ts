import { createIntentSession, type IntentSession, type IntentState, type IntentWallet } from '@recoilpay/intent-core';
import { useEffect, useState, useSyncExternalStore } from 'react';

export interface UseRecoilIntentOptions {
  /** Aggregator base URL. Defaults to production. Read once, on first render. */
  apiUrl?: string;
  /** Bring your own session (shared across components, or for tests). */
  session?: IntentSession;
  /** The connected wallet, or null. Changes are passed straight to the session. */
  wallet?: IntentWallet | null;
}

export interface UseRecoilIntent extends IntentState {
  run: (text: string) => Promise<void>;
  confirm: () => Promise<void>;
  reset: () => void;
  session: IntentSession;
}

/**
 * The intent flow as React state. Renders nothing: build your own UI on it,
 * or use `<RecoilIntent />`, which is built on this.
 */
export function useRecoilIntent(options: UseRecoilIntentOptions = {}): UseRecoilIntent {
  // Created once. Deliberately never destroyed on unmount: StrictMode mounts
  // twice in development and would be left holding a dead session. The only
  // thing a session keeps running is order polling, which ends by itself
  // when the order does.
  const [session] = useState(() => options.session ?? createIntentSession({ apiUrl: options.apiUrl }));

  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);

  const wallet = options.wallet ?? null;
  useEffect(() => session.setWallet(wallet), [session, wallet]);

  return { ...state, run: session.run, confirm: session.confirm, reset: session.reset, session };
}
