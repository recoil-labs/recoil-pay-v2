---
title: Operators and solvers
sidebar_position: 7
---

# Operators and solvers

Every swap on RecoilPay is filled by a **solver**: an independent operator who delivers your tokens on the destination chain from their own funds and is repaid from your escrowed input on the source chain. This page explains who they are, what is expected of them, and how to become one.

If you only want to swap, you don't need any of this. You never deal with a solver directly. RecoilPay picks one for you.

---

## Who solvers are

A solver (or *operator*; the two words mean the same thing here) is anyone who:

- holds tokens on the chains RecoilPay supports,
- publishes standing offers, called **quotes**, for the routes they're willing to fill, and
- has their quotes settled on-chain when one of them wins an order.

Solvers compete on price. When you ask for a swap, RecoilPay collects every quote that fits your request, scores them, and shows you the best one. The solver earns the small spread between what you put in and what you receive.

Operators don't run any servers. Quotes are published from the **[solver portal](https://solver.recoilpay.com)**, and RecoilPay's hosted worker carries out the on-chain settlement for them.

---

## How a fill works

One swap is three on-chain transactions across two chains. All of them are signed by the operator's **fill-wallet**:

| Step | Chain | What happens |
|---|---|---|
| **1. Escrow** | Source | The user's input is pulled into the escrow contract, using the signature the user gave when they confirmed. The funds are locked. Neither the solver nor RecoilPay can take them. |
| **2. Deliver** | Destination | The fill-wallet sends the agreed output to the user. This spends the solver's own inventory. |
| **3. Claim** | Source | Once delivery is proven, the escrowed input is released to the solver's fill-wallet. This is how the solver is paid. |

If step 2 never happens, the solver can't claim, and the user takes their input back from escrow once the order expires. A failing solver costs the user time, never money.

---

## What is expected of an operator

### Keep the fill-wallet funded

The fill-wallet needs two different things:

| What | Which chains | Why |
|---|---|---|
| **Native gas** | Every chain you quote, both source and destination | Escrow and claim run on the source chain; delivery runs on the destination. All three cost gas. |
| **Token inventory** | Destination chains only | This is what you hand the user. You're repaid on the source chain moments later. |

A route that mostly flows one way will drain inventory on one chain and pile it up on the other. Plan to rebalance.

### Only quote what you can honour

A quote is a promise: *"I will fill this route, at this price, for orders this big, until this time."* If your quote wins and you can't deliver, usually because of missing gas or inventory, the fill fails and your reputation drops sharply (see [below](#how-quotes-are-chosen)). A quote you don't publish costs you nothing. A quote you can't keep costs you a lot.

### Price honestly

Each quote has two cost parts:

- **Margin**: a percentage of the order. A 0.15% margin means the user receives 99.85% of their input.
- **Gas fee**: a flat amount taken from every fill to cover your settlement gas. It's the same for a 1-token order as for a 10,000-token order, so it dominates on small orders. Keep it close to your real cost.

The portal shows what the user would actually receive at both ends of your order-size range, and warns you when that drops below 95% of the input.

### Watch your expiry windows

Quotes stay live for anywhere from 15 minutes to 7 days. You're committed to that price for the whole window. Long windows are fine on stablecoin pairs. On pairs whose prices move, they carry real risk.

### Treat the fill-wallet as a hot wallet

RecoilPay holds the fill-wallet's private key, encrypted, so that settlements can be signed while you're offline. Fund it with working capital, not your treasury. There's currently no withdraw button in the portal, so only put in what you're happy to leave working.

---

## How quotes are chosen

When a user asks for a price, a quote is skipped unless **all** of these hold:

- The source chain, destination chain and both tokens match exactly.
- The order size is inside the quote's range.
- The quote hasn't expired and isn't paused.
- The operator isn't circuit-broken (temporarily blocked after repeated failures).

The quotes that remain are scored:

| Factor | Weight | Meaning |
|---|---|---|
| Output | 50% | How much the user receives. Price matters most. |
| Reputation | 25% | Track record, between 0 and 1. New operators start at 0.5. |
| Success rate | 15% | Fills completed ÷ fills attempted. |
| Speed | 10% | Average time to settle. |

Reputation goes up **+0.02 for each successful fill** and down **−0.10 for each failure**. It takes five successes to undo one failure, so reliability pays off over time.

---

## How to onboard

Onboarding takes a few minutes and costs no gas until you fund the fill-wallet.

1. **Read the operator handbook.** The [handbook in the solver portal](https://solver.recoilpay.com/docs) is public and goes into more detail than this page. It's worth reading before you fund anything.
2. **Connect your wallet** at [solver.recoilpay.com](https://solver.recoilpay.com). Any EVM wallet works. This wallet is your identity: there's no email or password, and you're never asked for a private key.
3. **Pick a handle.** It's only a display name and doesn't affect matching.
4. **Sign one message.** This is a plain-text signature proving you control the wallet. It isn't a transaction: it costs no gas and gives no one permission to spend your funds.
5. **Save what registration gives you.** Two things are created:
   - an **API key**, stored in your browser, which is how the portal knows it's you, and
   - a **fill-wallet**, a fresh address that will sign your settlements.
6. **Add a settlement contract for each chain** you want to fill on, from **Settings**. Quick-add buttons fill in RecoilPay's deployed contracts.
7. **Fund the fill-wallet.** Send gas to every chain you'll quote, and token inventory to every chain you'll deliver on. The **Fill Wallet** tab shows live balances for each chain.
8. **Publish your first quote** from **Quotes**: choose the route, the order-size range, your margin and gas fee, and an expiry.
9. **Watch your orders** in **Orders**. Each one moves through `created → pending → executing → executed → settling → finalized`, with a transaction hash recorded at each stage. `executed` means the user has been paid. `finalized` means you've claimed the escrow.

:::tip Lost your API key?
The API key lives in your browser's local storage, so clearing site data logs you out. Register again with the **same wallet** and you'll get back the same operator account, with your quotes and reputation intact.
:::

---

## Where earnings go

Profit is the spread: you deliver slightly less than you claim from escrow, minus gas. Claimed funds land in your **fill-wallet on the source chain**, so a completed swap partly refills the inventory it used, just on the other chain.

---

## Testnet only, for now

Like the rest of RecoilPay, solvers run on public **testnets** today. The tokens have no real value, so this is the right time to learn how pricing, inventory and reputation behave before mainnet. Some details, such as withdrawals from the fill-wallet, will change before then.

**→ [Frequently asked questions](./faq)**
