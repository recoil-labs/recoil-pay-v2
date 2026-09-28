import { fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAggregator } from '../../core/test/fakes';
import '../src/index';
import { isUnknownChainError, providerWallet } from '../src/wallets/providerWallet';

const ACCOUNT = '0x1111111111111111111111111111111111111111';

/** A minimal EIP-1193 wallet that records what it was asked. */
function fakeProvider(opts: { accounts?: string[]; authorised?: boolean } = {}) {
  const listeners = new Map<string, ((...a: unknown[]) => void)[]>();
  const calls: { method: string; params?: unknown }[] = [];
  let authorised = opts.authorised ?? false;
  const provider = {
    calls,
    request: vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
      calls.push({ method, params });
      if (method === 'eth_requestAccounts') return (authorised = true), opts.accounts ?? [ACCOUNT];
      if (method === 'eth_accounts') return authorised ? (opts.accounts ?? [ACCOUNT]) : [];
      if (method === 'eth_chainId') return '0x14a34';
      return null;
    }),
    on: (e: string, f: (...a: unknown[]) => void) => listeners.set(e, [...(listeners.get(e) ?? []), f]),
    removeListener: (e: string, f: (...a: unknown[]) => void) => listeners.set(e, (listeners.get(e) ?? []).filter((x) => x !== f)),
    emit: (e: string, ...a: unknown[]) => listeners.get(e)?.forEach((f) => f(...a)),
  };
  return provider;
}

/** Makes a wallet announce itself the way real extensions do (EIP-6963). */
function announce(name: string, rdns: string, provider: object) {
  const fire = () =>
    window.dispatchEvent(
      Object.assign(new Event('eip6963:announceProvider'), {
        detail: { info: { uuid: rdns, name, rdns, icon: 'data:image/svg+xml;base64,PHN2Zy8+' }, provider },
      }),
    );
  window.addEventListener('eip6963:requestProvider', fire);
  fire();
  return () => window.removeEventListener('eip6963:requestProvider', fire);
}

async function mount(attrs: Record<string, string> = {}, setup?: (el: HTMLElement & { provider?: unknown }) => void) {
  const el = document.createElement('recoilpay-intent') as HTMLElement & { provider?: unknown };
  el.setAttribute('api-url', 'https://agg.test');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  setup?.(el);
  document.body.appendChild(el);
  await waitFor(() => expect(el.shadowRoot?.querySelector('.rp-root')).toBeTruthy());
  const shadow = within(el.shadowRoot as unknown as HTMLElement);
  return { el, shadow };
}

let cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal('fetch', fakeAggregator().fetch);
  localStorage.clear();
});
afterEach(() => {
  document.body.innerHTML = '';
  cleanups.forEach((c) => c());
  cleanups = [];
  vi.unstubAllGlobals();
});

describe('<recoilpay-intent>', () => {
  it('renders into its own shadow root with the component styles', async () => {
    const { el } = await mount();
    const style = el.shadowRoot!.querySelector('style')!;
    expect(style.textContent).toContain('.rp-root');
    expect(style.textContent).toContain('.rpw-picker');
    // Nothing leaks into the page.
    expect(document.head.querySelectorAll('style')).toHaveLength(0);
  });

  it('maps attributes to the theme, and reacts to changes', async () => {
    const { el } = await mount({ mode: 'light', accent: '#ff5500', radius: '4' });
    const root = () => el.shadowRoot!.querySelector('.rp-root') as HTMLElement;
    expect(root().dataset.mode).toBe('light');
    expect(root().style.getPropertyValue('--rp-accent')).toBe('#ff5500');
    expect(root().style.getPropertyValue('--rp-radius')).toBe('4px');

    el.setAttribute('mode', 'dark');
    await waitFor(() => expect(root().dataset.mode).toBe('dark'));
  });

  it('takes examples as a JSON attribute, or hides them', async () => {
    const { shadow, el } = await mount({ examples: JSON.stringify([{ label: 'Tiny swap', sentence: 'swap 1 usdc' }]) });
    await waitFor(() => expect(shadow.getByRole('button', { name: 'Tiny swap' })).toBeTruthy());
    el.setAttribute('examples', 'false');
    await waitFor(() => expect(shadow.queryByRole('button', { name: 'Tiny swap' })).toBeNull());
  });

  it('lists announced wallets, and offers WalletConnect only with a project id', async () => {
    cleanups.push(announce('MetaMask', 'io.metamask', fakeProvider()), announce('Rabby', 'io.rabby', fakeProvider()));
    const { shadow } = await mount();
    fireEvent.click(shadow.getByRole('button', { name: 'Connect wallet' }));
    const dialog = within(await shadow.findByRole('dialog', { name: 'Connect a wallet' }));
    expect(dialog.getByRole('button', { name: /MetaMask/ })).toBeTruthy();
    expect(dialog.getByRole('button', { name: /Rabby/ })).toBeTruthy();
    expect(dialog.queryByRole('button', { name: /WalletConnect/ })).toBeNull();

    document.body.innerHTML = '';
    const again = await mount({ 'walletconnect-project-id': 'partner-project-id' });
    fireEvent.click(again.shadow.getByRole('button', { name: 'Connect wallet' }));
    expect(within(await again.shadow.findByRole('dialog')).getByRole('button', { name: /WalletConnect/ })).toBeTruthy();
  });

  it('says so when no wallet is installed', async () => {
    const { shadow } = await mount();
    fireEvent.click(shadow.getByRole('button', { name: 'Connect wallet' }));
    expect(await shadow.findByText(/No wallet found in this browser/)).toBeTruthy();
  });

  it('connects the chosen wallet and tells the page', async () => {
    const rabby = fakeProvider();
    cleanups.push(announce('MetaMask', 'io.metamask', fakeProvider()), announce('Rabby', 'io.rabby', rabby));
    const { el, shadow } = await mount();
    const onWallet = vi.fn();
    el.addEventListener('recoilpay-wallet', (e) => onWallet((e as CustomEvent).detail));

    fireEvent.click(shadow.getByRole('button', { name: 'Connect wallet' }));
    fireEvent.click(within(await shadow.findByRole('dialog')).getByRole('button', { name: /Rabby/ }));

    expect(await shadow.findByText('0x1111…1111')).toBeTruthy();
    expect(shadow.queryByRole('dialog')).toBeNull();
    expect(rabby.calls.map((c) => c.method)).toContain('eth_requestAccounts');
    expect(onWallet).toHaveBeenCalledWith({ address: ACCOUNT });
    expect(localStorage.getItem('recoilpay-intent:wallet')).toBe('io.rabby');
  });

  it('reconnects a returning visitor without a prompt', async () => {
    localStorage.setItem('recoilpay-intent:wallet', 'io.metamask');
    const metamask = fakeProvider({ authorised: true });
    cleanups.push(announce('MetaMask', 'io.metamask', metamask));
    const { shadow } = await mount();
    expect(await shadow.findByText('0x1111…1111')).toBeTruthy();
    expect(metamask.calls.map((c) => c.method)).toEqual(expect.arrayContaining(['eth_accounts']));
    expect(metamask.calls.map((c) => c.method)).not.toContain('eth_requestAccounts');
  });

  it('follows a disconnect made inside the wallet', async () => {
    localStorage.setItem('recoilpay-intent:wallet', 'io.metamask');
    const metamask = fakeProvider({ authorised: true });
    cleanups.push(announce('MetaMask', 'io.metamask', metamask));
    const { shadow } = await mount();
    await shadow.findByText('0x1111…1111');
    metamask.emit('accountsChanged', []);
    await waitFor(() => expect(shadow.queryByText('0x1111…1111')).toBeNull());
    expect(localStorage.getItem('recoilpay-intent:wallet')).toBeNull();
  });

  it('uses a wallet the host page supplies, with no picker', async () => {
    cleanups.push(announce('MetaMask', 'io.metamask', fakeProvider()));
    const hostWallet = fakeProvider();
    const { shadow } = await mount({}, (el) => (el.provider = hostWallet));

    fireEvent.click(shadow.getByRole('button', { name: 'Connect wallet' }));
    expect(await shadow.findByText('0x1111…1111')).toBeTruthy();
    expect(shadow.queryByRole('dialog')).toBeNull();
    expect(hostWallet.calls.map((c) => c.method)).toContain('eth_requestAccounts');
    // The host owns that connection, so the widget doesn't offer to end it.
    expect(shadow.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });
});

describe('providerWallet', () => {
  it('adds a chain the wallet does not know, then switches to it', async () => {
    const methods: string[] = [];
    let known = false;
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        methods.push(method);
        if (method === 'wallet_switchEthereumChain' && !known) throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
        if (method === 'wallet_addEthereumChain') known = true;
        return null;
      }),
    };
    await providerWallet(provider as never, ACCOUNT).switchChain(84532);
    expect(methods).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
  });

  it('does not try to add chains it has no definition for', async () => {
    const provider = { request: vi.fn(async () => Promise.reject(Object.assign(new Error('nope'), { code: 4902 }))) };
    await expect(providerWallet(provider as never, ACCOUNT).switchChain(999999)).rejects.toThrow();
    expect(provider.request).toHaveBeenCalledTimes(1);
  });

  it('recognises "unknown chain" however the wallet nests it', () => {
    expect(isUnknownChainError({ code: 4902 })).toBe(true);
    expect(isUnknownChainError({ code: -32603, data: { originalError: { code: 4902 } } })).toBe(true);
    expect(isUnknownChainError({ message: 'x', cause: { cause: { code: 4902 } } })).toBe(true);
    expect(isUnknownChainError({ code: 4001, message: 'User rejected the request.' })).toBe(false);
  });
});
