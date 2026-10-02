-- Workers table — registry of fill-worker instances.
--
-- Separate from `operators` because the worker is **multi-tenant**: a
-- single worker fleet fills orders for every operator on the platform.
-- Operators register via the dashboard and live in `operators`; workers
-- register themselves on boot (via `POST /solver-api/workers/{id}`)
-- and live here.
--
-- The `worker_id` is the lower-cased wallet address the worker derived
-- from its locally-generated secp256k1 keypair (see
-- `crates/fill-worker/src/main.rs` `bootstrap_if_empty`).
--
-- The row is idempotent on `worker_id`: `register_worker` is a no-op if
-- the worker has already registered, and `worker_heartbeat` is a no-op
-- if no row exists (so a worker that just crashed and is restarting can
-- keep heartbeating without a race against its own register call).
CREATE TABLE IF NOT EXISTS workers (
    worker_id        VARCHAR(255) PRIMARY KEY,
    public_url       TEXT NOT NULL,
    last_active_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workers_last_active ON workers(last_active_at DESC);