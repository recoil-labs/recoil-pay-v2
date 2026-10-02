import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { base, baseSepolia, mainnet, optimism, optimismSepolia } from 'wagmi/chains';

/* A merchant's wallet is their identity here: registration is one EIP-191
   signature and the recovered address becomes the operator record. The
   chain list only has to cover the chains payouts settle on — the signature
   itself is chain-agnostic. */

const envProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
const projectId =
  envProjectId && envProjectId !== '' ? envProjectId : 'dev-fallback-projectid-please-replace';

if (import.meta.env.PROD && projectId === 'dev-fallback-projectid-please-replace') {
  // Loud rather than silent: without a real id the injected extensions
  // still work, so this presents as "mobile wallets are broken" instead of
  // as a configuration error.
  console.warn(
    '[wallet] VITE_WALLETCONNECT_PROJECT_ID is not set — WalletConnect and every mobile wallet will fail to connect.',
  );
}

export const wagmiConfig = getDefaultConfig({
  appName: 'RecoilPay Gift Cards',
  appDescription: 'Merchant dashboard for the gift card book',
  appUrl: import.meta.env.VITE_APP_URL || 'https://cards.recoilpay.com',
  projectId,
  chains: [base, baseSepolia, optimism, optimismSepolia, mainnet],
  ssr: false,
});
