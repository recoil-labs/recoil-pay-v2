/**
 * Quote signing for the OIF escrow (Permit2) and EIP-3009 order types.
 *
 * Adapted from the aggregator demo's `quoteSigner.ts`, but signs with the
 * CONNECTED WALLET (wagmi/viem `signTypedDataAsync`) instead of a raw private
 * key. The quote response already carries the full EIP-712 typed data in
 * `quote.order.payload` (domain / types / message / primaryType) — verified
 * against the live aggregator for both order types — so we feed that straight
 * to the wallet and apply the demo's per-scheme post-processing:
 *   - `oif-escrow-v0` (Permit2 `PermitBatchWitnessTransferFrom`): prefix `0x00`.
 *   - `oif-3009-v0` (EIP-3009 `ReceiveWithAuthorization` / `TransferWithAuthorization`):
 *     prefix `0x01`, and for multi-input orders wrap the signature(s) in an ABI
 *     `bytes[]` array.
 *
 * `oif-resource-lock-v0` (TheCompact) and `oif-generic-v0` are not implemented
 * and throw clearly.
 */

import { encodeAbiParameters } from 'viem';
import type { Address, Hex } from 'viem';
import type { Order, OrderPayload, Quote } from './types';

/**
 * Wallet typed-data signer. Pass wagmi's `signTypedDataAsync` (from
 * `useSignTypedData`) or viem wallet client's `signTypedData`.
 */
export type TypedDataSigner = (args: {
  domain: Record<string, unknown>;
  types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}) => Promise<Hex>;

/**
 * Permit2 batch witness transfer type definitions (Uniswap Permit2 spec).
 * Used canonically for the escrow-v0 path to guarantee stable field ordering,
 * matching the aggregator demo.
 */
const PERMIT2_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  PermitBatchWitnessTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions[]' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'witness', type: 'Permit2Witness' },
  ],
  MandateOutput: [
    { name: 'oracle', type: 'bytes32' },
    { name: 'settler', type: 'bytes32' },
    { name: 'chainId', type: 'uint256' },
    { name: 'token', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
    { name: 'recipient', type: 'bytes32' },
    { name: 'callbackData', type: 'bytes' },
    { name: 'context', type: 'bytes' },
  ],
  Permit2Witness: [
    { name: 'user', type: 'address' },
    { name: 'expires', type: 'uint32' },
    { name: 'inputOracle', type: 'address' },
    { name: 'outputs', type: 'MandateOutput[]' },
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
};

/**
 * EIP-3009 authorization type definitions (USDC et al). Used canonically for
 * the 3009-v0 path so field ordering is stable, matching the aggregator demo.
 */
const EIP3009_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
  CancelAuthorization: [
    { name: 'authorizer', type: 'address' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/**
 * Extract a viem-friendly domain from the payload. Only includes fields that are
 * defined (omitting an absent `version` avoids viem encoding issues).
 */
function extractDomain(payload: OrderPayload): Record<string, unknown> {
  const domain: Record<string, unknown> = {
    name: payload.domain.name,
    chainId: BigInt(payload.domain.chainId),
    verifyingContract: payload.domain.verifyingContract as Address,
  };
  if (payload.domain.version !== undefined && payload.domain.version !== null) {
    domain.version = payload.domain.version;
  }
  return domain;
}

/**
 * Canonical EIP-712 types for the payload. For Permit2 we always use the
 * canonical definitions; otherwise fall back to the payload's own types
 * (minus EIP712Domain, which wallets add automatically).
 */
function getTypesForPayload(
  payload: OrderPayload,
): Record<string, ReadonlyArray<{ name: string; type: string }>> {
  switch (payload.primaryType) {
    case 'PermitBatchWitnessTransferFrom':
    case 'PermitWitnessTransferFrom':
      return PERMIT2_TYPES;
    case 'TransferWithAuthorization':
    case 'ReceiveWithAuthorization':
    case 'CancelAuthorization':
      return { [payload.primaryType]: EIP3009_TYPES[payload.primaryType] };
    default: {
      if (payload.types) {
        const filtered: Record<string, Array<{ name: string; type: string }>> = {};
        for (const [typeName, typeFields] of Object.entries(payload.types)) {
          if (typeName !== 'EIP712Domain') filtered[typeName] = typeFields;
        }
        return filtered;
      }
      throw new Error(
        `Unknown primary type: ${payload.primaryType}. Please provide types in payload.`,
      );
    }
  }
}

/**
 * Sign a Permit2 (oif-escrow-v0) order with the wallet and prepend the
 * scheme prefix `0x00`, exactly as the demo does for escrow-v0.
 */
async function signPermit2(payload: OrderPayload, signer: TypedDataSigner): Promise<Hex> {
  const domain = extractDomain(payload);
  const types = getTypesForPayload(payload);

  const signature = await signer({
    domain,
    types,
    primaryType: payload.primaryType,
    message: payload.message,
  });

  // Permit2 scheme prefix (0x00).
  return `0x00${signature.slice(2)}` as Hex;
}

/**
 * Sign an EIP-3009 (oif-3009-v0) order with the wallet and apply the demo's
 * 3009 post-processing: prepend the scheme prefix `0x01`, and for multi-input
 * orders wrap the prefixed signature(s) in an ABI `bytes[]` array.
 *
 * The live aggregator's payload is self-contained: it carries the token's full
 * EIP-712 `domain` (name / version / chainId / verifyingContract), `types`, and
 * a `ReceiveWithAuthorization` / `TransferWithAuthorization` `message`. We sign
 * that payload's OWN typed data via the wallet (same approach as escrow-v0) and
 * never reconstruct the domain ourselves. EIP-3009 domains use version "1", so
 * we default it only if a token were ever to omit it.
 */
async function signEip3009(
  payload: OrderPayload,
  metadata: Record<string, unknown> | undefined,
  signer: TypedDataSigner,
): Promise<Hex> {
  const domain = extractDomain(payload);
  if (domain.version === undefined || domain.version === null) {
    domain.version = '1';
  }
  const types = getTypesForPayload(payload);

  const signature = await signer({
    domain,
    types,
    primaryType: payload.primaryType,
    message: payload.message,
  });

  // EIP-3009 scheme prefix (0x01).
  const prefixed = `0x01${signature.slice(2)}` as Hex;

  // Multi-input 3009 orders submit the per-input signatures as an ABI `bytes[]`
  // array; a single input is submitted as the bare prefixed signature. Inputs
  // live on the order metadata (preferred) or, as a fallback, the message.
  const meta = metadata as { inputs?: unknown[] } | undefined;
  const msg = payload.message as { inputs?: unknown[] };
  const inputs = meta?.inputs ?? msg.inputs ?? [];
  if (Array.isArray(inputs) && inputs.length > 1) {
    return encodeAbiParameters([{ type: 'bytes[]' }], [[prefixed]]) as Hex;
  }

  return prefixed;
}

/**
 * Sign a quote with the connected wallet.
 *
 * @param quote - the full Quote object returned by /quotes
 * @param signTypedDataAsync - wagmi/viem typed-data signer (uses connected wallet)
 * @returns the scheme-prefixed signature to put in the order's `signature` field
 */
export async function signQuote(
  quote: Quote,
  signTypedDataAsync: TypedDataSigner,
): Promise<Hex> {
  const order: Order = quote.order;

  switch (order.type) {
    case 'oif-escrow-v0':
      return signPermit2(order.payload, signTypedDataAsync);

    case 'oif-3009-v0':
      return signEip3009(order.payload, order.metadata, signTypedDataAsync);

    case 'oif-resource-lock-v0':
    case 'oif-generic-v0':
      throw new Error(
        `Unsupported order type for wallet signing: ${order.type} ` +
          `(only oif-escrow-v0 and oif-3009-v0 are implemented)`,
      );

    default:
      throw new Error(`Unsupported order type: ${order.type}`);
  }
}
