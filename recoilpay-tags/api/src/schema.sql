-- RecoilPay Tags registry. Idempotent: applied on every boot.

CREATE TABLE IF NOT EXISTS tags (
  id             BIGSERIAL PRIMARY KEY,
  tag            TEXT        NOT NULL CHECK (tag ~ '^[a-z0-9_]{3,20}$'),
  owner          TEXT        NOT NULL CHECK (owner ~ '^0x[0-9a-f]{40}$'),
  chain_id       INTEGER     NOT NULL,
  message        TEXT        NOT NULL,
  signature      TEXT        NOT NULL,
  show_addresses BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uniqueness lives here, not in application code: two simultaneous claims
-- for @Tolu and @tolu cannot both succeed whatever the API does.
CREATE UNIQUE INDEX IF NOT EXISTS tags_tag_ci ON tags (lower(tag));
CREATE INDEX IF NOT EXISTS tags_owner ON tags (owner);

-- `route` is '*' (the default address) or '<token>:<chainId>'.
CREATE TABLE IF NOT EXISTS tag_routes (
  tag_id  BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  route   TEXT   NOT NULL,
  address TEXT   NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  PRIMARY KEY (tag_id, route)
);

-- Short-lived bearer tokens for editing routes, issued after a verified
-- signature. Only the SHA-256 of the token is stored.
CREATE TABLE IF NOT EXISTS edit_tokens (
  token_hash TEXT        PRIMARY KEY,
  tag_id     BIGINT      NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
