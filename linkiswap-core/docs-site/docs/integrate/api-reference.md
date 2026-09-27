---
title: API reference
sidebar_position: 5
---

# API reference

The public integration surface. Five routes, no authentication, JSON in and out with camelCase keys.

```bash
export RECOIL_API=https://recoil-aggregator-675174162902.us-central1.run.app
```

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness |
| `GET` | [`/api/v1/chains`](#get-apiv1chains) | Chains, settlement contracts, tokens |
| `GET` | [`/api/v1/solvers`](#get-apiv1solvers) | Registered solvers and their assets |
| `POST` | [`/api/v1/quotes`](#post-apiv1quotes) | Price an intent |
| `POST` | [`/api/v1/orders`](#post-apiv1orders) | Submit a signed order |
| `GET` | [`/api/v1/orders/{id}`](#get-apiv1ordersid) | Order status |

**Conventions across all routes.** No API key. CORS is open, so browsers can call directly. Request bodies are capped at **1 MiB**. Responses are gzip-compressed when you ask for it. Every response carries an `x-request-id` — log it, and quote it to us when reporting a problem. You can also send your own `x-request-id` and we'll propagate it.

Amounts are always **base-unit decimal strings**; addresses are always [ERC-7930 interop addresses](./intents#addresses-are-erc-7930-encoded).

An interactive Swagger UI is served at `/swagger-ui` with the raw spec at `/api-docs/openapi.json` on deployments built with the `openapi` feature.

---

## `GET /api/v1/chains`

Chain registry: settlement contracts, Permit2 address, RPC endpoint, and tokens with decimals. Read your token metadata from here instead of hardcoding it.

```json
{
  "data": [
    {
      "chainId": 84532,
      "name": "base-sepolia",
      "rpcUrl": "https://base-sepolia-rpc.publicnode.com",
      "inputSettler": "0x…",
      "outputSettler": "0x…",
      "oracle": "0x…",
      "permit2": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      "tokens": [{ "address": "0x73c8…9705", "symbol": "USDC", "decimals": 6 }]
    }
  ]
}
```

All public on-chain configuration. Sorted by `chainId`.

---

## `GET /api/v1/solvers`

Registered solvers and the assets each can fill. Paginated: `?page=1&page_size=25` (page is 1-based, size 1–100).

```json
{
  "solvers": [
    {
      "solverId": "solver-alpha",
      "adapterId": "oif-v0",
      "name": "Alpha",
      "endpoint": "https://…",
      "status": "active",
      "supportedAssets": {
        "type": "assets",
        "source": "autoDiscovered",
        "assets": [{ "address": "0x73c8…9705", "chainId": 84532, "symbol": "USDC", "name": "USD Coin", "decimals": 6 }]
      },
      "lastSeen": "2026-09-27T09:58:02Z"
    }
  ],
  "totalSolvers": 3
}
```

The union of `supportedAssets.assets` across solvers with `status: "active"` is your executable set. Gate your UI on it — inactive solvers won't quote, so including their assets means offering routes that return no quotes.

Note that addresses here are plain `0x` addresses with a separate `chainId`, not interop-encoded. You encode when you build the intent.

---

## `POST /api/v1/quotes`

Fans the intent out to every eligible solver in parallel and returns all valid quotes.

Full request schema in [The intent object](./intents). Minimum viable body:

```json
{
  "user": "0x0001…",
  "intent": {
    "intentType": "oif-swap",
    "inputs":  [{ "user": "0x0001…", "asset": "0x0001…", "amount": "1000000" }],
    "outputs": [{ "receiver": "0x0001…", "asset": "0x0001…" }],
    "swapType": "exact-input",
    "originSubmission": { "mode": "user", "schemes": ["permit2"] }
  },
  "supportedTypes": ["oif-escrow-v0"]
}
```

### Response

```ts
{
  quotes: Quote[],
  totalQuotes: number,
  metadata?: AggregationMetadata,
}
```

#### `Quote`

| Field | Type | Notes |
|---|---|---|
| `quoteId` | `string` | |
| `solverId` | `string` | Which solver offered it |
| `order.type` | `string` | `oif-escrow-v0` — **branch on this when signing** |
| `order.payload` | `OrderPayload` | Complete EIP-712 typed data: `domain`, `types`, `primaryType`, `message` |
| `order.metadata` | `object?` | Solver-specific |
| `preview.inputs` | `Input[]` | What the user pays |
| `preview.outputs` | `Output[]` | **What the user receives — show this before signing** |
| `integrityChecksum` | `string` | HMAC, re-verified at submission. Do not touch the quote |
| `validUntil` | `number?` | **Absolute** Unix seconds |
| `eta` | `number?` | Estimated seconds to fill |
| `partialFill` | `boolean` | |
| `failureHandling` | `string?` | `refund-automatic` \| `refund-claim` \| `needs-new-signature` |
| `provider` | `string?` | |

#### `AggregationMetadata`

Your diagnostic channel when a quote request disappoints:

```ts
{
  totalDurationMs, solverTimeoutMs, globalTimeoutMs,
  earlyTermination,          // true if minQuotes was satisfied before the timeout
  totalSolversAvailable, solversQueried,
  solversRespondedSuccess, solversRespondedError, solversTimedOut,
  minQuotesRequired, solverSelectionMode,
}
```

`solversQueried: 0` means nobody covers the route. `solversTimedOut` high means raise `solverTimeout`. `solversRespondedError` high means the solvers saw your intent and declined it.

`quotes: []` with HTTP `200` is a normal response — no solver bid. Handle it as a product state ("no route available right now"), not an exception.

---

## `POST /api/v1/orders`

```ts
{
  quoteResponse: Quote,   // verbatim from /quotes
  signature: string,      // scheme-prefixed hex — see ./signing
  metadata?: unknown,
}
```

Rejected if the quote is missing its `integrityChecksum` or fails HMAC verification. Omit `originSubmission` — it was fixed at quote time.

Note that expiry is **not** enforced at this boundary: a stale quote can be accepted here and fail later, because the deadline lives in the signed Permit2 payload and is enforced on-chain. Check `validUntil` yourself — see [Watch the clock](./signing#watch-the-clock).

### Response — `OrderResponse`

```ts
{
  orderId: string,
  status: OrderStatus,
  createdAt: string, updatedAt: string,   // RFC 3339
  inputAmounts:  { asset: InteropAddress, amount?: string }[],
  outputAmounts: { asset: InteropAddress, amount?: string }[],
  orderType: string,
  settlement: { type: 'escrow' | 'resourceLock', data: unknown },
  quoteId?: string,
  fillTransaction?: unknown,
}
```

Persist `orderId` before you render anything to the user — it's the only handle on the order.

---

## `GET /api/v1/orders/{id}`

Same `OrderResponse`. Poll every 2–3 seconds.

### Order status {#order-status}

```
created → pending → executing → executed → settled → settling → finalized
```

Terminal: `finalized`, `refunded`, `failed`.

| Status | Meaning | Show the user |
|---|---|---|
| `created` | Accepted, nothing on-chain | "Submitted" |
| `pending` | A solver has claimed it | "Solver found" |
| `executing` | Fill in flight on the destination chain | "Delivering" |
| **`executed`** | **Tokens delivered to the recipient** | **"Done"** |
| `settled` | Solver claimed reimbursement from escrow | — |
| `settling` | Settlement confirming | — |
| `finalized` | Fully confirmed on-chain | — |
| `refunded` | Not filled; input returned to the user | "Refunded" |
| `failed` | Failed; input escrowed and refundable | "Failed — funds safe" |

**`executed` is the one your UI should celebrate.** That's when funds are in the recipient's wallet, typically 5–20 seconds after submission. Everything after it is bookkeeping between the solver and the escrow, and making users wait for `finalized` means making them stare at a spinner after they've already been paid.

:::caution `failed` is an object, not a string
Successful statuses are lowercase strings. Failure arrives as:

```json
{ "status": { "failed": ["fill", "insufficient solver inventory"] } }
```

`[transactionType, errorMessage]`. A `switch` on a string silently falls through this case — the one case where you least want that. Test for the object shape explicitly:

```ts
const isFailed = (s: OrderStatus) => typeof s === 'object' && s !== null && 'failed' in s;
```
:::

A failed or refunded order does **not** mean lost funds. The input stays escrowed on the source chain and returns to the user.

---

## Errors

Standard HTTP semantics: `400` validation or integrity failure, `404` unknown order, `5xx` upstream trouble. Bodies carry a JSON message. Log `x-request-id` alongside every failure — it's how we trace a report back to what happened.

Retry `5xx` and network failures with backoff. Do **not** blind-retry a `POST /api/v1/orders` that returned `400`: validation and integrity failures are deterministic and will fail identically. Re-quote instead.

---

## Not part of this surface

- **`/ws/orders`** — a WebSocket order feed for solvers. It requires a signed-header handshake and is not an integration channel; poll `GET /api/v1/orders/{id}`.
- **`/solver-api/*`** — authenticated endpoints for solver operators: quote submission, vault balances, fill signing, reputation. Documented at [solver.recoilpay.com](https://solver.recoilpay.com).

**→ [Going to production](./going-live)**
