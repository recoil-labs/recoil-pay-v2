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
/**
 * RecoilPay's WalletConnect (Reown) project — the same public id recoilpay.com
 * ships (linkiswap-website-v2/cloudbuild.yaml). It must list this site's
 * origins in the Reown dashboard's domain allowlist, or WalletConnect refuses
 * to relay. VITE_WALLETCONNECT_PROJECT_ID overrides it.
 */
const RECOILPAY_WC_PROJECT_ID = 'e0a1b3a2a85284ebdca25f4bbdab1efe';
const projectId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) || RECOILPAY_WC_PROJECT_ID;

export const SUPPORTED_CHAIN_IDS: ReadonlySet<number> = new Set([mainnet.id, base.id, arbitrum.id, optimism.id, polygon.id]);

export const wagmiConfig = getDefaultConfig({
  appName: 'RecoilPay Tags',
  appDescription: 'Reserve your RecoilPay tag',
  // Wallets show this to the user; WalletConnect warns when it isn't the real origin.
  appUrl: window.location.origin,
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
