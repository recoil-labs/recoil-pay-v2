---
title: The intent object
sidebar_position: 3
---

# The intent object

An intent describes an **outcome**: what leaves, what arrives, and where. It says nothing about route, bridge, or venue — that's the solvers' problem. This page is the full schema of what you forward to us.

---

## Addresses are ERC-7930 encoded

This is the single thing most integrations get wrong, so it comes first.

RecoilPay does not take plain `0x` addresses. Every address in an intent is an **ERC-7930 interop address** — the chain id and the address packed into one hex string:

```
0x [version:2] [chainType:2] [chainRefLen:1] [chainRef:n] [addrLen:1] [address:20]
     0x0001       0x0000        e.g. 0x03      e.g. 0x014a34    0x14
```

- `version` — always `0x0001`
- `chainType` — `0x0000` for EIP-155 (EVM) chains
- `chainRef` — the chain id as **minimal** big-endian bytes (no leading zero padding)
- `address` — the 20 raw address bytes

Worked example — USDC on Base Sepolia (`84532` = `0x014a34`), token `0x73c83DAcc74bB8a704717AC09703b959E74b9705`:

```
0001 | 0000 | 03 | 014a34 | 14 | 73c83dacc74bb8a704717ac09703b959e74b9705
```

```
0x0001000003014a341473c83dacc74bb8a704717ac09703b959e74b9705
```

:::danger A bad encoding fails silently
The aggregator won't tell you your address was malformed. You'll get `quotes: []` and a `metadata` block that looks like nobody wanted your business. If you're getting no quotes, **verify your encoder first** — round-trip an address through encode/decode and assert you get back what you put in.
:::

### A reference encoder

Copy this. It's the encoder the RecoilPay app uses, and it reproduces the aggregator's own published examples exactly.

```ts
/** Minimal big-endian bytes for a chain id. */
function chainIdToBytes(chainId: number): number[] {
  const bytes: number[] = [];
  let v = chainId;
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
  return bytes.length ? bytes : [0];
}

const hex = (bytes: number[]) => bytes.map(b => b.toString(16).padStart(2, '0')).join('');

/** Encode (chainId, EVM address) → ERC-7930 interop address. */
export function interopAddress(chainId: number, address: string): `0x${string}` {
  const chainRef = chainIdToBytes(chainId);
  const addr = address.replace(/^0x/, '').match(/.{2}/g)!.map(b => parseInt(b, 16));
  return `0x0001` +                                     // version
         `0000` +                                       // chainType: EIP-155
         chainRef.length.toString(16).padStart(2, '0') + // chainRefLen
         hex(chainRef) +                                 // chainRef
         addr.length.toString(16).padStart(2, '0') +     // addrLen
         hex(addr) as `0x${string}`;
}

/** Decode back — use this in a test to prove your encoder round-trips. */
export function fromInteropAddress(interop: string): { chainId: number; address: `0x${string}` } {
  const h = interop.replace(/^0x/, '');
  let o = 8;                                            // skip version + chainType
  const crLen = parseInt(h.slice(o, o + 2), 16); o += 2;
  const chainId = parseInt(h.slice(o, o + crLen * 2), 16); o += crLen * 2;
  const aLen = parseInt(h.slice(o, o + 2), 16); o += 2;
  return { chainId, address: `0x${h.slice(o, o + aLen * 2)}` };
}
```

Pre-computed values for the four live testnets, if you want fixtures to test against:

| Chain | Chain id | `chainRef` prefix |
|---|---|---|
| Optimism Sepolia | `11155420` | `0x0001000003aa37dc14…` |
| Base Sepolia | `84532` | `0x0001000003014a3414…` |
| Polygon Amoy | `80002` | `0x000100000301388214…` |
| Ethereum Sepolia | `11155111` | `0x0001000003aa36a714…` |

---

## Amounts

**Base units, as a decimal string.** Not a number, not hex, not a decimal fraction.

- USDC and USDT have 6 decimals → `1 USDC` is `"1000000"`
- Must be greater than zero; `"0"` is rejected at validation

Use a string because amounts exceed IEEE-754 safe integers. `JSON.parse`-ing an amount into a JS `number` is a real bug waiting for a large-value transfer — keep it a string or a `bigint` end to end.

Read decimals from `GET /api/v1/chains` or from the solver's `supportedAssets` rather than assuming 6.

---

## The quote request

```ts
{
  user: InteropAddress,          // who is spending — the signer
  intent: {
    intentType: 'oif-swap',
    inputs:  Input[],
    outputs: Output[],
    swapType?: 'exact-input' | 'exact-output',
    preference?: 'price' | 'speed' | 'inputPriority' | 'trustMinimization',
    partialFill?: boolean,
    minValidUntil?: number,      // ⚠️ omit — see below
    failureHandling?: ('refund-automatic' | 'refund-claim' | 'needs-new-signature')[],
    originSubmission?: { mode: 'user' | 'protocol', schemes?: Scheme[] },
    metadata?: unknown,
  },
  supportedTypes: string[],      // ['oif-escrow-v0']
  solverOptions?: SolverOptions,
  metadata?: unknown,
}
```

### `inputs[]` — what leaves

```ts
{ user: InteropAddress, asset: InteropAddress, amount?: string, lock?: AssetLockReference }
```

`user` is the funding address on the **source** chain; `asset` is the input token on that same chain. At least one input is required.

### `outputs[]` — what arrives

```ts
{ receiver: InteropAddress, asset: InteropAddress, amount?: string, calldata?: string }
```

`receiver` is the destination address on the **destination** chain; `asset` is the token there. At least one output is required.

The receiver is what makes this general: set it equal to `user` and you have a **swap**; set it to someone else and you have a cross-chain **send** or payment. There's no separate endpoint or intent type for paying a third party.

### `swapType`

- `exact-input` — fix `inputs[].amount`, leave `outputs[].amount` unset, solvers compete on delivery. **Use this by default.**
- `exact-output` — fix `outputs[].amount`, leave `inputs[].amount` unset, solvers compete on cost. Right for invoices and checkouts where the amount due is fixed.

### `preference`

A hint about how to rank: `price`, `speed`, `inputPriority`, `trustMinimization`. You get all the quotes regardless, so you can always rank them yourself from `preview` and `eta`.

### `supportedTypes`

Which settlement types your client can sign. Send `["oif-escrow-v0"]` — see [Signing](./signing#pick-the-escrow-route).

### `originSubmission`

How the input gets custodied. `{ mode: "user", schemes: ["permit2"] }` means the user signs and Permit2 moves the funds.

:::warning Request `permit2` explicitly
If you offer `eip3009` here, a solver may prefer it — and the EIP-3009 open path currently reverts on-chain with `SignatureAndInputsNotEqual` on this deployment. Listing `["permit2"]` alone is what keeps you on the working route.
:::

### `minValidUntil` — do not send it {#do-not-send-minvaliduntil}

Intended as "keep this valid for at least N seconds". This deployment copies the value **verbatim** into the authorization's absolute `validBefore` timestamp, so `600` becomes a Unix time in 1970 and the order is born expired.

**Omit the field.** The solver then sets a sensible absolute deadline (~5 minutes) and returns it as `validUntil` on the quote. Use that value for your own expiry countdown.

### `solverOptions`

```ts
{
  timeout?: number,         // ms, whole request
  solverTimeout?: number,   // ms, per solver
  minQuotes?: number,       // respond as soon as this many arrive (≥ 1)
  solverSelection?: 'all' | 'sampled' | 'priority',
  includeSolvers?: string[],
  excludeSolvers?: string[],
  sampleSize?: number,      // with 'sampled'
  priorityThreshold?: number, // 0–100, with 'priority'
}
```

`{ timeout: 8000, solverTimeout: 5000, minQuotes: 1 }` is a good interactive default: ~5s for any one solver, 8s ceiling overall, return as soon as one real quote lands. `timeout` must be ≥ `solverTimeout` or the request is rejected.

Trade-off worth being deliberate about: `minQuotes: 1` optimises for latency and returns the first quote that arrives; a higher value waits for genuine competition and gets a better price. Interactive UI wants the former, batch settlement wants the latter.

### `metadata`

Free-form JSON, passed through to adapters. Convenient for your own correlation id.

:::note Not an attribution mechanism
Don't build partner attribution or revenue-sharing on `metadata` — nothing in the pipeline reads it for that purpose today. Attribution will ride on partner API keys. [Talk to us](./going-live#talk-to-us) if you need it.
:::

---

## A complete, valid body

Swap 25 USDC on Optimism Sepolia for USDC on Polygon Amoy:

```json
{
  "user": "0x0001000003aa37dc14632bf0d0d6468908378c3ccfac4e788b115e0e55",
  "intent": {
    "intentType": "oif-swap",
    "inputs": [{
      "user":   "0x0001000003aa37dc14632bf0d0d6468908378c3ccfac4e788b115e0e55",
      "asset":  "0x0001000003aa37dc14191688b2ff5be8f0a5bcab3e819c900a810faaf6",
      "amount": "25000000"
    }],
    "outputs": [{
      "receiver": "0x000100000301388214632bf0d0d6468908378c3ccfac4e788b115e0e55",
      "asset":    "0x0001000003013882148c1963ba445dd562da0b6c6fbca070921b3fa8e6"
    }],
    "swapType": "exact-input",
    "originSubmission": { "mode": "user", "schemes": ["permit2"] }
  },
  "supportedTypes": ["oif-escrow-v0"],
  "solverOptions": { "timeout": 8000, "solverTimeout": 5000, "minQuotes": 1 }
}
```

---

## Validation

Rejected with `400` before any solver is contacted if: inputs or outputs are empty, any interop address is malformed, any stated amount is zero or negative, `supportedTypes` is empty, or `solverOptions` are inconsistent. Unknown top-level fields are also rejected — the schema is strict, so a typo like `solverOption` is an error rather than a silently ignored field.

Note that a well-formed intent for an **unsupported route** is not a validation error. It returns `200` with `quotes: []`.

**→ [Signing and submitting](./signing)**
