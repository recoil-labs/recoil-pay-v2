---
title: Troubleshooting
sidebar_position: 9
---

# Troubleshooting

If something isn't working, find the closest match below. If none of these help, open an issue on the [recoil-pay-v2 repository](https://github.com/recoil-labs/recoil-pay-v2/issues).

---

## The intent bar shows "NLP parsing unavailable"

**What it means:** the language model that reads your sentence isn't reachable right now.

**Try:**

- Refresh the page.
- Wait a minute and try again — Hugging Face's free inference API occasionally throttles.
- If it persists, the issue is on our side. Check the [recoil-pay-v2 issues page](https://github.com/recoil-labs/recoil-pay-v2/issues) or reach out.

---

## "Couldn't reach the solver network. Retry in a moment."

**What it means:** the aggregator (the service that finds you a quote) isn't responding.

**Try:**

- Refresh the page.
- Check your internet connection.
- Wait a minute — the aggregator may be restarting.

---

## "Chain 'X' isn't supported yet"

**What it means:** RecoilPay understood which chain you asked for, but it isn't in the live route set.

**Fix:** use one of the [Supported networks](./supported-networks).

---

## "Token 'X' isn't recognized"

**What it means:** you typed a symbol RecoilPay doesn't know.

**Fix:** check the spelling. If you meant USDC, USDT, or ETH, use those exact names. See [Writing intents → What RecoilPay understands](./writing-intents#what-recoilpay-understands).

---

## "USDC isn't supported on X yet"

**What it means:** the token exists and the chain exists, but no solver covers that specific combination.

**Fix:** try a different chain — every supported chain has USDC. See [Supported networks](./supported-networks).

---

## "No solver returned a quote for this route yet"

**What it means:** every solver either timed out or refused to quote this pair right now. Usually this is temporary.

**Try:**

- Wait 30 seconds and re-submit the same sentence.
- Try a smaller amount — some solvers reject amounts above their inventory.
- Try the reverse direction — sometimes one direction has liquidity and the other doesn't at that moment.

---

## "The quote expired and no fresh quote is available"

**What it means:** you took long enough between the quote and confirming that the quote expired, and when the app tried to fetch a new one, no solver responded.

**Fix:** click **Cancel** and re-submit the sentence.

---

## My wallet won't connect

**Try, in order:**

1. Make sure your wallet extension is unlocked.
2. Refresh the page.
3. Disconnect any existing session in your wallet (**Connected sites** → find v2.recoilpay.com → disconnect), then reconnect.
4. Try a different browser or a different wallet (see [Wallet setup](./wallet-setup) for supported options).

---

## The app wants me to switch networks

That's normal. RecoilPay needs your wallet to be on the **source chain** (the chain the input token lives on) before you can sign.

Approve the switch prompt. If your wallet doesn't have the destination chain, add it — see [Supported networks → How to add a chain to your wallet](./supported-networks#how-to-add-a-chain-to-your-wallet).

---

## The approval transaction is taking forever

Testnet chains can occasionally be slow. **Don't refresh** — the transaction is in flight.

- Open your wallet and check the transaction status.
- Some wallets let you **speed up** the transaction by paying more gas. On testnet this is fine.
- If the transaction shows as **dropped** or **failed** in your wallet, close the confirm card in RecoilPay and try again.

---

## The status is stuck on "pending"

**What it means:** the solver has seen your intent but hasn't filled it yet. Usually this resolves in seconds. If it's been longer than a couple of minutes:

- The solver may be out of inventory on the destination chain — try a different destination.
- The solver may have crashed — try re-submitting.

Your funds are safe either way. If the intent fails, your input is refunded.

---

## The status shows "failed"

Something went wrong on the solver side. Your input has been (or will be) refunded — nothing was lost.

Click **Dismiss** and try again. If it fails a second time, try:

- A smaller amount.
- A different chain pair.
- Wait a few minutes.

If it keeps failing, [open an issue](https://github.com/recoil-labs/recoil-pay-v2/issues) with the sentence you typed and (if you have it) the order id from the status card.

---

## I don't see my testnet USDC in my wallet

Your wallet might not know about the mock USDC token. Add it manually:

1. In your wallet, find **Import token** (in MetaMask: **Assets** → **Import tokens** → **Custom token**).
2. Paste the USDC address for your current chain (see [Supported networks → USDC contract addresses](./supported-networks#usdc-contract-addresses)).
3. Symbol: `USDC`, decimals: the value listed for your chain (`6` on every testnet today).

The wallet should now show your balance.

---

## Nothing is happening when I click "Confirm"

Look at the top-right of your browser — most wallet extensions surface a small notification badge when they're waiting for you.

Click your wallet icon. If there's a queued request, approve or reject it. RecoilPay can't proceed until that queue is clear.

---

## Something else

If none of these describe what you're seeing:

- Take a screenshot including any error text.
- Note the sentence you typed and the chains involved.
- [Open an issue](https://github.com/recoil-labs/recoil-pay-v2/issues) with those details.

We fix reported issues fast — you're helping the whole community when you report one.
