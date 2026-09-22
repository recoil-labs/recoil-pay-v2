---
title: Wallet setup
sidebar_position: 5
---

# Wallet setup

You need one wallet to use RecoilPay. It doesn't matter which brand — as long as it supports Ethereum-style chains and can connect to a website, it works.

If you already have a wallet you're happy with, you can skip most of this page. Just make sure it has:

- Some testnet gas on the chains you want to swap between.
- Some testnet USDC to swap.

---

## 1. Pick a wallet

**Recommended for first-timers:** [MetaMask](https://metamask.io/download/) — install it as a browser extension. Takes two minutes.

**Also works out of the box:**

- **Rabby**
- **Coinbase Wallet**
- **Rainbow**
- **Trust Wallet**
- Any WalletConnect-compatible wallet (mobile wallets like Zerion, MetaMask Mobile, etc. connect by QR code)

RecoilPay uses [RainbowKit](https://www.rainbowkit.com/) under the hood, so anything RainbowKit supports, RecoilPay supports.

---

## 2. Save your recovery phrase

When you create a new wallet, it will show you a **12- or 24-word recovery phrase**. This is the only way to recover your wallet if you lose your device.

- Write it down on paper.
- Store it somewhere safe.
- **Never** type it into a website. **Never** photograph it. **Never** paste it into a chat.

Even on testnet, get into this habit now — the mainnet version of this mistake is expensive.

---

## 3. Add the testnet networks

Some wallets ship with the testnets already enabled; some don't. If a chain doesn't show up when you connect to RecoilPay, add it manually. Full RPC details are on [Supported networks](./supported-networks) — or use **[chainlist.org](https://chainlist.org/?testnets=true)** to add them with one click.

The four you'll want:

- Optimism Sepolia
- Base Sepolia
- Polygon Amoy
- Ethereum Sepolia

You don't need to switch networks manually — RecoilPay will prompt you to switch to the source chain when you confirm an intent.

---

## 4. Get testnet gas

Every swap needs a tiny amount of gas on the source chain. On testnet, gas is free — you request it from a **faucet** (a page that sends you a small amount).

| Chain | Faucet |
|---|---|
| Optimism Sepolia | https://console.optimism.io/faucet |
| Base Sepolia | https://faucet.quicknode.com/base/sepolia |
| Polygon Amoy | https://faucet.polygon.technology (Amoy + POL) |
| Ethereum Sepolia | https://cloud.google.com/application/web3/faucet/ethereum/sepolia |

Some faucets ask you to sign in with GitHub or a Google account — this is a spam prevention measure, not a wallet permission.

One faucet request per chain is enough for dozens of swaps.

---

## 5. Get testnet USDC

See [Supported networks → Where to get testnet USDC](./supported-networks#where-to-get-testnet-usdc) for the contract addresses. The team can mint you a batch on request.

---

## 6. Connect to RecoilPay

Go to **[v2.recoilpay.com](https://v2.recoilpay.com)** and click **Connect Wallet** in the top right.

- Pick your wallet from the list.
- Approve the connection prompt in your wallet (this only grants permission for the site to *see* your address — it can't move funds).

You're ready. Head to the [Quickstart](./quickstart) to do your first swap.

---

## Do I need one wallet per chain?

No. **One wallet holds the same address on every EVM chain.** Your OP Sepolia address, your Base Sepolia address, and your Polygon Amoy address are all the same string — the network is just a switch.

That's why you can swap across chains without juggling accounts.

---

## Can RecoilPay access my funds?

No.

- RecoilPay never sees your recovery phrase.
- RecoilPay never sees your private key.
- Every action that moves funds requires an explicit signature in your wallet — you see exactly what you're signing before you approve.
- You can disconnect the site from your wallet at any time (in most wallets, under **Connected sites** or similar).

The one thing you *do* grant is a **Permit2 approval** the first time you swap a given token on a given chain. That's a standard, revocable permission for RecoilPay to move the specific token you're swapping. You can revoke it at any time via a tool like [revoke.cash](https://revoke.cash).

**→ [Do your first swap](./quickstart)**
