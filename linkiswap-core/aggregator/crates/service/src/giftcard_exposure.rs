//! How much a merchant may have at risk at once.
//!
//! A bond only means something if it is large relative to what it backs. A
//! merchant with a $100 stake and $50,000 of live trades has, in effect, no
//! bond at all — defaulting on everything costs them a hundred dollars.
//!
//! So open exposure is capped at a multiple of the posted stake. The multiple
//! is above 1 deliberately: requiring full collateral would mean a merchant
//! can never do more volume than they have idle capital, which is a worse
//! business than the one this is trying to enable. What it buys is that
//! walking away is never cheap, and that the cap scales with the stake rather
//! than with the operator's optimism.

use oif_types::{GiftCardTrade, TradeState};

/// Open notional a merchant may carry per unit of bond.
///
/// At 5×, a merchant defaulting on everything at once forfeits a stake worth
/// a fifth of what they took — painful but survivable for an honest operator
/// having a bad week, and far more than the margin on the trades themselves.
pub const DEFAULT_EXPOSURE_MULTIPLE: u32 = 5;

/// What a merchant currently has at risk, and what they are allowed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Exposure {
	/// Sum of payouts on trades that are open and could still cost them.
	pub open_notional: u128,
	/// Stake, less anything a pending slash has earmarked.
	pub available_bond: u128,
	pub cap: u128,
}

impl Exposure {
	pub fn headroom(&self) -> u128 {
		self.cap.saturating_sub(self.open_notional)
	}

	/// Whether one more trade of `notional` fits.
	pub fn admits(&self, notional: u128) -> bool {
		self.open_notional.saturating_add(notional) <= self.cap
	}
}

/// Trades that still represent risk to the merchant.
///
/// A terminal trade cannot cost anyone anything more, and `Quoted` has no
/// escrow behind it yet — but it is counted anyway, because a merchant who
/// could open unlimited quoted trades could commit to far more than their
/// bond covers and then fund them all at once.
pub fn is_open_exposure(state: TradeState) -> bool {
	matches!(
		state,
		TradeState::Quoted
			| TradeState::AwaitingCode
			| TradeState::AwaitingAttestation
			| TradeState::Disputed
	)
}

/// Compute a merchant's exposure from their live trades and their stake.
///
/// `available_bond` is the on-chain figure *after* subtracting any pending
/// slash — passing the posted amount instead would let a merchant with a
/// live claim against them keep taking trades backed by money already
/// spoken for.
pub fn compute(trades: &[GiftCardTrade], available_bond: u128, multiple: u32) -> Exposure {
	let open_notional = trades
		.iter()
		.filter(|t| is_open_exposure(t.state))
		.filter_map(|t| t.payout_minor_units.trim().parse::<u128>().ok())
		.fold(0u128, |acc, n| acc.saturating_add(n));

	Exposure {
		open_notional,
		available_bond,
		cap: available_bond.saturating_mul(u128::from(multiple)),
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use chrono::Utc;
	use oif_types::{GiftCardSide, GiftCardType};

	fn trade(state: TradeState, payout: &str) -> GiftCardTrade {
		GiftCardTrade {
			id: "gct".into(),
			quote_id: "gcq".into(),
			solver_id: "solver-1".into(),
			side: GiftCardSide::Buy,
			brand: "Amazon".into(),
			country_code: "US".into(),
			currency: "USD".into(),
			card_type: GiftCardType::Ecode,
			face_minor_units: "10000".into(),
			rate: "0.88".into(),
			payout_chain: "eip155:84532".into(),
			payout_asset: "USDC".into(),
			payout_minor_units: payout.into(),
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

	#[test]
	fn settled_trades_stop_counting_against_the_cap() {
		// Otherwise a merchant's capacity would shrink permanently with
		// every trade they completed successfully.
		let trades = vec![
			trade(TradeState::SettledToCardSender, "100_000_000".replace('_', "").as_str()),
			trade(TradeState::RefundedToFunder, "100000000"),
			trade(TradeState::Failed, "100000000"),
		];
		assert_eq!(compute(&trades, 1_000_000, 5).open_notional, 0);
	}

	#[test]
	fn every_live_state_counts_including_quoted_and_disputed() {
		for state in [
			TradeState::Quoted,
			TradeState::AwaitingCode,
			TradeState::AwaitingAttestation,
			TradeState::Disputed,
		] {
			assert!(is_open_exposure(state), "{state} should count");
			assert_eq!(compute(&[trade(state, "88000000")], 0, 5).open_notional, 88_000_000);
		}
	}

	#[test]
	fn a_quoted_trade_counts_before_its_escrow_lands() {
		// The hole this closes: unlimited quoted trades, then funding them
		// all at once far beyond what the bond covers.
		let trades = vec![trade(TradeState::Quoted, "88000000"); 10];
		assert_eq!(compute(&trades, 0, 5).open_notional, 880_000_000);
	}

	#[test]
	fn the_cap_scales_with_the_stake() {
		let e = compute(&[], 200_000_000, 5); // $200 bond
		assert_eq!(e.cap, 1_000_000_000); // $1000 of open trades
		assert_eq!(e.headroom(), 1_000_000_000);
	}

	#[test]
	fn no_bond_means_no_capacity() {
		// An unconfigured or unstaked merchant must not be treated as
		// unlimited — that is the failure mode the whole cap exists to stop.
		let e = compute(&[], 0, 5);
		assert_eq!(e.cap, 0);
		assert!(!e.admits(1));
	}

	#[test]
	fn a_trade_that_exactly_fills_the_cap_is_admitted() {
		let e = compute(&[trade(TradeState::AwaitingCode, "400000000")], 100_000_000, 5);
		assert!(e.admits(100_000_000), "exactly at the cap should pass");
		assert!(!e.admits(100_000_001), "one unit over should not");
	}

	#[test]
	fn an_unparseable_payout_does_not_silently_vanish_from_the_total() {
		// It is skipped rather than counted as zero-by-crash; the others
		// must still add up, so one bad row cannot raise a merchant's
		// effective capacity.
		let trades = vec![
			trade(TradeState::AwaitingCode, "88000000"),
			trade(TradeState::AwaitingCode, "not-a-number"),
		];
		assert_eq!(compute(&trades, 0, 5).open_notional, 88_000_000);
	}

	#[test]
	fn exposure_arithmetic_saturates_rather_than_overflowing() {
		let huge = u128::MAX.to_string();
		let trades = vec![trade(TradeState::AwaitingCode, &huge); 2];
		let e = compute(&trades, u128::MAX, 5);
		assert_eq!(e.open_notional, u128::MAX);
		assert_eq!(e.cap, u128::MAX);
	}
}
