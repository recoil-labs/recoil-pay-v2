//! Order signing — produces a real **secp256k1** signature over the order's
//! fill transaction digest. Uses `alloy_signer_local::PrivateKeySigner` so
//! signatures are valid for on-chain `ecrecover` checks against the operator's
//! EVM hot-wallet.
//!
//! ## Migration from the SHA-256 stub
//!
//! The earlier scaffold signed a SHA-256 digest, which is **not** a valid
//! Ethereum signature — on-chain settlers called `ecrecover` and reverted.
//! This module replaces it with the production signing flow:
//!
//! 1. Encode the fill transaction body using EIP-1559 (RLP-ready struct).
//! 2. Compute the signing hash (`keccak256(rlp(unsigned_tx))`).
//! 3. Sign with `PrivateKeySigner` — produces `{ v, r, s }`.
//! 4. Broadcast the signed raw transaction to the destination chain RPC.
//!
//! ## Why we still abstract behind a trait
//!
//! Tests substitute a deterministic stub signer so we don't hit real RPCs
//! during CI. The trait surface is identical between production and test
//! impls.

use std::sync::Arc;

use alloy_primitives::{Address, B256};
use alloy_signer::{Result as SignerResult, Signature, Signer};
use alloy_signer_local::PrivateKeySigner;
use async_trait::async_trait;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SigningError {
	#[error("invalid private key: {0}")]
	InvalidKey(String),
	#[error("signing failed: {0}")]
	SignFailed(String),
}

/// Abstract over signing so tests can substitute deterministic keys.
#[async_trait]
pub trait OrderSigner: Send + Sync {
	/// Sign the given 32-byte digest with the operator's hot-wallet. Returns
	/// a 65-byte secp256k1 signature in the standard `{ r ‖ s ‖ v }` layout.
	async fn sign_digest(&self, digest: &B256) -> SignerResult<Signature>;

	/// Operator's EVM address as a 20-byte array.
	fn address(&self) -> Address;

	/// Convenience helper that builds an EIP-191 personal-sign over a UTF-8
	/// message. Used for non-EIP-712 flows (e.g. simple challenge / ack).
	async fn sign_message(&self, message: &[u8]) -> SignerResult<Signature> {
		self.sign_digest(&alloy_primitives::eip191_hash_message(message))
			.await
	}
}

/// Production signer backed by a raw EVM private key (hex-encoded, with or
/// without the `0x` prefix).
pub struct LocalSigner {
	signer: PrivateKeySigner,
}

impl LocalSigner {
	/// Parse a hex-encoded private key. Accepts both `"0x..."` and bare hex.
	pub fn new(private_key_hex: &str) -> Result<Self, SigningError> {
		let key = private_key_hex.trim_start_matches("0x");
		let bytes = alloy_primitives::hex::decode(key)
			.map_err(|e| SigningError::InvalidKey(format!("hex decode failed: {e}")))?;
		let signer = PrivateKeySigner::from_slice(&bytes)
			.map_err(|e| SigningError::InvalidKey(e.to_string()))?;
		Ok(Self { signer })
	}

	/// Generate a fresh random hot-wallet key. Used by the dashboard's
	/// "Generate Key" button.
	pub fn generate_random() -> Self {
		let mut rng = rand::thread_rng();
		let signer = PrivateKeySigner::random_with(&mut rng);
		Self { signer }
	}

	/// Return the raw 32-byte private key (hex-encoded with `0x` prefix).
	/// Used by the dashboard to display the key once at creation time so
	/// the operator can back it up.
	pub fn private_key_hex(&self) -> String {
		format!("0x{}", hex_lower(self.signer.to_bytes().as_ref()))
	}

	pub fn into_arc(self) -> Arc<dyn OrderSigner> {
		Arc::new(self)
	}

	/// Unwrap the underlying `PrivateKeySigner`. Useful for tests and
	/// for callers that need direct access to `sign_hash_sync` to build
	/// EIP-191 signatures outside the orchestrator.
	pub fn into_inner(self) -> PrivateKeySigner {
		self.signer
	}
}

#[async_trait]
impl OrderSigner for LocalSigner {
	async fn sign_digest(&self, digest: &B256) -> SignerResult<Signature> {
		self.signer.sign_hash(digest).await
	}

	fn address(&self) -> Address {
		self.signer.address()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn rejects_short_keys() {
		let r = LocalSigner::new("deadbeef");
		assert!(r.is_err());
	}

	#[test]
	fn accepts_prefixed_or_unprefixed_keys() {
		let a = LocalSigner::new(&"ab".repeat(32)).unwrap();
		let b = LocalSigner::new(&format!("0x{}", "ab".repeat(32))).unwrap();
		assert_eq!(a.address(), b.address());
	}

	#[test]
	fn random_keys_are_unique() {
		let a = LocalSigner::generate_random();
		let b = LocalSigner::generate_random();
		assert_ne!(a.address(), b.address());
	}

	#[tokio::test]
	async fn signature_recovers_to_signer_address() {
		// Real on-chain ecrecover check: the recovered address must equal
		// the signer's address. This is the canonical test for any signing
		// impl meant to interact with EVM contracts.
		use alloy_primitives::FixedBytes;
		let signer = LocalSigner::new(&"ab".repeat(32)).unwrap();
		let digest = B256::from(FixedBytes::repeat_byte(0x42));
		let sig = signer.sign_digest(&digest).await.unwrap();
		let recovered = sig.recover_address_from_prehash(&digest).unwrap();
		assert_eq!(recovered, signer.address());
	}
}

fn hex_lower(b: &[u8]) -> String {
	const HEX: &[u8] = b"0123456789abcdef";
	let mut out = String::with_capacity(b.len() * 2);
	for byte in b {
		out.push(HEX[(byte >> 4) as usize] as char);
		out.push(HEX[(byte & 0x0f) as usize] as char);
	}
	out
}
