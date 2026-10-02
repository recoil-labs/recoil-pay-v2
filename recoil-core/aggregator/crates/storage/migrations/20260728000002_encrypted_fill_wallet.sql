-- Server-side encrypted fill-wallet private key.
--
-- Replaces the previous "return the private key to the operator once"
-- flow. Under the new flow, the aggregator generates the fill-wallet
-- keypair at registration time, encrypts the private key with the
-- process-held master key (FILL_WALLET_ENCRYPTION_KEY), and stores only
-- the ciphertext here. The operator never sees the private key again —
-- they only see the fill-wallet *address* and can monitor fills on-chain
-- by watching that address.
--
-- `fill_wallet_private_key_ciphertext` holds the AES-256-GCM output:
--   nonce(12) || ciphertext || tag(16)
-- The nonce is regenerated per seal call, so it does not need a separate
-- column.
--
-- `fill_wallet_private_key_set_at` records when the encryption happened.
-- Future rotation flows (e.g. quarterly key rotation) will overwrite the
-- ciphertext and bump this timestamp.
ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS fill_wallet_private_key_ciphertext BYTEA,
  ADD COLUMN IF NOT EXISTS fill_wallet_private_key_set_at     TIMESTAMP WITH TIME ZONE;