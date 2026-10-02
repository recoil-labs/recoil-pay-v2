/* Client for the aggregator endpoints this dashboard uses.
 *
 * Gift card merchants are registered through the SAME operator flow as
 * swap solvers — one EIP-191 signature, one `api_key`, one reputation
 * record — because they settle on the same rail. That is why the
 * registration calls below hit `/api/v1/solver/*` rather than a gift
 * card-specific path: a merchant who also runs a solver is one operator,
 * not two accounts.
 */

import type {
  GetGiftCardQuotesResponse,
  GiftCardQuote,
  GiftCardQuoteSubmit,
  SubmitGiftCardQuotesResponse,
} from '../types/giftcards';
import type { SealedCode, Trade } from '../types/trades';

const STORAGE_KEYS = {
  API_KEY: 'recoil_gc_api_key',
  SOLVER_ID: 'recoil_gc_solver_id',
  BASE_URL: 'recoil_gc_base_url',
} as const;

export interface RegistrationMessageResponse {
  data?: { message?: string };
  message?: string;
}

export interface RegisterResponse {
  success: boolean;
  solverId?: string;
  fillWalletAddress?: string;
  /** Surfaced exactly once, at registration. Persisted to localStorage. */
  apiKey?: string;
}

export interface OperatorSummary {
  solverId: string;
  walletAddress: string;
  fillWalletAddress: string;
  reputationScore: number;
  fillsTotal: number;
  fillsSucceeded: number;
  avgLatencyMs: number;
  lastActiveAt: string | null;
  circuitBreakerOpen: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function baseUrl(): string {
  const stored = localStorage.getItem(STORAGE_KEYS.BASE_URL);
  if (stored) return stored;
  const env = import.meta.env.VITE_API_BASE_URL;
  return env || '';
}

export function getApiKey(): string {
  return localStorage.getItem(STORAGE_KEYS.API_KEY) || '';
}

export function setApiKey(key: string) {
  localStorage.setItem(STORAGE_KEYS.API_KEY, key);
}

export function getSolverId(): string {
  return localStorage.getItem(STORAGE_KEYS.SOLVER_ID) || '';
}

export function setSolverId(id: string) {
  localStorage.setItem(STORAGE_KEYS.SOLVER_ID, id);
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.API_KEY);
  localStorage.removeItem(STORAGE_KEYS.SOLVER_ID);
}

export function setBaseUrl(url: string) {
  localStorage.setItem(STORAGE_KEYS.BASE_URL, url);
}

/** Every authenticated call. Throws [`ApiError`] so callers can show the
 *  server's own message — the quote endpoints return specific, actionable
 *  reasons and swallowing them would turn a typo into "something failed". */
async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = init;
  const res = await fetch(`${baseUrl()}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { 'x-api-key': getApiKey() } : {}),
      ...headers,
    },
  });

  if (!res.ok) {
    // Prefer the server's message; fall back to the status when the body
    // is empty or not JSON (a proxy error page, say).
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.message) detail = body.message;
      else if (body?.error) detail = body.error;
    } catch {
      /* keep the status line */
    }
    throw new ApiError(detail, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const MerchantApi = {
  /** The challenge a merchant signs to register. Public. */
  async getRegistrationMessage(address: string): Promise<string> {
    const body = await request<RegistrationMessageResponse>(
      `/api/v1/solver/register/message?address=${encodeURIComponent(address)}`,
      { auth: false },
    );
    const message = body.data?.message ?? body.message;
    if (!message) throw new ApiError('aggregator returned no challenge message', 502);
    return message;
  },

  /** Register, and persist the one-time api_key plus the solver id. */
  async register(input: {
    address: string;
    message: string;
    signature: string;
    chainId?: string;
  }): Promise<RegisterResponse> {
    const body = await request<RegisterResponse>('/solver-api/account/register', {
      method: 'POST',
      auth: false,
      body: JSON.stringify(input),
    });
    if (body.apiKey) setApiKey(body.apiKey);
    if (body.solverId) setSolverId(body.solverId);
    return body;
  },

  async getOperator(solverId: string): Promise<OperatorSummary | null> {
    try {
      const body = await request<{ data?: OperatorSummary } | OperatorSummary>(
        `/solver-api/operators/${encodeURIComponent(solverId)}`,
      );
      return (body as { data?: OperatorSummary }).data ?? (body as OperatorSummary);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },

  /** Publish gift card terms. Partial success is normal: valid bands
   *  persist and the rest come back in `rejected`, so the caller must
   *  surface that array rather than treat a 200 as "all landed". */
  async submitQuotes(
    quotes: GiftCardQuoteSubmit[],
  ): Promise<SubmitGiftCardQuotesResponse> {
    return request<SubmitGiftCardQuotesResponse>('/solver-api/giftcard-quotes/submit', {
      method: 'POST',
      body: JSON.stringify({ solverId: getSolverId(), quotes }),
    });
  },

  /** This merchant's book. Pass no id to see the whole venue's book. */
  async listQuotes(solverId?: string): Promise<GiftCardQuote[]> {
    const qs = solverId ? `?solverId=${encodeURIComponent(solverId)}` : '';
    const body = await request<GetGiftCardQuotesResponse>(
      `/solver-api/giftcard-quotes${qs}`,
    );
    return body.data ?? [];
  },

  async togglePause(id: string): Promise<boolean | null> {
    const body = await request<{ success: boolean; paused: boolean | null }>(
      `/solver-api/giftcard-quotes/${encodeURIComponent(id)}/pause`,
      { method: 'POST' },
    );
    return body.success ? body.paused : null;
  },

  // ── trades ──────────────────────────────────────────────────────────
  //
  // Every mutating call below is authorised server-side: this dashboard
  // presents `x-api-key` (added by `request`) and the server checks it
  // resolves to the operator on the trade. A user acting on the same trade
  // proves themselves with a wallet signature instead. Neither side can act
  // in the other's role.

  async listTrades(solverId?: string): Promise<Trade[]> {
    const qs = solverId ? `?solverId=${encodeURIComponent(solverId)}` : '';
    const body = await request<{ data: Trade[] }>(`/api/v1/giftcard-trades${qs}`);
    return body.data ?? [];
  },

  async getTrade(id: string): Promise<Trade> {
    const body = await request<{ data: Trade }>(
      `/api/v1/giftcard-trades/${encodeURIComponent(id)}`,
    );
    return body.data;
  },

  /** Declare escrow funded, and publish the key the code must be sealed to.
   *
   *  The two travel together because the funder is always the card receiver
   *  — so the party funding escrow is, in both directions, exactly the party
   *  whose key the sender will need.
   *
   *  `recipientPubkey` is a derived *encryption* key, not this merchant's
   *  wallet key; `keySignature` is what proves it theirs. The signature the
   *  key was derived from is never sent — it is equivalent to the private
   *  key, and a server holding it could read every code on the platform. */
  async markEscrowFunded(
    id: string,
    input: { txHash: string; recipientPubkey: string; keySignature: string },
  ): Promise<Trade> {
    const body = await request<{ data: Trade }>(
      `/api/v1/giftcard-trades/${encodeURIComponent(id)}/escrow`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    return body.data;
  },

  /** Hand over the sealed code. The plaintext never reaches this call. */
  async deliverCode(
    id: string,
    input: { commitment: string; sealed: SealedCode },
  ): Promise<Trade> {
    const body = await request<{ data: Trade }>(
      `/api/v1/giftcard-trades/${encodeURIComponent(id)}/code`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    return body.data;
  },

  /** Attest the card after redeeming it.
   *
   *  `valid: false` opens a dispute rather than refunding — claiming a card
   *  is bad is exactly what a receiver who already redeemed it would do, so
   *  it cannot settle unilaterally. */
  async attest(id: string, input: { valid: boolean; reason?: string }): Promise<Trade> {
    const body = await request<{ data: Trade }>(
      `/api/v1/giftcard-trades/${encodeURIComponent(id)}/attest`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    return body.data;
  },

  async dispute(id: string, reason: string): Promise<Trade> {
    const body = await request<{ data: Trade }>(
      `/api/v1/giftcard-trades/${encodeURIComponent(id)}/dispute`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
    return body.data;
  },

  async deleteQuote(id: string): Promise<boolean> {
    const body = await request<{ success: boolean }>(
      `/solver-api/giftcard-quotes/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    return body.success;
  },
};
