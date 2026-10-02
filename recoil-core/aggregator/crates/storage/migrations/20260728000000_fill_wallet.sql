-- Add a dedicated column for the fill-wallet (the hot-wallet that signs
-- on-chain fills) so it's distinct from the operator's registered wallet
-- (which only proves control of the operator identity).
--
-- Pre-existing operators that registered before this migration will have
-- their registered wallet copied as the fill-wallet — they can rotate
-- via the dashboard to get a fresh keypair.
ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS fill_wallet_address VARCHAR(255);

-- Backfill: copy the registered wallet into the fill-wallet column for
-- any operator that doesn't have one yet. This preserves the prior
-- behavior (which used `wallet_address` for both) until the operator
-- rotates via the dashboard.
UPDATE operators
   SET fill_wallet_address = wallet_address
 WHERE fill_wallet_address IS NULL;

-- The fill-wallet must always be present going forward.
ALTER TABLE operators
  ALTER COLUMN fill_wallet_address SET NOT NULL;
