---
title: Signing and submitting
sidebar_position: 4
---

# Signing and submitting

The quote you got back already contains the complete EIP-712 typed data. Your job is narrow: put it in front of a wallet, prefix the result with one scheme byte, and post the untouched quote back with the signature.

This is where integrations break, and almost always for one of three reasons: a missing scheme prefix, a mutated quote, or a missing Permit2 approval. All three are covered below.

---

## Pick the escrow route {#pick-the-escrow-route}

Request `supportedTypes: ["oif-escrow-v0"]` and `originSubmission.schemes: ["permit2"]`.

RecoilPay's settlement layer defines several order types. Only one is production-proven on the current deployment:

| Order type | Scheme prefix | Status |
|---|---|---|
| `oif-escrow-v0` (Permit2) | `0x00` | **Use this.** Proven working. |
| `oif-3009-v0` (EIP-3009) | `0x01` | Signs correctly, but the on-chain open path reverts with `SignatureAndInputsNotEqual`. |
| `oif-resource-lock-v0` (The Compact) | — | Not implemented. |
| `oif-generic-v0` | — | Not implemented. |

If you advertise `eip3009` among your schemes, a solver's custody logic may *prefer* it over Permit2 — and then the fill fails on-chain. Narrowing to `["permit2"]` at quote time is what prevents that. Still, branch on `quote.order.type` when you sign rather than assuming what you asked for, and throw loudly on a type you don't handle. A silent fall-through here produces an unsignable order and a stuck user.

---

## Step 1 — Ensure the Permit2 allowance

The escrow route pulls the user's input token through Uniswap's Permit2, so the token needs a standing ERC-20 allowance for it:

```
PERMIT2_ADDRESS = 0x000000000022D473030F116dDEE9F6B43aC78BA3
```

Canonical and identical on every chain. (`GET /api/v1/chains` also reports it per-chain, so a future chain with a non-canonical deployment won't break you if you read it from there.)

```ts
import { maxUint256 } from 'viem';

const allowance = await publicClient.readContract({
  address: inputToken, abi: erc20Abi, functionName: 'allowance',
  args: [userAddress, PERMIT2_ADDRESS],
});

if (allowance < inputAmount) {
  await walletClient.writeContract({
    address: inputToken, abi: erc20Abi, functionName: 'approve',
    args: [PERMIT2_ADDRESS, maxUint256],   // unlimited: one prompt, forever
  });
}
```

This is an on-chain transaction and the **only** source-chain gas your user spends. It's one-time per `(token, chain)`, so read the allowance first and prompt only when it's short — a spurious approval prompt on every swap is the fastest way to lose a user's trust.

Without a sufficient allowance the signature succeeds and the fill then fails. Check before you sign, not after.

---

## Step 2 — Sign the payload

`quote.order.payload` carries everything a wallet needs:

```ts
{
  signatureType: 'eip712',
  domain: { name, version?, chainId, verifyingContract },
  primaryType: string,
  types: Record<string, { name: string; type: string }[]>,
  message: Record<string, unknown>,
}
```

Two handling notes that cause real bugs:

- **Drop `EIP712Domain` from `types`.** Wallets derive it themselves; passing it explicitly breaks some signers.
- **Omit `version` if the payload omits it.** Passing `version: undefined` is not the same as leaving it out — viem and others will encode the domain differently and produce a signature that fails verification.

```ts
import type { Hex } from 'viem';

function domainFor(payload: OrderPayload) {
  return {
    name: payload.domain.name,
    chainId: BigInt(payload.domain.chainId),
    verifyingContract: payload.domain.verifyingContract as `0x${string}`,
    ...(payload.domain.version != null ? { version: payload.domain.version } : {}),
  };
}

function typesFor(payload: OrderPayload) {
  const { EIP712Domain, ...rest } = payload.types;
  return rest;
}

export async function signQuote(quote: Quote, signTypedData: TypedDataSigner): Promise<Hex> {
  const { type, payload } = quote.order;
  if (type !== 'oif-escrow-v0') {
    throw new Error(`unsupported order type: ${type}`);   // fail loud, never silently
  }

  const raw = await signTypedData({
    domain: domainFor(payload),
    types: typesFor(payload),
    primaryType: payload.primaryType,   // 'PermitBatchWitnessTransferFrom'
    message: payload.message,
  });

  return `0x00${raw.slice(2)}` as Hex;  // escrow/Permit2 scheme prefix
}
```

### Canonical Permit2 types

For the Permit2 path (`primaryType` of `PermitBatchWitnessTransferFrom` or `PermitWitnessTransferFrom`) the reference client substitutes its **own** canonical type definitions instead of the payload's. EIP-712 hashes depend on field order, so pinning them locally removes any chance that a solver serialises the struct in a different order and yields a digest the settler won't accept:

```ts
const PERMIT2_TYPES = {
  PermitBatchWitnessTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions[]' },
    { name: 'spender',   type: 'address' },
    { name: 'nonce',     type: 'uint256' },
    { name: 'deadline',  type: 'uint256' },
    { name: 'witness',   type: 'Permit2Witness' },
  ],
  Permit2Witness: [
    { name: 'user',        type: 'address' },
    { name: 'expires',     type: 'uint32' },
    { name: 'inputOracle', type: 'address' },
    { name: 'outputs',     type: 'MandateOutput[]' },
  ],
  MandateOutput: [
    { name: 'oracle',       type: 'bytes32' },
    { name: 'settler',      type: 'bytes32' },
    { name: 'chainId',      type: 'uint256' },
    { name: 'token',        type: 'bytes32' },
    { name: 'amount',       type: 'uint256' },
    { name: 'recipient',    type: 'bytes32' },
    { name: 'callbackData', type: 'bytes' },
    { name: 'context',      type: 'bytes' },
  ],
  TokenPermissions: [
    { name: 'token',  type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
};
```

Use these for Permit2 and fall back to `payload.types` (minus `EIP712Domain`) for anything else.

### The scheme prefix

Prepend one byte to the 65-byte signature so the settler knows which custody scheme produced it:

| Order type | Prefix | Result |
|---|---|---|
| `oif-escrow-v0` | `0x00` | `0x00` + 65-byte signature |
| `oif-3009-v0` | `0x01` | `0x01` + 65-byte signature |

Prefix the **hex string**, not the bytes: `` `0x00${raw.slice(2)}` ``. An unprefixed signature is accepted by the API and then reverts on-chain — the worst failure mode available, because you find out after the user has already signed.

One extra wrinkle if you ever enable EIP-3009: a **multi-input** 3009 order submits its prefixed signatures ABI-encoded as `bytes[]` rather than bare. Single-input orders stay bare. Not relevant while you're on `permit2` and single-input.

---

## Step 3 — Submit

```ts
await post('/api/v1/orders', {
  quoteResponse: quote,     // byte-for-byte as received
  signature,                // scheme-prefixed
});
```

Don't resend `originSubmission` — it was negotiated at quote time.

:::danger Send the quote back unchanged
`integrityChecksum` is an HMAC-SHA256 the aggregator computed over the quote with a key only it holds, and it **re-verifies on submission**. Any mutation fails with an integrity error.

That includes changes you didn't mean to make. Deserialising into a struct that omits unknown fields, re-serialising with different key order or number formatting, letting an amount pass through a float, or trimming fields you "don't need" will all break it. Keep the raw object — or the raw JSON — from `/quotes` to `/orders`, and route it around any layer that might normalise it.
:::

### Watch the clock {#watch-the-clock}

Quotes expire. `quote.validUntil` is an **absolute** Unix timestamp, and solvers typically allow around five minutes.

Enforcing it is your job. `POST /api/v1/orders` does **not** reject a stale quote — the deadline is carried inside the signed Permit2 payload (`deadline` on the permit, `expires` on the witness) and enforced on-chain. So an expired quote is accepted by the API and then fails at fill time, which is a much worse experience than a clean rejection.

Check `validUntil` before you prompt for a signature, not just before you submit. A user who leaves a confirm dialog open for ten minutes should be shown a fresh quote, not walked into a failure. If it's near expiry, re-request quotes and re-sign.

---

## Errors you'll actually hit

| Symptom | Cause | Fix |
|---|---|---|
| `quotes: []`, `solversQueried: 0` | No solver covers the route, or a malformed interop address | Check the [active asset set](./quickstart#0-find-out-whats-executable); round-trip your encoder |
| `400` integrity verification failed | The quote was modified in transit | Pass it through verbatim |
| `400` "integrity checksum is required" | `quoteResponse` was missing or partial | Send the whole quote object |
| `400` validation error | Empty inputs/outputs, zero amount, bad address, unknown field | See [Validation](./intents#validation) |
| Signature rejected on-chain | Missing scheme prefix | Prepend `0x00` |
| Fill fails after signing | No Permit2 allowance | Check `allowance` before signing |
| Order expired immediately | You sent `minValidUntil` | [Omit it](./intents#do-not-send-minvaliduntil) |
| On-chain `SignatureAndInputsNotEqual` | Landed on the EIP-3009 path | Request `schemes: ["permit2"]` only |

---

## Then poll

After submission you hold an `orderId`. Poll `GET /api/v1/orders/{id}` every 2–3 seconds and treat **`executed`** as delivery — see the [status lifecycle](./api-reference#order-status).

**→ [API reference](./api-reference)**
