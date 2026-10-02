# RecoilPay V2 — Home Page

Marketing and product landing page for **RecoilPay V2**, an intent-powered cross-chain swap protocol. Built as a React 19 + Vite 6 SPA with full internationalisation support.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 19 + TypeScript |
| Build tool | Vite 6 |
| Styling | Tailwind CSS v4 + global CSS custom properties |
| i18n | react-i18next + i18next-browser-languagedetector |
| Fonts | Inter (body), Instrument Serif (display), JetBrains Mono (labels) |

---

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:5173)
npm run dev

# Type-check
npx tsc --noEmit

# Production build
npm run build

# Preview production build locally
npm run preview
```

---

## Project Structure

```
src/
├── components/              # All page sections and UI components
│   ├── Nav.tsx              # Sticky navigation with language switcher
│   ├── Hero.tsx             # Hero section with swap widget
│   ├── SwapWidget.tsx       # Interactive swap / send / buy / sell widget
│   ├── IntentBar.tsx        # Animated intent input bar
│   ├── Stats.tsx            # Animated count-up stats (volume, chains, etc.)
│   ├── HowItWorks.tsx       # Animated 4-step process timeline
│   ├── Problem.tsx          # Pain points section
│   ├── Solution.tsx         # Before / after solution section
│   ├── Features.tsx         # 6-card feature grid
│   ├── SolverMarketplace.tsx # Solver competition visualisation
│   ├── Vision.tsx           # Vision / philosophy section
│   ├── Roadmap.tsx          # 4-phase product roadmap
│   ├── TrustStrip.tsx       # Trust / partner strip
│   ├── FinalCTA.tsx         # Bottom call-to-action
│   ├── Footer.tsx           # Footer with nav links
│   ├── Logo.tsx             # SVG logo + V2 badge
│   └── RevealSection.tsx    # Scroll-triggered fade-in wrapper
├── i18n/
│   ├── index.ts             # i18next configuration
│   └── locales/             # Translation files (12 languages)
│       ├── en.json          # English (source of truth)
│       ├── es.json          # Spanish
│       ├── zh.json          # Chinese (Simplified)
│       ├── hi.json          # Hindi
│       ├── ar.json          # Arabic
│       ├── fr.json          # French
│       ├── de.json          # German
│       ├── pt.json          # Portuguese
│       ├── sw.json          # Swahili
│       ├── pcm.json         # Nigerian Pidgin
│       ├── ja.json          # Japanese
│       └── ko.json          # Korean
├── lib/
│   └── tokens.ts            # Token list, prices, and formatAmount helper
├── globals.css              # Design system: CSS variables, keyframes, layout classes
├── App.tsx                  # Root component — section order
└── main.tsx                 # Entry point + i18n bootstrap
public/
└── logo.svg                 # RecoilPay SVG wordmark
```

---

## Design System

All design tokens live in `src/globals.css` as CSS custom properties.

### Colour palette (V1 branding)

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#00071F` | Page background |
| `--panel` | `#060C22` | Widget / panel background |
| `--card` | `#0D1635` | Card background |
| `--primary` | `#424AF6` | Electric blue — primary actions |
| `--cyan` | `#61E5FC` | Cyan — accents, eyebrows |
| `--mint` | `#7CF6B5` | Mint — success states |
| `--muted` | `#8BA2F9` | Muted lavender — secondary text |
| `--text` | `#EEF2FF` | Near-white — primary text |
| `--faint` | `#545969` | Faint — tertiary text |

### Key CSS classes

| Class | Purpose |
|---|---|
| `.eyebrow` | Cyan JetBrains Mono uppercase section label |
| `.gradient-text-animated` | Animated blue→cyan→mint gradient text |
| `.section-tinted` | Alternate section background with blue border |
| `.btn-shimmer` | Shimmer hover effect on CTA buttons |
| `.reveal` / `.reveal.visible` | Scroll-triggered fade-in (used by RevealSection) |
| `.timeline-row` | 4-column HowItWorks timeline grid |
| `.roadmap-row` | 4-column Roadmap grid with gradient connector |
| `.stats-row` | 4-column stats card grid |
| `.grid-hero` | 2-column hero layout |
| `.feature-card` | Feature card with hover lift |

---

## Internationalisation

Language is auto-detected from the browser. Users can switch via the nav language picker.

To add a new language:
1. Copy `src/i18n/locales/en.json` to `src/i18n/locales/<code>.json`
2. Translate all values (keep all keys identical)
3. Import and register the new locale in `src/i18n/index.ts`
4. Add the language entry to the switcher array in `src/components/Nav.tsx`

---

## Animations

| Section | Animation |
|---|---|
| Hero widget | Floating (`float` keyframe, 7s loop) |
| Hero orbs | Slow drift (`orb-drift-1/2`, 14–18s loop) |
| Stats | Staggered card reveal + count-up on scroll entry + completion glow ring |
| HowItWorks | Cycling step highlight every 2.4s + scanning light on connector line |
| All sections | Scroll-triggered fade-up via `RevealSection` + `IntersectionObserver` |
| CTA buttons | Shimmer sweep on hover |
| Heading text | Animated gradient (`gradient-shift`, 6s loop) |
| Solver dots | Sequential pulse in SwapWidget footer |

All animations respect `prefers-reduced-motion`.

---

## Deployment

The build output is a static site in `dist/` — deploy to any static host (Vercel, Netlify, Cloudflare Pages, S3, etc.).

```bash
npm run build
# → dist/ is ready to deploy
```

Both `dist/` and `.claude/` are excluded from version control via `.gitignore`.
