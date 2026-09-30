import { vi } from 'vitest';
import {
  createApiClient,
  HF_ROUTER_URL,
  PERMIT2_ADDRESS,
  type IntentWallet,
  type OrderResponse,
  type Quote,
  type RawIntent,
} from '../src';

/** Shared by the core and React test suites. */

// ── A fake aggregator ──────────────────────────────────────────────────────

export const USER = '0x1111111111111111111111111111111111111111' as const;
export const FRIEND = '0x2222222222222222222222222222222222222222';
export const USDC_BASE_SEP = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
export const USDC_OP_SEP = '0x5fd84259d66cd46123540766be93dfe6d43130d7';

export const ASSETS = [
  { chainId: 84532, address: USDC_BASE_SEP, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  { chainId: 11155420, address: USDC_OP_SEP, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
];

export const swapIntent: RawIntent = {
  action: 'swap',
  amount: '10',
  amountKind: 'token',
  tokenIn: 'USDC',
  chainIn: 'base sepolia',
  tokenOut: 'USDC',
  chainOut: 'op sepolia',
  recipient: null,
};

export const sendSameChain: RawIntent = {
  action: 'send',
  amount: '2.5',
  amountKind: 'token',
  tokenIn: 'USDC',
  chainIn: 'base sepolia',
  tokenOut: null,
  chainOut: null,
  recipient: FRIEND,
};

export function escrowQuote(id: string): Quote {
  return {
    quoteId: id,
    solverId: 'solver-1',
    partialFill: false,
    integrityChecksum: `chk-${id}`,
    eta: 30,
    preview: { inputs: [], outputs: [{ receiver: '0x00', asset: '0x00', amount: '9980000' }] },
    order: {
      type: 'oif-escrow-v0',
      payload: {
        signatureType: 'eip712',
        domain: { name: 'Permit2', chainId: 84532, verifyingContract: PERMIT2_ADDRESS },
        primaryType: 'PermitBatchWitnessTransferFrom',
        message: { nonce: '1' },
        types: {},
      },
    },
  };
}

export interface Aggregator {
  parse: (text: string) => { status: number; body: unknown };
  quotes: Quote[][];
  orders: OrderResponse['status'][];
  calls: { method: string; path: string; body?: any }[];
}

export function fakeAggregator(overrides: Partial<Aggregator> = {}) {
  let quoteCall = 0;
  let orderPoll = 0;
  const agg: Aggregator = {
    parse: () => ({ status: 200, body: { intents: [swapIntent] } }),
    quotes: [[escrowQuote('q1')], [escrowQuote('q2')]],
    orders: ['executing', 'finalized'],
    calls: [],
    ...overrides,
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === HF_ROUTER_URL) {
      const body = JSON.parse(String(init?.body));
      const text = body.messages.find((m: { role: string }) => m.role === 'user').content;
      agg.calls.push({ method: 'POST', path: 'hf', body: { text, model: body.model, auth: (init?.headers as Record<string, string>).Authorization } });
      const r = agg.parse(text);
      if (r.status !== 200 && r.status !== 422) return json(r.status, r.body);
      // What the model replies: the intents as JSON, or its "unrecognized" object.
      const content = r.status === 422 ? '{"error": "unrecognized"}' : '```json\n' + JSON.stringify((r.body as { intents: unknown }).intents) + '\n```';
      return json(200, { choices: [{ message: { role: 'assistant', content } }] });
    }
    const path = String(url).replace('https://agg.test/api/v1', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    agg.calls.push({ method, path, body });

    if (path === '/solvers') {
      return json(200, { totalSolvers: 1, solvers: [{ status: 'active', supportedAssets: { type: 'assets', assets: ASSETS } }] });
    }
    if (path === '/chains') return json(200, { data: [{ chain_id: 84532, name: 'base-sepolia', rpc_url: 'http://rpc' }] });
    if (path === '/quotes') {
      const quotes = agg.quotes[Math.min(quoteCall++, agg.quotes.length - 1)];
      return json(200, { quotes, totalQuotes: quotes.length, metadata: { solversQueried: 3, totalDurationMs: 420 } });
    }
    if (path === '/orders') return json(200, order('order-1', 'created'));
    if (path.startsWith('/orders/')) {
      return json(200, order('order-1', agg.orders[Math.min(orderPoll++, agg.orders.length - 1)], '0xfeed'));
    }
    return json(404, { error: 'NOT_FOUND' });
  });
  return { agg, fetch: fetch as unknown as typeof globalThis.fetch, api: createApiClient({ apiUrl: 'https://agg.test', fetch: fetch as unknown as typeof globalThis.fetch }) };
}

export function order(id: string, status: OrderResponse['status'], fill?: string): OrderResponse {
  return {
    orderId: id,
    status,
    createdAt: '',
    updatedAt: '',
    inputAmounts: [],
    outputAmounts: [],
    orderType: 'oif-escrow-v0',
    settlement: { type: 'escrow', data: null },
    ...(fill ? { fillTransaction: { hash: fill } } : {}),
  };
}

export function fakeWallet(chainId = 84532) {
  let current = chainId;
  const w = {
    address: USER,
    getChainId: vi.fn(async () => current),
    switchChain: vi.fn(async (id: number) => void (current = id)),
    signTypedData: vi.fn(async () => `0x${'ab'.repeat(65)}` as `0x${string}`),
    writeContract: vi.fn(async () => '0xa99' as `0x${string}`),
    sendTransaction: vi.fn(async () => '0x5e4d' as `0x${string}`),
  };
  return w satisfies IntentWallet;
}

/** Permit2 allowance as seen on-chain; `waitForTransactionReceipt` resolves at once. */
export function fakeReader(allowance: bigint) {
  return {
    readContract: vi.fn(async () => allowance),
    waitForTransactionReceipt: vi.fn(async () => ({ status: 'success' })),
  };
}

