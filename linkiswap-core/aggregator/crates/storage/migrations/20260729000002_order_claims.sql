-- Durable order delivery: the orders table becomes the work queue.
--
-- Previously an order was handed to fill-workers exclusively through an
-- in-memory `tokio::sync::broadcast` channel. That is fire-and-forget:
-- if no worker happened to be subscribed at publish time (a dropped
-- socket, a restart, a wedged reconnect) the order was silently lost and
-- never retried.
--
-- Workers now CLAIM orders out of this table with
-- `FOR UPDATE SKIP LOCKED`, which is atomic across concurrent workers, so
-- an order is handed to exactly one worker and survives restarts on both
-- sides. The WebSocket feed degrades to a latency optimisation ("wake up,
-- there's work") rather than the delivery mechanism.
--
-- A claim is a LEASE, not a permanent assignment: if the holder dies
-- mid-settlement the lease expires and the order returns to the pool.

ALTER TABLE orders
  -- Worker id currently holding the lease. NULL = unclaimed.
  ADD COLUMN IF NOT EXISTS claimed_by        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS claimed_at        TIMESTAMP WITH TIME ZONE,
  -- When the lease lapses and the order becomes claimable again.
  ADD COLUMN IF NOT EXISTS claim_expires_at  TIMESTAMP WITH TIME ZONE,
  -- How many times this order has been handed out. Lets us stop
  -- redelivering an order that keeps killing whichever worker takes it.
  ADD COLUMN IF NOT EXISTS attempts          INTEGER NOT NULL DEFAULT 0;

-- The claim query filters on (status, claim_expires_at) and orders by
-- created_at, so index exactly that.
CREATE INDEX IF NOT EXISTS idx_orders_claimable
  ON orders (created_at)
  WHERE claimed_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_claim_expiry
  ON orders (claim_expires_at)
  WHERE claim_expires_at IS NOT NULL;

-- Cleanup scans and the dashboard's order list both sort by recency.
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);
