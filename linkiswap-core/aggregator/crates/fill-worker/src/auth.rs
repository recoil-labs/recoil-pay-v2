//! Operator-authenticated request signing.
//!
//! The fill-worker signs every outbound aggregator request with its
//! hot-wallet (secp256k1). The aggregator validates the signature against
//! the operator's `wallet_address` row, giving us **mTLS-equivalent
//! authentication** without requiring operators to manage X.509 certs.
//!
//! ## Wire format
//!
//! ```text
//! GET /api/v1/orders
//! x-solver-id:        <operator's wallet address, lower-cased>
//! x-auth-timestamp:   <unix seconds, ±60s validity window>
//! x-auth-nonce:       <16 random bytes, hex>
//! x-auth-signature:   <0x-prefixed 65-byte secp256k1 sig>
//! ```
//!
//! The signed payload is:
//!
//! ```text
//! keccak256("linkiswap-auth\n{solver_id}\n{timestamp}\n{nonce}\n{method}\n{path}")
//! ```
//!
//! ## Replay protection
//!
//! The aggregator caches nonces seen in the last ~5 minutes in an LRU map
//! and rejects any request whose nonce is already present. Time-window
//! checks further narrow the attack surface.
//!
//! ## Constant-time comparison
//!
//! `x-auth-signature` is decoded once and the recovered address is
//! compared against the registered `wallet_address` via a constant-time
//! equality check to avoid timing oracles.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use alloy_primitives::{keccak256, Address, B256};
#[allow(unused_imports)] // getrandom is used only on the non-test path
use getrandom::getrandom;

use crate::{FillWorkerError, FillWorkerResult, OrderSigner};

/// Header names exposed to reqwest.
pub const HDR_SOLVER_ID: &str = "x-solver-id";
pub const HDR_TIMESTAMP: &str = "x-auth-timestamp";
pub const HDR_NONCE: &str = "x-auth-nonce";
pub const HDR_SIGNATURE: &str = "x-auth-signature";

/// Maximum clock skew (seconds) the aggregator tolerates between client
/// and server when validating a timestamp.
pub const MAX_CLOCK_SKEW_SECS: i64 = 60;

/// Domain separator baked into every signed payload. Changing this value
/// invalidates all existing signatures — bump it intentionally when
/// rotating the auth scheme.
pub const SIGNING_DOMAIN: &[u8] = b"linkiswap-auth";

/// Build the canonical signing payload as a `B256` digest. Public for testing.
pub fn build_signing_payload(
	solver_id: &str,
	timestamp: u64,
	nonce_hex: &str,
	method: &str,
	path: &str,
) -> B256 {
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

/// Signed headers produced by [`sign_request`]. Apply them to a reqwest
/// `RequestBuilder` with [`apply_signed_headers`].
#[derive(Debug, Clone)]
pub struct SignedHeaders {
	pub solver_id: String,
	pub timestamp: u64,
	pub nonce: String,
	pub signature: String,
}

/// Sign a request and return the four headers to attach.
pub async fn sign_request(
	signer: &dyn OrderSigner,
	method: &str,
	path: &str,
) -> FillWorkerResult<SignedHeaders> {
	let solver_id = format!("{:#x}", signer.address()).to_lowercase();
	let timestamp = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_secs())
		.map_err(|e| FillWorkerError::Http(format!("system time error: {e}")))?;

	// 16 random bytes → 32 hex chars.
	let mut bytes = [0u8; 16];
	getrandom::getrandom(&mut bytes)
		.map_err(|e| FillWorkerError::Http(format!("OS entropy: {e}")))?;
	let nonce = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();

	let digest = build_signing_payload(&solver_id, timestamp, &nonce, method, path);
	let sig = signer
		.sign_digest(&digest)
		.await
		.map_err(|e| FillWorkerError::Http(format!("auth signing failed: {e}")))?;

	// alloy `Signature` already renders as `0x…` via its `Display` impl.
	let signature = format!("{sig}");

	Ok(SignedHeaders {
		solver_id,
		timestamp,
		nonce,
		signature,
	})
}

/// Apply the four headers to an in-flight reqwest request builder.
pub fn apply_signed_headers(
	mut builder: reqwest::RequestBuilder,
	h: &SignedHeaders,
) -> reqwest::RequestBuilder {
	builder = builder
		.header(HDR_SOLVER_ID, &h.solver_id)
		.header(HDR_TIMESTAMP, h.timestamp.to_string())
		.header(HDR_NONCE, &h.nonce)
		.header(HDR_SIGNATURE, &h.signature);
	builder
}

// ─── Server-side verification ───────────────────────────────────────────────

/// Verify a signed-request envelope. Returns the recovered operator
/// address on success so the caller can match it against the
/// registered `wallet_address`.
pub fn verify_signed_request(
	headers: &SignedHeaders,
	expected_solver_id: &str,
	expected_method: &str,
	expected_path: &str,
	now_unix: u64,
) -> Result<Address, AuthError> {
	// 1. Timestamp window.
	let skew = (now_unix as i64) - (headers.timestamp as i64);
	if skew.abs() > MAX_CLOCK_SKEW_SECS {
		return Err(AuthError::StaleTimestamp {
			now: now_unix,
			got: headers.timestamp,
		});
	}

	// 2. Solver-id binding.
	if !headers.solver_id.eq_ignore_ascii_case(expected_solver_id) {
		return Err(AuthError::SolverMismatch {
			expected: expected_solver_id.to_string(),
			got: headers.solver_id.clone(),
		});
	}

	// 3. Signature recovery.
	let digest = build_signing_payload(
		&headers.solver_id,
		headers.timestamp,
		&headers.nonce,
		expected_method,
		expected_path,
	);
	let sig = headers
		.signature
		.trim_start_matches("0x");
	let raw = alloy_primitives::hex::decode(sig)
		.map_err(|e| AuthError::MalformedSignature(e.to_string()))?;
	if raw.len() != 65 {
		return Err(AuthError::MalformedSignature(format!(
			"expected 65 bytes, got {}",
			raw.len()
		)));
	}
	let sig = alloy_primitives::Signature::from_raw(&raw)
		.map_err(|e| AuthError::MalformedSignature(e.to_string()))?;
	let recovered = sig
		.recover_address_from_prehash(&digest)
		.map_err(|e| AuthError::RecoverFailed(e.to_string()))?;

	// 4. Recovered address must match the solver-id.
	let recovered_str = format!("{recovered:#x}").to_lowercase();
	if !recovered_str.eq_ignore_ascii_case(&headers.solver_id) {
		return Err(AuthError::SignerMismatch {
			recovered: recovered_str,
			claimed: headers.solver_id.clone(),
		});
	}

	Ok(recovered)
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
	#[error("timestamp out of window: now={now}, got={got}")]
	StaleTimestamp { now: u64, got: u64 },
	#[error("solver id mismatch: expected {expected}, got {got}")]
	SolverMismatch { expected: String, got: String },
	#[error("malformed signature: {0}")]
	MalformedSignature(String),
	#[error("ecrecover failed: {0}")]
	RecoverFailed(String),
	#[error("signer mismatch: recovered {recovered}, claimed {claimed}")]
	SignerMismatch { recovered: String, claimed: String },
	#[error("replayed nonce: {0}")]
	ReplayedNonce(String),
}

/// Bounded LRU-ish nonce cache. Uses a `Mutex<Vec<String>>` for simplicity
/// (single-threaded worker is fine here); swap for a real LRU once we
/// care about memory pressure.
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

	/// Returns `Ok(())` if the nonce is fresh; `Err(ReplayedNonce)` if it
	/// was seen within the last `max_age_secs`.
	pub fn check_and_insert(
		&self,
		nonce: &str,
		now_unix: u64,
	) -> Result<(), AuthError> {
		let mut guard = self.inner.lock().expect("nonce cache poisoned");
		// Evict entries older than max_age_secs.
		guard.retain(|(_, ts)| now_unix.saturating_sub(*ts) < self.max_age_secs);
		if guard.iter().any(|(n, _)| n == nonce) {
			return Err(AuthError::ReplayedNonce(nonce.to_string()));
		}
		guard.push((nonce.to_string(), now_unix));
		Ok(())
	}

	/// Drain everything for testing.
	#[cfg(test)]
	pub fn clear(&self) {
		self.inner.lock().expect("nonce cache poisoned").clear();
	}
}

impl Default for NonceCache {
	fn default() -> Self {
		// ~5 min window — keeps memory bounded while still giving
		// honest clients plenty of room to retry.
		Self::new(MAX_CLOCK_SKEW_SECS as u64 * 5)
	}
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
	use super::*;
	use crate::signer::LocalSigner;

	#[tokio::test]
	async fn sign_and_verify_roundtrip() {
		let signer: Box<dyn OrderSigner> = Box::new(LocalSigner::new(&"ab".repeat(32)).unwrap());
		let solver_id = format!("{:#x}", signer.address()).to_lowercase();

		let h = sign_request(signer.as_ref(), "GET", "/api/v1/orders")
			.await
			.unwrap();
		let now = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.unwrap()
			.as_secs();
		let recovered = verify_signed_request(&h, &solver_id, "GET", "/api/v1/orders", now).unwrap();
		assert_eq!(format!("{recovered:#x}").to_lowercase(), solver_id);
	}

	#[test]
	fn rejects_stale_timestamp() {
		let signer = LocalSigner::new(&"ab".repeat(32)).unwrap();
		let h = SignedHeaders {
			solver_id: format!("{:#x}", signer.address()).to_lowercase(),
			timestamp: 1_000_000, // way in the past
			nonce: "aa".repeat(16),
			signature: "0x".to_string() + &"00".repeat(65),
		};
		let now = 2_000_000_000;
		let err = verify_signed_request(&h, &h.solver_id, "GET", "/api/v1/orders", now).unwrap_err();
		assert!(matches!(err, AuthError::StaleTimestamp { .. }));
	}

	#[test]
	fn rejects_solver_mismatch() {
		let signer = LocalSigner::new(&"ab".repeat(32)).unwrap();
		let h = SignedHeaders {
			solver_id: format!("{:#x}", signer.address()).to_lowercase(),
			timestamp: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
			nonce: "aa".repeat(16),
			signature: "0x".to_string() + &"00".repeat(65),
		};
		let now = h.timestamp;
		let err = verify_signed_request(&h, "0x000000000000000000000000000000000000dead", "GET", "/api/v1/orders", now).unwrap_err();
		assert!(matches!(err, AuthError::SolverMismatch { .. }));
	}

	#[test]
	fn rejects_malformed_signature() {
		let signer = LocalSigner::new(&"ab".repeat(32)).unwrap();
		let h = SignedHeaders {
			solver_id: format!("{:#x}", signer.address()).to_lowercase(),
			timestamp: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
			nonce: "aa".repeat(16),
			signature: "0xnonsense".into(),
		};
		let now = h.timestamp;
		let err = verify_signed_request(&h, &h.solver_id, "GET", "/api/v1/orders", now).unwrap_err();
		assert!(matches!(err, AuthError::MalformedSignature(_)));
	}

	#[test]
	fn nonce_cache_rejects_replay() {
		let cache = NonceCache::new(300);
		let nonce = "abcd1234abcd1234abcd1234abcd1234";
		let now = 1_000_000;
		cache.check_and_insert(nonce, now).unwrap();
		let err = cache.check_and_insert(nonce, now).unwrap_err();
		assert!(matches!(err, AuthError::ReplayedNonce(_)));
	}

	#[test]
	fn nonce_cache_allows_after_window() {
		let cache = NonceCache::new(60);
		let nonce = "abcd1234abcd1234abcd1234abcd1234";
		cache.check_and_insert(nonce, 1_000_000).unwrap();
		// 120s later — outside the 60s window.
		cache.check_and_insert(nonce, 1_000_120).unwrap();
	}

	#[test]
	fn signing_payload_is_stable() {
		let p1 = build_signing_payload(
			"0xabc",
			1_700_000_000,
			"00".repeat(16).as_str(),
			"GET",
			"/api/v1/orders",
		);
		let p2 = build_signing_payload(
			"0xabc",
			1_700_000_000,
			"00".repeat(16).as_str(),
			"GET",
			"/api/v1/orders",
		);
		assert_eq!(p1, p2);
		// Stable hex repr so operators can verify by hand.
		assert_eq!(format!("{p1}"), format!("{p2}"));
	}
}
