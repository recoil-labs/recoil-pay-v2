import {
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
  bsc,
  avalanche,
  sepolia,
  baseSepolia,
  optimismSepolia,
  arbitrumSepolia,
  polygonAmoy,
  bscTestnet,
} from 'wagmi/chains';

/**
 * Chains the wallet layer can connect to.
 *
 * NOTE: this is the *connectable* set, deliberately broad. What can actually be
 * executed as an intent is a narrower, separate concern — gated at runtime by the
 * OIF support layer (`getSupportedAssets()` from the live aggregator). The parser
 * only treats a chain/token as swappable if the live solver advertises it, so this
 * list can stay broad; unsupported pairs resolve to "not supported yet".
 */
export const CHAINS = [
  // ── Mainnets ──
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
  bsc,
  avalanche,
  // ── Testnets (the solver settles across these) ──
  baseSepolia,
  optimismSepolia,
  arbitrumSepolia,
  sepolia,
  polygonAmoy,
  bscTestnet,
] as const;

/**
 * Chain IDs the solver is configured to settle on testnet. Cosmetic/fallback only —
 * actual execution is gated by the live `getSupportedAssets()` support layer.
 */
export const OIF_LIVE_CHAIN_IDS = [
  baseSepolia.id,
  optimismSepolia.id,
  sepolia.id,
  arbitrumSepolia.id,
  polygonAmoy.id,
  bscTestnet.id,
] as const;

export const isTestnetChain = (chainId: number): boolean =>
  CHAINS.find((c) => c.id === chainId)?.testnet === true;
