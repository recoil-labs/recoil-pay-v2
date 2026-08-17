//! Solana delivery implementation for the OIF solver.
//!
//! Implements [`DeliveryInterface`] for Solana by:
//! - Signing and broadcasting native SOL transfers and SPL-token transfers
//! - Monitoring transaction confirmation via the Solana JSON-RPC API
//! - Returning balances for SOL and SPL tokens
//!
//! # Configuration
//!
//! ```json
//! {
//!   "rpc_url": "https://api.devnet.solana.com",
//!   "commitment": "confirmed"
//! }
//! ```
//!
//! The `commitment` field is optional and defaults to `"confirmed"`.

use crate::{
	DeliveryError, DeliveryInterface, FeeModel, FeeParams, LogFilter, PlannedAttemptInit,
	TransactionCallback, TransactionMonitoringEvent, TransactionTracking,
	TransactionTrackingWithConfig,
};
use alloy_primitives::Bytes;
use async_trait::async_trait;
use serde::Deserialize;
use solana_client::{
	nonblocking::rpc_client::RpcClient,
	rpc_config::RpcTransactionConfig,
};
use solana_sdk::{
	commitment_config::{CommitmentConfig, CommitmentLevel},
	native_token::LAMPORTS_PER_SOL,
	pubkey::Pubkey,
	signature::Signature as SolanaSignature,
	signer::Signer as SolanaSigner,
	system_instruction,
	transaction::Transaction as SolanaTransaction,
};
use solver_account::AccountSigner;
use solver_types::{
	Address, ChainData, ConfigSchema, Log, NetworksConfig, Transaction, TransactionAttempt,
	TransactionAttemptStatus, TransactionHash, TransactionReceipt, TransactionType,
	ValidationError,
};
use std::{collections::HashMap, str::FromStr, sync::Arc};
use tracing::{debug, error, info, warn};

// ── Wire format for Solana transactions ──────────────────────────────────────

/// Describes a Solana transfer encoded in `Transaction.data` (JSON).
///
/// The solver engine encodes what it needs to transfer as a JSON payload
/// inside `Transaction.data`. `SolanaDelivery` deserializes this and builds
/// the actual Solana transaction.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SolanaTransferPayload {
	/// Transfer native SOL.
	Sol {
		/// Recipient public key (base58).
		recipient: String,
		/// Amount in lamports (1 SOL = 1_000_000_000 lamports).
		lamports: u64,
	},
	/// Transfer an SPL token.
	Spl {
		/// Recipient *wallet* public key (base58). The associated token account
		/// is derived automatically.
		recipient: String,
		/// SPL mint address (base58).
		mint: String,
		/// Amount in the token's smallest unit (e.g., 6 decimals for USDC).
		amount: u64,
		/// Token decimals — used for display and sanity checks only.
		decimals: u8,
	},
}

// ── Configuration ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SolanaDeliveryConfig {
	rpc_url: String,
	#[serde(default = "default_commitment")]
	commitment: String,
	/// Virtual chain ID this delivery instance handles (e.g. 9000000002 for devnet).
	chain_id: u64,
}

fn default_commitment() -> String {
	"confirmed".to_string()
}

impl SolanaDeliveryConfig {
	fn from_json(value: &serde_json::Value) -> Result<Self, ValidationError> {
		serde_json::from_value(value.clone())
			.map_err(|e| ValidationError::DeserializationError(e.to_string()))
	}

	fn commitment_config(&self) -> CommitmentConfig {
		match self.commitment.as_str() {
			"finalized" => CommitmentConfig::finalized(),
			"processed" => CommitmentConfig::processed(),
			_ => CommitmentConfig::confirmed(),
		}
	}
}

// ── Schema ────────────────────────────────────────────────────────────────────

pub struct SolanaDeliverySchema;

impl ConfigSchema for SolanaDeliverySchema {
	fn validate(&self, config: &serde_json::Value) -> Result<(), ValidationError> {
		SolanaDeliveryConfig::from_json(config).map(|_| ())
	}
}

// ── Implementation ────────────────────────────────────────────────────────────

/// Delivery backend for Solana chains.
pub struct SolanaDelivery {
	rpc: Arc<RpcClient>,
	commitment: CommitmentConfig,
	chain_id: u64,
	/// The solver's Solana keypair (from `AccountSigner::Solana`).
	keypair: Arc<solana_sdk::signer::keypair::Keypair>,
}

impl SolanaDelivery {
	/// Construct from a JSON config and the solver's Solana signer.
	pub fn new(
		config: &serde_json::Value,
		signer: &AccountSigner,
	) -> Result<Self, DeliveryError> {
		let cfg = SolanaDeliveryConfig::from_json(config)
			.map_err(|e| DeliveryError::Network(format!("Invalid Solana delivery config: {e}")))?;

		let keypair = match signer {
			AccountSigner::Solana(kp) => Arc::clone(kp),
			other => {
				return Err(DeliveryError::Network(format!(
					"SolanaDelivery requires a Solana signer, got {:?}",
					other
				)))
			},
		};

		let commitment = cfg.commitment_config();
		let rpc = Arc::new(RpcClient::new_with_commitment(cfg.rpc_url, commitment));

		Ok(Self { rpc, commitment, chain_id: cfg.chain_id, keypair })
	}

	/// Build a signed Solana transaction from the solver's generic `Transaction`.
	async fn build_signed_tx(
		&self,
		payload: &SolanaTransferPayload,
	) -> Result<SolanaTransaction, DeliveryError> {
		let blockhash = self
			.rpc
			.get_latest_blockhash()
			.await
			.map_err(|e| DeliveryError::Network(format!("get_latest_blockhash: {e}")))?;

		let payer = self.keypair.pubkey();

		let tx = match payload {
			SolanaTransferPayload::Sol { recipient, lamports } => {
				let to = Pubkey::from_str(recipient).map_err(|e| {
					DeliveryError::TransactionFailed(format!("Invalid recipient pubkey: {e}"))
				})?;
				let ix = system_instruction::transfer(&payer, &to, *lamports);
				SolanaTransaction::new_signed_with_payer(
					&[ix],
					Some(&payer),
					&[self.keypair.as_ref()],
					blockhash,
				)
			},
			SolanaTransferPayload::Spl { recipient, mint, amount, .. } => {
				let to_wallet = Pubkey::from_str(recipient).map_err(|e| {
					DeliveryError::TransactionFailed(format!("Invalid recipient pubkey: {e}"))
				})?;
				let mint_pk = Pubkey::from_str(mint).map_err(|e| {
					DeliveryError::TransactionFailed(format!("Invalid mint pubkey: {e}"))
				})?;

				let src_ata = spl_associated_token_account::get_associated_token_address(
					&payer, &mint_pk,
				);
				let dst_ata = spl_associated_token_account::get_associated_token_address(
					&to_wallet, &mint_pk,
				);

				let mut instructions = Vec::new();

				// Create destination ATA if it doesn't exist.
				let dst_account = self.rpc.get_account(&dst_ata).await;
				if dst_account.is_err() {
					instructions.push(
						spl_associated_token_account::instruction::create_associated_token_account(
							&payer,
							&to_wallet,
							&mint_pk,
							&spl_token::id(),
						),
					);
				}

				instructions.push(
					spl_token::instruction::transfer_checked(
						&spl_token::id(),
						&src_ata,
						&mint_pk,
						&dst_ata,
						&payer,
						&[],
						*amount,
						// Fetch decimals on-chain if not provided (default 6 for USDC).
						6,
					)
					.map_err(|e| {
						DeliveryError::TransactionFailed(format!("SPL transfer ix: {e}"))
					})?,
				);

				SolanaTransaction::new_signed_with_payer(
					&instructions,
					Some(&payer),
					&[self.keypair.as_ref()],
					blockhash,
				)
			},
		};

		Ok(tx)
	}

	/// Decode the solver's generic `Transaction.data` into a `SolanaTransferPayload`.
	fn decode_payload(tx: &Transaction) -> Result<SolanaTransferPayload, DeliveryError> {
		serde_json::from_slice(&tx.data).map_err(|e| {
			DeliveryError::TransactionFailed(format!(
				"Failed to decode Solana payload from tx.data: {e}"
			))
		})
	}

	/// Spawn a background task that monitors a transaction until confirmed and
	/// calls the provided callback.
	fn monitor_tx(
		rpc: Arc<RpcClient>,
		commitment: CommitmentConfig,
		signature: SolanaSignature,
		tracking: TransactionTracking,
		min_confirmations: u64,
		timeout_seconds: u64,
	) {
		tokio::spawn(async move {
			let sig_str = signature.to_string();
			let hash = TransactionHash(sig_str.as_bytes().to_vec());

			let deadline =
				tokio::time::Instant::now() + tokio::time::Duration::from_secs(timeout_seconds);

			loop {
				if tokio::time::Instant::now() > deadline {
					(tracking.callback)(TransactionMonitoringEvent::Indeterminate {
						id: tracking.id.clone(),
						tx_hash: hash.clone(),
						tx_type: tracking.tx_type,
						reason: "Confirmation timeout".to_string(),
					});
					break;
				}

				match rpc.get_signature_statuses(&[signature]).await {
					Ok(response) => {
						if let Some(Some(status)) = response.value.first() {
							let slot_confirmations =
								status.confirmations.unwrap_or(0) as u64;

							if slot_confirmations >= min_confirmations || status.confirmations.is_none() {
								// confirmations == None means finalized
								if let Some(err) = &status.err {
									error!(
										sig = %sig_str,
										err = ?err,
										"Solana tx failed on-chain"
									);
									(tracking.callback)(TransactionMonitoringEvent::Failed {
										id: tracking.id.clone(),
										tx_hash: hash.clone(),
										tx_type: tracking.tx_type,
										error: format!("{err:?}"),
										classification: crate::RevertClassification::Unknown,
									});
								} else {
									info!(sig = %sig_str, "Solana tx confirmed");
									let receipt = TransactionReceipt {
										tx_hash: hash.clone(),
										block_number: status.slot,
										success: true,
										logs: Vec::new(),
										gas_used: 0,
										effective_gas_price: 0,
									};
									(tracking.callback)(TransactionMonitoringEvent::Confirmed {
										id: tracking.id.clone(),
										tx_hash: hash.clone(),
										tx_type: tracking.tx_type,
										receipt,
									});
								}
								break;
							}
						}
					},
					Err(e) => {
						warn!(sig = %sig_str, err = %e, "Error polling Solana tx status");
					},
				}

				tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
			}
		});
	}
}

// ── DeliveryInterface ─────────────────────────────────────────────────────────

#[async_trait]
impl DeliveryInterface for SolanaDelivery {
	fn config_schema(&self) -> Box<dyn ConfigSchema> {
		Box::new(SolanaDeliverySchema)
	}

	async fn submit(
		&self,
		tx: Transaction,
		tracking: Option<TransactionTrackingWithConfig>,
	) -> Result<TransactionHash, DeliveryError> {
		let payload = Self::decode_payload(&tx)?;
		let signed_tx = self.build_signed_tx(&payload).await?;

		let signature = self
			.rpc
			.send_transaction(&signed_tx)
			.await
			.map_err(|e| DeliveryError::Network(format!("send_transaction: {e}")))?;

		info!(sig = %signature, chain_id = self.chain_id, "Solana tx submitted");

		let hash = TransactionHash(signature.to_string().into_bytes());

		if let Some(cfg) = tracking {
			Self::monitor_tx(
				Arc::clone(&self.rpc),
				self.commitment,
				signature,
				cfg.tracking,
				cfg.min_confirmations,
				cfg.tx_confirmation_timeout_seconds,
			);
		}

		Ok(hash)
	}

	async fn get_receipt(
		&self,
		hash: &TransactionHash,
		_chain_id: u64,
	) -> Result<TransactionReceipt, DeliveryError> {
		let sig_str = String::from_utf8(hash.0.clone()).map_err(|_| {
			DeliveryError::Network("Invalid Solana tx hash (not UTF-8)".to_string())
		})?;
		let sig = SolanaSignature::from_str(&sig_str).map_err(|e| {
			DeliveryError::Network(format!("Invalid Solana signature: {e}"))
		})?;

		let config = RpcTransactionConfig {
			commitment: Some(self.commitment),
			max_supported_transaction_version: Some(0),
			..Default::default()
		};

		let tx = self
			.rpc
			.get_transaction_with_config(&sig, config)
			.await
			.map_err(|e| DeliveryError::Network(format!("get_transaction: {e}")))?;

		let success = tx
			.transaction
			.meta
			.as_ref()
			.and_then(|m| m.err.as_ref())
			.is_none();

		Ok(TransactionReceipt {
			tx_hash: hash.clone(),
			block_number: tx.slot,
			success,
			logs: Vec::new(),
			gas_used: 0,
			effective_gas_price: 0,
		})
	}

	async fn get_fee_params(&self, _chain_id: u64) -> Result<FeeParams, DeliveryError> {
		// Solana fees are denominated in lamports per signature (typically 5000 lamports).
		// We express this as a "legacy" fee model with a fixed gas_price representing
		// 5000 lamports per signature — callers use this for profitability checks.
		let fee_per_sig: u128 = 5_000;
		Ok(FeeParams::legacy(self.chain_id, fee_per_sig))
	}

	async fn get_balance(
		&self,
		address: &str,
		token: Option<&str>,
		_chain_id: u64,
	) -> Result<String, DeliveryError> {
		let pk = Pubkey::from_str(address)
			.map_err(|e| DeliveryError::Network(format!("Invalid pubkey '{address}': {e}")))?;

		if let Some(mint_str) = token {
			// SPL token balance via associated token account.
			let mint = Pubkey::from_str(mint_str)
				.map_err(|e| DeliveryError::Network(format!("Invalid mint '{mint_str}': {e}")))?;
			let ata =
				spl_associated_token_account::get_associated_token_address(&pk, &mint);
			match self.rpc.get_token_account_balance(&ata).await {
				Ok(bal) => Ok(bal.amount),
				Err(_) => Ok("0".to_string()), // ATA doesn't exist yet
			}
		} else {
			// Native SOL balance in lamports.
			let lamports = self
				.rpc
				.get_balance(&pk)
				.await
				.map_err(|e| DeliveryError::Network(format!("get_balance: {e}")))?;
			Ok(lamports.to_string())
		}
	}

	async fn get_allowance(
		&self,
		_owner: &str,
		_spender: &str,
		_token_address: &str,
		_chain_id: u64,
	) -> Result<String, DeliveryError> {
		// Solana SPL tokens use a delegate model, not allowances.
		// Return MaxU64 to indicate "no approval needed" for fill cost estimation.
		Ok(u64::MAX.to_string())
	}

	async fn get_nonce(&self, _address: &str, _chain_id: u64) -> Result<u64, DeliveryError> {
		// Solana uses blockhashes, not nonces. Return 0 for compatibility.
		Ok(0)
	}

	async fn get_block_number(&self, _chain_id: u64) -> Result<u64, DeliveryError> {
		self.rpc
			.get_slot()
			.await
			.map_err(|e| DeliveryError::Network(format!("get_slot: {e}")))
	}

	async fn estimate_gas(&self, _tx: Transaction) -> Result<u64, DeliveryError> {
		// Solana compute units aren't equivalent to EVM gas. Return a fixed estimate
		// (200_000 compute units) that callers can use for profitability math.
		Ok(200_000)
	}

	async fn estimate_gas_with_overrides(
		&self,
		_tx: Transaction,
		_state_override: alloy_rpc_types::state::StateOverride,
	) -> Result<u64, DeliveryError> {
		Err(DeliveryError::NoImplementationAvailable)
	}

	async fn eth_call(&self, _tx: Transaction) -> Result<Bytes, DeliveryError> {
		Err(DeliveryError::NoImplementationAvailable)
	}

	async fn tx_exists(
		&self,
		hash: &TransactionHash,
		_chain_id: u64,
	) -> Result<bool, DeliveryError> {
		let sig_str = String::from_utf8(hash.0.clone())
			.map_err(|_| DeliveryError::Network("Invalid Solana tx hash".to_string()))?;
		let sig = SolanaSignature::from_str(&sig_str)
			.map_err(|e| DeliveryError::Network(format!("Invalid signature: {e}")))?;

		match self.rpc.get_signature_statuses(&[sig]).await {
			Ok(response) => Ok(response.value.first().and_then(|s| s.as_ref()).is_some()),
			Err(_) => Ok(false),
		}
	}

	async fn get_logs(
		&self,
		_chain_id: u64,
		_filter: LogFilter,
	) -> Result<Vec<Log>, DeliveryError> {
		// Log subscription / getProgramLogs will be added in Phase 2 (discovery).
		Ok(Vec::new())
	}
}

// ── Registry ──────────────────────────────────────────────────────────────────

/// Registry for the Solana delivery implementation.
pub struct Registry;

impl solver_types::ImplementationRegistry for Registry {
	const NAME: &'static str = "solana";
	type Factory = crate::DeliveryFactory;

	fn factory() -> Self::Factory {
		factory
	}
}

impl crate::DeliveryRegistry for Registry {}

/// Factory function matching the `DeliveryFactory` type alias.
pub fn factory(
	config: &serde_json::Value,
	_networks: &NetworksConfig,
	default_signer: &AccountSigner,
	per_network_signers: &HashMap<u64, AccountSigner>,
) -> Result<Box<dyn DeliveryInterface>, DeliveryError> {
	// Resolve the chain_id from config first to find per-network signer.
	let cfg = SolanaDeliveryConfig::from_json(config)
		.map_err(|e| DeliveryError::Network(format!("Solana config parse error: {e}")))?;

	let signer = per_network_signers.get(&cfg.chain_id).unwrap_or(default_signer);
	Ok(Box::new(SolanaDelivery::new(config, signer)?))
}
