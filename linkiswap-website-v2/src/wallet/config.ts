import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  phantomWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { CHAINS } from './chains';

/**
 * WalletConnect project id is public (it ships in the client bundle). Get one at
 * https://cloud.reown.com and set VITE_WALLETCONNECT_PROJECT_ID. Without it, the
 * WalletConnect connector is degraded but injected wallets (MetaMask, etc.) still work.
 */
const envProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
const projectId =
  envProjectId && envProjectId !== ''
    ? envProjectId
    : 'dev-fallback-projectid-please-replace';

export const wagmiConfig = getDefaultConfig({
  appName: 'RecoilPay',
  appDescription: "Cross-chain swaps and transfers",
  appUrl: import.meta.env.VITE_APP_URL || "https://recoilpay.com",
  projectId,
  wallets: [
    {
      groupName: "Recommended",
      wallets: [
        metaMaskWallet,
        phantomWallet,
        trustWallet,
        walletConnectWallet,
        coinbaseWallet,
        rainbowWallet,
        injectedWallet,
      ],
    },
  ],
  chains: CHAINS,
  ssr: false,
});
