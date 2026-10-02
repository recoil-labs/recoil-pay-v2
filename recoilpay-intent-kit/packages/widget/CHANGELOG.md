# @recoilpay/intent-widget

## 0.2.0

### Minor Changes

- 989d306: Intents can now name BNB Chain: "bsc testnet" or "bnb testnet" for BSC testnet (97), and "bsc", "bnb", "bnb chain", "binance smart chain" or "opbnb" for the mainnets. BSC testnet is swappable as soon as solvers advertise it, and the widget can add it to a wallet. Token decimals vary by chain — USDC on BSC mainnet has 18, not 6 — so convert amounts using the decimals the aggregator returns rather than assuming 6.
