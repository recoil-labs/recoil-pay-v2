// The flow, as one subscribable store — what UI layers build on.
export {
  createIntentSession,
  isTerminalStatus,
  type IntentPhase,
  type IntentPreview,
  type IntentSession,
  type IntentState,
  type SessionOptions,
} from './session';

// Wallets.
export { viemWallet, stripDomainType, type IntentWallet } from './wallet';

// The aggregator API.
export {
  ApiError,
  createApiClient,
  DEFAULT_API_URL,
  MAX_INTENT_CHARS,
  TEMPLATE_HINT,
  type ApiClient,
  type ApiOptions,
  type ChainInfo,
} from './api';
export { chainName, explorerUrl, rpcReaders, SOLANA_CHAIN_IDS, type ChainReader } from './chains';

// Building blocks, for integrators composing their own flow.
export * from './intent/types';
export {
  buildSupportedSet,
  CHAIN_ALIASES,
  EMPTY_SUPPORTED,
  findAsset,
  normalizeChain,
  normalizeToken,
  TOKEN_ALIASES,
  type CanonicalChain,
  type SupportedSet,
} from './intent/registry';
export { validateIntent } from './intent/validate';
export { resolveIntent } from './intent/resolve';
export { buildOrderRequest, buildQuoteRequest } from './oif/buildQuoteRequest';
export { signQuote, type TypedDataSigner } from './oif/sign';
export { interopAddress, type InteropAddress } from './oif/interop';
export {
  buildPermit2ApproveRequest,
  getPermit2Allowance,
  hasPermit2Allowance,
  MAX_UINT256,
  PERMIT2_ADDRESS,
} from './oif/permit2';
export type * from './oif/types';
