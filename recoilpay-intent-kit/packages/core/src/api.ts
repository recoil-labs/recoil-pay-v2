import type { ParseResult, RawIntent } from './intent/types';
import type {
  OrderRequest,
  OrderResponse,
  QuoteRequest,
  QuotesResponse,
  SolverAsset,
  SolversResponse,
} from './oif/types';

/** Production aggregator. Override with `apiUrl` for staging or a local instance. */
export const DEFAULT_API_URL = 'https://api.recoilpay.com';

export const TEMPLATE_HINT =
  'Try: swap <amount> <token> on <chain> for <token> on <chain> [to <address>] (e.g. swap 10 USDC on Base for ETH on Arbitrum) OR send <amount> <token> on <chain> to <address>';

/** Matches the aggregator's cap; longer text is rejected there with a 400. */
export const MAX_INTENT_CHARS = 500;

export interface ApiOptions {
  /** Aggregator base URL, without the `/api/v1` suffix. Defaults to production. */
  apiUrl?: string;
  /** Custom fetch (tests, server runtimes, proxies). Defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** One chain from GET /api/v1/chains. Keys are snake_case on this endpoint. */
export interface ChainInfo {
  chain_id: number;
  name: string;
  rpc_url: string;
  input_settler: string;
  output_settler: string;
  oracle: string;
  permit2: string;
  tokens: { symbol: string; address: string; decimals: number }[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Thin typed client for the RecoilPay aggregator's public API. */
export function createApiClient(options: ApiOptions = {}) {
  const base = `${(options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '')}/api/v1`;
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
      throw new ApiError(res.status, body?.error ?? 'HTTP_ERROR', body?.message ?? `${path} → ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

  return {
    /**
     * Turn plain English into intents (POST /api/v1/intents/parse). Never
     * throws: every failure becomes `{ ok: false, message }` with text that
     * can be shown to the user as-is.
     */
    async parse(text: string): Promise<ParseResult> {
      const norm = text.trim();
      if (!norm) return { ok: false, offTemplate: true, message: TEMPLATE_HINT };
      if (norm.length > MAX_INTENT_CHARS) {
        return { ok: false, offTemplate: true, message: `Keep it under ${MAX_INTENT_CHARS} characters. ${TEMPLATE_HINT}` };
      }
      try {
        const { intents } = await post<{ intents: RawIntent[] }>('/intents/parse', { text: norm });
        return intents?.length ? { ok: true, intents } : { ok: false, offTemplate: true, message: TEMPLATE_HINT };
      } catch (err) {
        if (!(err instanceof ApiError)) {
          return { ok: false, offTemplate: true, message: 'Could not reach RecoilPay. Check your connection and try again.' };
        }
        switch (err.status) {
          case 400:
          case 422:
            return { ok: false, offTemplate: true, message: TEMPLATE_HINT };
          case 429:
            return { ok: false, offTemplate: true, message: 'Too many requests — wait a moment and try again.' };
          case 503:
            return { ok: false, offTemplate: true, message: `Natural-language parsing is unavailable right now. ${TEMPLATE_HINT}` };
          default:
            return { ok: false, offTemplate: true, message: `Failed to understand that. ${TEMPLATE_HINT}` };
        }
      }
    },

    /** Supported chains with RPC endpoints and settlement contracts. */
    async getChains(): Promise<ChainInfo[]> {
      return (await request<{ data: ChainInfo[] }>('/chains')).data;
    },

    getSolvers: () => request<SolversResponse>('/solvers'),

    /**
     * Every asset an active solver can fill, de-duplicated — the set that
     * decides whether an intent is executable right now.
     */
    async getSupportedAssets(): Promise<SolverAsset[]> {
      const { solvers } = await request<SolversResponse>('/solvers');
      const seen = new Map<string, SolverAsset>();
      for (const solver of solvers) {
        if (solver.status !== 'active') continue;
        for (const asset of solver.supportedAssets.assets ?? []) {
          const key = `${asset.chainId}:${asset.address.toLowerCase()}`;
          if (!seen.has(key)) seen.set(key, { ...asset, address: asset.address.toLowerCase() });
        }
      }
      return [...seen.values()];
    },

    getQuotes: (req: QuoteRequest) => post<QuotesResponse>('/quotes', req),
    submitOrder: (req: OrderRequest) => post<OrderResponse>('/orders', req),
    getOrder: (id: string) => request<OrderResponse>(`/orders/${encodeURIComponent(id)}`),
  };
}
