#!/usr/bin/env bash
#
# Deploys GiftCardEscrow + MerchantBond to Base Sepolia and OP Sepolia, then
# prints the exact Rust snippet to paste into the chain registry.
#
# The key is read from the environment and never appears in a command line,
# so it stays out of your shell history. Same arrangement as the fill-wallet
# funding script.
#
# Written for bash 3.2, which is what macOS ships. No associative arrays and
# no ${var,,} — both are bash 4 features and fail here with "bad
# substitution", which is a confusing way to find out.
#
# Usage:
#   export DEPLOY_PRIVATE_KEY=0x...        # a key you control; NOT a public
#                                          # test-mnemonic account
#   ./deploy-testnet.sh
#
# Optional:
#   CHAINS=97                only these chain ids, comma separated.
#                            Defaults to every chain below. Use this when
#                            adding a chain — a bare re-run deploys FRESH
#                            contracts everywhere, and the old ones stay in
#                            the registry holding live escrows.
#   ATTESTOR_ADDRESS=0x...   defaults to the deployer's own address.
#                            Fine on testnet. On mainnet make it a separate
#                            key: the deploy key lives on a laptop, the
#                            attestor has to live on the server.

set -euo pipefail

cd "$(dirname "$0")"

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

if [ -z "${DEPLOY_PRIVATE_KEY:-}" ]; then
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
if [ "$(lower "$DEPLOYER")" = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" ]; then
    echo "Refusing to deploy: that is the public Anvil/Hardhat test account." >&2
    echo "Its private key is public. Use a key only you hold." >&2
    exit 1
fi

ATTESTOR_ADDRESS="${ATTESTOR_ADDRESS:-$DEPLOYER}"
export ATTESTOR_ADDRESS

echo "deployer: $DEPLOYER"
echo "attestor: $ATTESTOR_ADDRESS"
echo

if [ ! -d lib/forge-std ]; then
    echo "==> installing forge-std (lib/ is gitignored)"
    forge install foundry-rs/forge-std --no-git
fi

echo "==> running the contract tests first"
forge test

RESULTS=""

WANTED="${CHAINS:-}"

wanted() {
    [ -z "$WANTED" ] && return 0
    case ",$WANTED," in *",$1,"*) return 0 ;; *) return 1 ;; esac
}

# Pick the first RPC in the list that answers. Public endpoints flake —
# one run here died on a DNS lookup for a host that resolved fine a minute
# later — and losing a deploy to that is avoidable.
pick_rpc() {
    for candidate in "$@"; do
        if cast chain-id --rpc-url "$candidate" >/dev/null 2>&1; then
            printf '%s' "$candidate"
            return 0
        fi
    done
    return 1
}

deploy_to() {
    chain_id="$1"
    name="$2"
    shift 2

    if ! wanted "$chain_id"; then
        echo
        echo "==> $name ($chain_id) — not in CHAINS, skipping"
        return 0
    fi

    echo
    echo "==> $name ($chain_id)"

    if ! rpc=$(pick_rpc "$@"); then
        echo "    no RPC answered for this chain — tried: $*" >&2
        echo "    skipping; other chains are unaffected." >&2
        return 0
    fi
    [ "$rpc" = "$1" ] || echo "    using fallback RPC $rpc"

    balance=$(cast balance "$DEPLOYER" --rpc-url "$rpc" 2>/dev/null || echo "0")
    if [ "$balance" = "0" ]; then
        echo "    no gas on this chain — skipping."
        echo "    fund $DEPLOYER here and re-run; deployed chains are unaffected."
        return 0
    fi

    out=$(forge script script/Deploy.s.sol \
        --rpc-url "$rpc" \
        --private-key "$DEPLOY_PRIVATE_KEY" \
        --broadcast 2>&1) || {
        echo "    deploy failed:" >&2
        echo "$out" >&2
        return 1
    }

    # The script logs both addresses; pull them back out rather than making
    # you copy them by eye.
    escrow=$(printf '%s' "$out" | grep -oE 'GiftCardEscrow: 0x[0-9a-fA-F]{40}' | tail -1 | awk '{print $2}')
    bond=$(printf '%s' "$out" | grep -oE 'MerchantBond: +0x[0-9a-fA-F]{40}' | tail -1 | awk '{print $2}')

    if [ -z "$escrow" ] || [ -z "$bond" ]; then
        echo "    deploy did not report both addresses. Full output:" >&2
        echo "$out" >&2
        return 1
    fi

    echo "    GiftCardEscrow: $escrow"
    echo "    MerchantBond:   $bond"

    RESULTS="$RESULTS$name|$chain_id|$escrow|$bond
"
}

deploy_to 84532    "base-sepolia"     "https://sepolia.base.org" "https://base-sepolia-rpc.publicnode.com"
deploy_to 11155420 "optimism-sepolia" "https://sepolia.optimism.io" "https://optimism-sepolia-rpc.publicnode.com"
deploy_to 97       "bsc-testnet"      "https://bsc-testnet-rpc.publicnode.com" "https://data-seed-prebsc-1-s1.binance.org:8545"

if [ -z "$RESULTS" ]; then
    echo >&2
    if [ -n "$WANTED" ]; then
        echo "Nothing deployed — no selected chain had gas. Fund $DEPLOYER and re-run." >&2
    else
        echo "Nothing deployed — no chain had gas. Fund $DEPLOYER and re-run." >&2
    fi
    exit 1
fi

echo
echo "────────────────────────────────────────────────────────────────"
echo "Paste into crates/config/src/chains.rs, on the matching ChainInfo:"
echo
printf '%s' "$RESULTS" | while IFS='|' read -r name chain_id escrow bond; do
    [ -n "$name" ] || continue
    echo "  // $name (chain_id: $chain_id)"
    echo "  giftcard_escrow: \"$escrow\".into(),"
    echo "  merchant_bond:   \"$bond\".into(),"
    echo
done

cat <<'NEXT'
Then set the attestor key on the aggregator and redeploy it:

  railway variables --set "GIFTCARD_ATTESTOR_KEY=$DEPLOY_PRIVATE_KEY" \
    -s aggregator -p recoilpay -e production

  cd ../.. && railway up linkiswap-core/aggregator --path-as-root \
    -s aggregator -d -w "Timeyin Gordon's Projects" -p recoilpay -e production

The boot log should show 'gift card escrow attestor loaded' and
'gift card payout worker started'. Paste it back and I'll check it.
NEXT
