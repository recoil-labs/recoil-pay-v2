import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { wagmiConfig } from './config';
import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
  CoinbaseWalletAdapter,
  LedgerWalletAdapter,
  MathWalletAdapter,
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  TokenPocketWalletAdapter,
  TrustWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';
import { SOLANA_NETWORKS, SOLANA_DEVNET_CHAIN_ID } from '../lib/solanaChain';
import { useTheme } from '../components/ThemeProvider';

const queryClient = new QueryClient();

/** Wraps the app in wagmi + react-query + RainbowKit providers, and Solana providers. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const { theme: appTheme } = useTheme();

  const rainbowTheme = useMemo(
    () =>
      appTheme === 'dark'
        ? darkTheme({
            accentColor: '#424AF6',
            accentColorForeground: '#effcff',
            borderRadius: 'large',
            overlayBlur: 'small',
          })
        : lightTheme({
            accentColor: '#424AF6',
            accentColorForeground: '#ffffff',
            borderRadius: 'large',
            overlayBlur: 'small',
          }),
    [appTheme]
  );

  // Use Devnet for now based on Phase 1 goals.
  const endpoint = SOLANA_NETWORKS[SOLANA_DEVNET_CHAIN_ID].rpcUrl;
  const wallets = useMemo(
    () => [
      // Wallets that still need an explicit adapter. Backpack and other
      // Wallet Standard wallets are NOT listed on purpose: wallet-adapter
      // discovers anything that registers itself, so naming them here
      // would produce a duplicate entry in the picker.
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new TrustWalletAdapter(),
      new CoinbaseWalletAdapter(),
      new LedgerWalletAdapter(),
      new MathWalletAdapter(),
      new TokenPocketWalletAdapter(),
    ],
    []
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectionProvider endpoint={endpoint}>
          <SolanaWalletProvider wallets={wallets} autoConnect={false}>
            <WalletModalProvider>
              <RainbowKitProvider theme={rainbowTheme} modalSize="compact">
                {children}
              </RainbowKitProvider>
            </WalletModalProvider>
          </SolanaWalletProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

