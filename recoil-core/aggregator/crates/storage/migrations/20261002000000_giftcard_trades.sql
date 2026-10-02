-- One matched gift card order, from escrow to settlement.
--
-- The money leg settles through the same OIF escrow as a swap, so
-- `payout_chain` / `payout_asset` name a real chain and token. The card leg
-- cannot be settled by a contract at all, which is why this table exists
-- rather than the order being a row in `orders`: it needs a deadline, a
-- commitment, a sealed payload and a dispute state that an on-chain order
-- has no use for.
--
-- Terms are COPIED here rather than joined from `giftcard_quotes`. A
-- merchant can withdraw or re-price a quote while a trade against it is
-- still running, and the terms that were agreed have to survive that.

CREATE TABLE IF NOT EXISTS giftcard_trades (
    id                 VARCHAR(255) PRIMARY KEY,
    quote_id           VARCHAR(255) NOT NULL,
    solver_id          VARCHAR(255) NOT NULL,

    -- Direction, from the merchant's point of view, same vocabulary as
    -- `giftcard_quotes.side`. Everything about who funds escrow, who sends
    -- the code and which way a timeout resolves derives from this one
    -- column, so it is constrained here as well as in Rust.
    side               VARCHAR(8)   NOT NULL,

    -- Agreed terms, frozen at match time.
    brand              VARCHAR(120) NOT NULL,
    country_code       VARCHAR(2)   NOT NULL,
    currency           VARCHAR(8)   NOT NULL DEFAULT 'USD',
    face_minor_units   TEXT         NOT NULL,
    rate               TEXT         NOT NULL,
    payout_chain       VARCHAR(100) NOT NULL,
    payout_asset       VARCHAR(255) NOT NULL,
    payout_minor_units TEXT         NOT NULL,

    user_address       VARCHAR(255) NOT NULL,

    state              VARCHAR(32)  NOT NULL DEFAULT 'quoted',

    -- keccak256 of the plaintext code. In a dispute the claimant must reveal
    -- a preimage that hashes to this, so a code cannot be substituted after
    -- the fact.
    code_commitment    VARCHAR(66),

    -- The sealed code, encrypted to the receiving party's wallet key. The
    -- aggregator stores it and CANNOT read it: there is no key here that
    -- opens it. That is deliberate — a database of plaintext gift card codes
    -- turns any breach into a total loss, so the plaintext never arrives.
    sealed_code        JSONB,

    -- When the running deadline expires. NULL in states with no clock
    -- (quoted, disputed, and every terminal state). The resolver worker
    -- selects on exactly this.
    deadline_at        TIMESTAMP WITH TIME ZONE,

    resolution_note    TEXT,
    escrow_tx_hash     VARCHAR(80),
    release_tx_hash    VARCHAR(80),

    created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

    CONSTRAINT giftcard_trades_side_chk
        CHECK (side IN ('buy', 'sell')),
    CONSTRAINT giftcard_trades_state_chk
        CHECK (state IN (
            'quoted', 'awaiting_code', 'awaiting_attestation', 'disputed',
            'settled_to_card_sender', 'refunded_to_funder', 'failed'
        )),
    -- A deadline only means something in a state that has a clock. Letting a
    -- terminal or disputed row keep one would let the resolver re-decide a
    -- trade a human already settled.
    CONSTRAINT giftcard_trades_deadline_chk
        CHECK (
            (state IN ('awaiting_code', 'awaiting_attestation'))
            OR deadline_at IS NULL
        )
);

-- The resolver's only query: rows whose clock has run out. Partial, so it
-- never scans settled history.
CREATE INDEX IF NOT EXISTS idx_giftcard_trades_due
    ON giftcard_trades (deadline_at)
    WHERE deadline_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_giftcard_trades_solver
    ON giftcard_trades (solver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_giftcard_trades_user
    ON giftcard_trades (user_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_giftcard_trades_state
    ON giftcard_trades (state);

-- Append-only record of every state change, including who caused it. The
-- dispute console reads this, and a slashing decision has to be able to show
-- its working months later.
CREATE TABLE IF NOT EXISTS giftcard_trade_events (
    id          BIGSERIAL PRIMARY KEY,
    trade_id    VARCHAR(255) NOT NULL REFERENCES giftcard_trades(id) ON DELETE CASCADE,
    from_state  VARCHAR(32)  NOT NULL,
    to_state    VARCHAR(32)  NOT NULL,
    -- 'user', 'merchant' or 'system' (the resolver worker).
    actor       VARCHAR(16)  NOT NULL,
    note        TEXT         NOT NULL DEFAULT '',
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_giftcard_trade_events_trade
    ON giftcard_trade_events (trade_id, created_at);

-- The public key the code must be encrypted to.
--
-- An Ethereum address is a hash of a public key, so it cannot be turned back
-- into one — yet the card sender needs the receiver's key to seal the code.
-- The receiver therefore supplies it, and the natural moment is when they
-- fund escrow: the funder IS the card receiver in both directions, so that
-- call is always made by exactly the right party.
--
-- It is verified against the address on the way in. Accepting an unverified
-- key would let anyone who can reach this endpoint nominate a key they hold
-- and have the next code sealed to themselves.
ALTER TABLE giftcard_trades
    ADD COLUMN IF NOT EXISTS recipient_pubkey VARCHAR(132);

-- The merchant's payout address, copied from the operator record at match
-- time.
--
-- The escrow contract will only release to one of a lock's two named parties,
-- so both addresses have to be known when the payout runs. Copying it here
-- rather than joining the operator at payout time means a merchant who
-- re-registers or rotates a wallet mid-trade is still paid at the address the
-- lock actually names — a join would look up the new one and the release
-- would revert.
ALTER TABLE giftcard_trades
    ADD COLUMN IF NOT EXISTS merchant_address VARCHAR(255) NOT NULL DEFAULT '';

-- The payout worker's query: terminal, owed money, not yet sent.
CREATE INDEX IF NOT EXISTS idx_giftcard_trades_unpaid
    ON giftcard_trades (updated_at)
    WHERE release_tx_hash IS NULL
      AND state IN ('settled_to_card_sender', 'refunded_to_funder');

-- Digital code or physical card.
--
-- Copied from the quote at match time like the other terms. It changes what
-- the sender actually has to hand over — a typed code versus photographs of
-- the card and its receipt — so a trade that does not record it cannot show
-- the right thing to the person on either side of it.
ALTER TABLE giftcard_trades
    ADD COLUMN IF NOT EXISTS card_type VARCHAR(16) NOT NULL DEFAULT 'ecode';

ALTER TABLE giftcard_trades
    ADD CONSTRAINT giftcard_trades_card_type_chk
    CHECK (card_type IN ('ecode', 'physical'));
