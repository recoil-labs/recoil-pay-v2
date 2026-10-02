import type {
  OrderRequest,
  OrderResponse,
  QuoteRequest,
  QuotesResponse,
  SolverAsset,
  SolversResponse,
} from './types';

/**
 * Aggregator base URL. Set VITE_OIF_API_BASE_URL (see .env.example) — every
 * environment points at the hosted aggregator on GCP. If it is unset the
 * calls go relative and the Vite dev proxy forwards them to the same host,
 * so there is no path left that reaches a local instance by accident.
 */
export const OIF_API_BASE_URL: string =
  import.meta.env.VITE_OIF_API_BASE_URL ?? '';

const API = `${OIF_API_BASE_URL}/api/v1`;

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OIF ${path} → ${res.status} ${res.statusText}${body ? `: ${body}` : ''}`);
  }
  return res.json() as Promise<T>;
}

/** POST a JSON body and parse a JSON response, surfacing aggregator errors. */
function postJson<T>(path: string, body: unknown): Promise<T> {
  return getJson<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Raw solver listing (GET /api/v1/solvers). */
export function getSolvers(): Promise<SolversResponse> {
  return getJson<SolversResponse>('/solvers');
}

/** Request quotes from solvers (POST /api/v1/quotes). */
export function getQuote(req: QuoteRequest): Promise<QuotesResponse> {
  return postJson<QuotesResponse>('/quotes', req);
}

/** Submit a signed order for execution (POST /api/v1/orders). */
export function submitOrder(req: OrderRequest): Promise<OrderResponse> {
  return postJson<OrderResponse>('/orders', req);
}

/** Fetch an order's current status (GET /api/v1/orders/{id}). */
export function getOrder(id: string): Promise<OrderResponse> {
  return getJson<OrderResponse>(`/orders/${encodeURIComponent(id)}`);
}

/** Stable key for a (chain, token) pair. Addresses are lowercased. */
export const assetKey = (chainId: number, address: string): string =>
  `${chainId}:${address.toLowerCase()}`;

/**
 * Flattened, de-duped list of assets any active solver can fill — the
 * authoritative "what's executable right now" set the intent parser gates on.
 */
export async function getSupportedAssets(): Promise<SolverAsset[]> {
  const { solvers } = await getSolvers();
  const seen = new Map<string, SolverAsset>();
  for (const solver of solvers) {
    if (solver.status !== 'active') continue;
    for (const asset of solver.supportedAssets.assets ?? []) {
      const key = assetKey(asset.chainId, asset.address);
      if (!seen.has(key)) seen.set(key, { ...asset, address: asset.address.toLowerCase() });
    }
  }
  return [...seen.values()];
}
