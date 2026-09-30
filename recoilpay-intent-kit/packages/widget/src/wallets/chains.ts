import type { Chain } from 'viem';
import { arbitrumSepolia, baseSepolia, optimismSepolia, polygonAmoy, sepolia } from 'viem/chains';

/**
 * Chains the widget can ask a wallet to switch to. Wallets rarely ship with
 * testnets enabled, so these are also what we offer to *add* when a switch
 * fails with "unknown chain". Mainnets join this list when solvers do.
 */
export const WIDGET_CHAINS: readonly Chain[] = [baseSepolia, optimismSepolia, sepolia, polygonAmoy, arbitrumSepolia];

export const chainById = (id: number) => WIDGET_CHAINS.find((c) => c.id === id);
