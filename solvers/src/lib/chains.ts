/* One place that knows what chains exist.
 *
 * Chain names and settlement addresses were previously copied into six
 * separate files — a label map here, a dropdown there, a quick-add list
 * somewhere else. Adding BNB testnet to the aggregator did nothing visible
 * in this dashboard because none of those six knew about it, and nothing
 * failed loudly: an unknown chain just rendered as `eip155:97`.
 *
 * The aggregator already publishes the authoritative list at
 * `/api/v1/chains`, settlement contracts and token decimals included. The
 * registry is the source of truth; the table below is only a fallback for
 * rendering a label before that request lands, and for ids the aggregator
 * does not serve (Solana, mainnets).
 */

import { SolverApiService, type ChainInfoDto } from '../services/solverApi';

/** Labels for chains the registry may not cover, and for first paint. */
const FALLBACK_LABELS: Record<string, string> = {
  'eip155:97': 'BNB Testnet',
  'eip155:80002': 'Polygon Amoy',
  'eip155:84532': 'Base Sepolia',
  'eip155:11155111': 'Ethereum Sepolia',
  'eip155:11155420': 'OP Sepolia',
  'eip155:1': 'Ethereum',
  'eip155:56': 'BNB Chain',
  'eip155:10': 'Optimism',
  'eip155:8453': 'Base',
  'eip155:42161': 'Arbitrum One',
  'eip155:137': 'Polygon',
  'solana:devnet': 'Solana Devnet',
};

/** Turn a registry name like `bsc-testnet` into `Bsc Testnet`. */
function titleCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

let registry: ChainInfoDto[] = [];

/** Load the registry once. Safe to call repeatedly; failures leave the
 *  fallback labels in place rather than breaking the page. */
export async function loadChainRegistry(): Promise<ChainInfoDto[]> {
  if (registry.length > 0) return registry;
  try {
    registry = await SolverApiService.getChains();
  } catch {
    registry = [];
  }
  return registry;
}

export function chainRegistry(): ChainInfoDto[] {
  return registry;
}

/** A readable name for a CAIP-2 id.
 *
 *  Falls through registry → static table → `Chain 97`. Never returns the
 *  raw id, because `eip155:97` in a dropdown is how a chain goes unnoticed. */
export function chainLabel(caip2: string): string {
  const fromRegistry = registry.find((c) => `eip155:${c.chain_id}` === caip2);
  if (fromRegistry) return titleCase(fromRegistry.name);
  if (FALLBACK_LABELS[caip2]) return FALLBACK_LABELS[caip2];
  const numeric = caip2.replace(/^eip155:/, '');
  return /^\d+$/.test(numeric) ? `Chain ${numeric}` : caip2;
}

export function chainLabelById(chainId: number | string): string {
  return chainLabel(`eip155:${chainId}`);
}

/** Every chain the aggregator supports, for pickers.
 *
 *  Comes from the registry, so a chain added server-side appears here with
 *  no client change — which is the whole point of this file. */
export function chainOptions(): { caip2: string; chainId: number; label: string }[] {
  if (registry.length > 0) {
    return registry.map((c) => ({
      caip2: `eip155:${c.chain_id}`,
      chainId: c.chain_id,
      label: titleCase(c.name),
    }));
  }
  // Pre-load fallback: the testnets the aggregator ships with.
  return [97, 80002, 84532, 11155111, 11155420].map((id) => ({
    caip2: `eip155:${id}`,
    chainId: id,
    label: chainLabelById(id),
  }));
}

/** The OIF output settler on a chain, for the quick-add buttons. Read from
 *  the registry rather than pasted in, so it cannot drift from what the
 *  aggregator actually expects. */
export function outputSettler(chainId: number): string | null {
  return registry.find((c) => c.chain_id === chainId)?.output_settler ?? null;
}
