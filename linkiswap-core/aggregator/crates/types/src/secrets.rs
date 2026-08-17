//! Secret-management helpers for the aggregator.
//!
//! ## What lives here
//!
//! - [`Sealer`]: AES-256-GCM sealer used to encrypt operator fill-wallet
//!   private keys at rest in Postgres. The encryption key is loaded from
//!   the `FILL_WALLET_ENCRYPTION_KEY` env var (32 raw bytes or 32
//!   base64-encoded bytes — see [`Sealer::from_env`]).
//!
//! ## Threat model
//!
//! - The sealer defends against a **Postgres-only** compromise (leaked
//!   read-replica, backup snapshot, exfiltrated dump): the encrypted
//!   `fill_wallet_private_key_ciphertext` column is opaque without the
//!   master key.
//! - It does **not** defend against a process-level attacker who can
//!   also read the env var or dump process memory. This is the standard
//!   tradeoff of single-key symmetric encryption at the application
//!   layer.
//!
//! ## Key management
//!
//! The sealer's master key is sourced from the `FILL_WALLET_ENCRYPTION_KEY`
//! environment variable, which Render holds in its **secret store**:
//!
//! ```yaml
//! envVars:
//!   - key: FILL_WALLET_ENCRYPTION_KEY
//!     generateValue: true   # Render mints, encrypts at rest, hands
//!                          # plaintext to the running container only.
//! ```
//!
//! `generateValue: true` is functionally a managed-KMS pattern — Render
//! holds the master key encrypted in their secret store and only
//! injects the plaintext into the running container's env. The
//! master key never appears in source control and never sits unencrypted
//! on disk in Render's infrastructure.
//!
//! Rotation: update the env var, redeploy. The sealer picks up the new
//! key on the next boot. Existing encrypted operator keys become
//! un-decryptable on the next aggregator restart if the master key
//! changed without re-sealing — operators would need to rotate their
//! fill-wallet (via the dashboard's "Rotate Key" button) to re-encrypt
//! under the new master key.
//!
//! ## Future work
//!
//! A future iteration could integrate Render's KMS (or any managed HSM)
//! via a custom adapter so the master key never enters process memory.
//! The [`Sealer`] interface is intentionally narrow so this is a
//! one-file swap: implement a `Sealer::from_kms(...)` constructor that
//! reaches out to the KMS provider on every `seal`/`open` call, leaving
//! the existing `from_env` constructor as the fallback path.
//!
//! ## Wire format
//!
//! The on-disk ciphertext format is the raw output of
//! [`aes_gcm::aead::Aead::encrypt`]: `nonce(12) || ciphertext_and_tag`.
//! The nonce is freshly generated per seal call from the OS CSPRNG; we
//! do not need to persist it separately because it's embedded in the
//! first 12 bytes of the ciphertext.

use aes_gcm::{
	aead::{Aead, KeyInit},
	Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use getrandom::getrandom;
use std::env;
use thiserror::Error;

/// Errors from the sealer.
#[derive(Debug, Error)]
pub enum SealerError {
	#[error(
		"FILL_WALLET_ENCRYPTION_KEY env var is not set; \
		 this is required to encrypt operator fill-wallet private keys at rest. \
		 Generate one with: openssl rand -base64 32"
	)]
	KeyMissing,
	#[error("FILL_WALLET_ENCRYPTION_KEY is not valid base64: {0}")]
	KeyNotBase64(base64::DecodeError),
	#[error(
		"FILL_WALLET_ENCRYPTION_KEY must decode to exactly 32 bytes, got {0}"
	)]
	KeyWrongLength(usize),
	#[error("encryption failed: {0}")]
	Encrypt(String),
	#[error("decryption failed (wrong key or tampered ciphertext): {0}")]
	Decrypt(String),
}

/// Symmetric sealer for at-rest encryption of operator secrets.
///
/// Constructed once at boot via [`Sealer::from_env`] and shared via
/// `Arc<Sealer>` across handlers and the fill-routing layer. Holds a
/// single 32-byte key.
#[derive(Clone)]
pub struct Sealer {
	cipher: Aes256Gcm,
}

impl Sealer {
	/// Load the encryption key from `FILL_WALLET_ENCRYPTION_KEY`. Accepts
	/// either 32 raw bytes or 32 base64-encoded bytes (the canonical
	/// form of `openssl rand -base64 32`).
	pub fn from_env() -> Result<Self, SealerError> {
		let raw = env::var("FILL_WALLET_ENCRYPTION_KEY").map_err(|_| SealerError::KeyMissing)?;
		let trimmed = raw.trim();
		// Try base64 first; fall back to raw bytes if the string is
		// exactly 32 chars and looks like hex. This makes the helper
		// robust against operators pasting either format into Render.
		let bytes = if trimmed.len() == 44 {
			// 32 bytes base64-encoded → 44 chars (with padding).
			BASE64
				.decode(trimmed)
				.map_err(SealerError::KeyNotBase64)?
		} else if trimmed.len() == 32 {
			trimmed.as_bytes().to_vec()
		} else {
			// Last-ditch attempt: it's base64 with no padding or stripped
			// whitespace. If decode succeeds, use it; otherwise error.
			match BASE64.decode(trimmed) {
				Ok(b) => b,
				Err(_) => {
					return Err(SealerError::KeyWrongLength(trimmed.len()));
				}
			}
		};
		if bytes.len() != 32 {
			return Err(SealerError::KeyWrongLength(bytes.len()));
		}
		let cipher =
			Aes256Gcm::new_from_slice(&bytes).map_err(|e| SealerError::Encrypt(e.to_string()))?;
		Ok(Self { cipher })
	}

	/// Construct directly from 32 raw bytes. Useful in tests.
	pub fn from_bytes(key: [u8; 32]) -> Self {
		let cipher = Aes256Gcm::new_from_slice(&key).expect("32-byte key is always valid");
		Self { cipher }
	}

	/// Encrypt `plaintext`. Returns `nonce(12) || ciphertext || tag(16)`
	/// as raw bytes, ready to be stored in a `BYTEA` column.
	pub fn seal(&self, plaintext: &[u8]) -> Result<Vec<u8>, SealerError> {
		let mut nonce_bytes = [0u8; 12];
		getrandom(&mut nonce_bytes).map_err(|e| SealerError::Encrypt(e.to_string()))?;
		let nonce = Nonce::from_slice(&nonce_bytes);
		let ciphertext = self
			.cipher
			.encrypt(nonce, plaintext)
			.map_err(|e| SealerError::Encrypt(e.to_string()))?;
		let mut out = Vec::with_capacity(12 + ciphertext.len());
		out.extend_from_slice(&nonce_bytes);
		out.extend_from_slice(&ciphertext);
		Ok(out)
	}

	/// Decrypt a `nonce(12) || ciphertext || tag(16)` blob produced by
	/// [`seal`](Self::seal). Returns the original plaintext.
	pub fn open(&self, blob: &[u8]) -> Result<Vec<u8>, SealerError> {
		if blob.len() < 12 + 16 {
			return Err(SealerError::Decrypt("blob too short".into()));
		}
		let (nonce_bytes, ciphertext) = blob.split_at(12);
		let nonce = Nonce::from_slice(nonce_bytes);
		self.cipher
			.decrypt(nonce, ciphertext)
			.map_err(|e| SealerError::Decrypt(e.to_string()))
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn round_trip_seals_and_opens() {
		let sealer = Sealer::from_bytes([7u8; 32]);
		let plaintext = b"0xdeadbeef0123456789abcdef";
		let blob = sealer.seal(plaintext).unwrap();
		// Ciphertext must be longer than plaintext (nonce + tag overhead).
		assert!(blob.len() >= plaintext.len() + 12 + 16);
		let recovered = sealer.open(&blob).unwrap();
		assert_eq!(recovered, plaintext);
	}

	#[test]
	fn seal_produces_distinct_ciphertexts() {
		let sealer = Sealer::from_bytes([7u8; 32]);
		let plaintext = b"same input";
		let a = sealer.seal(plaintext).unwrap();
		let b = sealer.seal(plaintext).unwrap();
		// Fresh nonces mean identical plaintexts produce different
		// ciphertexts — a fundamental property of AES-GCM with random
		// nonces.
		assert_ne!(a, b);
		// Both still decrypt to the same plaintext.
		assert_eq!(sealer.open(&a).unwrap(), plaintext);
		assert_eq!(sealer.open(&b).unwrap(), plaintext);
	}

	#[test]
	fn wrong_key_fails_to_decrypt() {
		let a = Sealer::from_bytes([1u8; 32]);
		let b = Sealer::from_bytes([2u8; 32]);
		let blob = a.seal(b"secret").unwrap();
		assert!(b.open(&blob).is_err());
	}

	#[test]
	fn truncated_blob_fails() {
		let sealer = Sealer::from_bytes([7u8; 32]);
		// 11 bytes (less than nonce) → "blob too short"
		assert!(matches!(
			sealer.open(&[0u8; 11]),
			Err(SealerError::Decrypt(_))
		));
	}
}
