# @recoilpay/intent-react

RecoilPay intents as one React component. The user types what they want ("swap 10 USDC on Base for ETH on Arbitrum"), sees the best solver quote, confirms in their wallet, and watches it settle, without you building any of that UI.

```sh
npm install @recoilpay/intent-react viem
```

## With wagmi (and RainbowKit)

```tsx
import { RecoilIntent } from '@recoilpay/intent-react';
import { useWagmiIntentWallet } from '@recoilpay/intent-react/wagmi';
import '@recoilpay/intent-react/styles.css';
import { useConnectModal } from '@rainbow-me/rainbowkit';

export function Swap() {
  const wallet = useWagmiIntentWallet();          // null until connected
  const { openConnectModal } = useConnectModal();

  return <RecoilIntent hfAccessToken={HF_TOKEN} wallet={wallet} onConnectWallet={openConnectModal} />;
}
```

The component doesn't include a wallet modal. It uses your app's: `onConnectWallet` opens it, and the `wallet` prop tells the component which account is connected. A pending intent continues by itself once a wallet connects.

## Without wagmi

Pass any `IntentWallet`. From a viem `WalletClient`:

```tsx
import { RecoilIntent, viemWallet } from '@recoilpay/intent-react';

<RecoilIntent wallet={walletClient ? viemWallet(walletClient) : null} onConnectWallet={connect} />
```

## Props

| Prop | Type | |
|---|---|---|
| `hfAccessToken` | `string \| null` | Your Hugging Face token for plain-English parsing (see Notes). |
| `wallet` | `IntentWallet \| null` | The connected wallet. |
| `onConnectWallet` | `() => void` | Opens your connect flow. |
| `theme` | `{ mode, accent, accentText, radius, fontFamily }` | `mode` is `'dark'` (default) or `'light'`. It uses your page's font unless you set one. |
| `examples` | `{ label, sentence }[] \| false` | Clickable suggestions under the field. |
| `placeholder`, `defaultValue` | `string` | |
| `onOrderSubmitted` | `(orderId) => void` | The signed order was accepted. |
| `onComplete` | `(state) => void` | Every intent in the sentence reached a final status. |
| `onError` | `(message) => void` | Any failure, already written for the end user. |
| `apiUrl` | `string` | Defaults to production (`https://api.recoilpay.com`). |
| `session` | `IntentSession` | Share one flow between components, or inject one in tests. |
| `className` | `string` | Added to the root element. |

## Styling

Import `@recoilpay/intent-react/styles.css` once. Every rule is scoped under `.rp-root`, so it won't touch the rest of your page. Beyond the `theme` prop, you can override any variable from your own CSS:

```css
.my-swap .rp-root {
  --rp-surface: #0f1115;
  --rp-line: #222631;
  --rp-accent: #22c55e;
  --rp-radius: 6px;
}
```

Variables: `--rp-surface`, `--rp-raised`, `--rp-sunken`, `--rp-ink`, `--rp-ink-2`, `--rp-muted`, `--rp-line`, `--rp-accent`, `--rp-accent-text`, `--rp-success`, `--rp-danger`, `--rp-radius`, `--rp-font`, `--rp-mono`.

## Your own UI

`useRecoilIntent()` gives you the same flow as React state with no markup: `phase`, `preview`, `issues`, `status`, `explorerUrl` and so on, plus `run`, `confirm` and `reset`. See `@recoilpay/intent-core` for what each field means.

```tsx
const intent = useRecoilIntent({ wallet });
// intent.phase === 'quoted' → render intent.preview, call intent.confirm()
```

## Notes

- **Hugging Face token:** Plain-English parsing calls a language model on Hugging Face **from the browser**, with your own access token. The token is visible to anyone who loads your page, so use a fine-grained token with only the "Make calls to Inference Providers" permission, use it for nothing else, and rotate it if it's abused. Without a token, parsing is off and users see an example sentence.
- **Testnets only** for now: Base Sepolia, OP Sepolia, Ethereum Sepolia and Polygon Amoy, with mock tokens.
- **The first swap of a token needs a one-time Permit2 approval.** The confirm card says so before it happens.
- **Requirements:** React 18+, and viem 2 as a peer dependency. wagmi is optional and only needed for `@recoilpay/intent-react/wagmi`.
