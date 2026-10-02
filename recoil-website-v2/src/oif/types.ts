/**
 * Types mirroring the OIF aggregator HTTP API (camelCase JSON).
 * Source of truth: oif-aggregator crates/types. Only the surface Phase 0 needs is
 * modelled here; quote/order types arrive in Phase 2.
 */

/** A token a solver can source/deliver, from GET /api/v1/solvers. */
export interface SolverAsset {
  address: string;
  chainId: number;
  symbol: string;
  name: string;
  decimals: number;
}

export interface SolverSupportedAssets {
  type: 'assets' | 'routes';
  assets?: SolverAsset[];
  source?: 'autoDiscovered' | 'config';
}

export interface Solver {
  solverId: string;
  adapterId: string;
  name: string;
  description?: string;
  endpoint: string;
  status: string;
  supportedAssets: SolverSupportedAssets;
  createdAt?: string;
  lastSeen?: string;
}

export interface SolversResponse {
  solvers: Solver[];
  totalSolvers: number;
}

// ---------------------------------------------------------------------------
// Quote + order types (POST /api/v1/quotes, /api/v1/orders).
// Ported from the OIF aggregator demo (`demo/src/types/api.ts`). Addresses are
// ERC-7930 interop hex strings (see ./interop), not plain `0x` addresses.
// ---------------------------------------------------------------------------

/** An ERC-7930 interop-encoded address. */
export type InteropAddress = `0x${string}`;

export interface Input {
  user: InteropAddress;
  asset: InteropAddress;
  amount?: string;
  lock?: AssetLockReference;
}

export interface Output {
  receiver: InteropAddress;
  asset: InteropAddress;
  amount?: string;
  calldata?: string;
}

export interface AssetLockReference {
  kind: 'the-compact' | 'rhinestone';
  params?: unknown;
}

export interface OriginSubmission {
  mode: 'user' | 'protocol';
  schemes?: ('erc4337' | 'permit2' | 'erc20-permit' | 'eip3009')[];
}

export interface SolverOptions {
  timeout?: number;
  solverTimeout?: number;
  minQuotes?: number;
  solverSelection?: 'all' | 'sampled' | 'priority';
  includeSolvers?: string[];
  excludeSolvers?: string[];
  sampleSize?: number;
  priorityThreshold?: number;
}

export interface IntentRequest {
  intentType: 'oif-swap';
  inputs: Input[];
  outputs: Output[];
  swapType?: 'exact-input' | 'exact-output';
  preference?: 'price' | 'speed' | 'inputPriority' | 'trustMinimization';
  partialFill?: boolean;
  minValidUntil?: number;
  failureHandling?: ('refund-automatic' | 'refund-claim' | 'needs-new-signature')[];
  originSubmission?: OriginSubmission;
  metadata?: unknown;
}

export interface QuoteRequest {
  user: InteropAddress;
  intent: IntentRequest;
  supportedTypes: string[];
  metadata?: unknown;
  solverOptions?: SolverOptions;
}

/** EIP-712 typed data carried by an order, ready to feed to a wallet signer. */
export interface OrderPayload {
  signatureType: 'eip712';
  domain: {
    name: string;
    version?: string;
    chainId: string | number;
    verifyingContract: string;
  };
  primaryType: string;
  message: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
}

export interface Order {
  type: string;
  payload: OrderPayload;
  metadata?: Record<string, unknown>;
}

export interface QuotePreview {
  inputs: Input[];
  outputs: Output[];
}

/** A single quote from POST /api/v1/quotes. */
export interface Quote {
  quoteId: string;
  solverId: string;
  order: Order;
  partialFill: boolean;
  preview: QuotePreview;
  integrityChecksum: string;
  provider?: string;
  eta?: number;
  failureHandling?: 'refund-automatic' | 'refund-claim' | 'needs-new-signature';
  validUntil?: number;
  metadata?: unknown;
}

export interface AggregationMetadata {
  totalDurationMs: number;
  solverTimeoutMs: number;
  globalTimeoutMs: number;
  earlyTermination: boolean;
  totalSolversAvailable: number;
  solversQueried: number;
  solversRespondedSuccess: number;
  solversRespondedError: number;
  solversTimedOut: number;
  minQuotesRequired: number;
  solverSelectionMode: string;
}

export interface QuotesResponse {
  quotes: Quote[];
  totalQuotes: number;
  metadata?: AggregationMetadata;
}

export interface OrderRequest {
  /** The full Quote object returned by /quotes. */
  quoteResponse: Quote;
  /** Hex signature produced by ./sign (scheme-prefixed). */
  signature: string;
  originSubmission?: OriginSubmission;
  metadata?: unknown;
}

/**
 * Order lifecycle: created → pending → executing → executed → settled →
 * settling → finalized. Terminal: finalized | failed | refunded.
 */
export type OrderStatus =
  | 'created'
  | 'pending'
  | 'executing'
  | 'executed'
  | 'settled'
  | 'settling'
  | 'finalized'
  | 'refunded'
  | { failed: [string, string] }; // [transactionType, errorMessage]

export interface AssetAmount {
  asset: InteropAddress;
  amount?: string;
}

export interface Settlement {
  type: 'escrow' | 'resourceLock';
  data: unknown;
}

export interface OrderResponse {
  orderId: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  inputAmounts: AssetAmount[];
  outputAmounts: AssetAmount[];
  orderType: string;
  settlement: Settlement;
  quoteId?: string;
  fillTransaction?: unknown;
}
