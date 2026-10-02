//! A gift card trade: one matched order, from escrow to settlement.
//!
//! # The rule this module exists to enforce
//!
//! One leg of a gift card trade is a fact about a brand's database, and no
//! contract can verify it. Escrow release therefore cannot be *proven*, only
//! *attested* — and an attestation can be withheld. So every state here has
//! a deadline, and every deadline needs an answer to "who gets the money if
//! nobody acts?".
//!
//! The answer is one sentence:
//!
//! > **Whoever the clock is waiting on, loses.**
//!
//! That is the whole asymmetry. Before the code is handed over, the clock is
//! waiting on the card sender, so a timeout refunds the funder. After it is
//! handed over, the clock is waiting on the receiver, so a timeout releases
//! to the card sender. Neither party can profit by going silent, in either
//! direction, which is what makes it safe to stand on either side of this
//! trade.
//!
//! # Why there is only one rule and not two
//!
//! Phrased by direction it looks like two special cases — a user selling a
//! card is protected by a timeout that pays *them*, a user buying one is
//! protected by a timeout that pays the *merchant*. They are the same rule,
//! because of a fact that is easy to miss:
//!
//! > **The funder is always the card receiver.** The party paying is the
//! > party receiving the card.
//!
//! So escrow always flows funder → card sender on success and back to the
//! funder on failure, in both directions. [`GiftCardTrade::card_sender`]
//! and friends do the direction mapping once, here, and nothing downstream
//! has to reason about `side` again. Getting this backwards in even one
//! branch would systematically rob one side of the book, so it is expressed
//! once and tested in both directions.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

use crate::{GiftCardSide, GiftCardType};

/// How long the card sender has to hand over the code once escrow is funded.
///
/// Generous, because a human may have to go and find a physical card. The
/// cost of it being too long is only a delayed refund to the funder; the
/// cost of it being too short is a legitimate seller losing a trade.
pub const CODE_DELIVERY_WINDOW_MINS: i64 = 60;

/// How long a **merchant** has to verify a code and attest.
///
/// Shorter than the user window: a merchant redeems programmatically, and a
/// merchant stalling after receiving a code is exactly the abuse this
/// deadline exists to stop.
pub const MERCHANT_ATTESTATION_WINDOW_MINS: i64 = 30;

/// How long a **user** has to confirm a code they received.
///
/// Longer than the merchant window because a person has to go and redeem it
/// by hand.
pub const USER_ATTESTATION_WINDOW_MINS: i64 = 60;

/// Which side of the trade a party is on. Used for "who gets the escrow".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Party {
	User,
	Merchant,
}

impl Party {
	pub fn as_str(&self) -> &'static str {
		match self {
			Self::User => "user",
			Self::Merchant => "merchant",
		}
	}

	pub fn other(&self) -> Self {
		match self {
			Self::User => Self::Merchant,
			Self::Merchant => Self::User,
		}
	}
}

impl fmt::Display for Party {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(self.as_str())
	}
}

impl FromStr for Party {
	type Err = String;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s.trim().to_ascii_lowercase().as_str() {
			"user" => Ok(Self::User),
			"merchant" => Ok(Self::Merchant),
			other => Err(format!("unknown party: {other}")),
		}
	}
}

/// Where a trade is in its lifecycle.
///
/// Terminal states name the outcome rather than deferring it to a separate
/// `resolution` column, so a row can never be in a state whose meaning
/// depends on reading a second field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TradeState {
	/// Matched to a quote. Nothing is locked; the quote can still vanish.
	Quoted,
	/// The funder's payout is in escrow. Waiting for the card sender.
	AwaitingCode,
	/// Ciphertext and commitment are stored. Waiting for the card receiver
	/// to verify and attest.
	AwaitingAttestation,
	/// Contested. A human decides; no deadline runs while disputed.
	Disputed,

	// ── terminal ────────────────────────────────────────────────────────
	/// The card was good. Escrow released to the card sender.
	SettledToCardSender,
	/// The card was bad, or never arrived. Escrow returned to the funder.
	RefundedToFunder,
	/// Could not proceed (quote expired before funding, escrow failed, …).
	/// No money moved.
	Failed,
}

impl TradeState {
	pub fn as_str(&self) -> &'static str {
		match self {
			Self::Quoted => "quoted",
			Self::AwaitingCode => "awaiting_code",
			Self::AwaitingAttestation => "awaiting_attestation",
			Self::Disputed => "disputed",
			Self::SettledToCardSender => "settled_to_card_sender",
			Self::RefundedToFunder => "refunded_to_funder",
			Self::Failed => "failed",
		}
	}

	/// Terminal states never transition again. Checked before every write so
	/// a late worker cannot re-resolve a trade that a human already settled.
	pub fn is_terminal(&self) -> bool {
		matches!(
			self,
			Self::SettledToCardSender | Self::RefundedToFunder | Self::Failed
		)
	}

	/// True while a deadline is running. A disputed trade deliberately has
	/// no clock: once a human is involved, a timeout firing underneath them
	/// would decide the case by accident.
	pub fn has_deadline(&self) -> bool {
		matches!(self, Self::AwaitingCode | Self::AwaitingAttestation)
	}
}

impl fmt::Display for TradeState {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(self.as_str())
	}
}

impl FromStr for TradeState {
	type Err = String;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s.trim().to_ascii_lowercase().as_str() {
			"quoted" => Ok(Self::Quoted),
			"awaiting_code" => Ok(Self::AwaitingCode),
			"awaiting_attestation" => Ok(Self::AwaitingAttestation),
			"disputed" => Ok(Self::Disputed),
			"settled_to_card_sender" => Ok(Self::SettledToCardSender),
			"refunded_to_funder" => Ok(Self::RefundedToFunder),
			"failed" => Ok(Self::Failed),
			other => Err(format!("unknown trade state: {other}")),
		}
	}
}

/// The sealed code, as the client produced it. The aggregator stores this
/// and **cannot read it** — see [`GiftCardTrade::sealed_code`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SealedCode {
	/// Envelope version, so the format can change without guessing.
	pub v: u8,
	/// e.g. `"ECIES-secp256k1-AES256GCM"`.
	pub alg: String,
	/// Ephemeral public key, `0x`-hex.
	pub epk: String,
	/// Nonce, `0x`-hex.
	pub iv: String,
	/// Ciphertext, `0x`-hex.
	pub ct: String,
	/// Auth tag, `0x`-hex.
	pub tag: String,
}

/// One matched gift card order.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GiftCardTrade {
	pub id: String,
	/// The quote that was matched. Kept by id *and* by value below, because
	/// a merchant may withdraw the quote while the trade is still running
	/// and the agreed terms must survive that.
	pub quote_id: String,
	pub solver_id: String,

	/// Direction, from the merchant's point of view — the same vocabulary as
	/// [`crate::GiftCardQuote`].
	pub side: GiftCardSide,

	// Agreed terms, frozen at match time.
	pub brand: String,
	pub country_code: String,
	pub currency: String,
	/// Digital code or physical card — it decides what the sender hands over.
	pub card_type: GiftCardType,
	pub face_minor_units: String,
	pub rate: String,
	pub payout_chain: String,
	pub payout_asset: String,
	pub payout_minor_units: String,

	pub user_address: String,
	/// The merchant's payout address, frozen at match time.
	///
	/// The escrow releases only to one of the lock's two named parties, so a
	/// merchant who rotates their wallet mid-trade must still be paid at the
	/// address the lock names.
	pub merchant_address: String,

	pub state: TradeState,

	/// The card receiver's secp256k1 public key, `0x`-hex (uncompressed,
	/// 65 bytes). Supplied by the receiver when they fund escrow — the
	/// funder is the card receiver in both directions, so that call is
	/// always made by the right party — and verified against their address
	/// before it is stored.
	pub recipient_pubkey: Option<String>,

	/// `keccak256` of the plaintext code, written when the code is
	/// delivered. In a dispute the claimant must reveal a preimage that
	/// hashes to this, so nobody can substitute a different code afterwards.
	pub code_commitment: Option<String>,
	/// The sealed code. Opaque to the server by construction.
	pub sealed_code: Option<SealedCode>,

	/// When the running deadline expires. `None` in states with no clock.
	pub deadline_at: Option<DateTime<Utc>>,

	/// Free-text reason attached to the terminal state, for the audit trail
	/// and the dispute console.
	pub resolution_note: Option<String>,

	pub escrow_tx_hash: Option<String>,
	pub release_tx_hash: Option<String>,

	pub created_at: DateTime<Utc>,
	pub updated_at: DateTime<Utc>,
}

/// What a transition decided. Returned rather than applied so the caller
/// can persist it in one write and so the decision is testable on its own.
#[derive(Debug, Clone, PartialEq)]
pub struct Transition {
	pub next: TradeState,
	/// Who the escrowed payout goes to. `None` when no money moves.
	pub pays: Option<Party>,
	pub deadline_at: Option<DateTime<Utc>>,
	pub note: String,
}

impl GiftCardTrade {
	/// The party who hands over the code.
	pub fn card_sender(&self) -> Party {
		match self.side {
			// Merchant buys ⇒ the user is selling, so the user sends the code.
			GiftCardSide::Buy => Party::User,
			// Merchant sells ⇒ the merchant sends the code.
			GiftCardSide::Sell => Party::Merchant,
		}
	}

	/// The party who receives the code — and, necessarily, the party who
	/// paid for it.
	pub fn card_receiver(&self) -> Party {
		self.card_sender().other()
	}

	/// The party whose money is in escrow.
	///
	/// Identical to [`Self::card_receiver`] by construction, and named
	/// separately because the two roles are reasoned about separately even
	/// though they always coincide. If that ever stops being true, this is
	/// the one place to change.
	pub fn funder(&self) -> Party {
		self.card_receiver()
	}

	/// The party a running deadline is waiting on.
	///
	/// This is the function the whole module turns on: the answer to a
	/// timeout is always "not them".
	pub fn awaited_party(&self) -> Option<Party> {
		match self.state {
			TradeState::AwaitingCode => Some(self.card_sender()),
			TradeState::AwaitingAttestation => Some(self.card_receiver()),
			_ => None,
		}
	}

	/// How long the party in the current state gets.
	fn window_for(&self, state: TradeState) -> Option<Duration> {
		match state {
			TradeState::AwaitingCode => Some(Duration::minutes(CODE_DELIVERY_WINDOW_MINS)),
			TradeState::AwaitingAttestation => Some(Duration::minutes(
				// The attestation window depends on who is doing the
				// attesting: a merchant redeems programmatically, a person
				// does it by hand.
				match self.card_receiver() {
					Party::Merchant => MERCHANT_ATTESTATION_WINDOW_MINS,
					Party::User => USER_ATTESTATION_WINDOW_MINS,
				},
			)),
			_ => None,
		}
	}

	/// Escrow is funded. The card sender is now on the clock.
	pub fn on_escrow_funded(&self, now: DateTime<Utc>) -> Result<Transition, String> {
		self.require(TradeState::Quoted)?;
		Ok(Transition {
			next: TradeState::AwaitingCode,
			pays: None,
			deadline_at: Some(now + Duration::minutes(CODE_DELIVERY_WINDOW_MINS)),
			note: format!("escrow funded by {}", self.funder()),
		})
	}

	/// The code was handed over. The receiver is now on the clock.
	pub fn on_code_delivered(&self, now: DateTime<Utc>) -> Result<Transition, String> {
		self.require(TradeState::AwaitingCode)?;
		let window = self
			.window_for(TradeState::AwaitingAttestation)
			.expect("awaiting_attestation always has a window");
		Ok(Transition {
			next: TradeState::AwaitingAttestation,
			pays: None,
			deadline_at: Some(now + window),
			note: format!("code delivered by {}", self.card_sender()),
		})
	}

	/// The receiver verified the code and says it is good.
	pub fn on_attested_valid(&self) -> Result<Transition, String> {
		self.require(TradeState::AwaitingAttestation)?;
		Ok(Transition {
			next: TradeState::SettledToCardSender,
			pays: Some(self.card_sender()),
			deadline_at: None,
			note: format!("{} attested the card is valid", self.card_receiver()),
		})
	}

	/// The receiver says the code is bad. This does **not** refund straight
	/// away: an invalid-claim is exactly the move a dishonest receiver would
	/// make after redeeming the card themselves, so it opens a dispute and
	/// stops the clock instead of deciding the case.
	pub fn on_attested_invalid(&self, reason: &str) -> Result<Transition, String> {
		self.require(TradeState::AwaitingAttestation)?;
		Ok(Transition {
			next: TradeState::Disputed,
			pays: None,
			deadline_at: None,
			note: format!("{} reported the card invalid: {reason}", self.card_receiver()),
		})
	}

	/// Either party contests.
	pub fn on_disputed(&self, by: Party, reason: &str) -> Result<Transition, String> {
		if self.state.is_terminal() {
			return Err(format!("trade is already {}", self.state));
		}
		Ok(Transition {
			next: TradeState::Disputed,
			pays: None,
			deadline_at: None,
			note: format!("disputed by {by}: {reason}"),
		})
	}

	/// A human resolved a dispute.
	pub fn on_dispute_resolved(&self, pays: Party, note: &str) -> Result<Transition, String> {
		self.require(TradeState::Disputed)?;
		// A resolution is described by who receives the escrow, and that
		// determines the terminal state — not the other way round, so an
		// adjudicator cannot pick a state that contradicts the payout.
		let next = if pays == self.card_sender() {
			TradeState::SettledToCardSender
		} else {
			TradeState::RefundedToFunder
		};
		Ok(Transition {
			next,
			pays: Some(pays),
			deadline_at: None,
			note: format!("dispute resolved in favour of {pays}: {note}"),
		})
	}

	/// The deadline passed with no action.
	///
	/// **Whoever the clock is waiting on, loses.** One branch, both
	/// directions, both stages.
	pub fn on_deadline_passed(&self, now: DateTime<Utc>) -> Result<Transition, String> {
		if !self.state.has_deadline() {
			return Err(format!("{} has no deadline to miss", self.state));
		}
		match self.deadline_at {
			Some(deadline) if deadline <= now => {}
			Some(_) => return Err("deadline has not passed yet".to_string()),
			None => return Err("no deadline recorded".to_string()),
		}

		let awaited = self
			.awaited_party()
			.expect("a state with a deadline always awaits a party");
		let pays = awaited.other();

		let next = if pays == self.card_sender() {
			TradeState::SettledToCardSender
		} else {
			TradeState::RefundedToFunder
		};

		Ok(Transition {
			next,
			pays: Some(pays),
			deadline_at: None,
			note: format!("{awaited} did not act before the deadline; escrow goes to {pays}"),
		})
	}

	/// Who the escrow owes, once the trade is terminal, and at what address.
	///
	/// Derived from the terminal state rather than recomputed from `side`,
	/// so the payout cannot disagree with the outcome that was recorded.
	pub fn payee(&self) -> Option<(Party, &str)> {
		let party = match self.state {
			TradeState::SettledToCardSender => self.card_sender(),
			TradeState::RefundedToFunder => self.funder(),
			_ => return None,
		};
		Some((party, self.address_of(party)))
	}

	pub fn address_of(&self, party: Party) -> &str {
		match party {
			Party::User => &self.user_address,
			Party::Merchant => &self.merchant_address,
		}
	}

	fn require(&self, expected: TradeState) -> Result<(), String> {
		if self.state == expected {
			Ok(())
		} else {
			Err(format!("expected state {expected}, found {}", self.state))
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn trade(side: GiftCardSide, state: TradeState) -> GiftCardTrade {
		GiftCardTrade {
			id: "gct-1".into(),
			quote_id: "gcq-1".into(),
			solver_id: "solver-1".into(),
			side,
			brand: "Amazon".into(),
			country_code: "US".into(),
			currency: "USD".into(),
			card_type: GiftCardType::Ecode,
			face_minor_units: "10000".into(),
			rate: "0.88".into(),
			payout_chain: "eip155:84532".into(),
			payout_asset: "USDC".into(),
			payout_minor_units: "88000000".into(),
			user_address: "0xuser".into(),
			merchant_address: "0xmerchant".into(),
			state,
			recipient_pubkey: None,
			code_commitment: None,
			sealed_code: None,
			deadline_at: None,
			resolution_note: None,
			escrow_tx_hash: None,
			release_tx_hash: None,
			created_at: Utc::now(),
			updated_at: Utc::now(),
		}
	}

	fn expired(side: GiftCardSide, state: TradeState) -> GiftCardTrade {
		let mut t = trade(side, state);
		t.deadline_at = Some(Utc::now() - Duration::minutes(1));
		t
	}

	// ── roles ───────────────────────────────────────────────────────────

	#[test]
	fn the_user_sends_the_code_when_the_merchant_is_buying() {
		let t = trade(GiftCardSide::Buy, TradeState::Quoted);
		assert_eq!(t.card_sender(), Party::User);
		assert_eq!(t.card_receiver(), Party::Merchant);
	}

	#[test]
	fn the_merchant_sends_the_code_when_the_merchant_is_selling() {
		let t = trade(GiftCardSide::Sell, TradeState::Quoted);
		assert_eq!(t.card_sender(), Party::Merchant);
		assert_eq!(t.card_receiver(), Party::User);
	}

	#[test]
	fn the_funder_is_always_the_card_receiver() {
		// The fact the single timeout rule rests on. If this ever fails,
		// `on_deadline_passed` is no longer sound.
		for side in [GiftCardSide::Buy, GiftCardSide::Sell] {
			let t = trade(side, TradeState::Quoted);
			assert_eq!(t.funder(), t.card_receiver(), "side {side}");
		}
	}

	// ── the timeout rule, both directions, both stages ───────────────────

	#[test]
	fn silence_before_delivery_refunds_the_funder_in_both_directions() {
		// Merchant buying: the user never sends the code → merchant refunded.
		let t = expired(GiftCardSide::Buy, TradeState::AwaitingCode);
		let tr = t.on_deadline_passed(Utc::now()).unwrap();
		assert_eq!(tr.next, TradeState::RefundedToFunder);
		assert_eq!(tr.pays, Some(Party::Merchant));

		// Merchant selling: the merchant never delivers → user refunded.
		let t = expired(GiftCardSide::Sell, TradeState::AwaitingCode);
		let tr = t.on_deadline_passed(Utc::now()).unwrap();
		assert_eq!(tr.next, TradeState::RefundedToFunder);
		assert_eq!(tr.pays, Some(Party::User));
	}

	#[test]
	fn silence_after_delivery_pays_the_card_sender_in_both_directions() {
		// A user selling a card is protected from a merchant who stalls.
		let t = expired(GiftCardSide::Buy, TradeState::AwaitingAttestation);
		let tr = t.on_deadline_passed(Utc::now()).unwrap();
		assert_eq!(tr.next, TradeState::SettledToCardSender);
		assert_eq!(tr.pays, Some(Party::User));

		// A merchant selling a card is protected from a buyer who never
		// confirms after receiving the code.
		let t = expired(GiftCardSide::Sell, TradeState::AwaitingAttestation);
		let tr = t.on_deadline_passed(Utc::now()).unwrap();
		assert_eq!(tr.next, TradeState::SettledToCardSender);
		assert_eq!(tr.pays, Some(Party::Merchant));
	}

	#[test]
	fn a_timeout_never_pays_the_party_it_was_waiting_on() {
		// The invariant, stated directly.
		for side in [GiftCardSide::Buy, GiftCardSide::Sell] {
			for state in [TradeState::AwaitingCode, TradeState::AwaitingAttestation] {
				let t = expired(side, state);
				let awaited = t.awaited_party().unwrap();
				let tr = t.on_deadline_passed(Utc::now()).unwrap();
				assert_ne!(tr.pays, Some(awaited), "side {side}, state {state}");
			}
		}
	}

	#[test]
	fn a_deadline_that_has_not_passed_does_not_fire() {
		let mut t = trade(GiftCardSide::Buy, TradeState::AwaitingCode);
		t.deadline_at = Some(Utc::now() + Duration::minutes(5));
		assert!(t.on_deadline_passed(Utc::now()).is_err());
	}

	#[test]
	fn a_disputed_trade_has_no_clock_to_run_out() {
		// Otherwise a timeout would decide a case a human is mid-way through.
		let t = expired(GiftCardSide::Buy, TradeState::Disputed);
		assert!(t.on_deadline_passed(Utc::now()).is_err());
		assert!(!TradeState::Disputed.has_deadline());
		assert!(t.awaited_party().is_none());
	}

	// ── windows ─────────────────────────────────────────────────────────

	#[test]
	fn a_person_confirming_gets_longer_than_a_merchant_redeeming() {
		// Merchant receives (user is selling) → short window.
		let t = trade(GiftCardSide::Buy, TradeState::AwaitingCode);
		let merchant_tr = t.on_code_delivered(Utc::now()).unwrap();

		// User receives (merchant is selling) → long window.
		let t = trade(GiftCardSide::Sell, TradeState::AwaitingCode);
		let user_tr = t.on_code_delivered(Utc::now()).unwrap();

		assert!(merchant_tr.deadline_at.unwrap() < user_tr.deadline_at.unwrap());
	}

	// ── transitions ─────────────────────────────────────────────────────

	#[test]
	fn attesting_valid_pays_the_card_sender() {
		let t = trade(GiftCardSide::Buy, TradeState::AwaitingAttestation);
		let tr = t.on_attested_valid().unwrap();
		assert_eq!(tr.next, TradeState::SettledToCardSender);
		assert_eq!(tr.pays, Some(Party::User));
		assert!(tr.deadline_at.is_none());
	}

	#[test]
	fn attesting_invalid_opens_a_dispute_rather_than_refunding() {
		// The receiver claiming "bad card" is the exact move of someone who
		// redeemed it themselves, so it must not pay out unilaterally.
		let t = trade(GiftCardSide::Buy, TradeState::AwaitingAttestation);
		let tr = t.on_attested_invalid("already redeemed").unwrap();
		assert_eq!(tr.next, TradeState::Disputed);
		assert_eq!(tr.pays, None);
		assert!(tr.deadline_at.is_none());
	}

	#[test]
	fn a_dispute_resolution_picks_the_state_from_the_payout() {
		let t = trade(GiftCardSide::Buy, TradeState::Disputed);

		let tr = t.on_dispute_resolved(Party::User, "code verified good").unwrap();
		assert_eq!(tr.next, TradeState::SettledToCardSender);

		let tr = t.on_dispute_resolved(Party::Merchant, "code was spent").unwrap();
		assert_eq!(tr.next, TradeState::RefundedToFunder);
	}

	#[test]
	fn transitions_reject_the_wrong_starting_state() {
		let t = trade(GiftCardSide::Buy, TradeState::Quoted);
		assert!(t.on_code_delivered(Utc::now()).is_err());
		assert!(t.on_attested_valid().is_err());
		assert!(t.on_dispute_resolved(Party::User, "x").is_err());
	}

	#[test]
	fn a_terminal_trade_cannot_be_disputed_back_open() {
		// A late worker or a stale client must not reopen a settled trade.
		for state in [
			TradeState::SettledToCardSender,
			TradeState::RefundedToFunder,
			TradeState::Failed,
		] {
			let t = trade(GiftCardSide::Buy, state);
			assert!(t.on_disputed(Party::User, "too late").is_err(), "{state}");
			assert!(state.is_terminal());
		}
	}

	#[test]
	fn a_settled_trade_pays_the_card_sender_at_their_own_address() {
		let mut t = trade(GiftCardSide::Buy, TradeState::SettledToCardSender);
		assert_eq!(t.payee(), Some((Party::User, "0xuser")));

		t.side = GiftCardSide::Sell;
		assert_eq!(t.payee(), Some((Party::Merchant, "0xmerchant")));
	}

	#[test]
	fn a_refunded_trade_pays_the_funder_at_their_own_address() {
		let mut t = trade(GiftCardSide::Buy, TradeState::RefundedToFunder);
		// Merchant buys ⇒ merchant funded ⇒ merchant refunded.
		assert_eq!(t.payee(), Some((Party::Merchant, "0xmerchant")));

		t.side = GiftCardSide::Sell;
		assert_eq!(t.payee(), Some((Party::User, "0xuser")));
	}

	#[test]
	fn a_trade_that_is_not_terminal_owes_nobody() {
		for state in [
			TradeState::Quoted,
			TradeState::AwaitingCode,
			TradeState::AwaitingAttestation,
			TradeState::Disputed,
			TradeState::Failed,
		] {
			assert_eq!(trade(GiftCardSide::Buy, state).payee(), None, "{state}");
		}
	}

	#[test]
	fn state_round_trips_through_strings() {
		for s in [
			TradeState::Quoted,
			TradeState::AwaitingCode,
			TradeState::AwaitingAttestation,
			TradeState::Disputed,
			TradeState::SettledToCardSender,
			TradeState::RefundedToFunder,
			TradeState::Failed,
		] {
			assert_eq!(TradeState::from_str(s.as_str()).unwrap(), s);
		}
		assert!(TradeState::from_str("nonsense").is_err());
	}

	#[test]
	fn party_round_trips_and_flips() {
		assert_eq!(Party::User.other(), Party::Merchant);
		assert_eq!(Party::Merchant.other(), Party::User);
		assert_eq!(Party::from_str("USER").unwrap(), Party::User);
		assert!(Party::from_str("solver").is_err());
	}
}
