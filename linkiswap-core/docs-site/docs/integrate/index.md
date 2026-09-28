---
title: Integrate RecoilPay
sidebar_label: Overview
sidebar_position: 1
---

# Integrate RecoilPay

You have a wallet, an app, a checkout, or an agent. Your users want to move value across chains. You don't want to build a bridge, run inventory on four chains, or babysit a relayer.

Forward the intent to RecoilPay instead. We put it in front of a competing network of solvers, hand you back a signable order, and settle it.

This section is for the people building that integration. The API guides assume you're comfortable with HTTP and EIP-712 signatures, but not that you know anything about the Open Intents Framework. If you [drop in our UI](./drop-in-ui), you need neither.

:::info Testnet today
RecoilPay runs on public **testnets**. The API below is live and complete, but it moves play money. Read [Going to production](./going-live) before you plan a launch.
:::

---

## What you get

- **One HTTP surface.** A handful of public routes. No API key, no onboarding call to get started, and a [drop-in UI](./drop-in-ui) if you'd rather not build one.
- **Competing quotes.** We fan your intent out to every registered solver in parallel and return all of the quotes, ranked. You pick, or you take the first.
- **Solver-paid destination gas.** The solver delivers on the destination chain from its own inventory. Your user pays gas on the source chain only.
- **Non-custodial throughout.** Funds move on your user's signature. RecoilPay never takes custody, and neither do you.
- **Escrowed downside.** If a solver takes an intent and fails to fill it, the input stays escrowed and returns to the user.

---

## What integration actually looks like

Four calls. The middle one is the only one that needs a wallet.

```
1.  POST /api/v1/quotes        →  quotes[]  (each carries EIP-712 typed data)
2.  (your user signs quote.order.payload with their wallet)
3.  POST /api/v1/orders        →  orderId
4.  GET  /api/v1/orders/{id}   →  status, until finalized
```

Everything else — solver discovery, route-finding, escrow, settlement, oracle attestation — happens behind those calls.

**→ [Forward your first intent](./quickstart)** walks the whole loop end to end with working `curl` and TypeScript.

---

## Three ways to integrate

### 1. Drop in our UI

Add the RecoilPay intent experience to your product as it is: plain-English input, the best solver quote, confirm, and settlement tracking. Use the **[widget](./widget)**, one script tag for any website with wallet connection included, or the **[React component](./react)**, which plugs into the wallet setup your app already has.

Right for: getting to market fast, and any product where the swap isn't the thing you differentiate on.

**→ [Drop-in UI](./drop-in-ui)**

### 2. Your UI, our flow

Build every pixel yourself on the **[headless SDK](./sdk)**. It handles parsing, validation, quoting, Permit2 approval, signing, submission and tracking, and gives you the state to render.

Right for: custom designs, and apps not built with React.

### 3. Call the API directly

Call `/api/v1/quotes` with a structured intent, get the user's signature and submit it. The rest of this section documents this path, and it's what [v2.recoilpay.com](https://v2.recoilpay.com) itself does: the app is a client of the same public API you'd use.

Want a natural-language input on top? [`POST /api/v1/intents/parse`](./api-reference#post-apiv1intentsparse) turns what a user typed into structured intents, so you don't need to run a parser. The phrasing it understands is described in [Writing intents](../writing-intents).

Right for: wallets, exchanges, payment flows, treasury tools, agents, and backends.

---

## The base URL

Every example in this section uses this origin:

```bash
export RECOIL_API=https://api.recoilpay.com
```

Confirm you can reach it:

```bash
curl -s "$RECOIL_API/health"
```

Prefer to click rather than curl? The same API is browsable, with a working pre-filled request, at **[`/swagger-ui`](https://api.recoilpay.com/swagger-ui)** — see [Try it interactively](./api-reference#try-it-interactively).

:::caution The hostname is not stable yet
That's a Cloud Run URL, and it will move to a permanent `api.recoilpay.com`-style hostname before mainnet. **Make it configurable** — read it from an environment variable rather than hardcoding it, exactly as the reference client does. [Tell us you're building on it](./going-live#talk-to-us) and we'll give you notice before it changes.
:::

---

## Authentication

There is none on the integration surface today. `/api/v1/quotes`, `/api/v1/orders`, `/api/v1/orders/{id}`, `/api/v1/solvers`, and `/api/v1/chains` are all reachable anonymously, by design: the user authorises with an on-chain signature over the order itself, not with an account on our side. CORS is open, so browser clients can call us directly with no proxy.

Authenticated endpoints do exist, but they're for solver operators running fill infrastructure — a different job, covered at [solver.recoilpay.com](https://solver.recoilpay.com).

:::note This will change for partners
Partner API keys are on the roadmap, and they're what will carry attribution and volume reporting. Nothing you build now breaks when they arrive — keys will be additive. See [Going to production](./going-live).
:::

---

## Read next

| I want to… | Go to |
|---|---|
| Add the swap UI without building it | [Drop-in UI](./drop-in-ui) |
| See the whole loop working, today | [Forward your first intent](./quickstart) |
| Understand the intent JSON and address encoding | [The intent object](./intents) |
| Get the signature right | [Signing and submitting](./signing) |
| Look up a field, or poke the API in a browser | [API reference](./api-reference) |
| Understand what's testnet-only, and talk to a human | [Going to production](./going-live) |

**→ [Forward your first intent](./quickstart)**
