//! Operator hot-wallet key generation.
//!
//! Used by the dashboard's "Generate Key" flow. The aggregator generates a
//! fresh secp256k1 keypair, persists the **address** on the operator row,
//! and returns the private key (hex-encoded) **once** in the HTTP response so
//! the operator can back it up. The private key is never stored server-side.
//!
//! `k256` is used directly instead of `alloy` so this helper stays lightweight
//! (no alloy transitive deps leaking into oif-types). The address derivation
//! uses the standard Ethereum `keccak256(pubkey[1..])[12..]` recipe.

use k256::{
	ecdsa::SigningKey,
	SecretKey,
};
use sha3::{Digest, Keccak256};

/// A freshly generated operator hot-wallet key.
#[derive(Debug, Clone)]
pub struct GeneratedKey {
	/// 20-byte EVM address (`0x`-prefixed lower-case hex).
	pub address: String,
	/// 32-byte private key (`0x`-prefixed lower-case hex).
	pub private_key_hex: String,
}

/// Generate a fresh random secp256k1 keypair suitable for signing fills.
///
/// Uses OS-provided entropy via `getrandom` (no `rand_core` version coupling)
/// and falls back to constructing a `SecretKey` from the 32 raw bytes.
pub fn generate_random() -> GeneratedKey {
	let mut bytes = [0u8; 32];
	getrandom::getrandom(&mut bytes).expect("OS entropy must be available");
	let secret =
		SecretKey::from_slice(&bytes).expect("32 random bytes form a valid secp256k1 scalar");
	let signing_key = SigningKey::from(&secret);
	let verifying = signing_key.verifying_key().clone();
	build_from_parts(secret, verifying)
}

/// Build a `GeneratedKey` from a known `SecretKey` (used by `derive_address`).
fn build_from_parts(secret: SecretKey, verifying: k256::ecdsa::VerifyingKey) -> GeneratedKey {
	// Public key is 33 bytes (compressed) or 65 bytes (uncompressed).
	// We need the 64-byte `X || Y` form (without the SEC1 0x04 prefix)
	// to derive the Ethereum address.
	let pubkey_bytes = verifying.to_encoded_point(false);
	let pubkey_uncompressed = pubkey_bytes.as_bytes();
	debug_assert_eq!(pubkey_uncompressed.len(), 65);
	debug_assert_eq!(pubkey_uncompressed[0], 0x04);

	// Ethereum address = last 20 bytes of keccak256(pubkey[1..]).
	let mut hasher = Keccak256::new();
	hasher.update(&pubkey_uncompressed[1..]);
	let digest = hasher.finalize();
	let address_bytes = &digest[12..];

	let mut address_hex = String::with_capacity(42);
	address_hex.push_str("0x");
	for byte in address_bytes {
		address_hex.push_str(&format!("{:02x}", byte));
	}

	let secret_bytes = secret.to_bytes();
	let mut priv_hex = String::with_capacity(66);
	priv_hex.push_str("0x");
	for byte in secret_bytes.iter() {
		priv_hex.push_str(&format!("{:02x}", byte));
	}

	GeneratedKey {
		address: address_hex,
		private_key_hex: priv_hex,
	}
}

/// Parse a hex-encoded private key (with or without `0x` prefix) and return
/// the matching `address`.
pub fn derive_address(private_key_hex: &str) -> Result<String, KeygenError> {
	let trimmed = private_key_hex.trim_start_matches("0x");
	let bytes = hex::decode(trimmed).map_err(|e| KeygenError::InvalidHex(e.to_string()))?;
	if bytes.len() != 32 {
		return Err(KeygenError::InvalidKeyLength(bytes.len()));
	}
	let secret =
		SecretKey::from_slice(&bytes).map_err(|e| KeygenError::InvalidKey(e.to_string()))?;
	let signing_key = SigningKey::from(&secret);
	let verifying = signing_key.verifying_key().clone();
	Ok(build_from_parts(secret, verifying).address)
}

/// Errors raised by the keygen helpers.
#[derive(Debug, thiserror::Error)]
pub enum KeygenError {
	#[error("invalid hex encoding: {0}")]
	InvalidHex(String),
	#[error("invalid key length: {0} bytes (expected 32)")]
	InvalidKeyLength(usize),
	#[error("invalid private key: {0}")]
	InvalidKey(String),
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn round_trip_address_derivation() {
		// A well-known test vector from the Ethereum yellow paper:
		// private key = 0x000...01 → address = 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
		let pk = "0x0000000000000000000000000000000000000000000000000000000000000001";
		let addr = derive_address(pk).expect("valid key");
		assert_eq!(
			addr.to_lowercase(),
			"0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
		);
	}

	#[test]
	fn accepts_unprefixed_hex() {
		let pk = "0000000000000000000000000000000000000000000000000000000000000001";
		let addr = derive_address(pk).expect("valid key");
		assert_eq!(
			addr.to_lowercase(),
			"0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
		);
	}

	#[test]
	fn rejects_bad_length() {
		let err = derive_address("deadbeef").unwrap_err();
		assert!(matches!(err, KeygenError::InvalidKeyLength(4)));
	}

	#[test]
	fn random_keys_are_unique_and_well_formed() {
		let k1 = generate_random();
		let k2 = generate_random();
		assert_ne!(k1.address, k2.address);
		assert_ne!(k1.private_key_hex, k2.private_key_hex);
		assert!(k1.address.starts_with("0x"));
		assert_eq!(k1.address.len(), 42);
		assert!(k1.private_key_hex.starts_with("0x"));
		assert_eq!(k1.private_key_hex.len(), 66);

		// Round-trip: deriving the address from the returned private key
		// must produce the same address.
		let derived = derive_address(&k1.private_key_hex).unwrap();
		assert_eq!(derived.to_lowercase(), k1.address.to_lowercase());
	}
}
