import type { ResolvedIntent } from '../intent/types';
import { interopAddress } from './interop';
import type { OrderRequest, Quote, QuoteRequest } from './types';

/**
 * Build the POST /api/v1/quotes body from a resolved intent.
 *
 * Shape matches the verified oif-aggregator contract: every address is
 * ERC-7930 interop-encoded (see ./interop), and the input amount is a base-unit
 * decimal string.
 *
 * We request the **Permit2 escrow** path only (`schemes:['permit2']`,
 * `supportedTypes:['oif-escrow-v0']`). The solver's custody logic checks the
 * requested schemes and, when EIP-3009 is offered, prefers it — but the live
 * 3009 open path reverts on-chain (`SignatureAndInputsNotEqual`). Permit2 escrow
 * is the proven-working route (it needs a one-time Permit2 approval, handled in
 * useIntent's confirm flow).
 *
 * For a `send`, `recipient` differs from `user`; for a `swap` they're equal.
 * Either way the input is sourced on `srcChainId` from `user`, and the output
 * is delivered on `dstChainId` to `recipient`.
 */
export function buildQuoteRequest(resolved: ResolvedIntent): QuoteRequest {
  const {
    user,
    recipient,
    srcChainId,
    dstChainId,
    inputToken,
    outputToken,
    inputAmount,
  } = resolved;

  const userInterop = interopAddress(srcChainId, user);

  return {
    user: userInterop,
    intent: {
      intentType: 'oif-swap',
      inputs: [
        {
          user: userInterop,
          asset: interopAddress(srcChainId, inputToken),
          amount: inputAmount.toString(),
        },
      ],
      outputs: [
        {
          receiver: interopAddress(dstChainId, recipient),
          asset: interopAddress(dstChainId, outputToken),
        },
      ],
      swapType: 'exact-input',
      // NOTE: do NOT send minValidUntil. This deployment copies it verbatim into
      // the 3009 authorization's `validBefore`, so a relative value like 600 makes
      // the order "expired since 1970". Omitting it lets the solver set a proper
      // absolute deadline (~now+300s), matching the aggregator demo.
      originSubmission: {
        mode: 'user',
        schemes: ['permit2'],
      },
    },
    supportedTypes: ['oif-escrow-v0'],
    solverOptions: {
      timeout: 8000,
      solverTimeout: 5000,
      minQuotes: 1,
    },
  };
}

/**
 * Build the POST /api/v1/orders body from a quote and its scheme-prefixed
 * signature (produced by ./sign `signQuote`).
 *
 * The submission scheme (`permit2` / `eip3009`) is negotiated at quote time via
 * the quote request's `originSubmission` — the demo does NOT repeat it on the
 * order, so neither do we. The order just pairs the full quote back with its
 * signature.
 */
export function buildOrderRequest(quote: Quote, signature: string): OrderRequest {
  return {
    quoteResponse: quote,
    signature,
  };
}
