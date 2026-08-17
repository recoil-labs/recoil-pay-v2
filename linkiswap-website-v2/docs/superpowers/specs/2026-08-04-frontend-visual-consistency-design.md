# Frontend Visual Consistency Design

## Goal

Bring every presentational component into one LinkiSwap V2 visual system based on `agent2.md`: dark crypto-forward glassmorphism, deep navy surfaces, cyan/primary-blue accents, compact premium controls, and high-legibility financial UI.

This is a visual-only pass. It must not change wallet behavior, intent execution, data fetching, route parsing, subscriptions, chain config, or build config.

## Scope

Allowed files:

- `src/components/**`
- `src/components/ui/**`
- `src/globals.css`
- `src/i18n/locales/*.json` only when existing visible UI copy must remain translatable after presentational edits

Forbidden files:

- `src/hooks/**`
- `src/intent/**`
- `src/oif/**`
- `src/wallet/**`
- `src/lib/**`
- `src/main.tsx`
- `vite.config.ts`, package files, environment files, deployment files

## Visual Direction

The app should feel like a unified Web3 execution interface: calm, technical, dense where data matters, and visually premium without becoming noisy.

Core rules:

- Use existing theme tokens instead of hard-coded palette values when possible.
- Prefer Tailwind classes and the existing `cn` helper for component styling.
- Preserve the dark navy, cyan, and primary-blue palette from `agent2.md`.
- Keep section spacing generous and consistent across desktop and mobile.
- Use glass surfaces, subtle translucent borders, and restrained glow effects.
- Use `font-display` for headings and key numbers, `font-sans` for UI copy, and `font-mono` for addresses, IDs, ranks, symbols, and exact data.
- Keep buttons and interactive controls compact, rounded, and responsive with active press feedback.
- Keep motion short and subtle, respecting existing reduced-motion handling where available.

## Components

### Shared UI Primitives

`Button`, `Input`, and `Dialog` should remain the baseline primitives. Their styling should support the Agent 2 system: glassy input surfaces, clear focus rings, subtle borders, compact radius, and active press feedback.

### Navigation and Wallet

Navigation should stay sticky, compact, and glassy. Wallet, language, mobile menu, and theme controls should share the same border, blur, radius, focus, hover, and text sizing conventions.

No wallet connection, network switching, adapter selection, or modal-opening logic should change.

### Hero and Intent Surface

The hero should remain centered and airy, with the intent command as the main first-screen interaction. The intent surface should look like the product's primary execution terminal: strong glass panel, high-contrast input, clean action button, readable examples, and consistent status cards.

No parsing, quote, transaction, wallet, or status logic should change.

### Data and Execution Panels

`IntentConfirmCard`, `OrderStatus`, `SolverMarketplace`, and `LivePrices` should prioritize legibility:

- Financial amounts use display type.
- IDs, symbols, ranks, and percentages use mono styling where appropriate.
- Tables and route cards should have clear row hover states, subtle separators, and enough density for scanning.
- Loading states should use theme-aligned skeletons rather than flat blocks where practical.

### Content Sections

Problem, Solution, How It Works, Product Tour, Supported Networks, Features, Vision, Blog, Roadmap, Final CTA, Trust Strip, Stats, and Footer should share:

- Consistent section padding and max-width rhythm.
- Matching eyebrow, heading, and supporting copy styles.
- Similar glass card treatment across repeated cards.
- No nested card-in-card visual clutter.
- Responsive layouts that avoid cramped text or overflow.

The older inline-styled sections, especially Product Tour, Supported Networks, Live Prices, and Blog, should be converted to the same class/token language used by the newer sections.

## Accessibility

- Preserve all existing labels and button semantics.
- Add or improve visual focus states when styling interactive controls.
- Ensure mobile layouts do not create horizontal overflow.
- Keep text readable against glass surfaces in both dark and light themes.
- Do not add visible instructional text just to explain controls.

## Implementation Constraints

- No new animation library.
- No new font family.
- No new data-flow abstraction.
- No broad logic refactor.
- No changes to API calls, hooks, wallet providers, query keys, or route behavior.
- Avoid new global CSS unless a token or utility is genuinely shared.

## Verification

Run these checks after implementation:

- `npm.cmd exec vite -- build`
- `git diff --check -- src/components src/globals.css`
- `npm.cmd run build` if current unrelated TypeScript errors are resolved or intentionally included in scope later
- `npm.cmd run lint -- src/components src/globals.css` if the local ESLint dependency issue is resolved

If a verification command fails for unrelated pre-existing reasons, document the exact failure and run the strongest scoped check available.
