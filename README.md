# Recoil Pay — v2

Monorepo for the v2 cross-chain intent platform: the settlement core, the
intent UI, and the solver operator portal.

| Directory               | What it is                                          | Stack              |
|-------------------------|-----------------------------------------------------|--------------------|
| `linkiswap-core/`       | Aggregator, fill worker, solver, Solana settler     | Rust + Anchor      |
| `linkiswap-website-v2/` | Intent UI — natural-language swap entry             | React + Vite       |
| `solvers/`              | Solver operator portal — onboarding, quotes, orders | React + Vite       |
| `recoilpay-intent-kit/` | Embeddable intent SDK — `@recoilpay/intent-core` (headless flow), `@recoilpay/intent-react` (drop-in component); hosted widget next | TypeScript |

Directory names still carry the old brand; renaming them touches every
Dockerfile and Cloud Build path, so it is deliberately deferred to the
rebrand pass rather than bundled into the migration.

## How a swap settles

Settlement uses OIF escrow across two chains, driven by the fill worker
in three on-chain stages:

1. **`openFor`** on the origin chain — escrows the user's input, authorised
   by a Permit2 `PermitBatchWitnessTransferFrom` signature.
2. **`fill`** on the destination chain — the fill wallet pays the user out
   of its own inventory. The worker checks its allowance first and sends
   an infinite `approve` to the output settler if it is short.
3. **`finalise`** back on the origin chain — releases the escrow to the
   solver.

The fill wallet therefore needs gas on **both** chains and token
inventory on the **destination** chain.

Orders reach solvers through a durable Postgres claim queue using
`FOR UPDATE SKIP LOCKED` with leases. The WebSocket broadcast is only a
latency hint — it is explicitly not the delivery mechanism, because a
fire-and-forget broadcast silently dropped orders.

## Local development

```sh
cd linkiswap-core/aggregator && cargo build
cd linkiswap-website-v2      && npm install --legacy-peer-deps && npm run dev
cd solvers                   && npm install && npm run dev
cd recoilpay-intent-kit      && npm install && npm test
```

`--legacy-peer-deps` is required for the intent UI: RainbowKit 2.x
declares a peer of wagmi@^2 while the app runs wagmi@3, which works at
runtime but fails npm's strict peer resolution.

Copy `.env.example` to `.env` where provided. Real `.env` files are
gitignored and must never be committed.

## Deployment

Cloud Run in GCP project `recoillabs` (us-central1). The aggregator image
contains both the `oif-aggregator` and `fill-worker` binaries; the two
services differ only by entrypoint.

Cloud Build requires `DOCKER_BUILDKIT=1` for the Rust image — the
Dockerfile uses `--platform=${BUILDPLATFORM}` and `--mount=type=cache`,
and the legacy builder leaves `BUILDPLATFORM` empty and fails at the
first `FROM`.
