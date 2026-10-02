//! GiftCardQuote domain model — standing gift card terms published by a
//! merchant operator.
//!
//! Gift cards ride the same rail as crypto swaps: the same operator
//! registration, the same ranking, the same claim queue, the same OIF
//! escrow for the money leg. [`GiftCardQuote`] therefore mirrors
//! [`crate::SolverQuote`] wherever the meaning is identical, and diverges
//! only where the asset genuinely differs.
//!
//! The one structural difference worth stating up front: in a swap both
//! legs are verifiable on-chain, so release can be *proven*. Here the card
//! leg is a fact about a brand's database and no contract can check it, so
//! release is *attested* — and because an attestation can be wrong or
//! withheld, [`GiftCardSide`] is load-bearing. It decides who funds escrow
//! first and which way a silence timeout resolves.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// Trade direction, named from the **merchant's** point of view.
///
/// Reading these the wrong way round inverts the settlement path, so the
/// user-facing phrasing is spelled out on each variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum GiftCardSide {
	/// Merchant **buys** the card from a user — i.e. the user is *selling*.
	///
	/// The merchant funds escrow first, because they hold the verifiable
	/// asset (USDC) and the user holds the one nobody can check. If the
	/// merchant then goes silent, the timeout releases to the **user**.
	Buy,
	/// Merchant **sells** a card to a user — i.e. the user is *buying*.
	///
	/// The user funds escrow, through the same Permit2 path as a swap.
	/// Once the code is delivered the user holds the unverifiable asset,
	/// so silence releases to the **merchant**.
	Sell,
}

impl GiftCardSide {
	pub fn as_str(&self) -> &'static str {
		match self {
			Self::Buy => "buy",
			Self::Sell => "sell",
		}
	}

	/// True when the **merchant** funds escrow before the counterparty
	/// hands anything over. See the variant docs for why this is not
	/// symmetric.
	pub fn merchant_funds_escrow(&self) -> bool {
		matches!(self, Self::Buy)
	}
}

impl fmt::Display for GiftCardSide {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(self.as_str())
	}
}

impl FromStr for GiftCardSide {
	type Err = String;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s.trim().to_ascii_lowercase().as_str() {
			"buy" => Ok(Self::Buy),
			"sell" => Ok(Self::Sell),
			other => Err(format!("unknown gift card side: {other}")),
		}
	}
}

/// How the card is delivered. `Physical` carries materially more risk — it
/// needs photographs and usually a purchase receipt — so merchants price
/// and cap the two separately rather than quoting one rate for both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum GiftCardType {
	/// Digital code, delivered as ciphertext to the counterparty's wallet key.
	Ecode,
	/// Physical card, evidenced by images of the card and the receipt.
	Physical,
}

impl GiftCardType {
	pub fn as_str(&self) -> &'static str {
		match self {
			Self::Ecode => "ecode",
			Self::Physical => "physical",
		}
	}
}

impl fmt::Display for GiftCardType {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(self.as_str())
	}
}

impl FromStr for GiftCardType {
	type Err = String;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s.trim().to_ascii_lowercase().as_str() {
			"ecode" | "e-code" | "digital" => Ok(Self::Ecode),
			"physical" | "plastic" => Ok(Self::Physical),
			other => Err(format!("unknown gift card type: {other}")),
		}
	}
}

/// One merchant's standing terms for one gift card asset, in one direction,
/// over one face-value band.
///
/// A merchant quoting $25–$100 and $100–$500 at different rates publishes
/// **two** rows, exactly as a solver publishes one row per `QuoteRangeDto`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GiftCardQuote {
	pub id: String,
	pub solver_id: String,
	pub side: GiftCardSide,

	/// Optional pointer into the API gateway's `giftcard_products` catalog.
	/// Absent for a brand the merchant supports that the catalog does not
	/// list — the quote still matches on the triple below.
	pub product_id: Option<i32>,
	pub brand: String,
	/// ISO-3166-1 alpha-2. Load-bearing, not cosmetic: a UK code will not
	/// redeem against a US account, so country is part of the asset
	/// identity rather than a label on it.
	pub country_code: String,
	pub currency: String,
	pub card_type: GiftCardType,

	/// Face-value band, in the card currency's minor units.
	pub face_decimals: u8,
	pub min_face: String,
	pub max_face: String,

	/// Multiplier on face value. Same semantics as [`crate::SolverQuote::quote`].
	pub quote: String,
	pub fixed_cost: Option<String>,

	/// The money leg — a real chain and token, settled through escrow.
	pub payout_chain: String,
	pub payout_asset: String,
	pub payout_decimals: u8,

	pub expiry: String,
	pub exclusive_for: Option<String>,
	pub paused: bool,
	pub created_at: DateTime<Utc>,
	pub updated_at: DateTime<Utc>,
}

/// Everything needed to create a [`GiftCardQuote`] except the generated
/// timestamps and the `paused` default.
///
/// This is a struct rather than a 19-argument constructor because
/// `SolverQuote::new` already sits at fourteen positional parameters of
/// which six are strings, and adding five more would make a transposed
/// argument — say `brand` and `country_code`, or the two face bounds —
/// both silent and expensive.
#[derive(Debug, Clone)]
pub struct NewGiftCardQuote {
	pub id: String,
	pub solver_id: String,
	pub side: GiftCardSide,
	pub product_id: Option<i32>,
	pub brand: String,
	pub country_code: String,
	pub currency: String,
	pub card_type: GiftCardType,
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
}

impl GiftCardQuote {
	pub fn new(fields: NewGiftCardQuote) -> Self {
		let now = Utc::now();
		Self {
			id: fields.id,
			solver_id: fields.solver_id,
			side: fields.side,
			product_id: fields.product_id,
			brand: fields.brand,
			country_code: fields.country_code,
			currency: fields.currency,
			card_type: fields.card_type,
			face_decimals: fields.face_decimals,
			min_face: fields.min_face,
			max_face: fields.max_face,
			quote: fields.quote,
			fixed_cost: fields.fixed_cost,
			payout_chain: fields.payout_chain,
			payout_asset: fields.payout_asset,
			payout_decimals: fields.payout_decimals,
			expiry: fields.expiry,
			exclusive_for: fields.exclusive_for,
			paused: false,
			created_at: now,
			updated_at: now,
		}
	}

	/// The key the ranker matches a user intent against. Brand and country
	/// are compared case-insensitively because merchants type them by hand.
	pub fn book_key(&self) -> String {
		format!(
			"{}|{}|{}|{}",
			self.side,
			self.brand.to_ascii_lowercase(),
			self.country_code.to_ascii_uppercase(),
			self.card_type,
		)
	}

	/// True when this quote is expired as of `now`. An unparseable expiry
	/// counts as expired: a quote whose validity cannot be established must
	/// not be matched, since the merchant may no longer honour it.
	pub fn is_expired_at(&self, now: DateTime<Utc>) -> bool {
		match DateTime::parse_from_rfc3339(&self.expiry) {
			Ok(exp) => exp.with_timezone(&Utc) <= now,
			Err(_) => true,
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn sample() -> GiftCardQuote {
		GiftCardQuote::new(NewGiftCardQuote {
			id: "gcq-1".into(),
			solver_id: "solver-abc".into(),
			side: GiftCardSide::Buy,
			product_id: Some(42),
			brand: "Amazon".into(),
			country_code: "US".into(),
			currency: "USD".into(),
			card_type: GiftCardType::Ecode,
			face_decimals: 2,
			min_face: "2500".into(),
			max_face: "50000".into(),
			quote: "0.88".into(),
			fixed_cost: None,
			payout_chain: "eip155:84532".into(),
			payout_asset: "USDC".into(),
			payout_decimals: 6,
			expiry: "2099-01-01T00:00:00Z".into(),
			exclusive_for: None,
		})
	}

	#[test]
	fn side_round_trips_through_strings() {
		for s in [GiftCardSide::Buy, GiftCardSide::Sell] {
			assert_eq!(GiftCardSide::from_str(s.as_str()).unwrap(), s);
		}
		assert_eq!(GiftCardSide::from_str("BUY").unwrap(), GiftCardSide::Buy);
		assert!(GiftCardSide::from_str("neither").is_err());
	}

	#[test]
	fn card_type_accepts_the_spellings_merchants_actually_send() {
		for s in ["ecode", "e-code", "digital", "ECODE"] {
			assert_eq!(GiftCardType::from_str(s).unwrap(), GiftCardType::Ecode);
		}
		for s in ["physical", "plastic", "Physical"] {
			assert_eq!(GiftCardType::from_str(s).unwrap(), GiftCardType::Physical);
		}
	}

	#[test]
	fn only_the_buy_side_has_the_merchant_fund_escrow_first() {
		assert!(GiftCardSide::Buy.merchant_funds_escrow());
		assert!(!GiftCardSide::Sell.merchant_funds_escrow());
	}

	#[test]
	fn book_key_normalises_hand_typed_brand_and_country() {
		let mut q = sample();
		let canonical = q.book_key();
		q.brand = "AMAZON".into();
		q.country_code = "us".into();
		assert_eq!(q.book_key(), canonical);
	}

	#[test]
	fn book_key_separates_the_two_directions() {
		let buy = sample();
		let mut sell = sample();
		sell.side = GiftCardSide::Sell;
		assert_ne!(buy.book_key(), sell.book_key());
	}

	#[test]
	fn an_unparseable_expiry_counts_as_expired() {
		let mut q = sample();
		assert!(!q.is_expired_at(Utc::now()));
		q.expiry = "whenever".into();
		assert!(q.is_expired_at(Utc::now()));
	}
}
