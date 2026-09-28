---
title: Embed the widget
sidebar_label: Widget (any website)
---

# Embed the widget

Add RecoilPay intents to any web page with one script tag and one element. There's no build step, and no framework is required. Wallet connection is included.

---

## 1. Add the script and the element

```html
<!-- Once per page, anywhere. -->
<script type="module" src="https://cdn.jsdelivr.net/npm/@recoilpay/intent-widget@0.1/dist/recoilpay-intent-widget.js"></script>

<!-- Where you want it to appear. -->
<recoilpay-intent
  hf-access-token="YOUR_HUGGING_FACE_TOKEN"
  walletconnect-project-id="YOUR_REOWN_PROJECT_ID"
></recoilpay-intent>
```

That's a complete integration. Open the page, type `swap 1 USDC on op sepolia for USDC on base sepolia`, and connect a wallet.

:::tip Self-hosting
Prefer not to load from a CDN? Serve the package's whole `dist/` folder from your own origin and point the script at `dist/recoilpay-intent-widget.js`. The widget loads its other chunks from next to that file, so keep the folder intact.
:::

The element is 100% wide up to 640px, so place it in whatever container suits your layout.

---

## 2. Add your Hugging Face token

The widget turns what users type into intents by calling a language model on Hugging Face from their browser, with your token in `hf-access-token`. The token is visible in your page, so create a **fine-grained, inference-only** token used for nothing else. See [Bring your own Hugging Face token](./drop-in-ui#bring-your-own-hugging-face-token).

Without it, the widget still quotes and settles, but typed sentences aren't understood and users see an example sentence instead.

---

## 3. Set up WalletConnect (recommended)

Browser-extension wallets work with no setup: MetaMask, Rabby, Coinbase Wallet, Brave, Phantom, and any other wallet that supports [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963). Mobile wallets connect over WalletConnect, which needs a **project id of your own**:

1. Create a free project at **[cloud.reown.com](https://cloud.reown.com)**.
2. Under the project's **Domain** settings, add every origin the widget runs on, such as `https://yourapp.com`. Add `http://localhost:<port>` while you're developing.
3. Put the project id in `walletconnect-project-id`.

Without a project id, the WalletConnect option simply doesn't appear. The id is public by design, since it ships in your page's HTML, so it's safe to commit.

:::note Why your own id
WalletConnect usage, rate limits and the domain allowlist belong to the project id. With your own, your traffic is yours to monitor, and nothing about another site affects it.
:::

WalletConnect's code is about 450 KB gzipped, four times the rest of the widget. It's only downloaded when a visitor actually chooses WalletConnect.

---

## 4. Listen for results (optional)

The widget reports what happens as DOM events. They bubble, so you can listen on `document`:

```js
document.addEventListener('recoilpay-complete', (event) => {
  const { orderId, status, explorerUrl } = event.detail;
  // e.g. refresh balances, record a conversion, show your own confirmation
});
```

| Event | `detail` | Fired when |
|---|---|---|
| `recoilpay-wallet` | `{ address }` | A wallet connects, switches account or disconnects (`address: null`) |
| `recoilpay-order-submitted` | `{ orderId }` | The signed order was accepted by RecoilPay |
| `recoilpay-complete` | `{ orderId, status, explorerUrl }` | Every intent in the sentence reached a final status |
| `recoilpay-error` | `{ message }` | Anything failed. `message` is already written for the end user |

`orderId` can be looked up at [`GET /api/v1/orders/{id}`](./api-reference#get-apiv1ordersid).

---

## Configuration

Everything is an attribute. Change one at any time and the widget updates in place.

| Attribute | Default | |
|---|---|---|
| `hf-access-token` | none | Your Hugging Face token for plain-English parsing. Without it, parsing is off. |
| `walletconnect-project-id` | none | Your Reown project id. Without it, only browser wallets are offered. |
| `mode` | `dark` | `dark` or `light`. |
| `accent` | RecoilPay violet | Buttons, focus ring and highlights, e.g. `#0a7cff`. |
| `accent-text` | depends on mode | Text colour on accent buttons. |
| `radius` | `12` | Corner radius in px. |
| `font-family` | your page's font | Any CSS `font-family` value. |
| `placeholder` | a sample intent | Text shown in the empty field. |
| `examples` | two testnet swaps | JSON array of `{ "label", "sentence" }`, or `false` to hide the suggestions. |
| `api-url` | `https://api.recoilpay.com` | Only change this if we've given you a staging URL. |

```html
<recoilpay-intent
  walletconnect-project-id="a1b2c3…"
  mode="light"
  accent="#0a7cff"
  radius="8"
  examples='[{"label":"Move 5 USDC to Base","sentence":"swap 5 USDC on op sepolia for USDC on base sepolia"}]'
></recoilpay-intent>
```

`examples` can also be set as a property, which saves writing JSON into HTML:

```js
document.querySelector('recoilpay-intent').examples = [
  { label: 'Move 5 USDC to Base', sentence: 'swap 5 USDC on op sepolia for USDC on base sepolia' },
];
```

---

## Using a wallet your page already connected

If your site already has its own connect flow, hand the connected wallet to the widget. Any [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) provider works. The widget then uses that wallet and never shows its own picker:

```js
const widget = document.querySelector('recoilpay-intent');
widget.provider = window.ethereum; // or your wagmi connector's provider, a WalletConnect session, etc.
```

Your site owns that connection, so the widget doesn't show a *Disconnect* link for it.

---

## How the widget handles wallets

- **Discovery.** Wallets that announce themselves via EIP-6963 are listed by name and icon, so several installed wallets can coexist. Older wallets that only set `window.ethereum` are offered as a fallback.
- **Returning visitors** are reconnected silently. The widget remembers which wallet was used and asks it for accounts without a prompt. If the wallet no longer authorises the site, the visitor just sees *Connect wallet* again.
- **Changes made in the wallet** are followed: switching accounts updates the widget, and disconnecting resets it.
- **Missing testnets.** Most wallets don't ship with testnets enabled. When a swap needs a chain the wallet doesn't know, the widget asks the wallet to add it, then switches.

---

## Styling and isolation

The widget renders inside **Shadow DOM**:

- Your page's CSS can't reach in. Global resets, `* { … !important }` rules and button styles don't affect it.
- Its CSS can't leak out. Nothing is added to your `<head>`.
- The one thing it takes from your page is the **font**, so it blends in. Set `font-family` if you'd rather it didn't.

The wallet picker opens as a modal above your page at `z-index: 2147483000`. WalletConnect's QR modal is WalletConnect's own and renders over the page in the same way.

---

## Content-Security-Policy

If your site sends a CSP header, allow the following:

| Directive | Allow | Why |
|---|---|---|
| `script-src` | `https://cdn.jsdelivr.net` (or your own origin, if self-hosting) | The widget and its chunks |
| `connect-src` | `https://api.recoilpay.com` | Quotes, orders, supported assets |
| `connect-src` | `https://router.huggingface.co` | Plain-English parsing |
| `connect-src` | `https://*.publicnode.com` | Permit2 allowance reads, via the RPCs listed by [`/api/v1/chains`](./api-reference#get-apiv1chains) |
| `connect-src` | `https://*.walletconnect.org wss://*.walletconnect.org https://*.walletconnect.com wss://*.walletconnect.com https://*.web3modal.org` | Only if you set a WalletConnect project id |
| `img-src` | `data:` | Wallet icons supplied by wallets as data URIs |

The widget's own styles are applied as constructed stylesheets, so it doesn't need `style-src 'unsafe-inline'`.

---

## Size and compatibility

- **First load:** about 115 KB gzipped, which is React plus the intent flow. WalletConnect is a separate download, fetched only when a visitor picks it.
- **Browsers:** needs module scripts, custom elements and Shadow DOM, which every current browser supports.
- **Loading twice is safe.** Two embeds on one page, or the script included twice, won't conflict.

---

## Troubleshooting

| You see | Likely cause |
|---|---|
| The element is empty | The script didn't load. Check the network tab and your CSP `script-src`. |
| "Natural-language parsing isn't set up here" | `hf-access-token` is missing or empty. |
| Every sentence gets the example hint | The Hugging Face token is invalid or out of credit, or `router.huggingface.co` is blocked by your CSP. |
| No WalletConnect option | `walletconnect-project-id` is missing or empty. |
| WalletConnect QR never appears | The project id is wrong, or your origin isn't on the project's domain allowlist at cloud.reown.com. |
| "No wallet found in this browser" | No extension wallet is installed and WalletConnect isn't configured. |
| "Could not reach the solver network" | `api.recoilpay.com` is blocked (CSP `connect-src`, an ad blocker) or briefly unavailable. |
| "*X* isn't supported yet" | No active solver fills that token or chain today. See [Supported networks](../supported-networks). |

Anything else: see [Troubleshooting](../troubleshooting), or [talk to us](./going-live#talk-to-us).
