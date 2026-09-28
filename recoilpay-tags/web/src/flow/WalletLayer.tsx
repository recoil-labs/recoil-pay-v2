import '@rainbow-me/rainbowkit/styles.css';
import { darkTheme, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from '../lib/wallet.ts';

/**
 * Everything wallet-shaped, split out of the first paint: the hero only
 * needs the claim field. App prefetches this chunk when the browser is idle,
 * so the card still opens instantly.
 */
const queryClient = new QueryClient();

// The wallet modal in the page's own terms: flat, hairline, accent, no blur.
const theme = darkTheme({ accentColor: '#9184d9', accentColorForeground: '#161826', borderRadius: 'small', overlayBlur: 'none' });
theme.colors.modalBackground = '#1c1e2e';
theme.colors.modalBorder = '#2a2c3d';
theme.colors.modalBackdrop = 'rgba(22, 24, 38, 0.85)';
theme.shadows.dialog = 'none';
theme.fonts.body = '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif';

export default function WalletLayer({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
