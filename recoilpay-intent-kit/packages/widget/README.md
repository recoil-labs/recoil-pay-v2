# @recoilpay/intent-widget

RecoilPay intents on any website, with no framework or build step. Add one script tag and one element. Your visitors type what they want ("swap 10 USDC on Base for ETH on Arbitrum"), connect a wallet, confirm, and watch it settle.

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@recoilpay/intent-widget@0.1/dist/recoilpay-intent-widget.js"></script>

<recoilpay-intent walletconnect-project-id="YOUR_REOWN_PROJECT_ID"></recoilpay-intent>
```

It works in plain HTML, WordPress, Webflow, Vue, Angular, Svelte, or anywhere else you can place an element. If your app is built with React, use `@recoilpay/intent-react` instead.

> **Hosting.** The CDN link works once the package is published to npm. Until then, or if you'd rather self-host, serve this package's whole `dist/` folder and point the script at `dist/recoilpay-intent-widget.js`. It loads its other chunks from next to itself.

## Wallets

The widget brings its own wallet picker:

- **Browser wallets** are detected automatically: MetaMask, Rabby, Coinbase Wallet, Brave, Phantom and any other wallet that supports EIP-6963. Older wallets that only set `window.ethereum` are offered as a fallback.
- **WalletConnect** (mobile wallets over QR) appears only when you set `walletconnect-project-id`. Use **your own** project id: create one free at [cloud.reown.com](https://cloud.reown.com) and add your site's domain to its allowlist. WalletConnect's code is downloaded only when a visitor chooses it.
- **Returning visitors** are reconnected silently, and switching accounts or disconnecting inside the wallet is followed.
- **Testnets** the wallet doesn't know yet are added for the visitor when a swap needs them.

**Already have a connected wallet on your page?** Hand it over, and the picker is skipped:

```js
document.querySelector('recoilpay-intent').provider = window.ethereum; // any EIP-1193 provider
```

## Attributes

| Attribute | Example | |
|---|---|---|
| `walletconnect-project-id` | `a1b2…` | Your Reown project id. Without it, only browser wallets are offered. |
| `mode` | `light` | `dark` (default) or `light`. |
| `accent` | `#0a7cff` | Buttons, focus ring and highlights. |
| `accent-text` | `#ffffff` | Text on accent buttons. |
| `radius` | `8` | Corner radius in px. |
| `font-family` | `Georgia, serif` | Defaults to your page's font. |
| `placeholder` | `What do you want to do?` | |
| `examples` | `[{"label":"Swap 1 USDC","sentence":"swap 1 USDC on op sepolia for USDC on base sepolia"}]` | JSON; `false` hides them. |
| `api-url` | `https://api.recoilpay.com` | Default. Point it at staging if needed. |

Attributes can change at any time; the widget updates in place. `examples` can also be set as a property.

## Events

Every event bubbles out of the element, so you can listen on `document`:

```js
document.addEventListener('recoilpay-complete', (e) => {
  console.log('settled', e.detail.orderId, e.detail.explorerUrl);
});
```

| Event | `detail` |
|---|---|
| `recoilpay-wallet` | `{ address }`, where `address` is `null` on disconnect |
| `recoilpay-order-submitted` | `{ orderId }` |
| `recoilpay-complete` | `{ orderId, status, explorerUrl }` |
| `recoilpay-error` | `{ message }`, already written for the end user |

## Isolation

The widget renders inside Shadow DOM. Your page's CSS can't reach in and break it, and its styles can't leak out. The only thing it takes from your page is the font, unless you set `font-family`. The wallet picker renders above the page (`z-index: 2147483000`).

## Size

About 115 KB gzipped on first load (React plus the intent flow). WalletConnect, about 450 KB gzipped, is a separate download fetched only when a visitor picks it.

## Try it locally

```sh
npm run build
# serve the recoilpay-intent-kit/ folder with any static server, e.g.:
python3 -m http.server 5299
# then open http://localhost:5299/packages/widget/demo/
```

## Notes

- **Testnets only** for now: Base Sepolia, OP Sepolia, Ethereum Sepolia and Polygon Amoy, with mock tokens.
- **The first swap of a token needs a one-time Permit2 approval.** The widget explains this before it happens.
- **Browser requirements:** module scripts, custom elements and Shadow DOM. Every current browser qualifies.
