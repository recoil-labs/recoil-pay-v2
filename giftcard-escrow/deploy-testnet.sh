#!/usr/bin/env bash
#
# Deploys GiftCardEscrow + MerchantBond to Base Sepolia and OP Sepolia, then
# prints the exact Rust snippet to paste into the chain registry.
#
# The key is read from the environment and never appears in a command line,
# so it stays out of your shell history. Same arrangement as the fill-wallet
# funding script.
#
# Usage:
#   export DEPLOY_PRIVATE_KEY=0x...        # a key you control; NOT a public
#                                          # test-mnemonic account
#   ./deploy-testnet.sh
#
# Optional:
#   ATTESTOR_ADDRESS=0x...   defaults to the deployer's own address.
#                            Fine on testnet. On mainnet make it a separate
#                            key: the deploy key lives on a laptop, the
#                            attestor has to live on the server.

set -euo pipefail

cd "$(dirname "$0")"

if [[ -z "${DEPLOY_PRIVATE_KEY:-}" ]]; then
    echo "DEPLOY_PRIVATE_KEY is not set." >&2
    echo >&2
    echo "  export DEPLOY_PRIVATE_KEY=0x<your testnet key>" >&2
    echo "  ./deploy-testnet.sh" >&2
    exit 1
fi

DEPLOYER=$(cast wallet address --private-key "$DEPLOY_PRIVATE_KEY")

# Account #0 of the standard test mnemonic. Its private key is in every
# Ethereum tutorial, so an attestor set to it could be used by anyone to
# release any escrow and slash any merchant's bond. Deploying with it would
# leave the contracts live and the security model void.
WELL_KNOWN="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
if [[ "${DEPLOYER,,}" == "${WELL_KNOWN,,}" ]]; then
    echo "Refusing to deploy: that is the public Anvil/Hardhat test account." >&2
    echo "Its private key is public. Use a key only you hold." >&2
    exit 1
fi

export ATTESTOR_ADDRESS="${ATTESTOR_ADDRESS:-$DEPLOYER}"

echo "deployer: $DEPLOYER"
echo "attestor: $ATTESTOR_ADDRESS"
echo

if [[ ! -d lib/forge-std ]]; then
    echo "==> installing forge-std (lib/ is gitignored)"
    forge install foundry-rs/forge-std --no-git
fi

echo "==> running the contract tests first"
forge test

declare -A RPCS=(
    [84532]="https://sepolia.base.org"
    [11155420]="https://sepolia.optimism.io"
)
declare -A NAMES=(
    [84532]="base-sepolia"
    [11155420]="optimism-sepolia"
)

declare -A ESCROWS BONDS

for chain in 84532 11155420; do
    rpc="${RPCS[$chain]}"
    echo
    echo "==> ${NAMES[$chain]} ($chain)"

    balance=$(cast balance "$DEPLOYER" --rpc-url "$rpc")
    if [[ "$balance" == "0" ]]; then
        echo "    no gas on this chain — skipping." >&2
        echo "    fund $DEPLOYER and re-run; already-deployed chains are unaffected." >&2
        continue
    fi

    out=$(forge script script/Deploy.s.sol \
        --rpc-url "$rpc" \
        --private-key "$DEPLOY_PRIVATE_KEY" \
        --broadcast 2>&1)

    # The script logs both addresses; pull them back out rather than making
    # you copy them by eye.
    escrow=$(grep -oE 'GiftCardEscrow: 0x[0-9a-fA-F]{40}' <<<"$out" | tail -1 | awk '{print $2}')
    bond=$(grep -oE 'MerchantBond: +0x[0-9a-fA-F]{40}' <<<"$out" | tail -1 | awk '{print $2}')

    if [[ -z "$escrow" || -z "$bond" ]]; then
        echo "    deploy did not report both addresses. Full output:" >&2
        echo "$out" >&2
        exit 1
    fi

    ESCROWS[$chain]="$escrow"
    BONDS[$chain]="$bond"
    echo "    GiftCardEscrow: $escrow"
    echo "    MerchantBond:   $bond"
done

echo
echo "────────────────────────────────────────────────────────────────"
echo "Paste into crates/config/src/chains.rs, on the matching ChainInfo:"
echo
for chain in 84532 11155420; do
    [[ -n "${ESCROWS[$chain]:-}" ]] || continue
    echo "  // ${NAMES[$chain]} (chain_id: $chain)"
    echo "  giftcard_escrow: \"${ESCROWS[$chain]}\".into(),"
    echo "  merchant_bond:   \"${BONDS[$chain]}\".into(),"
    echo
done
echo "Then set the attestor key on the aggregator and redeploy it:"
echo
echo "  railway variables --set \"GIFTCARD_ATTESTOR_KEY=\$DEPLOY_PRIVATE_KEY\" \\"
echo "    -s aggregator -p recoilpay -e production"
echo
echo "  cd ../.. && railway up linkiswap-core/aggregator --path-as-root \\"
echo "    -s aggregator -d -w \"Timeyin Gordon's Projects\" -p recoilpay -e production"
echo
echo "The boot log should show 'gift card escrow attestor loaded' and"
echo "'gift card payout worker started'. Paste it back and I'll check it."
