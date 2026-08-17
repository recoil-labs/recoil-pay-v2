CREATE TABLE IF NOT EXISTS solver_quotes (
    id VARCHAR(255) PRIMARY KEY,
    solver_id VARCHAR(255) NOT NULL,
    from_chain VARCHAR(100) NOT NULL,
    to_chain VARCHAR(100) NOT NULL,
    from_asset VARCHAR(255) NOT NULL,
    to_asset VARCHAR(255) NOT NULL,
    from_decimals SMALLINT NOT NULL DEFAULT 18,
    to_decimals SMALLINT NOT NULL DEFAULT 18,
    quote TEXT NOT NULL,
    min_amount TEXT NOT NULL DEFAULT '0',
    max_amount TEXT NOT NULL DEFAULT '0',
    fixed_cost TEXT,
    expiry TEXT NOT NULL,
    exclusive_for TEXT,
    paused BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_solver_quotes_solver_id ON solver_quotes(solver_id);
CREATE INDEX IF NOT EXISTS idx_solver_quotes_paused ON solver_quotes(paused);
