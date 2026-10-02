-- Operator-attested vault balance snapshot table.
--
-- The aggregator does NOT read on-chain ERC-20 balances directly (no
-- RPC registry, no ABI plumbing, no price oracle yet). Until the
-- vault contract is designed and deployed, balances are operator-
-- reported: the dashboard reads the operator's wallet state, asks
-- for confirmation, and POSTs to /solver-api/vaults/snapshot.
--
-- Each row is keyed by (solver_id, chain, asset_address) and is
-- upserted on every snapshot. The `available` column is overwritten;
-- `locked` is preserved so a future vault-contract integration can
-- write escrow state into the same row without breaking the schema.

CREATE TABLE IF NOT EXISTS vault_balances (
    solver_id        VARCHAR(255) NOT NULL,
    chain            VARCHAR(100) NOT NULL,
    asset_address    VARCHAR(255) NOT NULL,
    symbol           VARCHAR(64)  NOT NULL,
    name             VARCHAR(255) NOT NULL DEFAULT '',
    available        TEXT         NOT NULL DEFAULT '0',
    locked           TEXT         NOT NULL DEFAULT '0',
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (solver_id, chain, asset_address)
);

-- Lookup by operator is the dashboard's hot path; the PK covers
-- it already. The chain index helps when a dashboard filters to
-- one chain across many operators.
CREATE INDEX IF NOT EXISTS idx_vault_balances_chain ON vault_balances(chain);

-- Foreign-key style integrity: every row must belong to a
-- registered operator. We don't add a real FK because operators
-- can be deleted (the FK would block the delete). The handler
-- looks up the operator first and 404s if it doesn't exist.