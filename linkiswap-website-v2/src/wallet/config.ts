import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  argentWallet,
  backpackWallet,
  binanceWallet,
  bitgetWallet,
  bybitWallet,
  coinbaseWallet,
  imTokenWallet,
  injectedWallet,
  ledgerWallet,
  metaMaskWallet,
  okxWallet,
  phantomWallet,
  rabbyWallet,
  rainbowWallet,
  safeWallet,
  tokenPocketWallet,
  trustWallet,
  uniswapWallet,
  walletConnectWallet,
  zerionWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { CHAINS } from './chains';

/* ── which wallets can connect ────────────────────────────────────────────
   Three mechanisms do the work, and only the first is a list:

   1. The named wallets below, grouped so the common ones lead.
   2. `injectedWallet` plus RainbowKit's EIP-6963 discovery: any EVM
      extension the visitor has installed announces itself and appears on
      its own, even if it is not named here.
   3. `walletConnectWallet`: the WalletConnect registry, which covers
      several hundred mobile wallets — Ledger Live, Safe, Crypto.com,
      MathWallet, MyEtherWallet and the rest of the long tail arrive
      through here rather than through an import.

   So this list is about ordering and recognition, not capability. Adding a
   name makes it appear with its own branding; leaving one out does not
   lock that wallet's users out.

   WalletConnect project id is public (it ships in the client bundle). Get
   one at https://cloud.reown.com and set VITE_WALLETCONNECT_PROJECT_ID.
   WITHOUT A REAL ID, EVERY WALLETCONNECT WALLET FAILS TO CONNECT — the
   injected extensions above keep working, which is why the breakage looks
   like "mobile wallets don't work" rather than an outright error. */

const envProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
const projectId =
  envProjectId && envProjectId !== ''
    ? envProjectId
    : 'dev-fallback-projectid-please-replace';

if (import.meta.env.PROD && projectId === 'dev-fallback-projectid-please-replace') {
  // Loud in the console rather than silent in production: this is the
  // difference between "a few wallets work" and "most wallets work".
  console.warn(
    '[wallet] VITE_WALLETCONNECT_PROJECT_ID is not set — WalletConnect and every mobile wallet will fail to connect.',
  );
}

export const wagmiConfig = getDefaultConfig({
  appName: 'RecoilPay',
  appDescription: 'Cross-chain swaps and transfers',
  appUrl: import.meta.env.VITE_APP_URL || 'https://recoilpay.com',
  projectId,
  wallets: [
    {
      groupName: 'Popular',
      wallets: [
        metaMaskWallet,
        trustWallet,
        phantomWallet,
        coinbaseWallet,
        okxWallet,
        rabbyWallet,
        walletConnectWallet,
      ],
    },
    {
      groupName: 'More wallets',
      wallets: [
        binanceWallet,
        bitgetWallet,
        bybitWallet,
        rainbowWallet,
        zerionWallet,
        uniswapWallet,
        argentWallet,
        imTokenWallet,
        tokenPocketWallet,
        backpackWallet,
        ledgerWallet,
        safeWallet,
        injectedWallet,
      ],
    },
  ],
  chains: CHAINS,
  ssr: false,
});
