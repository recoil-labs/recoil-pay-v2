---
title: Writing intents
sidebar_position: 3
---

# Writing intents

An **intent** is one sentence describing what you want RecoilPay to do. This page shows every phrasing that works today and, just as usefully, the ones that don't.

You don't need to memorise anything. If a sentence isn't understood, the app tells you what's missing.

---

## The two things you can ask for

RecoilPay does two things today: **swap** and **send**.

### Swap — trade one token for another, across chains

**Pattern:**

```
swap <amount> <token> on <chain> for <token> on <chain>
```

**Examples that work:**

- `swap 10 USDC on OP Sepolia for USDC on Base Sepolia`
- `swap 1 USDC on Polygon Amoy for USDC on Ethereum Sepolia`
- `swap 25 USDT on OP Sepolia for USDC on Base Sepolia`

You can also write `to` instead of `for`:

- `swap 5 USDC on Base Sepolia to USDC on OP Sepolia`

### Send — move a token to someone else's address

**Pattern:**

```
send <amount> <token> on <chain> to <recipient>
```

**Examples that work:**

- `send 5 USDC on Base Sepolia to 0x632BF0D0d6468908378C3ccfAC4E788B115e0E55`
- `send 20 USDC on OP Sepolia to Polygon Amoy to 0x632BF0D0d6468908378C3ccfAC4E788B115e0E55`

The second form is a **cross-chain send**: you're paying with USDC on OP Sepolia, and the recipient receives USDC on Polygon Amoy.

:::tip Recipients today
Recipients must be a full `0x…` address. **ENS names are not supported yet** — the app will tell you if you try one.
:::

---

## Chaining intents

You can ask for multiple things in one sentence, separated by **and then**. RecoilPay runs them one after another and shows you a progress bar for the queue.

**Example:**

```
swap 1 USDC on Base Sepolia for USDC on Ethereum Sepolia
  and then
send 10 USDC on OP Sepolia to 0x632BF0D0d6468908378C3ccfAC4E788B115e0E55
```

The app confirms and executes intent 1, then automatically moves on to intent 2. You confirm and sign each one separately.

---

## What RecoilPay understands

You don't have to write chain and token names any single "right" way. RecoilPay normalises common variations.

### Chains

The following all mean the same chain:

| You type | RecoilPay hears |
|---|---|
| `op sepolia`, `optimism sepolia` | Optimism Sepolia |
| `base sepolia` | Base Sepolia |
| `polygon amoy`, `amoy` | Polygon Amoy |
| `ethereum sepolia`, `eth sepolia`, `sepolia` | Ethereum Sepolia |

Case doesn't matter (`OP Sepolia` and `op sepolia` are the same).

### Tokens

| You type | RecoilPay hears |
|---|---|
| `usdc` | USDC |
| `usdt`, `tether` | USDT |
| `eth`, `ether`, `ethereum` | ETH *(recognised, not yet swappable — see below)* |

See [Supported networks](./supported-networks) for which token is available on which chain today.

### Amounts

- Plain numbers work: `1`, `10`, `100`, `0.5`, `1.25`.
- Amounts must be **positive**. `0` and negative numbers are rejected.
- **Dollar amounts (`$100`) are not supported yet.** Everything is in the token's own units.

---

## When something doesn't fit

RecoilPay gives you three distinct kinds of feedback so you know exactly what to fix.

### 1. It didn't understand the shape of your sentence

Example — a fragment with no verb:

```
100 USDC to Base Sepolia
```

You'll see:

> Try: swap ⟨amount⟩ ⟨token⟩ on ⟨chain⟩ for ⟨token⟩ on ⟨chain⟩ …

Fix: start the sentence with `swap` or `send`.

### 2. It understood the shape, but something is missing

Example — you forgot the amount:

```
swap USDC on Base Sepolia for USDC on OP Sepolia
```

You'll see a bullet list:

> - Amount is not stated.

RecoilPay collects **every** missing piece in one go, so you can fix them all in one edit.

### 3. It understood you, but that route isn't live yet

Example — a chain we don't cover today:

```
swap 10 USDC on Arbitrum for USDC on Base
```

You'll see:

> - Arbitrum isn't supported yet.
> - Base isn't supported yet.

Fix: use one of the [Supported networks](./supported-networks). RecoilPay will expand over time.

---

## Some things you might try — and what happens

| Sentence | Result |
|---|---|
| `swap 100 USDC on base sepolia for USDC on op sepolia` | Works. Confirm and sign. |
| `send 5 USDC on op sepolia to base sepolia to 0xabc…` | Works — cross-chain send. |
| `swap USDC on base sepolia for USDC on op sepolia` | *"Amount is not stated."* |
| `swap 5 FOO on base sepolia for USDC on op sepolia` | *"Token 'FOO' isn't recognized."* |
| `swap 5 USDC on solana for USDC on Base` | *"Solana isn't supported yet."* |
| `swap 100 USDC on Base for ETH on Arbitrum` | *"Arbitrum isn't supported yet. ETH isn't supported yet."* |
| `hello world` | *Off-template hint — try `swap ⟨amount⟩ ⟨token⟩ on ⟨chain⟩ …`* |
| `swap 1 USDC on op sepolia for USDC on polygon amoy` **and then** `send 10 USDC on base sepolia to 0xabc…` | Works — two intents in a queue. |

---

## A note on how RecoilPay reads your sentence

RecoilPay uses a language model to turn your words into a structured intent. That model **only proposes** — it never touches your money. Everything downstream (chain lookup, token lookup, amount parsing, address checksumming, signature) is deterministic code that you can audit. And you always see a plain-English confirm card before anything is signed.

If the model ever misreads your intent, the confirm card will make it obvious — cancel and rephrase.

**→ [See which chains and tokens are live today](./supported-networks)**
