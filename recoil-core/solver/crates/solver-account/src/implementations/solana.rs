//! Solana account implementation for the OIF solver.
//!
//! Provides a [`SolanaWallet`] that wraps a `solana_sdk::signer::keypair::Keypair`
//! (Ed25519). The private key can be supplied as:
//!
//! - `keypair_base58` — a base58-encoded 64-byte keypair (secret || public),
//!   the format produced by `solana-keygen` and most wallet exporters.
//! - `secret_key_hex` — a 64-hex-character 32-byte seed (ed25519 secret scalar).
//!
//! Exactly one of the two fields must be present.

use crate::{AccountError, AccountFactoryFuture, AccountInterface, AccountSigner};
use async_trait::async_trait;
use serde::Deserialize;
use solana_sdk::signer::keypair::Keypair;
use solver_types::{Address, ConfigSchema, ValidationError};
use std::sync::Arc;

/// Solana Ed25519 keypair wallet.
#[derive(Debug)]
pub struct SolanaWallet {
	keypair: Arc<Keypair>,
}

/// Configuration for the Solana wallet.
///
/// Provide exactly one of `keypair_base58` or `secret_key_hex`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SolanaWalletConfig {
	/// Base58-encoded 64-byte keypair (secret_key || public_key).
	/// This is the format output by `solana-keygen`.
	#[serde(default)]
	keypair_base58: Option<String>,
	/// Hex-encoded 32-byte seed (ed25519 secret scalar).
	#[serde(default)]
	secret_key_hex: Option<String>,
}

impl SolanaWalletConfig {
	fn from_json(config: &serde_json::Value) -> Result<Self, ValidationError> {
		let parsed: Self = serde_json::from_value(config.clone())
			.map_err(|e| ValidationError::DeserializationError(e.to_string()))?;
		parsed.validate()?;
		Ok(parsed)
	}

	fn validate(&self) -> Result<(), ValidationError> {
		match (&self.keypair_base58, &self.secret_key_hex) {
			(None, None) => Err(ValidationError::MissingField(
				"keypair_base58 or secret_key_hex".to_string(),
			)),
			(Some(_), Some(_)) => Err(ValidationError::InvalidValue {
				field: "solana_account".to_string(),
				message: "Provide exactly one of keypair_base58 or secret_key_hex".to_string(),
			}),
			(Some(b58), None) => {
				let bytes = bs58::decode(b58)
					.into_vec()
					.map_err(|e| ValidationError::InvalidValue {
						field: "keypair_base58".to_string(),
						message: format!("Invalid base58: {e}"),
					})?;
				if bytes.len() != 64 {
					return Err(ValidationError::InvalidValue {
						field: "keypair_base58".to_string(),
						message: format!(
							"Expected 64 bytes (secret || public), got {}",
							bytes.len()
						),
					});
				}
				Ok(())
			},
			(None, Some(hex_str)) => {
				let stripped = hex_str.strip_prefix("0x").unwrap_or(hex_str);
				if stripped.len() != 64 {
					return Err(ValidationError::InvalidValue {
						field: "secret_key_hex".to_string(),
						message: "Expected 32 bytes (64 hex chars)".to_string(),
					});
				}
				hex::decode(stripped).map_err(|e| ValidationError::InvalidValue {
					field: "secret_key_hex".to_string(),
					message: format!("Invalid hex: {e}"),
				})?;
				Ok(())
			},
		}
	}

	fn into_keypair(self) -> Result<Keypair, AccountError> {
		if let Some(b58) = self.keypair_base58 {
			let bytes = bs58::decode(&b58)
				.into_vec()
				.map_err(|e| AccountError::InvalidKey(format!("Base58 decode failed: {e}")))?;
			Keypair::from_bytes(&bytes)
				.map_err(|e| AccountError::InvalidKey(format!("Invalid keypair bytes: {e}")))
		} else if let Some(hex_str) = self.secret_key_hex {
			let stripped = hex_str.strip_prefix("0x").unwrap_or(&hex_str);
			let seed =
				hex::decode(stripped).map_err(|e| AccountError::InvalidKey(e.to_string()))?;
			Ok(Keypair::from_bytes(&seed)
				.map_err(|e| AccountError::InvalidKey(format!("Invalid seed: {e}")))?)
		} else {
			Err(AccountError::InvalidKey("No key material provided".to_string()))
		}
	}
}

impl SolanaWallet {
	/// Creates a new `SolanaWallet` from a base58-encoded keypair or hex seed.
	pub fn from_config(config: &serde_json::Value) -> Result<Self, AccountError> {
		let parsed = SolanaWalletConfig::from_json(config)
			.map_err(|e| AccountError::InvalidKey(format!("Invalid Solana config: {e}")))?;
		let keypair = parsed.into_keypair()?;
		Ok(Self { keypair: Arc::new(keypair) })
	}
}

/// Configuration schema for SolanaWallet — used by the config validator.
pub struct SolanaWalletSchema;

impl ConfigSchema for SolanaWalletSchema {
	fn validate(&self, config: &serde_json::Value) -> Result<(), ValidationError> {
		SolanaWalletConfig::from_json(config).map(|_| ())
	}
}

#[async_trait]
impl AccountInterface for SolanaWallet {
	async fn address(&self) -> Result<Address, AccountError> {
		// Solana public key is 32 bytes — encode as-is into our `Address` wrapper.
		use solana_sdk::signer::Signer;
		let pubkey_bytes = self.keypair.pubkey().to_bytes().to_vec();
		Ok(Address(pubkey_bytes))
	}

	fn signer(&self) -> AccountSigner {
		AccountSigner::Solana(Arc::clone(&self.keypair))
	}
}

/// Factory function matching the `AccountFactory` signature.
pub fn create_account(config: &serde_json::Value) -> AccountFactoryFuture<'_> {
	Box::pin(async move {
		let wallet = SolanaWallet::from_config(config)?;
		Ok(Box::new(wallet) as Box<dyn AccountInterface>)
	})
}

/// Registry entry for the Solana account implementation.
pub struct Registry;

impl solver_types::ImplementationRegistry for Registry {
	const NAME: &'static str = "solana";
	type Factory = crate::AccountFactory;

	fn factory() -> Self::Factory {
		create_account
	}
}

impl crate::AccountRegistry for Registry {}

#[cfg(test)]
mod tests {
	use super::*;

	// A known devnet keypair for testing only.
	// Public key: 4Nd1m7BdmFG7R8gRbWBL7CfPpW6Rt8cpPzDJGT5EXk1
	const TEST_KEYPAIR_B58: &str =
		"5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1foFbmXPBgS8qE2ysaGHHMHJYNJqGq7DkMSBkQKnY4Q4";

	fn config_from_b58(b58: &str) -> serde_json::Value {
		serde_json::json!({ "keypair_base58": b58 })
	}

	#[tokio::test]
	async fn test_create_account_valid_b58() {
		let config = config_from_b58(TEST_KEYPAIR_B58);
		let account = create_account(&config).await;
		assert!(account.is_ok(), "Expected Ok, got: {:?}", account.err());
	}

	#[tokio::test]
	async fn test_address_is_32_bytes() {
		let config = config_from_b58(TEST_KEYPAIR_B58);
		let account = create_account(&config).await.unwrap();
		let addr = account.address().await.unwrap();
		assert_eq!(addr.0.len(), 32, "Solana pubkey should be 32 bytes");
	}

	#[tokio::test]
	async fn test_signer_variant_is_solana() {
		let config = config_from_b58(TEST_KEYPAIR_B58);
		let account = create_account(&config).await.unwrap();
		let signer = account.signer();
		assert_eq!(signer.chain_family(), solver_types::ChainFamily::Solana);
	}

	#[test]
	fn test_validate_missing_both_keys() {
		let config = serde_json::json!({});
		assert!(SolanaWalletConfig::from_json(&config).is_err());
	}

	#[test]
	fn test_validate_both_keys_provided() {
		let config = serde_json::json!({
			"keypair_base58": TEST_KEYPAIR_B58,
			"secret_key_hex": "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
		});
		assert!(SolanaWalletConfig::from_json(&config).is_err());
	}

	#[test]
	fn test_registry_name() {
		assert_eq!(Registry::NAME, "solana");
	}
}
