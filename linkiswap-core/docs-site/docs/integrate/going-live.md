---
title: Going to production
sidebar_position: 6
---

# Going to production

Everything in this section works today. But RecoilPay is on testnet, and there are a handful of things you should know before you plan a launch around it. Here they are, plainly.

---

## What's testnet-only

RecoilPay runs on five public testnets: Optimism Sepolia, Base Sepolia, Polygon Amoy, Ethereum Sepolia, and BNB Chain Testnet. See [Supported networks](../supported-networks) for chain ids, tokens, and faucets.

The tokens are **mock ERC-20s** with public `mint` functions, deployed for RecoilPay testing. The USDC on these chains is not Circle's USDC. That's convenient — you can mint yourself whatever you need to test — but it means:

- Spreads and fees are effectively zero. Your production economics will differ, and the `preview` amounts you see now are not representative.
- Liquidity is not a constraint in testing. It will be in production; expect quote rejections you don't see today.
- Solver inventory is small and operated by early participants. Fill reliability will change in both directions as the network grows.

Build against the API as it is, but don't calibrate your UX — or your margins — on testnet numbers.

---

## Things that will change

Plan for these. None of them require you to rewrite your integration, but all of them are easier to absorb if you've left room.

### The API hostname

Today's origin is a Cloud Run URL. It moves to a permanent hostname before mainnet.

**Read it from configuration**, exactly as the reference client does — one environment variable, not a constant sprinkled through your code. If you've done that, the migration is a deploy.

### Authentication

The integration endpoints are anonymous today. Partner API keys are coming, and they'll be **additive**: existing anonymous calls are the end-user swap surface and are expected to stay reachable, because users authorise with an on-chain signature rather than an account.

What keys will bring you: attribution, volume reporting, higher limits, and a support channel tied to your traffic. If you want to be in the first group that gets them, [tell us now](#talk-to-us).

### Rate limits

Rate limiting is currently **disabled** on the deployment, but it isn't hypothetical — the aggregator has a global limiter built in, defaulting to **1000 requests/minute** across all callers, and switching it on is a config change rather than a release. Assume it will be enabled, and note that a global limit means a noisy integration degrades service for everyone, including your own users.

Be a good citizen now and you'll never notice the switch:

- Poll order status every 2–3 seconds, not in a tight loop.
- Don't re-request quotes on every keystroke. Debounce.
- Cache `/api/v1/chains` and `/api/v1/solvers` for tens of seconds — they change on the order of minutes.
- Back off on `5xx` rather than hammering.

An integration that already behaves this way won't notice limits arriving.

### Settlement routes

`oif-escrow-v0` via Permit2 is the proven path. The EIP-3009 route signs but reverts on-chain; resource locks and generic orders are unimplemented. Expect the set of working routes to grow.

Branch on `quote.order.type` when you sign and throw on types you don't handle. That way a new route appearing in the wild is a clean error you can see, not a malformed signature you can't.

---

## A pre-launch checklist

Worth walking before you ship, in rough order of how often each one bites:

**Correctness**

- [ ] Your interop encoder round-trips: `fromInteropAddress(interopAddress(c, a))` returns `(c, a)`, tested across all four chain ids — the 1-, 2- and 3-byte `chainRef` cases differ.
- [ ] Amounts are strings or `bigint` end to end. No amount ever passes through a JS `number`.
- [ ] Quotes reach `/orders` byte-for-byte. Nothing in between normalises, re-serialises, or strips unknown fields.
- [ ] You branch on `quote.order.type` and throw on anything unexpected.
- [ ] Signatures carry the scheme prefix (`0x00` for escrow).
- [ ] You handle `status` as an object for the `failed` case, not only as a string.

**User experience**

- [ ] You show `preview.outputs[].amount` before requesting a signature. Users never sign an unseen number.
- [ ] You check the Permit2 allowance before signing and prompt only when it's short.
- [ ] You treat `executed` as delivery, not `finalized`.
- [ ] `quotes: []` renders as a product state, not an error toast.
- [ ] You check `validUntil` before prompting to sign, and re-quote when it's near.
- [ ] Failure copy says funds are safe and escrowed — because they are.

**Operations**

- [ ] The API base URL is configuration.
- [ ] You log `x-request-id` for every failed call.
- [ ] `orderId` is persisted before the user sees a confirmation.
- [ ] You can reconcile orders after a client crash — poll by stored `orderId`, don't rely on an open session.

That last one deserves emphasis. The handoff from signature to `orderId` is the point where a dropped connection can leave a user having signed something you've lost track of. Persist first, render second.

---

## Security notes

- **You never hold funds, and neither do we.** Value moves on the user's signature directly between them and the solver, through the escrow contracts. There is no step at which either of us takes custody.
- **The quote's typed data is what the user signs.** If you build your own confirmation UI, derive what you display from `preview` — and ideally cross-check it against `payload.message` — so the screen and the signature can't diverge.
- **Order ids are not secrets**, but they're not public either. `GET /api/v1/orders/{id}` is unauthenticated, so anyone holding an id can read that order's status and amounts. Don't put them in URLs you'd rather not leak.
- **Never accept a quote from anywhere but our API.** The integrity checksum only proves we issued it; it can't help you if you fetched it from somewhere else.

---

## Talk to us {#talk-to-us}

The API is open and you don't need permission to start building. But we'd like to know you're there — partners who tell us get notice before breaking changes, early access to API keys, and a direct line when something looks wrong.

**[@RecoilPay on X](https://x.com/RecoilPay)** is the fastest way to reach the team.

Worth telling us:

- What you're building, and which direction the intents flow.
- The chains and assets you need. Coverage is driven by demand, and a specific ask ("we need Base mainnet USDC→USDC") is far more actionable than a general one.
- Whether you'd use a **hosted natural-language parse endpoint** — the plain-English layer is currently client-side, and a server-side version is a small piece of work if there's demand for it.
- What volume looks like, so we can size solver inventory before you need it rather than after.

Found a bug in the docs or the API? The docs are open source — every page has an **Edit this page** link at the bottom, and issues are welcome on the repo.

---

## Reference implementation

The RecoilPay web app is a client of the same public API, and its integration layer lives in `src/oif/`:

| File | What to copy from it |
|---|---|
| `client.ts` | The four API calls and the active-asset derivation |
| `interop.ts` | The ERC-7930 encoder and decoder |
| `buildQuoteRequest.ts` | A correct quote body, with the reasoning for each field in comments |
| `sign.ts` | EIP-712 signing, canonical Permit2 types, scheme prefixes |
| `permit2.ts` | Allowance checks and the approval transaction |

If these docs and that code ever disagree, **the code is right** — it's what serves [v2.recoilpay.com](https://v2.recoilpay.com) in production. Tell us and we'll fix the docs.
