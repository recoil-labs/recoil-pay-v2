/* The public side of the gift card book — what a visitor uses to sell a card
 * or buy one.
 *
 * No API key anywhere here. A user proves themselves by signing the trade id
 * with their wallet; the server recovers the address and checks it against
 * the trade. That is the same mechanism a merchant's `x-api-key` serves, and
 * neither party can act in the other's role.
 */

import type { GiftCardSide, GiftCardType } from '../types/giftcards';
import type { SealedCode, Trade } from '../types/trades';

export class UserApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'UserApiError';
  }
}

function baseUrl(): string {
  return localStorage.getItem('recoil_gc_base_url') || import.meta.env.VITE_API_BASE_URL || '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let code: string | undefined;
    try {
      const body = await res.json();
      message = body?.message ?? body?.error ?? message;
      code = body?.error;
    } catch {
      /* keep the status line */
    }
    throw new UserApiError(message, res.status, code);
  }
  return (await res.json()) as T;
}

/** One merchant's offer for a user's intent, already priced. */
export interface RankedOffer {
  quoteId: string;
  solverId: string;
  brand: string;
  countryCode: string;
  currency: string;
  cardType: GiftCardType;
  rate: string;
  /** What the user receives (selling) or pays (buying), in payout minor units. */
  payoutMinorUnits: string;
  payoutChain: string;
  payoutAsset: string;
  payoutDecimals: number;
  reputation: number;
  successRate: number;
  compositeScore: number;
}

export interface RankResponse {
  data: RankedOffer[];
  totalConsidered: number;
  totalFilteredOut: number;
}

export interface RankRequest {
  /** True when the visitor holds a card and wants money for it. */
  userIsSelling: boolean;
  brand: string;
  countryCode: string;
  cardType: GiftCardType;
  faceMinorUnits: string;
  userAddress?: string;
}

export const UserApi = {
  /** Price an intent against the live book. Public — this is the browsing
   *  a visitor does before committing to anything. */
  async rank(input: RankRequest): Promise<RankResponse> {
    return request<RankResponse>('/api/v1/giftcard-quotes/rank', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async openTrade(input: {
    quoteId: string;
    faceMinorUnits: string;
    userAddress: string;
  }): Promise<Trade> {
    const body = await request<{ data: Trade }>('/api/v1/giftcard-trades', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return body.data;
  },

  async getTrade(id: string): Promise<Trade> {
    const body = await request<{ data: Trade }>(
      `/api/v1/giftcard-trades/${encodeURIComponent(id)}`,
    );
    return body.data;
  },

  async listMyTrades(userAddress: string): Promise<Trade[]> {
    const body = await request<{ data: Trade[] }>(
      `/api/v1/giftcard-trades?userAddress=${encodeURIComponent(userAddress)}`,
    );
    return body.data ?? [];
  },

  /** Declare escrow funded and publish the key the code is sealed to.
   *
   *  Both in one call because the funder is always the card receiver, so the
   *  party funding escrow is exactly the party whose key the sender needs. */
  async markEscrowFunded(
    id: string,
    input: { txHash: string; recipientPubkey: string; signature: string },
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
    input: { commitment: string; sealed: SealedCode; signature: string },
  ): Promise<Trade> {
    const body = await request<{ data: Trade }>(
      `/api/v1/giftcard-trades/${encodeURIComponent(id)}/code`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    return body.data;
  },

  async attest(
    id: string,
    input: { valid: boolean; reason?: string; signature: string },
  ): Promise<Trade> {
    const body = await request<{ data: Trade }>(
      `/api/v1/giftcard-trades/${encodeURIComponent(id)}/attest`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    return body.data;
  },

  async dispute(id: string, input: { reason: string; signature: string }): Promise<Trade> {
    const body = await request<{ data: Trade }>(
      `/api/v1/giftcard-trades/${encodeURIComponent(id)}/dispute`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    return body.data;
  },
};

/** What the user signs to authorise an action on a trade: the trade id and
 *  nothing else, matching what the server recovers against. */
export function tradeAuthMessage(tradeId: string): string {
  return tradeId;
}

/** What a user does next on their own trade, if anything.
 *
 *  Mirrors `merchantAction` in types/trades.ts, from the other side. Both are
 *  written against card-sender/receiver rather than `side`, so the two
 *  directions share one code path. */
export function userAction(trade: Trade): 'fund' | 'deliver' | 'confirm' | null {
  if (trade.state === 'quoted') return trade.funder === 'user' ? 'fund' : null;
  if (trade.state === 'awaiting_code') return trade.cardSender === 'user' ? 'deliver' : null;
  if (trade.state === 'awaiting_attestation') {
    return trade.cardReceiver === 'user' ? 'confirm' : null;
  }
  return null;
}

/** Who the user is waiting on, phrased for them. Returns null when the ball
 *  is in their court — `userAction` covers that case. */
export function waitingOn(trade: Trade): string | null {
  switch (trade.state) {
    case 'quoted':
      return trade.funder === 'merchant' ? 'the merchant to fund escrow' : null;
    case 'awaiting_code':
      return trade.cardSender === 'merchant' ? 'the merchant to send your code' : null;
    case 'awaiting_attestation':
      return trade.cardReceiver === 'merchant' ? 'the merchant to check your card' : null;
    case 'disputed':
      return 'a review of this trade';
    default:
      return null;
  }
}

export const GIFT_CARD_BRANDS = [
  'Amazon',
  'Apple',
  'Steam',
  'Google Play',
  'Walmart',
  'Target',
  'eBay',
  'Visa',
  'Sephora',
  'Nike',
] as const;

export const GIFT_CARD_COUNTRIES = [
  { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
  { code: 'CA', name: 'Canada', currency: 'CAD' },
  { code: 'AU', name: 'Australia', currency: 'AUD' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
] as const;

export type { GiftCardSide };
