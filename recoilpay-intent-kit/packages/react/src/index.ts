export { RecoilIntent, type IntentExample, type RecoilIntentProps, type RecoilTheme } from './RecoilIntent';
export { useRecoilIntent, type UseRecoilIntent, type UseRecoilIntentOptions } from './useRecoilIntent';

// Re-exported so apps only need this one package.
export {
  createIntentSession,
  viemWallet,
  type IntentPhase,
  type IntentPreview,
  type IntentSession,
  type IntentState,
  type IntentWallet,
} from '@recoilpay/intent-core';
