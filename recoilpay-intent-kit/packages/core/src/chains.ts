import { createPublicClient, http, type PublicClient } from 'viem';
import type { ChainInfo } from './api';

/** Display names; the aggregator's /chains returns slugs ("polygon-amoy"). */
const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum',
  56: 'BNB Chain',
  43114: 'Avalanche',
  11155111: 'Ethereum Sepolia',
  84532: 'Base Sepolia',
  11155420: 'OP Sepolia',
  421614: 'Arbitrum Sepolia',
  80002: 'Polygon Amoy',
  9000000001: 'Solana',
  9000000002: 'Solana Devnet',
};

/** Block explorers, for "view on explorer" links after a fill. */
const EXPLORERS: Record<number, string> = {
  1: 'https://etherscan.io',
  10: 'https://optimistic.etherscan.io',
  137: 'https://polygonscan.com',
  8453: 'https://basescan.org',
  42161: 'https://arbiscan.io',
  56: 'https://bscscan.com',
  43114: 'https://snowtrace.io',
  11155111: 'https://sepolia.etherscan.io',
  84532: 'https://sepolia.basescan.org',
  11155420: 'https://sepolia-optimism.etherscan.io',
  421614: 'https://sepolia.arbiscan.io',
  80002: 'https://amoy.polygonscan.com',
};

export const SOLANA_CHAIN_IDS: ReadonlySet<number> = new Set([9000000001, 9000000002]);

export function chainName(chainId: number, info?: ChainInfo): string {
  return CHAIN_NAMES[chainId] ?? info?.name ?? `Chain ${chainId}`;
}

export function explorerUrl(chainId: number): string | undefined {
  return EXPLORERS[chainId];
}

/**
 * The read-only chain access the flow needs: Permit2 allowance checks and
 * waiting for the approval transaction. Anything viem-shaped fits.
 */
export type ChainReader = Pick<PublicClient, 'readContract' | 'waitForTransactionReceipt'>;

/** Readers built from the aggregator's own RPC endpoints, cached per chain. */
export function rpcReaders(chains: () => Promise<ChainInfo[]>) {
  const cache = new Map<number, ChainReader>();
  return async (chainId: number): Promise<ChainReader | null> => {
    const hit = cache.get(chainId);
    if (hit) return hit;
    const info = (await chains()).find((c) => c.chain_id === chainId);
    if (!info?.rpc_url) return null;
    const client = createPublicClient({ transport: http(info.rpc_url) }) as unknown as ChainReader;
    cache.set(chainId, client);
    return client;
  };
}
