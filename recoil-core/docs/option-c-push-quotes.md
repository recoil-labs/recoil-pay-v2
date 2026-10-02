# RecoilPay Core — Operator Option C Deployment Runbook

This document explains how to operate RecoilPay's push-quote architecture:
the aggregator sources quotes **only** from operators running the dashboard
plus a small fill-worker binary. There is no live-solver HTTP fan-out.

## Architecture at a glance

```
   User / V2 UI
        │ POST /api/v1/quotes
        ▼
┌──────────────────────────────────────────────────────────────────┐
│  AGGREGATOR  (Rust, port 4000)                                   │
│                                                                  │
│  1. handlers/quotes.rs → push_quote_ranker.rs                    │
│     • Loads SolverQuote rows from Postgres                       │
│     • Filters by chain + asset pair, amount range, exclusivity,  │
│       circuit-breaker state                                      │
│     • Scores by output (50%) + reputation (25%) +                │
│       success rate (15%) + latency (10%)                         │
│  2. Returns top-N shaped as OIF v0 quotes with integrity checksum│
│                                                                  │
│  3. POST /api/v1/orders → fill_routing.rs                        │
│     • Looks up the operator that published the winning quote     │
│     • Forwards the signed order to that operator's               │
│       fill-worker URL (POST {worker_url}/fill)                   │
│     • Order enters `Created` → operator's worker fills it        │
│                                                                  │
│  4. POST /solver-api/operators/{id}/fills (operator callback)    │
│     • Worker reports fill outcome                                │
│     • Aggregator updates operator reputation                     │
└──────────────────────────────────────────────────────────────────┘
        ▲                                    ▲
        │ poll/heartbeat                     │
        │                                    │
┌───────┴────────────────────────────────────┴──────────────────────┐
│  OPERATOR'S FILL-WORKER  (Rust binary, 24/7)                     │
│  • Reads SOLVER_ID + OPERATOR_PRIVATE_KEY + AGGREGATOR_URL       │
│  • Registers fill-worker URL on boot                             │
│  • Sends heartbeat every 30 s                                    │
│  • Polls /api/v1/orders, builds + signs the fill, broadcasts     │
│  • Reports outcome → updates reputation                          │
└──────────────────────────────────────────────────────────────────┘
        ▲
        │ dashboard
        │
┌───────┴──────────────────────────────────────────────────────────┐
│  SOLVERS DASHBOARD  (React, browser)                             │
│  • Operator publishes quotes via QuoteMatrix                      │
│  • Configures fill-worker URL via FillWorkerPanel                │
│  • Views reputation, leaderboard, telemetry                       │
└──────────────────────────────────────────────────────────────────┘
```

## Component layout

| Component | Path | Role |
|---|---|---|
| **Aggregator** | `aggregator/` | Public HTTP API. Owns no funds. |
| **`push_quote_ranker`** | `aggregator/crates/service/src/push_quote_ranker.rs` | Selection + scoring algorithm |
| **`FillRouter`** | `aggregator/crates/api/src/fill_routing.rs` | Dispatches signed orders to operators |
| **Operators API** | `aggregator/crates/api/src/handlers/operators.rs` | `/solver-api/operators/*` |
| **Operators table** | `aggregator/crates/storage/migrations/20260727000000_operators.sql` | Postgres schema |
| **Fill-worker** | `aggregator/crates/fill-worker/` | Standalone Rust binary operators run |

## Selection algorithm details

For every `POST /api/v1/quotes` request, the ranker:

1. **Loads** all non-paused, non-expired `SolverQuote`s from `oif_storage`.
2. **Filters** by:
   - `from_chain` and `to_chain` (CAIP-style equality)
   - `from_asset` and `to_asset` (with case + suffix tolerance)
   - input amount within `[min_amount, max_amount]`
   - `exclusive_for` matches the requester (or is null)
   - operator is not circuit-broken
3. **Scores** each surviving candidate with weights
   `output=0.50, reputation=0.25, success_rate=0.15, latency=0.10`:
   ```
   score = 0.50 × output_norm
         + 0.25 × reputation
         + 0.15 × success_rate
         + 0.10 × (1 - latency/1000ms)
   ```
4. **Sorts** by `score` descending and returns the top 50.

`output_norm` is normalised against the best output in the candidate set
(so 1.0 = best quote). `reputation` and `success_rate` come from the
`operators` table; default 0.5 / 1.0 for newcomers.

## Reputation update flow

```
operator → POST /solver-api/operators/{id}/heartbeat         (every 30s)
operator → POST /solver-api/operators/{id}/fills             (per fill outcome)
                ↳ succeeded=true  → fills_total++, fills_succeeded++,
                                     reputation += 0.02, capped at 1.0
                ↳ succeeded=false → fills_total++,
                                     reputation -= 0.10, floored at 0.0
```

Rolling-average latency is updated with EMA, α = 0.3.

## Local development

```sh
# 1. Start Postgres + aggregator
cd recoil-core/aggregator
docker-compose up -d postgres   # if you have docker-compose
cargo run --features postgres

# 2. Open the dashboard
cd ../../solvers
npm run dev   # serves on http://localhost:5174

# 3. Run a fill-worker locally
cd ../recoil-core/aggregator
SOLVER_ID=alice \
OPERATOR_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000001 \
FILL_WORKER_URL=http://localhost:9000 \
AGGREGATOR_URL=http://localhost:4000 \
RUST_LOG=info \
cargo run -p fill-worker --bin fill-worker
```

## Render deployment

The aggregator and Postgres run on Railway. The dashboard is deployed
separately as a prebuilt static site. Operators
deploy their fill-worker themselves — Render, Fly.io, a VPS, anywhere with
a public URL.

Required aggregator env vars:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (operators table lives here) |
| `INTEGRITY_SECRET` | HMAC key for quote checksums (≥32 chars) |
| `RUST_LOG` | Log level (default `info`) |

## API surface added in Option C

```
# Operator reputation
GET    /solver-api/operators
GET    /solver-api/operators/{id}
POST   /solver-api/operators/{id}/worker       # body: { url }
POST   /solver-api/operators/{id}/heartbeat
POST   /solver-api/operators/{id}/fills        # body: { succeeded, latency_ms }
POST   /solver-api/operators/{id}/key          # body: (none) — returns { address, privateKeyHex, deploymentHint }
POST   /solver-api/operators/{id}/api-key      # body: (none) — server-rotated API key, returns { apiKey, apiKeyHash, createdAt }
PUT    /solver-api/operators/{id}/settlement-contract       # body: { chainId, address }
DELETE /solver-api/operators/{id}/settlement-contract?chain_id=N  # returns { removed: 0|1 }
GET    /solver-api/operators/{id}/settlement-contracts       # returns { data: { chainId: address, ... } }

# Push quotes (existing)
POST   /solver-api/quotes                      # body: BatchQuotesSubmitRequest
GET    /solver-api/quotes
POST   /solver-api/quotes/{id}/pause
DELETE /solver-api/quotes/{id}

# Quote dispatch
POST   /api/v1/quotes
POST   /api/v1/orders                         # aggregator forwards to fill-worker + publishes to /ws/orders

# Hardened register (verifies EIP-191 personal_sign signature before storing)
POST   /solver-api/account/register            # body: { address, message, signature, chainId? }

# Real-time order feed — replaces the legacy poll_next_order loop.
# Two auth modes:
#   1. fill-worker: signed headers (x-solver-id + x-auth-*)
#   2. dashboard:   query-string (?api_key=...&solver_id=...) or
#                   header auth (x-api-key + x-solver-id)
GET    /ws/orders?api_key=...&solver_id=...
```

## Operator key management (dashboard-driven)

The aggregator **never stores operator private keys**. Each operator owns
their hot-wallet entirely; the dashboard is the canonical place to mint a
new one.

### Flow

1. Operator opens **Fill Worker** panel in the dashboard.
2. Clicks **Generate Key**.
3. Aggregator (`POST /solver-api/operators/{id}/key`) generates a fresh
   secp256k1 keypair via `oif_types::keygen::generate_random()` and:
   - persists the **address** on the operator row (`operator.wallet_address`),
   - returns `{ address, privateKeyHex, deploymentHint }` in the HTTP
     response.
4. Dashboard surfaces the private key in a one-time warning panel with:
   - Copy-to-clipboard for the address
   - Copy-to-clipboard for the private key (password input — click to reveal)
   - Copy-to-clipboard for the deploy command:
     ```
     OPERATOR_PRIVATE_KEY=0x... AGGREGATOR_URL=<your-aggregator-url> \
       SOLVER_ID=<solver-id> ./fill-worker
     ```
5. Operator pastes the env vars into their fill-worker deployment (Render,
   fly.io, a VPS, etc.) and dismisses the panel.

### Security properties

| Property | Enforced by |
|---|---|
| Aggregator never persists the private key | `generate_operator_key` returns it in the response and does not write it to storage |
| Operator controls when to rotate | Each call generates a fresh keypair; the previous one is invalidated |
| Dashboard keeps key only in component state | React `useState` — cleared on dismiss / unmount |
| Cryptographic correctness | `oif_types::keygen` uses `k256::SecretKey` + Keccak-256 (Ethereum yellow paper recipe); round-trip test verifies `derive_address(pk) == generated.address` |
| Compatibility test | `round_trip_address_derivation` uses the canonical `0x00…01 → 0x7E5F…Bdf` Ethereum test vector |

### Re-generating a key

Rotating the key:
1. Click **Rotate Key** in the dashboard.
2. A new keypair is generated; the previous private key is invalidated.
3. The fill-worker must be redeployed with the new `OPERATOR_PRIVATE_KEY`.

There is no "import existing key" UI in the dashboard — keys are minted
fresh every time. Operators who want to use a hardware wallet or external
key management system should configure the fill-worker binary directly via
its own env vars (out of scope for the dashboard).

## On-chain fill broadcast

The fill-worker signs + broadcasts fill transactions directly to the
destination chain via JSON-RPC. No relayer, no aggregator-side signing.

### Pipeline

```
OrderFillRequest
  ↓
FillRequest { destination_chain_id, settlement_contract, tokens, amounts, ... }
  ↓
tokio::try_join!(
  rpc.latest_block(chain_id),          ── chain head for base_fee_per_gas
  rpc.nonce_at(chain_id, operator),     ── eth_getTransactionCount("pending")
  rpc.estimate_gas(chain_id, &probe)    ── eth_estimateGas + 20% headroom
)
  ↓
build_eip1559_tx(head, nonce, gas_limit, operator)
  ↓
sign_digest(&tx.signature_hash()) ── via the operator's LocalSigner (alloy secp256k1)
  ↓
TxEnvelope::Eip1559(signed)        ── Secp256k1 ECDSA, ecrecoverable
  ↓
envelope.recover_signer()          ── local sanity check (must match operator)
  ↓
envelope.encoded_2718()            ── RLP-encoded EIP-2718 bytes
  ↓
Provider::send_raw_transaction()   ── eth_sendRawTransaction on the chain RPC
  ↓
TxHash                             ── broadcast confirmed
```

### Gas strategy

- **`gas_limit`** = `eth_estimateGas(tx) + 20%` (safety headroom against
  calldata variations). Pulled in parallel with nonce + head via
  `tokio::try_join!` so all three round-trips happen concurrently.
- **`max_priority_fee_per_gas`** = `1 gwei` (constant, suitable for any
  EIP-1559 chain).
- **`max_fee_per_gas`** = `2 × base_fee + priority_fee` (safe headroom
  against next-block base-fee spikes).
- **`nonce`** = `eth_getTransactionCount(operator, "pending")` —
  fetched per-fill so back-to-back transactions don't collide.

### Configuration

The fill-worker takes a `CHAIN_RPCS` env var mapping chain ids to JSON-RPC
URLs:

```sh
CHAIN_RPCS="11155420:https://sepolia.optimism.io,1:https://eth.llamarpc.com" \
  OPERATOR_PRIVATE_KEY=0x... \
  AGGREGATOR_URL=https://aggregator.example.com \
  SOLVER_ID=my-operator \
  ./fill-worker
```

When `CHAIN_RPCS` is empty, `broadcast_fill` falls back to a deterministic
placeholder hash so the order loop can be smoke-tested without burning real
RPC calls. A warning is logged at boot.

### Code locations

| File | Purpose |
|---|---|
| `crates/fill-worker/src/chain_rpc.rs` | `ChainBroadcaster`, `FillRequest`, `sign_and_broadcast_fill`, `ChainRpc` trait |
| `crates/fill-worker/src/auth.rs` | `sign_request`, `apply_signed_headers`, `verify_signed_request`, `NonceCache` |
| `crates/fill-worker/src/broadcaster.rs` | `AggregatorBroadcaster::broadcast_fill`, `subscribe_orders`, `WsOrderSubscription`, signed-header attachment for every outbound call |
| `crates/fill-worker/src/lib.rs::fill_order` | Resolves `settlement_contract` from operator row, builds `FillRequest`, calls `broadcaster.broadcast_fill` |
| `crates/fill-worker/src/lib.rs::fetch_next_order` | Opens a fresh `/ws/orders` subscription and pulls the next order (replaces the deprecated `poll_next_order` HTTP path) |
| `crates/fill-worker/src/main.rs` | Wires `ChainBroadcaster` (from `CHAIN_RPCS`) + `LocalSigner` into the broadcaster |
| `crates/api/src/handlers/operators.rs` | `set_settlement_contract`, `delete_settlement_contract`, `get_settlement_contracts`, `rotate_api_key`, `generate_operator_key` |
| `crates/api/src/handlers/solver_api.rs` | `post_account_register` (EIP-191 verified), `ws_orders` (signed-handshake + `/ws/orders` upgrade), `post_orders` (publishes to the broadcaster) |
| `crates/api/src/order_broadcast.rs` | `OrderBroadcaster` wrapper around `tokio::sync::broadcast` |
| `crates/api/src/auth/fill_worker_auth.rs` | Axum middleware + shared `build_signing_payload` used by both the REST middleware and the `/ws/orders` handshake |
| `crates/storage/migrations/20260727000001_settlement_contracts.sql` | Adds `settlement_contracts JSONB` column on `operators` |
| `solvers/src/services/solverApi.ts` | `deleteSettlementContract` + `DeleteSettlementContractResponseDto` |
| `solvers/src/hooks/use-solver-websocket.ts` | Browser WS hook that attaches `?api_key=…` query-string auth |

### Tests

```
# crates/fill-worker — 23/23 tests
chain_rpc::tests::eip1559_tx_has_correct_chain_id_and_to
chain_rpc::tests::eip1559_tx_rejects_head_without_base_fee
chain_rpc::tests::signed_envelope_recovers_to_operator_address    ← ecrecover
chain_rpc::tests::encoded_envelope_is_valid_2718                 ← type byte 0x02
chain_rpc::tests::from_rpc_map_handles_invalid_url
chain_rpc::tests::no_rpc_for_chain_surfaces_clean_error
chain_rpc::tests::gas_with_headroom_adds_20_percent               ← gas estimate buffer
signer::tests::rejects_short_keys
signer::tests::accepts_prefixed_or_unprefixed_keys
signer::tests::random_keys_are_unique
signer::tests::signature_recovers_to_signer_address               ← canonical ECDSA
config::tests::parses_multiple_chain_entries
config::tests::handles_empty_input
config::tests::handles_whitespace
config::tests::skips_malformed_entries
# Signed-request auth (see "Signed-request auth" section below)
auth::tests::sign_and_verify_roundtrip                             ← ECDSA round-trip
auth::tests::rejects_stale_timestamp                                ← clock window
auth::tests::rejects_solver_mismatch                                ← identity binding
auth::tests::rejects_malformed_signature                            ← format check
auth::tests::nonce_cache_rejects_replay                             ← replay protection
auth::tests::nonce_cache_allows_after_window                        ← TTL eviction
auth::tests::signing_payload_is_stable                              ← deterministic

# crates/oif-api — 12/12 tests
auth::fill_worker_auth::tests::signing_payload_is_stable
auth::fill_worker_auth::tests::nonce_cache_rejects_replay
auth::fill_worker_auth::tests::nonce_cache_evicts_after_window
handlers::solver_api::tests::verify_register_signature_accepts_valid_signature      ← EIP-191 personal_sign ecrecover
handlers::solver_api::tests::verify_register_signature_accepts_unprefixed_address
handlers::solver_api::tests::verify_register_signature_rejects_wrong_message
handlers::solver_api::tests::verify_register_signature_rejects_wrong_address
handlers::solver_api::tests::verify_register_signature_rejects_malformed_signature
handlers::solver_api::tests::verify_signed_ws_handshake_accepts_valid_envelope      ← /ws/orders upgrade path
handlers::solver_api::tests::verify_signed_ws_handshake_rejects_stale_timestamp    ← clock-skew window
handlers::solver_api::tests::verify_signed_ws_handshake_rejects_wrong_path          ← canonical path binding
handlers::solver_api::tests::verify_signed_ws_handshake_rejects_malformed_signature ← format check
order_broadcast::tests::publish_to_zero_receivers_does_not_error                   ← /ws/orders publish path
order_broadcast::tests::subscribe_receives_published_messages                       ← /ws/orders recv path
order_broadcast::tests::lagged_subscriber_surfaces_lagged_error                    ← backpressure
order_broadcast::tests::receiver_count_tracks_subscribers                          ← subscriber tracking
```

**43/43 tests pass** across `fill-worker` + `oif-api` (25 in
`fill-worker` + 16 in `oif-api`). New tests since the last
synchronisation:

- 5 `verify_register_signature_*` tests cover the hardened
  `registerAccountV1` signature verification path (EIP-191
  `personal_sign` via `alloy_primitives::eip191_hash_message` +
  `Signature::recover_address_from_prehash`).
- 4 `order_broadcast::tests::*` tests cover the new `/ws/orders`
  publish/subscribe surface (publish-to-zero, subscribe-and-receive,
  `Lagged` backpressure, subscriber counting).
- 4 `verify_signed_ws_handshake_*` tests cover the extracted
  `/ws/orders` upgrade-handshake verifier (valid envelope, stale
  timestamp, wrong path, malformed signature).
- 2 `tests::backoff_doubles_and_caps` +
  `tests::mock_subscription_yields_events_in_order` cover the new
  persistent fill-worker subscription (exponential backoff curve +
  mock `OrderSubscription` for future orchestrator tests).

### Security notes

- **Local ecrecover check** — after signing, the worker calls
  `envelope.recover_signer()` and confirms it equals the operator's address
  before broadcasting. A bad key fails fast, no RPC call wasted.
- **EIP-2718 encoding** — the exact byte format `eth_sendRawTransaction`
  expects (`type_byte || RLP(payload)`).
- **Alloy 1.x with `k256` feature on `alloy-consensus`** — the
  `SignerRecoverable` impl on `EthereumTxEnvelope<TxEip4844Variant>` is
  gated behind `k256` / `secp256k1` features on the consensus crate.

## Signed-request auth (fill-worker → aggregator)

The fill-worker authenticates every outbound HTTP request with a
**per-request secp256k1 signature** over the canonical payload. The
aggregator validates the signature against the operator's
registered `wallet_address`. This gives us **mTLS-equivalent
authentication** without requiring operators to manage X.509 certs.

### Wire format

```text
GET /api/v1/orders
x-solver-id:        <operator wallet address, lower-case hex>
x-auth-timestamp:   <unix seconds, ±60s validity window>
x-auth-nonce:       <16 random bytes, hex>
x-auth-signature:   <0x-prefixed 65-byte secp256k1 signature>
```

### Signing payload

```text
keccak256("recoilpay-auth\n{solver_id}\n{timestamp}\n{nonce}\n{method}\n{path}")
```

### Server-side verification

1. **Timestamp window** — reject if `|now - timestamp| > 60s`.
2. **Solver-id binding** — `x-solver-id` must match the registered
   operator id (case-insensitive).
3. **Signature recovery** — the secp256k1 signature must ecrecover
   to the claimed `x-solver-id`.
4. **Nonce cache** — the nonce must not have been seen in the last
   5 minutes (replay protection). Implemented as an in-memory TTL
   `Vec<(nonce, timestamp)>` in `AppState::fill_worker_nonce_cache`.

### Failure modes

| Condition | Status | Body |
|---|---|---|
| Missing header | 401 | `{"error": "FILL_WORKER_AUTH_FAILED", "message": "missing x-solver-id"}` |
| Stale timestamp | 401 | `{"error": "FILL_WORKER_AUTH_FAILED", "message": "timestamp out of window"}` |
| Replayed nonce | 401 | `{"error": "FILL_WORKER_AUTH_FAILED", "message": "replayed nonce"}` |
| Signature mismatch | 401 | `{"error": "FILL_WORKER_AUTH_FAILED", "message": "signature does not recover to solver_id"}` |

### Why signed headers vs. real mTLS

- **No certificate management** — operators don't need to generate,
  rotate, or renew X.509 certs. The hot-wallet key they already use
  for on-chain fills is the same key used for request auth.
- **Key reuse** — losing the key compromises both fills AND auth,
  which is the desired property (the key is the operator identity).
- **Easier rotation** — rotating the hot-wallet rotates the auth
  credentials in one step.
- **Path to real mTLS** — when operators need defense-in-depth (e.g.
  compliance), swap the `Broadcaster` impl for one that loads a
  `rustls::ClientConfig` with a client cert + CA bundle. The header
  scheme can stay as a second factor.

### Files

| File | Purpose |
|---|---|
| `crates/fill-worker/src/auth.rs` | `sign_request`, `apply_signed_headers`, `NonceCache`, `verify_signed_request` (client + server) |
| `crates/fill-worker/src/broadcaster.rs` | `AggregatorBroadcaster::signed()` helper attaches the four headers to every outbound request |
| `crates/fill-worker/src/main.rs` | Wires the operator's `OrderSigner` into the broadcaster via `with_signer()` |
| `crates/api/src/auth/fill_worker_auth.rs` | Axum middleware: pulls headers, validates signature + nonce, injects `AuthenticatedSolver` into request extensions |
| `crates/api/src/state.rs` | `fill_worker_nonce_cache: Arc<NonceCache>` added to `AppState` |
| `crates/api/src/lib.rs` (root) | Constructs the nonce cache alongside the rest of `AppState` |

## WebSocket subscription (replaces `poll_next_order`)

Fill-workers no longer poll `/api/v1/orders` every few hundred
milliseconds. Instead, they open a long-lived WebSocket to
`/ws/orders` and the aggregator pushes every newly persisted order
to them as a JSON text frame.

### Handshake

The WebSocket **upgrade** request itself is authenticated — no
unauthenticated client can hold a long-lived socket. Two auth modes
are supported:

| Caller | Auth on the upgrade |
|---|---|
| Fill-worker | The four signed headers (`x-solver-id` + `x-auth-timestamp` + `x-auth-nonce` + `x-auth-signature`). The signing payload is identical to the REST surface: `keccak256("recoilpay-auth\n{solver_id}\n{timestamp}\n{nonce}\nGET\n/ws/orders")`. ecrecover is performed **before** the upgrade is accepted. |
| Dashboard | `?api_key=…&solver_id=…` query string (browsers can't attach custom headers) OR `x-api-key` + `x-solver-id` headers (non-browser clients). The API key is validated by the same `ApiKeyAuthenticator` used by the REST endpoints. |

A failure on either path returns a 401 JSON response with
`{"error": "WS_HANDSHAKE_FAILED", "message": "…"}` — the socket is
never opened.

### Wire format

After the handshake, every JSON text frame is wrapped as:

```json
{
  "status": "order",
  "order": { /* OrderResponse payload (camelCase) */ }
}
```

Plus a single `{"status": "connected", "solver_id": "…"}` hello
frame right after the upgrade, and an occasional
`{"status": "lagged", "dropped": N}` heartbeat when the in-memory
broadcast channel overflows.

### Backpressure

The aggregator's broadcast channel uses `tokio::sync::broadcast`
with capacity 1024. When a slow subscriber's inbox fills past the
capacity the **oldest** message is evicted; the next `recv()` on the
server side surfaces `RecvError::Lagged(n)` which we relay to the
client as the heartbeat frame above and continue. The client is
expected to recover (e.g. by reopening the subscription or falling
back to the deprecated polling endpoint).

### Server side

- **`crates/api/src/order_broadcast.rs`** — `OrderBroadcaster`
  wrapper around `broadcast::Sender<serde_json::Value>`. Cloning is
  `Arc`-cheap, and `publish()` is a non-blocking `send()` that
  returns the subscriber count (zero subscribers = no-op).
- **`crates/api/src/state.rs`** — `order_broadcaster: OrderBroadcaster`
  field on `AppState`.
- **`crates/api/src/handlers/orders.rs::post_orders`** — every
  successfully persisted order is serialized and pushed onto the
  broadcaster; failure is non-fatal (the worker can still poll).
- **`crates/api/src/handlers/solver_api.rs::ws_orders`** — the
  upgrade handler, with the dual-auth handshake and the read loop.

### Client side (fill-worker)

- **`crates/fill-worker/src/broadcaster.rs::WsOrderSubscription`** —
  generic over any `Stream<Sink>` so tests can swap in an
  in-memory channel. Implements `OrderSubscription::next_event()`
  which classifies each text frame into an `OrderEvent::{Order,
  Lagged, Closed}` and replies to ping frames with pongs. The
  running `Lagged` total is exposed via `lagged_count()` so the
  orchestrator can decide when to drop and reconnect.
- **`crates/fill-worker/src/broadcaster.rs::AggregatorBroadcaster::subscribe_orders`** —
  performs the signed handshake on the upgrade request using
  `auth::sign_request`. Replaces the legacy
  `AggregatorBroadcaster::poll_next_order` HTTP path.
- **`crates/fill-worker/src/lib.rs::order_loop`** — holds a single
  `Box<dyn OrderSubscription>` across iterations and reconnects with
  exponential backoff (500 ms → 1 s → 2 s → 4 s → 8 s → 16 s →
  capped at 30 s) when the stream closes or when the cumulative
  `Lagged` count crosses `MAX_LAGGED_BEFORE_RECONNECT` (64). A
  successful fill cycle resets the backoff so a single reconnect
  doesn't permanently degrade us.

### Client side (dashboard)

- **`solvers/src/hooks/use-solver-websocket.ts`** — reads the
  stored API key from `localStorage` and attaches it as a
  query-string parameter on the WebSocket URL, then unwraps the
  `{ "status": "order", "order": … }` envelope into the legacy
  `SolverWebSocketMessage` shape the components consume.
- **`solvers/src/pages/OrdersPage.tsx`** — merges the WS feed into
  the order table by upserting each `OrderResponse` frame on top of
  the REST-poll results. A live-status indicator (green dot +
  "WebSocket Live" / grey dot + "WS Offline — Polling") sits next
  to the refresh button so operators can see the connection state at
  a glance.

## Persistent subscription (single socket per worker)

Earlier iterations opened a fresh signed WebSocket per `process_one`
call. The current implementation keeps a single WebSocket open for
the lifetime of the fill-worker:

1. On boot, `order_loop` calls `subscribe_orders` once and holds the
   resulting `Box<dyn OrderSubscription>`.
2. Each `process_one` reads one `OrderEvent::Order` from the
   subscription, fills it, reports the outcome, and pulls the next.
3. The orchestrator reacts to other event variants:
   - `OrderEvent::Lagged(n)` → log + drop and reconnect when
     `lagged_count() >= 64`.
   - `OrderEvent::Closed` → drop and reconnect.
   - `next_event()` error → drop and reconnect.
4. Backoff is exponential (500 ms doubling, 30 s cap) and resets to
   the base on every successful reconnect or fill cycle.

This eliminates one signed handshake per fill (the previous design
signed a fresh request every iteration) and keeps the connection
warm so the aggregator's broadcast channel doesn't drain messages
into a slow-subscriber backlog.

### Failure modes

| Condition | Behaviour |
|---|---|
| Server closes the socket cleanly | Drop subscription, reconnect after `BASE_BACKOFF` |
| Stream errors (TLS, parse, etc.) | Drop subscription, reconnect after `BASE_BACKOFF` (resets on success) |
| Aggregator reports `Lagged` and total crosses 64 | Drop subscription, reconnect |
| Persistent failure | Backoff doubles up to 30 s, then plateaus |

## Migration from old push-only mode

If you're running an earlier aggregator that fabricates `oif-escrow-v0`
envelopes but doesn't actually fill orders, this change is **not
backwards-compatible**. Before deploying:

1. Apply the operators migration: `20260727000000_operators.sql`
2. Each operator must run a fill-worker and register its URL via the
   dashboard's **Fill Worker** tab. Quotes published before a worker is
   registered will be ignored by the ranker (operator will appear
   "circuit-broken" effectively).
3. Any orders submitted while no operator was reachable will hang in
   `Created` until the order expiry. Increase quote `validUntil` to give
   operators time to register.

## Limitations & roadmap

- **Reputation decay** — operators who go silent don't decay yet; we
  decay toward 0.5 after 24 h of inactivity in a follow-up.
- **Price normalisation** — the ranker currently treats every token as
  $1; integrating the CoinGecko/DefiLlama feeds will let the score
  weight cross-token output more accurately.
- **Order routing on failure** — currently `POST /api/v1/orders`
  succeeds even if fill-worker dispatch fails. A retry queue with
  backoff is on the roadmap.
- **Hardware-wallet signer** — the `OrderSigner` trait supports any
  secp256k1 backend; a `LedgerSigner` / `RemoteSigner` variant for
  operators who prefer not to hold a hot key is a future addition.
- **Per-operator WebSocket fan-out** — the broadcaster pushes every
  order to every subscriber; filtering by `solver_id` is left to the
  client. A per-operator channel sharded by solver_id is on the
  roadmap for >1k connected fill-workers.