# GiftCardEscrow

Holds the money leg of a gift card trade until an attestation decides where
it goes.

## Why not the OIF escrow

The OIF input settler releases on proof that a fill happened on the
destination chain. A gift card trade has **no on-chain leg** — the thing being
exchanged is a string that a brand's database either honours or does not — so
that proof can never exist and `finalise` could never be called. The release
condition here is an attestation instead, which is the only kind of evidence
this trade can ever produce.

## What the attestor can and cannot do

The attestor picks **which of a lock's two named parties** receives it. It
cannot choose a third address, change the amount, pay itself, or touch a lock
that is already released. A compromised attestor can misdirect a trade between
its own participants — exactly the power a dispute adjudicator needs — but
cannot drain the contract. `test_attestor_cannot_pay_a_third_party` and
`test_attestor_cannot_pay_itself` pin this.

## The refund backstop

Every lock becomes refundable **to its funder** after `REFUND_DELAY` (7 days)
if no attestation arrives. Without it, an operator who simply stopped
answering would trap funds forever, and nobody should accept that risk to sell
a $50 card. `refund()` is permissionless to call but can only ever pay the
funder, so a third party can rescue a stuck trade on their behalf.

Seven days is deliberately far longer than any in-protocol deadline (the
longest is one hour), so it is a backstop against operator failure rather than
a race against normal settlement.

## Test

`lib/` is gitignored, so a fresh clone needs the test library first:

    forge install foundry-rs/forge-std --no-git
    forge test

19 tests, including a fuzz over both trade directions — the contract knows
nothing about buy vs sell, only two addresses in some order.

## Deploy

Set the attestor to the aggregator's key, **not** the deploying key:

    export ATTESTOR_ADDRESS=0x...        # the aggregator's attestor wallet
    forge script script/Deploy.s.sol \
      --rpc-url https://sepolia.base.org \
      --broadcast

Then record the deployed address in the aggregator's chain registry as
`giftcard_escrow` for that chain, and set `GIFTCARD_ATTESTOR_KEY` on the
aggregator to the matching private key.

Repeat per chain you accept payouts on.
