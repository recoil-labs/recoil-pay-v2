import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ConnectButton, useConnectModal } from '@rainbow-me/rainbowkit';
import { ChevronDown, TriangleAlert, Wallet, X } from 'lucide-react';
import { useWallet as useSolanaWalletAdapter } from '@solana/wallet-adapter-react';
import { WalletReadyState, type WalletName } from '@solana/wallet-adapter-base';
import { useAccount } from 'wagmi';
import { cn } from '@/lib/utils';
import { useSolanaWallet } from '../wallet/solana';

type Variant = 'desktop' | 'mobile';

const truncateAddress = (addr: string) =>
  `${addr.slice(0, 6)}...${addr.slice(-4)}`;

const isUserRejectedConnection = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('user rejected');
};

const reportSolanaConnectError = (error: unknown) => {
  if (isUserRejectedConnection(error)) return;
  console.error('[LinkiSwap] Solana wallet connection failed:', error);
};

/**
 * Unified WalletButton for LinkiSwap V2.
 * Supports RainbowKit EVM wallets and direct Solana wallet-adapter discovery
 * behind one compact, brand-aligned connect surface.
 */
export default function WalletButton({ variant }: { variant: Variant }) {
  const { t } = useTranslation();
  const reducedMotion = usePrefersReducedMotion();
  const isMobile = variant === 'mobile';
  const walletMenuTitleId = useId();
  const solanaDialogTitleId = useId();

  const wrongNetworkLabel = t('nav.wrongNetwork', 'Wrong network');
  const switchNetworkLabel = t('nav.switchNetwork', 'Wrong network, switch network');
  const unknownNetworkLabel = t('nav.unknownNetwork', 'Unknown');
  const selectNetworkLabel = t('nav.selectWalletNetwork', 'Select network');
  const closeWalletMenuLabel = t('nav.closeWalletMenu', 'Close wallet menu');
  const evmTitleLabel = t('nav.evmWallets', 'Ethereum & EVM');
  const evmWalletLabel = t('nav.evmWalletExamples', 'MetaMask, Trust, Coinbase');
  const solanaNetworkLabel = t('nav.solanaNetwork', 'Solana');
  const disconnectLabel = t('nav.disconnectWallet', 'Disconnect');

  const { isConnected: evmConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const solana = useSolanaWallet();
  const {
    wallets: solanaWallets,
    wallet: selectedSolanaWallet,
    connected: solanaAdapterConnected,
    connecting: solanaAdapterConnecting,
    select: selectSolanaWallet,
    connect: connectSolanaWallet,
  } = useSolanaWalletAdapter();

  const [showMenu, setShowMenu] = useState(false);
  const [activePopup, setActivePopup] = useState<'solana' | null>(null);
  const [pendingSolanaConnect, setPendingSolanaConnect] = useState<WalletName | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const solanaAddress = solana.address;
  const solanaConnected = solana.isConnected && !!solanaAddress;
  const buttonHeightClass = isMobile ? 'h-11' : 'h-[38px]';
  const splitButtonClass = isMobile ? 'min-w-0 flex-[1_1_42%]' : '';

  const installedSolanaWallets = solanaWallets.filter(
    (wallet) =>
      (wallet.readyState === WalletReadyState.Installed ||
        wallet.readyState === WalletReadyState.Loadable) &&
      wallet.adapter.name !== 'MetaMask'
  );
  const solanaWalletsToShow =
    installedSolanaWallets.length > 0
      ? installedSolanaWallets
      : solanaWallets.filter((wallet) => wallet.adapter.name !== 'MetaMask');

  const getWalletMenuPosition = (): CSSProperties => {
    if (!buttonRef.current) {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }

    const rect = buttonRef.current.getBoundingClientRect();
    return {
      top: `${rect.bottom + 10}px`,
      right: `${Math.max(12, window.innerWidth - rect.right)}px`,
    };
  };

  const handleSolanaWalletClick = useCallback(
    (walletName: WalletName) => {
      setShowMenu(false);

      if (selectedSolanaWallet?.adapter.name === walletName) {
        if (!solanaAdapterConnected && !solanaAdapterConnecting) {
          void connectSolanaWallet().catch(reportSolanaConnectError);
        }
        return;
      }

      selectSolanaWallet(walletName);
      setPendingSolanaConnect(walletName);
    },
    [
      connectSolanaWallet,
      selectedSolanaWallet?.adapter.name,
      selectSolanaWallet,
      solanaAdapterConnected,
      solanaAdapterConnecting,
    ]
  );

  useEffect(() => {
    if (!pendingSolanaConnect) return;
    if (selectedSolanaWallet?.adapter.name !== pendingSolanaConnect) return;

    if (solanaAdapterConnected || solanaAdapterConnecting) {
      setPendingSolanaConnect(null);
      return;
    }

    setPendingSolanaConnect(null);
    void connectSolanaWallet().catch(reportSolanaConnectError);
  }, [
    connectSolanaWallet,
    pendingSolanaConnect,
    selectedSolanaWallet?.adapter.name,
    solanaAdapterConnected,
    solanaAdapterConnecting,
  ]);

  useEffect(() => {
    if (!showMenu) return;

    const handler = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowMenu(false);
      }
    };

    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  useEffect(() => {
    if (!showMenu && !activePopup) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowMenu(false);
        setActivePopup(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activePopup, showMenu]);

  if (solanaConnected && solanaAddress) {
    const walletName = selectedSolanaWallet?.adapter.name ?? 'Solana Wallet';

    return (
      <div className={cn('flex items-center gap-2', isMobile && 'w-full flex-wrap')}>
        <div
          className={cn(
            'flex items-center gap-[7px] rounded-xl border border-border-subtle bg-surface-input px-3 font-sans text-[13px] font-medium text-text-secondary',
            buttonHeightClass,
            splitButtonClass
          )}
        >
          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-accent-cyan shadow-[0_0_14px_var(--accent-cyan)]" />
          <span className="truncate">{solanaNetworkLabel}</span>
        </div>

        <button
          type="button"
          onClick={() => setActivePopup('solana')}
          aria-label={t('nav.openSolanaWallet', {
            account: truncateAddress(solanaAddress),
            defaultValue: 'Account {{account}}, open Solana wallet',
          })}
          className={cn(
            'flex min-w-0 cursor-pointer items-center gap-2 rounded-xl border border-border-subtle bg-surface-alt px-3.5 font-sans text-[13px] font-medium text-app-text outline-none transition-colors duration-200 hover:border-border-cyan hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent-cyan/70',
            buttonHeightClass,
            splitButtonClass
          )}
        >
          {selectedSolanaWallet?.adapter.icon ? (
            <img
              src={selectedSolanaWallet.adapter.icon}
              alt=""
              className="h-4 w-4 flex-shrink-0 rounded"
            />
          ) : (
            <Wallet size={15} className="flex-shrink-0 text-accent-cyan" aria-hidden="true" />
          )}
          <span className="min-w-0 truncate font-mono">{truncateAddress(solanaAddress)}</span>
        </button>

        {activePopup === 'solana' &&
          createPortal(
            <div
              className="fixed inset-0 z-[200] flex items-end justify-center bg-[var(--overlay)] p-4 sm:items-center"
              onClick={() => setActivePopup(null)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={solanaDialogTitleId}
                className="glass-panel w-full max-w-sm rounded-[22px] p-5"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {selectedSolanaWallet?.adapter.icon ? (
                      <img
                        src={selectedSolanaWallet.adapter.icon}
                        alt=""
                        className="h-12 w-12 rounded-2xl border border-border-subtle bg-surface-input p-1"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border-cyan bg-accent-cyan-soft text-accent-cyan">
                        <Wallet size={20} aria-hidden="true" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h2
                        id={solanaDialogTitleId}
                        className="truncate font-display text-base font-semibold text-app-text"
                      >
                        {walletName}
                      </h2>
                      <p className="mt-1 font-mono text-xs text-text-muted">
                        {truncateAddress(solanaAddress)}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActivePopup(null)}
                    aria-label={t('nav.closeWalletDetails', 'Close wallet details')}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-input text-text-muted transition-colors duration-200 hover:border-border-cyan hover:text-accent-cyan focus-visible:ring-2 focus-visible:ring-accent-cyan/70"
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    await solana.disconnect();
                    setActivePopup(null);
                  }}
                  className="mt-5 flex w-full items-center justify-center rounded-xl border border-red/30 bg-red-soft px-4 py-2.5 font-sans text-sm font-semibold text-red transition-colors duration-200 hover:border-red/50 hover:bg-red-soft/80 focus-visible:ring-2 focus-visible:ring-red/40"
                >
                  {disconnectLabel}
                </button>
              </div>
            </div>,
            document.body
          )}
      </div>
    );
  }

  if (evmConnected) {
    return (
      <ConnectButton.Custom>
        {({ account, chain, openAccountModal, openChainModal, mounted }) => {
          if (!mounted || !account || !chain) {
            return (
              <div
                className={cn('flex items-center gap-2 opacity-0', isMobile && 'w-full flex-wrap')}
                aria-hidden="true"
              />
            );
          }

          if (chain.unsupported) {
            return (
              <button
                type="button"
                onClick={openChainModal}
                aria-label={switchNetworkLabel}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-xl border border-red/50 bg-red-soft px-3.5 font-sans text-[13px] font-semibold text-red outline-none transition-colors duration-200 hover:border-red/70 focus-visible:ring-2 focus-visible:ring-red/40',
                  buttonHeightClass,
                  isMobile && 'w-full'
                )}
              >
                <TriangleAlert size={15} aria-hidden="true" />
                {wrongNetworkLabel}
              </button>
            );
          }

          return (
            <div className={cn('flex items-center gap-2', isMobile && 'w-full flex-wrap')}>
              <button
                type="button"
                onClick={openChainModal}
                aria-label={t('nav.currentNetwork', {
                  network: chain.name ?? unknownNetworkLabel,
                  defaultValue: 'Switch network, current: {{network}}',
                })}
                className={cn(
                  'flex min-w-0 cursor-pointer items-center gap-[7px] rounded-xl border border-border-subtle bg-surface-input px-3 font-sans text-[13px] font-medium text-text-secondary outline-none transition-colors duration-200 hover:border-border-cyan hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent-cyan/70',
                  buttonHeightClass,
                  splitButtonClass
                )}
              >
                {chain.hasIcon && chain.iconUrl ? (
                  <img
                    alt={chain.name ?? unknownNetworkLabel}
                    src={chain.iconUrl}
                    className="h-4 w-4 flex-shrink-0 rounded-full"
                    style={{
                      background: chain.iconBackground ?? 'transparent',
                    }}
                  />
                ) : (
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{
                      background: chain.iconBackground ?? 'var(--accent-cyan)',
                    }}
                  />
                )}
                <span className="min-w-0 truncate">{chain.name ?? unknownNetworkLabel}</span>
                <ChevronDown size={13} className="flex-shrink-0 text-text-muted" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={openAccountModal}
                aria-label={t('nav.openWallet', {
                  account: account.displayName,
                  defaultValue: 'Account {{account}}, open wallet',
                })}
                className={cn(
                  'flex min-w-0 cursor-pointer items-center gap-2 rounded-xl border border-border-subtle bg-surface-alt px-3.5 font-sans text-[13px] font-medium text-app-text outline-none transition-colors duration-200 hover:border-border-cyan hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent-cyan/70',
                  buttonHeightClass,
                  splitButtonClass
                )}
              >
                <span className="min-w-0 truncate">{account.displayName}</span>
                {!isMobile && account.displayBalance && (
                  <span className="whitespace-nowrap text-text-muted">
                    {account.displayBalance}
                  </span>
                )}
              </button>
            </div>
          );
        }}
      </ConnectButton.Custom>
    );
  }

  return (
    <div className={cn('relative z-[100]', isMobile && 'w-full')}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setShowMenu((open) => !open)}
        aria-haspopup="dialog"
        aria-expanded={showMenu}
        aria-label={t('nav.connectWallet')}
        className={cn(
          'inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-btn-primary-bg bg-btn-primary-bg px-[18px] font-sans text-sm font-semibold text-btn-primary-text outline-none transition-[background,border-color,box-shadow,transform] duration-200 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent-cyan/70',
          buttonHeightClass,
          isMobile && 'w-full',
          !reducedMotion && 'hover:-translate-y-0.5 hover:shadow-[0_0_24px_var(--primary-dim)]'
        )}
      >
        <Wallet size={15} aria-hidden="true" />
        {t('nav.connectWallet')}
      </button>

      {showMenu &&
        createPortal(
          <div>
            <div
              className="fixed inset-0 z-[199] bg-transparent"
              onClick={() => setShowMenu(false)}
              aria-hidden="true"
            />
            <div
              ref={menuRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={walletMenuTitleId}
              className={cn(
                'glass-panel fixed z-[200] flex max-h-[min(72vh,520px)] flex-col gap-2 overflow-y-auto rounded-[22px] p-4',
                isMobile ? 'inset-x-4 bottom-4 w-auto' : 'w-72'
              )}
              style={isMobile ? undefined : getWalletMenuPosition()}
            >
              <div className="flex items-center justify-between border-b border-border-subtle px-2 pb-2 pt-1">
                <span
                  id={walletMenuTitleId}
                  className="font-sans text-sm font-semibold text-app-text"
                >
                  {selectNetworkLabel}
                </span>
                <button
                  type="button"
                  onClick={() => setShowMenu(false)}
                  aria-label={closeWalletMenuLabel}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors duration-200 hover:bg-surface-hover hover:text-accent-cyan focus-visible:ring-2 focus-visible:ring-accent-cyan/70"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>

              <div className="px-2 pt-1 font-sans text-[10px] font-bold uppercase tracking-[0.16em] text-accent-cyan">
                EVM
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowMenu(false);
                  openConnectModal?.();
                }}
                disabled={!openConnectModal}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors duration-200 hover:border-border-subtle hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent-cyan/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border-cyan bg-primary-dim font-mono text-xs font-bold text-accent-cyan">
                  ETH
                </div>
                <div className="min-w-0">
                  <div className="truncate font-sans text-sm font-semibold text-app-text">
                    {evmTitleLabel}
                  </div>
                  <div className="truncate font-sans text-[11px] text-text-muted">
                    {evmWalletLabel}
                  </div>
                </div>
              </button>

              {solanaWalletsToShow.length > 0 && (
                <>
                  <div className="border-t border-border-subtle px-2 pt-3 font-sans text-[10px] font-bold uppercase tracking-[0.16em] text-accent-cyan">
                    {solanaNetworkLabel}
                  </div>
                  {solanaWalletsToShow.map((wallet) => {
                    const displayName =
                      wallet.adapter.name === 'MetaMask Connect'
                        ? 'MetaMask'
                        : wallet.adapter.name;

                    return (
                      <button
                        key={wallet.adapter.name}
                        type="button"
                        onClick={() => handleSolanaWalletClick(wallet.adapter.name)}
                        aria-label={t('nav.connectWithWallet', {
                          wallet: displayName,
                          defaultValue: 'Connect with {{wallet}}',
                        })}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors duration-200 hover:border-border-subtle hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent-cyan/70"
                      >
                        <img
                          src={wallet.adapter.icon}
                          alt=""
                          className="h-8 w-8 flex-shrink-0 rounded-lg"
                        />
                        <div className="min-w-0">
                          <div className="truncate font-sans text-sm font-semibold text-app-text">
                            {displayName}
                          </div>
                          <div className="truncate font-sans text-[11px] text-text-muted">
                            {solanaNetworkLabel}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
