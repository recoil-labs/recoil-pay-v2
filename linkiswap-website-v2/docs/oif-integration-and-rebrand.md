# V2 — OIF Integration + V1 Rebrand Plan

Consolidated plan covering the two workstreams the project needs now:
**A.** wire V2 to the live OIF engine (the intent feature), and **B.** fix the UI so it matches V1's
real brand instead of looking AI-generated. Builds on
[`intent-execution-plan.md`](./intent-execution-plan.md) and
[`intent-parser-design.md`](./intent-parser-design.md).

---

## Verified facts (2026-06-26)

**OIF is fully deployed and live on Render** (only V2 isn't deployed yet):
- UI `https://oif-ui.onrender.com` → **HTTP 200**
- Aggregator `https://oif-aggregator.onrender.com/health` → **healthy**, 1 solver active
- Assets: **USDC** on **Base Sepolia (84532)** + **OP Sepolia (11155420)** only (testnet).
- `render` CLI is installed and authed → can pull logs / restart / check deploys.
- **Integration target for V2:** `https://oif-aggregator.onrender.com/api/v1`.

**V1's real brand** (from `/Users/apple/Documents/linkiswap/website`, the source of truth):
- Fonts: **AtypFont** (`AtypDisplay` 400/500/600/700, in `src/assets/fonts/`) + **Inter**. No serif. No mono.
- Palette (CSS vars in `src/styles/index.css`):
  `--app-bg #070436`, `--surface #171a56`, `--surface-alt #1e216f`, `--primary #424af6`,
  `--accent-cyan #61e5fc`, `--border rgba(196,199,252,.8)`, `--footer-bg #010420`,
  `--app-text #effcff`. (V1 also has a light theme; we target the dark brand.)

**Why V2 looks "AI-made":** wrong fonts (Instrument Serif italic headlines + JetBrains Mono terminal),
a near-black `#00071F` background instead of V1's indigo `#070436`, off surface colors, and a broken
responsive nav (desktop cluster never collapses → Connect button renders twice on mobile).

---

## Workstream B — V1 rebrand (UI foundation)

Do this first and fast: it unbreaks the nav and makes the whole site on-brand, so the intent UI we
build next is born correct.

1. **Fonts.** Copy `AtypDisplay-{Regular,Medium,Semibold,Bold}.{woff2,woff}` from V1
   (`website/src/assets/fonts/`) into V2 `src/assets/fonts/`. Add the `@font-face` block (lift from
   V1 `src/styles/fonts.css`) to V2 `globals.css`. Set display/headline font → **AtypFont**, body →
   **Inter**. Remove **Instrument Serif** and **JetBrains Mono** (replace the mono terminal/address
   bits with Atyp/Inter).
2. **Palette.** Replace V2 `globals.css` `:root` tokens with V1's real values (`#070436` bg,
   `#171a56`/`#1e216f` surfaces, `#424af6`/`#61e5fc` accents, V1 borders). Keep the same token names
   the components already use so the change is mostly central.
3. **Nav fix.** Remove the inline `display:flex` on `.nav-desktop-links` / `.nav-desktop-cta` that
   overrides the `@media (max-width) { display:none }` rule, so the desktop nav actually collapses
   ≤900px and the wallet control shows once per breakpoint. (Pre-existing bug surfaced by the real
   wallet button.)
4. **De-AI the shell** (scoped): retune the hero + SwapWidget to V1 surfaces/typography; soften the
   animated-gradient headline and the typewriter so it reads like a product, not a template. (Full
   per-section redesign is a later pass — this is the brand-consistency sweep.)

---

## Workstream A — OIF ↔ V2 intent connection (the main feature)

The non-visual logic (A1–A2) is independent of branding; the intent UI (A3) sits on the rebranded shell.

- **A1 · Intent parser** (`src/intent/`) — grammar + registry + validate + resolve, per the parser
  design doc. Support layer loads live solver assets from `getSupportedAssets()` (already built in
  Phase 0). All-at-once field-named validation ("Amount is not stated.", etc.).
- **A2 · OIF client + signing** (`src/oif/`) — `interop.ts` (ERC-7930 InteropAddress encode/decode),
  `buildQuoteRequest.ts` (ResolvedIntent → QuoteRequest), typed `client.ts` quote/submit/get,
  `quoteSigner.ts` (port from the OIF demo — Permit2 escrow-v0 first), `permit2.ts` (allowance +
  approve). Prove against the live aggregator with a hardcoded USDC OP→Base Sepolia intent.
- **A3 · Intent UI** (on the rebranded shell) — make `IntentBar` a live input (Enter → parse →
  inline errors / off-template hint); `IntentConfirmCard` (best quote: pay / receive / eta / #
  solvers → approve → sign → submit); `OrderStatus` (poll `/orders/{id}` to terminal). `useIntent`
  orchestrates.
- **A4 · Guardrails** — testnet banner, "supported today" hint from solver assets, balance check,
  quote-expiry re-quote, i18n error strings (and wire the unused `ja`/`ko` locales while here).

---

## Recommended sequence

```
1. Rebrand foundation   (B1 fonts, B2 palette, B3 nav fix)   ← quick, unbreaks UI, on-brand
2. Intent logic         (A1 parser, A2 OIF client + signer)  ← non-visual, prove vs live aggregator
3. Intent UI            (A3 on the rebranded shell)          ← the visible feature
4. Polish               (B4 de-AI sweep, A4 guardrails, i18n)
5. (later) Deploy V2 to Render like the rest of the stack
```

Phase 0 (web3 foundation: wagmi/RainbowKit, 11 chains, OIF client, providers) is already done on
branch `feat/phase0-web3-foundation`.

---

## Out of scope (unchanged)

- Expanding OIF to mainnet / more chains / a real oracle — that's `/oif` (linkiswap-core) work.
- Fiat actions (buy/sell/cash out/gift card) — not OIF.
- LLM free-form parsing — fixed templates only.
