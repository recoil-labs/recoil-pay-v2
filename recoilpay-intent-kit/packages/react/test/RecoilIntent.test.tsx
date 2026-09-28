import { createIntentSession, type IntentSession } from '@recoilpay/intent-core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeAggregator, fakeReader, fakeWallet, sendSameChain, swapIntent } from '../../core/test/fakes';
import { RecoilIntent } from '../src';

afterEach(cleanup);

function setup(opts: { aggregator?: Parameters<typeof fakeAggregator>[0]; allowance?: bigint } = {}) {
  const { api, agg } = fakeAggregator(opts.aggregator);
  const session: IntentSession = createIntentSession({
    api,
    hfAccessToken: 'hf_test',
    pollIntervalMs: 10,
    chainReader: async () => fakeReader(opts.allowance ?? 10n ** 30n) as never,
  });
  return { session, agg };
}

const type = async (text: string) => {
  const user = userEvent.setup();
  const input = screen.getByRole('textbox', { name: /describe a swap or send/i });
  await user.type(input, text);
  await user.keyboard('{Enter}');
  return user;
};

describe('<RecoilIntent />', () => {
  it('asks for a wallet, then shows the quote once one is connected', async () => {
    const { session } = setup();
    const onConnectWallet = vi.fn();
    const { rerender } = render(<RecoilIntent session={session} wallet={null} onConnectWallet={onConnectWallet} />);

    await waitFor(() => expect(session.getState().ready).toBe(true));
    const user = await type('swap 10 usdc');

    await user.click(await screen.findByRole('button', { name: 'Connect wallet' }));
    expect(onConnectWallet).toHaveBeenCalled();

    rerender(<RecoilIntent session={session} wallet={fakeWallet()} onConnectWallet={onConnectWallet} />);
    expect(await screen.findByText('Best solver route')).toBeTruthy();
    expect(screen.getByText('10 USDC')).toBeTruthy();
    expect(screen.getByText('on Base Sepolia')).toBeTruthy();
    expect(screen.getByText('~9.98 USDC')).toBeTruthy();
    expect(screen.getByText('1 of 3 quoted')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm and sign' })).toBeTruthy();
  });

  it('confirms, tracks to settlement and reports back to the host', async () => {
    const { session } = setup();
    const onOrderSubmitted = vi.fn();
    const onComplete = vi.fn();
    render(<RecoilIntent session={session} wallet={fakeWallet()} onOrderSubmitted={onOrderSubmitted} onComplete={onComplete} />);
    await waitFor(() => expect(session.getState().ready).toBe(true));

    const user = await type('swap 10 usdc');
    await user.click(await screen.findByRole('button', { name: 'Confirm and sign' }));

    expect(await screen.findByText('Settled')).toBeTruthy();
    const link = screen.getByRole('link', { name: /view on explorer/i });
    expect(link.getAttribute('href')).toBe('https://sepolia-optimism.etherscan.io/tx/0xfeed');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(onOrderSubmitted).toHaveBeenCalledWith('order-1');
    expect(onComplete).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'New intent' }));
    expect(session.getState().phase).toBe('idle');
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
  });

  it('warns about the one-time approval before it happens', async () => {
    const { session } = setup({ allowance: 0n });
    render(<RecoilIntent session={session} wallet={fakeWallet()} />);
    await waitFor(() => expect(session.getState().ready).toBe(true));
    await type('swap 10 usdc');
    expect(await screen.findByRole('button', { name: 'Approve USDC and swap' })).toBeTruthy();
    expect(screen.getByText(/one-time approval/)).toBeTruthy();
  });

  it('labels a same-chain send as a direct transfer from the wallet', async () => {
    const { session } = setup({ aggregator: { parse: () => ({ status: 200, body: { intents: [sendSameChain] } }) } });
    render(<RecoilIntent session={session} wallet={fakeWallet()} />);
    await waitFor(() => expect(session.getState().ready).toBe(true));
    const user = await type('send 2.5 usdc');

    expect(await screen.findByText('Direct transfer')).toBeTruthy();
    expect(screen.getByText('Your wallet')).toBeTruthy();
    expect(screen.getByText('0x2222…2222')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Send USDC' }));
    expect(await screen.findByText('Sent')).toBeTruthy();
  });

  it('lists every validation issue', async () => {
    const bad = { ...swapIntent, amount: null, tokenIn: 'DOGE' };
    const { session } = setup({ aggregator: { parse: () => ({ status: 200, body: { intents: [bad] } }) } });
    render(<RecoilIntent session={session} wallet={fakeWallet()} />);
    await waitFor(() => expect(session.getState().ready).toBe(true));
    await type('swap some doge');
    expect(await screen.findByText('Amount is not stated.')).toBeTruthy();
    expect(screen.getByText("Token 'DOGE' isn't recognized.")).toBeTruthy();
  });

  it('runs an example in one click', async () => {
    const { session, agg } = setup();
    render(<RecoilIntent session={session} wallet={fakeWallet()} examples={[{ label: 'Quick swap', sentence: 'swap 1 usdc' }]} />);
    await waitFor(() => expect(session.getState().ready).toBe(true));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Quick swap' }));
    await screen.findByText('Best solver route');
    expect(agg.calls.find((c) => c.path === 'hf')?.body.text).toBe('swap 1 usdc');
  });

  it('reports errors to the host and offers a way out', async () => {
    const { session } = setup({ aggregator: { quotes: [[]] } });
    const onError = vi.fn();
    render(<RecoilIntent session={session} wallet={fakeWallet()} onError={onError} />);
    await waitFor(() => expect(session.getState().ready).toBe(true));
    const user = await type('swap 10 usdc');
    expect(await screen.findByText('No solver returned a quote for this route yet.')).toBeTruthy();
    expect(onError).toHaveBeenCalledWith('No solver returned a quote for this route yet.');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(session.getState().phase).toBe('idle');
  });

  it('applies the theme as CSS variables on its own root only', () => {
    const { session } = setup();
    const { container } = render(<RecoilIntent session={session} theme={{ mode: 'light', accent: '#ff5500', radius: 4, fontFamily: 'Georgia' }} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe('rp-root');
    expect(root.dataset.mode).toBe('light');
    expect(root.style.getPropertyValue('--rp-accent')).toBe('#ff5500');
    expect(root.style.getPropertyValue('--rp-radius')).toBe('4px');
    expect(root.style.getPropertyValue('--rp-font')).toBe('Georgia');
    expect(document.documentElement.style.length).toBe(0);
  });

  it('passes the hfAccessToken prop to the parser', async () => {
    const { api, agg } = fakeAggregator();
    const session = createIntentSession({ api, chainReader: async () => fakeReader(10n ** 30n) as never }); // no token of its own
    render(<RecoilIntent session={session} wallet={fakeWallet()} hfAccessToken="hf_from_prop" />);
    await waitFor(() => expect(session.getState().ready).toBe(true));
    await type('swap 10 usdc');
    await screen.findByText('Best solver route');
    expect(agg.calls.find((c) => c.path === 'hf')?.body.auth).toBe('Bearer hf_from_prop');
  });

  it('keeps the run button disabled until the supported set has loaded', () => {
    const { session } = setup();
    render(<RecoilIntent session={session} defaultValue="swap 1 usdc" />);
    expect((screen.getByRole('button', { name: 'Run intent' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
