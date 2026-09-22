---
title: Quickstart — your first swap
sidebar_label: Quickstart
sidebar_position: 2
---

# Your first swap

By the end of this page you will have moved a test USDC between two blockchains, using nothing but a sentence.

**Time needed:** about 10 minutes, most of it waiting for a faucet.

---

## 1. What you need

- A browser (Chrome, Brave, Firefox, or Edge).
- A crypto wallet browser extension. If you don't have one, install **[MetaMask](https://metamask.io/download/)** — it's free and takes two minutes.
- A tiny amount of testnet gas on the chains you want to swap between. You get this free from a faucet.
- Some testnet USDC to swap. Also free.

We'll get the gas and the USDC in the next step.

---

## 2. Fund your wallet on testnet

Open your wallet and copy your address (a string starting with `0x…`). Then:

**Gas** (you need enough to sign one or two transactions — a few cents' worth is plenty):

- **OP Sepolia:** [superchain.tools/faucets](https://console.optimism.io/faucet)
- **Base Sepolia:** [faucet.quicknode.com/base/sepolia](https://faucet.quicknode.com/base/sepolia)
- **Polygon Amoy:** [faucet.polygon.technology](https://faucet.polygon.technology) (choose Amoy + POL)
- **Ethereum Sepolia:** [cloud.google.com/application/web3/faucet/ethereum/sepolia](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)

**Testnet USDC:** the easiest path is to ask in the RecoilPay community for a mint — testnet USDC is a special mock token, not the real one. See [Supported networks](./supported-networks) for the exact contract addresses and mint instructions.

If any of this feels unfamiliar, walk through [Wallet setup](./wallet-setup) first, then come back here.

---

## 3. Open the app

Go to **[v2.recoilpay.com](https://v2.recoilpay.com)** and click **Connect Wallet** in the top right. Approve the connection prompt in your wallet.

You should now see the intent bar in the middle of the page — a big search-style input with an animated placeholder.

---

## 4. Type a sentence

Click into the intent bar and type:

```
swap 1 USDC on OP Sepolia for USDC on Polygon Amoy
```

Press **Enter** (or click the arrow).

You'll see:

> **AI is interpreting your intent…**

then:

> **Asking solvers for a quote…**

then a **confirm card** showing exactly what you're about to do: how much you're paying, how much you'll receive, on which chain, and an estimated time.

Take a moment to read it. If it doesn't match what you meant, click **Cancel** and try a different sentence — see [Writing intents](./writing-intents) for the phrasing patterns that work.

---

## 5. Approve, sign, wait

Click **Confirm**. Your wallet will pop up **up to two times**:

1. **Approval (first swap on a given chain only).** RecoilPay asks your wallet's permission to move your input token. This is a one-time step per token, per chain, and uses the [Permit2](https://github.com/Uniswap/permit2) standard. Approve it.
2. **Signature.** You sign a short message describing exactly this swap — no funds move yet, just a signed intent.

Now sit back. The bar shows a live status:

- **pending** — the solver has picked up your intent.
- **filled** — the solver has delivered your tokens on the destination chain. *This is when your funds arrive.*
- **settled** — the solver has claimed its own reimbursement.
- **finalized** — done, on-chain.

Once the status hits **settled**, a completion modal pops up with a link to the block explorer. You can verify the transfer on-chain.

---

## What just happened

You didn't:

- Pick a bridge.
- Pick a DEX.
- Move funds through an intermediate chain.
- Manage two wallets.

You just described the outcome. RecoilPay found an independent **solver** willing to deliver your tokens on the destination chain up front, took your input on the source chain into escrow, and settled the whole thing atomically. The solver pays the destination gas; you only paid gas on the source chain (for the approval + the signature was free).

That's the whole model. Every future swap works exactly the same way.

**→ [Learn what other sentences you can type](./writing-intents)**
