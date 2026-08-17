//! Unified signer abstraction for different signing backends.
//!
//! This module provides the `AccountSigner` enum which allows delivery code
//! to work with any signer type without knowing the underlying implementation.

use alloy_consensus::SignableTransaction;
use alloy_network::TxSigner;
use alloy_primitives::{Address, Signature};
use alloy_signer::Signer;
use alloy_signer_local::PrivateKeySigner;
use async_trait::async_trait;
use solver_types::ChainFamily;

#[cfg(feature = "kms")]
use alloy_signer_aws::AwsSigner;

#[cfg(feature = "solana")]
use std::sync::Arc;

/// Unified signer that wraps different signing backends.
///
/// This enum allows delivery code to work with any signer type
/// without knowing the underlying implementation.
///
/// Both EVM variants implement Clone (verified: AwsSigner implements Clone).
/// The Solana variant is wrapped in `Arc` because `solana_sdk::signer::keypair::Keypair`
/// does not implement `Clone`.
#[derive(Clone)]
pub enum AccountSigner {
	/// Local signer using a private key stored in memory (EVM).
	Local(PrivateKeySigner),
	/// AWS KMS signer (only available with `kms` feature).
	#[cfg(feature = "kms")]
	Kms(AwsSigner),
	/// Solana Ed25519 keypair signer (only available with `solana` feature).
	#[cfg(feature = "solana")]
	Solana(Arc<solana_sdk::signer::keypair::Keypair>),
}

impl AccountSigner {
	/// Returns the chain family this signer belongs to.
	pub fn chain_family(&self) -> ChainFamily {
		match self {
			Self::Local(_) => ChainFamily::Evm,
			#[cfg(feature = "kms")]
			Self::Kms(_) => ChainFamily::Evm,
			#[cfg(feature = "solana")]
			Self::Solana(_) => ChainFamily::Solana,
		}
	}

	/// Returns the signer's Ethereum address.
	/// Panics if called on a non-EVM signer — use `chain_family()` to guard.
	pub fn address(&self) -> Address {
		match self {
			Self::Local(s) => Signer::address(s),
			#[cfg(feature = "kms")]
			Self::Kms(s) => Signer::address(s),
			#[cfg(feature = "solana")]
			Self::Solana(_) => panic!("address() called on Solana signer — use solana_pubkey()"),
		}
	}

	/// Returns the Solana public key as a base58 string.
	/// Returns `None` for EVM signers.
	#[cfg(feature = "solana")]
	pub fn solana_pubkey(&self) -> Option<String> {
		match self {
			Self::Solana(kp) => {
				use solana_sdk::signer::Signer as SolanaSigner;
				Some(kp.pubkey().to_string())
			},
			_ => None,
		}
	}

	/// Signs a raw byte message with the Solana keypair.
	/// Returns `None` for non-Solana signers.
	#[cfg(feature = "solana")]
	pub fn sign_solana_message(&self, message: &[u8]) -> Option<Vec<u8>> {
		match self {
			Self::Solana(kp) => {
				use solana_sdk::signer::Signer as SolanaSigner;
				Some(kp.sign_message(message).as_ref().to_vec())
			},
			_ => None,
		}
	}

	/// Returns a new EVM signer with the specified chain ID bound.
	/// Panics if called on a non-EVM signer.
	pub fn with_chain_id(self, chain_id: Option<u64>) -> Self {
		match self {
			Self::Local(s) => Self::Local(Signer::with_chain_id(s, chain_id)),
			#[cfg(feature = "kms")]
			Self::Kms(s) => Self::Kms(Signer::with_chain_id(s, chain_id)),
			#[cfg(feature = "solana")]
			Self::Solana(_) => panic!("with_chain_id() is not applicable for Solana signers"),
		}
	}
}

// Implement TxSigner trait for AccountSigner so it works with EthereumWallet.
// NOTE: Solana variant is intentionally excluded — Alloy's TxSigner trait is
// EVM-specific (secp256k1 + Ethereum transaction format).
#[async_trait]
impl TxSigner<Signature> for AccountSigner {
	fn address(&self) -> Address {
		AccountSigner::address(self)
	}

	async fn sign_transaction(
		&self,
		tx: &mut dyn SignableTransaction<Signature>,
	) -> alloy_signer::Result<Signature> {
		match self {
			Self::Local(s) => TxSigner::sign_transaction(s, tx).await,
			#[cfg(feature = "kms")]
			Self::Kms(s) => TxSigner::sign_transaction(s, tx).await,
			#[cfg(feature = "solana")]
			Self::Solana(_) => Err(alloy_signer::Error::other(
				"Solana signers cannot sign EVM transactions",
			)),
		}
	}
}

impl std::fmt::Debug for AccountSigner {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			Self::Local(_) => f
				.debug_struct("AccountSigner::Local")
				.finish_non_exhaustive(),
			#[cfg(feature = "kms")]
			Self::Kms(_) => f.debug_struct("AccountSigner::Kms").finish_non_exhaustive(),
			#[cfg(feature = "solana")]
			Self::Solana(_) => f.debug_struct("AccountSigner::Solana").finish_non_exhaustive(),
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	const TEST_PRIVATE_KEY: &str =
		"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

	fn create_test_signer() -> AccountSigner {
		let signer: PrivateKeySigner = TEST_PRIVATE_KEY.parse().unwrap();
		AccountSigner::Local(signer)
	}

	#[test]
	fn test_account_signer_address() {
		let signer = create_test_signer();
		let address = signer.address();
		// Anvil account #0 address (lowercase)
		assert_eq!(
			format!("{address:?}").to_lowercase(),
			"0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
		);
	}

	#[test]
	fn test_account_signer_with_chain_id() {
		let signer = create_test_signer();
		let with_chain = signer.with_chain_id(Some(1));
		// Address must remain stable after binding a chain id
		assert_eq!(
			format!("{:?}", with_chain.address()).to_lowercase(),
			"0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
		);
	}

	#[test]
	fn test_account_signer_clone() {
		let signer = create_test_signer();
		let cloned = signer.clone();
		assert_eq!(signer.address(), cloned.address());
	}

	#[tokio::test]
	async fn test_account_signer_tx_signer_address() {
		let signer = create_test_signer();
		let address = <AccountSigner as TxSigner<Signature>>::address(&signer);
		assert_eq!(
			format!("{address:?}").to_lowercase(),
			"0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
		);
	}

	#[test]
	fn test_account_signer_debug() {
		let signer = create_test_signer();
		let debug_str = format!("{signer:?}");
		assert!(debug_str.contains("AccountSigner::Local"));
	}
}
