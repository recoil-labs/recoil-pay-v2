# RecoilPay Core

**Intent-based cross-chain execution — powered by natural language.**

A user types `swap 1 USDC on OP Sepolia for USDC on Polygon Amoy`, an LLM turns that sentence into a structured intent, and a solver executes it end-to-end across chains. This repository holds every service required to run that experience: the solver, the aggregator, the OIF developer testing UI, and the RecoilPay V2 product UI — wired for a one-click deployment on Render.

> For the product story (what RecoilPay is, who it is for, and why intents matter), read [`docs/product-description.md`](./docs/product-description.md).

---

## Contents

- [What's in this repo](#whats-in-this-repo)
- [Architecture at a glance](#architecture-at-a-glance)
- [End-to-end flow](#end-to-end-flow)
- [Repository layout](#repository-layout)
- [Local development](#local-development)
- [Deployment (Render)](#deployment-render)
- [Configuration reference](#configuration-reference)
- [Supported networks](#supported-networks)
- [Documentation](#documentation)
- [Provenance and license](#provenance-and-license)

---

## What's in this repo

RecoilPay ships as four cooperating services plus a shared Redis:

| Component | Path | Role | Language |
|---|---|---|---|
| **Solver** | `solver/` | Discovers, prices, fills, and settles cross-chain intents. Private service. | Rust |
| **Aggregator** | `aggregator/` | Public HTTP API that fans out quote requests to all healthy solvers. | Rust |
| **OIF tester UI** | `aggregator/demo/` | Developer-facing, form-based swap UI (forked from OIF). | React 18 / TypeScript |
| **RecoilPay V2 UI** | `recoil-website-v2/` | Product UI — natural-language intent bar backed by an LLM. | React 19 / TypeScript |
| **Redis** | *(managed)* | Runtime store for solver config and order state. | — |

The V2 UI is the user-facing front door; the OIF tester UI is kept for developer/QA workflows against the aggregator's OpenAPI surface.

---

## Architecture at a glance

```
   ┌──────────────────────────────────────────────────────────────┐
   │  User (browser)                                              │
   │  "swap 1 USDC on OP Sepolia for USDC on Polygon Amoy"        │
   └────────────────────────────┬─────────────────────────────────┘
                                │ natural language
   ┌────────────────────────────▼─────────────────────────────────┐
   │  RecoilPay V2 UI  (recoil-website-v2)                     │
   │  React 19 · wagmi · RainbowKit                               │
   │                                                              │
   │    ┌────────────────────────────────────────────────┐        │
   │    │  Hugging Face Inference API                    │        │
   │    │  Qwen/Qwen2.5-Coder-32B-Instruct               │        │
   │    │  sentence  →  RawIntent[] (JSON)               │        │
   │    └──────────────────────┬─────────────────────────┘        │
   │                           │                                  │
   │    validate → resolve → quote → sign(EIP-712) → submit       │
   └───────────────────────────┬──────────────────────────────────┘
                               │ REST  (POST /api/v1/quotes, /orders)
                ┌──────────────▼───────────────┐
                │  Aggregator  (Rust / Axum)   │
                │  parallel solver fan-out     │
                │  integrity checksums         │
                │  circuit breakers + jobs     │
                └──────────────┬───────────────┘
                               │ OIF v1 (HTTP + JWT)
                ┌──────────────▼───────────────┐
                │  Solver  (Rust workspace)    │
                │  discover → validate         │
                │  → fill → settle             │
                └──┬───────────────────────┬───┘
                   │                       │
        ┌──────────▼───────┐   ┌───────────▼─────────────────┐
        │  Redis           │   │  EVM testnets               │
        │  runtime config  │   │  OP Sepolia · Base Sepolia  │
        │  + order state   │   │  Polygon Amoy · Eth Sepolia │
        └──────────────────┘   └─────────────────────────────┘
```

**The AI never moves money.** The LLM only *proposes* a structured intent. Alias resolution, support-set validation, address canonicalisation (`viem.getAddress`), and the EIP-712 signature all happen in deterministic client-side code before any transaction is signed. See [`docs/product-description.md`](./docs/product-description.md) for the full safety envelope.

---

## End-to-end flow

1. **Sentence in.** User types into the intent bar (`IntentBar.tsx`). Empty input is rejected; anything else goes to `parseIntent()`.
2. **AI extraction.** `parseIntent()` calls Hugging Face with a strict system prompt that inlines the target `RawIntent` TypeScript interface and instructs the model to emit JSON only, using `null` for missing slots. Multi-intent sentences ("swap X and then send Y") return an array.
3. **Validation.** `validateIntent()` runs every slot against the live support set fetched from `GET /api/v1/solvers`. It collects **all** issues at once (missing / unknown / unsupported) so the user fixes everything in one edit.
4. **Resolution.** `resolveIntent()` produces a `ResolvedIntent` with checksummed addresses and base-unit amounts.
5. **Quote.** `POST /api/v1/quotes` on the aggregator fans the request out to every healthy solver; the aggregator returns the best quote, tagged with a cryptographic integrity checksum.
6. **Approval + signature.** If the escrow route is used, the UI checks Permit2 allowance and prompts for approval, then requests an EIP-712 signature over the quote.
7. **Submission.** `POST /api/v1/orders` submits the signed order. The aggregator re-validates the integrity checksum before forwarding to the solver.
8. **Execution.** The solver picks the intent up, fills on the destination chain, then claims its reimbursement from source-chain escrow after oracle attestation.
9. **Tracking.** The UI polls `GET /api/v1/orders/{id}` until the order reaches a terminal state (`settled` for the user, `finalized` once the solver has reclaimed escrow).

---

## Repository layout

```
recoil-core/
├── solver/                      Rust workspace — the OIF solver
│   ├── crates/                  14 modular crates (core, delivery, settlement, ...)
│   ├── config/                  Bootstrap seeds (testnet, mainnet, hyperlane, ...)
│   └── Dockerfile
├── aggregator/                  Rust workspace — quote/order aggregation service
│   ├── crates/                  types, service, adapters, api, storage, config
│   ├── config/                  Aggregator settings
│   ├── demo/                    OIF developer testing UI (React 18)
│   └── Dockerfile
├── recoil-website-v2/        RecoilPay V2 product UI (React 19)
│   ├── src/intent/              LLM extractor, alias registry, validator, resolver
│   ├── src/hooks/useIntent.ts   The end-to-end flow state machine
│   ├── src/oif/                 Aggregator client, EIP-712 signer, Permit2 helpers
├── docs/
│   ├── product-description.md   Product-level overview (start here for context)
│   ├── add-testnet-chains.md    Runbook for extending the solver to a new chain
│   └── option-c-push-quotes.md  Push-quote architecture: dashboard + fill-worker
```

> `recoil-website-v2/` is tracked as a **gitlink** (nested git repository) rather than a submodule. A plain `git clone` will leave the folder empty. If you need the source locally, clone the V2 repo separately into that path.

---

## Local development

### Prerequisites

- Rust `1.88+` (see `solver/rust-toolchain.toml`) with `cargo`
- Docker (for Redis)
- Node.js `20+` and `npm` (for the UIs)
- A funded testnet wallet if you want to sign real orders (Optimism Sepolia, Base Sepolia, Polygon Amoy, or Ethereum Sepolia)

### 1. Start Redis

```sh
docker run -d --rm --name recoilpay-redis -p 6379:6379 redis:7
```

### 2. Run the solver

```sh
cd solver

export REDIS_URL=redis://localhost:6379
export STORAGE_BACKEND=redis
export SOLVER_PRIVATE_KEY=0x<your-funded-testnet-key>
export JWT_SECRET=$(openssl rand -hex 32)

cargo run --bin solver -- \
  --bootstrap-config config/testnet-mine-bootstrap.json \
  --force-seed
```

The solver seeds its `OperatorConfig` into Redis on first boot, then serves the OIF v1 API on `http://127.0.0.1:3000`.

### 3. Run the aggregator

```sh
cd aggregator

export INTEGRITY_SECRET=$(openssl rand -hex 32)
cargo run
```

The aggregator listens on `http://127.0.0.1:4000`. Its default `config/config.json` points at the local solver.

### 4a. Run the OIF tester UI

```sh
cd aggregator/demo
npm install
VITE_API_BASE_URL=http://127.0.0.1:4000 npm run dev
```

Open http://localhost:5173.

### 4b. Run the RecoilPay V2 UI

```sh
cd recoil-website-v2
cp .env.example .env
# set VITE_HF_ACCESS_TOKEN, VITE_WALLETCONNECT_PROJECT_ID (optional), VITE_OIF_API_BASE_URL
npm install --legacy-peer-deps
npm run dev
```

Open http://localhost:5173. Without a valid `VITE_HF_ACCESS_TOKEN` the intent bar will surface an "NLP parsing unavailable" hint and refuse to parse.

---

## Deployment (Render)

Everything runs on Railway, in the `recoilpay` project. The aggregator deploys with `railway up recoil-core --path-as-root -s aggregator` — the upload root must be `recoil-core`, because the service's own root directory is `aggregator`.

To deploy the core stack:

1. **Render Dashboard → New → Blueprint → connect this repo → Apply.**
2. Fill in the `sync: false` secrets in the dashboard after the initial apply:
   - `SOLVER_PRIVATE_KEY` — the wallet that pays for fills and settlements (must be funded on every supported chain).
   - `JWT_SECRET` — ≥32 random bytes.
   - `INTEGRITY_SECRET` — ≥32 random bytes.
3. Trigger a manual deploy on `oif-solver` and `oif-aggregator` (autoDeploy is off by default).

To deploy the V2 UI separately:

1. **Render Dashboard → New → Blueprint → point at `recoil-website-v2/` → Apply.**
2. Add `VITE_HF_ACCESS_TOKEN` as a Railway variable (Hugging Face token — the free tier is enough). It is deliberately not committed.

Both Rust services build from Chainguard base images (`cgr.dev/chainguard/rust:latest-dev` → `wolfi-base`) and run as `nonroot`.

---

## Configuration reference

### Solver (`oif-solver`)

| Variable | Purpose | Default |
|---|---|---|
| `SOLVER_PRIVATE_KEY` | Signer for fills and settlements (secret) | — required |
| `JWT_SECRET` | Admin API bearer secret (≥32 bytes) | — required |
| `REDIS_URL` | Runtime config + state store | `redis://localhost:6379` |
| `STORAGE_BACKEND` | `redis` (default) or `file` | `redis` |
| `COINGECKO_API_KEY` | Price oracle for the cost model | — optional |
| `RUST_LOG` | tracing filter | `info` |

Bootstrap config lives in `solver/config/*.json` and is loaded once via `--bootstrap-config` + `--force-seed`.

### Aggregator (`oif-aggregator`)

| Variable | Purpose | Default |
|---|---|---|
| `INTEGRITY_SECRET` | HMAC key for quote integrity checksums (≥32 bytes) | — required |
| `RUST_LOG` | tracing filter | `info` |

Runtime settings live in `aggregator/config/config.json` (server port, solver endpoints, aggregation timeouts, rate limits).

### OIF tester UI (`oif-ui`)

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Aggregator base URL |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect project id (optional for injected wallets) |
| `VITE_RPC_URL_<chainId>` | Per-chain RPC overrides (public defaults are used otherwise) |

### RecoilPay V2 UI (`recoil-v2`)

| Variable | Purpose |
|---|---|
| `VITE_OIF_API_BASE_URL` | Aggregator base URL |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect project id (optional for injected wallets) |
| `VITE_HF_ACCESS_TOKEN` | Hugging Face Inference API token — required for the LLM intent extractor |
| `NPM_CONFIG_LEGACY_PEER_DEPS` | Must be `true` on Render (RainbowKit peers `wagmi@^2`, app uses `wagmi@3`) |

---

## Supported networks

The live deploy uses the "direct" settlement path with the canonical OIF `InputSettlerEscrow` / `OutputSettlerSimple` contracts and an `AlwaysYesOracle`. Routes are all-to-all between the four chains below.

| Chain | Chain ID | Tokens |
|---|---|---|
| Optimism Sepolia | `11155420` | USDC, USDT |
| Base Sepolia | `84532` | USDC |
| Polygon Amoy | `80002` | USDC |
| Ethereum Sepolia | `11155111` | USDC |

Adding a new chain is documented in [`docs/add-testnet-chains.md`](./docs/add-testnet-chains.md). Mainnet configuration exists at `solver/config/seed-overrides-mainnet.json` but is not currently deployed.

---

## Documentation

- [`docs/product-description.md`](./docs/product-description.md) — Product overview, principles, vision.
- [`docs/add-testnet-chains.md`](./docs/add-testnet-chains.md) — Runbook for expanding solver coverage.
- [`docs/option-c-push-quotes.md`](./docs/option-c-push-quotes.md) — Push-quote architecture: how the dashboard + fill-worker replace the live-solver binary.
- Per-crate notes live in `solver/crates/*/AGENTS.md` (service, core, demo, e2e-tests).
- V2 UI design notes: `recoil-website-v2/docs/{intent-parser-design,intent-execution-plan,oif-integration-and-rebrand}.md`.

---

## Provenance and license

- **Solver** — forked from [`openintentsframework/oif-solver`](https://github.com/openintentsframework/oif-solver) (MIT, OpenZeppelin).
- **Aggregator + OIF tester UI** — forked from [`openintentsframework/oif-aggregator`](https://github.com/openintentsframework/oif-aggregator) (MIT).
- **RecoilPay V2 UI, deployment configuration, and product integration** — original RecoilPay work.

Upstream MIT terms apply to the forked components; see the respective source headers for details.
