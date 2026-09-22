---
title: FAQ
sidebar_position: 7
---

# Frequently asked questions

## Is my money safe?

Yes.

- RecoilPay never holds your funds. Every transfer is signed from your wallet.
- If a solver takes your intent but fails to deliver, your input is escrowed and released back to you — you can't lose the input without receiving the output.
- On testnet you're moving mock tokens with no monetary value anyway, so there's nothing at risk. The mainnet version of RecoilPay uses the same safety design.

## Is RecoilPay on mainnet?

Not yet. RecoilPay is currently a public testnet deployment across four EVM testnets. See [Supported networks](./supported-networks) for the exact list.

## Do I need to know anything about blockchains to use it?

Only what you'd need to use any wallet app: how to install a browser extension, how to store a recovery phrase, and how to click **Sign** when your wallet asks you to.

The whole point of RecoilPay is that you don't need to know which bridge to use, or which DEX has liquidity, or how to route between chains. You just say what you want.

## What if the AI misunderstands my sentence?

Two safety nets catch that:

1. **The confirm card.** Before anything is signed, RecoilPay shows you a plain-English summary — "Pay 10 USDC on OP Sepolia, receive ≈10 USDC on Polygon Amoy". If it doesn't match what you meant, click **Cancel**.
2. **Deterministic checks.** The model only proposes a structured intent. Everything downstream (chain lookup, address validation, amount parsing) is regular code that either produces a valid transaction or produces a clear error. The model can't invent an address or a chain out of thin air.

If you cancel a misread intent, no funds move.

## Why do I need to approve Permit2?

**Permit2** is a standard, widely-used approval contract. It lets RecoilPay move a specific token from your wallet, up to a limit you control, without you having to approve every single swap.

You approve it **once per token, per chain**. After that, every swap of that token on that chain skips the approval step.

You can revoke the approval at any time from your wallet or via a tool like [revoke.cash](https://revoke.cash).

## Why do I have to sign a message *and* approve?

They're different things:

- The **approval** (once) gives RecoilPay permission to move the token.
- The **signature** (every swap) authorises this specific swap — the amount, the chains, the receive token — and includes a short expiry so it can't be replayed later.

Two steps means every individual swap needs a fresh, explicit "yes" from you, even after the token approval is granted.

## What is a "solver"?

An independent operator that fulfills your intent. Solvers:

- Watch for new intents.
- Deliver tokens on the destination chain from their own inventory, before claiming your escrowed input.
- Compete with each other on price — RecoilPay shows you the best quote.

You never interact with a solver directly. The aggregator picks the best one for you.

## Can I chain multiple actions in one sentence?

Yes — with **and then**. See [Writing intents → Chaining intents](./writing-intents#chaining-intents).

They execute one after another, and you sign each one. There's no way (yet) to sign a whole batch with a single signature.

## Can I cancel an intent after signing?

Once a solver has picked it up, no — the fill is on-chain by then. Before the solver picks it up, you can just close the app; unsubmitted intents are never sent anywhere.

In practice fills happen in seconds, so there's no real window to cancel in.

## Does RecoilPay store my sentences?

The aggregator logs quote and order requests for operational reasons (debugging, metrics), but your natural-language sentence is not sent to the aggregator — only the *structured* intent (chain, token, amount, recipient) is. Your sentence is processed client-side and sent to a third-party language model service (Hugging Face) to be parsed. See the [product description](https://github.com/recoil-labs/recoil-pay-v2/blob/main/linkiswap-core/docs/product-description.md) for more detail on the data flow.

## Can I use this from my phone?

Yes. Open [v2.recoilpay.com](https://v2.recoilpay.com) in your mobile browser (or use a mobile wallet like MetaMask Mobile / Rainbow / Zerion and use their built-in browser). WalletConnect works for QR-based connections.

## What happens if my transaction "expires"?

Quotes are short-lived (about a minute). If you take too long between quoting and confirming — for example if the approval transaction on a slow testnet takes 30+ seconds — RecoilPay automatically fetches a fresh quote before you sign, so you always sign the latest price.

If a fresh quote isn't available (all solvers offline, network down), you'll see an error and can try again.

## Where do I report a bug or ask for help?

Open an issue on the [recoil-pay-v2 repository](https://github.com/recoil-labs/recoil-pay-v2/issues), or reach out through the RecoilPay community channels.

**→ [Troubleshooting: what to do when something goes wrong](./troubleshooting)**
