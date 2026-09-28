---
title: Integrate RecoilPay
sidebar_label: Overview
sidebar_position: 1
---

# Integrate RecoilPay

You have a wallet, an app, a checkout, or an agent. Your users want to move value across chains. You don't want to build a bridge, run inventory on four chains, or babysit a relayer.

Forward the intent to RecoilPay instead. We put it in front of a competing network of solvers, hand you back a signable order, and settle it.

This section is for the people building that integration. It assumes you're comfortable with HTTP and EIP-712 signatures. It does **not** assume you know anything about the Open Intents Framework.

:::info Testnet today
RecoilPay runs on public **testnets**. The API below is live and complete, but it moves play money. Read [Going to production](./going-live) before you plan a launch.
:::

---

## What you get

- **One HTTP surface.** Four public routes. No SDK, no API key, no onboarding call to get started.
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

## Two ways to integrate

### 1. Forward structured intents (the API)

You build the UI. You decide what the user sees. You call `/api/v1/quotes` with a structured intent, get the user's signature, and submit. This is what the rest of this section documents, and it's what [v2.recoilpay.com](https://v2.recoilpay.com) itself does — the app is a client of the same public API you'd use.

Right for: wallets, exchanges, payment flows, treasury tools, agents.

### 2. Forward natural language (your layer)

The plain-English bar on [v2.recoilpay.com](https://v2.recoilpay.com) — `swap 10 USDC on OP Sepolia for USDC on Base Sepolia` — is **client-side**. The parser runs in the browser and emits the structured intent described in [The intent object](./intents). There is no server endpoint that accepts a sentence today.

So if you want a natural-language surface, you own the parsing and call the same structured API underneath. The grammar that the RecoilPay app recognises is documented in [Writing intents](../writing-intents) if you want to match its behaviour.

:::tip If a hosted parse endpoint would unblock you
That's useful signal and it's a small piece of work on our side. [Talk to us](./going-live#talk-to-us) — tell us the shape you'd want.
:::

---

## The base URL

Every example in this section uses this origin:

```bash
export RECOIL_API=https://recoil-aggregator-675174162902.us-central1.run.app
```

Confirm you can reach it:

```bash
curl -s "$RECOIL_API/health"
```

Prefer to click rather than curl? The same API is browsable, with a working pre-filled request, at **[`/swagger-ui`](https://recoil-aggregator-675174162902.us-central1.run.app/swagger-ui)** — see [Try it interactively](./api-reference#try-it-interactively).

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
| See the whole loop working, today | [Forward your first intent](./quickstart) |
| Understand the intent JSON and address encoding | [The intent object](./intents) |
| Get the signature right | [Signing and submitting](./signing) |
| Look up a field, or poke the API in a browser | [API reference](./api-reference) |
| Understand what's testnet-only, and talk to a human | [Going to production](./going-live) |

**→ [Forward your first intent](./quickstart)**
