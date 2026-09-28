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
    /** The fetch this client uses (shared with the session's parser). */
    fetch: doFetch,

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
