const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Could not reach RecoilPay — check your connection');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? 'unknown', body.message ?? 'Something went wrong');
  return body as T;
}

export type Availability =
  | { status: 'available'; tag: string }
  | { status: 'invalid'; tag: string; reason: string }
  | { status: 'taken'; tag: string; reserved: boolean; suggestions: string[] };

export interface SignedRequest {
  tag: string;
  address: string;
  chainId: number;
  issuedAt: string;
  origin: string;
  signature: string;
}

export interface PublicTag {
  tag: string;
  owner: string;
  ens: string | null;
  reservedAt: string;
  routes: Record<string, string> | null;
}

export const api = {
  availability: (tag: string, signal?: AbortSignal) => call<Availability>(`/api/availability/${encodeURIComponent(tag)}`, { signal }),
  reserve: (body: SignedRequest) => call<{ tag: string; editToken: string }>('/api/reservations', { method: 'POST', body: JSON.stringify(body) }),
  manage: (body: SignedRequest) =>
    call<{ tag: string; editToken: string; routes: Record<string, string>; showAddresses: boolean }>('/api/manage', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setRoutes: (tag: string, token: string, body: { routes: Record<string, string>; showAddresses: boolean }) =>
    call<{ ok: true }>(`/api/tags/${encodeURIComponent(tag)}/routes`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  tag: (tag: string) => call<PublicTag>(`/api/tags/${encodeURIComponent(tag)}`),
  stats: () => call<{ reserved: number }>('/api/stats'),
};

/** Canonical link for a tag — what people share and what the QR encodes. */
export const tagUrl = (tag: string) => `${window.location.origin}/@${tag}`;
