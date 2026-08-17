# LinkiSwap docs

End-user documentation for the LinkiSwap V2 product UI. Built with [Docusaurus](https://docusaurus.io/) 3.

The published site is aimed at people using LinkiSwap — how to do their first swap, what sentences the intent bar understands, which chains and tokens are live, how to set up a wallet, and what to do when something goes wrong. Developer-facing docs live in the repo root (`../README.md`, `../docs/`).

## Run locally

```sh
cd docs-site
npm install
npm start
```

Opens http://localhost:3000. Hot-reloads on save.

## Type-check

```sh
npm run typecheck
```

## Build for production

```sh
npm run build      # writes to ./build
npm run serve      # serves the static build on http://localhost:3000
```

`build/` is gitignored (via the root `.gitignore`).

## Deploy

The site is a plain static bundle. Any static host works — Render, Vercel, Netlify, Cloudflare Pages, S3, or GitHub Pages.

For a Render static-site deployment, use:

- **Build command:** `npm install && npm run build`
- **Publish directory:** `docs-site/build`

## Content layout

```
docs-site/
├── docs/                      Every user-facing markdown page
│   ├── intro.md               Landing (slug: /)
│   ├── quickstart.md
│   ├── writing-intents.md
│   ├── supported-networks.md
│   ├── wallet-setup.md
│   ├── fees-and-timing.md
│   ├── faq.md
│   └── troubleshooting.md
├── src/css/custom.css         Theme override — mirrors the V2 UI palette
├── static/img/                Logo + favicon
├── docusaurus.config.ts       Site configuration
├── sidebars.ts                Sidebar order
└── tsconfig.json
```

Sidebar order is declared explicitly in `sidebars.ts` — it does **not** derive from `sidebar_position` in the markdown frontmatter, so if you add a new page you must add it to `sidebars.ts` too.

## Editing conventions

- Write for someone who has never used a blockchain before.
- Every page ends with a `→ [Next step](./next-page)` link so readers can walk the site linearly.
- Keep tables aligned; keep code fences terminal-friendly (no exotic Unicode inside `\`\`\`sh` blocks).
- Prefer plain English over jargon. When jargon is unavoidable, define it inline the first time.

## Related

- Product-level overview: [`../docs/product-description.md`](../docs/product-description.md)
- Root repo README: [`../README.md`](../README.md)
