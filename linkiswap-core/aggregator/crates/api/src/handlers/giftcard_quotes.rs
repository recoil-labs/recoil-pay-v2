//! Gift card quote handlers — the merchant side of the gift card book.
//!
//! These mirror the `solver_api` quote handlers (`post_quotes_submit`,
//! `get_solver_quotes`, `delete_solver_quote`, `toggle_pause_solver_quote`)
//! because a merchant manages gift card terms exactly the way a solver
//! manages swap terms. The differences are all in validation: a gift card
//! quote names an asset no contract can verify, so the fields that decide
//! the settlement path are checked here rather than trusted.

use axum::{
	extract::{Path, Query, State},
	http::StatusCode,
	response::Json,
};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use tracing::{error, info, warn};

use crate::handlers::common::ErrorResponse;
use crate::state::AppState;
use oif_service::{GiftCardIntent, GiftCardRanker};
use oif_types::{GiftCardQuote, GiftCardSide, GiftCardType, NewGiftCardQuote};

// ─── DTOs ─────────────────────────────────────────────────────────────────────

/// One face-value band and the rate that applies to it.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GiftCardRangeDto {
	/// Inclusive lower bound of the band, in the card currency's minor units.
	#[serde(default, alias = "minFace")]
	pub min_face: String,
	/// Inclusive upper bound, same units.
	#[serde(default, alias = "maxFace")]
	pub max_face: String,
	/// Multiplier on face value — `"0.88"` means a $100 card pays out $88.
	pub quote: String,
	#[serde(default, alias = "fixedCost")]
	pub fixed_cost: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GiftCardQuoteSubmitDto {
	/// `"buy"` (merchant buys from a user) or `"sell"` (merchant sells to one).
	pub side: String,
	#[serde(default, alias = "productId")]
	pub product_id: Option<i32>,
	pub brand: String,
	#[serde(default, alias = "countryCode", alias = "country")]
	pub country_code: String,
	#[serde(default = "default_currency")]
	pub currency: String,
	#[serde(default = "default_card_type", alias = "cardType")]
	pub card_type: String,
	#[serde(default = "default_face_decimals", alias = "faceDecimals")]
	pub face_decimals: u8,
	/// Unix timestamp in seconds, matching the swap quote submission shape.
	pub expiry: u64,
	#[serde(default, alias = "payoutChain", alias = "payoutChainId")]
	pub payout_chain: String,
	#[serde(default, alias = "payoutAsset")]
	pub payout_asset: String,
	#[serde(default = "default_payout_decimals", alias = "payoutDecimals")]
	pub payout_decimals: u8,
	pub ranges: Vec<GiftCardRangeDto>,
	#[serde(default, alias = "exclusiveFor")]
	pub exclusive_for: Option<String>,
}

fn default_currency() -> String {
	"USD".to_string()
}

fn default_card_type() -> String {
	"ecode".to_string()
}

fn default_face_decimals() -> u8 {
	2
}

fn default_payout_decimals() -> u8 {
	6
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BatchGiftCardQuotesRequest {
	pub quotes: Vec<GiftCardQuoteSubmitDto>,
	#[serde(default, alias = "solverId", alias = "solver_id")]
	pub solver_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftCardQuotesSubmitResponse {
	pub status: String,
	pub quotes_added: usize,
	/// Per-quote rejection reasons. A submission that is partly valid still
	/// persists the valid rows — a merchant republishing fifty bands should
	/// not lose forty-nine of them to one typo — but it must be told which
	/// ones did not land, because a silently missing band is a quote the
	/// merchant believes they are honouring and the book has never seen.
	#[serde(skip_serializing_if = "Vec::is_empty")]
	pub rejected: Vec<GiftCardQuoteRejection>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftCardQuoteRejection {
	/// Index into the submitted `quotes` array.
	pub index: usize,
	pub brand: String,
	pub reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftCardQuoteDto {
	pub id: String,
	pub solver_id: String,
	pub side: String,
	pub product_id: Option<i32>,
	pub brand: String,
	pub country_code: String,
	pub currency: String,
	pub card_type: String,
	pub face_decimals: u8,
	pub min_face: String,
	pub max_face: String,
	pub quote: String,
	pub fixed_cost: Option<String>,
	pub payout_chain: String,
	pub payout_asset: String,
	pub payout_decimals: u8,
	pub expiry: String,
	pub exclusive_for: Option<String>,
	pub paused: bool,
	pub created_at: String,
	pub updated_at: String,
}

impl From<GiftCardQuote> for GiftCardQuoteDto {
	fn from(q: GiftCardQuote) -> Self {
		Self {
			id: q.id,
			solver_id: q.solver_id,
			side: q.side.to_string(),
			product_id: q.product_id,
			brand: q.brand,
			country_code: q.country_code,
			currency: q.currency,
			card_type: q.card_type.to_string(),
			face_decimals: q.face_decimals,
			min_face: q.min_face,
			max_face: q.max_face,
			quote: q.quote,
			fixed_cost: q.fixed_cost,
			payout_chain: q.payout_chain,
			payout_asset: q.payout_asset,
			payout_decimals: q.payout_decimals,
			expiry: q.expiry,
			exclusive_for: q.exclusive_for,
			paused: q.paused,
			created_at: q.created_at.to_rfc3339(),
			updated_at: q.updated_at.to_rfc3339(),
		}
	}
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetGiftCardQuotesResponse {
	pub data: Vec<GiftCardQuoteDto>,
}

#[derive(Debug, Deserialize)]
pub struct ListGiftCardQuotesQuery {
	#[serde(default, alias = "solverId")]
	pub solver_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteGiftCardQuoteResponse {
	pub success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ToggleGiftCardPauseResponse {
	pub success: bool,
	pub paused: Option<bool>,
}

/// A user's ask, phrased from the **user's** point of view — which is the
/// opposite of a quote's `side`. Someone selling a card matches merchant
/// `buy` quotes. The flip happens once, inside [`GiftCardIntent`], so no
/// caller performs it twice.
#[derive(Debug, Deserialize)]
pub struct RankQuotesRequest {
	/// True when the user holds a card and wants money for it.
	#[serde(alias = "userIsSelling")]
	pub user_is_selling: bool,
	pub brand: String,
	#[serde(alias = "countryCode", alias = "country")]
	pub country_code: String,
	#[serde(default = "default_card_type", alias = "cardType")]
	pub card_type: String,
	/// Face value in the card currency's minor units.
	#[serde(alias = "faceMinorUnits")]
	pub face_minor_units: String,
	#[serde(default, alias = "userAddress")]
	pub user_address: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedOfferDto {
	pub quote_id: String,
	pub solver_id: String,
	pub brand: String,
	pub country_code: String,
	pub currency: String,
	pub card_type: String,
	pub rate: String,
	/// What the user receives (selling) or pays (buying), in the payout
	/// token's minor units.
	pub payout_minor_units: String,
	pub payout_chain: String,
	pub payout_asset: String,
	pub payout_decimals: u8,
	/// Ranking inputs, surfaced so a client can explain an ordering that is
	/// deliberately not purely price-first.
	pub reputation: f64,
	pub success_rate: f64,
	pub composite_score: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankQuotesResponse {
	pub data: Vec<RankedOfferDto>,
	pub total_considered: usize,
	pub total_filtered_out: usize,
}

// ─── Validation ───────────────────────────────────────────────────────────────

/// Upper bound on a published rate. A gift card trades at a discount to face
/// on both sides, so anything at or above 2.0 is a misplaced decimal point,
/// not a generous merchant. Rejecting it here stops a fat-fingered `"88"`
/// (meant as 0.88) from topping the book and winning every match.
const MAX_RATE: f64 = 2.0;

/// Validated, storage-ready form of one submitted band.
#[derive(Debug)]
struct ValidatedBand {
	min_face: u128,
	max_face: u128,
	quote: String,
	fixed_cost: Option<String>,
}

fn parse_minor_units(s: &str, field: &str) -> Result<u128, String> {
	s.trim()
		.parse::<u128>()
		.map_err(|_| format!("{field} must be a whole number of minor units, got {s:?}"))
}

fn validate_band(r: &GiftCardRangeDto) -> Result<ValidatedBand, String> {
	let min_face = parse_minor_units(&r.min_face, "minFace")?;
	let max_face = parse_minor_units(&r.max_face, "maxFace")?;
	if max_face == 0 {
		return Err("maxFace must be greater than zero".to_string());
	}
	if min_face > max_face {
		return Err(format!("minFace {min_face} exceeds maxFace {max_face}"));
	}

	let rate = r
		.quote
		.trim()
		.parse::<f64>()
		.map_err(|_| format!("quote must be a decimal rate, got {:?}", r.quote))?;
	if !rate.is_finite() || rate <= 0.0 {
		return Err(format!("quote must be a positive rate, got {rate}"));
	}
	if rate >= MAX_RATE {
		return Err(format!(
			"quote {rate} is at or above {MAX_RATE} — rates are multipliers on face value, so 88% is 0.88, not 88"
		));
	}

	if let Some(fc) = r.fixed_cost.as_deref() {
		if !fc.trim().is_empty() {
			parse_minor_units(fc, "fixedCost")?;
		}
	}

	Ok(ValidatedBand {
		min_face,
		max_face,
		quote: r.quote.trim().to_string(),
		fixed_cost: r
			.fixed_cost
			.as_deref()
			.map(str::trim)
			.filter(|s| !s.is_empty())
			.map(str::to_string),
	})
}

/// Validate everything about a submitted quote that does not depend on
/// storage. Returns the parsed enums and the canonical country code.
fn validate_quote(
	q: &GiftCardQuoteSubmitDto,
) -> Result<(GiftCardSide, GiftCardType, String), String> {
	let side = GiftCardSide::from_str(&q.side)?;
	let card_type = GiftCardType::from_str(&q.card_type)?;

	if q.brand.trim().is_empty() {
		return Err("brand is required".to_string());
	}

	// Country is part of the asset's identity, not a label on it: a UK code
	// will not redeem against a US account, so a quote that does not say
	// which country it covers cannot be matched safely.
	let country = q.country_code.trim().to_ascii_uppercase();
	if country.len() != 2 || !country.chars().all(|c| c.is_ascii_alphabetic()) {
		return Err(format!(
			"countryCode must be a 2-letter ISO-3166-1 alpha-2 code, got {:?}",
			q.country_code
		));
	}

	// The money leg settles through the same escrow as a swap, so it has to
	// name a real chain and token. Without these the quote can be ranked but
	// never paid.
	if q.payout_chain.trim().is_empty() {
		return Err("payoutChain is required (CAIP-2, e.g. eip155:84532)".to_string());
	}
	if q.payout_asset.trim().is_empty() {
		return Err("payoutAsset is required (e.g. USDC)".to_string());
	}

	if q.ranges.is_empty() {
		return Err("at least one range is required".to_string());
	}

	Ok((side, card_type, country))
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/// POST /solver-api/giftcard-quotes/submit — publish gift card terms.
///
/// Partial success is deliberate: valid bands persist, invalid ones come back
/// in `rejected`. See [`GiftCardQuotesSubmitResponse::rejected`].
pub async fn post_giftcard_quotes_submit(
	State(state): State<AppState>,
	Json(payload): Json<BatchGiftCardQuotesRequest>,
) -> Result<Json<GiftCardQuotesSubmitResponse>, (StatusCode, Json<ErrorResponse>)> {
	info!(
		"Received gift card quote submission for {} quotes",
		payload.quotes.len()
	);

	let solver_id = payload
		.solver_id
		.as_deref()
		.map(str::trim)
		.filter(|s| !s.is_empty())
		.unwrap_or("anonymous")
		.to_string();

	let now = chrono::Utc::now();
	let mut count = 0usize;
	let mut rejected: Vec<GiftCardQuoteRejection> = Vec::new();

	for (i, q) in payload.quotes.iter().enumerate() {
		let (side, card_type, country) = match validate_quote(q) {
			Ok(parsed) => parsed,
			Err(reason) => {
				warn!(index = i, brand = %q.brand, reason = %reason, "rejecting gift card quote");
				rejected.push(GiftCardQuoteRejection {
					index: i,
					brand: q.brand.clone(),
					reason,
				});
				continue;
			}
		};

		let expiry_ts = chrono::DateTime::from_timestamp(q.expiry as i64, 0)
			.unwrap_or(now)
			.to_rfc3339();

		for (j, range) in q.ranges.iter().enumerate() {
			let band = match validate_band(range) {
				Ok(b) => b,
				Err(reason) => {
					warn!(index = i, band = j, reason = %reason, "rejecting gift card band");
					rejected.push(GiftCardQuoteRejection {
						index: i,
						brand: q.brand.clone(),
						reason: format!("range {j}: {reason}"),
					});
					continue;
				}
			};

			// The id carries BOTH indices. The swap-side handler derives its
			// id from the quote index alone while inserting inside the range
			// loop, so every band of a multi-band quote collides on the
			// primary key and all but the first are lost.
			let id = format!("gcq-{}-{}-{}", now.timestamp_millis(), i, j);

			let quote = GiftCardQuote::new(NewGiftCardQuote {
				id,
				solver_id: solver_id.clone(),
				side,
				product_id: q.product_id,
				brand: q.brand.trim().to_string(),
				country_code: country.clone(),
				currency: q.currency.trim().to_ascii_uppercase(),
				card_type,
				face_decimals: q.face_decimals,
				min_face: band.min_face.to_string(),
				max_face: band.max_face.to_string(),
				quote: band.quote,
				fixed_cost: band.fixed_cost,
				payout_chain: q.payout_chain.trim().to_string(),
				payout_asset: q.payout_asset.trim().to_string(),
				payout_decimals: q.payout_decimals,
				expiry: expiry_ts.clone(),
				exclusive_for: q.exclusive_for.clone(),
			});

			match state.storage.create_giftcard_quote(quote).await {
				Ok(_) => count += 1,
				Err(e) => {
					error!("Failed to persist gift card quote: {}", e);
					rejected.push(GiftCardQuoteRejection {
						index: i,
						brand: q.brand.clone(),
						reason: format!("range {j}: storage error: {e}"),
					});
				}
			}
		}
	}

	Ok(Json(GiftCardQuotesSubmitResponse {
		status: if rejected.is_empty() { "success" } else { "partial" }.to_string(),
		quotes_added: count,
		rejected,
	}))
}

/// POST /api/v1/giftcard-quotes/rank — match a user intent against the book.
///
/// Public: this is the price discovery a user does before committing to
/// anything, and it exposes only what the book already publishes.
pub async fn rank_giftcard_quotes(
	State(state): State<AppState>,
	Json(req): Json<RankQuotesRequest>,
) -> Result<Json<RankQuotesResponse>, (StatusCode, Json<ErrorResponse>)> {
	let card_type = GiftCardType::from_str(&req.card_type).map_err(|e| {
		(
			StatusCode::BAD_REQUEST,
			Json(ErrorResponse {
				error: "bad_card_type".into(),
				message: e,
				timestamp: chrono::Utc::now().timestamp(),
			}),
		)
	})?;

	let face: u128 = req.face_minor_units.trim().parse().map_err(|_| {
		(
			StatusCode::BAD_REQUEST,
			Json(ErrorResponse {
				error: "bad_amount".into(),
				message: "faceMinorUnits must be a whole number of minor units".into(),
				timestamp: chrono::Utc::now().timestamp(),
			}),
		)
	})?;

	let intent = GiftCardIntent {
		user_is_selling: req.user_is_selling,
		brand: req.brand.clone(),
		country_code: req.country_code.clone(),
		card_type,
		face_minor_units: face,
		// Empty rather than rejected: an address is only needed to honour
		// `exclusive_for`, and browsing rates before connecting a wallet is
		// the normal first thing a visitor does.
		user_address: req.user_address.clone().unwrap_or_default(),
	};

	let ranked = GiftCardRanker::new(state.storage.clone())
		.rank(&intent)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "ranking_failed".into(),
					message: e.to_string(),
					timestamp: chrono::Utc::now().timestamp(),
				}),
			)
		})?;

	let data = ranked
		.matches
		.into_iter()
		.map(|m| RankedOfferDto {
			quote_id: m.quote.id,
			solver_id: m.quote.solver_id,
			brand: m.quote.brand,
			country_code: m.quote.country_code,
			currency: m.quote.currency,
			card_type: m.quote.card_type.to_string(),
			rate: m.quote.quote,
			payout_minor_units: m.payout_minor_units.to_string(),
			payout_chain: m.quote.payout_chain,
			payout_asset: m.quote.payout_asset,
			payout_decimals: m.quote.payout_decimals,
			reputation: m.reputation,
			success_rate: m.success_rate,
			composite_score: m.composite_score,
		})
		.collect();

	Ok(Json(RankQuotesResponse {
		data,
		total_considered: ranked.total_considered,
		total_filtered_out: ranked.total_filtered_out,
	}))
}

/// GET /solver-api/giftcard-quotes — list the book, optionally one merchant's.
pub async fn get_giftcard_quotes(
	State(state): State<AppState>,
	Query(params): Query<ListGiftCardQuotesQuery>,
) -> Result<Json<GetGiftCardQuotesResponse>, (StatusCode, Json<ErrorResponse>)> {
	let quotes = state
		.storage
		.list_giftcard_quotes(params.solver_id.as_deref())
		.await
		.unwrap_or_default();
	let data = quotes.into_iter().map(GiftCardQuoteDto::from).collect();
	Ok(Json(GetGiftCardQuotesResponse { data }))
}

/// DELETE /solver-api/giftcard-quotes/{id} — withdraw a quote.
pub async fn delete_giftcard_quote(
	State(state): State<AppState>,
	Path(id): Path<String>,
) -> Json<DeleteGiftCardQuoteResponse> {
	let deleted = state
		.storage
		.delete_giftcard_quote(&id)
		.await
		.unwrap_or(false);
	Json(DeleteGiftCardQuoteResponse { success: deleted })
}

/// POST /solver-api/giftcard-quotes/{id}/pause — flip a quote off the book
/// without losing its terms.
pub async fn toggle_pause_giftcard_quote(
	State(state): State<AppState>,
	Path(id): Path<String>,
) -> Json<ToggleGiftCardPauseResponse> {
	let updated = state
		.storage
		.toggle_pause_giftcard_quote(&id)
		.await
		.unwrap_or(None);
	Json(ToggleGiftCardPauseResponse {
		success: updated.is_some(),
		paused: updated.map(|q| q.paused),
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	fn band(min: &str, max: &str, rate: &str) -> GiftCardRangeDto {
		GiftCardRangeDto {
			min_face: min.into(),
			max_face: max.into(),
			quote: rate.into(),
			fixed_cost: None,
		}
	}

	fn submit() -> GiftCardQuoteSubmitDto {
		GiftCardQuoteSubmitDto {
			side: "buy".into(),
			product_id: Some(1),
			brand: "Amazon".into(),
			country_code: "us".into(),
			currency: "USD".into(),
			card_type: "ecode".into(),
			face_decimals: 2,
			expiry: 4_000_000_000,
			payout_chain: "eip155:84532".into(),
			payout_asset: "USDC".into(),
			payout_decimals: 6,
			ranges: vec![band("2500", "50000", "0.88")],
			exclusive_for: None,
		}
	}

	#[test]
	fn accepts_a_well_formed_quote_and_upcases_the_country() {
		let (side, card_type, country) = validate_quote(&submit()).unwrap();
		assert_eq!(side, GiftCardSide::Buy);
		assert_eq!(card_type, GiftCardType::Ecode);
		assert_eq!(country, "US");
	}

	#[test]
	fn rejects_a_rate_that_looks_like_a_percentage() {
		// The failure this guards: "88" meant as 88%, which would outbid
		// every honest quote by a factor of 100.
		let err = validate_band(&band("2500", "50000", "88")).unwrap_err();
		assert!(err.contains("0.88"), "unhelpful message: {err}");
	}

	#[test]
	fn rejects_an_inverted_band() {
		let err = validate_band(&band("50000", "2500", "0.88")).unwrap_err();
		assert!(err.contains("exceeds"), "unhelpful message: {err}");
	}

	#[test]
	fn rejects_a_zero_ceiling_band() {
		assert!(validate_band(&band("0", "0", "0.88")).is_err());
	}

	#[test]
	fn rejects_decimal_face_values() {
		// Face bounds are minor units; "25.00" would silently truncate to 25
		// cents and the merchant would be quoting a band 100x too small.
		assert!(validate_band(&band("25.00", "500.00", "0.88")).is_err());
	}

	#[test]
	fn requires_a_two_letter_country() {
		for bad in ["", "USA", "U", "1S"] {
			let mut q = submit();
			q.country_code = bad.into();
			assert!(validate_quote(&q).is_err(), "accepted country {bad:?}");
		}
	}

	#[test]
	fn requires_the_payout_leg() {
		let mut q = submit();
		q.payout_chain = "  ".into();
		assert!(validate_quote(&q).is_err());

		let mut q = submit();
		q.payout_asset = String::new();
		assert!(validate_quote(&q).is_err());
	}

	#[test]
	fn requires_at_least_one_band() {
		let mut q = submit();
		q.ranges.clear();
		assert!(validate_quote(&q).is_err());
	}

	#[test]
	fn rejects_an_unknown_side() {
		let mut q = submit();
		q.side = "swap".into();
		assert!(validate_quote(&q).is_err());
	}
}
