---
title: React component
sidebar_label: React component
---

# React component

`<RecoilIntent />` is the RecoilPay intent experience as a React component. It uses the wallet connection your app already has, so there's no second connect button and no second wallet library.

```bash
npm install @recoilpay/intent-react viem
```

It needs React 18+ and viem 2. wagmi is optional.

---

## With wagmi and RainbowKit

```tsx title="Swap.tsx"
import { RecoilIntent } from '@recoilpay/intent-react';
import { useWagmiIntentWallet } from '@recoilpay/intent-react/wagmi';
import '@recoilpay/intent-react/styles.css';
import { useConnectModal } from '@rainbow-me/rainbowkit';

export function Swap() {
  const wallet = useWagmiIntentWallet();        // null until connected
  const { openConnectModal } = useConnectModal();

  return (
    <RecoilIntent
      hfAccessToken={import.meta.env.VITE_HF_ACCESS_TOKEN}
      wallet={wallet}
      onConnectWallet={openConnectModal}
    />
  );
}
```

That's it. Put `<Swap />` anywhere inside your existing `WagmiProvider`.

- **`onConnectWallet`** runs when the component needs a wallet. Pass whatever opens your connect flow: RainbowKit's `openConnectModal`, ConnectKit's `setOpen(true)`, or your own.
- **`wallet`** tells the component which account is connected. If a user types an intent before connecting, the flow waits and continues on its own once they connect.
- **`hfAccessToken`** is your Hugging Face token for plain-English parsing, which runs in the browser. It ends up in your bundle, so use a fine-grained, inference-only token. See [Bring your own Hugging Face token](./drop-in-ui#bring-your-own-hugging-face-token).
- **`@recoilpay/intent-react/wagmi`** is a separate entry point, so apps without wagmi never load it.

Import the stylesheet once, anywhere in your app. It's scoped (see [Styling](#styling)).

---

## Without wagmi

Pass any `IntentWallet`. From a viem `WalletClient`:

```tsx
import { RecoilIntent, viemWallet } from '@recoilpay/intent-react';
import '@recoilpay/intent-react/styles.css';

<RecoilIntent
  wallet={walletClient ? viemWallet(walletClient) : null}
  onConnectWallet={connect}
/>
```

Using another wallet SDK, such as an embedded or smart wallet? Implement `IntentWallet` directly. It's six members; see [Headless SDK → Wallets](./sdk#wallets).

---

## Props

| Prop | Type | |
|---|---|---|
| `hfAccessToken` | `string \| null` | Your Hugging Face token for plain-English parsing. Without it, parsing is off. |
| `wallet` | `IntentWallet \| null` | The connected wallet. |
| `onConnectWallet` | `() => void` | Opens your connect flow. |
| `theme` | `{ mode, accent, accentText, radius, fontFamily }` | See [Styling](#styling). |
| `examples` | `{ label, sentence }[] \| false` | Clickable suggestions under the field. `false` hides them. |
| `placeholder` | `string` | Text in the empty field. |
| `defaultValue` | `string` | Pre-fills the field. It isn't run until the user submits. |
| `onOrderSubmitted` | `(orderId: string) => void` | RecoilPay accepted the signed order. |
| `onComplete` | `(state: IntentState) => void` | Every intent in the sentence reached a final status. |
| `onError` | `(message: string) => void` | Any failure. `message` is written for the end user. |
| `apiUrl` | `string` | Defaults to `https://api.recoilpay.com`. |
| `session` | `IntentSession` | Share one flow between components. See [below](#sharing-a-flow). |
| `className` | `string` | Added to the root element. |

```tsx
<RecoilIntent
  wallet={wallet}
  onConnectWallet={openConnectModal}
  theme={{ mode: 'light', accent: '#0a7cff', radius: 8 }}
  examples={[{ label: 'Move 5 USDC to Base', sentence: 'swap 5 USDC on op sepolia for USDC on base sepolia' }]}
  onComplete={(s) => analytics.track('recoilpay_settled', { orderId: s.orderId })}
/>
```

---

## Styling

Every rule in `styles.css` is scoped under `.rp-root`, the component's own root element, so it can't restyle anything else on your page. By default the component uses your page's font.

For simple changes, use the `theme` prop. For anything more, override the CSS variables from your own stylesheet:

```css
.checkout .rp-root {
  --rp-surface: #0f1115;
  --rp-line: #222631;
  --rp-accent: #22c55e;
  --rp-accent-text: #04120a;
  --rp-radius: 6px;
}
```

| Variable | Used for |
|---|---|
| `--rp-surface`, `--rp-raised`, `--rp-sunken` | Card backgrounds, from front to back |
| `--rp-ink`, `--rp-ink-2`, `--rp-muted` | Text, from strongest to quietest |
| `--rp-line` | Borders and dividers |
| `--rp-accent`, `--rp-accent-text` | Primary buttons, highlights, focus ring |
| `--rp-success`, `--rp-danger` | Settled / failed states and errors |
| `--rp-radius` | Corner radius |
| `--rp-font`, `--rp-mono` | Text and monospace fonts |

---

## Your own UI, same flow

If you want different markup, `useRecoilIntent()` gives you the same flow as React state and renders nothing:

```tsx
import { useRecoilIntent } from '@recoilpay/intent-react';

function MyIntentBar({ wallet }) {
  const intent = useRecoilIntent({ wallet });

  if (intent.phase === 'quoted' && intent.preview) {
    const p = intent.preview;
    return (
      <MyQuoteCard
        pay={`${p.payAmount} ${p.paySymbol} on ${p.srcChainName}`}
        receive={`${p.receiveAmount} ${p.receiveSymbol} on ${p.dstChainName}`}
        onConfirm={intent.confirm}
        onCancel={intent.reset}
      />
    );
  }
  return <MyInput disabled={!intent.ready} onSubmit={(text) => intent.run(text)} />;
}
```

The fields (`phase`, `preview`, `issues`, `status`, `explorerUrl` and so on) are documented in [Headless SDK → The state](./sdk#the-state).

---

## Sharing a flow

Each `<RecoilIntent />` creates its own session. To drive one flow from two places, for example an input in your header and a confirm card in a drawer, create the session yourself and pass it to both:

```tsx
import { createIntentSession, RecoilIntent, useRecoilIntent } from '@recoilpay/intent-react';

const session = createIntentSession();          // module scope, or in a context

<RecoilIntent session={session} wallet={wallet} onConnectWallet={connect} />
// elsewhere:
const intent = useRecoilIntent({ session });
```

---

## Next.js

The component talks to the user's wallet, and it starts loading solver coverage as soon as it's created, so render it on the client only.

**App Router:** use it from a client component.

```tsx
'use client';
```

**Pages Router:** load it without server rendering.

```tsx
import dynamic from 'next/dynamic';
const Swap = dynamic(() => import('../components/Swap'), { ssr: false });
```
