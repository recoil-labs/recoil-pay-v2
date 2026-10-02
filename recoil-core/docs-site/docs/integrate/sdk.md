---
title: Headless SDK
sidebar_label: Headless SDK
---

# Headless SDK

`@recoilpay/intent-core` is the whole intent flow with no UI. It works in any framework, or none: Vue, Svelte, Angular, vanilla JS, or a Node script. The [widget](./widget) and the [React component](./react) are both built on it.

```bash
npm install @recoilpay/intent-core viem
```

---

## The flow in five lines

```ts
import { createIntentSession, viemWallet } from '@recoilpay/intent-core';

const session = createIntentSession({ hfAccessToken }); // your Hugging Face token; quotes go to api.recoilpay.com
session.subscribe((state) => render(state));        // called after every change

await session.run('swap 10 USDC on base sepolia for USDC on op sepolia');
session.setWallet(viemWallet(walletClient));        // any time; a waiting flow continues
await session.confirm();                            // switch chain → approve → sign → submit → track
```

A session is a small store. `run`, `setWallet`, `confirm` and `reset` move it forward. `getState()` returns the current snapshot, and `subscribe` tells you when it changes. None of the methods throw: every failure ends up in the state, with a message you can show as-is.

---

## The state

`session.getState()` returns an immutable snapshot, and a new object comes after every change. That works directly with Vue's `shallowRef`, Svelte stores, signals, or React's `useSyncExternalStore`.

### `phase`

```
idle → parsing → quoting → quoted → switchingChain → approving → signing → submitting → tracking → done
                    ↘ offTemplate   ↘ invalid   ↘ needsWallet                                  ↘ error (from any step)
```

| Phase | Meaning | Show |
|---|---|---|
| `idle` | Nothing running | The input |
| `parsing` | Reading the sentence | A spinner |
| `offTemplate` | Not recognisable as an intent | `hint`, an example sentence |
| `invalid` | Parsed, but needs fixing | Every entry in `issues` |
| `needsWallet` | Ready to quote once a wallet is set | Your connect button |
| `quoting` | Solvers are racing | "Asking solvers…" |
| `quoted` | A quote is ready | `preview`, and a confirm button |
| `switchingChain`, `approving`, `signing`, `submitting` | Working through `confirm()` | A busy button. The wallet is prompting |
| `tracking` | Order submitted, polling | `status` as a progress bar |
| `done` | Every intent in the sentence finished | Success, with `explorerUrl` |
| `error` | Something failed | `error` |

### Fields

| Field | Type | |
|---|---|---|
| `ready` | `boolean` | The live solver coverage has loaded. Disable input until it's `true`. |
| `assetsError` | `boolean` | Coverage failed to load (offline or blocked). Call `refreshAssets()` to retry. |
| `hint` | `string \| null` | With `offTemplate`. |
| `issues` | `{ field, kind, message }[]` | With `invalid`. `kind` is `missing`, `unknown` or `unsupported`. |
| `preview` | `IntentPreview \| null` | Human-readable amounts: `payAmount`, `paySymbol`, `srcChainName`, `receiveAmount`, `receiveSymbol`, `dstChainName`, `recipient`, `etaSeconds`, `solverCount`, `solversQueried`. No base units, no addresses. |
| `route` | `'solver' \| 'direct' \| null` | `direct` means a same-chain send, made straight from the wallet. |
| `needsApproval` | `boolean` | `confirm()` will ask for a one-time Permit2 approval first. Worth telling the user. |
| `orderId`, `status`, `order` | | While tracking. `status` is the [order status](./api-reference#order-status). |
| `explorerUrl` | `string \| null` | Destination-chain explorer link: the fill transaction when known, otherwise the recipient. |
| `error` | `string \| null` | With `error`, written for the end user. |
| `queueIndex`, `queueTotal` | `number` | Sentences with several intents run one at a time. |
| `isConnected` | `boolean` | A wallet is set. |

---

## Wallets

The session needs an `IntentWallet`. For a viem `WalletClient`, use the adapter:

```ts
import { viemWallet } from '@recoilpay/intent-core';
session.setWallet(viemWallet(walletClient));
session.setWallet(null);                            // on disconnect
```

For anything else, implement the interface yourself. It's six members:

```ts
interface IntentWallet {
  address: `0x${string}`;
  getChainId(): Promise<number>;
  switchChain(chainId: number): Promise<void>;
  signTypedData(args: { domain; types; primaryType; message }): Promise<`0x${string}`>;   // EIP-712
  writeContract(req: { chainId; address; abi; functionName; args }): Promise<`0x${string}`>;
  sendTransaction(req: { chainId; to; value }): Promise<`0x${string}`>;
}
```

`writeContract` is used for the one-time Permit2 approval and for same-chain token sends. `sendTransaction` is used for same-chain native sends. Everything else is a signature.

Changing the wallet mid-flow is safe. A flow waiting in `needsWallet` continues, and a quote built for a different account is fetched again for the new one.

---

## Options

```ts
createIntentSession({
  hfAccessToken,                       // your Hugging Face token for parsing; setHfAccessToken() to change it
  hfModel,                             // Hugging Face model; defaults to the one the RecoilPay app uses
  apiUrl: 'https://api.recoilpay.com', // default
  wallet,                              // or setWallet() later
  pollIntervalMs: 2500,                // order-status polling
  fetch,                               // custom fetch: SSR, proxies, tests
  chainReader,                         // on-chain reads (Permit2 allowance); defaults to the RPCs from /api/v1/chains
});
```

Call `session.destroy()` when you're completely done with a session. It stops polling and drops listeners.

---

## Building blocks

Every step is exported on its own, for when you want your own orchestration. For example, a backend or an agent could use them like this:

```ts
import {
  createApiClient, parseIntent, buildSupportedSet, validateIntent, resolveIntent,
  buildQuoteRequest, signQuote, buildOrderRequest,
} from '@recoilpay/intent-core';

const api = createApiClient();
const parsed = await parseIntent('swap 1 USDC on op sepolia for USDC on base sepolia', { hfAccessToken });
if (!parsed.ok) throw new Error(parsed.message);

const supported = buildSupportedSet(await api.getSupportedAssets());
const issues = validateIntent(parsed.intents[0], supported);          // [] when executable
const intent = resolveIntent(parsed.intents[0], supported, userAddress);

const { quotes } = await api.getQuotes(buildQuoteRequest(intent));
const signature = await signQuote(quotes[0], signTypedData);           // scheme-prefixed, ready to submit
const order = await api.submitOrder(buildOrderRequest(quotes[0], signature));
```

These are the same calls described in [Forward your first intent](./quickstart), with the ERC-7930 encoding (`interopAddress`), the Permit2 helpers (`hasPermit2Allowance`, `buildPermit2ApproveRequest`) and the signature prefixes handled for you.
