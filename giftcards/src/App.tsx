import '@rainbow-me/rainbowkit/styles.css';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { router } from './router';
import { wagmiConfig } from './wallet/config';

const queryClient = new QueryClient();

/* RainbowKit's dark theme, re-pointed at the Recoil tokens so the wallet
   modal does not arrive in its own palette. */
const theme = darkTheme({
  accentColor: '#9184d9',
  accentColorForeground: '#161826',
  borderRadius: 'medium',
  overlayBlur: 'small',
});

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} modalSize="compact">
          <RouterProvider router={router} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
