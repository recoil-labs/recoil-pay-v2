---
title: Fees and timing
sidebar_position: 6
---

# Fees and timing

## Fees on testnet

Right now RecoilPay runs on public testnets, so **you pay nothing real**. But it's useful to understand what you're paying (in test currency) because the same shape applies on mainnet.

For a single swap you pay gas on the **source chain only** — the chain your input token is on. That covers:

- **One-time:** the Permit2 approval (only the first time you swap a given token on a given chain).
- **Every time:** the signature over your intent. On most EVM chains this is free — an EIP-712 signature is done in your wallet and doesn't hit chain — but the intent itself, once submitted, records an on-chain action if you're using the escrow route.

You do **not** pay gas on the destination chain. The solver pays that when it delivers your tokens.

For a send, the same rules apply.

---

## What the solver earns

Solvers are independent operators competing for your business. On mainnet, each quote includes a spread and a fee — the difference between what you pay and what you receive. RecoilPay fetches quotes from every available solver in parallel and shows you the best one. [Operators and solvers](./operators) covers how quotes are priced and chosen.

On testnet, spreads are effectively zero. The confirm card will show you the exact receive amount before you sign, so you always know what you're getting.

---

## How long a swap takes

A typical cross-chain USDC swap between two supported testnets completes in **under a minute**, usually much less. Here's what happens after you sign:

| Step | Roughly how long | What's happening |
|---|---|---|
| **pending** | a few seconds | The solver has seen your intent and is preparing the fill. |
| **filled** | 5–20 seconds | The solver has sent your tokens on the destination chain. **This is when your funds arrive.** |
| **settled** | 5–20 seconds | The solver has claimed its reimbursement from your source-chain escrow. |
| **finalized** | usually instant | Everything is confirmed on-chain. |

The completion modal in the app pops up as soon as you hit **settled**, because that's when your side of the trade is finished.

If the status stays on **pending** for more than a minute or two, see [Troubleshooting](./troubleshooting).

---

## Why is it so fast?

Traditional cross-chain moves work like this:

1. Send funds into a bridge on chain A.
2. Wait for the bridge to confirm.
3. Bridge relays to chain B.
4. Withdraw on chain B.

Each of those steps has its own delay, and some bridges wait for finality (10+ minutes on some chains).

RecoilPay's model is different. A solver has liquidity on **both** chains already. When you sign your intent:

- The solver immediately sends your tokens on the destination chain (from its own inventory).
- The solver then claims your input from the source chain, at its own pace.

You get filled at the speed of the destination chain, not the speed of a bridge.

---

## What could go wrong?

If a solver takes your intent but can't complete it, you don't lose funds — your input stays escrowed and is released back to you. The worst case is that a slow solver holds the intent for a while before failing; the app shows a **failed** status in that case, and you can just try again.

You never send funds anywhere they can't come back.

**→ [Frequently asked questions](./faq)**
