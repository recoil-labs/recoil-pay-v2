import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { arbitrum, base, mainnet, optimism, polygon } from 'wagmi/chains';

/**
 * EVM only. Signing needs no gas and no particular chain, but the API
 * verifies smart-wallet signatures on the chain they were made on, so the
 * list matches the API's (api/src/chain.ts).
 */
const projectId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) || 'dev-fallback-projectid-please-replace';

export const SUPPORTED_CHAIN_IDS: ReadonlySet<number> = new Set([mainnet.id, base.id, arbitrum.id, optimism.id, polygon.id]);

export const wagmiConfig = getDefaultConfig({
  appName: 'RecoilPay Tags',
  appDescription: 'Reserve your RecoilPay tag',
  appUrl: 'https://tags.recoilpay.com',
  projectId,
  wallets: [
    {
      groupName: 'Recommended',
      wallets: [metaMaskWallet, coinbaseWallet, rainbowWallet, trustWallet, walletConnectWallet, injectedWallet],
    },
  ],
  chains: [mainnet, base, arbitrum, optimism, polygon],
  ssr: false,
});
