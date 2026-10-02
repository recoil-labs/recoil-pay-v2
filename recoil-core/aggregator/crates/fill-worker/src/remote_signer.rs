//! Remote fill signer — delegates secp256k1 signing to the aggregator.
//!
//! ## Why this exists
//!
//! In the multi-tenant model the fill-worker holds **no operator keys**.
//! Each operator's fill-wallet private key lives encrypted in the
//! aggregator's Postgres, only decrypted server-side during fill signing.
//! The worker therefore cannot produce a fill signature locally; instead
//! it forwards a 32-byte EIP-1559 digest to the aggregator over a signed
//! HTTP call and gets back the 65-byte signature.
//!
//! ## Wire format
//!
//! `POST /solver-api/operators/{solver_id}/sign-fill`
//! Body: `{ "digestHex": "0x…" }` — the digest to sign.
//! Response: `{ "signatureHex": "0x…", "recoveredAddress": "0x…", "signedAt": "…" }`
//!
//! The aggregator decrypts the matching operator's encrypted fill-wallet
//! key using its `FILL_WALLET_ENCRYPTION_KEY` env var, signs the digest,
//! returns the signature. The worker's role is just to ship the digest
//! and broadcast the resulting envelope.
//!
//! ## Identity
//!
//! The `address()` method returns the operator's fill-wallet address
//! (cached at construction). This is what the worker's
//! `sign_and_broadcast_fill` uses for nonce lookup on the destination
//! chain RPC. The signer does **not** sign anything itself; the only
//! crypto it does is hashing the digest for the HTTP request body, and
//! that's done by `alloy`'s helpers — no secp256k1 here.

use std::sync::Arc;

use alloy_primitives::{hex, Address, B256, Signature};
use alloy_signer::Result as SignerResult;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

use crate::{
	signer::OrderSigner,
	Broadcaster, FillWorkerError, FillWorkerResult,
};

/// Response body from the aggregator's `/sign-fill` endpoint.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignFillResponse {
	signature_hex: String,
	recovered_address: String,
	#[serde(default)]
	signed_at: Option<String>,
}

/// Request body posted to the aggregator's `/sign-fill` endpoint.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SignFillRequest<'a> {
	digest_hex: &'a str,
}

/// Remote signer that POSTs each `sign_digest` call to the aggregator's
/// `/sign-fill` endpoint. The aggregator holds the operator's encrypted
/// fill-wallet key and signs on the worker's behalf.
pub struct RemoteFillSigner {
	/// Operator whose fill-wallet we want to sign with. Derived from the
	/// incoming order's `solver_id`.
	solver_id: String,
	/// The operator's known fill-wallet address, surfaced via `address()`.
	/// Cached at construction so the worker can look up the on-chain
	/// nonce for this address without an extra round-trip.
	fill_wallet_address: Address,
	/// Aggregator broadcaster used to make the signed HTTP call. We use
	/// the broadcaster's request-signing helpers (`apply_signed_headers`)
	/// so the request carries the worker's `x-auth-*` headers — the
	/// aggregator's `/sign-fill` handler requires the request to recover
	/// to the operator's registered `solver_id` (same as the path
	/// parameter).
	broadcaster: Arc<dyn Broadcaster>,
	/// HTTP client for the POST request. Cheap to construct; held so we
	/// can amortize connection setup across many fills.
	http: reqwest::Client,
}

impl RemoteFillSigner {
	/// Construct a remote signer for a specific operator's fill-wallet.
	///
	/// `broadcaster` must already have its operator_id bound (via
	/// `set_operator_id`) to a valid worker identity — the same identity
	/// will be used to authenticate the `/sign-fill` call.
	pub fn new(
		solver_id: String,
		fill_wallet_address: Address,
		broadcaster: Arc<dyn Broadcaster>,
	) -> Self {
		Self {
			solver_id,
			fill_wallet_address,
			broadcaster,
			http: reqwest::Client::builder()
				.timeout(std::time::Duration::from_secs(10))
				.build()
				.expect("reqwest client"),
		}
	}

	/// POST the digest to the aggregator's `/sign-fill` endpoint and
	/// return the resulting secp256k1 signature. The aggregator signs
	/// using the operator's encrypted fill-wallet key — the worker never
	/// sees the private key.
	async fn request_signature(&self, digest: &B256) -> FillWorkerResult<Signature> {
		let path = format!(
			"/solver-api/operators/{}/sign-fill",
			self.solver_id
		);
		let url = format!(
			"{}{}",
			self.broadcaster.aggregator_base_url(),
			path
		);

		let body = SignFillRequest {
			digest_hex: &format!("0x{}", hex::encode(digest.as_slice())),
		};

		// Sign the request using the worker's bound worker identity —
		// same scheme as `set_worker_url` / `heartbeat` / `report_outcome`.
		let builder = self.http.post(&url).json(&body);
		let builder = self
			.broadcaster
			.sign_request("POST", &path, builder)
			.await
			.map_err(|e| FillWorkerError::Http(format!("sign /sign-fill request: {e}")))?;

		let res = builder
			.send()
			.await
			.map_err(|e| FillWorkerError::Http(format!("/sign-fill request: {e}")))?;
		if !res.status().is_success() {
			let status = res.status();
			let body = res.text().await.unwrap_or_default();
			warn!(
				solver_id = %self.solver_id,
				status = %status,
				body = %body,
				"/sign-fill returned non-2xx"
			);
			return Err(FillWorkerError::Http(format!(
				"/sign-fill returned {status}: {body}"
			)));
		}

		let parsed: SignFillResponse = res
			.json()
			.await
			.map_err(|e| FillWorkerError::Http(format!("decode /sign-fill response: {e}")))?;

		let sig_hex = parsed
			.signature_hex
			.trim_start_matches("0x");
		let sig_bytes = hex::decode(sig_hex).map_err(|e| {
			FillWorkerError::Http(format!("decode signature hex: {e}"))
		})?;
		let signature = Signature::from_raw(&sig_bytes).map_err(|e| {
			FillWorkerError::Http(format!("parse signature: {e}"))
		})?;

		// Defensive: the aggregator's `sign_fill` handler already checks
		// that the recovered address matches the operator's registered
		// fill-wallet. We re-check on the worker side as a belt-and-braces
		// against a misbehaving aggregator that signs with the wrong key.
		let recovered_hex = parsed.recovered_address.trim_start_matches("0x").to_lowercase();
		let expected_hex = format!("{:x}", self.fill_wallet_address);
		if recovered_hex != expected_hex {
			return Err(FillWorkerError::Http(format!(
				"aggregator sign-fill recovered to {recovered_hex}, expected {expected_hex} — refusing to broadcast"
			)));
		}

		debug!(
			solver_id = %self.solver_id,
			signed_at = ?parsed.signed_at,
			"remote fill signature received from aggregator"
		);
		Ok(signature)
	}
}

#[async_trait]
impl OrderSigner for RemoteFillSigner {
	async fn sign_digest(&self, digest: &B256) -> SignerResult<Signature> {
		self.request_signature(digest)
			.await
			.map_err(|e| alloy_signer::Error::other(e))
	}

	fn address(&self) -> Address {
		self.fill_wallet_address
	}
}
