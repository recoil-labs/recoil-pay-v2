-- Settlement contracts per operator per chain.
--
-- Each operator row holds a JSONB object keyed by chain_id (decimal
-- string) with the deployed settlement contract address as the value.
-- The shape is identical to the in-memory backend's
-- `settlement_contracts: HashMap<u64, String>` field, so read/write
-- code is unchanged between backends.
--
-- JSONB over a separate child table was chosen because:
--   * Reads are always "by operator + chain" — we already have the row.
--   * Writes are append-only JSON merges; no FK cascade overhead.
--   * It survives operators registering multiple chains in any order.
--
-- The column is nullable on purpose so older deployments can run this
-- migration before any operator has registered a contract; both the
-- read path (COALESCE) and the in-memory fallback already handle that
-- case gracefully.

ALTER TABLE operators
    ADD COLUMN IF NOT EXISTS settlement_contracts JSONB
        NOT NULL DEFAULT '{}'::jsonb;

-- No dedicated GIN index yet — settlement-contract reads happen via a
-- primary-key lookup on `solver_id` followed by an in-memory JSONB
-- field read, which is the same plan as before this column existed.
-- Add `CREATE INDEX … USING GIN (settlement_contracts)` once we need
-- to scan the whole table for "which operators support chain N?"
-- queries.
