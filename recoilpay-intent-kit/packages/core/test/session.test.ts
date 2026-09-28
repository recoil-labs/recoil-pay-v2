import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { createIntentSession, extractIntents, parseIntent, PERMIT2_ADDRESS, TEMPLATE_HINT, type IntentSession, type IntentState, type RawIntent } from '../src';
import { FRIEND, USDC_BASE_SEP, fakeAggregator, fakeReader, fakeWallet, sendSameChain, swapIntent } from './fakes';

async function until(session: IntentSession, pred: (s: IntentState) => boolean, ms = 2000): Promise<IntentState> {
  const start = Date.now();
  while (!pred(session.getState())) {
    if (Date.now() - start > ms) throw new Error(`timed out; phase=${session.getState().phase} error=${session.getState().error}`);
    await new Promise((r) => setTimeout(r, 5));
  }
  return session.getState();
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('parseIntent', () => {
  const parseWith = async (status: number, body: unknown) => {
    const { fetch } = fakeAggregator({ parse: () => ({ status, body }) });
    return parseIntent('whatever', { hfAccessToken: 'hf_test', fetch });
  };

  it('returns intents from a fenced model reply, calling Hugging Face with the token', async () => {
    const { fetch, agg } = fakeAggregator();
    expect(await parseIntent('swap 10 usdc', { hfAccessToken: 'hf_test', fetch })).toEqual({ ok: true, intents: [swapIntent] });
    expect(agg.calls.find((c) => c.path === 'hf')?.body).toMatchObject({ text: 'swap 10 usdc', auth: 'Bearer hf_test', model: 'Qwen/Qwen2.5-Coder-32B-Instruct' });
  });

  it('maps failures to messages a user can read', async () => {
    expect(await parseWith(422, {})).toMatchObject({ ok: false, message: TEMPLATE_HINT });
    expect(await parseWith(429, {})).toMatchObject({ message: expect.stringMatching(/Too many/) });
    expect(await parseWith(500, {})).toMatchObject({ message: expect.stringMatching(/Failed to understand/) });
  });

  it('is off without a token, and never calls Hugging Face', async () => {
    const { fetch, agg } = fakeAggregator();
    expect(await parseIntent('swap 1 usdc', { fetch })).toMatchObject({ ok: false, message: expect.stringMatching(/isn't set up/) });
    expect(await parseIntent('   ', { hfAccessToken: 'hf_test', fetch })).toMatchObject({ ok: false });
    expect(agg.calls.filter((c) => c.path === 'hf')).toHaveLength(0);
  });

  it('reports a network failure without throwing', async () => {
    const fetch = (async () => Promise.reject(new TypeError('offline'))) as never;
    expect(await parseIntent('swap', { hfAccessToken: 'hf_test', fetch })).toMatchObject({ ok: false, message: expect.stringMatching(/Could not reach/) });
  });
});

describe('extractIntents', () => {
  it('reads plain, fenced and prose-wrapped JSON, and rejects the rest', () => {
    const one = '{"action":"swap","amount":5,"tokenIn":"USDC"}';
    expect(extractIntents(one)).toMatchObject({ ok: true, intents: [{ action: 'swap', amount: '5', amountKind: 'token' }] });
    expect(extractIntents('Sure:\n```json\n[' + one + ']\n```')).toMatchObject({ ok: true });
    expect(extractIntents('The intent is ' + one + ' ok')).toMatchObject({ ok: true });
    for (const bad of ['{"error":"unrecognized"}', 'no idea', '[]', '[{"action":"bridge"}]']) {
      expect(extractIntents(bad)).toMatchObject({ ok: false });
    }
  });
});

describe('createIntentSession', () => {
  it('loads the supported set, then waits for a wallet before quoting', async () => {
    const { api, agg } = fakeAggregator();
    const s = createIntentSession({ hfAccessToken: 'hf_test', api });
    await until(s, (st) => st.ready);

    await s.run('swap 10 usdc on base sepolia for usdc on op sepolia');
    expect(s.getState().phase).toBe('needsWallet');
    expect(agg.calls.some((c) => c.path === '/quotes')).toBe(false);

    s.setWallet(fakeWallet());
    const st = await until(s, (x) => x.phase === 'quoted');
    expect(st.preview).toMatchObject({
      action: 'swap',
      payAmount: '10',
      paySymbol: 'USDC',
      srcChainName: 'Base Sepolia',
      receiveAmount: '9.98',
      dstChainName: 'OP Sepolia',
      solverCount: 1,
      solversQueried: 3,
      raceMs: 420,
      etaSeconds: 30,
    });
    s.destroy();
  });

  it('runs the escrow route end to end: approve, re-quote, sign, submit, track', async () => {
    const { api, agg } = fakeAggregator();
    const wallet = fakeWallet();
    const reader = fakeReader(0n); // no Permit2 allowance yet
    const s = createIntentSession({ hfAccessToken: 'hf_test', api, wallet, chainReader: async () => reader as never, pollIntervalMs: 10 });
    await until(s, (st) => st.ready);

    await s.run('swap');
    expect(s.getState()).toMatchObject({ phase: 'quoted', needsApproval: true, route: 'solver' });

    const phases: string[] = [s.getState().phase];
    s.subscribe((st) => phases.at(-1) !== st.phase && phases.push(st.phase));
    await s.confirm();
    const done = await until(s, (st) => st.phase === 'done');

    expect(phases).toEqual(['quoted', 'approving', 'signing', 'submitting', 'tracking', 'done']);

    // Approval: an ERC-20 approve of Permit2 on the input token, then a receipt wait.
    expect(wallet.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 84532, address: getAddress(USDC_BASE_SEP), functionName: 'approve' }),
    );
    expect((wallet.writeContract.mock.calls[0] as any)[0].args[0]).toBe(PERMIT2_ADDRESS);
    expect(reader.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: '0xa99' });

    // It signs the *fresh* quote (q2), not the one shown on the card (q1),
    // with the canonical Permit2 types and the 0x00 escrow prefix.
    const signed = (wallet.signTypedData.mock.calls[0] as any)[0];
    expect(signed.primaryType).toBe('PermitBatchWitnessTransferFrom');
    expect(signed.types).not.toHaveProperty('EIP712Domain');
    const submitted = agg.calls.find((c) => c.method === 'POST' && c.path === '/orders')!.body;
    expect(submitted.quoteResponse.quoteId).toBe('q2');
    expect(submitted.signature.startsWith('0x00')).toBe(true);

    expect(done).toMatchObject({ orderId: 'order-1', status: 'finalized' });
    expect(done.explorerUrl).toBe('https://sepolia-optimism.etherscan.io/tx/0xfeed');
    s.destroy();
  });

  it('skips the approval when Permit2 already has allowance', async () => {
    const { api } = fakeAggregator();
    const wallet = fakeWallet();
    const s = createIntentSession({ hfAccessToken: 'hf_test', api, wallet, chainReader: async () => fakeReader(10n ** 30n) as never, pollIntervalMs: 10 });
    await until(s, (st) => st.ready);
    await s.run('swap');
    expect(s.getState().needsApproval).toBe(false);
    await s.confirm();
    await until(s, (st) => st.phase === 'done');
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });

  it('switches the wallet to the source chain before anything else', async () => {
    const { api } = fakeAggregator();
    const wallet = fakeWallet(1); // on Ethereum mainnet
    const s = createIntentSession({ hfAccessToken: 'hf_test', api, wallet, chainReader: async () => fakeReader(10n ** 30n) as never, pollIntervalMs: 10 });
    await until(s, (st) => st.ready);
    await s.run('swap');
    await s.confirm();
    await until(s, (st) => st.phase === 'done');
    expect(wallet.switchChain).toHaveBeenCalledWith(84532);
    expect(wallet.switchChain.mock.invocationCallOrder[0]).toBeLessThan(wallet.signTypedData.mock.invocationCallOrder[0]);
  });

  it('sends same-chain transfers straight from the wallet, without solvers', async () => {
    const { api, agg } = fakeAggregator({ parse: () => ({ status: 200, body: { intents: [sendSameChain] } }) });
    const wallet = fakeWallet();
    const s = createIntentSession({ hfAccessToken: 'hf_test', api, wallet });
    await until(s, (st) => st.ready);
    await s.run('send 2.5 usdc on base sepolia to friend');
    expect(s.getState()).toMatchObject({ phase: 'quoted', route: 'direct', preview: { payAmount: '2.5', recipient: getAddress(FRIEND) } });

    await s.confirm();
    const done = s.getState();
    expect(done).toMatchObject({ phase: 'done', orderId: '0xa99', status: 'finalized' });
    expect(wallet.writeContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'transfer', args: [expect.any(String), 2_500_000n] }));
    expect(done.explorerUrl).toBe('https://sepolia.basescan.org/tx/0xa99');
    expect(agg.calls.some((c) => c.path === '/quotes')).toBe(false);
  });

  it('reports every validation issue at once', async () => {
    const bad: RawIntent = { ...swapIntent, amount: null, chainOut: 'narnia', tokenIn: 'DOGE' };
    const { api } = fakeAggregator({ parse: () => ({ status: 200, body: { intents: [bad] } }) });
    const s = createIntentSession({ hfAccessToken: 'hf_test', api, wallet: fakeWallet() });
    await until(s, (st) => st.ready);
    await s.run('...');
    const st = s.getState();
    expect(st.phase).toBe('invalid');
    expect(st.issues.map((i) => i.field).sort()).toEqual(['amount', 'chainOut', 'tokenIn']);
  });

  it('shows the hint when the text is not an intent', async () => {
    const { api } = fakeAggregator({ parse: () => ({ status: 422, body: { error: 'UNRECOGNIZED_INTENT' } }) });
    const s = createIntentSession({ hfAccessToken: 'hf_test', api });
    await until(s, (st) => st.ready);
    await s.run('write me a poem');
    expect(s.getState()).toMatchObject({ phase: 'offTemplate', hint: TEMPLATE_HINT });
  });

  it('drops a slow quote that lands after reset', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { api } = fakeAggregator();
    const slowApi = { ...api, getQuotes: async (req: any) => (await gate, api.getQuotes(req)) };
    const s = createIntentSession({ hfAccessToken: 'hf_test', api: slowApi, wallet: fakeWallet() });
    await until(s, (st) => st.ready);

    const running = s.run('swap');
    await until(s, (st) => st.phase === 'quoting');
    s.reset();
    release();
    await running;
    expect(s.getState()).toMatchObject({ phase: 'idle', quote: null, preview: null });
  });

  it('works through a multi-intent sentence one intent at a time', async () => {
    const { api } = fakeAggregator({ parse: () => ({ status: 200, body: { intents: [sendSameChain, { ...sendSameChain, amount: '1' }] } }) });
    const wallet = fakeWallet();
    const s = createIntentSession({ hfAccessToken: 'hf_test', api, wallet });
    await until(s, (st) => st.ready);
    await s.run('send 2.5 then send 1');
    expect(s.getState()).toMatchObject({ queueIndex: 0, queueTotal: 2, preview: { payAmount: '2.5' } });

    await s.confirm();
    const second = await until(s, (st) => st.queueIndex === 1 && st.phase === 'quoted');
    expect(second.preview?.payAmount).toBe('1');

    await s.confirm();
    expect(s.getState().phase).toBe('done');
    expect(wallet.writeContract).toHaveBeenCalledTimes(2);
  });

  it('parses only once a Hugging Face token is set', async () => {
    const { api, agg } = fakeAggregator();
    const s = createIntentSession({ api, wallet: fakeWallet() });
    await until(s, (st) => st.ready);
    await s.run('swap 10 usdc');
    expect(s.getState()).toMatchObject({ phase: 'offTemplate', hint: expect.stringMatching(/isn't set up/) });
    expect(agg.calls.some((c) => c.path === 'hf')).toBe(false);

    s.setHfAccessToken('hf_later');
    await s.run('swap 10 usdc');
    expect(s.getState().phase).toBe('quoted');
    expect(agg.calls.find((c) => c.path === 'hf')?.body.auth).toBe('Bearer hf_later');
  });

  it('surfaces errors instead of throwing', async () => {
    const { api } = fakeAggregator({ quotes: [[]] });
    const s = createIntentSession({ hfAccessToken: 'hf_test', api, wallet: fakeWallet() });
    await until(s, (st) => st.ready);
    await s.run('swap');
    expect(s.getState()).toMatchObject({ phase: 'error', error: 'No solver returned a quote for this route yet.' });
  });
});
