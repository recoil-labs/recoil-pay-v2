//! Ranks merchant gift card quotes against a user intent.
//!
//! Deliberately a sibling of [`crate::push_quote_ranker`] rather than a
//! generalisation of it. The two share their *scoring* — payout, reputation,
//! success rate, latency, with the same weights — because that is a judgement
//! about operators and applies to any asset class. They do not share their
//! *matching*, because the keys are different shapes (a chain/token pair
//! versus brand/country/card-type) and, more importantly, they do not share
//! their *output*: a swap match is shaped into a signable Permit2 envelope,
//! while a gift card match produces an offer whose card leg no contract can
//! encode. Folding them together would mean one function that returns two
//! unrelated things depending on a flag.

use chrono::Utc;
use oif_storage::Storage;
use oif_types::{GiftCardQuote, GiftCardSide, GiftCardType, Operator};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tracing::{debug, info};

use crate::push_quote_ranker::RankingWeights;

#[derive(Debug, Error)]
pub enum GiftCardRankerError {
	#[error("storage error: {0}")]
	Storage(String),
}

pub type GiftCardRankerResult<T> = Result<T, GiftCardRankerError>;

/// What a user is asking for. Phrased from the **user's** point of view,
/// which is the opposite of how a quote's `side` is phrased — a user
/// selling a card matches merchant quotes whose side is `buy`. The
/// conversion happens once, in [`GiftCardIntent::merchant_side`], so no
/// caller has to get it right a second time.
#[derive(Debug, Clone)]
pub struct GiftCardIntent {
	/// True when the user wants to SELL a card they hold.
	pub user_is_selling: bool,
	pub brand: String,
	pub country_code: String,
	pub card_type: GiftCardType,
	/// Face value in the card currency's minor units.
	pub face_minor_units: u128,
	/// Used to honour `exclusive_for`.
	pub user_address: String,
}

impl GiftCardIntent {
	/// The merchant-side value whose quotes can fill this intent.
	pub fn merchant_side(&self) -> GiftCardSide {
		if self.user_is_selling {
			GiftCardSide::Buy
		} else {
			GiftCardSide::Sell
		}
	}
}

/// A matched merchant offer, scored.
#[derive(Debug, Clone)]
pub struct ScoredGiftCardQuote {
	pub quote: GiftCardQuote,
	/// What the user receives (selling) or pays (buying), in the payout
	/// token's minor units.
	pub payout_minor_units: u128,
	pub payout_norm: f64,
	pub reputation: f64,
	pub success_rate: f64,
	pub latency_norm: f64,
	pub composite_score: f64,
}

#[derive(Debug, Clone, Default)]
pub struct GiftCardRankingResult {
	pub matches: Vec<ScoredGiftCardQuote>,
	pub total_considered: usize,
	pub total_filtered_out: usize,
}

pub struct GiftCardRanker {
	storage: Arc<dyn Storage>,
	weights: RankingWeights,
	max_results: usize,
}

impl GiftCardRanker {
	pub fn new(storage: Arc<dyn Storage>) -> Self {
		Self {
			storage,
			weights: RankingWeights::default(),
			max_results: 50,
		}
	}

	pub fn with_weights(mut self, weights: RankingWeights) -> Self {
		self.weights = weights;
		self
	}

	pub fn with_max_results(mut self, n: usize) -> Self {
		self.max_results = n;
		self
	}

	pub async fn rank(
		&self,
		intent: &GiftCardIntent,
	) -> GiftCardRankerResult<GiftCardRankingResult> {
		let all = self
			.storage
			.list_giftcard_quotes(None)
			.await
			.map_err(|e| GiftCardRankerError::Storage(e.to_string()))?;

		let operators = self.load_operator_index().await?;
		let total_considered = all.len();
		let candidates = filter_candidates(all, intent, &operators);
		let total_filtered_out = total_considered - candidates.len();

		info!(
			total_considered,
			kept = candidates.len(),
			brand = %intent.brand,
			country = %intent.country_code,
			side = %intent.merchant_side(),
			"gift card quote filter pass"
		);

		let mut matches = score(candidates, intent, self.weights);
		matches.truncate(self.max_results);

		Ok(GiftCardRankingResult {
			matches,
			total_considered,
			total_filtered_out,
		})
	}

	async fn load_operator_index(&self) -> GiftCardRankerResult<HashMap<String, Operator>> {
		// One SELECT rather than N+1, same reasoning as the swap ranker: the
		// operator set is small and this sits on the quote hot path.
		let operators = self
			.storage
			.list_operators()
			.await
			.map_err(|e| GiftCardRankerError::Storage(e.to_string()))?;
		Ok(operators
			.into_iter()
			.map(|op| (op.solver_id.clone(), op))
			.collect())
	}
}

/// Keep only the quotes that can actually fill this intent.
///
/// Free function so the filter is testable without a storage double — the
/// matching rules are where a gift card order goes to the wrong merchant,
/// and they deserve tests that do not need a database.
fn filter_candidates(
	all: Vec<GiftCardQuote>,
	intent: &GiftCardIntent,
	operators: &HashMap<String, Operator>,
) -> Vec<(GiftCardQuote, Option<Operator>)> {
	let now = Utc::now();
	let wanted_side = intent.merchant_side();
	let wanted_brand = intent.brand.trim().to_ascii_lowercase();
	let wanted_country = intent.country_code.trim().to_ascii_uppercase();

	let mut kept = Vec::new();

	for q in all.into_iter().filter(|q| !q.paused) {
		// An unparseable expiry counts as expired — see
		// `GiftCardQuote::is_expired_at`. A quote whose validity cannot be
		// established must not be matched.
		if q.is_expired_at(now) {
			debug!(quote_id = %q.id, "skipping expired gift card quote");
			continue;
		}

		if q.side != wanted_side
			|| q.card_type != intent.card_type
			|| q.brand.trim().to_ascii_lowercase() != wanted_brand
			|| q.country_code.trim().to_ascii_uppercase() != wanted_country
		{
			continue;
		}

		// Face-value band. A band whose bounds will not parse is skipped
		// rather than treated as unbounded: the alternative is matching a
		// $500 card against a merchant who meant to cap at $100.
		let (Some(min), Some(max)) = (parse_minor(&q.min_face), parse_minor(&q.max_face)) else {
			debug!(quote_id = %q.id, "skipping gift card quote with unparseable band");
			continue;
		};
		if intent.face_minor_units < min || intent.face_minor_units > max {
			continue;
		}

		if let Some(excl) = q.exclusive_for.as_deref() {
			if !excl.eq_ignore_ascii_case(&intent.user_address) {
				continue;
			}
		}

		let operator = operators.get(&q.solver_id).cloned();
		if let Some(op) = &operator {
			if op.circuit_breaker_open {
				debug!(solver_id = %q.solver_id, "skipping circuit-broken merchant");
				continue;
			}
		}

		kept.push((q, operator));
	}

	kept
}

/// Score and sort. Best first.
///
/// The payout term is normalised against the best payout in the set, and its
/// polarity depends on direction: when the user is **selling** a higher
/// payout is better, but when the user is **buying** a higher payout means a
/// more expensive card, so the ordering inverts. Getting this wrong would
/// rank the worst price first for every buyer.
fn score(
	candidates: Vec<(GiftCardQuote, Option<Operator>)>,
	intent: &GiftCardIntent,
	weights: RankingWeights,
) -> Vec<ScoredGiftCardQuote> {
	if candidates.is_empty() {
		return Vec::new();
	}

	let with_payouts: Vec<(GiftCardQuote, Option<Operator>, u128)> = candidates
		.into_iter()
		.map(|(q, op)| {
			let payout = compute_payout_minor_units(intent.face_minor_units, &q);
			(q, op, payout)
		})
		.collect();

	let best = with_payouts.iter().map(|(_, _, p)| *p).max().unwrap_or(0);
	let cheapest = with_payouts.iter().map(|(_, _, p)| *p).min().unwrap_or(0);

	let mut scored: Vec<ScoredGiftCardQuote> = with_payouts
		.into_iter()
		.map(|(q, op, payout)| {
			let payout_norm = if intent.user_is_selling {
				// More is better.
				if best == 0 {
					0.0
				} else {
					payout as f64 / best as f64
				}
			} else {
				// Less is better: the cheapest offer normalises to 1.0.
				if payout == 0 {
					1.0
				} else {
					cheapest as f64 / payout as f64
				}
			};

			let reputation = op
				.as_ref()
				.map(|o| o.reputation_score.clamp(0.0, 1.0))
				.unwrap_or(0.5);

			let success_rate = op
				.as_ref()
				.filter(|o| o.fills_total > 0)
				.map(|o| o.fills_succeeded as f64 / o.fills_total as f64)
				.unwrap_or(1.0);

			let latency_norm = op
				.as_ref()
				.map(|o| (1.0 - (o.avg_latency_ms as f64 / 1000.0)).clamp(0.0, 1.0))
				.unwrap_or(1.0);

			let composite = weights.output * payout_norm
				+ weights.reputation * reputation
				+ weights.success_rate * success_rate
				+ weights.latency * latency_norm;

			ScoredGiftCardQuote {
				quote: q,
				payout_minor_units: payout,
				payout_norm,
				reputation,
				success_rate,
				latency_norm,
				composite_score: composite,
			}
		})
		.collect();

	scored.sort_by(|a, b| {
		b.composite_score
			.partial_cmp(&a.composite_score)
			.unwrap_or(std::cmp::Ordering::Equal)
	});
	scored
}

fn parse_minor(s: &str) -> Option<u128> {
	s.trim().parse::<u128>().ok()
}

/// Apply a quote's rate to a face value.
///
/// Face value and payout are both expressed in minor units, but of
/// *different* currencies — cents of the card's currency in, minor units of
/// the payout token out. They happen to coincide for a USD card paid in a
/// 6-decimal stablecoin only after scaling, so the scale factor is applied
/// here rather than assumed away.
fn compute_payout_minor_units(face_minor_units: u128, q: &GiftCardQuote) -> u128 {
	let rate = q.quote.parse::<f64>().unwrap_or(0.0).clamp(0.0, 2.0);
	let fixed = q
		.fixed_cost
		.as_deref()
		.and_then(|s| s.trim().parse::<u128>().ok())
		.unwrap_or(0);

	// Re-scale from the card's minor units to the payout token's.
	let scale = 10f64.powi(i32::from(q.payout_decimals) - i32::from(q.face_decimals));
	let raw = (face_minor_units as f64) * rate * scale;
	if !raw.is_finite() || raw < 0.0 {
		return 0;
	}
	(raw as u128).saturating_sub(fixed)
}

#[cfg(test)]
mod tests {
	use super::*;
	use oif_types::NewGiftCardQuote;

	fn quote(id: &str, side: GiftCardSide, rate: &str) -> GiftCardQuote {
		GiftCardQuote::new(NewGiftCardQuote {
			id: id.into(),
			solver_id: format!("solver-{id}"),
			side,
			product_id: None,
			brand: "Amazon".into(),
			country_code: "US".into(),
			currency: "USD".into(),
			card_type: GiftCardType::Ecode,
			face_decimals: 2,
			min_face: "2500".into(),
			max_face: "50000".into(),
			quote: rate.into(),
			fixed_cost: None,
			payout_chain: "eip155:84532".into(),
			payout_asset: "USDC".into(),
			payout_decimals: 6,
			expiry: "2099-01-01T00:00:00Z".into(),
			exclusive_for: None,
		})
	}

	fn intent(user_is_selling: bool, face: u128) -> GiftCardIntent {
		GiftCardIntent {
			user_is_selling,
			brand: "Amazon".into(),
			country_code: "US".into(),
			card_type: GiftCardType::Ecode,
			face_minor_units: face,
			user_address: "0xuser".into(),
		}
	}

	fn no_operators() -> HashMap<String, Operator> {
		HashMap::new()
	}

	#[test]
	fn a_user_selling_matches_merchant_buy_quotes() {
		assert_eq!(intent(true, 10_000).merchant_side(), GiftCardSide::Buy);
		assert_eq!(intent(false, 10_000).merchant_side(), GiftCardSide::Sell);
	}

	#[test]
	fn the_opposite_side_is_never_matched() {
		let all = vec![quote("a", GiftCardSide::Sell, "0.94")];
		let kept = filter_candidates(all, &intent(true, 10_000), &no_operators());
		assert!(kept.is_empty(), "a seller was matched to a sell quote");
	}

	#[test]
	fn a_face_value_outside_the_band_is_filtered() {
		let all = vec![quote("a", GiftCardSide::Buy, "0.88")];
		// Band is 2500..50000 minor units; 60000 is above it.
		let kept = filter_candidates(all, &intent(true, 60_000), &no_operators());
		assert!(kept.is_empty());
	}

	#[test]
	fn brand_and_country_match_case_insensitively() {
		let all = vec![quote("a", GiftCardSide::Buy, "0.88")];
		let mut i = intent(true, 10_000);
		i.brand = "amazon".into();
		i.country_code = "us".into();
		assert_eq!(filter_candidates(all, &i, &no_operators()).len(), 1);
	}

	#[test]
	fn a_different_country_is_a_different_asset() {
		let mut q = quote("a", GiftCardSide::Buy, "0.88");
		q.country_code = "GB".into();
		let kept = filter_candidates(vec![q], &intent(true, 10_000), &no_operators());
		assert!(kept.is_empty(), "a UK card was offered to a US intent");
	}

	#[test]
	fn a_paused_or_expired_quote_is_off_the_book() {
		let mut paused = quote("a", GiftCardSide::Buy, "0.88");
		paused.paused = true;
		assert!(filter_candidates(vec![paused], &intent(true, 10_000), &no_operators()).is_empty());

		let mut expired = quote("b", GiftCardSide::Buy, "0.88");
		expired.expiry = "2000-01-01T00:00:00Z".into();
		assert!(filter_candidates(vec![expired], &intent(true, 10_000), &no_operators()).is_empty());
	}

	#[test]
	fn an_unparseable_band_is_skipped_not_treated_as_unbounded() {
		let mut q = quote("a", GiftCardSide::Buy, "0.88");
		q.max_face = "lots".into();
		assert!(filter_candidates(vec![q], &intent(true, 10_000), &no_operators()).is_empty());
	}

	#[test]
	fn an_exclusive_quote_only_matches_its_user() {
		let mut q = quote("a", GiftCardSide::Buy, "0.88");
		q.exclusive_for = Some("0xSomeoneElse".into());
		assert!(filter_candidates(vec![q.clone()], &intent(true, 10_000), &no_operators()).is_empty());

		q.exclusive_for = Some("0xUSER".into());
		assert_eq!(
			filter_candidates(vec![q], &intent(true, 10_000), &no_operators()).len(),
			1,
			"exclusivity should compare addresses case-insensitively"
		);
	}

	#[test]
	fn payout_scales_from_card_cents_to_token_minor_units() {
		// A $100 card (10_000 cents) at 0.88 pays $88, which in a 6-decimal
		// token is 88_000_000 — not 8_800.
		let q = quote("a", GiftCardSide::Buy, "0.88");
		assert_eq!(compute_payout_minor_units(10_000, &q), 88_000_000);
	}

	#[test]
	fn a_fixed_cost_is_deducted_from_the_payout() {
		let mut q = quote("a", GiftCardSide::Buy, "0.88");
		q.fixed_cost = Some("1000000".into()); // $1
		assert_eq!(compute_payout_minor_units(10_000, &q), 87_000_000);
	}

	#[test]
	fn a_seller_is_offered_the_highest_payout_first() {
		let candidates = vec![
			(quote("low", GiftCardSide::Buy, "0.80"), None),
			(quote("high", GiftCardSide::Buy, "0.90"), None),
			(quote("mid", GiftCardSide::Buy, "0.85"), None),
		];
		let ranked = score(candidates, &intent(true, 10_000), RankingWeights::default());
		assert_eq!(ranked[0].quote.id, "high");
		assert_eq!(ranked[2].quote.id, "low");
	}

	#[test]
	fn a_buyer_is_offered_the_cheapest_price_first() {
		// The polarity flip: for a buyer, a bigger payout is a worse deal.
		let candidates = vec![
			(quote("dear", GiftCardSide::Sell, "0.99"), None),
			(quote("cheap", GiftCardSide::Sell, "0.91"), None),
			(quote("mid", GiftCardSide::Sell, "0.95"), None),
		];
		let ranked = score(candidates, &intent(false, 10_000), RankingWeights::default());
		assert_eq!(ranked[0].quote.id, "cheap");
		assert_eq!(ranked[2].quote.id, "dear");
	}
}
