/* Wire types for the aggregator's gift card trade endpoints. These mirror
   the Rust DTOs in `aggregator/crates/api/src/handlers/giftcard_trades.rs`. */

import type { GiftCardSide, GiftCardType } from './giftcards';

/** Which side of a trade a party is on. */
export type Party = 'user' | 'merchant';

export type TradeState =
  | 'quoted'
  | 'awaiting_code'
  | 'awaiting_attestation'
  | 'disputed'
  | 'settled_to_card_sender'
  | 'refunded_to_funder'
  | 'failed';

/** The sealed code envelope. Opaque to the server by construction — see
 *  `src/crypto/sealedCode.ts`. */
export interface SealedCode {
  v: number;
  alg: string;
  epk: string;
  iv: string;
  ct: string;
  tag: string;
}

export interface Trade {
  id: string;
  quoteId: string;
  solverId: string;
  side: GiftCardSide;
  brand: string;
  countryCode: string;
  currency: string;
  /** Decides what the sender hands over: a typed code, or photographs. */
  cardType: GiftCardType;
  faceMinorUnits: string;
  rate: string;
  payoutChain: string;
  payoutAsset: string;
  payoutMinorUnits: string;
  userAddress: string;
  /** The merchant's payout address, frozen at match time — the escrow
   *  releases only to the two addresses the lock names. */
  merchantAddress: string;
  state: TradeState;
  /** The key the code must be sealed to. Present once escrow is funded. */
  recipientPubkey: string | null;
  /** Who hands over the code, who receives it, and who funded escrow. The
   *  server derives these so no client has to reason about `side`. */
  cardSender: Party;
  cardReceiver: Party;
  funder: Party;
  /** The party the running deadline is waiting on — the one who loses if it
   *  expires. `null` in states with no clock. */
  awaiting: Party | null;
  codeCommitment: string | null;
  sealedCode: SealedCode | null;
  deadlineAt: string | null;
  resolutionNote: string | null;
  escrowTxHash: string | null;
  releaseTxHash: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Terminal states never change again. */
export function isTerminal(state: TradeState): boolean {
  return (
    state === 'settled_to_card_sender' ||
    state === 'refunded_to_funder' ||
    state === 'failed'
  );
}

/** What this merchant has to do next, if anything.
 *
 *  Phrased against `cardSender` / `cardReceiver` rather than `side`, so the
 *  two directions share one code path — the same reason the backend does it
 *  that way. */
export function merchantAction(trade: Trade): 'fund' | 'deliver' | 'attest' | null {
  if (isTerminal(trade.state) || trade.state === 'disputed') return null;
  if (trade.state === 'quoted') return trade.funder === 'merchant' ? 'fund' : null;
  if (trade.state === 'awaiting_code') return trade.cardSender === 'merchant' ? 'deliver' : null;
  if (trade.state === 'awaiting_attestation') {
    return trade.cardReceiver === 'merchant' ? 'attest' : null;
  }
  return null;
}

/** Human-readable state, from the merchant's point of view. */
export const STATE_COPY: Record<TradeState, string> = {
  quoted: 'Waiting for escrow',
  awaiting_code: 'Waiting for the code',
  awaiting_attestation: 'Waiting on verification',
  disputed: 'Disputed',
  settled_to_card_sender: 'Settled',
  refunded_to_funder: 'Refunded',
  failed: 'Failed',
};

/** Minutes left on the deadline, or null when no clock is running. */
export function minutesLeft(trade: Trade, now = Date.now()): number | null {
  if (!trade.deadlineAt) return null;
  const at = Date.parse(trade.deadlineAt);
  if (Number.isNaN(at)) return null;
  return Math.round((at - now) / 60_000);
}
