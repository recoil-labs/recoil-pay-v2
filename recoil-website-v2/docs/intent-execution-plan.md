# Intent-Based Execution — Implementation Plan

How `recoil-website-v2` (the intent UI) plugs into `/oif` (the Open Intents Framework
execution engine) to turn a typed sentence into a real cross-chain settlement.

Companion doc: [`intent-parser-design.md`](./intent-parser-design.md) (the sentence → structured
intent layer). This doc covers everything from the structured intent down to on-chain settlement.

---

## 1. Goal

```
User types:  "swap 100 USDC on Base for ETH on Arbitrum"
                         │
                         ▼   one signature, no chain/bridge/route picking
            assets arrive on the destination chain
```

Replace V2's mock SwapWidget with a working client that: parses the intent → gets competing solver
quotes from the OIF aggregator → has the user sign **one** order → submits it → tracks settlement.

---

## 2. What OIF actually is here

`/oif` is the engine for every layer below "RecoilPay Interface" in the architecture diagram:

```
User → RecoilPay Interface (this repo)
        │  POST /api/v1/quotes
        ▼
     Aggregator  ──fans out to──▶  Solver Network ──▶ Liquidity ──▶ Settlement (escrow contracts)
   (oif-aggregator, :4000)          (oif-solver, :3000)              (oif-contracts on-chain)
```

The aggregator is the **only** thing the frontend talks to. Live deployment (from earlier work):

- **Aggregator:** `https://api.recoilpay.com`  (local dev: `http://127.0.0.1:4000`)
- Base path: `/api/v1`

### ⚠️ Reality gap — read before scoping

The live OIF stack today is a **testnet demo**:

- Only **USDC** between **OP Sepolia (11155420)** and **Base Sepolia (84532)**.
- Settlement uses **AlwaysYesOracle** — fine for a demo, **not secure for real value**.
- Mainnet examples in the marketing copy (`Base`, `Arbitrum`, `ETH`) **cannot execute yet**.

So Phase 1–4 deliver a **working testnet intent flow**. Mainnet / more chains / a real oracle is an
**OIF-side** expansion (out of scope for this repo) tracked in §8. The parser's support layer
(`GET /api/v1/solvers`) keeps the UI honest: it only accepts what solvers actually offer.

---

## 3. End-to-end data flow

```
IntentBar (type sentence, Enter)
   │  parse + validate + resolve            ── src/intent/  (see parser design doc)
   ▼
ResolvedIntent  { srcChainId, dstChainId, inputToken, inputAmount, outputToken, user, recipient }
   │  buildQuoteRequest()                   ── src/oif/buildQuoteRequest.ts
   ▼
POST /api/v1/quotes  → QuotesResponse       ── src/oif/client.ts
   │  pick best quote (lowest cost / eta)
   ▼
Confirm Card  "Pay 100 USDC on Base → ~0.028 ETH on Arb · eta 30s · 3 solvers"
   │  user clicks Confirm
   ▼
[ if escrow-v0 ] ensure Permit2 allowance on inputToken  (approve once)
   │
   ▼
wallet signs quote.order.payload (EIP-712)  ── src/oif/quoteSigner.ts (ported from demo)
   │
   ▼
POST /api/v1/orders { quoteResponse, signature }  → { orderId }
   │
   ▼
poll GET /api/v1/orders/{orderId} every ~2s until terminal
   │
   ▼
Status UI:  pending → executing → executed → settled → finalized   (or failed / refunded)
```

---

## 4. The OIF API contract (verified against `/oif`)

| Step | Method / path | Sends | Gets back |
|---|---|---|---|
| Discover assets | `GET /api/v1/solvers` | — | `supportedAssets.assets[] {chainId, symbol, address, decimals}` |
| Quote | `POST /api/v1/quotes` | `QuoteRequest` (below) | `QuotesResponse { quotes[], totalQuotes, metadata }` |
| Submit | `POST /api/v1/orders` | `{ quoteResponse, signature, originSubmission? }` | `OrderResponse { orderId, status, ... }` |
| Status | `GET /api/v1/orders/{id}` | — | `OrderResponse` (poll) |

### QuoteRequest mapping (ResolvedIntent → request body)

Addresses are **ERC-7930 InteropAddresses** (hex), not plain `0x` addresses. Build them from
`(chainId, address)` — port the encoder from the demo (`oif-aggregator/demo/src/utils/`), or build
from CAIP-10 text `eip155:<chainId>:0x<addr>`.

```jsonc
{
  "user":   "<interop(srcChainId, user)>",
  "intent": {
    "intentType": "oif-swap",
    "inputs":  [ { "user":     "<interop(srcChainId, user)>",
                   "asset":    "<interop(srcChainId, inputToken)>",
                   "amount":   "<inputAmount base units, string>" } ],
    "outputs": [ { "receiver": "<interop(dstChainId, recipient)>",
                   "asset":    "<interop(dstChainId, outputToken)>" } ],   // amount omitted for exact-input
    "swapType": "exact-input",
    "minValidUntil": 600,
    "preference": "price"
  },
  "supportedTypes": ["oif-escrow-v0"],
  "solverOptions": { "timeout": 4000, "solverTimeout": 2000, "minQuotes": 1 }
}
```

`send` = same shape with `outputs[0].receiver` = the recipient and `outputToken == inputToken`.

### Signing (quote → signature)

`quote.order.type` selects the scheme (port `signQuote()` from the demo's `quoteSigner.ts`):

- **`oif-escrow-v0`** → Permit2 `PermitBatchWitnessTransferFrom`, signature prefixed `0x00`.
  Requires a one-time **Permit2 approval** of the input token (`0x000000000022D473030F116dDEE9F6B43aC78BA3`).
- `oif-3009-v0` → EIP-3009 `TransferWithAuthorization`, prefix `0x01`.
- `oif-resource-lock-v0` → TheCompact `BatchCompact`, ABI-encoded `(sponsorSig, allocatorSig)`.

We target **escrow-v0** first (it's what the live demo uses). The signed payload is the
`quote.order.payload` EIP-712 typed data — domain/types/message come straight from the quote.

### Order status values

`created → pending → executing → executed → settled → settling → finalized` (terminal).
Failure: `failed(type, reason)` (terminal); `refunded` (terminal). Poll until terminal.

---

## 5. Module layout to add (in this repo)

```
src/
  intent/                 # parser (see parser design doc) — grammar, registry, validate, resolve
  oif/
    client.ts             # getSolvers(), getQuote(), submitOrder(), getOrder()
    interop.ts            # ERC-7930 InteropAddress encode/decode (port from demo)
    buildQuoteRequest.ts  # ResolvedIntent -> QuoteRequest
    quoteSigner.ts        # signQuote() — ported from oif-aggregator/demo/src/utils/quoteSigner.ts
    permit2.ts            # allowance check + approve(inputToken, Permit2)
    types.ts              # QuoteRequest/Response, OrderRequest/Response (mirror aggregator structs)
  wallet/
    config.ts             # wagmi + viem config (chains: OP/Base Sepolia to start)
    WalletProvider.tsx     # RainbowKit/wagmi provider wrapping <App/>
  components/
    IntentBar.tsx         # (exists) — make it a live input: onEnter -> parse pipeline
    IntentConfirmCard.tsx # NEW — quote preview, approve, sign, submit
    OrderStatus.tsx       # NEW — poll + render lifecycle
  hooks/
    useIntent.ts          # orchestrates parse -> quote -> sign -> submit -> poll
env:
  VITE_OIF_API_BASE_URL   # https://api.recoilpay.com (or http://127.0.0.1:4000)
  VITE_WALLETCONNECT_PROJECT_ID
```

### Dependencies to add

`wagmi`, `viem`, `@rainbow-me/rainbowkit`, `@tanstack/react-query`. (The repo currently has **no
web3 deps** — this is the foundation layer.)

### Reuse from `/oif` demo (don't rewrite)

- `quoteSigner.ts` — the entire EIP-712 signing logic (3 schemes).
- The InteropAddress (ERC-7930) encoder util.
- The wagmi/RainbowKit wallet + signing setup (the demo already ships OP/Base/Eth Sepolia).

---

## 6. Phased plan

### Phase 0 — Web3 foundation
- Add wagmi/viem/RainbowKit/react-query; wrap `<App/>` in providers.
- Replace `Nav.tsx`'s fake connect toggle (`useState(connected)`, hardcoded `0x7a3…F2e9`) with a
  real Connect button.
- Add `VITE_OIF_API_BASE_URL`; thin `src/oif/client.ts` with `getSolvers()` proven against the live
  aggregator.
- **Done when:** wallet connects on OP/Base Sepolia and `getSolvers()` returns the USDC asset list.

### Phase 1 — Intent parser (parser design doc)
- Implement `src/intent/{grammar,registry,validate,resolve,types}.ts` + `grammar.test.ts`.
- Registry support layer loads from `getSolvers()`.
- **Done when:** the two example sentences produce the exact RawIntent / ValidationIssue output in
  the design doc, with all-at-once field-named errors.

### Phase 2 — OIF client + order builder
- `interop.ts`, `buildQuoteRequest.ts`, typed `client.ts` (quote/submit/get), `quoteSigner.ts`,
  `permit2.ts`.
- **Done when:** a hardcoded ResolvedIntent (USDC OP→Base Sepolia) returns a real quote from the
  live aggregator.

### Phase 3 — UI flow
- `IntentBar` becomes a live input (Enter runs the pipeline; show off-template hint + validation
  issues inline).
- `IntentConfirmCard` — best-quote preview (pay / receive / eta / # solvers), Permit2 approve step,
  sign, submit.
- `OrderStatus` — poll `/orders/{id}`, render lifecycle to terminal.
- `useIntent` orchestrates the whole thing.
- **Done when:** typing `swap 1 USDC on op sepolia for USDC on base sepolia` runs end-to-end to
  `finalized` with funds moving on testnet (the proven happy path).

### Phase 4 — Guardrails & polish
- Inline error rendering; testnet banner; "supported today" hint sourced from `getSolvers()`.
- i18n: add parser error strings to `src/i18n/locales/*` (note: wire up the unused `ja`/`ko`
  locales while here — they exist on disk but aren't registered in `src/i18n/index.ts`).
- Balance check before quote; quote `validUntil` expiry handling; refund/failed messaging.

---

## 7. Key risks / decisions

| Topic | Note / decision |
|---|---|
| **Testnet-only today** | Be explicit in the UI. Don't let marketing copy imply mainnet works. |
| **AlwaysYesOracle** | Demo-grade settlement; not secure. Real value needs a real oracle (OIF side). |
| **InteropAddress encoding** | Easy to get wrong; reuse the demo encoder + unit-test round-trips. |
| **Permit2 approval UX** | First swap needs an approve tx before sign. Detect allowance, prompt once. |
| **Quote expiry** | Quotes have `validUntil`; re-quote if the user dawdles on the confirm card. |
| **EVM-only** | OIF here is EVM-only. `solana`/`SOL` aliases parse but resolve to unsupported until OIF adds non-EVM. Keep the alias, gate on the support layer. |
| **Pricing 429** | The solver prices via CoinGecko; on shared IPs it rate-limits (needs `COINGECKO_API_KEY` on the solver — already handled on Render). Quote failures may trace back to this. |

---

## 8. Out of scope (this repo)

- Expanding OIF to mainnet, more chains/tokens, or a production oracle — that's `/oif` /
  `recoil-core` work.
- Fiat on/off-ramp actions (`buy`, `sell`, `cash out`, `gift card`) — not OIF; keep as V1 flows.
- LLM free-form parsing — deliberately deferred; fixed templates only (see parser design doc §6).
