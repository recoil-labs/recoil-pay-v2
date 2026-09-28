---
title: Drop-in UI
sidebar_label: Overview
---

# Drop-in UI

The RecoilPay app's intent experience, packaged for your product. Your user types what they want, like *swap 10 USDC on Base Sepolia for USDC on OP Sepolia*, sees the best solver quote, confirms in their wallet, and watches it settle. You don't build the parser, the quote card, the Permit2 approval, the signing or the order tracking.

:::info Availability
The packages are being published to npm under `@recoilpay`. Until they are, [talk to us](./going-live#talk-to-us) for early access.
:::

---

## Pick one

| | You add | You build | Best for |
|---|---|---|---|
| **[Widget](./widget)** | One `<script>` tag and one `<recoilpay-intent>` element | Nothing. Wallet connection is included | Any website: plain HTML, WordPress, Webflow, Vue, Angular |
| **[React component](./react)** | `<RecoilIntent />` | Wallet connection: pass in the one your app already has | React and Next.js apps, especially with wagmi or RainbowKit |
| **[Headless SDK](./sdk)** | `createIntentSession()` | All of the UI | Custom designs, other frameworks, bots and agents |

They're layers of the same code: the widget is built on the React component, which is built on the SDK. Choosing one doesn't lock you out of the others.

---

## What your users get

1. **They type an intent** in plain English, or click an example. RecoilPay's parser turns it into a structured intent.
2. **It's checked against live solver coverage.** Anything unsupported, unknown or missing is listed at once so the user can fix it in one edit.
3. **Solvers race to quote.** The best quote is shown as *you pay → you receive*, with an ETA and how many solvers answered.
4. **They confirm.** Their wallet switches to the right chain, approves Permit2 once for that token, and signs the order. Signatures cost no gas.
5. **They watch it settle**, step by step, ending with a block-explorer link to the fill.

Same-chain sends skip the solvers and go straight from the user's wallet. Sentences with several intents, such as "swap … then send …", run one after another.

---

## What stays true

- **Non-custodial.** Funds only move on your user's signature. Neither RecoilPay nor your page ever holds them.
- **No API key.** The components call the same public API as everything else in this section. Partner keys, when they arrive, will be additive. See [Going to production](./going-live).
- **Nothing secret in your page.** Natural-language parsing runs on RecoilPay's side ([`POST /api/v1/intents/parse`](./api-reference#post-apiv1intentsparse)). The packages carry no credentials.
- **Testnets today.** Base Sepolia, OP Sepolia, Ethereum Sepolia and Polygon Amoy, with mock tokens. See [Supported networks](../supported-networks).

**→ [Embed the widget](./widget)** is the fastest way to see it working.
