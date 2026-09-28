# @recoilpay/intent-core

The RecoilPay intent flow without a UI: turn plain English into a cross-chain swap or send, race solvers for a quote, sign, submit, and track the order to settlement.

It works in any framework or none. `@recoilpay/intent-react` and the hosted widget are built on it. If you want your own UI, use this directly.

```sh
npm install @recoilpay/intent-core viem
```

## Quick start

```ts
import { createIntentSession, viemWallet } from '@recoilpay/intent-core';

const session = createIntentSession();          // production aggregator by default

session.subscribe((state) => render(state));    // re-render on every change

await session.run('swap 10 USDC on Base for ETH on Arbitrum');
// state.phase === 'needsWallet'

session.setWallet(viemWallet(walletClient));    // continues on its own
// state.phase === 'quoted', state.preview has the amounts to show

await session.confirm();                        // switch chain → approve → sign → submit
// state.phase goes 'tracking' → 'done'; state.explorerUrl links the fill
```

## The state

`session.getState()` returns an immutable snapshot, and a new object comes after every change, so it works directly with `useSyncExternalStore`, Svelte stores, signals and similar tools.

| Field | Meaning |
|---|---|
| `phase` | `idle` · `parsing` · `offTemplate` · `invalid` · `needsWallet` · `quoting` · `quoted` · `switchingChain` · `approving` · `signing` · `submitting` · `tracking` · `done` · `error` |
| `ready` | The supported-asset list has loaded, so input can be accepted |
| `hint` | When `offTemplate`, a sentence template to show the user |
| `issues` | When `invalid`: every problem at once, each with `field`, `kind` and a user-facing `message` |
| `preview` | When `quoted`: `payAmount`, `paySymbol`, `srcChainName`, `receiveAmount`, `receiveSymbol`, `dstChainName`, `etaSeconds`, `solverCount` |
| `needsApproval` | A one-time Permit2 approval will happen on confirm |
| `orderId`, `status`, `explorerUrl` | While tracking and when done |
| `error` | When `error`: the message to show |
| `queueIndex`, `queueTotal` | Sentences with several intents ("swap… then send…") run one at a time |

Nothing throws. Failures become `phase: 'error'`, `offTemplate` or `invalid`, each with a message written for the end user.

## Wallets

The session needs a small `IntentWallet`. From a viem `WalletClient`:

```ts
import { viemWallet } from '@recoilpay/intent-core';
session.setWallet(viemWallet(walletClient));
```

With wagmi, pass the connected wallet client, and pass `null` on disconnect:

```ts
const { data: walletClient } = useWalletClient();
useEffect(() => session.setWallet(walletClient ? viemWallet(walletClient) : null), [walletClient]);
```

Any other wallet SDK can implement `IntentWallet` directly: an address, `getChainId`, `switchChain`, `signTypedData`, `writeContract` and `sendTransaction`.

## Options

```ts
createIntentSession({
  apiUrl: 'https://api.recoilpay.com', // default; point at staging or a local aggregator
  wallet,                              // or set it later with setWallet()
  pollIntervalMs: 2500,                // order-status polling
  fetch,                               // custom fetch (SSR, proxies, tests)
  chainReader,                         // chain reads; defaults to the aggregator's RPCs
});
```

## Building your own flow

Every step is exported on its own: `createApiClient` (parse, chains, supported assets, quotes, orders), `validateIntent`, `resolveIntent`, `buildQuoteRequest`, `signQuote`, the Permit2 helpers, and `interopAddress` (ERC-7930 encoding). The aggregator API is documented at https://docs.recoilpay.com/integrate/.

## Notes

- **Testnets only** for now: Base Sepolia, OP Sepolia, Ethereum Sepolia and Polygon Amoy, with mock tokens.
- **Only the escrow (Permit2) route is requested.** The first swap of a token needs a one-time approval transaction, which `confirm()` handles.
- **Same-chain sends skip solvers** and go straight from the wallet (`route: 'direct'`).
- **Natural-language parsing** is `POST /api/v1/intents/parse` on the aggregator, which holds the model credentials. Nothing secret ships in this package.
