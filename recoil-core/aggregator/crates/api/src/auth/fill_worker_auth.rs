//! Fill-worker → aggregator signed-request auth.
//!
//! Mirrors [`fill_worker::auth`] on the server side: every request
//! from a fill-worker carries four headers
//!
//! - `x-solver-id`        — operator's wallet address (lower-case hex)
//! - `x-auth-timestamp`   — unix seconds, ±60s validity window
//! - `x-auth-nonce`       — 16 random bytes (hex)
//! - `x-auth-signature`   — 65-byte secp256k1 signature over
//!                          `keccak256("recoilpay-auth\n{solver_id}\n{timestamp}\n{nonce}\n{method}\n{path}")`
//!
//! The middleware:
//! 1. Pulls the four headers off the request.
//! 2. Verifies the signature recovers to `x-solver-id`.
//! 3. Confirms the timestamp is within the clock-skew window.
//! 4. Confirms the nonce hasn't been seen in the last 5 minutes
//!    (replay protection).
//!
//! On success the request passes through with `solver_id` injected
//! into the request extensions so handlers can pick it up via an
//! extractor. On failure the middleware returns `401 Unauthorized`
//! with a JSON body describing the failure.

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
	body::Body,
	extract::{Request, State},
	http::{HeaderMap, StatusCode},
	middleware::Next,
	response::{IntoResponse, Response},
};
use serde_json::json;
use tracing::warn;

use crate::state::AppState;

pub const HDR_SOLVER_ID: &str = "x-solver-id";
pub const HDR_TIMESTAMP: &str = "x-auth-timestamp";
pub const HDR_NONCE: &str = "x-auth-nonce";
pub const HDR_SIGNATURE: &str = "x-auth-signature";

pub const MAX_CLOCK_SKEW_SECS: i64 = 60;
pub const NONCE_WINDOW_SECS: u64 = 300;

const SIGNING_DOMAIN: &[u8] = b"recoilpay-auth";

/// Result returned to handlers that want to know who the caller is.
#[derive(Debug, Clone)]
pub struct AuthenticatedSolver {
	pub solver_id: String,
}

/// Build the canonical signing payload as a `B256` digest.
///
/// MUST stay byte-identical to `fill_worker::auth::build_signing_payload`.
/// Exposed as `pub` so the WebSocket upgrade handler in
/// `handlers::solver_api::ws_orders` can construct the same digest
/// during the handshake.
pub fn build_signing_payload(
	solver_id: &str,
	timestamp: u64,
	nonce_hex: &str,
	method: &str,
	path: &str,
) -> alloy_primitives::B256 {
	use alloy_primitives::keccak256;
	let mut buf = Vec::with_capacity(
		SIGNING_DOMAIN.len()
			+ solver_id.len()
			+ 20 // timestamp digits
			+ nonce_hex.len()
			+ method.len()
			+ path.len()
			+ 8, // separators
	);
	buf.extend_from_slice(SIGNING_DOMAIN);
	buf.push(b'\n');
	buf.extend_from_slice(solver_id.as_bytes());
	buf.push(b'\n');
	buf.extend_from_slice(timestamp.to_string().as_bytes());
	buf.push(b'\n');
	buf.extend_from_slice(nonce_hex.as_bytes());
	buf.push(b'\n');
	buf.extend_from_slice(method.to_ascii_uppercase().as_bytes());
	buf.push(b'\n');
	buf.extend_from_slice(path.as_bytes());
	keccak256(&buf)
}

/// Errors that produce 401 responses.
#[derive(Debug, thiserror::Error)]
pub enum FillWorkerAuthError {
	#[error("missing {0}")]
	MissingHeader(&'static str),
	#[error("malformed {0}: {1}")]
	Malformed(&'static str, String),
	#[error("timestamp out of window")]
	StaleTimestamp,
	#[error("replayed nonce")]
	ReplayedNonce,
	#[error("signature does not recover to solver_id")]
	SignerMismatch,
}

/// Bounded nonce cache with TTL eviction.
#[derive(Debug)]
pub struct NonceCache {
	inner: Mutex<Vec<(String, u64)>>,
	max_age_secs: u64,
}

impl NonceCache {
	pub fn new(max_age_secs: u64) -> Self {
		Self {
			inner: Mutex::new(Vec::new()),
			max_age_secs,
		}
	}

	pub fn check_and_insert(&self, nonce: &str, now_unix: u64) -> Result<(), FillWorkerAuthError> {
		let mut guard = self.inner.lock().expect("nonce cache poisoned");
		guard.retain(|(_, ts)| now_unix.saturating_sub(*ts) < self.max_age_secs);
		if guard.iter().any(|(n, _)| n == nonce) {
			return Err(FillWorkerAuthError::ReplayedNonce);
		}
		guard.push((nonce.to_string(), now_unix));
		Ok(())
	}

	#[cfg(test)]
	pub fn clear(&self) {
		self.inner.lock().expect("nonce cache poisoned").clear();
	}
}

impl Default for NonceCache {
	fn default() -> Self {
		Self::new(NONCE_WINDOW_SECS)
	}
}

/// Axum middleware. Pulls + verifies the four signed headers, then
/// forwards to the next handler with the authenticated `solver_id`
/// stored in the request extensions.
pub async fn fill_worker_auth_middleware(
	State(state): State<AppState>,
	request: Request<Body>,
	next: Next,
) -> Response {
	let method = request.method().to_string();
	let path = request.uri().path().to_string();
	let headers = request.headers().clone();

	let solver_id = match headers.get(HDR_SOLVER_ID).and_then(|v| v.to_str().ok()) {
		Some(v) => v.to_lowercase(),
		None => return reject(&FillWorkerAuthError::MissingHeader(HDR_SOLVER_ID)),
	};
	let timestamp_str = match headers.get(HDR_TIMESTAMP).and_then(|v| v.to_str().ok()) {
		Some(v) => v,
		None => return reject(&FillWorkerAuthError::MissingHeader(HDR_TIMESTAMP)),
	};
	let timestamp: u64 = match timestamp_str.parse() {
		Ok(t) => t,
		Err(_) => return reject(&FillWorkerAuthError::Malformed(HDR_TIMESTAMP, "not a u64".into())),
	};
	let nonce = match headers.get(HDR_NONCE).and_then(|v| v.to_str().ok()) {
		Some(v) => v.to_string(),
		None => return reject(&FillWorkerAuthError::MissingHeader(HDR_NONCE)),
	};
	let signature_hex = match headers.get(HDR_SIGNATURE).and_then(|v| v.to_str().ok()) {
		Some(v) => v.to_string(),
		None => return reject(&FillWorkerAuthError::MissingHeader(HDR_SIGNATURE)),
	};

	// 1. timestamp window
	let now = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_secs())
		.unwrap_or(0);
	let skew = (now as i64) - (timestamp as i64);
	if skew.abs() > MAX_CLOCK_SKEW_SECS {
		return reject(&FillWorkerAuthError::StaleTimestamp);
	}

	// 2. signature recovery
	let digest = build_signing_payload(&solver_id, timestamp, &nonce, &method, &path);
	let sig_bytes = match alloy_primitives::hex::decode(signature_hex.trim_start_matches("0x")) {
		Ok(b) => b,
		Err(e) => return reject(&FillWorkerAuthError::Malformed(HDR_SIGNATURE, e.to_string())),
	};
	if sig_bytes.len() != 65 {
		return reject(&FillWorkerAuthError::Malformed(
			HDR_SIGNATURE,
			format!("expected 65 bytes, got {}", sig_bytes.len()),
		));
	}
	let sig = match alloy_primitives::Signature::from_raw(&sig_bytes) {
		Ok(s) => s,
		Err(e) => return reject(&FillWorkerAuthError::Malformed(HDR_SIGNATURE, e.to_string())),
	};
	let recovered = match sig.recover_address_from_prehash(&digest) {
		Ok(a) => a,
		Err(e) => return reject(&FillWorkerAuthError::Malformed(HDR_SIGNATURE, e.to_string())),
	};
	let recovered_str = format!("{recovered:#x}").to_lowercase();
	if recovered_str != solver_id {
		return reject(&FillWorkerAuthError::SignerMismatch);
	}

	// 3. nonce cache (replay protection)
	let cache = state.fill_worker_nonce_cache.clone();
	if let Err(e) = cache.check_and_insert(&nonce, now) {
		return reject(&e);
	}

	// 4. attach the authenticated solver to the request extensions so
	// downstream handlers can pick it up via an extractor.
	let mut request = request;
	request.extensions_mut().insert(AuthenticatedSolver {
		solver_id: solver_id.clone(),
	});

	// 5. forward
	let response = next.run(request).await;

	let _ = Arc::strong_count(&cache); // keep cache Arc referenced
	response
}

fn reject(err: &FillWorkerAuthError) -> Response {
	warn!(error = %err, "fill-worker auth rejected");
	let body = json!({
		"error": "FILL_WORKER_AUTH_FAILED",
		"message": err.to_string(),
		"timestamp": SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.map(|d| d.as_secs())
			.unwrap_or(0),
	})
	.to_string();
	(StatusCode::UNAUTHORIZED, [(axum::http::header::CONTENT_TYPE, "application/json")], body)
		.into_response()
}

/// Helper for handlers to read the authenticated solver off the request.
pub fn extract_solver_id_from_request(
	headers: &HeaderMap,
) -> Option<String> {
	headers
		.get(HDR_SOLVER_ID)
		.and_then(|v| v.to_str().ok())
		.map(|s| s.to_lowercase())
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn signing_payload_is_stable() {
		let a = build_signing_payload("0xabc", 1_700_000_000, &"00".repeat(16), "GET", "/x");
		let b = build_signing_payload("0xabc", 1_700_000_000, &"00".repeat(16), "GET", "/x");
		assert_eq!(a, b);
	}

	#[test]
	fn nonce_cache_rejects_replay() {
		let cache = NonceCache::new(60);
		cache.check_and_insert("n1", 100).unwrap();
		assert!(matches!(
			cache.check_and_insert("n1", 110),
			Err(FillWorkerAuthError::ReplayedNonce)
		));
	}

	#[test]
	fn nonce_cache_evicts_after_window() {
		let cache = NonceCache::new(60);
		cache.check_and_insert("n1", 100).unwrap();
		cache.check_and_insert("n1", 200).unwrap(); // 100s later → evicted
	}
}
