@AGENTS.md
# Agent 2 — RecoilPay V2 Frontend Design Guide

## Purpose

This project uses a specific dark, crypto-forward visual system. When editing UI, preserve the existing language and avoid introducing new patterns that feel inconsistent with the product.

This specification defines a best-in-class Web3 decentralized exchange (DEX) and bridging interface. It synthesizes the hyper-minimalist elegance of **Uniswap**, the data-dense routing capabilities of **1inch**, and the seamless cross-chain UX of **Jumper**. 

The design language targets a modern, "cypherpunk-meets-enterprise" Web3 aesthetic. It leverages glassmorphism, dynamic ambient lighting, and spring-based micro-interactions, structured optimally for a React/Next.js and Tailwind CSS development stack.

## Stack and conventions

- React + TypeScript + Vite
- Styling is primarily driven by global CSS in src/globals.css and component-level inline styles
- Tailwind CSS is installed, but the current UI is not built around Tailwind utilities as the primary pattern
- UI primitives: shadcn-style Radix components in `src/components/ui`, configured by `components.json` with the `new-york` style and Lucide as the default icon library.
- Keep changes aligned with the existing component structure in src/components

## Visual style

The visual language represents a "cypherpunk-meets-enterprise" aesthetic. It merges the extreme minimalism of Uniswap, the dense analytical utility of 1inch, and the cross-chain fluidity of Jumper.
* **Glassmorphism & Depth**: Surfaces utilize frosted glass effects (`backdrop-blur`) over deep, dark backgrounds to establish visual hierarchy without heavy borders.
* **Ambient Lighting**: Large, heavily blurred radial gradients float in the background, providing a decentralized, living energy to the canvas.
* **High Contrast Data**: Financial figures and critical paths are highlighted with stark contrast to ensure instantaneous readability.
* **Typography**: 
  * *Display*: Space Grotesk or Syne (for numbers and headers).
  * *Body*: Inter or SF Pro (for pristine UI legibility).
  * *Mono*: JetBrains Mono (for wallet addresses and precise financial decimals).

## Color system

The color palette is anchored in a deep navy aesthetic with vibrant, high-contrast accents to establish trust while maintaining a technical, Web3-native feel.

* **Primary Actions (Primary Blue)**: `#424af6` 
  * *Usage*: Primary call-to-action buttons (Swap, Bridge, Connect Wallet), active states, and strong UI accents.
* **Highlights & Emphasis (Accent Cyan)**: `#61e5fc`
  * *Usage*: Highlights, critical data labels, positive slippage emphasis, and glowing accents.
* **Backgrounds & Surfaces (Deep Navy)**: 
  * *App Background*: `#070436` (Deep space navy).
  * *Surface*: `#171a56` (Dark navy surfaces for primary swap cards, side panels, and headers).
  * *Surface Alt*: `#1e216f` (Elevated elements, hover states, or secondary modals).
  * *Borders*: Keep borders subtle and slightly translucent (e.g., `rgba(239, 252, 255, 0.05)` or translucent versions of the primary text color).
* **Text & Typography**:
  * *Primary Text*: `#effcff` (High contrast, icy white for primary readables, headings, and numerical inputs).
  * *Secondary Text*: `#b0b1ba` (Muted gray for USD equivalents, secondary descriptions, and standard labels).
  * *Muted Text*: `#8BA2F9` (Soft periwinkle for tertiary information, placeholders, or disabled states).

  ### Dark Mode (Default)
Anchored in a deep space navy aesthetic with high-contrast icy text.
* **Backgrounds & Surfaces**: 
  * *App Background*: `#070436` (Deep space navy).
  * *Surface*: `#171a56` (Dark navy surfaces for primary swap cards, side panels, and headers).
  * *Surface Alt*: `#1e216f` (Elevated elements, hover states, or secondary modals).
  * *Borders*: Subtle and slightly translucent (`rgba(239, 252, 255, 0.05)`).
* **Text & Typography**:
  * *Primary Text*: `#effcff` (High contrast, icy white).
  * *Secondary Text*: `#b0b1ba` (Muted gray for USD equivalents).
  * *Muted Text*: `#8BA2F9` (Soft periwinkle for disabled states).

### Light Mode
A bright, hyper-clean aesthetic utilizing the deep navy as primary text for stark contrast.
* **Backgrounds & Surfaces**: 
  * *App Background*: `#F4F6F8` (Soft cool slate/white).
  * *Surface*: `#FFFFFF` (Pure white for primary swap cards and panels).
  * *Surface Alt*: `#E2E8F0` (Light slate for elevated elements or hover states).
  * *Borders*: Subtle and translucent (`rgba(7, 4, 54, 0.08)`).
* **Text & Typography**:
  * *Primary Text*: `#070436` (Deep space navy reused for maximum legibility).
  * *Secondary Text*: `#64748B` (Medium slate for USD equivalents).
  * *Muted Text*: `#94A3B8` (Light slate for placeholders or disabled states).


## Typography

Web3 interfaces require a delicate balance between extreme legibility (financial data) and futuristic branding.

* **Primary Display / Headings (`font-display`)**: **Space Grotesk** or **Syne**.
    * *Usage*: Page titles, marketing headers, and the primary numerical output in the swap inputs. Gives a wide, geometric, and distinctly modern tech feel.
* **UI/Body (`font-sans`)**: **Inter** or **SF Pro**.
    * *Usage*: Dropdowns, settings, standard text, labels. This is the Uniswap gold standard for pixel-perfect legibility.
* **Monospace / Financial Data (`font-mono`)**: **JetBrains Mono** or **Fira Code**.
    * *Usage*: Wallet addresses (e.g., `0x1A4...b9C`), gas fees, exact token balances, and slippage percentages. Reinforces trust and technical precision.

## Motion and animation
Animations must feel physical, fluid, and hardware-accelerated to convey premium quality.

* **Spring Physics**: Ditch linear CSS transitions. Use spring mechanics for modal popups (Scale from `0.95` to `1.0`, subtle bounce).
* **Layout Fluidity**: The main swap card must seamlessly animate its height when revealing routing details (1inch style). No instant snapping.
* **Micro-Interactions**:
  * *Swap Toggle*: The middle arrow rotates 180° on hover. On click, source/destination blocks physically swap positions via smooth layout transitions.
  * *Button Press*: Scale down to `0.98` on active/tap to simulate physical compression.
* **State Indication**: Use shimmering, gradient-based skeleton loaders when fetching best routes across AMMs. Animate a subtle glowing border on the primary button while a transaction is pending.

## Component patterns
Adopt an Atomic Design philosophy tailored for Web3 interactions:

* **Atoms**: Token icons (with integrated chain badges like Jumper), numerical input fields without default browser styling, primary buttons, pill tags.
* **Molecules**: 
  * *Token Input Block*: Combines a numerical input (Atom), USD equivalent label (Atom), and Token Selector button (Atom).
  * *Routing Path Node*: A single step in a bridge/swap route showing protocol icon and token output.
* **Organisms**: 
  * *The Swap/Bridge Card*: The primary interactive module combining two Token Input Blocks, the swap toggle, and routing expansion details.
  * *Wallet Modal*: Contains wallet options, network selection, and recent transaction history.
- Hero sections should feel centered, airy, and focused on a single primary interaction
- Navigation should remain compact, sticky, and glassy
- Cards and panels should use soft borders and low-contrast backgrounds rather than heavy shadows
- Buttons and interactive elements should respond with small, elegant transitions
- Keep spacing generous and content vertically balanced

## Frontend implementation guidance
Designed for a modern, highly responsive web development ecosystem:

- Prefer updating shared tokens and utilities in src/globals.css for broad changes
- For local UI tweaks, keep styling close to the component being edited
- Reuse existing CSS variable names instead of introducing new hard-coded colors
- Keep copy translatable and consistent with the i18n structure in src/i18n
- Avoid introducing new font families or heavy visual effects
* **Core Stack**: React or Next.js paired with TypeScript for strict type safety regarding blockchain data types (e.g., `BigInt`, hex strings).
* **Styling**: Shadcn UI +Tailwind CSS for rapid, utility-first styling. Utilize arbitrary values for specific glassmorphic blurs and custom colors.
* **Animation Library**: Framer Motion (`framer-motion`) is strictly recommended for handling the spring animations and complex layout transitions seamlessly.
<!-- * **Web3 Integration**: Isolate blockchain logic from UI components. Use state management hooks (like `wagmi` or `viem`) to handle wallet connections, network switching, and contract reads/writes. -->
* **State Management**: Use localized state for UI interactions (dropdowns, modals) and a global store (Zustand or Context) for persistent user preferences (slippage tolerance, theme).

## Do and don’t

Do:

- Preserve the dark palette and cyan/blue accent system
- Keep the interface calm, modern, and readable
- Follow the existing spacing and section rhythm
- Use subtle motion and hover feedback
* **Do** prioritize legibility of financial data over aesthetic flourishes.
* **Do** provide immediate visual feedback for all user inputs and blockchain states (fetching quotes, waiting for wallet signature, mining).
* **Do** mask complex routing (like 1inch) behind a clean, simple default view, allowing power users to expand for details.
* **Do** handle high-latency scenarios gracefully. RPC nodes can be slow; ensure the UI doesn't freeze.

Don’t:

- Add bright, noisy gradients or overly playful visuals
- Introduce new animation libraries without a clear reason
- Replace the existing typography stack with new fonts
- Break the established structure of hero, section, card, and CTA patterns
Don't** clutter the primary swap container with unnecessary settings. Keep slippage and advanced routing in expandable menus or modals.
* **Don't** use long, slow, or linear animations. Everything should snap quickly with spring physics.
* **Don't** assume standard JavaScript `Number` types are safe for token amounts; always use robust big number libraries to prevent precision loss.
* **Don't** force network switching abruptly. Prompt the user via the UI before triggering the wallet's network switch request.

## Key files to reference

- src/globals.css — global theme, fonts, tokens, motion, utility classes
- src/components — UI structure and component-level styling patterns
- src/i18n — language and copy conventions
- src/lib/tokens.ts — shared token data

## Implementation Rules

- Keep new frontend work aligned with the existing dark, rounded, purple-accented language.
- Reuse existing components and primitives before adding new abstractions.
- Use Tailwind utilities and `cn`; do not add broad global CSS unless the style is truly shared.
- Keep marketing screens expressive with glow, spotlight, gradients, and scroll reveals.
- Keep dashboard/feed screens quieter, denser, and easier to scan.
- Use `use client` for any component with hooks, browser APIs, GSAP, OGL, Radix interactive state, or Redux hooks.
- Preserve existing route group structure under `src/app`.
- Do not touch unrelated Redux slices or data-flow files when making visual-only changes.
- **Strict Typing**: TypeScript `any` is forbidden. Interface definitions must exist for token objects, routing quotes, and transaction receipts.
- **Component Modularity**: The `TokenInputBlock` must be reusable for both "Source" and "Destination" states via props.
- **Accessibility (a11y)**: All inputs must have accessible labels (even if visually hidden). Maintain proper keyboard navigation through the swap flow.
- **Mobile-First Design**: The interface must operate flawlessly on mobile screens, utilizing bottom-sheet modals for token selection instead of center-screen popups on small devices.
- **Theme CSS Variables**: Define the color system using CSS variables integrated into Tailwind to allow for seamless theme switching if required later.
