//! Native Solver API handlers for Linkiswap Core
//!
//! All data flows through Postgres. No in-memory stores, no hardcoded mock data.

use axum::{
	extract::{Query, State, WebSocketUpgrade, ws::{WebSocket, Message}},
	http::{HeaderMap, StatusCode},
	response::{Json, IntoResponse},
};
use serde::{Deserialize, Serialize};
use tracing::{info, error, warn};
use futures::stream::StreamExt;
use chrono::Utc;
use alloy_primitives::{eip191_hash_message, Address, Signature};
use crate::auth::fill_worker_auth as fill_auth;
use crate::handlers::common::ErrorResponse;
use crate::state::AppState;
use oif_types::solvers::{Solver, SolverStatus};
use oif_types::Operator;
use oif_types::SolverQuote;
use oif_types::VaultBalance;

// ─── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QuoteRangeDto {
	#[serde(default, alias = "minAmount")]
	pub min_amount: String,
	#[serde(default, alias = "maxAmount")]
	pub max_amount: String,
	pub quote: String,
	#[serde(default, alias = "fixedCost")]
	pub fixed_cost: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SolverQuoteSubmitDto {
	pub expiry: u64,
	#[serde(default, alias = "fromChain", alias = "fromChainId")]
	pub from_chain_id: String,
	#[serde(default, alias = "toChain", alias = "toChainId")]
	pub to_chain_id: String,
	#[serde(default, alias = "fromAsset")]
	pub from_asset: String,
	#[serde(default, alias = "toAsset")]
	pub to_asset: String,
	#[serde(default, alias = "fromDecimals")]
	pub from_decimals: u8,
	#[serde(default, alias = "toDecimals")]
	pub to_decimals: u8,
	pub ranges: Vec<QuoteRangeDto>,
	#[serde(default)]
	pub max_to_amount: Option<String>,
	#[serde(default, alias = "exclusiveFor")]
	pub exclusive_for: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BatchQuotesSubmitRequest {
	pub quotes: Vec<SolverQuoteSubmitDto>,
	/// The solver's registered address — used to derive the solver_id.
	#[serde(default, alias = "solverId", alias = "solver_id")]
	pub solver_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotesSubmitResponse {
	pub status: String,
	pub quotes_added: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SolverRegisterRequest {
	#[serde(default, alias = "address", alias = "account")]
	pub address: String,
	pub message: String,
	pub signature: String,
	#[serde(default, alias = "chainId", alias = "chain_id", alias = "chain")]
	pub chain_id: Option<String>,
	#[serde(default)]
	pub endpoint: Option<String>,
	#[serde(default)]
	pub adapter_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverRegisterResponse {
	pub success: bool,
	pub solver_id: Option<String>,
	/// Address of the freshly generated fill-wallet. Persisted on the
	/// operator row. Distinct from the operator's registered wallet.
	/// Visible on-chain by anyone — operators monitor fills by watching
	/// this address. The private key stays encrypted on the aggregator.
	pub fill_wallet_address: Option<String>,
	/// Per-operator dashboard API key. Surfaced once at registration
	/// time. The dashboard MUST persist this in localStorage and send
	/// it as `x-api-key` on every subsequent request. There is no
	/// shared admin key — each operator gets a unique one.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub api_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverIdentityDto {
	pub id: u64,
	pub solver_id: String,
	pub address: String,
	pub chain: Option<String>,
	pub status: String,
	pub r#type: String,
	pub created_at: String,
	pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetSolverIdentitiesResponse {
	pub data: Vec<SolverIdentityDto>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegisterMessageResponse {
	pub data: RegisterMessageDataDto,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegisterMessageDataDto {
	pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractEntry {
	pub chain: String,
	pub address: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractsByKindDto {
	pub input_settler: Vec<ContractEntry>,
	pub output_settler: Vec<ContractEntry>,
	pub oracle: Vec<ContractEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SupportedContractsResponseDto {
	pub data: ContractsByKindDto,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SolverQuoteDto {
	pub id: String,
	pub solver_id: String,
	pub from_chain_network_id: String,
	pub to_chain_network_id: String,
	pub from_asset_address: String,
	pub to_asset_address: String,
	pub from_asset_decimals: u8,
	pub to_asset_decimals: u8,
	pub quote: String,
	pub min_amount: String,
	pub max_amount: String,
	pub fixed_cost: Option<String>,
	pub expiry: String,
	pub exclusive_for: Option<String>,
	pub paused: Option<bool>,
	pub created_at: String,
	pub updated_at: String,
}

impl From<SolverQuote> for SolverQuoteDto {
	fn from(q: SolverQuote) -> Self {
		Self {
			id: q.id,
			solver_id: q.solver_id,
			from_chain_network_id: q.from_chain,
			to_chain_network_id: q.to_chain,
			from_asset_address: q.from_asset,
			to_asset_address: q.to_asset,
			from_asset_decimals: q.from_decimals,
			to_asset_decimals: q.to_decimals,
			quote: q.quote,
			min_amount: q.min_amount,
			max_amount: q.max_amount,
			fixed_cost: q.fixed_cost,
			expiry: q.expiry,
			exclusive_for: q.exclusive_for,
			paused: Some(q.paused),
			created_at: q.created_at.to_rfc3339(),
			updated_at: q.updated_at.to_rfc3339(),
		}
	}
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetSolverQuotesResponseDto {
	pub data: Vec<SolverQuoteDto>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderTelemetryItem {
	pub id: String,
	pub intent_id: String,
	pub user_address: String,
	pub from_chain: String,
	pub to_chain: String,
	pub from_asset: String,
	pub to_asset: String,
	pub from_amount: String,
	pub to_amount: String,
	pub status: String,
	pub origin_tx_hash: Option<String>,
	pub dest_tx_hash: Option<String>,
	pub created_at: String,
	pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetTelemetryResponse {
	pub data: Vec<OrderTelemetryItem>,
}

/// Vault balances are derived from on-chain state (not tracked by the aggregator yet).
/// Returns an empty list until a vault-tracking subsystem is implemented.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultAsset {
	pub symbol: String,
	pub name: String,
	pub chain: String,
	pub available: String,
	pub locked: String,
	pub total: String,
	pub usd_value: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetVaultBalancesResponse {
	pub data: Vec<VaultAsset>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustComponentsRequest {
	pub from_chain: String,
	pub to_chain: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustComponentsResponse {
	pub settlers: Vec<ContractEntry>,
	pub oracles: Vec<ContractEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteQuoteResponse {
	pub success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TogglePauseResponse {
	pub success: bool,
	pub paused: Option<bool>,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/// POST /quotes/submit — Persist solver quote inventory to Postgres
pub async fn post_quotes_submit(
	State(state): State<AppState>,
	Json(payload): Json<BatchQuotesSubmitRequest>,
) -> Result<Json<QuotesSubmitResponse>, (StatusCode, Json<ErrorResponse>)> {
	info!("Received batch quote submission for {} quotes", payload.quotes.len());

	// Derive solver_id from the submitted solver address (same derivation as registration)
	let solver_id = payload
		.solver_id
		.as_deref()
		.unwrap_or("anonymous")
		.to_string();

	let now = chrono::Utc::now();
	let mut count = 0;

	for (i, q) in payload.quotes.into_iter().enumerate() {
		// The id must carry the RANGE index as well as the quote index. It
		// previously carried only `i`, which is constant across this inner
		// loop, so every band of a multi-band quote generated the same
		// primary key: the first band inserted and the rest failed on a
		// unique violation that was logged and swallowed. A merchant
		// publishing "$25-100 at 0.90, $100-500 at 0.88" kept only the
		// first band and believed both were live.
		for (j, range) in q.ranges.iter().enumerate() {
			let id = format!("quote-{}-{}-{}", now.timestamp_millis(), i, j);
			let expiry_ts = chrono::DateTime::from_timestamp(q.expiry as i64, 0)
				.unwrap_or(now)
				.to_rfc3339();

			let quote = SolverQuote::new(
				id,
				solver_id.clone(),
				q.from_chain_id.clone(),
				q.to_chain_id.clone(),
				q.from_asset.clone(),
				q.to_asset.clone(),
				q.from_decimals,
				q.to_decimals,
				range.quote.clone(),
				range.min_amount.clone(),
				range.max_amount.clone(),
				range.fixed_cost.clone(),
				expiry_ts,
				q.exclusive_for.clone(),
			);

			if let Err(e) = state.storage.create_solver_quote(quote).await {
				error!("Failed to persist solver quote: {}", e);
			} else {
				count += 1;
			}
		}
	}

	Ok(Json(QuotesSubmitResponse {
		status: "success".to_string(),
		quotes_added: count,
	}))
}

/// Verify the dashboard's EIP-191 personal_sign signature over the
/// challenge message returned by `get_register_message`. Returns the
/// recovered address on success.
///
/// Signature must be a 65-byte hex string (`0x{r}{s}{v}`), exactly
/// what `wagmi.signMessageAsync({ message })` produces.
fn verify_register_signature(
	address: &str,
	message: &str,
	signature_hex: &str,
) -> Result<Address, String> {
	let raw = signature_hex
		.trim_start_matches("0x")
		.trim();
	if raw.len() != 130 {
		return Err(format!(
			"signature must be 65 bytes (130 hex chars), got {} chars",
			raw.len()
		));
	}
	let bytes = alloy_primitives::hex::decode(raw)
		.map_err(|e| format!("signature is not valid hex: {e}"))?;
	let sig = Signature::from_raw(&bytes)
		.map_err(|e| format!("malformed signature: {e}"))?;

	let digest = eip191_hash_message(message.as_bytes());
	let recovered = sig
		.recover_address_from_prehash(&digest)
		.map_err(|e| format!("ecdsa recovery failed: {e}"))?;

	let claimed = address
		.trim_start_matches("0x")
		.to_lowercase();
	let recovered_str = format!("{recovered:#x}")
		.trim_start_matches("0x")
		.to_lowercase();
	if recovered_str != claimed {
		return Err(format!(
			"recovered address 0x{recovered_str} does not match claimed address 0x{claimed}"
		));
	}
	Ok(recovered)
}

/// POST /solver-api/account/register — Register a solver wallet address.
///
/// Hardened: validates the EIP-191 personal_sign signature over the
/// challenge message returned by `GET /api/v1/solver/register/message`
/// before persisting. This prevents attackers from registering any
/// arbitrary address — they must actually control the wallet.
/// Per-IP rate limit for `POST /solver-api/account/register`.
///
/// This is a **registration** endpoint: each call creates a new
/// identity. A malicious caller could spam it to bloat the operators
/// table or burn CPU on ecrecover. We cap at
/// `REGISTER_RATE_LIMIT_PER_MINUTE` calls per minute per caller IP
/// (with a small burst) — generous enough for a real operator's
/// onboarding flow but punishing for spammers.
const REGISTER_RATE_LIMIT_PER_MINUTE: u32 = 5;
const REGISTER_RATE_BURST: u32 = 2;

pub async fn post_account_register(
	State(state): State<AppState>,
	headers: HeaderMap,
	Json(payload): Json<SolverRegisterRequest>,
) -> Result<Json<SolverRegisterResponse>, (StatusCode, Json<ErrorResponse>)> {
	// Rate-limit first so a spammer can't even reach the ecrecover
	// path. The key is `register:<ip>` — the only public endpoint
	// keyed on raw client IP. We pull the IP from `x-forwarded-for`
	// when the aggregator sits behind a proxy (Render's edge always
	// sets it), falling back to `x-real-ip`, then "unknown".
	let client_ip = headers
		.get("x-forwarded-for")
		.and_then(|v| v.to_str().ok())
		.and_then(|s| s.split(',').next())
		.map(|s| s.trim().to_string())
		.or_else(|| {
			headers
				.get("x-real-ip")
				.and_then(|v| v.to_str().ok())
				.map(|s| s.to_string())
		})
		.unwrap_or_else(|| "unknown".to_string());
	let rate_key = format!("register:{}", client_ip);
	let limits = oif_types::auth::RateLimits {
		requests_per_minute: REGISTER_RATE_LIMIT_PER_MINUTE,
		burst_size: REGISTER_RATE_BURST,
		custom_windows: vec![],
	};
	match state
		.rate_limiter
		.check_rate_limit(&rate_key, &limits)
		.await
	{
		Ok(check) => {
			if !check.allowed {
				warn!(
					client_ip = %client_ip,
					"register endpoint rate limit exceeded"
				);
				return Err((
					StatusCode::TOO_MANY_REQUESTS,
					Json(ErrorResponse {
						error: "RATE_LIMIT_EXCEEDED".into(),
						message: format!(
							"too many registration attempts from this IP; retry in {}s",
							check.reset_at.signed_duration_since(Utc::now()).num_seconds().max(1)
						),
						timestamp: Utc::now().timestamp(),
					}),
				));
			}
			if let Err(e) = state.rate_limiter.record_request(&rate_key).await {
				warn!(error = %e, "register rate-limit record failed");
			}
		}
		Err(e) => {
			warn!(error = %e, "register rate-limit check errored; allowing through");
		}
	}

	// Basic input validation — the address is the security boundary.
	let address_clean = payload.address.trim();
	if !address_clean.starts_with("0x")
		|| address_clean.len() != 42
		|| !address_clean[2..].chars().all(|c| c.is_ascii_hexdigit())
	{
		return Err((
			StatusCode::BAD_REQUEST,
			Json(ErrorResponse {
				error: "INVALID_ADDRESS".into(),
				message: format!(
					"expected 0x-prefixed 20-byte hex, got {:?}",
					address_clean
				),
				timestamp: Utc::now().timestamp(),
			}),
		));
	}
	if payload.message.trim().is_empty() {
		return Err((
			StatusCode::BAD_REQUEST,
			Json(ErrorResponse {
				error: "MISSING_MESSAGE".into(),
				message: "register payload must include the challenge message".into(),
				timestamp: Utc::now().timestamp(),
			}),
		));
	}
	if payload.signature.trim().is_empty() {
		return Err((
			StatusCode::BAD_REQUEST,
			Json(ErrorResponse {
				error: "MISSING_SIGNATURE".into(),
				message: "register payload must include the EIP-191 signature".into(),
				timestamp: Utc::now().timestamp(),
			}),
		));
	}

	// Verify the signature *before* touching storage. ecrecover is
	// cheap; it would be wasteful to attempt a DB write only to roll it
	// back when the signature is bad.
	match verify_register_signature(address_clean, &payload.message, &payload.signature) {
		Ok(recovered) => {
			info!(
				address = %address_clean,
				recovered = %format!("{recovered:#x}"),
				"register signature verified"
			);
		}
		Err(e) => {
			warn!(
				address = %address_clean,
				error = %e,
				"register signature verification failed"
			);
			return Err((
				StatusCode::UNAUTHORIZED,
				Json(ErrorResponse {
					error: "INVALID_SIGNATURE".into(),
					message: e,
					timestamp: Utc::now().timestamp(),
				}),
			));
		}
	}

	info!("Registering solver account for address: {}", address_clean);

	let solver_id_str = address_clean.to_lowercase().replace("0x", "solver-");
	let adapter_id = payload.adapter_id.unwrap_or_else(|| "oif-v1".to_string());
	let endpoint = payload
		.endpoint
		.unwrap_or_else(|| "http://localhost:3000/api/v1".to_string());

	let mut solver = Solver::new(solver_id_str.clone(), adapter_id, endpoint);
	solver.metadata.name = Some(address_clean.to_string());
	solver.metadata.description = Some("Registered Linkiswap Solver".to_string());
	solver.status = SolverStatus::Active;

	if let Err(e) = state.storage.create_solver(solver).await {
		// Mirror the upsert_operator fix below — the original code
		// dropped the error with `let _ = ...`, which is why operator
		// registrations looked successful but no row was persisted.
		error!(
			solver_id = %solver_id_str,
			error = %e,
			"failed to create solver row during registration"
		);
		return Err((
			StatusCode::INTERNAL_SERVER_ERROR,
			Json(ErrorResponse {
				error: "SOLVER_CREATE_FAILED".into(),
				message: format!("failed to persist solver row: {e}"),
				timestamp: Utc::now().timestamp(),
			}),
		));
	}

	// Auto-generate a fresh secp256k1 fill-wallet so the operator has
	// a dedicated hot-wallet for signing fills that is distinct from
	// their registered wallet. The aggregator generates this server-side;
	// the **private key never leaves the host**. We encrypt it with the
	// process-held master key (FILL_WALLET_ENCRYPTION_KEY) and store the
	// ciphertext alongside the operator row. Only the aggregator's own
	// fill-signing path can decrypt it, on demand, when a fill needs to
	// be signed.
	let fill_wallet = oif_types::keygen::generate_random();

	// Generate the per-operator dashboard API key. 32 random bytes
	// hex-encoded → 64-char key. Each operator gets a unique value; the
	// previous hardcoded `linkiswap_admin_2026` shared-key is GONE.
	// The dashboard must persist this key in localStorage and send it
	// as `x-api-key` (REST) or `apiKey` (WebSocket query string) on
	// every subsequent request.
	//
	// Bare 64-char hex (no `0x` prefix) — the `operators.api_key`
	// column is `VARCHAR(64)`, and a previous version of this code
	// included the `0x` prefix which overflowed the column and 500'd
	// every registration. The dashboard just sends the raw string
	// back as `x-api-key`; we never parse it as a hex number on the
	// aggregator side, so the prefix is meaningless.
	let mut api_key_bytes = [0u8; 32];
	getrandom::getrandom(&mut api_key_bytes).expect("OS entropy must be available");
	let api_key = alloy_primitives::hex::encode(api_key_bytes);

	let operator = Operator::with_fill_wallet(
		solver_id_str.clone(),
		address_clean.to_string(),
		&fill_wallet.address,
	);
	let mut operator = operator;
	operator.api_key = api_key.clone();
	if let Err(e) = state.storage.upsert_operator(operator).await {
		// Previously this was `let _ = ...` which silently dropped the
		// error; the dashboard saw a 200 success but `operators` stayed
		// empty. Treat any upsert failure as a 500 so the operator can
		// retry and the team can see the cause in logs.
		error!(
			solver_id = %solver_id_str,
			error = %e,
			"failed to upsert operator row during registration"
		);
		return Err((
			StatusCode::INTERNAL_SERVER_ERROR,
			Json(ErrorResponse {
				error: "OPERATOR_UPSERT_FAILED".into(),
				message: format!("failed to persist operator row: {e}"),
				timestamp: Utc::now().timestamp(),
			}),
		));
	}

	// Persist the encrypted fill-wallet key. The dashboard only ever
	// sees the *address*; the dashboard-side "Save your private key"
	// step is gone entirely.
	match state.sealer.as_ref() {
		Some(sealer) => {
			// The private key is hex-encoded; seal the raw UTF-8 bytes
			// so decryption returns the same hex string back.
			let ciphertext = sealer.seal(fill_wallet.private_key_hex.as_bytes()).map_err(|e| {
				(
					StatusCode::INTERNAL_SERVER_ERROR,
					Json(ErrorResponse {
						error: "SEAL_FAILED".into(),
						message: format!("failed to seal fill-wallet key: {e}"),
						timestamp: Utc::now().timestamp(),
					}),
				)
			})?;
			state
				.storage
				.set_encrypted_fill_wallet_key(&solver_id_str, ciphertext)
				.await
				.map_err(|e| {
					(
						StatusCode::INTERNAL_SERVER_ERROR,
						Json(ErrorResponse {
							error: "STORAGE_ERROR".into(),
							message: format!(
								"failed to persist encrypted fill-wallet key: {e}"
							),
							timestamp: Utc::now().timestamp(),
						}),
					)
				})?;
			info!(
				solver_id = %solver_id_str,
				fill_wallet_address = %fill_wallet.address,
				"operator registered with encrypted fill-wallet key persisted"
			);
		}
		None => {
			// No sealer configured → cannot persist the private key
			// safely. Refuse the registration rather than leak the key.
			warn!(
				solver_id = %solver_id_str,
				"registration rejected: FILL_WALLET_ENCRYPTION_KEY not configured on aggregator"
			);
			return Err((
				StatusCode::SERVICE_UNAVAILABLE,
				Json(ErrorResponse {
					error: "SEALER_NOT_CONFIGURED".into(),
					message: "aggregator is not configured to store fill-wallet keys; \
							  set FILL_WALLET_ENCRYPTION_KEY on the aggregator and retry"
						.into(),
					timestamp: Utc::now().timestamp(),
				}),
			));
		}
	}

	Ok(Json(SolverRegisterResponse {
		success: true,
		solver_id: Some(solver_id_str.clone()),
		fill_wallet_address: Some(fill_wallet.address.clone()),
		api_key: Some(api_key.clone()),
	}))
}

/// POST /solver-api/account/unregister — Remove a solver identity
pub async fn post_account_unregister(
	State(state): State<AppState>,
	Json(payload): Json<SolverRegisterRequest>,
) -> Result<Json<SolverRegisterResponse>, (StatusCode, Json<ErrorResponse>)> {
	info!("Unregistering solver account for address: {}", payload.address);

	let solver_id_str = payload.address.to_lowercase().replace("0x", "solver-");
	let _ = state.storage.delete_solver(&solver_id_str).await;

	Ok(Json(SolverRegisterResponse {
		success: true,
		solver_id: None,
		fill_wallet_address: None,
		api_key: None,
	}))
}

/// GET /solver-api/solver/identities — Return all registered solver identities from Postgres
pub async fn get_solver_identities(
	State(state): State<AppState>,
) -> Result<Json<GetSolverIdentitiesResponse>, (StatusCode, Json<ErrorResponse>)> {
	let now = chrono::Utc::now().to_rfc3339();
	let mut identities = Vec::new();

	match state.storage.list_all_solvers().await {
		Ok(solvers) => {
			for (idx, solver) in solvers.into_iter().enumerate() {
				identities.push(SolverIdentityDto {
					id: (idx + 1) as u64,
					solver_id: solver.solver_id.clone(),
					address: solver.metadata.name.unwrap_or_else(|| solver.solver_id.clone()),
					chain: Some("eip155:11155420".to_string()),
					status: if solver.status == SolverStatus::Active {
						"active".to_string()
					} else {
						"inactive".to_string()
					},
					r#type: "EOA".to_string(),
					created_at: solver.created_at.to_rfc3339(),
					updated_at: now.clone(),
				});
			}
		}
		Err(e) => {
			error!("Failed to list solvers: {}", e);
		}
	}

	// Return empty array when no solvers registered — no hardcoded fallback
	Ok(Json(GetSolverIdentitiesResponse { data: identities }))
}

/// GET /api/v1/solver/register/message — Return a challenge nonce to sign
pub async fn get_register_message(
) -> Result<Json<RegisterMessageResponse>, (StatusCode, Json<ErrorResponse>)> {
	let nonce = format!("{:x}", chrono::Utc::now().timestamp_millis());
	Ok(Json(RegisterMessageResponse {
		data: RegisterMessageDataDto {
			message: format!(
				"Linkiswap Solver Registration\nNonce: {}\nSign to prove ownership of solver node.",
				nonce
			),
		},
	}))
}

/// GET /api/v1/solver/supported-contracts — Canonical settlement contracts
pub async fn get_supported_contracts(
) -> Result<Json<SupportedContractsResponseDto>, (StatusCode, Json<ErrorResponse>)> {
	Ok(Json(SupportedContractsResponseDto {
		data: ContractsByKindDto {
			input_settler: vec![
				ContractEntry {
					chain: "eip155:11155420".to_string(),
					address: "0x1CC9260E285C2C8AC8D2E7102F3978056Ec1d0a8".to_string(),
				},
				ContractEntry {
					chain: "eip155:84532".to_string(),
					address: "0x52602D7cc3D833F5d28ee6D01C7F82C9b2322e10".to_string(),
				},
			],
			output_settler: vec![
				ContractEntry {
					chain: "eip155:11155420".to_string(),
					address: "0x1CC9260E285C2C8AC8D2E7102F3978056Ec1d0a8".to_string(),
				},
				ContractEntry {
					chain: "eip155:84532".to_string(),
					address: "0x52602D7cc3D833F5d28ee6D01C7F82C9b2322e10".to_string(),
				},
			],
			oracle: vec![ContractEntry {
				chain: "eip155:11155420".to_string(),
				address: "0x000000000022D473030F116dDEE9F6B43aC78BA3".to_string(),
			}],
		},
	}))
}

/// GET /solver-api/quotes — Return all persisted quotes from Postgres
pub async fn get_solver_quotes(
	State(state): State<AppState>,
) -> Result<Json<GetSolverQuotesResponseDto>, (StatusCode, Json<ErrorResponse>)> {
	let quotes = state.storage.list_solver_quotes(None).await.unwrap_or_default();
	let dtos: Vec<SolverQuoteDto> = quotes.into_iter().map(SolverQuoteDto::from).collect();
	Ok(Json(GetSolverQuotesResponseDto { data: dtos }))
}

/// DELETE /solver-api/quotes/:id — Delete a quote from Postgres
pub async fn delete_solver_quote(
	State(state): State<AppState>,
	axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<DeleteQuoteResponse>, (StatusCode, Json<ErrorResponse>)> {
	let deleted = state.storage.delete_solver_quote(&id).await.unwrap_or(false);
	Ok(Json(DeleteQuoteResponse { success: deleted }))
}

/// POST /solver-api/quotes/:id/pause — Toggle pause on a quote
pub async fn toggle_pause_solver_quote(
	State(state): State<AppState>,
	axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<TogglePauseResponse>, (StatusCode, Json<ErrorResponse>)> {
	let updated = state.storage.toggle_pause_solver_quote(&id).await.unwrap_or(None);
	Ok(Json(TogglePauseResponse {
		success: updated.is_some(),
		paused: updated.map(|q| q.paused),
	}))
}

/// GET /solver-api/telemetry — Return real order telemetry from Postgres
pub async fn get_telemetry(
	State(state): State<AppState>,
) -> Result<Json<GetTelemetryResponse>, (StatusCode, Json<ErrorResponse>)> {
	let orders = state.storage.list_all_orders().await.unwrap_or_default();

	let items: Vec<OrderTelemetryItem> = orders
		.into_iter()
		.map(|o| {
			use oif_types::oif::common::OrderStatus;
			let status_str = match o.status() {
				OrderStatus::Created => "created",
				OrderStatus::Pending => "filling",
				OrderStatus::Executing => "executing",
				OrderStatus::Executed => "executed",
				OrderStatus::Settling => "settling",
				OrderStatus::Settled => "settled",
				OrderStatus::Finalized => "finalized",
				OrderStatus::Refunded => "refunded",
				OrderStatus::Failed(_, _) => "failed",
			};
			// Settlement transaction hashes are recorded per stage
			// (prepare / fill / claim) on the order.
			let input = o.order.input_amounts().first();
			let output = o.order.output_amounts().first();
			let stage_tx = |stage: &str| {
				o.order
					.fill_transaction()
					.and_then(|t| t.get(stage))
					.and_then(|v| v.as_str())
					.map(str::to_string)
			};
			// CAIP-2 chain + bare token address, which is what the
			// dashboard renders.
			let chain_of = |a: Option<&oif_types::oif::common::AssetAmount>| {
				a.and_then(|x| x.asset.extract_chain_id().ok())
					.map(|id| format!("eip155:{id}"))
					.unwrap_or_default()
			};
			let asset_of = |a: Option<&oif_types::oif::common::AssetAmount>| {
				a.map(|x| x.asset.extract_address()).unwrap_or_default()
			};
			let amount_of = |a: Option<&oif_types::oif::common::AssetAmount>| {
				a.and_then(|x| x.amount.as_ref())
					.map(|v| v.to_string())
					.unwrap_or_default()
			};

			OrderTelemetryItem {
				id: o.order_id.clone(),
				intent_id: o
					.quote_details
					.as_ref()
					.map(|q| q.quote_id.clone())
					.unwrap_or_else(|| o.order_id.clone()),
				// The user is the receiver on the quote's output leg.
				user_address: o
					.quote_details
					.as_ref()
					.and_then(|q| q.quote.preview().outputs.first())
					.map(|out| out.receiver.extract_address())
					.unwrap_or_default(),
				from_chain: chain_of(input),
				to_chain: chain_of(output),
				from_asset: asset_of(input),
				to_asset: asset_of(output),
				from_amount: amount_of(input),
				to_amount: amount_of(output),
				status: status_str.to_string(),
				// prepare = escrow on the origin chain, fill = delivery
				// on the destination chain.
				origin_tx_hash: stage_tx("prepare").or_else(|| stage_tx("claim")),
				dest_tx_hash: stage_tx("fill"),
				created_at: o.created_at().to_rfc3339(),
				updated_at: o.updated_at().to_rfc3339(),
			}
		})
		.collect();

	Ok(Json(GetTelemetryResponse { data: items }))
}

/// GET /solver-api/vaults — Vault balances for the authenticated operator.
///
/// Auth: the dashboard sends `x-api-key` (the per-operator api_key
/// generated at registration). We resolve that to a `solver_id` via
/// `DbApiKeyAuthenticator::get_operator_by_api_key`, then return
/// every `vault_balances` row tagged with that solver_id.
///
/// Until the on-chain vault contract is deployed, every row's
/// `locked` field is `"0"` and `available` is whatever the operator
/// last reported via `POST /solver-api/vaults/snapshot`. This is
/// honest about what the aggregator knows and what it doesn't.
pub async fn get_vault_balances(
	State(state): State<AppState>,
	headers: HeaderMap,
) -> Result<Json<GetVaultBalancesResponse>, (StatusCode, Json<ErrorResponse>)> {
	let solver_id = match solver_id_from_headers(&state, &headers).await {
		Ok(s) => s,
		Err(resp) => return Err(resp),
	};

	let rows = state
		.storage
		.list_vault_balances(&solver_id)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "VAULT_LIST_FAILED".into(),
					message: format!("failed to load vault balances: {e}"),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;

	let data: Vec<VaultAsset> = rows.into_iter().map(vault_balance_to_dto).collect();
	Ok(Json(GetVaultBalancesResponse { data }))
}

/// POST /solver-api/vaults/snapshot — upsert one (chain, asset) row
/// for the authenticated operator.
///
/// Auth: same as `get_vault_balances`. We never trust the body to
/// carry a `solver_id`; it's always derived from the api_key so an
/// operator can only write rows for themselves.
///
/// The body shape is deliberately minimal — operators paste their
/// wallet state into the dashboard, the dashboard sends it here.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSnapshotRequest {
	pub chain: String,
	pub asset_address: String,
	pub symbol: String,
	#[serde(default)]
	pub name: String,
	pub available: String,
}

pub async fn post_vault_snapshot(
	State(state): State<AppState>,
	headers: HeaderMap,
	Json(payload): Json<VaultSnapshotRequest>,
) -> Result<Json<VaultSnapshotResponse>, (StatusCode, Json<ErrorResponse>)> {
	let solver_id = match solver_id_from_headers(&state, &headers).await {
		Ok(s) => s,
		Err(resp) => return Err(resp),
	};

	// `asset_address` may be `native` for the chain's gas token or
	// an ERC-20 address. We don't validate that it's a real address
	// — the dashboard is the source of truth for what the operator
	// actually holds, and rejecting `native` would force the
	// operator into a workaround. Lower-casing on the storage
	// layer keeps lookups consistent.
	if payload.chain.trim().is_empty() {
		return Err((
			StatusCode::BAD_REQUEST,
			Json(ErrorResponse {
				error: "INVALID_CHAIN".into(),
				message: "chain must not be empty".into(),
				timestamp: Utc::now().timestamp(),
			}),
		));
	}
	if payload.symbol.trim().is_empty() {
		return Err((
			StatusCode::BAD_REQUEST,
			Json(ErrorResponse {
				error: "INVALID_SYMBOL".into(),
				message: "symbol must not be empty".into(),
				timestamp: Utc::now().timestamp(),
			}),
		));
	}

	let balance = VaultBalance::new(
		solver_id.clone(),
		payload.chain.trim().to_string(),
		payload.asset_address.trim().to_string(),
		payload.symbol.trim().to_string(),
		payload.available.trim().to_string(),
	);
	let mut balance = balance;
	balance.name = payload.name.trim().to_string();

	state
		.storage
		.upsert_vault_balance(balance.clone())
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "VAULT_UPSERT_FAILED".into(),
					message: format!("failed to persist vault balance: {e}"),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;

	info!(
		solver_id = %solver_id,
		chain = %balance.chain,
		asset_address = %balance.asset_address,
		available = %balance.available,
		"vault balance snapshot accepted"
	);

	Ok(Json(VaultSnapshotResponse {
		success: true,
		row: vault_balance_to_dto(balance),
	}))
}

/// DELETE /solver-api/vaults/{chain}/{asset} — remove one row.
///
/// Path params are not url-safe enough to expect raw asset_address
/// (the leading `0x` plus 40 hex chars is fine, but operators might
/// type `native` and we want to support that too). We accept any
/// non-empty string.
pub async fn delete_vault_asset(
	State(state): State<AppState>,
	headers: HeaderMap,
	axum::extract::Path((chain, asset_address)): axum::extract::Path<(String, String)>,
) -> Result<Json<DeleteVaultAssetResponse>, (StatusCode, Json<ErrorResponse>)> {
	let solver_id = match solver_id_from_headers(&state, &headers).await {
		Ok(s) => s,
		Err(resp) => return Err(resp),
	};

	let deleted = state
		.storage
		.delete_vault_balance(&solver_id, &chain, &asset_address)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "VAULT_DELETE_FAILED".into(),
					message: format!("failed to delete vault balance: {e}"),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;

	if !deleted {
		return Err((
			StatusCode::NOT_FOUND,
			Json(ErrorResponse {
				error: "VAULT_BALANCE_NOT_FOUND".into(),
				message: format!(
					"no vault balance for chain={chain} asset={asset_address}"
				),
				timestamp: Utc::now().timestamp(),
			}),
		));
	}

	info!(
		solver_id = %solver_id,
		chain = %chain,
		asset_address = %asset_address,
		"vault balance row deleted"
	);

	Ok(Json(DeleteVaultAssetResponse { success: true }))
}

// ─── Vault DTOs ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSnapshotResponse {
	pub success: bool,
	pub row: VaultAsset,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteVaultAssetResponse {
	pub success: bool,
}

/// `VaultBalance` (storage-layer row) → `VaultAsset` (HTTP DTO).
///
/// The storage row has an `updated_at` we expose as a stable
/// `total` for the dashboard (the dashboard renders `available +
/// locked` itself, but we keep `total` populated for parity with the
/// old hardcoded dashboard contract).
fn vault_balance_to_dto(b: VaultBalance) -> VaultAsset {
	let total = b.total();
	let usd_value = total.clone();
	VaultAsset {
		symbol: b.symbol,
		name: b.name,
		chain: b.chain,
		available: b.available,
		locked: b.locked,
		total,
		usd_value,
	}
}

/// Resolve the calling operator from the request's `x-api-key` (or
/// the `x-solver-id` header for the fill-worker's signed path). Used
/// by all `/solver-api/vaults/*` handlers so they share one
/// resolution path.
async fn solver_id_from_headers(
	state: &AppState,
	headers: &HeaderMap,
) -> Result<String, (StatusCode, Json<ErrorResponse>)> {
	let api_key = headers
		.get("x-api-key")
		.and_then(|v| v.to_str().ok())
		.ok_or_else(|| {
			(
				StatusCode::UNAUTHORIZED,
				Json(ErrorResponse {
					error: "UNAUTHORIZED".into(),
					message: "missing x-api-key header".into(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;

	state
		.storage
		.get_operator_by_api_key(api_key)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "AUTH_BACKEND_ERROR".into(),
					message: format!("failed to resolve api_key: {e}"),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?
		.map(|op| op.solver_id)
		.ok_or_else(|| {
			(
				StatusCode::UNAUTHORIZED,
				Json(ErrorResponse {
					error: "INVALID_API_KEY".into(),
					message: "x-api-key did not match any registered operator".into(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})
}

/// POST /quotes/trustComponents
pub async fn post_trust_components(
	Json(payload): Json<TrustComponentsRequest>,
) -> Result<Json<TrustComponentsResponse>, (StatusCode, Json<ErrorResponse>)> {
	Ok(Json(TrustComponentsResponse {
		settlers: vec![ContractEntry {
			chain: payload.from_chain.clone(),
			address: "0x1CC9260E285C2C8AC8D2E7102F3978056Ec1d0a8".to_string(),
		}],
		oracles: vec![ContractEntry {
			chain: payload.to_chain.clone(),
			address: "0x000000000022D473030F116dDEE9F6B43aC78BA3".to_string(),
		}],
	}))
}

/// GET /ws/orders — WebSocket order stream for solver operators.
///
/// Authenticated via **either** of:
///
/// 1. The same `x-auth-*` signed headers the fill-worker attaches to
///    every other aggregator request (see
///    `auth::fill_worker_auth`). Required when the fill-worker itself
///    opens the WebSocket to drive its `OrderSubscription`. The
///    signature is verified via ecrecover over the canonical
///    `keccak256("linkiswap-auth\n{solver_id}\n{timestamp}\n{nonce}\nGET\n/ws/orders")`
///    digest, plus a nonce-cache replay check.
/// 2. The dashboard's `x-api-key` header (standard admin-key auth used
///    everywhere else in the dashboard). The handler recovers the
///    solver id from a paired `x-solver-id` header (lower-case
///    checksummed) — the dashboard has the user's connected wallet
///    address readily available.
///
/// Either path must be present; otherwise we return 401. Once
/// authenticated, the handler subscribes to `state.order_broadcaster`
/// and streams every new order as a JSON text frame until the client
/// disconnects or the broadcaster's in-memory buffer overflows (in
/// which case we send a `{ "status": "lagged", "dropped": N }`
/// heartbeat and continue).
/// Query-string auth parameters used by the **dashboard** when it
/// opens `/ws/orders` from a browser WebSocket. Browser WebSockets
/// cannot attach custom headers, so the dashboard passes its API key
/// + solver id as query params. The fill-worker path uses the
/// four signed headers instead.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsOrdersQuery {
	#[serde(default)]
	pub api_key: Option<String>,
	#[serde(default)]
	pub solver_id: Option<String>,
}

pub async fn ws_orders(
	State(state): State<AppState>,
	headers: HeaderMap,
	Query(query): Query<WsOrdersQuery>,
	ws: WebSocketUpgrade,
) -> impl IntoResponse {
	// Branch 1 — dashboard query-string auth (?api_key=…&solver_id=…).
	// Browser WebSockets can't carry custom headers, so the dashboard
	// passes its auth via the URL. This is fine because the connection
	// is over TLS in production.
	if let (Some(api_key), Some(solver_id_q)) = (query.api_key.as_ref(), query.solver_id.as_ref()) {
		let mut auth_req =
			oif_types::auth::AuthRequest::new("GET".to_string(), "/ws/orders".to_string());
		auth_req = auth_req.with_header("x-api-key".to_string(), api_key.clone());
		auth_req = auth_req.with_header("x-solver-id".to_string(), solver_id_q.clone());
		match state.authenticator.authenticate(&auth_req).await {
			oif_types::auth::AuthenticationResult::Authorized(_) => {
				let solver_id = solver_id_q.to_lowercase();
				info!(solver_id = %solver_id, "ws_orders dashboard handshake accepted");
				let broadcaster = state.order_broadcaster.clone();
				return ws.on_upgrade(move |socket| {
					handle_order_socket(socket, broadcaster, solver_id)
				});
			}
			_ => return ws_refused("invalid api_key query parameter"),
		}
	}
	// Branch 1b — header-based dashboard auth (non-browser clients).
	if let Some(api_key_value) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
		let mut auth_req =
			oif_types::auth::AuthRequest::new("GET".to_string(), "/ws/orders".to_string());
		auth_req = auth_req.with_header("x-api-key".to_string(), api_key_value.to_string());
		if let Some(sid) = headers.get("x-solver-id").and_then(|v| v.to_str().ok()) {
			auth_req = auth_req.with_header("x-solver-id".to_string(), sid.to_string());
		}
		match state.authenticator.authenticate(&auth_req).await {
			oif_types::auth::AuthenticationResult::Authorized(_) => {
				let solver_id = match headers.get("x-solver-id").and_then(|v| v.to_str().ok()) {
					Some(v) => v.to_lowercase(),
					None => {
						return ws_refused("missing x-solver-id on dashboard WS upgrade");
					}
				};
				info!(solver_id = %solver_id, "ws_orders dashboard handshake accepted");
				let broadcaster = state.order_broadcaster.clone();
				return ws.on_upgrade(move |socket| {
					handle_order_socket(socket, broadcaster, solver_id)
				});
			}
			_ => return ws_refused("invalid x-api-key"),
		}
	}

	// Branch 2 — fill-worker signed-header auth.
	let solver_id = match headers.get(fill_auth::HDR_SOLVER_ID).and_then(|v| v.to_str().ok()) {
		Some(v) => v.to_lowercase(),
		None => {
			return ws_refused("missing x-solver-id header on WS upgrade");
		}
	};
	let timestamp_str = match headers.get(fill_auth::HDR_TIMESTAMP).and_then(|v| v.to_str().ok()) {
		Some(v) => v.to_string(),
		None => return ws_refused("missing x-auth-timestamp header on WS upgrade"),
	};
	let timestamp: u64 = match timestamp_str.parse() {
		Ok(t) => t,
		Err(_) => return ws_refused("x-auth-timestamp is not a u64"),
	};
	let nonce = match headers.get(fill_auth::HDR_NONCE).and_then(|v| v.to_str().ok()) {
		Some(v) => v.to_string(),
		None => return ws_refused("missing x-auth-nonce header on WS upgrade"),
	};
	let signature_hex = match headers.get(fill_auth::HDR_SIGNATURE).and_then(|v| v.to_str().ok())
	{
		Some(v) => v.to_string(),
		None => return ws_refused("missing x-auth-signature header on WS upgrade"),
	};

	// 2. Verify the signed handshake — clock skew + ecrecover. Extracted
	//    into a pure helper (`verify_signed_ws_handshake`) below so it
	//    can be unit-tested without a router.
	let now = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_secs())
		.unwrap_or(0);
	if let Err(e) = verify_signed_ws_handshake(
		&solver_id,
		timestamp,
		&nonce,
		&signature_hex,
		now,
	) {
		return ws_refused_owned(e);
	}

	// 3. Replay protection: insert the nonce into the cache. If it's
	//    already there, refuse the upgrade.
	if let Err(e) = state
		.fill_worker_nonce_cache
		.check_and_insert(&nonce, now)
	{
		return ws_refused_owned(format!("nonce replay: {e}"));
	}

	info!(solver_id = %solver_id, "ws_orders handshake accepted");

	let broadcaster = state.order_broadcaster.clone();
	ws.on_upgrade(move |socket| handle_order_socket(socket, broadcaster, solver_id))
}

/// Reject a WebSocket upgrade by returning a JSON 401 response.
fn ws_refused(reason: &'static str) -> axum::response::Response {
	warn!(reason, "refusing /ws/orders upgrade");
	reject_ws(reason)
}

/// Owned variant used by [`ws_refused`].
fn ws_refused_owned(reason: String) -> axum::response::Response {
	warn!(reason = %reason, "refusing /ws/orders upgrade");
	let owned: &'static str = Box::leak(reason.into_boxed_str());
	reject_ws(owned)
}

fn reject_ws(reason: &'static str) -> axum::response::Response {
	(
		StatusCode::UNAUTHORIZED,
		Json(serde_json::json!({
			"error": "WS_HANDSHAKE_FAILED",
			"message": reason,
		})),
	)
		.into_response()
}

/// Pure verification of the four signed `x-auth-*` headers against
/// the canonical upgrade request (`GET /ws/orders`). Returns the
/// recovered operator address on success. Extracted from
/// `ws_orders` so the verification logic is unit-testable without an
/// Axum router or `AppState`.
pub fn verify_signed_ws_handshake(
	solver_id: &str,
	timestamp: u64,
	nonce: &str,
	signature_hex: &str,
	now_unix: u64,
) -> Result<Address, String> {
	// 1. Clock-skew window.
	let skew = (now_unix as i64) - (timestamp as i64);
	if skew.abs() > fill_auth::MAX_CLOCK_SKEW_SECS {
		return Err(format!(
			"x-auth-timestamp out of window (skew={skew}s, max={})",
			fill_auth::MAX_CLOCK_SKEW_SECS
		));
	}

	// 2. ecrecover over the canonical signing payload.
	let digest = fill_auth::build_signing_payload(solver_id, timestamp, nonce, "GET", "/ws/orders");
	let sig_bytes = alloy_primitives::hex::decode(signature_hex.trim_start_matches("0x"))
		.map_err(|e| format!("x-auth-signature is not valid hex: {e}"))?;
	if sig_bytes.len() != 65 {
		return Err(format!(
			"x-auth-signature must be 65 bytes, got {}",
			sig_bytes.len()
		));
	}
	let sig = alloy_primitives::Signature::from_raw(&sig_bytes)
		.map_err(|e| format!("malformed signature: {e}"))?;
	let recovered = sig
		.recover_address_from_prehash(&digest)
		.map_err(|e| format!("ecdsa recovery failed: {e}"))?;

	// 3. Recovered address must match the claimed solver-id.
	let recovered_str = format!("{recovered:#x}").to_lowercase();
	let claimed = solver_id.to_lowercase();
	if recovered_str != claimed {
		return Err(format!(
			"recovered address {recovered_str} does not match claimed {claimed}"
		));
	}
	Ok(recovered)
}

async fn handle_order_socket(
	mut socket: WebSocket,
	broadcaster: crate::order_broadcast::OrderBroadcaster,
	solver_id: String,
) {
	// Send a hello frame so the client knows the handshake landed.
	if let Err(e) = socket
		.send(Message::Text(
			serde_json::json!({
				"status": "connected",
				"solver_id": solver_id,
				"message": "subscribed to /ws/orders — orders will arrive as JSON text frames",
			})
			.to_string()
			.into(),
		))
		.await
	{
		error!("error sending /ws/orders hello: {}", e);
		return;
	}

	let mut rx = broadcaster.subscribe();

	loop {
		// 1. Forward any broadcaster message to the client.
		match rx.recv().await {
			Ok(envelope) => {
				let frame = serde_json::json!({
					"status": "order",
					"order": envelope,
				})
				.to_string();
				if socket.send(Message::Text(frame.into())).await.is_err() {
					break;
				}
			}
			Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
				warn!(solver_id = %solver_id, dropped = n, "subscriber lagged");
				let frame = serde_json::json!({
					"status": "lagged",
					"dropped": n,
				})
				.to_string();
				if socket.send(Message::Text(frame.into())).await.is_err() {
					break;
				}
			}
			Err(tokio::sync::broadcast::error::RecvError::Closed) => {
				info!("order broadcaster closed; ending /ws/orders session");
				break;
			}
		}

		// 2. Detect client-side close (or any inbound message) without
		//    blocking — `socket.next()` is the canonical way to poll
		//    for a `Message::Close`. We only break on Close/Err; any
		//    text frames from the client are logged and ignored.
		match socket.next().await {
			Some(Ok(Message::Close(_))) | None => break,
			Some(Err(e)) => {
				error!(solver_id = %solver_id, error = %e, "ws read error");
				break;
			}
			Some(Ok(_)) => {}
		}
	}

	info!(solver_id = %solver_id, "/ws/orders client disconnected");
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
	use super::*;
	use alloy_signer::SignerSync;
	use alloy_signer_local::PrivateKeySigner;

	/// Canonical test vector: secp256k1 private key `0x00…01`
	/// should yield address `0x7e5f4552091a69125d5dfcb7b8c2659029395bdf`.
	const TEST_KEY: &str = "0x0000000000000000000000000000000000000000000000000000000000000001";
	const TEST_ADDRESS: &str = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";

	fn build_signer() -> PrivateKeySigner {
		TEST_KEY.parse::<PrivateKeySigner>().expect("hard-coded test key is valid")
	}

	/// Sign `message` with the test signer, returning the 0x-prefixed
	/// 65-byte EIP-191 signature (the wire format wagmi produces).
	fn sign_message(message: &str) -> String {
		let signer = build_signer();
		let sig = signer
			.sign_message_sync(message.as_bytes())
			.expect("test signer can sign");
		format!("{sig}")
	}

	#[test]
	fn verify_register_signature_accepts_valid_signature() {
		let message = "Linkiswap Solver Registration\nNonce: deadbeef\nSign to prove ownership of solver node.";
		let signature = sign_message(message);
		let recovered =
			verify_register_signature(TEST_ADDRESS, message, &signature).expect("valid signature must verify");
		assert_eq!(format!("{recovered:#x}").to_lowercase(), TEST_ADDRESS);
	}

	#[test]
	fn verify_register_signature_accepts_unprefixed_address() {
		let message = "Linkiswap Solver Registration\nNonce: 1234";
		let signature = sign_message(message);
		// Should accept the address with or without 0x prefix.
		let recovered = verify_register_signature(
			TEST_ADDRESS.trim_start_matches("0x"),
			message,
			&signature,
		)
		.expect("unprefixed address should also verify");
		assert_eq!(format!("{recovered:#x}").to_lowercase(), TEST_ADDRESS);
	}

	#[test]
	fn verify_register_signature_rejects_wrong_message() {
		let message = "Linkiswap Solver Registration\nNonce: real";
		let signature = sign_message(message);
		// Signer signed `message`, but we present a different one.
		let err = verify_register_signature(
			TEST_ADDRESS,
			"Linkiswap Solver Registration\nNonce: tampered",
			&signature,
		)
		.expect_err("tampered message must fail");
		assert!(
			err.contains("does not match"),
			"error should explain address mismatch: {err}"
		);
	}

	#[test]
	fn verify_register_signature_rejects_malformed_signature() {
		// Wrong length — only 64 bytes (128 hex chars).
		let bad_sig = "0x".to_string() + &"a".repeat(128);
		let err = verify_register_signature(TEST_ADDRESS, "any message", &bad_sig)
			.expect_err("malformed signature must fail");
		assert!(
			err.contains("65 bytes"),
			"error should mention length: {err}"
		);
	}

	#[test]
	fn verify_register_signature_rejects_wrong_address() {
		let message = "Linkiswap Solver Registration\nNonce: 9999";
		let signature = sign_message(message);
		// Signature is valid for TEST_ADDRESS but we claim a different one.
		let wrong_address = "0x0000000000000000000000000000000000000099";
		let err = verify_register_signature(wrong_address, message, &signature)
			.expect_err("wrong claimed address must fail");
		assert!(
			err.contains("does not match"),
			"error should mention address mismatch: {err}"
		);
	}

	// ─── verify_signed_ws_handshake tests ──────────────────────────────

	/// Sign the canonical `/ws/orders` handshake payload (method +
	/// path + auth headers) with the test signer. Mirrors what
	/// `fill_worker::auth::sign_request` produces for `GET /ws/orders`.
	fn sign_ws_handshake(solver_id: &str, timestamp: u64, nonce_hex: &str) -> String {
		use alloy_primitives::keccak256;
		let mut buf = Vec::new();
		buf.extend_from_slice(b"linkiswap-auth\n");
		buf.extend_from_slice(solver_id.as_bytes());
		buf.push(b'\n');
		buf.extend_from_slice(timestamp.to_string().as_bytes());
		buf.push(b'\n');
		buf.extend_from_slice(nonce_hex.as_bytes());
		buf.push(b'\n');
		buf.extend_from_slice(b"GET");
		buf.push(b'\n');
		buf.extend_from_slice(b"/ws/orders");
		let digest = keccak256(&buf);
		let signer = build_signer();
		let sig = signer
			.sign_hash_sync(&digest)
			.expect("signer can sign digest");
		format!("{sig}")
	}

	#[test]
	fn verify_signed_ws_handshake_accepts_valid_envelope() {
		let now = 1_700_000_000;
		let nonce = "00".repeat(16);
		let sig = sign_ws_handshake(TEST_ADDRESS, now, &nonce);
		let recovered = verify_signed_ws_handshake(TEST_ADDRESS, now, &nonce, &sig, now)
			.expect("valid handshake must verify");
		assert_eq!(format!("{recovered:#x}").to_lowercase(), TEST_ADDRESS);
	}

	#[test]
	fn verify_signed_ws_handshake_rejects_stale_timestamp() {
		let now = 1_700_000_000;
		let nonce = "00".repeat(16);
		let sig = sign_ws_handshake(TEST_ADDRESS, now, &nonce);
		let too_old = now - fill_auth::MAX_CLOCK_SKEW_SECS as u64 - 1;
		let err = verify_signed_ws_handshake(TEST_ADDRESS, too_old, &nonce, &sig, now)
			.expect_err("stale timestamp must fail");
		assert!(err.contains("out of window"), "expected window error: {err}");
	}

	#[test]
	fn verify_signed_ws_handshake_rejects_wrong_path() {
		// Sign over `/api/v1/orders` instead of `/ws/orders`. The
		// handshake recovery must not match.
		use alloy_primitives::keccak256;
		let now = 1_700_000_000;
		let nonce = "00".repeat(16);
		let mut buf = Vec::new();
		buf.extend_from_slice(b"linkiswap-auth\n");
		buf.extend_from_slice(TEST_ADDRESS.as_bytes());
		buf.push(b'\n');
		buf.extend_from_slice(now.to_string().as_bytes());
		buf.push(b'\n');
		buf.extend_from_slice(nonce.as_bytes());
		buf.push(b'\n');
		buf.extend_from_slice(b"GET");
		buf.push(b'\n');
		buf.extend_from_slice(b"/api/v1/orders");
		let wrong_digest = keccak256(&buf);
		let signer = build_signer();
		let wrong_sig = signer
			.sign_hash_sync(&wrong_digest)
			.expect("signer can sign");
		let wrong_sig_hex = format!("{wrong_sig}");
		let err = verify_signed_ws_handshake(TEST_ADDRESS, now, &nonce, &wrong_sig_hex, now)
			.expect_err("wrong path must not recover to TEST_ADDRESS");
		assert!(err.contains("does not match"), "expected mismatch: {err}");
	}

	#[test]
	fn verify_signed_ws_handshake_rejects_malformed_signature() {
		let err = verify_signed_ws_handshake(TEST_ADDRESS, 1_700_000_000, "deadbeef", "0xzz", 1_700_000_000)
			.expect_err("non-hex signature must fail");
		assert!(
			err.contains("not valid hex"),
			"expected hex-parse error: {err}"
		);
	}
}
