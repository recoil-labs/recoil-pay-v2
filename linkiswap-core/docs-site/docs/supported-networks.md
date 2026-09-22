---
title: Supported networks
sidebar_position: 4
---

# Supported networks

RecoilPay is currently a **testnet demo**. Everything works exactly as it will on mainnet, but the tokens are worthless — you're moving play money. This is intentional: it lets you try the whole flow safely.

Any pair of chains listed below can swap to any other. USDC is the common asset that always works cross-chain.

---

## Live today

| Chain | Chain ID | Tokens |
|---|---|---|
| **Optimism Sepolia** | `11155420` | USDC, USDT |
| **Base Sepolia** | `84532` | USDC |
| **Polygon Amoy** | `80002` | USDC |
| **Ethereum Sepolia** | `11155111` | USDC |

All four chains are connected all-to-all, so any of these are valid intents:

- USDC on OP Sepolia → USDC on Polygon Amoy
- USDC on Ethereum Sepolia → USDC on Base Sepolia
- USDT on OP Sepolia → USDC on Base Sepolia
- …and every other combination.

---

## How to add a chain to your wallet

Most wallets recognise these testnets natively. If yours doesn't, add them by hand:

### Optimism Sepolia

- **RPC URL:** `https://optimism-sepolia-rpc.publicnode.com`
- **Chain ID:** `11155420`
- **Currency:** ETH
- **Explorer:** https://sepolia-optimism.etherscan.io

### Base Sepolia

- **RPC URL:** `https://base-sepolia-rpc.publicnode.com`
- **Chain ID:** `84532`
- **Currency:** ETH
- **Explorer:** https://sepolia.basescan.org

### Polygon Amoy

- **RPC URL:** `https://polygon-amoy-bor-rpc.publicnode.com`
- **Chain ID:** `80002`
- **Currency:** POL
- **Explorer:** https://amoy.polygonscan.com

### Ethereum Sepolia

- **RPC URL:** `https://ethereum-sepolia-rpc.publicnode.com`
- **Chain ID:** `11155111`
- **Currency:** ETH
- **Explorer:** https://sepolia.etherscan.io

Or use **[chainlist.org](https://chainlist.org/?testnets=true)** — search the chain name, click **Connect Wallet**, and it will add itself.

---

## Where to get testnet gas

Testnet gas has no cost — you just need to grab some from a faucet.

| Chain | Faucet |
|---|---|
| Optimism Sepolia | https://console.optimism.io/faucet |
| Base Sepolia | https://faucet.quicknode.com/base/sepolia |
| Polygon Amoy | https://faucet.polygon.technology (select Amoy + POL) |
| Ethereum Sepolia | https://cloud.google.com/application/web3/faucet/ethereum/sepolia |

A single request gives you enough for dozens of swaps.

---

## Where to get testnet USDC

The USDC on these chains is not the real Circle USDC — it's a mock ERC-20 with a public `mint` function, deployed for RecoilPay testing. You can:

1. **Ask in the RecoilPay community.** The team can mint you a batch.
2. **Mint your own** if you're comfortable with a block explorer. Every USDC contract listed below has a `mint(address, uint256)` function you can call from Etherscan-style explorers. Six decimals: `1 USDC = 1_000_000` in the raw amount.

### USDC contract addresses

| Chain | USDC address |
|---|---|
| Optimism Sepolia | `0x191688B2Ff5Be8F0A5BCAB3E819C900a810FAaf6` |
| Base Sepolia | `0x73c83DAcc74bB8a704717AC09703b959E74b9705` |
| Polygon Amoy | `0x8c1963bA445dd562Da0B6c6fbCa070921B3fa8E6` |
| Ethereum Sepolia | `0x8c1963bA445dd562Da0B6c6fbCa070921B3fa8E6` |

### USDT (Optimism Sepolia only)

- **USDT address:** `0x8D13AE83C2D23518299bBbA47975731b88c844D8`

---

## What isn't supported yet

You can *type* sentences involving mainnet chains and other tokens — the app will recognise them, but tell you they aren't executable. Today:

- **Mainnet chains** (Ethereum, Base, Optimism, Arbitrum, Polygon) — recognised, not live.
- **Native ETH as an input** — swaps must start from an ERC-20 (USDC or USDT).
- **Solana and other non-EVM chains** — recognised, not supported.
- **ENS recipients** (`.eth` names) — recognised, not supported. Use full `0x…` addresses.
- **Dollar amounts** (`$100`) — not supported. Use token units.

Coverage grows over time. If a specific pair matters to you, let the team know.

**→ [Set up your wallet](./wallet-setup)**
