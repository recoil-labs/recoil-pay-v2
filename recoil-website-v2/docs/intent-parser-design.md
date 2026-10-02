# Intent Parser — Design

The intent parser turns a fixed-template **sentence** into a **structured, validated intent**
that the rest of the V2 stack (quote → sign → settle via OIF) can execute. It is a pure,
deterministic function — **no LLM, no UI form fields.** A regex/grammar over a fixed template
plus an alias registry does the whole job.

> **One rule above all:** the parser only *proposes* a structured intent. It never moves money.
> Every output is re-resolved by deterministic code and confirmed by the user before any signature.

---

## 1. The template grammar

Users type one of a small set of fixed templates. Everything reduces to filling slots.

```
swap   := "swap" <amount> <token> "on" <chain> ("for" | "to") <token> "on" <chain>
send   := "send" <amount> <token> "on" <chain> "to" <recipient>
```

EBNF-ish:

```
intent    := swap | send
amount    := ["$"] NUMBER                  ; "$" → amountKind=usd, else token units
token     := WORD                          ; resolved via TOKEN_ALIASES
chain     := WORD{1,2}                      ; resolved via CHAIN_ALIASES (longest match: "sol network")
recipient := WORD                          ; address | ENS | handle | email
```

Examples:

| Sentence | Parses to |
|---|---|
| `swap 100 USDC on Base for ETH on Arbitrum` | swap · 100 USDC@Base → ETH@Arbitrum |
| `swap usdt on eth to solana on sol network` | swap · (amount **missing**) USDT@Ethereum → SOL@Solana |
| `send 50 USDC on Base to vitalik.eth` | send · 50 USDC@Base → vitalik.eth |

Parsing is case-insensitive and whitespace-tolerant. **The same word can be a token or a
chain** (`eth`, `sol`) — it is disambiguated **by slot position**, never by the word itself.
Whatever follows `on` is a chain; the asset slot is a token.

### Off-template input

If the sentence does not match any template, reject with a hint (do **not** fall back to guessing):

> ⚠️ Couldn't read that. Try: `swap <amount> <token> on <chain> for <token> on <chain>`
> e.g. `swap 100 USDC on Base for ETH on Arbitrum`

---

## 2. The registry (two layers)

The grammar is the easy part. The real work is the **registry**, which has two distinct layers.

### 2a. Alias layer — *static, "what did they mean"*

Normalizes free typing into canonical identifiers. Seed from V1's `/assets` data.

```ts
const TOKEN_ALIASES: Record<string, string> = {
  usdc: "USDC", usdt: "USDT", eth: "ETH", weth: "WETH",
  wbtc: "WBTC", btc: "WBTC", sol: "SOL", solana: "SOL", /* ... */
};

const CHAIN_ALIASES: Record<string, number | "solana"> = {
  base: 8453, arbitrum: 42161, arb: 42161,
  optimism: 10, op: 10,
  ethereum: 1, eth: 1, mainnet: 1,
  "sol network": "solana", solana: "solana", sol: "solana",
  // testnet aliases used by the live OIF demo:
  "base sepolia": 84532, "op sepolia": 11155420, "optimism sepolia": 11155420,
};
```

`eth` and `sol` appear in **both** tables — fine, because the slot already told us which one.

### 2b. Support layer — *dynamic, "can we actually execute it"*

A recognized token/chain is not necessarily *executable*. The set of pairs that can really be
filled is whatever the **solvers currently support** — fetched live from the aggregator:

```
GET /api/v1/solvers  →  supportedAssets.assets[] = { chainId, symbol, address, decimals }
```

The resolver builds its `(chainId, symbol) → { address, decimals }` map from this response (cached,
refreshed periodically). **If a normalized (token, chain) pair is not in this map, the intent is
recognized but not supported** — a distinct, important error class (see §4).

> **Reality check (today):** the live OIF deployment supports only **USDC** on **OP Sepolia
> (11155420)** and **Base Sepolia (84532)**. So today the only *executable* intent is USDC between
> those two chains. Mainnet examples (`Base`, `Arbitrum`, `ETH`) parse fine but resolve to
> "not supported yet" until OIF is expanded. The parser should reflect the live set, not the
> marketing copy.

---

## 3. Parse-result schemas

### 3a. RawIntent — parser output (pre-resolution)

```ts
type Action = "swap" | "send";

interface RawIntent {
  action: Action;
  amount: string | null;          // as typed, e.g. "100" (null = not stated)
  amountKind: "token" | "usd";    // "$100" → usd, "100 USDC" → token
  tokenIn: string | null;         // raw alias as typed
  chainIn: string | null;
  tokenOut: string | null;        // null for `send`
  chainOut: string | null;        // null for `send`
  recipient: string | null;       // for `send`
}
```

### 3b. ValidationIssue — every problem, collected

```ts
interface ValidationIssue {
  field: "amount" | "tokenIn" | "chainIn" | "tokenOut" | "chainOut" | "recipient";
  kind: "missing" | "unknown" | "unsupported";
  message: string;                // user-facing, see §4
}
```

### 3c. ResolvedIntent — what the OIF order builder consumes

```ts
interface ResolvedIntent {
  action: "swap" | "send";
  user: `0x${string}`;            // connected wallet
  srcChainId: number;
  dstChainId: number;
  inputToken: `0x${string}`;      // resolved address on srcChain
  inputDecimals: number;
  inputAmount: bigint;            // base units (amount * 10**decimals)
  outputToken: `0x${string}`;     // resolved address on dstChain
  recipient: `0x${string}`;       // = user for swap; the recipient for send
}
```

`parse(sentence)` → `RawIntent | offTemplateError`
`validate(raw, registry)` → `ValidationIssue[]` (empty = ok)
`resolve(raw, registry, user)` → `ResolvedIntent` (only called when validation passes)

---

## 4. Validation — strict, field-named, all-at-once

**Always check every required slot.** Report **all** problems together, not one at a time, so the
user fixes everything in one edit instead of resubmitting repeatedly.

### Required slots per action

| Action | Required slots |
|---|---|
| `swap` | amount, tokenIn, chainIn, tokenOut, chainOut |
| `send` | amount, tokenIn, chainIn, recipient |

### Three failure kinds — keep them distinct

| Kind | Meaning | Example |
|---|---|---|
| **missing** | slot not stated at all | `swap USDC on Base for ETH on Arbitrum` → amount missing |
| **unknown** | stated but not in the alias registry | `swap 100 FOO on Base …` → token unknown |
| **unsupported** | recognized, but no solver/route for it | `… ETH on Arbitrum` → chain not live yet |

### Error strings

| Slot | missing | unknown | unsupported |
|---|---|---|---|
| amount | **"Amount is not stated."** | "Amount must be a number." | — |
| tokenIn | **"Source token is not stated."** | "Token '{x}' isn't recognized." | "Token '{x}' isn't supported yet." |
| chainIn | **"Source chain is not stated."** | "Chain '{x}' isn't recognized." | "Chain '{x}' isn't supported yet." |
| tokenOut | **"Destination token is not stated."** | "Token '{x}' isn't recognized." | "Token '{x}' isn't supported yet." |
| chainOut | **"Destination chain is not stated."** | "Chain '{x}' isn't recognized." | "Chain '{x}' isn't supported yet." |
| recipient | **"Recipient is not stated."** | "Recipient '{x}' isn't a valid address/ENS." | — |

### Order of checks

1. **Template match** — fits a template at all? If not → off-template hint (§1).
2. **Missing** — collect every empty required slot.
3. **Unknown** — resolve each filled slot against the alias layer; collect unrecognized ones.
4. **Unsupported** — resolve against the support layer; collect pairs no solver covers.
5. **Sanity** — amount is a positive finite number; `(srcChain, inputToken) ≠ (dstChain, outputToken)`;
   (later) balance ≥ amount.

Only when steps 1–5 all pass do we build the order and show the confirm card.

### Example — your two sentences

```
swap 100 USDC on Base for ETH on Arbitrum
  → parses cleanly; today resolves to: chainOut "Arbitrum" unsupported, token "ETH" unsupported
  → ⚠️ Can't execute yet: • Chain 'Arbitrum' isn't supported yet. • Token 'ETH' isn't supported yet.
     (Live today: USDC between Base Sepolia and OP Sepolia.)

swap usdt on eth to solana on sol network
  → ⚠️ Can't build this intent:
       • Amount is not stated.
       • Chain 'Ethereum' isn't supported yet.
       • Token 'SOL' isn't supported yet.
     Try: swap 100 USDC on Base for ETH on Arbitrum
```

---

## 5. Module layout (proposed)

```
src/intent/
  grammar.ts       # parse(sentence) -> RawIntent | OffTemplateError
  registry.ts      # TOKEN_ALIASES, CHAIN_ALIASES + loadSolverAssets() (support layer)
  validate.ts      # validate(raw, registry) -> ValidationIssue[]
  resolve.ts       # resolve(raw, registry, user) -> ResolvedIntent
  types.ts         # RawIntent, ValidationIssue, ResolvedIntent
  grammar.test.ts  # sentence -> expected RawIntent / issues (regression suite)
```

The downstream OIF order-builder (`src/oif/`) consumes `ResolvedIntent` — see
[`intent-execution-plan.md`](./intent-execution-plan.md).

---

## 6. Out of scope (for the parser)

- **`buy` / `sell` / `cash out` / `gift card`** — these need fiat on/off-ramps, which OIF does not
  do. Keep them as V1-style flows or future work; the parser handles **swap** and **send** (both
  of which OIF can settle, send = a swap whose output `receiver` is the recipient).
- **Natural free-form language** — explicitly avoided. Fixed templates only. An LLM fallback can be
  bolted on later if the template ever needs loosening, behind the same validation + confirm gate.
