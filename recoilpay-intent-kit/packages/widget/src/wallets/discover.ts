import type { EIP1193Provider } from 'viem';

export interface DiscoveredWallet {
  /** Reverse-DNS id from EIP-6963 (e.g. io.metamask), or `injected`. */
  id: string;
  name: string;
  /** Data URI supplied by the wallet itself; only ever used as an <img src>. */
  icon: string;
  provider: EIP1193Provider;
}

interface AnnounceEvent extends Event {
  detail: { info: { uuid: string; name: string; icon: string; rdns: string }; provider: EIP1193Provider };
}

/** How long to wait for EIP-6963 announcements before offering window.ethereum. */
const LEGACY_FALLBACK_MS = 400;

/**
 * Finds the browser wallets installed on this page. Modern wallets announce
 * themselves (EIP-6963), which lets several coexist; older ones only set
 * `window.ethereum`, which is offered when nothing announces.
 */
export function discoverWallets(onChange: (wallets: DiscoveredWallet[]) => void): () => void {
  const found = new Map<string, DiscoveredWallet>();
  const emit = () => onChange([...found.values()]);

  const onAnnounce = (event: Event) => {
    const { info, provider } = (event as AnnounceEvent).detail ?? {};
    if (!info?.rdns || !provider) return;
    found.delete('injected');
    found.set(info.rdns, { id: info.rdns, name: info.name, icon: safeIcon(info.icon), provider });
    emit();
  };

  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  const legacy = setTimeout(() => {
    const eth = (window as { ethereum?: EIP1193Provider & { isMetaMask?: boolean; isCoinbaseWallet?: boolean } }).ethereum;
    if (found.size === 0 && eth) {
      const name = eth.isMetaMask ? 'MetaMask' : eth.isCoinbaseWallet ? 'Coinbase Wallet' : 'Browser wallet';
      found.set('injected', { id: 'injected', name, icon: '', provider: eth });
      emit();
    }
  }, LEGACY_FALLBACK_MS);

  return () => {
    clearTimeout(legacy);
    window.removeEventListener('eip6963:announceProvider', onAnnounce);
  };
}

/** Wallet icons must be data: images (EIP-6963); anything else is dropped. */
function safeIcon(icon: string): string {
  return /^data:image\/(svg\+xml|png|jpeg|webp|gif)[;,]/i.test(icon) ? icon : '';
}
