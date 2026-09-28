import type { EIP1193Provider } from 'viem';
import { WIDGET_CHAINS } from './chains';

type WcProvider = EIP1193Provider & {
  accounts: string[];
  session?: unknown;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
};

const providers = new Map<string, Promise<WcProvider>>();

/**
 * WalletConnect, loaded only when someone picks it: the library (and the
 * QR modal it brings) is several times the size of the rest of the widget.
 * One provider per project id — initialising twice makes it misbehave.
 */
export function walletConnectProvider(projectId: string): Promise<WcProvider> {
  let p = providers.get(projectId);
  if (!p) {
    p = import('@walletconnect/ethereum-provider').then(({ EthereumProvider }) =>
      EthereumProvider.init({
        projectId,
        showQrModal: true,
        optionalChains: WIDGET_CHAINS.map((c) => c.id) as [number, ...number[]],
        rpcMap: Object.fromEntries(WIDGET_CHAINS.map((c) => [c.id, c.rpcUrls.default.http[0]])),
        metadata: {
          name: document.title || window.location.hostname,
          description: 'Swaps and sends powered by RecoilPay',
          url: window.location.origin,
          icons: [],
        },
      }) as unknown as Promise<WcProvider>,
    );
    // A failed init (bad project id, offline) shouldn't be cached forever.
    p.catch(() => providers.delete(projectId));
    providers.set(projectId, p);
  }
  return p;
}

/** Opens the QR modal and resolves once a wallet has approved the session. */
export async function connectWalletConnect(projectId: string): Promise<WcProvider> {
  const provider = await walletConnectProvider(projectId);
  if (!provider.session) await provider.connect();
  return provider;
}
