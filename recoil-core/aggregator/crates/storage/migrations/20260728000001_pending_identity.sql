-- Pending identity handoff: lets the dashboard queue a freshly-minted
-- hot-wallet key and the worker's next-boot poll consume it.
--
-- Why two columns instead of one?
-- - `pending_private_key` is the secret material. Single-shot: cleared
--   the first time the worker calls `take_pending_identity`.
-- - `pending_identity_set_at` is the TTL anchor. Lets us purge stale
--   keys that were queued but never picked up (worker never booted,
--   Render deploy failed, operator abandoned the flow).
--
-- NULL in both = nothing pending (the steady state for any operator
-- that's already running).
ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS pending_private_key     TEXT,
  ADD COLUMN IF NOT EXISTS pending_identity_set_at TIMESTAMP WITH TIME ZONE;