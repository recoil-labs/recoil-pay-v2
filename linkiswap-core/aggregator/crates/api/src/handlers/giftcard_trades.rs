//! Gift card trade handlers — escrow, code hand-over, attestation, disputes.
//!
//! # Who is allowed to move a trade
//!
//! Every transition here decides where escrowed money goes, so no endpoint
//! takes the caller's word for who they are. There are exactly two ways to
//! prove it, and [`authorize_party`] is the only place either is accepted:
//!
//! - **Merchant** — `x-api-key`, resolved to an operator whose `solver_id`
//!   must equal the trade's.
//! - **User** — an EIP-191 signature over the trade id, whose recovered
//!   address must equal the trade's `user_address`.
//!
//! Which of the two is *required* depends on the direction, and the trade
//! works that out itself through `card_sender` / `card_receiver`. No handler
//! branches on `side`.
//!
//! # What the server never sees
//!
//! The code is encrypted client-side to the receiving party's wallet key.
//! What arrives here is an opaque envelope plus `keccak256` of the
//! plaintext. The aggregator holds no key that opens it, which is the
//! difference between a breach leaking order metadata and a breach draining
//! every card on the platform. Any change that makes the plaintext reachable
//! from this process defeats the whole design.

use alloy_primitives::{eip191_hash_message, Signature};
use axum::{
	extract::{Path, Query, State},
	http::{HeaderMap, StatusCode},
	response::Json,
};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use tracing::{info, warn};

use crate::handlers::common::ErrorResponse;
use crate::state::AppState;
use oif_service::{giftcard_exposure, ExpectedLock, DEFAULT_EXPOSURE_MULTIPLE};
use oif_types::{
	GiftCardQuote, GiftCardSide, GiftCardTrade, GiftCardTradeUpdate, Party, SealedCode, TradeState,
	Transition,
};

// ─── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateTradeRequest {
	#[serde(alias = "quoteId")]
	pub quote_id: String,
	/// Face value in the card currency's minor units.
	#[serde(alias = "faceMinorUnits")]
	pub face_minor_units: String,
	#[serde(alias = "userAddress")]
	pub user_address: String,
}

#[derive(Debug, Deserialize)]
pub struct EscrowFundedRequest {
	#[serde(alias = "txHash")]
	pub tx_hash: String,
	/// The caller's own secp256k1 public key, uncompressed `0x04…` hex.
	/// The code will be sealed to it. Verified against their address below.
	#[serde(alias = "recipientPubkey")]
	pub recipient_pubkey: String,
	#[serde(flatten)]
	pub auth: PartyAuth,
}

#[derive(Debug, Deserialize)]
pub struct DeliverCodeRequest {
	/// `keccak256` of the plaintext code, `0x`-prefixed.
	pub commitment: String,
	/// The sealed envelope. Opaque here.
	pub sealed: SealedCode,
	#[serde(flatten)]
	pub auth: PartyAuth,
}

#[derive(Debug, Deserialize)]
pub struct AttestRequest {
	/// True when the card verified good.
	pub valid: bool,
	#[serde(default)]
	pub reason: Option<String>,
	#[serde(flatten)]
	pub auth: PartyAuth,
}

#[derive(Debug, Deserialize)]
pub struct ResolveDisputeRequest {
	/// Which party receives the escrow: `"user"` or `"merchant"`.
	pub pays: String,
	pub note: String,
	/// Optional restitution from the merchant's bond, in the payout token's
	/// minor units. Omitted or `"0"` leaves the bond alone.
	#[serde(default, alias = "slashMinorUnits")]
	pub slash_minor_units: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DisputeRequest {
	pub reason: String,
	#[serde(flatten)]
	pub auth: PartyAuth,
}

/// A user proves themselves with a signature; a merchant with the `x-api-key`
/// header and sends nothing here.
#[derive(Debug, Default, Deserialize)]
pub struct PartyAuth {
	/// EIP-191 signature over the trade id.
	#[serde(default)]
	pub signature: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeDto {
	pub id: String,
	pub quote_id: String,
	pub solver_id: String,
	pub side: String,
	pub brand: String,
	pub country_code: String,
	pub currency: String,
	pub card_type: String,
	pub face_minor_units: String,
	pub rate: String,
	pub payout_chain: String,
	pub payout_asset: String,
	pub payout_minor_units: String,
	pub user_address: String,
	pub merchant_address: String,
	pub state: String,
	/// The key the code must be sealed to. The card sender reads this.
	pub recipient_pubkey: Option<String>,
	/// Who hands over the code, and who pays. Derived rather than stored, so
	/// a client never has to reason about `side` either.
	pub card_sender: String,
	pub card_receiver: String,
	pub funder: String,
	/// The party the current deadline is waiting on, if any.
	pub awaiting: Option<String>,
	pub code_commitment: Option<String>,
	pub sealed_code: Option<SealedCode>,
	pub deadline_at: Option<String>,
	pub resolution_note: Option<String>,
	pub escrow_tx_hash: Option<String>,
	pub release_tx_hash: Option<String>,
	pub created_at: String,
	pub updated_at: String,
}

impl From<GiftCardTrade> for TradeDto {
	fn from(t: GiftCardTrade) -> Self {
		let card_sender = t.card_sender().to_string();
		let card_receiver = t.card_receiver().to_string();
		let funder = t.funder().to_string();
		let awaiting = t.awaited_party().map(|p| p.to_string());
		Self {
			id: t.id,
			quote_id: t.quote_id,
			solver_id: t.solver_id,
			side: t.side.to_string(),
			brand: t.brand,
			country_code: t.country_code,
			currency: t.currency,
			card_type: t.card_type.to_string(),
			face_minor_units: t.face_minor_units,
			rate: t.rate,
			payout_chain: t.payout_chain,
			payout_asset: t.payout_asset,
			payout_minor_units: t.payout_minor_units,
			user_address: t.user_address,
			merchant_address: t.merchant_address,
			state: t.state.to_string(),
			recipient_pubkey: t.recipient_pubkey,
			card_sender,
			card_receiver,
			funder,
			awaiting,
			code_commitment: t.code_commitment,
			sealed_code: t.sealed_code,
			deadline_at: t.deadline_at.map(|d| d.to_rfc3339()),
			resolution_note: t.resolution_note,
			escrow_tx_hash: t.escrow_tx_hash,
			release_tx_hash: t.release_tx_hash,
			created_at: t.created_at.to_rfc3339(),
			updated_at: t.updated_at.to_rfc3339(),
		}
	}
}

#[derive(Debug, Serialize)]
pub struct TradeResponse {
	pub data: TradeDto,
}

#[derive(Debug, Serialize)]
pub struct TradeListResponse {
	pub data: Vec<TradeDto>,
}

#[derive(Debug, Deserialize)]
pub struct ListTradesQuery {
	#[serde(default, alias = "solverId")]
	pub solver_id: Option<String>,
	#[serde(default, alias = "userAddress")]
	pub user_address: Option<String>,
}

type ApiError = (StatusCode, Json<ErrorResponse>);

fn err(status: StatusCode, error: &str, message: impl Into<String>) -> ApiError {
	(
		status,
		Json(ErrorResponse {
			error: error.to_string(),
			message: message.into(),
			timestamp: chrono::Utc::now().timestamp(),
		}),
	)
}

// ─── Authorization ────────────────────────────────────────────────────────────

/// Establish which party the caller is, or refuse.
///
/// Deliberately returns the party rather than a boolean: callers then compare
/// it against the role the *trade* says is allowed to act, so the authority
/// check and the role check cannot drift apart.
async fn authorize_party(
	state: &AppState,
	headers: &HeaderMap,
	trade: &GiftCardTrade,
	auth: &PartyAuth,
) -> Result<Party, ApiError> {
	// Merchant: an api key that resolves to this trade's operator.
	if let Some(key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
		if !key.is_empty() {
			let operator = state
				.storage
				.get_operator_by_api_key(key)
				.await
				.map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, "storage_error", e.to_string()))?;
			return match operator {
				Some(op) if op.solver_id == trade.solver_id => Ok(Party::Merchant),
				// A valid key belonging to a *different* merchant is a
				// distinct failure from an invalid key, and saying so is
				// safe: the caller already proved they are some merchant.
				Some(op) => Err(err(
					StatusCode::FORBIDDEN,
					"wrong_merchant",
					format!("{} is not a party to this trade", op.solver_id),
				)),
				None => Err(err(StatusCode::UNAUTHORIZED, "unknown_api_key", "api key not recognised")),
			};
		}
	}

	// User: a signature over the trade id, recovered to `user_address`.
	let Some(sig_hex) = auth.signature.as_deref().filter(|s| !s.trim().is_empty()) else {
		return Err(err(
			StatusCode::UNAUTHORIZED,
			"unauthenticated",
			"send x-api-key as the merchant, or sign the trade id as the user",
		));
	};

	let recovered = recover_signer(&trade.id, sig_hex)
		.map_err(|e| err(StatusCode::UNAUTHORIZED, "bad_signature", e))?;

	if recovered.eq_ignore_ascii_case(trade.user_address.trim()) {
		Ok(Party::User)
	} else {
		Err(err(
			StatusCode::FORBIDDEN,
			"wrong_signer",
			"signature does not match the user on this trade",
		))
	}
}

/// Recover the signer of an EIP-191 `personal_sign` over `message`.
fn recover_signer(message: &str, signature_hex: &str) -> Result<String, String> {
	let raw = signature_hex.trim().trim_start_matches("0x");
	if raw.len() != 130 {
		return Err(format!(
			"signature must be 65 bytes (130 hex chars), got {}",
			raw.len()
		));
	}
	let bytes =
		alloy_primitives::hex::decode(raw).map_err(|e| format!("signature is not valid hex: {e}"))?;
	let sig = Signature::from_raw(&bytes).map_err(|e| format!("malformed signature: {e}"))?;
	let digest = eip191_hash_message(message.as_bytes());
	let addr = sig
		.recover_address_from_prehash(&digest)
		.map_err(|e| format!("ecdsa recovery failed: {e}"))?;
	Ok(format!("{addr:#x}"))
}

/// Derive the Ethereum address an uncompressed secp256k1 public key owns.
///
/// This is what makes a caller-supplied key safe to trust. Without it anyone
/// who could reach the escrow endpoint could nominate a key *they* hold, and
/// the next code would be sealed to them instead of to the real counterparty
/// — the whole encrypted-transport design would be decorative.
fn address_from_pubkey(pubkey_hex: &str) -> Result<String, String> {
	let raw = pubkey_hex.trim().trim_start_matches("0x");
	// 65 bytes uncompressed: a 0x04 tag then X and Y. The compressed form
	// is rejected rather than expanded — wallets that can export a key at
	// all export this one, and supporting two encodings doubles the surface
	// of a check that must not be wrong.
	if raw.len() != 130 {
		return Err(format!(
			"public key must be 65 bytes uncompressed (130 hex chars), got {}",
			raw.len()
		));
	}
	let bytes = alloy_primitives::hex::decode(raw)
		.map_err(|e| format!("public key is not valid hex: {e}"))?;
	if bytes[0] != 0x04 {
		return Err("public key must be uncompressed (0x04 prefix)".to_string());
	}
	// The address is the last 20 bytes of keccak256 over X||Y, tag excluded.
	let digest = alloy_primitives::keccak256(&bytes[1..]);
	Ok(format!("0x{}", alloy_primitives::hex::encode(&digest[12..])))
}

/// A `0x`-prefixed 32-byte hash, which is what `keccak256` of the code is.
fn is_commitment(s: &str) -> bool {
	let t = s.trim();
	t.len() == 66
		&& t.starts_with("0x")
		&& t[2..].chars().all(|c| c.is_ascii_hexdigit())
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/// POST /api/v1/giftcard-trades — match a quote and open a trade.
pub async fn create_giftcard_trade(
	State(state): State<AppState>,
	Json(req): Json<CreateTradeRequest>,
) -> Result<(StatusCode, Json<TradeResponse>), ApiError> {
	let quotes = state
		.storage
		.list_giftcard_quotes(None)
		.await
		.map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, "storage_error", e.to_string()))?;

	let quote = quotes
		.into_iter()
		.find(|q| q.id == req.quote_id)
		.ok_or_else(|| err(StatusCode::NOT_FOUND, "no_such_quote", "quote not found"))?;

	// Re-validate against the live quote rather than trusting the terms the
	// client sends. A client that quoted ten minutes ago may be acting on a
	// rate the merchant has since withdrawn or paused.
	let now = chrono::Utc::now();
	if quote.paused || quote.is_expired_at(now) {
		return Err(err(
			StatusCode::CONFLICT,
			"quote_unavailable",
			"that rate is no longer on the book",
		));
	}

	let face: u128 = req
		.face_minor_units
		.trim()
		.parse()
		.map_err(|_| err(StatusCode::BAD_REQUEST, "bad_amount", "faceMinorUnits must be a whole number of minor units"))?;

	let (Ok(min), Ok(max)) = (
		quote.min_face.trim().parse::<u128>(),
		quote.max_face.trim().parse::<u128>(),
	) else {
		return Err(err(StatusCode::CONFLICT, "quote_unavailable", "that rate has an unusable band"));
	};
	if face < min || face > max {
		return Err(err(
			StatusCode::BAD_REQUEST,
			"amount_out_of_band",
			format!("that rate covers {min}–{max} minor units"),
		));
	}

	if req.user_address.trim().is_empty() {
		return Err(err(StatusCode::BAD_REQUEST, "bad_address", "userAddress is required"));
	}

	// Refuse up front rather than at payout time. A trade opened on a
	// deployment with no attestor key would reach a terminal state and then
	// strand somebody's money with nothing able to release it.
	if !state.giftcard_escrow.is_enabled() {
		return Err(err(
			StatusCode::SERVICE_UNAVAILABLE,
			"settlement_disabled",
			"gift card settlement is not configured on this deployment",
		));
	}

	// The merchant's payout address is frozen now, because the escrow will
	// only release to one of the two addresses the lock names — a merchant
	// who rotates their wallet mid-trade must still be paid at the old one.
	let operator = state
		.storage
		.get_operator(&quote.solver_id)
		.await
		.map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, "storage_error", e.to_string()))?
		.ok_or_else(|| err(StatusCode::CONFLICT, "no_operator", "that merchant is no longer registered"))?;

	let payout = payout_minor_units(face, &quote);

	// A merchant may only carry open trades their stake actually backs.
	// Checked here rather than at settlement because by then the user has
	// already handed over a card against a promise nothing was securing.
	let token = resolve_token_on(&state, &quote.payout_chain, &quote.payout_asset)?;
	let bond = state
		.giftcard_escrow
		.available_bond(&quote.payout_chain, &operator.wallet_address, &token)
		.await
		.map_err(|e| {
			err(
				StatusCode::SERVICE_UNAVAILABLE,
				"bond_unreadable",
				format!("could not read the merchant's bond: {e}"),
			)
		})?;

	let existing = state
		.storage
		.list_giftcard_trades(Some(&quote.solver_id), None)
		.await
		.map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, "storage_error", e.to_string()))?;

	let exposure = giftcard_exposure::compute(
		&existing,
		u128::try_from(bond).unwrap_or(u128::MAX),
		DEFAULT_EXPOSURE_MULTIPLE,
	);
	if !exposure.admits(payout) {
		// Named plainly: this is a merchant capacity problem, not a user
		// error, and a user retrying a smaller amount is a reasonable
		// response to it.
		return Err(err(
			StatusCode::CONFLICT,
			"merchant_at_capacity",
			format!(
				"that merchant has {} of capacity left against their bond; this trade needs {payout}",
				exposure.headroom()
			),
		));
	}

	let trade = GiftCardTrade {
		id: format!("gct-{}", uuid::Uuid::new_v4().simple()),
		quote_id: quote.id.clone(),
		solver_id: quote.solver_id.clone(),
		side: quote.side,
		brand: quote.brand.clone(),
		country_code: quote.country_code.clone(),
		currency: quote.currency.clone(),
		card_type: quote.card_type,
		face_minor_units: face.to_string(),
		rate: quote.quote.clone(),
		payout_chain: quote.payout_chain.clone(),
		payout_asset: quote.payout_asset.clone(),
		payout_minor_units: payout.to_string(),
		user_address: req.user_address.trim().to_string(),
		merchant_address: operator.wallet_address.clone(),
		state: TradeState::Quoted,
		recipient_pubkey: None,
		code_commitment: None,
		sealed_code: None,
		deadline_at: None,
		resolution_note: None,
		escrow_tx_hash: None,
		release_tx_hash: None,
		created_at: now,
		updated_at: now,
	};

	let stored = state
		.storage
		.create_giftcard_trade(trade)
		.await
		.map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, "storage_error", e.to_string()))?;

	info!(trade_id = %stored.id, side = %stored.side, "gift card trade opened");
	Ok((StatusCode::CREATED, Json(TradeResponse { data: stored.into() })))
}

/// Mirrors the ranker's arithmetic: rate on face, rescaled from the card's
/// minor units to the payout token's, less any fixed cost.
fn payout_minor_units(face_minor_units: u128, q: &GiftCardQuote) -> u128 {
	let rate = q.quote.parse::<f64>().unwrap_or(0.0).clamp(0.0, 2.0);
	let fixed = q
		.fixed_cost
		.as_deref()
		.and_then(|s| s.trim().parse::<u128>().ok())
		.unwrap_or(0);
	let scale = 10f64.powi(i32::from(q.payout_decimals) - i32::from(q.face_decimals));
	let raw = (face_minor_units as f64) * rate * scale;
	if !raw.is_finite() || raw < 0.0 {
		return 0;
	}
	(raw as u128).saturating_sub(fixed)
}

pub async fn get_giftcard_trade(
	State(state): State<AppState>,
	Path(id): Path<String>,
) -> Result<Json<TradeResponse>, ApiError> {
	let trade = load(&state, &id).await?;
	Ok(Json(TradeResponse { data: trade.into() }))
}

pub async fn list_giftcard_trades(
	State(state): State<AppState>,
	Query(q): Query<ListTradesQuery>,
) -> Result<Json<TradeListResponse>, ApiError> {
	let trades = state
		.storage
		.list_giftcard_trades(q.solver_id.as_deref(), q.user_address.as_deref())
		.await
		.map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, "storage_error", e.to_string()))?;
	Ok(Json(TradeListResponse {
		data: trades.into_iter().map(TradeDto::from).collect(),
	}))
}

/// POST /api/v1/giftcard-trades/{id}/escrow — the funder locked their payout.
pub async fn giftcard_trade_escrow_funded(
	State(state): State<AppState>,
	Path(id): Path<String>,
	headers: HeaderMap,
	Json(req): Json<EscrowFundedRequest>,
) -> Result<Json<TradeResponse>, ApiError> {
	let trade = load(&state, &id).await?;
	let caller = authorize_party(&state, &headers, &trade, &req.auth).await?;
	require_role(caller, trade.funder(), "fund escrow")?;

	// The key is checked against the address of whoever the caller proved
	// they are. A merchant's claimed key must match their registered wallet;
	// a user's must match the address on the trade.
	let owner = match caller {
		Party::User => trade.user_address.clone(),
		Party::Merchant => {
			let op = state
				.storage
				.get_operator(&trade.solver_id)
				.await
				.map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, "storage_error", e.to_string()))?
				.ok_or_else(|| err(StatusCode::CONFLICT, "no_operator", "merchant record is missing"))?;
			op.wallet_address
		}
	};

	let derived = address_from_pubkey(&req.recipient_pubkey)
		.map_err(|e| err(StatusCode::BAD_REQUEST, "bad_pubkey", e))?;
	if !derived.eq_ignore_ascii_case(owner.trim()) {
		return Err(err(
			StatusCode::BAD_REQUEST,
			"pubkey_mismatch",
			"that public key does not belong to your address",
		));
	}

	// Verify the lock actually landed, for exactly this trade, before the
	// trade advances. Taking the hash on trust would let a funder point at
	// any transaction at all — their own unrelated transfer, or somebody
	// else's lock — and have a card handed over against money that is not
	// there.
	let token = resolve_payout_token(&state, &trade)?;
	let amount = trade.payout_minor_units.trim().parse::<u128>().map_err(|_| {
		err(StatusCode::CONFLICT, "bad_trade", "this trade has an unusable payout amount")
	})?;

	let verified = state
		.giftcard_escrow
		.verify_lock(
			&trade.payout_chain,
			req.tx_hash.trim(),
			&ExpectedLock {
				trade_id: trade.id.clone(),
				funder: owner.clone(),
				counterparty: trade.address_of(caller.other()).to_string(),
				token,
				amount: alloy_primitives::U256::from(amount),
			},
		)
		.await
		.map_err(|e| match e {
			// "Not yet mined" is a retry, not a rejection — a client that
			// submits the moment it broadcasts should poll, not give up.
			oif_service::EscrowError::Verification(ref m) if m.contains("not yet mined") => {
				err(StatusCode::ACCEPTED, "not_yet_mined", m.clone())
			}
			other => err(StatusCode::BAD_REQUEST, "escrow_unverified", other.to_string()),
		})?;

	info!(
		trade_id = %trade.id,
		amount = %verified.amount,
		"gift card escrow lock verified on-chain"
	);

	let transition = trade
		.on_escrow_funded(chrono::Utc::now())
		.map_err(|e| err(StatusCode::CONFLICT, "bad_state", e))?;

	apply(&state, &trade, transition, caller, |u| {
		u.escrow_tx_hash = Some(req.tx_hash.trim().to_string());
		u.recipient_pubkey = Some(format!("0x{}", req.recipient_pubkey.trim().trim_start_matches("0x").to_ascii_lowercase()));
	})
	.await
}

/// The ERC-20 the trade settles in, resolved against the chain registry.
///
/// A quote names its payout asset by symbol; the escrow deals in addresses.
/// Resolving here rather than trusting a client-supplied address is what
/// stops a lock in a worthless token counting as payment.
fn resolve_payout_token(state: &AppState, trade: &GiftCardTrade) -> Result<String, ApiError> {
	resolve_token_on(state, &trade.payout_chain, &trade.payout_asset)
}

fn resolve_token_on(state: &AppState, caip2: &str, asset: &str) -> Result<String, ApiError> {
	let chain = state.chain_registry.by_caip2(caip2).ok_or_else(|| {
		err(
			StatusCode::CONFLICT,
			"unknown_chain",
			format!("{caip2} is not in the chain registry"),
		)
	})?;

	chain
		.token_by_symbol(asset)
		.or_else(|| chain.token_by_address(asset))
		.map(|t| t.address.clone())
		.ok_or_else(|| {
			err(
				StatusCode::CONFLICT,
				"unknown_token",
				format!("{asset} is not a known token on {caip2}"),
			)
		})
}

/// POST /api/v1/giftcard-trades/{id}/code — hand over the sealed code.
pub async fn giftcard_trade_deliver_code(
	State(state): State<AppState>,
	Path(id): Path<String>,
	headers: HeaderMap,
	Json(req): Json<DeliverCodeRequest>,
) -> Result<Json<TradeResponse>, ApiError> {
	let trade = load(&state, &id).await?;
	let caller = authorize_party(&state, &headers, &trade, &req.auth).await?;
	require_role(caller, trade.card_sender(), "deliver the code")?;

	if !is_commitment(&req.commitment) {
		return Err(err(
			StatusCode::BAD_REQUEST,
			"bad_commitment",
			"commitment must be a 0x-prefixed 32-byte keccak256 hash of the code",
		));
	}

	// Refuse an envelope with an empty ciphertext outright. The commitment
	// would still be recorded, so a dispute could be opened over a code that
	// was never actually transmitted.
	if req.sealed.ct.trim().is_empty() || req.sealed.epk.trim().is_empty() {
		return Err(err(
			StatusCode::BAD_REQUEST,
			"bad_envelope",
			"sealed code is missing its ciphertext or ephemeral key",
		));
	}

	let sealed = serde_json::to_value(&req.sealed)
		.map_err(|e| err(StatusCode::BAD_REQUEST, "bad_envelope", e.to_string()))?;

	let transition = trade
		.on_code_delivered(chrono::Utc::now())
		.map_err(|e| err(StatusCode::CONFLICT, "bad_state", e))?;

	apply(&state, &trade, transition, caller, |u| {
		u.code_commitment = Some(req.commitment.trim().to_ascii_lowercase());
		u.sealed_code = Some(sealed);
	})
	.await
}

/// POST /api/v1/giftcard-trades/{id}/attest — the receiver verified the card.
pub async fn giftcard_trade_attest(
	State(state): State<AppState>,
	Path(id): Path<String>,
	headers: HeaderMap,
	Json(req): Json<AttestRequest>,
) -> Result<Json<TradeResponse>, ApiError> {
	let trade = load(&state, &id).await?;
	let caller = authorize_party(&state, &headers, &trade, &req.auth).await?;
	require_role(caller, trade.card_receiver(), "attest")?;

	let transition = if req.valid {
		trade.on_attested_valid()
	} else {
		// An "invalid" claim opens a dispute rather than refunding — it is
		// exactly the move of a receiver who redeemed the card themselves.
		let reason = req.reason.as_deref().unwrap_or("no reason given");
		trade.on_attested_invalid(reason)
	}
	.map_err(|e| err(StatusCode::CONFLICT, "bad_state", e))?;

	if !req.valid {
		warn!(trade_id = %trade.id, by = %caller, "card reported invalid; dispute opened");
	}

	apply(&state, &trade, transition, caller, |_| {}).await
}

/// POST /solver-api/giftcard-trades/{id}/resolve — adjudicate a dispute.
///
/// Admin-only by virtue of living under `/solver-api`, which the middleware
/// gates. Two things happen, and only the first is reversible:
///
/// 1. The trade moves to a terminal state and the payout worker releases the
///    escrow to whoever was named.
/// 2. If the merchant was found at fault, a slash is **proposed** against
///    their bond. Proposed, not executed: the contract holds it for a delay
///    during which the merchant can see the claim and a compromised attestor
///    can be rotated out and its proposals cancelled.
///
/// Step 2 is what makes a ruling enforceable. Without a bond the escrow can
/// only pick between the two parties, and a merchant who took a card and
/// claimed it was bad leaves the seller with nothing to be made whole from.
pub async fn resolve_giftcard_dispute(
	State(state): State<AppState>,
	Path(id): Path<String>,
	Json(req): Json<ResolveDisputeRequest>,
) -> Result<Json<TradeResponse>, ApiError> {
	let trade = load(&state, &id).await?;

	let pays = Party::from_str(&req.pays)
		.map_err(|e| err(StatusCode::BAD_REQUEST, "bad_party", e))?;

	let transition = trade
		.on_dispute_resolved(pays, req.note.trim())
		.map_err(|e| err(StatusCode::CONFLICT, "bad_state", e))?;

	// Slash first. If it fails the trade stays disputed and the whole ruling
	// can be retried; resolving the trade first and then failing to slash
	// would leave a merchant judged at fault with their stake untouched and
	// no state left to notice it from.
	let mut slash_tx = None;
	if req.slash_minor_units.as_deref().is_some_and(|v| v.trim() != "0" && !v.trim().is_empty()) {
		let amount: u128 = req
			.slash_minor_units
			.as_deref()
			.unwrap_or("0")
			.trim()
			.parse()
			.map_err(|_| err(StatusCode::BAD_REQUEST, "bad_amount", "slashMinorUnits must be a whole number"))?;

		if pays == Party::Merchant {
			// Slashing the party you just ruled in favour of is almost
			// certainly a mistake, and an expensive one to make silently.
			return Err(err(
				StatusCode::BAD_REQUEST,
				"contradictory_ruling",
				"the merchant cannot both win the dispute and be slashed for it",
			));
		}

		let token = resolve_payout_token(&state, &trade)?;
		let tx = state
			.giftcard_escrow
			.propose_slash(
				&trade.payout_chain,
				&trade.merchant_address,
				&token,
				alloy_primitives::U256::from(amount),
				trade.address_of(pays),
				&trade.id,
			)
			.await
			.map_err(|e| err(StatusCode::BAD_GATEWAY, "slash_failed", e.to_string()))?;
		warn!(trade_id = %trade.id, %amount, tx = %tx, "slash proposed against merchant bond");
		slash_tx = Some(tx);
	}

	let note = match &slash_tx {
		Some(tx) => format!("{} (slash proposed: {tx})", transition.note),
		None => transition.note.clone(),
	};

	apply(
		&state,
		&trade,
		Transition { note, ..transition },
		// Not a party to the trade — an adjudicator acting on it. Recorded
		// as such so the event log distinguishes a ruling from either side's
		// own action.
		Party::Merchant,
		|u| u.actor = "admin".to_string(),
	)
	.await
}

/// POST /api/v1/giftcard-trades/{id}/dispute — either party contests.
pub async fn giftcard_trade_dispute(
	State(state): State<AppState>,
	Path(id): Path<String>,
	headers: HeaderMap,
	Json(req): Json<DisputeRequest>,
) -> Result<Json<TradeResponse>, ApiError> {
	let trade = load(&state, &id).await?;
	// Either party may dispute, so there is no role check here — only the
	// proof that the caller is one of the two.
	let caller = authorize_party(&state, &headers, &trade, &req.auth).await?;

	let transition = trade
		.on_disputed(caller, req.reason.trim())
		.map_err(|e| err(StatusCode::CONFLICT, "bad_state", e))?;

	warn!(trade_id = %trade.id, by = %caller, "gift card trade disputed");
	apply(&state, &trade, transition, caller, |_| {}).await
}

// ─── shared ───────────────────────────────────────────────────────────────────

async fn load(state: &AppState, id: &str) -> Result<GiftCardTrade, ApiError> {
	state
		.storage
		.get_giftcard_trade(id)
		.await
		.map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, "storage_error", e.to_string()))?
		.ok_or_else(|| err(StatusCode::NOT_FOUND, "no_such_trade", "trade not found"))
}

/// The caller proved who they are; this checks they are the party this
/// particular action belongs to.
fn require_role(caller: Party, allowed: Party, action: &str) -> Result<(), ApiError> {
	if caller == allowed {
		Ok(())
	} else {
		Err(err(
			StatusCode::FORBIDDEN,
			"wrong_party",
			format!("only the {allowed} may {action} on this trade"),
		))
	}
}

/// Persist a transition under its state guard.
async fn apply(
	state: &AppState,
	trade: &GiftCardTrade,
	transition: Transition,
	actor: Party,
	extra: impl FnOnce(&mut GiftCardTradeUpdate),
) -> Result<Json<TradeResponse>, ApiError> {
	let mut update = GiftCardTradeUpdate {
		state: transition.next.as_str().to_string(),
		deadline_at: transition.deadline_at,
		resolution_note: Some(transition.note),
		actor: actor.to_string(),
		..Default::default()
	};
	extra(&mut update);

	let updated = state
		.storage
		.transition_giftcard_trade(&trade.id, trade.state.as_str(), update)
		.await
		.map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, "storage_error", e.to_string()))?;

	match updated {
		Some(t) => Ok(Json(TradeResponse { data: t.into() })),
		// The guard rejected the write, so somebody else moved the trade
		// between the read and here — most often the deadline resolver. 409
		// rather than 500: the client should re-read and decide again.
		None => Err(err(
			StatusCode::CONFLICT,
			"state_changed",
			"this trade moved on while the request was in flight; re-read it",
		)),
	}
}

/// Parse helper kept next to the handlers it serves.
#[allow(dead_code)]
fn parse_side(s: &str) -> Option<GiftCardSide> {
	GiftCardSide::from_str(s).ok()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_commitment_must_be_a_32_byte_hex_hash() {
		assert!(is_commitment(&format!("0x{}", "a".repeat(64))));
		assert!(!is_commitment(&format!("0x{}", "a".repeat(63))), "too short");
		assert!(!is_commitment(&"a".repeat(64)), "missing 0x");
		assert!(!is_commitment(&format!("0x{}", "z".repeat(64))), "not hex");
		assert!(!is_commitment(""));
	}

	#[test]
	fn recovering_a_signer_rejects_a_malformed_signature() {
		assert!(recover_signer("gct-1", "0xdeadbeef").is_err());
		assert!(recover_signer("gct-1", "").is_err());
		// Right length, wrong content — must fail recovery, not panic.
		let _ = recover_signer("gct-1", &format!("0x{}", "1".repeat(130)));
	}

	#[test]
	fn a_public_key_derives_the_address_it_owns() {
		// Known pair: the secp256k1 generator point, whose address is a
		// published constant for private key = 1.
		let pubkey = "0x0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798			483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8"
			.replace(['\n', '\t', ' '], "");
		assert_eq!(
			address_from_pubkey(&pubkey).unwrap(),
			"0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
		);
	}

	#[test]
	fn a_malformed_public_key_is_rejected_rather_than_coerced() {
		// Each of these would, if accepted, let a caller have the next code
		// sealed to a key they chose.
		assert!(address_from_pubkey("").is_err());
		assert!(address_from_pubkey("0x04ab").is_err(), "too short");
		assert!(
			address_from_pubkey(&format!("0x02{}", "a".repeat(128))).is_err(),
			"compressed form must not be silently accepted"
		);
		assert!(address_from_pubkey(&format!("0x04{}", "z".repeat(128))).is_err(), "not hex");
	}

	#[test]
	fn a_role_check_names_the_party_that_is_allowed() {
		let e = require_role(Party::User, Party::Merchant, "attest").unwrap_err();
		assert_eq!(e.0, StatusCode::FORBIDDEN);
		assert!(e.1.message.contains("merchant"), "{}", e.1.message);
		assert!(require_role(Party::User, Party::User, "attest").is_ok());
	}
}
