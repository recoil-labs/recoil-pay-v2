//! Non-EVM direct settlement implementation for Solana and other non-EVM chains.
//!
//! This module provides a direct settlement implementation of the `SettlementInterface` trait
//! tailored for Non-EVM networks (specifically Solana via RPC). It validates fill execution
//! by querying on-chain transaction status and slot/block timestamps, and manages claim
//! readiness across dispute windows without requiring EVM transaction receipts.

use crate::{
	utils::parse_oracle_config, OracleConfig, SettlementError, SettlementInterface,
};
use alloy_primitives::hex;
use async_trait::async_trait;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::commitment_config::CommitmentConfig;
use solver_types::{
	with_0x_prefix, ConfigSchema, Field, FieldType, FillProof, NetworksConfig, Order, Schema,
	TransactionHash,
};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;

/// Non-EVM direct settlement implementation (`nonevm_direct`).
///
/// Validates cross-chain intent fulfillment on Solana (or other non-EVM networks)
/// by inspecting confirmed transaction status and block metadata via RPC.
pub struct NonEvmDirectSettlement {
	/// Non-EVM (Solana) RPC clients keyed by chain ID.
	rpc_clients: HashMap<u64, Arc<RpcClient>>,
	/// Oracle configuration including addresses and routes.
	oracle_config: OracleConfig,
	/// Dispute period duration in seconds before claims become ready.
	dispute_period_seconds: u64,
}

impl NonEvmDirectSettlement {
	/// Creates a new `NonEvmDirectSettlement` instance.
	pub async fn new(
		networks: &NetworksConfig,
		oracle_config: OracleConfig,
		dispute_period_seconds: u64,
	) -> Result<Self, SettlementError> {
		let all_network_ids: Vec<u64> = oracle_config
			.input_oracles
			.keys()
			.chain(oracle_config.output_oracles.keys())
			.copied()
			.collect();

		let mut rpc_clients = HashMap::new();
		for chain_id in all_network_ids {
			if let Some(network) = networks.get(&chain_id) {
				if network.is_solana() {
					let http_url = network.get_http_url().ok_or_else(|| {
						SettlementError::ValidationFailed(format!(
							"No HTTP RPC URL for Solana chain {chain_id}"
						))
					})?;
					let client = Arc::new(RpcClient::new_with_commitment(
						http_url.to_string(),
						CommitmentConfig::confirmed(),
					));
					rpc_clients.insert(chain_id, client);
				}
			}
		}

		Ok(Self {
			rpc_clients,
			oracle_config,
			dispute_period_seconds,
		})
	}

	/// Validate that the order-bound input oracle is configured for the given
	/// source chain. Returns the parsed order-bound input oracle on success.
	fn validate_bound_input_oracle(
		&self,
		order: &Order,
		source_chain: u64,
	) -> Result<solver_types::Address, SettlementError> {
		let input_oracle = crate::parse_bound_input_oracle(order)?;
		if !self.is_input_oracle_supported(source_chain, &input_oracle) {
			return Err(SettlementError::ValidationFailed(format!(
				"Order-bound input oracle is not configured for source chain {source_chain}"
			)));
		}
		Ok(input_oracle)
	}
}

/// Configuration schema for `NonEvmDirectSettlement`.
pub struct NonEvmDirectSettlementSchema;

impl NonEvmDirectSettlementSchema {
	pub fn validate_config(config: &serde_json::Value) -> Result<(), solver_types::ValidationError> {
		let instance = Self;
		instance.validate(config)
	}
}

impl ConfigSchema for NonEvmDirectSettlementSchema {
	fn validate(&self, config: &serde_json::Value) -> Result<(), solver_types::ValidationError> {
		let schema = Schema::new(
			vec![
				Field::new(
					"dispute_period_seconds",
					FieldType::Integer {
						min: Some(0),
						max: Some(86400),
					},
				),
				Field::new(
					"oracles",
					FieldType::Table(Schema::new(
						vec![
							Field::new("input", FieldType::Table(Schema::new(vec![], vec![]))),
							Field::new("output", FieldType::Table(Schema::new(vec![], vec![]))),
						],
						vec![],
					)),
				),
				Field::new("routes", FieldType::Table(Schema::new(vec![], vec![]))),
			],
			vec![Field::new("oracle_selection_strategy", FieldType::String)],
		);

		schema.validate(config)
	}
}

#[async_trait]
impl SettlementInterface for NonEvmDirectSettlement {
	fn oracle_config(&self) -> &OracleConfig {
		&self.oracle_config
	}

	fn config_schema(&self) -> Box<dyn ConfigSchema> {
		Box::new(NonEvmDirectSettlementSchema)
	}

	/// Gets attestation data for a filled order by querying Solana transaction status.
	async fn get_attestation(
		&self,
		order: &Order,
		tx_hash: &TransactionHash,
	) -> Result<FillProof, SettlementError> {
		let origin_chain_id = order
			.input_chains
			.first()
			.map(|c| c.chain_id)
			.ok_or_else(|| {
				SettlementError::ValidationFailed("No input chains in order".to_string())
			})?;

		let destination_chain_id = order
			.output_chains
			.first()
			.map(|c| c.chain_id)
			.ok_or_else(|| {
				SettlementError::ValidationFailed("No output chains in order".to_string())
			})?;

		let client = self.rpc_clients.get(&destination_chain_id).ok_or_else(|| {
			SettlementError::ValidationFailed(format!(
				"No Non-EVM / Solana provider configured for destination chain {destination_chain_id}"
			))
		})?;

		let oracle_address = self.validate_bound_input_oracle(order, origin_chain_id)?;

		// Convert tx_hash bytes to a Solana Signature (supports base58 string or raw bytes)
		let sig_str = if tx_hash.0.len() == 64 {
			match solana_sdk::signature::Signature::try_from(tx_hash.0.as_slice()) {
				Ok(sig) => sig.to_string(),
				Err(_) => bs58::encode(&tx_hash.0).into_string(),
			}
		} else if let Ok(s) = std::str::from_utf8(&tx_hash.0) {
			s.to_string()
		} else {
			bs58::encode(&tx_hash.0).into_string()
		};

		let signature = solana_sdk::signature::Signature::from_str(&sig_str).map_err(|e| {
			SettlementError::ValidationFailed(format!("Invalid Solana transaction signature {sig_str}: {e}"))
		})?;

		let tx = client
			.get_transaction_with_config(
				&signature,
				solana_client::rpc_config::RpcTransactionConfig {
					encoding: Some(solana_transaction_status::UiTransactionEncoding::Json),
					commitment: Some(CommitmentConfig::confirmed()),
					max_supported_transaction_version: Some(0),
				},
			)
			.await
			.map_err(|e| SettlementError::ValidationFailed(format!("Failed to fetch Solana transaction {sig_str}: {e}")))?;

		let meta = tx.transaction.meta.ok_or_else(|| {
			SettlementError::ValidationFailed(format!("Transaction {sig_str} missing metadata"))
		})?;

		if meta.status.is_err() {
			return Err(SettlementError::ValidationFailed(format!("Transaction {sig_str} failed on-chain")));
		}

		let block_number = tx.slot;
		let filled_timestamp = tx.block_time.unwrap_or_else(|| {
			std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.map(|d| d.as_secs())
				.unwrap_or(0) as i64
		}) as u64;

		Ok(FillProof {
			tx_hash: tx_hash.clone(),
			block_number,
			oracle_address: with_0x_prefix(&hex::encode(&oracle_address.0)),
			attestation_data: Some(order.id.as_bytes().to_vec()),
			filled_timestamp,
		})
	}

	/// Checks if an order is ready to be claimed after the dispute period has elapsed.
	async fn can_claim(&self, order: &Order, fill_proof: &FillProof) -> bool {
		let destination_chain_id = match order.output_chains.first() {
			Some(chain) => chain.chain_id,
			None => return false,
		};

		let client = match self.rpc_clients.get(&destination_chain_id) {
			Some(c) => c,
			None => return false,
		};

		let slot = match client.get_slot().await {
			Ok(s) => s,
			Err(_) => return false,
		};

		let current_timestamp = match client.get_block_time(slot).await {
			Ok(t) if t > 0 => t as u64,
			_ => std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.map(|d| d.as_secs())
				.unwrap_or(0),
		};

		let dispute_end_timestamp = fill_proof.filled_timestamp + self.dispute_period_seconds;
		current_timestamp >= dispute_end_timestamp
	}
}

/// Factory function to create `NonEvmDirectSettlement` from configuration.
pub fn create_settlement(
	config: &serde_json::Value,
	networks: &NetworksConfig,
	_storage: Arc<solver_storage::StorageService>,
) -> Result<Box<dyn SettlementInterface>, SettlementError> {
	NonEvmDirectSettlementSchema::validate_config(config)
		.map_err(|e| SettlementError::ValidationFailed(format!("Invalid configuration: {e}")))?;

	let oracle_config = parse_oracle_config(config)?;

	let dispute_period_seconds = config
		.get("dispute_period_seconds")
		.and_then(|v| v.as_i64())
		.unwrap_or(300) as u64;

	let settlement = tokio::task::block_in_place(|| {
		tokio::runtime::Handle::current().block_on(async {
			NonEvmDirectSettlement::new(networks, oracle_config, dispute_period_seconds).await
		})
	})?;

	Ok(Box::new(settlement))
}

/// Registry for `nonevm_direct` settlement implementation.
pub struct Registry;

impl solver_types::ImplementationRegistry for Registry {
	const NAME: &'static str = "nonevm_direct";
	type Factory = crate::SettlementFactory;

	fn factory() -> Self::Factory {
		create_settlement
	}
}

impl crate::SettlementRegistry for Registry {}
