# RecoilPay Tags

The reservation site for RecoilPay tags: `tags.recoilpay.com`. Reserve `@name` for a wallet with a free signature, map addresses per token, share the tag.

It shares RecoilPay's brand and nothing else. There are no imports from v2 and no dependency on the aggregator.

```
shared/   tag rules, the signed-message text, route list (used by both sides)
api/      Hono + Postgres registry, signature checks, OG images, per-tag page metadata
web/      Vite + React + Tailwind v4 + framer-motion page
```

## Run it locally

```sh
npm install
npm run dev:api     # :8787, uses an on-disk PGlite (real Postgres in WASM), no DB needed
npm run dev:web     # :5173, proxies /api and /og to :8787
npm test            # API tests: signatures, uniqueness, races, limits, privacy
```

To try the page exactly as it is served in production, run `npm run build -w web`, then `PUBLIC_ORIGIN=http://localhost:8787 npm run dev:api` and open http://localhost:8787.

## How a reservation works

1. **Choose.** The claim field checks availability 350ms after typing stops. Brand and ticker names in `shared/tag.ts` are held back.
2. **Connect.** The connected wallet proves ownership and becomes the default address.
3. **Sign.** The wallet signs a plain-text message (`reservationMessage` in `shared/tag.ts`) stating the tag, wallet, chain, time and origin. The API rebuilds that text itself and verifies the signature with viem, which covers EOAs as well as ERC-1271/6492 smart wallets. It rejects signatures older than 10 minutes and any origin not in its list. **No transaction and no gas.**
4. **Map addresses.** Reserving returns a one-hour edit token for the address step. Owners who come back later sign a separate "manage" message (free) to get a new token.

Guarantees are enforced by the database, not by application code:

- A case-insensitive unique index on `lower(tag)`, plus a `CHECK` on the tag's shape.
- A limit of 3 tags per wallet, checked inside a transaction that holds a per-wallet advisory lock, so parallel requests can't get around it.
- Mapped addresses stay private unless the owner opts in (`show_addresses`).

## Decisions taken (change them before launch if you disagree)

| Question the spec left open | Chosen | Where |
|---|---|---|
| On-chain registry or database | Database, signature-only | `api/src/schema.sql` |
| Anti-squatting | 3 tags per wallet + a blocklist of brands and tickers | `MAX_TAGS_PER_WALLET`, `RESERVED_TAGS` in `shared/tag.ts` |
| Do reservations expire | No. This is stated in the signed message and at the signing step | `reservationMessage`, `SignStep` |
| Wallets | EVM only: Ethereum, Base, Arbitrum, Optimism, Polygon | `web/src/lib/wallet.ts`, `api/src/chain.ts` |
| Tag rules | 3–20 chars, `a–z 0–9 _`, lowercased silently | `shared/tag.ts` |
| Routes a tag carries | ETH on Ethereum/Base; USDC on Ethereum/Base/Arbitrum/Polygon | `ROUTES` in `shared/tag.ts` |

## Deploying on Railway

**Recommended: one service.** The API serves the built page, so crawlers get per-tag metadata. When someone posts `tags.recoilpay.com/@jasonobb`, the preview shows that tag's own card (`/og/jasonobb.png`). A static host can't do this, and that card is the most important thing to get right for sharing.

- Create a service from the `recoil-pay-v2` repo with **Root Directory** set to `recoilpay-tags`. `recoilpay-tags/railway.json` builds the web app and starts the API.
- Add the Railway Postgres plugin and set `DATABASE_URL`, `PUBLIC_ORIGIN=https://tags.recoilpay.com`, `NODE_ENV=production`, and `VITE_WALLETCONNECT_PROJECT_ID` (a build-time variable).
- The schema is applied on every boot, and it's safe to run repeatedly.

**Split, as the original spec describes:** a static site from `web/`, using the `Staticfile` (`root: dist`, `index_fallback: true`), plus the API as its own service. Set `VITE_API_URL` on the site, and `CORS_ORIGINS` and `ALLOWED_ORIGINS` on the API. This works, but every shared link shows the generic card instead of the tag's own.

## Before running more than one API instance

Rate limiting (`api/src/rateLimit.ts`) and the OG image cache live in memory. Both are fine for a single instance. Move them to Postgres or Redis before scaling out.
