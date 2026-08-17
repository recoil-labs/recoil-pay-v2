# Frontend Visual Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every presentational component visually consistent with the LinkiSwap V2 `agent2.md` system without changing application logic.

**Architecture:** Use a token-led visual pass. Shared, genuinely reusable styling belongs in `src/globals.css`; component-specific polish stays in the component JSX via Tailwind classes and `cn`. Older inline-styled sections are converted to the same glass, border, type, spacing, and responsive patterns already used by newer sections.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS v4, Framer Motion where already present, Lucide icons, i18next, local shadcn-style primitives.

## Global Constraints

- This is a visual-only pass. It must not change wallet behavior, intent execution, data fetching, route parsing, subscriptions, chain config, or build config.
- Allowed files: `src/components/**`, `src/components/ui/**`, `src/globals.css`, and `src/i18n/locales/*.json` only when existing visible UI copy must remain translatable after presentational edits.
- Forbidden files: `src/hooks/**`, `src/intent/**`, `src/oif/**`, `src/wallet/**`, `src/lib/**`, `src/main.tsx`, `vite.config.ts`, package files, environment files, deployment files.
- No new animation library.
- No new font family.
- No new data-flow abstraction.
- No broad logic refactor.
- No changes to API calls, hooks, wallet providers, query keys, or route behavior.
- Avoid new global CSS unless a token or utility is genuinely shared.
- The repository is currently in a merge state. Do not run broad merge-resolution commands. Commit steps are only allowed after the merge state is resolved; otherwise record the intended commit command and continue with path-scoped diffs.

---

## File Structure

Modify:

- `src/globals.css`: shared visual utility classes, reduced-motion-safe shimmer, section rhythm, shared glass/card/media/table helpers if they reduce repetition.
- `src/components/ui/Button.tsx`: visual classes only for button consistency.
- `src/components/ui/Input.tsx`: visual classes only for input consistency.
- `src/components/ui/Dialog.tsx`: visual classes only for dialog consistency.
- `src/components/Nav.tsx`, `src/components/WalletButton.tsx`, `src/components/ThemeToggle.tsx`, `src/components/Footer.tsx`, `src/components/Logo.tsx`: app chrome consistency.
- `src/components/Hero.tsx`, `src/components/IntentBar.tsx`, `src/components/TokenInputBlock.tsx`, `src/components/IntentConfirmCard.tsx`, `src/components/OrderStatus.tsx`, `src/components/SwapCompleteModal.tsx`: primary execution surface consistency.
- `src/components/Stats.tsx`, `src/components/TrustStrip.tsx`, `src/components/Problem.tsx`, `src/components/Solution.tsx`, `src/components/HowItWorks.tsx`, `src/components/SolverMarketplace.tsx`, `src/components/Features.tsx`, `src/components/Vision.tsx`, `src/components/Roadmap.tsx`, `src/components/FinalCTA.tsx`: marketing and product story consistency.
- `src/components/ProductTour.tsx`, `src/components/SupportedNetworks.tsx`, `src/components/LivePrices.tsx`, `src/components/BlogSection.tsx`: older inline-styled islands that need the most normalization.

Do not modify:

- `src/hooks/**`
- `src/intent/**`
- `src/oif/**`
- `src/wallet/**`
- `src/lib/**`
- root config and package files

---

### Task 1: Shared Visual Utilities and UI Primitives

**Files:**
- Modify: `src/globals.css`
- Modify: `src/components/ui/Button.tsx`
- Modify: `src/components/ui/Input.tsx`
- Modify: `src/components/ui/Dialog.tsx`

**Interfaces:**
- Consumes: Existing CSS variables such as `--surface-glass`, `--surface-glass-strong`, `--border-subtle`, `--accent-cyan`, `--primary-dim`, `--shadow-color`.
- Produces: Shared visual classes that later tasks may use: `.section-shell`, `.section-heading`, `.section-eyebrow`, `.glass-panel`, `.glass-card`, `.media-shell`, `.skeleton-shimmer`.

- [ ] **Step 1: Confirm no forbidden files are touched before starting**

Run:

```powershell
git status --short
```

Expected: Dirty files may exist, but implementation for this task must only edit `src/globals.css` and `src/components/ui/*`.

- [ ] **Step 2: Add shared visual utilities to `src/globals.css`**

Add utilities near the existing reusable hover/tile classes:

```css
.section-shell {
  padding: 6rem 1.25rem;
}

.section-heading {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 600;
  line-height: 1.04;
  color: var(--app-text);
}

.section-eyebrow {
  font-family: var(--font-sans);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent-cyan);
}

.glass-panel {
  border: 1px solid var(--border-subtle);
  background: var(--surface-glass-strong);
  box-shadow: 0 34px 120px -72px var(--shadow-color), 0 0 36px var(--accent-cyan-soft);
  backdrop-filter: blur(24px);
}

.glass-card {
  border: 1px solid var(--border-subtle);
  background: var(--surface-glass);
  box-shadow: 0 24px 90px -70px var(--shadow-color);
  backdrop-filter: blur(18px);
}

.media-shell {
  border: 1px solid var(--border-subtle);
  background: var(--surface-input);
  box-shadow: inset 0 1px 0 rgba(239, 252, 255, 0.04);
}

.skeleton-shimmer {
  position: relative;
  overflow: hidden;
  background: var(--surface-alt);
}

.skeleton-shimmer::after {
  position: absolute;
  inset: 0;
  content: "";
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(239, 252, 255, 0.08), transparent);
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  100% { transform: translateX(100%); }
}

@media (min-width: 640px) {
  .section-shell {
    padding-right: 2rem;
    padding-left: 2rem;
  }
}

@media (min-width: 1024px) {
  .section-shell {
    padding: 7rem 2.5rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-shimmer::after {
    animation: none;
  }
}
```

- [ ] **Step 3: Normalize primitive focus and active states without changing props**

In `Button.tsx`, keep `ButtonProps`, `buttonVariants`, `buttonSize`, and `forwardRef` behavior unchanged. Update class strings only so every variant includes token-based colors, `focus-visible:ring-2 focus-visible:ring-accent-cyan/70`, and `active:scale-[0.98]`.

In `Input.tsx`, keep the exported component and props unchanged. Update only classes to use `bg-surface-input`, `border-border-subtle`, `text-app-text`, `placeholder:text-text-muted`, and the same focus ring.

In `Dialog.tsx`, keep Radix/component behavior unchanged. Update only panel/backdrop/title classes to match `glass-panel`, `text-app-text`, and `text-text-secondary`.

- [ ] **Step 4: Verify this task has no logic diff**

Run:

```powershell
git diff -- src/components/ui/Button.tsx src/components/ui/Input.tsx src/components/ui/Dialog.tsx src/globals.css
```

Expected: Diffs show class names and CSS utility additions only. No new state, no new hooks, no changed handlers, no changed imports except `cn` if already missing and needed for class merging.

- [ ] **Step 5: Run scoped whitespace check**

Run:

```powershell
git diff --check -- src/components/ui/Button.tsx src/components/ui/Input.tsx src/components/ui/Dialog.tsx src/globals.css
```

Expected: Exit code 0.

- [ ] **Step 6: Commit if the merge state is resolved**

If `git status` no longer reports an active merge, run:

```powershell
git add -- src/globals.css src/components/ui/Button.tsx src/components/ui/Input.tsx src/components/ui/Dialog.tsx
git commit -m "style: add shared frontend visual system utilities"
```

If Git still reports an active merge, do not commit. Record that commit is blocked by merge state.

---

### Task 2: App Chrome Consistency

**Files:**
- Modify: `src/components/Nav.tsx`
- Modify: `src/components/WalletButton.tsx`
- Modify: `src/components/ThemeToggle.tsx`
- Modify: `src/components/Footer.tsx`
- Modify: `src/components/Logo.tsx`

**Interfaces:**
- Consumes: `.glass-panel`, `.glass-card`, existing `cn`, existing wallet/nav/theme handlers.
- Produces: Consistent app chrome with shared compact controls and focus states.

- [ ] **Step 1: Preserve existing behavior before editing**

Read these functions and handlers before changes:

```text
Nav: setMenuOpen, setLangOpen, i18n.changeLanguage, language outside-click Escape handler
WalletButton: EVM/Solana connect handlers, modal open/close handlers
ThemeToggle: theme toggle handler
Footer and Logo: links and rendered brand mark
```

Expected: No handler listed above is removed or changes behavior.

- [ ] **Step 2: Normalize `Nav.tsx` classes**

Change only class strings and layout classes:

```tsx
<nav className="sticky top-0 z-50 border-b border-header-border bg-header-bg/90 backdrop-blur-2xl transition-colors duration-200">
```

Use consistent control classes for nav links and mobile links:

```tsx
"rounded-full px-4 py-2 font-sans text-[13px] font-semibold text-text-secondary no-underline transition-[background,color,transform,border-color] duration-200 hover:-translate-y-px hover:bg-surface-hover hover:text-app-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/70"
```

Keep `navLinks`, language selection, external link attrs, and mobile menu behavior unchanged.

- [ ] **Step 3: Normalize `WalletButton.tsx` visual classes**

Only adjust visual classes if needed after Task 1. Keep the already typed Solana and EVM handling unchanged. Check for consistency:

```text
Primary connect button: bg-btn-primary-bg, text-btn-primary-text, active:scale-[0.98]
Menu/dialog panels: glass-panel or equivalent token classes
Address text: font-mono
Network labels: font-sans, text-text-secondary
Focus rings: focus-visible:ring-accent-cyan/70
```

- [ ] **Step 4: Normalize `ThemeToggle.tsx`, `Footer.tsx`, and `Logo.tsx`**

Update visual class strings only:

```text
ThemeToggle: match Nav button size, rounded-full, border-border-subtle, bg-surface-glass.
Footer: use bg-footer-bg, border-border-subtle, text-text-secondary, compact link hover to accent-cyan.
Logo: preserve SVG/brand shape. Only adjust sizing or token color classes if inconsistent.
```

- [ ] **Step 5: Verify no app chrome logic changed**

Run:

```powershell
git diff -- src/components/Nav.tsx src/components/WalletButton.tsx src/components/ThemeToggle.tsx src/components/Footer.tsx src/components/Logo.tsx
```

Expected: No changed hook calls, no changed state names, no changed wallet adapter calls, no changed link destinations except visual-only class updates.

- [ ] **Step 6: Run scoped whitespace check**

Run:

```powershell
git diff --check -- src/components/Nav.tsx src/components/WalletButton.tsx src/components/ThemeToggle.tsx src/components/Footer.tsx src/components/Logo.tsx
```

Expected: Exit code 0.

- [ ] **Step 7: Commit if the merge state is resolved**

```powershell
git add -- src/components/Nav.tsx src/components/WalletButton.tsx src/components/ThemeToggle.tsx src/components/Footer.tsx src/components/Logo.tsx
git commit -m "style: unify app chrome visuals"
```

If Git still reports an active merge, do not commit. Record that commit is blocked by merge state.

---

### Task 3: Hero and Intent Execution Surface

**Files:**
- Modify: `src/components/Hero.tsx`
- Modify: `src/components/IntentBar.tsx`
- Modify: `src/components/TokenInputBlock.tsx`
- Modify: `src/components/IntentConfirmCard.tsx`
- Modify: `src/components/OrderStatus.tsx`
- Modify: `src/components/SwapCompleteModal.tsx`

**Interfaces:**
- Consumes: Existing intent props, hooks, callback props, `cn`, UI primitives, `.glass-panel`, `.glass-card`, `.skeleton-shimmer`.
- Produces: Unified first-screen execution terminal and settlement cards.

- [ ] **Step 1: Identify behavior that must remain unchanged**

Before editing, search:

```powershell
Select-String -LiteralPath 'src\components\IntentBar.tsx','src\components\IntentConfirmCard.tsx','src\components\OrderStatus.tsx','src\components\SwapCompleteModal.tsx' -Pattern 'intent\.|onConfirm|onConnect|onCancel|onClick|useIntent|useConnectModal|status|phase'
```

Expected: Treat these matches as behavior boundaries. Do not alter control flow or callback targets.

- [ ] **Step 2: Normalize `Hero.tsx` section rhythm**

Keep hero content order and `IntentBar` placement unchanged. Align section classes to:

```tsx
<section className="relative isolate overflow-hidden px-5 pb-20 pt-12 sm:px-8 sm:pb-24 sm:pt-16 lg:px-10 lg:pb-28">
```

Use existing background pattern and ambient lighting. If adding a class, use token-backed values only.

- [ ] **Step 3: Normalize `IntentBar.tsx` terminal visuals**

Keep `useIntent`, placeholder animation, example click behavior, submit behavior, and status rendering unchanged. Update only:

```text
Outer card: glass-panel rounded-[28px]
Input well: bg-surface-input border-border-subtle focus border-border-cyan
Examples: chip-bg, chip-hover-bg, border-border-subtle, hover:border-border-cyan
Status notes: glass-card or existing bg-surface-glass with token text
Primary Run button: existing Button default variant with compact h-11 rounded-full
```

- [ ] **Step 4: Normalize route and settlement cards**

For `TokenInputBlock.tsx`, `IntentConfirmCard.tsx`, `OrderStatus.tsx`, and `SwapCompleteModal.tsx`, update class strings only:

```text
Cards: glass-panel or glass-card with rounded-[24px]
Amounts: font-display, text-app-text, tabular visual alignment
Addresses, IDs, symbols: font-mono
Positive/accent states: text-accent-cyan, border-border-cyan, bg-primary-dim
Error states: text-red, bg-red-soft, border-red/30
Buttons: active:scale-[0.98], focus-visible:ring
```

- [ ] **Step 5: Verify no intent logic changed**

Run:

```powershell
git diff -- src/components/Hero.tsx src/components/IntentBar.tsx src/components/TokenInputBlock.tsx src/components/IntentConfirmCard.tsx src/components/OrderStatus.tsx src/components/SwapCompleteModal.tsx
```

Expected: No changed calls to `intent.run`, `intent.confirm`, `intent.reset`, `openConnectModal`, `onConfirm`, `onConnect`, `onCancel`, or status mapping functions.

- [ ] **Step 6: Run scoped whitespace check**

Run:

```powershell
git diff --check -- src/components/Hero.tsx src/components/IntentBar.tsx src/components/TokenInputBlock.tsx src/components/IntentConfirmCard.tsx src/components/OrderStatus.tsx src/components/SwapCompleteModal.tsx
```

Expected: Exit code 0.

- [ ] **Step 7: Commit if the merge state is resolved**

```powershell
git add -- src/components/Hero.tsx src/components/IntentBar.tsx src/components/TokenInputBlock.tsx src/components/IntentConfirmCard.tsx src/components/OrderStatus.tsx src/components/SwapCompleteModal.tsx
git commit -m "style: unify intent execution surfaces"
```

If Git still reports an active merge, do not commit. Record that commit is blocked by merge state.

---

### Task 4: Product Story Section Consistency

**Files:**
- Modify: `src/components/Stats.tsx`
- Modify: `src/components/TrustStrip.tsx`
- Modify: `src/components/Problem.tsx`
- Modify: `src/components/Solution.tsx`
- Modify: `src/components/HowItWorks.tsx`
- Modify: `src/components/SolverMarketplace.tsx`
- Modify: `src/components/Features.tsx`
- Modify: `src/components/Vision.tsx`
- Modify: `src/components/Roadmap.tsx`
- Modify: `src/components/FinalCTA.tsx`

**Interfaces:**
- Consumes: Existing translated content, icon arrays, reveal wrappers, current section IDs.
- Produces: Consistent spacing, headings, cards, and hover treatment across story sections.

- [ ] **Step 1: Preserve section IDs and translated content**

Search section IDs and translation usage:

```powershell
Select-String -LiteralPath 'src\components\Stats.tsx','src\components\TrustStrip.tsx','src\components\Problem.tsx','src\components\Solution.tsx','src\components\HowItWorks.tsx','src\components\SolverMarketplace.tsx','src\components\Features.tsx','src\components\Vision.tsx','src\components\Roadmap.tsx','src\components\FinalCTA.tsx' -Pattern 'id=|t\('
```

Expected: Keep IDs and translation keys unchanged.

- [ ] **Step 2: Apply shared section rhythm**

For each section, use one of these patterns:

```tsx
<section className="section-shell px-5 sm:px-8 lg:px-10">
```

or, when the section already needs a border/tint:

```tsx
<section className="section-shell border-y border-border bg-section-tint px-5 sm:px-8 lg:px-10">
```

Do not remove existing IDs such as `id="how"`, `id="marketplace"`, `id="features"`, or `id="roadmap"`.

- [ ] **Step 3: Normalize headings and eyebrows**

Use these classes where they replace duplicate styling:

```tsx
<span className="section-eyebrow">{t('section.label')}</span>
<h2 className="section-heading mt-4 text-[clamp(32px,4vw,54px)]">{t('section.h2')}</h2>
```

Keep any gradient text already used for major CTA emphasis if it uses `var(--gradient-text)`.

- [ ] **Step 4: Normalize repeated cards**

For repeated feature, roadmap, stat, benefit, solver, and comparison cards, use:

```tsx
"glass-card rounded-[22px] p-5 transition-[background,border-color,box-shadow,transform] duration-300 hover:-translate-y-1 hover:border-border-cyan"
```

Use denser variants for data-heavy cards:

```tsx
"rounded-2xl border border-border-subtle bg-surface-input p-4"
```

- [ ] **Step 5: Verify section layout only changed visually**

Run:

```powershell
git diff -- src/components/Stats.tsx src/components/TrustStrip.tsx src/components/Problem.tsx src/components/Solution.tsx src/components/HowItWorks.tsx src/components/SolverMarketplace.tsx src/components/Features.tsx src/components/Vision.tsx src/components/Roadmap.tsx src/components/FinalCTA.tsx
```

Expected: Diffs show class/style changes only. No changed arrays except visual icon class usage. No changed translation keys, URLs, section IDs, or state timing.

- [ ] **Step 6: Run scoped whitespace check**

Run:

```powershell
git diff --check -- src/components/Stats.tsx src/components/TrustStrip.tsx src/components/Problem.tsx src/components/Solution.tsx src/components/HowItWorks.tsx src/components/SolverMarketplace.tsx src/components/Features.tsx src/components/Vision.tsx src/components/Roadmap.tsx src/components/FinalCTA.tsx
```

Expected: Exit code 0.

- [ ] **Step 7: Commit if the merge state is resolved**

```powershell
git add -- src/components/Stats.tsx src/components/TrustStrip.tsx src/components/Problem.tsx src/components/Solution.tsx src/components/HowItWorks.tsx src/components/SolverMarketplace.tsx src/components/Features.tsx src/components/Vision.tsx src/components/Roadmap.tsx src/components/FinalCTA.tsx
git commit -m "style: unify product story sections"
```

If Git still reports an active merge, do not commit. Record that commit is blocked by merge state.

---

### Task 5: Product Tour and Supported Networks Visual Normalization

**Files:**
- Modify: `src/components/ProductTour.tsx`
- Modify: `src/components/SupportedNetworks.tsx`

**Interfaces:**
- Consumes: Existing `TRACKS`, `LazyVideo`, `CHAINS`, `REPEATS`, active tab state, YouTube/video behavior, marquee CSS.
- Produces: Token-backed, responsive media and network sections without changing media loading or active tab behavior.

- [ ] **Step 1: Preserve media and marquee logic**

Before editing, identify these boundaries:

```text
ProductTour: TRACKS, activeIndex state, active = TRACKS[activeIndex], LiteYouTubeEmbed props, LazyVideo observer/load behavior.
SupportedNetworks: CHAINS, REPEATS, marquee-track usage, ChainBadge image onError behavior.
```

Expected: None of these behaviors change.

- [ ] **Step 2: Convert `ProductTour.tsx` inline section and header styles to classes**

Replace outer inline layout with token classes:

```tsx
<section id="tour" className="section-shell px-5 sm:px-8 lg:px-10">
  <div className="mx-auto max-w-[1320px]">
    <RevealSection>
      <div className="glass-panel overflow-hidden rounded-[28px] p-5 sm:p-8 lg:p-11">
```

Replace old `eyebrow` usage with:

```tsx
<span className="section-eyebrow">{t('tour.label')}</span>
```

Convert tab buttons to class-driven states with `cn`:

```tsx
className={cn(
  'rounded-xl border px-3 py-3 font-sans text-sm font-semibold transition-[background,border-color,color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/70',
  isActive
    ? 'border-primary bg-primary text-white shadow-[0_14px_34px_-22px_var(--primary)]'
    : 'border-border-subtle bg-surface-input text-text-secondary hover:-translate-y-px hover:border-border-cyan hover:text-app-text'
)}
```

- [ ] **Step 3: Convert `LazyVideo` visual style only**

Keep `videoRef`, `loaded`, `IntersectionObserver`, source injection, and event listeners unchanged. Replace the `style` object on `<video>` with an equivalent class plus only dynamic opacity if needed:

```tsx
className="block max-h-[480px] w-full rounded-xl object-cover transition-opacity duration-700"
style={{ opacity: loaded ? 1 : 0 }}
```

- [ ] **Step 4: Convert `SupportedNetworks.tsx` inline visuals to classes**

Keep `CHAINS`, `REPEATS`, and `onError` unchanged. Use:

```tsx
<section id="networks" className="section-shell overflow-hidden px-0">
```

Use a centered header:

```tsx
<div className="mx-auto mb-12 max-w-[640px] px-5 text-center sm:px-8">
```

Use `ChainBadge` classes:

```tsx
<div className="flex w-[168px] flex-shrink-0 flex-col items-center justify-center gap-3">
  <div className="media-shell flex h-21 w-21 items-center justify-center overflow-hidden rounded-full p-4">
```

If `h-21` or `w-21` is not supported by Tailwind config, use `h-[84px] w-[84px]`.

- [ ] **Step 5: Verify media behavior is unchanged**

Run:

```powershell
git diff -- src/components/ProductTour.tsx src/components/SupportedNetworks.tsx
```

Expected: `TRACKS`, `CHAINS`, `REPEATS`, `useEffect`, `IntersectionObserver`, `LiteYouTubeEmbed`, and image `onError` behavior are unchanged.

- [ ] **Step 6: Run scoped whitespace check**

Run:

```powershell
git diff --check -- src/components/ProductTour.tsx src/components/SupportedNetworks.tsx
```

Expected: Exit code 0.

- [ ] **Step 7: Commit if the merge state is resolved**

```powershell
git add -- src/components/ProductTour.tsx src/components/SupportedNetworks.tsx
git commit -m "style: align product tour and network sections"
```

If Git still reports an active merge, do not commit. Record that commit is blocked by merge state.

---

### Task 6: Live Prices Data Table Visual Normalization

**Files:**
- Modify: `src/components/LivePrices.tsx`

**Interfaces:**
- Consumes: Existing `PAGE_SIZE`, `TOTAL_COINS`, `TOTAL_PAGES`, `useQuery`, `fetchTopMarkets`, `formatPercent`, `formatUsdPrice`, pagination state.
- Produces: Data-dense Agent 2 table with glass panel, mono figures, shimmer skeletons, and token-backed hover states.

- [ ] **Step 1: Preserve data and pagination behavior**

Before editing, identify these boundaries:

```text
PAGE_SIZE = 5
TOTAL_COINS = 100
TOTAL_PAGES = Math.ceil(TOTAL_COINS / PAGE_SIZE)
queryKey = ['coingecko-top-markets', TOTAL_COINS]
queryFn = () => fetchTopMarkets(TOTAL_COINS)
page state and start/rows slicing
coin row click opens coinPageUrl(coin.id)
```

Expected: None of these values or behaviors change.

- [ ] **Step 2: Convert outer section and heading to shared classes**

Use:

```tsx
<section id="prices" className="section-shell px-5 sm:px-8 lg:px-10">
  <div className="mx-auto max-w-[1120px]">
    <RevealSection>
      <div className="mx-auto mb-10 max-w-[720px] text-center">
        <span className="section-eyebrow">{t('prices.label', 'Market data')}</span>
        <h2 className="section-heading mt-4 text-[clamp(30px,3.4vw,46px)]">{t('prices.h2')}</h2>
      </div>
    </RevealSection>
```

If adding `prices.label`, add it only to locale files if required by the visible copy policy; otherwise use the fallback key shown above.

- [ ] **Step 3: Convert table shell and row visuals**

Replace the outer table panel style with:

```tsx
<div className="glass-panel overflow-hidden rounded-[24px]">
```

Use table classes:

```tsx
<table className="w-full min-w-[520px] border-collapse font-sans text-app-text">
```

Use row class:

```tsx
className="cursor-pointer border-b border-border-subtle transition-colors duration-150 hover:bg-surface-hover"
```

Remove only hover handlers that exclusively set background color; do not alter the row click handler.

- [ ] **Step 4: Convert `Th`, `Td`, `PercentCell`, `SkeletonRow`, `PagerButton` visuals**

Keep function signatures unchanged. Convert visual styles to classes:

```tsx
function Th({ children, align, hideBelow }: { children: React.ReactNode; align: 'left' | 'right'; hideBelow?: number }) {
  return (
    <th
      className={cn(
        'px-[18px] py-3.5 font-sans text-[12.5px] font-semibold uppercase tracking-[0.06em] text-text-muted',
        align === 'right' ? 'text-right' : 'text-left',
        hideBelow ? `hide-below-${hideBelow}` : undefined
      )}
    >
      {children}
    </th>
  );
}
```

Add `cn` import from `@/lib/utils` if missing. This is allowed because it only supports class merging.

Use `.skeleton-shimmer` in `SkeletonRow`:

```tsx
<div className="skeleton-shimmer h-3 w-[70px] rounded" />
```

Use token classes for `PagerButton`, preserving `onClick`, `disabled`, and `aria-label`.

- [ ] **Step 5: Verify data behavior is unchanged**

Run:

```powershell
git diff -- src/components/LivePrices.tsx
```

Expected: No changed imports from `../lib/coingecko` except adding `cn`. No changed `useQuery` options, pagination constants, row slicing, click URL behavior, or formatter usage.

- [ ] **Step 6: Run scoped whitespace check**

Run:

```powershell
git diff --check -- src/components/LivePrices.tsx
```

Expected: Exit code 0.

- [ ] **Step 7: Commit if the merge state is resolved**

```powershell
git add -- src/components/LivePrices.tsx
git commit -m "style: align live prices table visuals"
```

If Git still reports an active merge, do not commit. Record that commit is blocked by merge state.

---

### Task 7: Blog and Newsletter Visual Normalization

**Files:**
- Modify: `src/components/BlogSection.tsx`

**Interfaces:**
- Consumes: Existing Ghost query, `isGhostConfigured`, `fetchLatestPosts`, `useSubscribe`, `BLOG_HOME`, card motion variants.
- Produces: Blog cards, skeletons, coming-soon card, and newsletter block aligned with the Agent 2 visual system.

- [ ] **Step 1: Preserve Ghost and newsletter behavior**

Before editing, identify these boundaries:

```text
BLOG_HOME value
isGhostConfigured guard
useQuery queryKey and queryFn
posts loading/error/empty branches
BlogCard href/target/rel
useSubscribe fields and handleSubscribe
newsletter input onChange
```

Expected: None of these behaviors change.

- [ ] **Step 2: Convert `BlogSection` outer styles to classes**

Use:

```tsx
<section id="blog" className="section-shell px-5 sm:px-8 lg:px-10">
  <div className="mx-auto max-w-[1200px]">
```

Replace old `eyebrow` usage with `section-eyebrow`.

Use a class-based "View More" link:

```tsx
className="inline-flex items-center justify-center rounded-xl border border-border-cyan bg-surface-input px-5 py-2.5 font-sans text-sm font-semibold text-app-text no-underline transition-[background,border-color,color,transform] duration-200 hover:-translate-y-0.5 hover:bg-surface-hover hover:text-accent-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/70"
```

- [ ] **Step 3: Convert blog card visual styles**

Keep `motion.a`, `href`, `target`, `rel`, `whileHover`, and `transition` behavior. Replace `style` objects with class names where static:

```tsx
className="glass-card flex h-full flex-col overflow-hidden rounded-[22px] text-inherit no-underline"
```

Use:

```text
Post image shell: h-[180px] overflow-hidden bg-surface-alt
Date: font-sans text-xs text-text-muted
Title: font-display text-[19px] font-semibold leading-[1.35] text-app-text
Excerpt: font-sans text-[13.5px] leading-[1.6] text-text-secondary
Read more: font-sans text-sm font-semibold text-accent-cyan
```

- [ ] **Step 4: Convert skeleton, coming soon, and newsletter visuals**

Use `.skeleton-shimmer` for skeleton blocks.

Use `glass-card` for `ComingSoonCard`.

Use a restrained token-backed newsletter panel:

```tsx
<div className="mt-14 grid items-center gap-6 rounded-[24px] border border-border-cyan bg-primary-dim p-6 shadow-[0_26px_90px_-64px_var(--primary)] sm:p-8 min-[901px]:grid-cols-[1fr_auto]">
```

Keep `email`, `message`, `messageType`, `loading`, `handleChange`, and `handleSubscribe` unchanged.

- [ ] **Step 5: Verify blog behavior is unchanged**

Run:

```powershell
git diff -- src/components/BlogSection.tsx
```

Expected: Query behavior, Ghost configuration guard, external URLs, subscription handlers, and motion variants are unchanged.

- [ ] **Step 6: Run scoped whitespace check**

Run:

```powershell
git diff --check -- src/components/BlogSection.tsx
```

Expected: Exit code 0.

- [ ] **Step 7: Commit if the merge state is resolved**

```powershell
git add -- src/components/BlogSection.tsx
git commit -m "style: align blog and newsletter visuals"
```

If Git still reports an active merge, do not commit. Record that commit is blocked by merge state.

---

### Task 8: Responsive and Verification Sweep

**Files:**
- Modify only visual files already touched in Tasks 1-7 if defects are found.

**Interfaces:**
- Consumes: All visual changes from previous tasks.
- Produces: Verified responsive, buildable visual consistency pass.

- [ ] **Step 1: Check forbidden-file diff**

Run:

```powershell
git diff --name-only
```

Expected: No changed files under forbidden paths for this visual pass:

```text
src/hooks/
src/intent/
src/oif/
src/wallet/
src/lib/
src/main.tsx
vite.config.ts
package.json
package-lock.json
```

If forbidden files appear, inspect whether they pre-existed before this implementation. Do not modify or revert user changes. Report them separately.

- [ ] **Step 2: Run whitespace check for allowed visual files**

Run:

```powershell
git diff --check -- src/components src/globals.css
```

Expected: Exit code 0.

- [ ] **Step 3: Run Vite production bundle**

Run:

```powershell
npm.cmd exec vite -- build
```

Expected: Exit code 0. Existing dependency warnings may appear; record them without changing logic or config.

- [ ] **Step 4: Run full TypeScript build only as a diagnostic**

Run:

```powershell
npm.cmd run build
```

Expected: If it fails in pre-existing non-visual files such as `src/wallet/WalletProvider.tsx`, do not fix those files in this pass. Record the exact failures.

- [ ] **Step 5: Run lint only if local dependency issue is resolved**

Run:

```powershell
npm.cmd run lint -- src/components
```

Expected: If ESLint still cannot find `typescript-eslint`, do not modify packages in this pass. Record the exact failure.

- [ ] **Step 6: Manual responsive review**

Review diffs and, if a dev server is available, check at these widths:

```text
375px mobile
768px tablet
1280px desktop
```

Expected:

```text
No horizontal overflow.
No button text overflow.
Wallet/menu/dialog surfaces remain visible.
LivePrices table scrolls only inside its table shell on narrow screens.
ProductTour media remains framed and does not crop controls.
SupportedNetworks marquee has edge fade and no clipped labels.
Blog newsletter stacks cleanly below 901px.
```

- [ ] **Step 7: Final visual-only diff review**

Run:

```powershell
git diff -- src/components src/globals.css
```

Expected: Visual-only changes. No altered API calls, hooks, wallet adapters, query keys, route behavior, or build config.

- [ ] **Step 8: Commit if the merge state is resolved**

```powershell
git add -- src/components src/globals.css
git commit -m "style: complete frontend visual consistency pass"
```

If Git still reports an active merge, do not commit. Report that changes are ready but commits remain blocked by the active merge state.
