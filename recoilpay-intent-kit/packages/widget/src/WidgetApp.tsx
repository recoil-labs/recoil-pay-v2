import { RecoilIntent, type IntentExample, type RecoilTheme } from '@recoilpay/intent-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Address, EIP1193Provider } from 'viem';
import { discoverWallets, type DiscoveredWallet } from './wallets/discover';
import { providerWallet, requestAccount } from './wallets/providerWallet';
import { connectWalletConnect, walletConnectProvider } from './wallets/walletconnect';

export interface WidgetConfig {
  apiUrl?: string;
  /** The partner's own Hugging Face token for plain-English parsing. Without it, parsing is off. */
  hfAccessToken: string | null;
  /** The partner's own WalletConnect project id. Without it, only browser wallets are offered. */
  walletConnectProjectId?: string;
  theme: RecoilTheme;
  placeholder?: string;
  examples?: IntentExample[] | false;
  /** A wallet the host page already connected. Replaces the picker entirely. */
  hostProvider?: EIP1193Provider | null;
}

type Emit = (name: string, detail: unknown) => void;

interface Connection {
  provider: EIP1193Provider;
  address: Address;
  /** EIP-6963 rdns, `walletconnect`, `injected` or `host`. */
  source: string;
}

const REMEMBER_KEY = 'recoilpay-intent:wallet';
const remember = (source: string | null) => {
  try {
    if (source) localStorage.setItem(REMEMBER_KEY, source);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // Storage blocked (private mode, sandboxed iframe): reconnect by hand next time.
  }
};
const remembered = () => {
  try {
    return localStorage.getItem(REMEMBER_KEY);
  } catch {
    return null;
  }
};

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const message = (e: unknown) => (e instanceof Error ? e.message : 'Could not connect.');
// WalletConnect reports its QR modal being closed as "Connection request reset".
const rejected = (e: unknown) => /reject|denied|cancel|closed|reset/i.test(message(e)) || (e as { code?: number })?.code === 4001;

export function WidgetApp({ config, emit }: { config: WidgetConfig; emit: Emit }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const host = config.hostProvider ?? null;
  const projectId = config.walletConnectProjectId?.trim() || undefined;

  const connect = useCallback(
    (provider: EIP1193Provider, address: Address | null, source: string) => {
      if (!address) return;
      setConnection({ provider, address, source });
      if (source !== 'host') remember(source);
      emit('recoilpay-wallet', { address });
    },
    [emit],
  );

  const disconnect = useCallback(async () => {
    const current = connection;
    setConnection(null);
    remember(null);
    emit('recoilpay-wallet', { address: null });
    // Only a WalletConnect session can really be ended from here; extensions
    // stay authorised until the user revokes them in the wallet.
    if (current?.source === 'walletconnect') await (current.provider as unknown as { disconnect(): Promise<void> }).disconnect().catch(() => {});
  }, [connection, emit]);

  // Find installed wallets (not needed when the host supplies one).
  useEffect(() => (host ? undefined : discoverWallets(setWallets)), [host]);

  // Quietly restore the last connection: `eth_accounts` never prompts.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || connection) return;
    if (host) {
      restored.current = true;
      requestAccount(host, false).then((a) => connect(host, a, 'host'), () => {});
      return;
    }
    const last = remembered();
    if (!last) return;
    if (last === 'walletconnect' && projectId) {
      restored.current = true;
      walletConnectProvider(projectId).then(
        (p) => p.session && connect(p, p.accounts[0] as Address, 'walletconnect'),
        () => {},
      );
      return;
    }
    const wallet = wallets.find((w) => w.id === last);
    if (wallet) {
      restored.current = true;
      requestAccount(wallet.provider, false).then((a) => connect(wallet.provider, a, wallet.id), () => {});
    }
  }, [host, projectId, wallets, connection, connect]);

  // Follow account switches and disconnects made inside the wallet.
  useEffect(() => {
    if (!connection) return;
    const p = connection.provider as EIP1193Provider & { removeListener?: (e: string, f: (...a: any[]) => void) => void };
    const onAccounts = (accounts: string[]) =>
      accounts?.[0] ? connect(p, accounts[0] as Address, connection.source) : void disconnect();
    const onDisconnect = () => void disconnect();
    p.on?.('accountsChanged', onAccounts as never);
    p.on?.('disconnect', onDisconnect as never);
    return () => {
      p.removeListener?.('accountsChanged', onAccounts);
      p.removeListener?.('disconnect', onDisconnect);
    };
  }, [connection, connect, disconnect]);

  const choose = async (source: string, getProvider: () => Promise<EIP1193Provider>) => {
    setError(null);
    setConnecting(source);
    try {
      const provider = await getProvider();
      const address =
        source === 'walletconnect'
          ? ((provider as unknown as { accounts: string[] }).accounts[0] as Address)
          : await requestAccount(provider, true);
      connect(provider, address, source);
      setPickerOpen(false);
    } catch (e) {
      if (!rejected(e)) {
        setError(message(e));
        setPickerOpen(true); // WalletConnect closed it to make room for its QR modal
      }
    } finally {
      setConnecting(null);
    }
  };

  const onConnectWallet = () => {
    if (host) return void choose('host', async () => host);
    setError(null);
    setPickerOpen(true);
  };

  const intentWallet = useMemo(() => (connection ? providerWallet(connection.provider, connection.address) : null), [connection]);

  const mode = config.theme.mode ?? 'dark';
  const vars: Record<string, string> = {};
  if (config.theme.accent) vars['--rp-accent'] = config.theme.accent;
  if (config.theme.accentText) vars['--rp-accent-text'] = config.theme.accentText;
  if (config.theme.radius !== undefined) vars['--rp-radius'] = `${config.theme.radius}px`;

  return (
    <div className="rpw" data-mode={mode} style={vars}>
      <RecoilIntent
        apiUrl={config.apiUrl}
        hfAccessToken={config.hfAccessToken}
        wallet={intentWallet}
        onConnectWallet={onConnectWallet}
        theme={config.theme}
        placeholder={config.placeholder}
        examples={config.examples}
        onOrderSubmitted={(orderId) => emit('recoilpay-order-submitted', { orderId })}
        onComplete={(state) => emit('recoilpay-complete', { orderId: state.orderId, status: state.status, explorerUrl: state.explorerUrl })}
        onError={(msg) => emit('recoilpay-error', { message: msg })}
      />

      <div className="rpw-account">
        {connection ? (
          <>
            <span className="rpw-dot" aria-hidden="true" />
            <span className="rpw-address">{shortAddr(connection.address)}</span>
            {connection.source !== 'host' && (
              <button type="button" className="rpw-text-button" onClick={() => void disconnect()}>
                Disconnect
              </button>
            )}
          </>
        ) : (
          <button type="button" className="rpw-text-button" onClick={onConnectWallet}>
            Connect wallet
          </button>
        )}
      </div>

      {pickerOpen && (
        <WalletPicker
          wallets={wallets}
          walletConnect={Boolean(projectId)}
          connecting={connecting}
          error={error}
          onPick={(w) => void choose(w.id, async () => w.provider)}
          onWalletConnect={() => {
            // The QR modal renders over the page; get ours out of its way.
            setPickerOpen(false);
            void choose('walletconnect', () => connectWalletConnect(projectId!) as Promise<EIP1193Provider>).then(() => {});
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function WalletPicker(p: {
  wallets: DiscoveredWallet[];
  walletConnect: boolean;
  connecting: string | null;
  error: string | null;
  onPick: (w: DiscoveredWallet) => void;
  onWalletConnect: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p.onClose]);

  const nothing = p.wallets.length === 0 && !p.walletConnect;

  return (
    <div className="rpw-backdrop" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div ref={dialog} className="rpw-picker" role="dialog" aria-modal="true" aria-label="Connect a wallet" tabIndex={-1}>
        <div className="rpw-picker-head">
          <span>Connect a wallet</span>
          <button type="button" className="rpw-close" aria-label="Close" onClick={p.onClose}>
            ×
          </button>
        </div>
        <ul className="rpw-wallets">
          {p.wallets.map((w) => (
            <li key={w.id}>
              <button type="button" onClick={() => p.onPick(w)} disabled={Boolean(p.connecting)}>
                {w.icon ? <img src={w.icon} alt="" width={28} height={28} /> : <span className="rpw-icon-fallback" aria-hidden="true" />}
                <span>{w.name}</span>
                {p.connecting === w.id && <span className="rpw-status">Check your wallet…</span>}
              </button>
            </li>
          ))}
          {p.walletConnect && (
            <li>
              <button type="button" onClick={p.onWalletConnect} disabled={Boolean(p.connecting)}>
                <span className="rpw-icon-fallback rpw-icon-wc" aria-hidden="true" />
                <span>WalletConnect</span>
                <span className="rpw-status">Mobile wallets</span>
              </button>
            </li>
          )}
        </ul>
        {nothing && (
          <p className="rpw-empty">
            No wallet found in this browser. Install one such as{' '}
            <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">
              MetaMask
            </a>
            , then reload.
          </p>
        )}
        {p.error && <p className="rpw-error">{p.error}</p>}
      </div>
    </div>
  );
}
