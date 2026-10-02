import { useEvmWallet } from './evm';
import { useSolanaWallet } from './solana';
import type { WalletAdapter } from './types';

/**
 * Returns the appropriate wallet adapter based on the chain's network type.
 * All hooks are called unconditionally (Rules of Hooks), but only the relevant one is returned.
 */
export function useUnifiedWallet(networkType?: string): WalletAdapter {
  const evm = useEvmWallet();
  const solana = useSolanaWallet();

  switch (networkType) {
    case 'solana':
      return solana as unknown as WalletAdapter;
    default:
      return evm;
  }
}

export type { WalletAdapter };
