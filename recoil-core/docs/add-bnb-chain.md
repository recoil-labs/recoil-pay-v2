# Task: Add BNB Chain (BSC) support to RecoilPay

Add BNB Smart Chain as a supported settlement destination, starting with **BSC
testnet (97)** and ending with a path to **BSC mainnet (56)**. Work in the
`recoil-pay-v2` monorepo.

Follow the existing playbook in `recoil-core/docs/add-testnet-chains.md` —
that is how Ethereum Sepolia, Arbitrum Sepolia and Polygon Amoy were added. This
task is the same shape, with important differences called out below.

---

## Verified facts — do not re-derive these, they were checked on-chain

**The canonical OIF settlement contracts are ALREADY DEPLOYED on BSC**, on both
mainnet and testnet, at the same addresses used by Ethereum Sepolia / Polygon
Amoy. Verified via `eth_getCode`:

| Contract | Address | BSC 56 | BSC 97 |
|---|---|:--:|:--:|
| InputSettlerEscrow | `0x1CC9260E285C2C8AC8D2E7102F3978056Ec1d0a8` | ✅ 13953 bytes | ✅ 13953 bytes |
| OutputSettlerSimple | `0x52602D7cc3D833F5d28ee6D01C7F82C9b2322e10` | ✅ 5470 bytes | ✅ 5470 bytes |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | ✅ 9152 bytes | ✅ 9152 bytes |

**You therefore do NOT need to deploy settlers or Permit2.** This is the biggest
difference from the previous chain additions. The only on-chain deployment is
the oracle and (on testnet) a mock USDC.

Chain IDs: BSC mainnet `56`, BSC testnet `97`, opBNB `204`, opBNB testnet `5611`.

RPC endpoints (use at least two per chain for redundancy):
- BSC testnet: `https://bsc-testnet-rpc.publicnode.com`, `https://data-seed-prebsc-1-s1.binance.org:8545`
- BSC mainnet: `https://bsc-rpc.publicnode.com`, `https://bsc-dataseed.binance.org`

Explorers: `https://testnet.bscscan.com`, `https://bscscan.com`

---

## ⚠️ Two traps specific to BNB Chain

### 1. BSC stablecoins are 18 decimals, not 6

Verified on-chain on BSC mainnet:
- USDC `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` → **18 decimals**
- USDT `0x55d398326f99059fF775485246999027B3197955` → **18 decimals**

Every existing chain in this codebase uses 6-decimal USDC. The amount paths are
data-driven (`parseUnits(raw.amount, inAsset.decimals)` in
`recoil-website-v2/src/intent/resolve.ts`), so the **code** is fine — but:

- Every config entry you write for BSC must say `"decimals": 18`.
- The docs and examples state "USDC has 6 decimals" and must be corrected to be
  per-chain, not global.
- Any partner who hardcoded `1 USDC = 1000000` breaks on BSC by a factor of 10^12.
- On **testnet** you control the mock token, so deploy it with **6 decimals** to
  match the existing chains and keep testnet simple. On **mainnet** you must use
  18. Make this explicit in config and in a code comment so nobody "fixes" it later.

### 2. BSC chain IDs encode to 1-byte ERC-7930 chain references

All four existing chains have 3-byte chain references. BSC has 1 byte. The
encoder (`toInteropAddress` in `recoil-website-v2/src/oif/interop.ts` and the
copy in `recoilpay-intent-kit/packages/core/`) uses minimal big-endian encoding
so it handles this correctly — but there is **no test coverage for the 1-byte
case**, and a regression here produces zero quotes with no error message.

Exact expected prefixes (version `0x0001`, chainType `0x0000`, then
`<len><chainRef><0x14><20-byte address>`):

| Chain | ID | chainRef bytes | Prefix |
|---|---|---|---|
| BSC mainnet | 56 | 1 | `0x000100000138…` |
| BSC testnet | 97 | 1 | `0x000100000161…` |
| opBNB | 204 | 1 | `0x0001000001cc…` |
| opBNB testnet | 5611 | 2 | `0x000100000215eb…` |
| OP Sepolia (existing) | 11155420 | 3 | `0x0001000003aa37dc…` |

Full worked example — USDC `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` on BSC mainnet:
```
0x000100000138148ac76a51cc950d9822d68b83fe1ad97b32cd580d
```

**Add round-trip tests covering 1-byte, 2-byte and 3-byte chain references
before touching anything else.**

---

## Step 1 — Encoder tests first (do this before any config)

In both `recoil-website-v2/src/oif/` and `recoilpay-intent-kit/packages/core/`,
add tests asserting `fromInteropAddress(interopAddress(c, a))` round-trips for
chain IDs `56`, `97`, `204`, `5611`, `84532`, `11155420`. Assert the BSC mainnet
vector above matches byte for byte.

These must pass before proceeding. Run the existing suites to confirm nothing
else breaks.

## Step 2 — Deploy the oracle and mock USDC on BSC testnet

### Getting the contracts repo

The OIF contracts are NOT in this monorepo and must not be vendored into it.
Clone them as a SIBLING directory — they are a deploy tool, not product code:

```sh
cd ..                      # alongside recoil-pay-v2, not inside it
git clone --recursive https://github.com/openintentsframework/oif-contracts.git
cd oif-contracts
git checkout 8e38b9bb0e4467a154b1e95b7b6d995ad3a9e518   # pinned 2026-08-20
forge build
```

`--recursive` is required (the repo uses git submodules for Forge deps).
Record the pinned commit alongside any address you deploy from it.

### What is already deployed — do not redeploy

Per the repo's own `DEPLOYMENTS.md`, BSC and BSC Testnet are officially
supported. Verified on-chain:

| Contract | BSC mainnet (56) | BSC testnet (97) |
|---|---|---|
| InputSettlerEscrow `0x1CC9260E285C2C8AC8D2E7102F3978056Ec1d0a8` | ✅ | ✅ |
| OutputSettlerSimple `0x52602D7cc3D833F5d28ee6D01C7F82C9b2322e10` | ✅ | ✅ |
| Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` | ✅ | ✅ |
| **HyperlaneOracle** `0x6Fc567D03eF10a05984717dB88F1baB7b1C95E23` | ✅ (4331 bytes) | ❌ not listed |

Hyperlane on BSC mainnet: mailbox `0x2971b9Aec44bE4eb673DF1B88cDB57b96eefe8a4`,
IGP `0x78E25e7f84416e69b9339B0A6336EB6EFfF6b451`.

**Implication:** on BSC *mainnet* there may be nothing to deploy at all — the
production attestation oracle already exists, so that becomes a configuration
task rather than a build. On BSC *testnet* you still deploy `AlwaysYesOracle`
and a mock USDC, as below.

### Deploy (testnet only)

From the cloned `oif-contracts` directory:

```sh
export RPC=https://bsc-testnet-rpc.publicnode.com
export PK=0x<deployer-private-key>          # needs testnet BNB
export SOLVER=0x<solver-wallet>             # SOLVER_PRIVATE_KEY account
export ME=0x<your-wallet>

# (a) AlwaysYesOracle — testnet only, note the deployed address
forge create test/mocks/AlwaysYesOracle.sol:AlwaysYesOracle \
  --rpc-url $RPC --private-key $PK --broadcast

# (b) Mock USDC — 6 decimals on testnet, to match existing chains
forge create test/mocks/MockERC20.sol:MockERC20 \
  --rpc-url $RPC --private-key $PK --broadcast \
  --constructor-args "USD Coin" "USDC" 6
export USDC=0x<deployed>

# (c) solver output liquidity: 1,000,000 USDC
cast send $USDC "mint(address,uint256)" $SOLVER 1000000000000 --rpc-url $RPC --private-key $PK
# (d) your own test balance: 1,000 USDC
cast send $USDC "mint(address,uint256)" $ME 1000000000 --rpc-url $RPC --private-key $PK
# (e) native BNB for the solver's fills + finalises
cast send $SOLVER --value 0.1ether --rpc-url $RPC --private-key $PK
```

Testnet BNB faucet: https://www.bnbchain.org/en/testnet-faucet

Record the oracle and USDC addresses — everything downstream needs them.

### Deployed (BSC testnet, 97) — from `oif-contracts` @ `8e38b9bb`

| Contract | Address | Notes |
|---|---|---|
| AlwaysYesOracle | `0xd31b6A3b46Bfd45AA629E8739ff35C032d2AE622` | runtime bytecode matches the pinned build |
| MockERC20 "USD Coin" (USDC) | `0x67bF9ba31f64de698EfD23c2CB0208191A5C2A9e` | **6 decimals**; 1,000,000 minted to the solver |

Solver `0x632BF0D0d6468908378C3ccfAC4E788B115e0E55` funded with 0.1 tBNB.

## Step 3 — Aggregator chain registry

`recoil-core/aggregator/crates/config/src/chains.rs`

Add a `ChainInfo` for BSC testnet in `ChainRegistry::testnet_default()`, using
the canonical settlers (same pattern as the `ethereum-sepolia` entry):

```rust
ChainInfo {
    chain_id: 97,
    name: "bsc-testnet".into(),
    rpc_url: "https://bsc-testnet-rpc.publicnode.com".into(),
    input_settler: "0x1CC9260E285C2C8AC8D2E7102F3978056Ec1d0a8".into(),
    output_settler: "0x52602D7cc3D833F5d28ee6D01C7F82C9b2322e10".into(),
    oracle: "<AlwaysYesOracle from step 2>".into(),
    permit2: permit2.clone(),
    tokens: vec![usdc("<mock USDC from step 2>")],   // 6 decimals on testnet
}
```

Note: this registry can also be replaced at runtime via the
`CHAIN_REGISTRY_JSON` env var and RPCs overridden via `CHAIN_RPCS`, so BSC can
be added to a running deployment without a rebuild. Use that for a fast first
test, then land the code change.

## Step 4 — Solver config

`recoil-core/solver/config/testnet-mine-bootstrap.json`

Three coordinated edits:

1. **`networks[]`** — add a block for chain 97 with `tokens` (symbol, name,
   address, decimals), `rpc_urls`, `input_settler_address`,
   `output_settler_address`.
2. **`settlement.direct.oracles.input` and `.output`** — add `"97": ["<oracle>"]`
   to both maps.
3. **`routes`** — this is an explicit adjacency map and is easy to get wrong.
   Add `97` as a key listing every other chain, AND add `97` to the route list
   of every existing chain. Routes must be all-to-all or the pair silently will
   not quote.

Check whether `solver/crates/solver-service/src/seeds/testnet.rs` also needs
updating — it has hardcoded `OPTIMISM_SEPOLIA` / `BASE_SEPOLIA` constants and a
test asserting `supported_chain_ids().len() == 2`. If the live path uses the
bootstrap JSON rather than seeds, leave seeds alone; if you change them, update
that test.

## Step 5 — Fill worker

No code change expected. It is chain-generic, driven by the
`CHAIN_RPCS="<chain>:<url>,…"` env var parsed in
`aggregator/crates/fill-worker/src/config.rs`. Add `97:<rpc>` to that env var in
the deployment config. Confirm by reading `chain_rpc.rs` — it builds providers
from the map with no hardcoded chain list.

## Step 6 — Frontend and SDK chain awareness

Users cannot *type* a chain that has no alias, even once it is executable.

- `recoil-website-v2/src/intent/registry.ts` → `CHAIN_ALIASES`: add
  `bnb`, `bsc`, `binance smart chain`, `bnb chain`, `bsc testnet`,
  `bnb testnet`, `opbnb`.
- `recoilpay-intent-kit/packages/core/src/intent/registry.ts`: same additions
  (this is the published SDK — it needs a changeset and a release).
- `recoilpay-intent-kit/packages/core/src/chains.ts`: `CHAIN_NAMES` already has
  `56: 'BNB Chain'`; add `97`, `204`, `5611`, and the matching `EXPLORERS`
  entries (`https://testnet.bscscan.com`, `https://opbnbscan.com`).
- `recoil-website-v2/src/wallet/chains.ts`: already imports `bsc` from
  `wagmi/chains`; add `bscTestnet` and `opBNB` as needed.

Note the executable set is auto-discovered from the aggregator's
`/api/v1/solvers` via `getSupportedAssets()`, so no other frontend change is
needed — BSC lights up automatically once solvers advertise it.

## Step 7 — Documentation

- `recoil-core/docs-site/docs/supported-networks.md` — add BSC testnet with
  chain ID, RPC, explorer, faucet, token addresses and **decimals**.
- `docs-site/docs/integrate/intents.md` — add BSC to the chain-prefix table using
  the 1-byte vectors above, and correct the "USDC has 6 decimals" statement to be
  per-chain.
- `docs-site/docs/integrate/api-reference.md` and `quickstart.md` — same decimals
  correction.
- `docs-site/docs/writing-intents.md` — add BNB Chain to the recognised chain
  names table.

## Step 8 — End-to-end verification

The milestone is a real settlement, not a green test suite:

1. `GET /api/v1/chains` returns chain 97 with the right settlers and oracle.
2. `GET /api/v1/solvers` lists BSC testnet assets from an active solver.
3. `POST /api/v1/quotes` for USDC BSC testnet → USDC Base Sepolia returns at
   least one quote. If it returns `quotes: []`, check `metadata.solversQueried`
   — `0` means routes or asset config are wrong, not the encoder.
4. Sign and submit through the app; poll `GET /api/v1/orders/{id}` to `executed`.
5. Record the transaction hash on testnet.bscscan.com — this is the deliverable.

Do the reverse direction too (Base Sepolia → BSC testnet); routes are
directional in config and it is easy to add only one way.

---

## Out of scope for this task — do not start these

- **opBNB (204)** — same pattern, do it after BSC testnet works end to end.
- **BSC mainnet (56)** — the current `AlwaysYesOracle` attests everything and is
  testnet-only, so mainnet must use the Hyperlane attestation path. Note that
  OIF has ALREADY deployed a `HyperlaneOracle` on BSC mainnet (address above),
  so this is largely a solver configuration change — switch
  `settlement.type` to `hyperlane` and point it at the deployed mailbox, IGP
  and oracle. See `solver/config/example-hyperlane.json` for the config shape.
  Still a separate task: do it only after testnet settles end to end.
- Native BNB as an input asset — the ERC-20 escrow path only, as with every
  existing chain.

## Working agreement

- Work incrementally and keep the repo green: run `cargo check`, `cargo test`
  and the frontend test suites after each step.
- Do not commit secrets. Deployer and solver keys come from the environment.
- If the `oif-contracts` repo path is unknown, ask rather than guessing.
- If something contradicts this document, trust the code and tell the user —
  these notes were verified on 2026-10-01 and may drift.
