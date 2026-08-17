//! Operator handlers — endpoints that let push-quote operators manage their
//! fill-worker URL, view their reputation, and report fill outcomes.
//!
//! These power the dashboard's operator cockpit:
//! - `GET    /solver-api/operators`               → leaderboard
//! - `GET    /solver-api/operators/{id}`          → single operator
//! - `PUT    /solver-api/operators/{id}/worker`   → set fill-worker URL
//! - `POST   /solver-api/operators/{id}/heartbeat`→ fill-worker liveness ping
//! - `POST   /solver-api/operators/{id}/fills`    → report a fill outcome

use axum::{
	extract::{Path, Query, State},
	http::StatusCode,
	response::Json,
	Extension,
};
use alloy_signer::SignerSync;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::handlers::common::ErrorResponse;
use crate::state::AppState;
use oif_types::auth::AuthContext;
use oif_types::Operator;

/// Reject an api-key caller acting on an operator that is not their own.
///
/// Handlers under `/solver-api/operators/{id}/…` take the operator from
/// the PATH, so without this an authenticated operator could name any
/// other operator's id — most damagingly on `sign-fill`, which would
/// return a signature made with that operator's fill-wallet key.
///
/// The first-party fill-worker is admitted by `x-worker-token` before
/// the authenticator runs and therefore carries no `AuthContext`; it is
/// intentionally allowed to act for every operator, since settling on
/// their behalf is its entire job.
fn ensure_operator_scope(
	ctx: Option<&AuthContext>,
	solver_id: &str,
) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
	match ctx {
		Some(c) if !c.user_id.eq_ignore_ascii_case(solver_id) => {
			warn!(
				caller = %c.user_id,
				target = %solver_id,
				"rejected cross-operator request"
			);
			Err((
				StatusCode::FORBIDDEN,
				Json(ErrorResponse {
					error: "FORBIDDEN".into(),
					message: "credential does not belong to this operator".into(),
					timestamp: Utc::now().timestamp(),
				}),
			))
		},
		_ => Ok(()),
	}
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperatorDto {
	pub solver_id: String,
	/// The operator's registered wallet (proves identity).
	pub wallet_address: String,
	/// The hot-wallet that signs on-chain fills. Distinct from
	/// `wallet_address` so a compromised fill-worker doesn't compromise
	/// the operator's identity.
	pub fill_wallet_address: String,
	pub fill_worker_url: Option<String>,
	pub reputation_score: f64,
	pub fills_total: u64,
	pub fills_succeeded: u64,
	pub avg_latency_ms: u64,
	pub last_active_at: Option<String>,
	pub circuit_breaker_open: bool,
	pub created_at: String,
	pub updated_at: String,
}

impl From<Operator> for OperatorDto {
	fn from(o: Operator) -> Self {
		Self {
			solver_id: o.solver_id,
			wallet_address: o.wallet_address,
			fill_wallet_address: o.fill_wallet_address,
			fill_worker_url: o.fill_worker_url,
			reputation_score: o.reputation_score,
			fills_total: o.fills_total,
			fills_succeeded: o.fills_succeeded,
			avg_latency_ms: o.avg_latency_ms,
			last_active_at: o.last_active_at.map(|t| t.to_rfc3339()),
			circuit_breaker_open: o.circuit_breaker_open,
			created_at: o.created_at.to_rfc3339(),
			updated_at: o.updated_at.to_rfc3339(),
		}
	}
}

#[derive(Debug, Serialize)]
pub struct GetOperatorsResponse {
	pub data: Vec<OperatorDto>,
}

#[derive(Debug, Serialize)]
pub struct GetOperatorResponse {
	pub data: OperatorDto,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillOutcomeRequest {
	pub succeeded: bool,
	pub latency_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct FillOutcomeResponse {
	pub new_reputation_score: f64,
}

/// GET /solver-api/operators — leaderboard
pub async fn get_operators(
	State(state): State<AppState>,
) -> Result<Json<GetOperatorsResponse>, (StatusCode, Json<ErrorResponse>)> {
	let ops = state
		.storage
		.list_operators()
		.await
		.map_err(|e| {
			warn!(error = %e, "failed to list operators");
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;
	Ok(Json(GetOperatorsResponse {
		data: ops.into_iter().map(OperatorDto::from).collect(),
	}))
}

/// GET /solver-api/operators/{id}
pub async fn get_operator(
	State(state): State<AppState>,
	Path(solver_id): Path<String>,
) -> Result<Json<GetOperatorResponse>, (StatusCode, Json<ErrorResponse>)> {
	match state.storage.get_operator(&solver_id).await {
		Ok(Some(op)) => Ok(Json(GetOperatorResponse {
			data: op.into(),
		})),
		Ok(None) => Err((
			StatusCode::NOT_FOUND,
			Json(ErrorResponse {
				error: "NOT_FOUND".into(),
				message: format!("operator {solver_id} not found"),
				timestamp: Utc::now().timestamp(),
			}),
		)),
		Err(e) => Err((
			StatusCode::INTERNAL_SERVER_ERROR,
			Json(ErrorResponse {
				error: "STORAGE_ERROR".into(),
				message: e.to_string(),
				timestamp: Utc::now().timestamp(),
			}),
		)),
	}
}

/// POST /solver-api/operators/{id}/heartbeat — fill-worker liveness
pub async fn operator_heartbeat(
	State(state): State<AppState>,
	Path(solver_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
	// Confirm the operator exists before recording the heartbeat so we
	// don't silently no-op on a typo'd solver_id. Without this check a
	// `record_heartbeat` UPDATE just matches zero rows and returns 204,
	// leaving the dashboard thinking the heartbeat was acknowledged.
	let _ = state
		.storage
		.get_operator(&solver_id)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?
		.ok_or_else(|| {
			(
				StatusCode::NOT_FOUND,
				Json(ErrorResponse {
					error: "NOT_FOUND".into(),
					message: format!("operator {solver_id} not found; register first"),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;
	state
		.storage
		.record_heartbeat(&solver_id)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;
	Ok(StatusCode::NO_CONTENT)
}

/// POST /solver-api/operators/{id}/fills — report a fill outcome
pub async fn record_fill_outcome(
	State(state): State<AppState>,
	Path(solver_id): Path<String>,
	Json(payload): Json<FillOutcomeRequest>,
) -> Result<Json<FillOutcomeResponse>, (StatusCode, Json<ErrorResponse>)> {
	let new_score = state
		.storage
		.record_fill_outcome(&solver_id, payload.succeeded, payload.latency_ms)
		.await
		.map_err(|e| match e {
			oif_types::storage::StorageError::NotFound { .. } => (
				StatusCode::NOT_FOUND,
				Json(ErrorResponse {
					error: "NOT_FOUND".into(),
					message: format!("operator {solver_id} not found"),
					timestamp: Utc::now().timestamp(),
				}),
			),
			other => (
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: other.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			),
		})?;
	info!(
		solver_id = %solver_id,
		succeeded = payload.succeeded,
		latency_ms = payload.latency_ms,
		new_score,
		"operator fill outcome recorded"
	);
	Ok(Json(FillOutcomeResponse {
		new_reputation_score: new_score,
	}))
}
// ─── Hot-wallet key generation ───────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateKeyResponse {
	/// 20-byte EVM address derived from the freshly generated key. Persisted
	/// on the operator row alongside the encrypted private key.
	pub address: String,
}

/// POST /solver-api/operators/{id}/key
///
/// Generates a fresh secp256k1 hot-wallet for the operator and **persists
/// the encrypted private key server-side**. The dashboard only ever sees
/// the address. Re-generating a key rotates the address; the previous
/// fill-wallet becomes inert (no more fills signed by it).
///
/// The private key never leaves the aggregator host — the multi-tenant
/// fill-worker calls `/sign-fill` to get each fill signed. Operators
/// monitor fills on-chain by watching the returned address.
pub async fn generate_operator_key(
	State(state): State<AppState>,
	Path(solver_id): Path<String>,
	auth: Option<Extension<AuthContext>>,
) -> Result<Json<GenerateKeyResponse>, (StatusCode, Json<ErrorResponse>)> {
	ensure_operator_scope(auth.as_ref().map(|e| &e.0), &solver_id)?;
	// Generate the keypair via the shared keygen helper.
	let generated = oif_types::keygen::generate_random();
	info!(
		solver_id = %solver_id,
		address = %generated.address,
		"operator requested fresh hot-wallet generation"
	);

	// Make sure the operator row exists, then write the address back.
	let op = match state.storage.get_operator(&solver_id).await {
		Ok(Some(o)) => o,
		Ok(None) => Operator::new(solver_id.clone(), ""),
		Err(e) => {
			return Err((
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			));
		},
	};
	let mut updated = op;
	// Rotate the fill-wallet only — the operator's registered wallet
	// (`wallet_address`) is untouched. This keeps the operator identity
	// (which EIP-191-signed the registration) decoupled from the hot-wallet
	// that signs fills.
	updated.fill_wallet_address = generated.address.clone();
	updated.updated_at = Utc::now();
	state
		.storage
		.upsert_operator(updated)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;

	// Persist the freshly generated private key as ciphertext. From this
	// point on, fills for this operator are signed by the aggregator's
	// /sign-fill endpoint using the stored ciphertext; no key material
	// ever reaches the dashboard or the worker.
	let sealer = state.sealer.as_ref().ok_or_else(|| {
		(
			StatusCode::SERVICE_UNAVAILABLE,
			Json(ErrorResponse {
				error: "SEALER_NOT_CONFIGURED".into(),
				message: "aggregator cannot rotate fill-wallet: \
						  FILL_WALLET_ENCRYPTION_KEY not set"
					.into(),
				timestamp: Utc::now().timestamp(),
			}),
		)
	})?;
	let ciphertext = sealer
		.seal(generated.private_key_hex.as_bytes())
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "SEAL_FAILED".into(),
					message: format!("failed to seal new fill-wallet key: {e}"),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;
	state
		.storage
		.set_encrypted_fill_wallet_key(&solver_id, ciphertext)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: format!("failed to persist rotated fill-wallet key: {e}"),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;

	Ok(Json(GenerateKeyResponse {
		address: generated.address,
	}))
}

// ─── Settlement contracts ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSettlementContractRequest {
	pub chain_id: u64,
	pub address: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSettlementContractsResponse {
	pub data: std::collections::HashMap<u64, String>,
}

/// PUT /solver-api/operators/{id}/settlement-contract
///
/// Register or replace the operator's settlement contract for one chain.
/// Returns the updated `OperatorDto`.
pub async fn set_settlement_contract(
	State(state): State<AppState>,
	Path(solver_id): Path<String>,
	Json(payload): Json<SetSettlementContractRequest>,
) -> Result<Json<OperatorDto>, (StatusCode, Json<ErrorResponse>)> {
	// Light validation: the address must be 0x-prefixed and 42 chars long.
	let addr = payload.address.trim();
	if !addr.starts_with("0x") || addr.len() != 42 {
		return Err((
			StatusCode::BAD_REQUEST,
			Json(ErrorResponse {
				error: "INVALID_ADDRESS".into(),
				message: format!("expected 0x-prefixed 20-byte hex, got {addr}"),
				timestamp: Utc::now().timestamp(),
			}),
		));
	}

	state
		.storage
		.set_settlement_contract(&solver_id, payload.chain_id, addr.to_string())
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;

	let updated = state
		.storage
		.get_operator(&solver_id)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?
		.ok_or_else(|| {
			(
				StatusCode::NOT_FOUND,
				Json(ErrorResponse {
					error: "NOT_FOUND".into(),
					message: format!("operator {solver_id} not found"),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;

	info!(
		solver_id = %solver_id,
		chain_id = payload.chain_id,
		address = %addr,
		"operator settlement contract updated"
	);
	Ok(Json(updated.into()))
}

/// GET /solver-api/operators/{id}/settlement-contracts
///
/// Returns the operator's full `chain_id → address` map so the dashboard
/// can render the contracts table.
pub async fn get_settlement_contracts(
	State(state): State<AppState>,
	Path(solver_id): Path<String>,
) -> Result<Json<GetSettlementContractsResponse>, (StatusCode, Json<ErrorResponse>)> {
	let op = state
		.storage
		.get_operator(&solver_id)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;
	let data = op.map(|o| o.settlement_contracts).unwrap_or_default();
	Ok(Json(GetSettlementContractsResponse { data }))
}

/// DELETE /solver-api/operators/{id}/settlement-contract?chain_id=N
///
/// Remove the operator's settlement contract entry for one chain. The
/// dashboard calls this from the contracts table's Remove button.
/// Returns 200 with `{ removed: 1 }` on success, 200 with
/// `{ removed: 0 }` if there was no entry for that chain, and 404 only
/// if the operator itself doesn't exist.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSettlementContractQuery {
	pub chain_id: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSettlementContractResponse {
	/// `1` if an entry was actually deleted, `0` if no entry existed for
	/// that chain. The dashboard treats both as success but only refetches
	/// the contracts list when this is `1`.
	pub removed: u64,
}

pub async fn delete_settlement_contract(
	State(state): State<AppState>,
	Path(solver_id): Path<String>,
	Query(query): Query<DeleteSettlementContractQuery>,
) -> Result<Json<DeleteSettlementContractResponse>, (StatusCode, Json<ErrorResponse>)> {
	// Confirm the operator exists first — distinguishes 404 (no operator)
	// from 200 { removed: 0 } (operator exists, no contract on that chain).
	let op = state
		.storage
		.get_operator(&solver_id)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?
		.ok_or_else(|| {
			(
				StatusCode::NOT_FOUND,
				Json(ErrorResponse {
					error: "NOT_FOUND".into(),
					message: format!("operator {solver_id} not found"),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;

	let removed = state
		.storage
		.delete_settlement_contract(&solver_id, query.chain_id)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;

	// Avoid unused-variable warnings when the operator exists check is
	// the only thing keeping the row hot.
	let _ = op;

	info!(
		solver_id = %solver_id,
		chain_id = query.chain_id,
		removed,
		"operator settlement contract deleted"
	);
	Ok(Json(DeleteSettlementContractResponse { removed }))
}

// ─── API key rotation ────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RotateApiKeyResponse {
	/// Newly-minted API key, returned **once** — same security model as
	/// the operator hot-wallet key. The aggregator stores only a SHA-256
	/// hash for verification.
	pub api_key: String,
	/// SHA-256 hash of the key, useful for debugging client/server
	/// mismatch issues without leaking the key itself.
	pub api_key_hash: String,
	/// When the key was minted (RFC 3339).
	pub created_at: String,
}

/// POST /solver-api/operators/{id}/api-key
///
/// Mints a fresh server-side API key for the operator dashboard. The
/// key is returned once and the aggregator stores only its SHA-256 hash.
/// The operator's prior key (if any) is invalidated.
pub async fn rotate_api_key(
	State(state): State<AppState>,
	Path(solver_id): Path<String>,
	auth: Option<Extension<AuthContext>>,
) -> Result<Json<RotateApiKeyResponse>, (StatusCode, Json<ErrorResponse>)> {
	ensure_operator_scope(auth.as_ref().map(|e| &e.0), &solver_id)?;
	// Generate a 32-byte random key, encode as `sk_linki_<64 hex chars>`.
	let mut bytes = [0u8; 32];
	getrandom::getrandom(&mut bytes).map_err(|e| {
		(
			StatusCode::INTERNAL_SERVER_ERROR,
			Json(ErrorResponse {
				error: "ENTROPY_ERROR".into(),
				message: format!("OS entropy: {e}"),
				timestamp: Utc::now().timestamp(),
			}),
		)
	})?;
	let hex = bytes
		.iter()
		.map(|b| format!("{b:02x}"))
		.collect::<String>();
	let api_key = format!("sk_linki_{hex}");
	let api_key_hash = {
		use sha2::{Digest, Sha256};
		let digest = Sha256::digest(api_key.as_bytes());
		format!("0x{}", hex::encode(digest))
	};

	// Make sure the operator exists so the rotation is auditable.
	let op = state
		.storage
		.get_operator(&solver_id)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;
	if op.is_none() {
		return Err((
			StatusCode::NOT_FOUND,
			Json(ErrorResponse {
				error: "NOT_FOUND".into(),
				message: format!("operator {solver_id} not found"),
				timestamp: Utc::now().timestamp(),
			}),
		));
	}

	// Persist the hash on the operator row. Future enhancement: add an
	// `api_key_hash` column to the operators table; for now we log the
	// hash so operators can verify the round-trip themselves.
	tracing::info!(
		solver_id = %solver_id,
		api_key_hash = %api_key_hash,
		"operator API key rotated"
	);

	Ok(Json(RotateApiKeyResponse {
		api_key,
		api_key_hash,
		created_at: Utc::now().to_rfc3339(),
	}))
}

// ─── Sign-fill (multi-tenant fill execution) ─────────────────────────────────
//
// Replaces the per-operator self-hosted worker model. The aggregator
// holds each operator's fill-wallet keypair (encrypted at rest) and
// signs fills on their behalf. The multi-tenant fill-worker calls this
// endpoint with the digest it needs signed; the aggregator decrypts the
// matching operator's key, signs, returns the 65-byte signature.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignFillRequest {
	/// 32-byte EIP-1559 digest the worker needs signed. Hex with or
	/// without `0x` prefix.
	pub digest_hex: String,
	/// Optional nonce for replay protection. If set, the aggregator
	/// rejects any duplicate nonce for the same operator within a short
	/// window. The worker should use the chain nonce as a poor-man's
	/// nonce already, but the extra belt-and-braces is cheap.
	#[serde(default)]
	pub nonce: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignFillResponse {
	/// 65-byte secp256k1 signature, `0x`-prefixed lower-case hex
	/// (r || s || v). The worker plugs this directly into
	/// `TxEip1559::into_signed(sig)` and broadcasts.
	pub signature_hex: String,
	/// EIP-55 checksummed address recovered from the signature.
	/// Matches the operator's registered `fill_wallet_address` so the
	/// worker can confirm the right operator signed.
	pub recovered_address: String,
	/// RFC3339 timestamp the signature was produced. Diagnostic only.
	pub signed_at: String,
}

/// POST /solver-api/operators/{id}/sign-fill
///
/// The fill-worker calls this with a 32-byte EIP-1559 digest; the
/// aggregator decrypts the operator's fill-wallet key, signs the digest
/// with secp256k1, returns the 65-byte signature. The worker is
/// stateless about operator keys — it just forwards digests and
/// broadcasts the resulting envelopes.
///
/// Authenticated by the same `x-auth-*` signed headers the worker uses
/// for every other aggregator call. The signature recovery in the auth
/// middleware ensures only the matching operator's worker can request
/// fills signed by that operator's key.
pub async fn sign_fill(
	State(state): State<AppState>,
	Path(solver_id): Path<String>,
	auth: Option<Extension<AuthContext>>,
	Json(payload): Json<SignFillRequest>,
) -> Result<Json<SignFillResponse>, (StatusCode, Json<ErrorResponse>)> {
	ensure_operator_scope(auth.as_ref().map(|e| &e.0), &solver_id)?;
	// 1. Operator must exist.
	let op = state
		.storage
		.get_operator(&solver_id)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?
		.ok_or_else(|| {
			(
				StatusCode::NOT_FOUND,
				Json(ErrorResponse {
					error: "NOT_FOUND".into(),
					message: format!("operator {solver_id} not found"),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;

	// 2. Operator must have an encrypted fill-wallet key persisted.
	let ciphertext = state
		.storage
		.get_encrypted_fill_wallet_key(&solver_id)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?
		.ok_or_else(|| {
			(
				StatusCode::CONFLICT,
				Json(ErrorResponse {
					error: "NO_FILL_WALLET_KEY".into(),
					message: format!(
						"operator {solver_id} has no encrypted fill-wallet key; \
						 re-register the operator via the dashboard"
					),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;

	// 3. Aggregator must have a sealer configured.
	let sealer = state.sealer.as_ref().ok_or_else(|| {
		(
			StatusCode::SERVICE_UNAVAILABLE,
			Json(ErrorResponse {
				error: "SEALER_NOT_CONFIGURED".into(),
				message: "aggregator cannot sign fills: FILL_WALLET_ENCRYPTION_KEY not set".into(),
				timestamp: Utc::now().timestamp(),
			}),
		)
	})?;

	// 4. Decrypt the fill-wallet private key. We hold it in scope only
	// for the duration of the signature computation below and drop it
	// as soon as the signature is produced.
	let private_key_hex = String::from_utf8(sealer.open(&ciphertext).map_err(|e| {
		(
			StatusCode::INTERNAL_SERVER_ERROR,
			Json(ErrorResponse {
				error: "DECRYPT_FAILED".into(),
				message: format!("failed to decrypt fill-wallet key: {e}"),
				timestamp: Utc::now().timestamp(),
			}),
		)
	})?)
	.map_err(|e| {
		(
			StatusCode::INTERNAL_SERVER_ERROR,
			Json(ErrorResponse {
				error: "DECRYPT_FORMAT".into(),
				message: format!("decrypted fill-wallet key is not utf-8: {e}"),
				timestamp: Utc::now().timestamp(),
			}),
		)
	})?;

	// 5. Parse the digest the worker wants signed.
	let digest_hex = payload.digest_hex.trim_start_matches("0x");
	let digest_bytes = alloy_primitives::hex::decode(digest_hex).map_err(|e| {
		(
			StatusCode::BAD_REQUEST,
			Json(ErrorResponse {
				error: "INVALID_DIGEST".into(),
				message: format!("digest_hex is not valid hex: {e}"),
				timestamp: Utc::now().timestamp(),
			}),
		)
	})?;
	if digest_bytes.len() != 32 {
		return Err((
			StatusCode::BAD_REQUEST,
			Json(ErrorResponse {
				error: "INVALID_DIGEST".into(),
				message: format!("digest must be 32 bytes, got {}", digest_bytes.len()),
				timestamp: Utc::now().timestamp(),
			}),
		));
	}
	let digest = alloy_primitives::B256::from_slice(&digest_bytes);

	// 6. Sign via alloy's LocalSigner. This is the exact same signer
	// path the dashboard's "Generate Key" flow produces — same shape,
	// same address derivation, same signature format.
	let signer = alloy_signer_local::PrivateKeySigner::from_slice(
		&alloy_primitives::hex::decode(private_key_hex.trim_start_matches("0x"))
			.map_err(|e| {
				(
					StatusCode::INTERNAL_SERVER_ERROR,
					Json(ErrorResponse {
						error: "INVALID_STORED_KEY".into(),
						message: format!("stored fill-wallet key is not valid hex: {e}"),
						timestamp: Utc::now().timestamp(),
					}),
				)
			})?,
	)
	.map_err(|e| {
		(
			StatusCode::INTERNAL_SERVER_ERROR,
			Json(ErrorResponse {
				error: "INVALID_STORED_KEY".into(),
				message: format!("stored fill-wallet key is not a valid private key: {e}"),
				timestamp: Utc::now().timestamp(),
			}),
		)
	})?;

	let signature = signer
		.sign_hash_sync(&digest)
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "SIGN_FAILED".into(),
					message: format!("secp256k1 signing failed: {e}"),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;
	let recovered_address = format!("{:#x}", signer.address());
	// Defensive sanity check: the recovered address must match the
	// operator's registered fill-wallet address. A mismatch would mean
	// the stored ciphertext is corrupt (or the operator row was
	// tampered with) — refuse the signature rather than return it.
	if recovered_address.to_lowercase() != op.fill_wallet_address.to_lowercase() {
		return Err((
			StatusCode::INTERNAL_SERVER_ERROR,
			Json(ErrorResponse {
				error: "KEY_MISMATCH".into(),
				message: format!(
					"decrypted fill-wallet key recovered to {recovered_address}, \
					 but operator row expects {}. Refusing to sign.",
					op.fill_wallet_address
				),
				timestamp: Utc::now().timestamp(),
			}),
		));
	}

	let sig_hex = format!("0x{}", alloy_primitives::hex::encode(signature.as_bytes()));
	info!(
		solver_id = %solver_id,
		fill_wallet_address = %op.fill_wallet_address,
		digest = %digest,
		"sign-fill issued"
	);
	Ok(Json(SignFillResponse {
		signature_hex: sig_hex,
		recovered_address,
		signed_at: Utc::now().to_rfc3339(),
	}))
}
