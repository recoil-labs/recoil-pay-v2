-- Gift card quotes: merchant-published terms for one gift card asset.
--
-- Gift cards are a second asset class on the same rail as `solver_quotes`:
-- a registered operator publishes standing terms, the ranker matches them
-- against a user intent, and the winning order goes through the existing
-- claim queue and OIF escrow. The columns below mirror `solver_quotes`
-- field-for-field wherever the meaning is the same, so the ranker's
-- range/expiry/pause/exclusivity logic transfers unchanged.
--
-- What differs is the asset. A crypto leg is (chain, token) and both sides
-- are verifiable on-chain. A gift card leg is (brand, country, card_type)
-- and NOTHING about it is verifiable by a contract — which is why the
-- money side still names a real chain and token (`payout_*`, settled
-- through escrow) while the card side is settled by attestation.
--
-- The asset is DENORMALISED rather than a foreign key: the product catalog
-- (`giftcard_products`, 1.5k rows) lives in the API gateway's database, not
-- this one, so a quote has to be self-describing. This is the same choice
-- `solver_quotes` makes by storing `from_asset` as a free-form symbol
-- instead of a token id.

CREATE TABLE IF NOT EXISTS giftcard_quotes (
    id              VARCHAR(255) PRIMARY KEY,
    solver_id       VARCHAR(255) NOT NULL,

    -- Direction, named from the MERCHANT's point of view:
    --   'buy'  — merchant buys the card from a user (the user is selling)
    --   'sell' — merchant sells a card to a user  (the user is buying)
    -- The two directions have opposite escrow-funding order and opposite
    -- dispute timeouts, so this column decides the whole settlement path
    -- and is part of the matching key.
    side            VARCHAR(8)   NOT NULL,

    -- The asset. `product_id` is an optional pointer into the catalog;
    -- the (brand, country_code, card_type) triple is what the ranker
    -- actually matches on, and it stands alone without the catalog.
    product_id      INTEGER,
    brand           VARCHAR(120) NOT NULL,
    country_code    VARCHAR(2)   NOT NULL,
    currency        VARCHAR(8)   NOT NULL DEFAULT 'USD',
    card_type       VARCHAR(16)  NOT NULL DEFAULT 'ecode',

    -- Face-value band this quote applies to, in the card currency's minor
    -- units (cents for USD), as TEXT. TEXT and minor units for the same
    -- reason `solver_quotes` stores base-unit strings: no float rounding,
    -- and the ranker's existing integer parser works on it as-is.
    face_decimals   SMALLINT     NOT NULL DEFAULT 2,
    min_face        TEXT         NOT NULL DEFAULT '0',
    max_face        TEXT         NOT NULL DEFAULT '0',

    -- Rate as a multiplier on face value, identical semantics to
    -- `solver_quotes.quote`: 0.88 means a $100 card pays out $88. For a
    -- 'sell' quote it is the price the user pays, so it sits above 1.0 only
    -- if the merchant charges a premium; normally 0.9x either way, with the
    -- spread between a brand's buy and sell rate being the merchant's edge.
    quote           TEXT         NOT NULL,
    fixed_cost      TEXT,

    -- The money leg. A real CAIP-2 chain and a real token, because this
    -- side settles through the same InputSettler escrow as a swap.
    payout_chain    VARCHAR(100) NOT NULL,
    payout_asset    VARCHAR(255) NOT NULL,
    payout_decimals SMALLINT     NOT NULL DEFAULT 6,

    expiry          TEXT         NOT NULL,
    exclusive_for   TEXT,
    paused          BOOLEAN      NOT NULL DEFAULT false,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Enforced here as well as in Rust: a bad `side` silently routes an
    -- order down the wrong settlement path, which is the one failure in
    -- this table that loses someone's money.
    CONSTRAINT giftcard_quotes_side_chk
        CHECK (side IN ('buy', 'sell')),
    CONSTRAINT giftcard_quotes_card_type_chk
        CHECK (card_type IN ('ecode', 'physical'))
);

CREATE INDEX IF NOT EXISTS idx_giftcard_quotes_solver_id
    ON giftcard_quotes (solver_id);

-- The ranker loads the live book for one asset+direction, so index exactly
-- that and leave the paused/expired rows out of the index entirely.
CREATE INDEX IF NOT EXISTS idx_giftcard_quotes_book
    ON giftcard_quotes (side, brand, country_code, card_type)
    WHERE paused = false;

CREATE INDEX IF NOT EXISTS idx_giftcard_quotes_created_at
    ON giftcard_quotes (created_at DESC);
