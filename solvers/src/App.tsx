import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { getDefaultConfig, RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { optimismSepolia, baseSepolia, mainnet, sepolia } from 'wagmi/chains';
import '@rainbow-me/rainbowkit/styles.css';
import { router } from './router';
import { ElevationProvider } from './providers/ElevationProvider';
import { useCurrentUser } from './hooks/use-auth';

const envProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
const projectId = envProjectId && envProjectId !== '' ? envProjectId : 'e0a1b3a2a85284ebdca25f4bbdab1efe';

export const wagmiConfig = getDefaultConfig({
  appName: 'RecoilPay Solver Portal',
  appDescription: 'Cross-chain swaps and transfers',
  projectId,
  chains: [optimismSepolia, baseSepolia, mainnet, sepolia],
  ssr: false,
});

const theme = darkTheme({
  accentColor: '#424AF6',
  accentColorForeground: '#ffffff',
  borderRadius: 'large',
  overlayBlur: 'small',
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

function AppContent() {
  const { isLoading } = useCurrentUser();

  if (isLoading && localStorage.getItem('auth_token')) {
    return (
      <div className="min-h-screen bg-[#08122a] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#424af6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <RouterProvider router={router} />;
}

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} modalSize="compact">
          <ElevationProvider>
            <AppContent />
          </ElevationProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
