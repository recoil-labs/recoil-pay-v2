-- Operator table — tracks solver operators that publish quotes via the
-- dashboard (push path). Each operator has a wallet, optional fill-worker URL,
-- and aggregated reputation metrics used by the push-quote ranker.

CREATE TABLE IF NOT EXISTS operators (
    solver_id           VARCHAR(255) PRIMARY KEY,
    wallet_address      VARCHAR(255) NOT NULL,
    fill_worker_url     TEXT,
    reputation_score    DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    fills_total         BIGINT NOT NULL DEFAULT 0,
    fills_succeeded     BIGINT NOT NULL DEFAULT 0,
    avg_latency_ms      BIGINT NOT NULL DEFAULT 0,
    last_active_at      TIMESTAMP WITH TIME ZONE,
    circuit_breaker_open BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_operators_reputation ON operators(reputation_score DESC);
CREATE INDEX IF NOT EXISTS idx_operators_wallet ON operators(wallet_address);