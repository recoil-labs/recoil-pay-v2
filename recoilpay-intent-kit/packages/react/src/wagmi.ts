import { viemWallet, type IntentWallet } from '@recoilpay/intent-core';
import { useMemo } from 'react';
import { useWalletClient } from 'wagmi';

/**
 * The connected wagmi wallet as an `IntentWallet`, or null when disconnected.
 * Import from `@recoilpay/intent-react/wagmi` so apps without wagmi never
 * load it.
 *
 * ```tsx
 * const wallet = useWagmiIntentWallet();
 * <RecoilIntent wallet={wallet} onConnectWallet={openConnectModal} />
 * ```
 */
export function useWagmiIntentWallet(): IntentWallet | null {
  const { data: walletClient } = useWalletClient();
  return useMemo(() => (walletClient?.account ? viemWallet(walletClient) : null), [walletClient]);
}
