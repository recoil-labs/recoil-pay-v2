---
title: Forward your first intent
sidebar_label: Quickstart
sidebar_position: 2
---

# Forward your first intent

By the end of this page you'll have taken an intent, priced it against live solvers, signed it, submitted it, and watched it settle — moving 1 test USDC from Base Sepolia to Optimism Sepolia.

**What you need:** an HTTP client, a funded testnet wallet ([how to fund one](../quickstart#2-fund-your-wallet-on-testnet)), and a way to produce an EIP-712 signature.

```bash
export RECOIL_API=https://api.recoilpay.com
```

---

## 0. Find out what's executable

Never hardcode the supported set — solver coverage changes. Ask:

```bash
curl -s "$RECOIL_API/api/v1/solvers" | jq '.solvers[] | select(.status=="active") | .supportedAssets.assets'
```

Every `(chainId, address)` pair returned by an **active** solver is fillable right now. The RecoilPay app gates its parser on exactly this set — an intent naming anything outside it is rejected before a quote is ever requested. Do the same and you'll avoid the most common cause of "zero quotes returned".

`GET /api/v1/chains` complements it with the per-chain settlement contracts, Permit2 address, and token decimals.

---

## 1. Ask for quotes

Here's a complete, valid request body. It says: *this user wants to spend exactly 1 USDC on Base Sepolia and receive USDC on Optimism Sepolia at the same address.*

```bash title="POST /api/v1/quotes"
curl -s -X POST "$RECOIL_API/api/v1/quotes" \
  -H 'Content-Type: application/json' \
  -d '{
    "user": "0x0001000003014a3414632bf0d0d6468908378c3ccfac4e788b115e0e55",
    "intent": {
      "intentType": "oif-swap",
      "inputs": [
        {
          "user":   "0x0001000003014a3414632bf0d0d6468908378c3ccfac4e788b115e0e55",
          "asset":  "0x0001000003014a341473c83dacc74bb8a704717ac09703b959e74b9705",
          "amount": "1000000"
        }
      ],
      "outputs": [
        {
          "receiver": "0x0001000003aa37dc14632bf0d0d6468908378c3ccfac4e788b115e0e55",
          "asset":    "0x0001000003aa37dc14191688b2ff5be8f0a5bcab3e819c900a810faaf6"
        }
      ],
      "swapType": "exact-input",
      "originSubmission": { "mode": "user", "schemes": ["permit2"] }
    },
    "supportedTypes": ["oif-escrow-v0"],
    "solverOptions": { "timeout": 8000, "solverTimeout": 5000, "minQuotes": 1 }
  }'
```

Those long hex strings are **not** plain addresses — they're [ERC-7930 interop addresses](./intents#addresses-are-erc-7930-encoded), which pack the chain id and the address together. Get the encoding wrong and you get zero quotes with no useful error, so read that section before you write your own encoder. Decoded, the four above are:

| Field | Chain | Address |
|---|---|---|
| `user` / `inputs[].user` | Base Sepolia `84532` | `0x632B…0E55` |
| `inputs[].asset` | Base Sepolia `84532` | USDC `0x73c8…9705` |
| `outputs[].receiver` | OP Sepolia `11155420` | `0x632B…0E55` |
| `outputs[].asset` | OP Sepolia `11155420` | USDC `0x1916…Aaf6` |

`"amount": "1000000"` is **base units as a decimal string** — USDC has 6 decimals, so this is 1 USDC. Note the output has no `amount`: with `swapType: "exact-input"` you fix the input and the solvers compete on what they'll deliver.

Three details in that body matter more than they look:

- **`supportedTypes: ["oif-escrow-v0"]`** — the Permit2 escrow route. It's the proven-working path on this deployment; see [Signing](./signing#pick-the-escrow-route) for why you should pin it.
- **`originSubmission.schemes: ["permit2"]`** — negotiated here, at quote time, not at order time.
- **No `minValidUntil`.** Omit it. [This deployment copies it verbatim](./intents#do-not-send-minvaliduntil) into the authorization's absolute `validBefore`, so a relative value like `600` produces an order that expired in 1970. Omitting it lets the solver set a proper deadline.

### The response

```json
{
  "quotes": [
    {
      "quoteId": "quote-01JB…",
      "solverId": "solver-alpha",
      "order": {
        "type": "oif-escrow-v0",
        "payload": {
          "signatureType": "eip712",
          "domain": { "name": "Permit2", "chainId": "84532", "verifyingContract": "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
          "primaryType": "PermitBatchWitnessTransferFrom",
          "types": { "…": [] },
          "message": { "…": {} }
        }
      },
      "preview": {
        "inputs":  [{ "asset": "0x0001…9705", "amount": "1000000" }],
        "outputs": [{ "asset": "0x0001…Aaf6", "amount": "999000" }]
      },
      "validUntil": 1764000000,
      "eta": 18,
      "integrityChecksum": "9f2c…",
      "partialFill": false
    }
  ],
  "totalQuotes": 1,
  "metadata": { "totalDurationMs": 1840, "solversQueried": 3, "solversRespondedSuccess": 1 }
}
```

Two things to take from this:

**`preview` is what you show the user.** `preview.outputs[].amount` is the amount they actually receive, net of the solver's spread. Show it before you ask for a signature — your user should never sign a number they haven't seen.

**`order.payload` is already signable.** The solver built the full EIP-712 typed data for you. You don't construct it; you pass it to a wallet.

:::danger Treat the quote as immutable
`integrityChecksum` is an HMAC the aggregator computes over the quote and **re-verifies when you submit the order**. Store the quote object exactly as you received it and send it back byte-for-byte. Re-serialising it through a lossy type, rounding a number, or dropping an unrecognised field will fail verification and your order will be rejected.
:::

### Getting zero quotes

`quotes: []` with `totalQuotes: 0` is a valid response, not an error. Check `metadata`: `solversQueried: 0` means no solver covers that route, while `solversRespondedError` or `solversTimedOut` being non-zero means they tried and couldn't. The usual causes are an asset pair outside the [active set](#0-find-out-whats-executable), a malformed interop address, or too tight a `solverTimeout`.

---

## 2. Approve Permit2 (once per token, per chain)

The escrow route pulls the input token via [Permit2](https://github.com/Uniswap/permit2), so the user's input token must have an ERC-20 allowance set for the canonical Permit2 contract:

```
0x000000000022D473030F116dDEE9F6B43aC78BA3
```

Same address on every chain. Check `allowance(user, PERMIT2_ADDRESS)` on the input token and, if it doesn't cover the input amount, send an `approve` first. This is a real transaction — the only source-chain gas your user spends — and it's **one-time per (token, chain)**. Check before every swap, prompt only when short.

---

## 3. Sign the quote

Feed `quote.order.payload` to the wallet as typed data, then prefix the result with a scheme byte: **`0x00`** for `oif-escrow-v0`.

```ts
import { createWalletClient, custom } from 'viem';
import { baseSepolia } from 'viem/chains';

const wallet = createWalletClient({ chain: baseSepolia, transport: custom(window.ethereum) });
const { payload } = quote.order;

const raw = await wallet.signTypedData({
  account,
  domain: {
    name: payload.domain.name,
    chainId: BigInt(payload.domain.chainId),
    verifyingContract: payload.domain.verifyingContract,
    // include `version` only if the payload has one — an undefined version breaks encoding
    ...(payload.domain.version != null ? { version: payload.domain.version } : {}),
  },
  types: payload.types,        // minus EIP712Domain, which wallets add themselves
  primaryType: payload.primaryType,
  message: payload.message,
});

const signature = `0x00${raw.slice(2)}`; // 0x00 = escrow/Permit2 scheme prefix
```

That prefix is not decoration — the settler reads it to know which custody scheme to use, and an unprefixed signature fails on-chain. [Signing and submitting](./signing) covers the other schemes, the canonical Permit2 type definitions, and the multi-input case.

---

## 4. Submit the order

Pair the untouched quote with the signature:

```bash title="POST /api/v1/orders"
curl -s -X POST "$RECOIL_API/api/v1/orders" \
  -H 'Content-Type: application/json' \
  -d '{
    "quoteResponse": { "…the entire quote object, verbatim…" },
    "signature": "0x00a1b2c3…"
  }'
```

You don't repeat `originSubmission` — that was settled at quote time.

```json
{
  "orderId": "ord-01JB…",
  "status": "created",
  "quoteId": "quote-01JB…",
  "orderType": "oif-escrow-v0",
  "createdAt": "2026-09-27T10:04:11Z",
  "updatedAt": "2026-09-27T10:04:11Z",
  "inputAmounts":  [{ "asset": "0x0001…9705", "amount": "1000000" }],
  "outputAmounts": [{ "asset": "0x0001…Aaf6", "amount": "999000" }]
}
```

Persist that `orderId` before you show the user anything. It's your only handle on the order.

---

## 5. Poll until it settles

```bash
curl -s "$RECOIL_API/api/v1/orders/ord-01JB…"
```

Poll every 2–3 seconds. The status you actually care about is **`executed`** — that's when the tokens land in the recipient's wallet on the destination chain, typically 5–20 seconds after submission. Everything after it is the solver getting reimbursed.

| Status | What it means for your user |
|---|---|
| `created` | Accepted. Nothing on-chain yet. |
| `pending` | A solver has picked it up. |
| `executing` | The fill is in flight on the destination chain. |
| **`executed`** | **Funds delivered. Tell the user they're done.** |
| `settled` → `settling` → `finalized` | Solver reimbursement from escrow. Informational. |
| `refunded` | Not filled; the escrowed input went back to the user. |
| `{ "failed": ["fill", "reason…"] }` | Failed. The input is escrowed and refundable — the user has not lost funds. |

Note that `failed` arrives as an **object**, not a string — `{ "failed": [transactionType, errorMessage] }`. Handle both shapes or your status check will throw on the one case where you most need it to work. Full lifecycle in the [API reference](./api-reference#order-status).

---

## The whole loop

```ts
// 1. price it
const { quotes } = await post('/api/v1/quotes', quoteRequest);
if (!quotes.length) throw new Error('no solver covers this route right now');
const quote = quotes[0];                        // already ranked

// 2. show preview.outputs[0].amount, get consent, ensure Permit2 allowance

// 3. sign the solver-supplied typed data
const signature = `0x00${(await signTypedData(quote.order.payload)).slice(2)}`;

// 4. submit the quote UNCHANGED
const { orderId } = await post('/api/v1/orders', { quoteResponse: quote, signature });

// 5. poll to delivery
let order;
do {
  await sleep(2500);
  order = await get(`/api/v1/orders/${orderId}`);
} while (!['executed','settled','settling','finalized','refunded'].includes(order.status)
         && typeof order.status === 'string');
```

A working reference implementation of exactly this lives in the RecoilPay web app under `src/oif/` — `client.ts`, `buildQuoteRequest.ts`, `interop.ts`, `sign.ts`, `permit2.ts`. It's the same code path that serves [v2.recoilpay.com](https://v2.recoilpay.com), so if the docs and that code ever disagree, the code is right.

**→ [The intent object](./intents)** for the full request schema and the address encoder.
