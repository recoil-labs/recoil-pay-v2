# Adding testnet chains to the solver (Ethereum Sepolia, Arbitrum Sepolia, Polygon Amoy)

This guide expands the live solver from **OP Sepolia ↔ Base Sepolia (USDC)** to also cover
**Ethereum Sepolia, Arbitrum Sepolia, and Polygon Amoy**. After this, users can swap USDC across
any pair of the 5 chains.

The solver **does not deploy contracts** — `--force-seed` only writes config to Redis. So the only
on-chain work is per-chain, and most of it already exists.

---

## 0. What already exists on-chain (verified — no action)

| Contract | Address (same on every chain) | Eth Sep | Arb Sep | Amoy |
|---|---|:--:|:--:|:--:|
| InputSettlerEscrow | `0x1CC9260E285C2C8AC8D2E7102F3978056Ec1d0a8` | ✅ | ✅ | ✅ |
| OutputSettlerSimple | `0x52602D7cc3D833F5d28ee6D01C7F82C9b2322e10` | ✅ | ✅ | ✅ |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | ✅ | ✅ | ✅ |

These are the canonical OIF deployments. We'll point the new chains at them (OP/Base keep their
existing `0x9EF0…`/`0xBE85…` settlers — settlers are independent per chain, so mixing is fine).

## What you must deploy + fund (per chain)

1. `AlwaysYesOracle` — the oracle the "direct" settlement model checks at finalise (no constructor args).
2. `MockERC20("USD Coin","USDC",6)` — the test USDC, with a public `mint`.
3. Mint USDC to the **solver wallet** (output liquidity) and to **your wallet** (to swap).
4. Send native gas to the **solver wallet** (it pays for fills + finalises).

> **Solver wallet** = the address of `SOLVER_PRIVATE_KEY` (set in the Render dashboard) — the same
> account you already funded on OP/Base Sepolia. It's the `from` of your existing fills on those
> chains. Call it `$SOLVER` below.

---

## 1. Prerequisites

- **Foundry** (`forge`, `cast`) installed.
- A **deployer key** with testnet gas on each chain. Export it (don't paste it into files):
  ```sh
  export PK=0x<your-deployer-private-key>
  export SOLVER=0x632BF0D0d6468908378C3ccfAC4E788B115e0E55   # solver wallet (SOLVER_PRIVATE_KEY acct)
  export ME=0x<your-own-wallet-address>      # the wallet you'll swap from
  ```
  > `$SOLVER` is the live solver's account (from its Render boot logs:
  > `Solver address initialized address=0x632bf0d0…`). It signs fills/finalises on every chain.
- **Faucets** (get native gas for the deployer, and extra to forward to `$SOLVER`):
  - Ethereum Sepolia — https://cloud.google.com/application/web3/faucet/ethereum/sepolia , https://sepoliafaucet.com
  - Arbitrum Sepolia — bridge Sepolia ETH at https://bridge.arbitrum.io , or https://faucet.quicknode.com/arbitrum/sepolia
  - Polygon Amoy (native **POL**) — https://faucet.polygon.technology (select Amoy)

Run all `forge`/`cast` commands from the contracts repo:
```sh
cd /Users/apple/Documents/linkiswap/oif/oif-contracts
```

---

## 2. Deploy + fund — run once per chain

Set the RPC for the chain you're doing, then run the block. Repeat for all three.

```sh
# ── pick ONE chain ──
export RPC=https://ethereum-sepolia-rpc.publicnode.com   # Ethereum Sepolia (11155111)
# export RPC=https://arbitrum-sepolia-rpc.publicnode.com  # Arbitrum Sepolia (421614)
# export RPC=https://polygon-amoy-bor-rpc.publicnode.com  # Polygon Amoy (80002)

# (a) Oracle — note the "Deployed to:" address
forge create test/mocks/AlwaysYesOracle.sol:AlwaysYesOracle \
  --rpc-url $RPC --private-key $PK --broadcast

# (b) Test USDC (6 decimals) — note the "Deployed to:" address
forge create test/mocks/MockERC20.sol:MockERC20 \
  --rpc-url $RPC --private-key $PK --broadcast \
  --constructor-args "USD Coin" "USDC" 6

# capture the USDC address from (b):
export USDC=0x<deployed-usdc-address>

# (c) mint 1,000,000 USDC to the solver (output liquidity)  [1_000_000 * 1e6]
cast send $USDC "mint(address,uint256)" $SOLVER 1000000000000 \
  --rpc-url $RPC --private-key $PK

# (d) mint 1,000 USDC to yourself (to swap)                 [1_000 * 1e6]
cast send $USDC "mint(address,uint256)" $ME 1000000000 \
  --rpc-url $RPC --private-key $PK

# (e) fund the solver with native gas (from the deployer)
cast send $SOLVER --value 0.1ether --rpc-url $RPC --private-key $PK
```

> Polygon Amoy gas is **POL**, not ETH — `--value 0.1ether` just means 0.1 POL there (it's the
> 18-decimal native unit). 0.1 is plenty for testnet.

---

## 3. Paste these 6 addresses back to me

For each chain, the **oracle** (2a) and **USDC** (2b) addresses:

| Chain | AlwaysYesOracle | Test USDC |
|---|---|---|
| Ethereum Sepolia (11155111) | `0x…` | `0x…` |
| Arbitrum Sepolia (421614) | `0x…` | `0x…` |
| Polygon Amoy (80002) | `0x…` | `0x…` |

That's all I need to finish wiring + redeploy.

---

## 4. What I apply once I have the addresses (preview)

**`solver/config/testnet-mine-bootstrap.json`** — add 3 network blocks (canonical settlers) …
```jsonc
{
  "chain_id": 11155111, "name": "ethereum-sepolia", "type": "new",
  "tokens": [{ "symbol": "USDC", "name": "USD Coin", "address": "<USDC_ETH>", "decimals": 6 }],
  "rpc_urls": ["https://ethereum-sepolia-rpc.publicnode.com", "https://1rpc.io/sepolia"],
  "input_settler_address": "0x1CC9260E285C2C8AC8D2E7102F3978056Ec1d0a8",
  "output_settler_address": "0x52602D7cc3D833F5d28ee6D01C7F82C9b2322e10"
}
// + arbitrum-sepolia (421614) and polygon-amoy (80002), same settlers, their own USDC + RPCs
```
… extend `settlement.direct.oracles.input`/`.output` with each chain → its AlwaysYesOracle, and make
`routes` all-to-all across the 5 chains. Then redeploy the solver on Render (manual deploy).

**Frontend (`linkiswap-website-v2`)** — already wired in this guide's companion commit: Polygon Amoy
added to the wallet chains + intent aliases. The parser auto-detects the new chains from the solver's
`/api/v1/assets` once the solver is live, so they "light up" automatically.

---

## Notes / scope

- **USDC only** for now (the proven ERC-20 escrow path). Native-ETH-as-input is a different flow — a
  later add.
- The global 3M claim gas pre-set (the OP-Sepolia fix) already applies to all chains, so the new
  chains won't hit the "intrinsic gas too high" stall.
- Do chains **one at a time** if you like — the config/routes are incremental; a chain only becomes
  swappable once its block + oracle + funded liquidity are all in place.
