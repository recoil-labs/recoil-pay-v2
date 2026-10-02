-- Per-operator dashboard API key.
--
-- The previous design used a single hardcoded admin key
-- (`the old shared admin key`) shared by every dashboard instance. That
-- meant anyone with the dashboard source could read/write any
-- operator's data on the aggregator. This column gives each operator
-- its own 32-byte hex API key, generated server-side at registration
-- time and surfaced once in the registration response so the dashboard
-- can persist it in localStorage.
--
-- The key is sent as `x-api-key` on every dashboard request and as
-- `apiKey` in the WebSocket query string. The aggregator checks the
-- incoming key against this column (instead of the deprecated static
-- admin key) and grants the per-operator permission set.

ALTER TABLE operators ADD COLUMN IF NOT EXISTS api_key VARCHAR(64);

-- Existing operators (from prior deploys) get a deterministic key
-- derived from their wallet address so they keep working. New
-- operators get a fresh random key at registration.
UPDATE operators
SET api_key = encode(sha256(('legacy:' || wallet_address)::bytea), 'hex')
WHERE api_key IS NULL;

ALTER TABLE operators ALTER COLUMN api_key SET NOT NULL;

-- The api_key must be unique. We use a unique index (not a UNIQUE
-- constraint) so Postgres can index a NOT NULL column without locking
-- the whole table during the ALTER.
CREATE UNIQUE INDEX IF NOT EXISTS idx_operators_api_key ON operators(api_key);
