import type { SolverAsset } from '../oif/types';

/**
 * The registry has two layers (see docs/intent-parser-design.md §2):
 *  - alias layer (static): maps loose user words → canonical token symbol / chain.
 *  - support layer (dynamic): what solvers can actually fill, from the live aggregator.
 *
 * A word can be a token OR a chain depending on slot (e.g. "eth", "sol"); the grammar
 * decides which table to consult by position, so the same word appears in both.
 */

export interface CanonicalChain {
  id: number; // For non-EVM chains like Solana, this is a virtual chain id
  name: string;
}

export const TOKEN_ALIASES: Record<string, string> = {
  usdc: 'USDC',
  usdt: 'USDT',
  tether: 'USDT',
  dai: 'DAI',
  eth: 'ETH',
  ether: 'ETH',
  ethereum: 'ETH',
  weth: 'WETH',
  wbtc: 'WBTC',
  btc: 'WBTC',
  bitcoin: 'WBTC',
  sol: 'SOL',
  solana: 'SOL',
  arb: 'ARB',
  arbitrum: 'ARB',
  op: 'OP',
  optimism: 'OP',
  matic: 'MATIC',
  pol: 'MATIC',
  polygon: 'MATIC',
};

export const CHAIN_ALIASES: Record<string, CanonicalChain> = {
  ethereum: { id: 1, name: 'Ethereum' },
  eth: { id: 1, name: 'Ethereum' },
  mainnet: { id: 1, name: 'Ethereum' },
  base: { id: 8453, name: 'Base' },
  arbitrum: { id: 42161, name: 'Arbitrum' },
  arb: { id: 42161, name: 'Arbitrum' },
  optimism: { id: 10, name: 'Optimism' },
  op: { id: 10, name: 'Optimism' },
  polygon: { id: 137, name: 'Polygon' },
  matic: { id: 137, name: 'Polygon' },
  solana: { id: 9000000002, name: 'Solana Devnet' },
  'sol network': { id: 9000000002, name: 'Solana Devnet' },
  // testnets — the solver settles across these five
  'base sepolia': { id: 84532, name: 'Base Sepolia' },
  'op sepolia': { id: 11155420, name: 'OP Sepolia' },
  'optimism sepolia': { id: 11155420, name: 'OP Sepolia' },
  'arbitrum sepolia': { id: 421614, name: 'Arbitrum Sepolia' },
  'arb sepolia': { id: 421614, name: 'Arbitrum Sepolia' },
  'ethereum sepolia': { id: 11155111, name: 'Ethereum Sepolia' },
  'eth sepolia': { id: 11155111, name: 'Ethereum Sepolia' },
  sepolia: { id: 11155111, name: 'Ethereum Sepolia' },
  'polygon amoy': { id: 80002, name: 'Polygon Amoy' },
  amoy: { id: 80002, name: 'Polygon Amoy' },
};

export function normalizeToken(raw: string | null): string | null {
  if (!raw) return null;
  return TOKEN_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export function normalizeChain(raw: string | null): CanonicalChain | null {
  if (!raw) return null;
  return CHAIN_ALIASES[raw.trim().toLowerCase()] ?? null;
}

// ── Support layer (dynamic, from getSupportedAssets()) ──

export interface SupportedSet {
  chains: Set<number>;
  assets: Map<string, SolverAsset>; // key: `${chainId}:${SYMBOL}`
}

export const EMPTY_SUPPORTED: SupportedSet = { chains: new Set(), assets: new Map() };

export function buildSupportedSet(assets: SolverAsset[]): SupportedSet {
  const chains = new Set<number>();
  const map = new Map<string, SolverAsset>();
  for (const a of assets) {
    chains.add(a.chainId);
    map.set(`${a.chainId}:${a.symbol.toUpperCase()}`, a);
  }
  return { chains, assets: map };
}

export function findAsset(
  set: SupportedSet,
  chainId: number,
  symbol: string,
): SolverAsset | undefined {
  return set.assets.get(`${chainId}:${symbol.toUpperCase()}`);
}
