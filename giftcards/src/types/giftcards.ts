/* Wire types for the aggregator's gift card endpoints. These mirror the
   Rust DTOs in `aggregator/crates/api/src/handlers/giftcard_quotes.rs`;
   the server accepts both camelCase and snake_case on input and replies in
   camelCase. */

/** Direction, named from the MERCHANT's point of view. */
export type GiftCardSide = 'buy' | 'sell';

export type GiftCardType = 'ecode' | 'physical';

/** What each side means for the merchant, in the words shown in the UI.
 *
 *  Worth keeping in one place: 'buy' and 'sell' are from the merchant's
 *  perspective, so a merchant's "buy" rate is what a *user selling* a card
 *  receives. Mislabelling this in the UI is how a merchant publishes the
 *  wrong side of their spread. */
export const SIDE_COPY: Record<GiftCardSide, { label: string; detail: string }> = {
  buy: {
    label: 'You buy',
    detail: 'A user sells you a card. You fund escrow first and pay out on redemption.',
  },
  sell: {
    label: 'You sell',
    detail: 'A user buys a card from you. They fund escrow; you deliver the code.',
  },
};

export interface GiftCardRange {
  minFace: string;
  maxFace: string;
  quote: string;
  fixedCost?: string;
}

export interface GiftCardQuoteSubmit {
  side: GiftCardSide;
  productId?: number;
  brand: string;
  countryCode: string;
  currency: string;
  cardType: GiftCardType;
  faceDecimals: number;
  /** Unix seconds. */
  expiry: number;
  payoutChain: string;
  payoutAsset: string;
  payoutDecimals: number;
  ranges: GiftCardRange[];
  exclusiveFor?: string;
}

export interface GiftCardQuoteRejection {
  index: number;
  brand: string;
  reason: string;
}

export interface SubmitGiftCardQuotesResponse {
  status: string;
  quotesAdded: number;
  /** Absent when nothing was rejected. */
  rejected?: GiftCardQuoteRejection[];
}

export interface GiftCardQuote {
  id: string;
  solverId: string;
  side: GiftCardSide;
  productId: number | null;
  brand: string;
  countryCode: string;
  currency: string;
  cardType: GiftCardType;
  faceDecimals: number;
  minFace: string;
  maxFace: string;
  quote: string;
  fixedCost: string | null;
  payoutChain: string;
  payoutAsset: string;
  payoutDecimals: number;
  expiry: string;
  exclusiveFor: string | null;
  paused: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GetGiftCardQuotesResponse {
  data: GiftCardQuote[];
}

/* ── face-value conversion ───────────────────────────────────────────────
   The wire carries minor units as strings, because the server parses them
   as integers and a decimal is rejected outright. Merchants type major
   units ("25", not "2500"), so the conversion lives here rather than in
   each form. */

/** "25" (dollars) → "2500" (cents). Throws on anything that would silently
 *  truncate, because a band 100x too small is not a visible error. */
export function toMinorUnits(major: string, decimals: number): string {
  const trimmed = major.trim();
  if (trimmed === '') throw new Error('amount is required');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`"${major}" is not a positive amount`);
  }
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > decimals) {
    throw new Error(
      `"${major}" has more than ${decimals} decimal place${decimals === 1 ? '' : 's'}`,
    );
  }
  const padded = frac.padEnd(decimals, '0');
  // Strip leading zeros so the server sees a canonical integer, but keep a
  // single "0" for a genuine zero.
  const joined = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
  return joined === '' ? '0' : joined;
}

/** "2500" (cents) → "25.00" (dollars), for display. */
export function fromMinorUnits(minor: string, decimals: number): string {
  const digits = minor.trim().replace(/^0+(?=\d)/, '') || '0';
  if (decimals === 0) return digits;
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const frac = padded.slice(-decimals);
  return `${whole}.${frac}`;
}

/** A rate as a percentage for display: "0.88" → "88%". */
export function ratePercent(quote: string): string {
  const n = Number(quote);
  if (!Number.isFinite(n)) return '—';
  const pct = n * 100;
  // Two decimals only when they carry information; "88%" beats "88.00%".
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}
