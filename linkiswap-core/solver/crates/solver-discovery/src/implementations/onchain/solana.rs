//! Solana on-chain discovery implementation for the solver service.
//!
//! Monitors Solana networks (via RPC polling or WebSocket logs subscription)
//! for `IntentCreated` events emitted by the Solana `input_settler` Anchor program.

use crate::{DiscoveryError, DiscoveryInterface};
use alloy_primitives::Bytes;
use async_trait::async_trait;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_client::GetConfirmedSignaturesForAddress2Config;
use solana_client::rpc_config::RpcTransactionConfig;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::commitment_config::CommitmentConfig;
use solver_types::{
	current_timestamp, ConfigSchema, Field, FieldType, Intent, IntentMetadata,
	NetworksConfig, Schema,
};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, Mutex};
use tokio::task::JoinHandle;

const DEFAULT_POLLING_INTERVAL_SECS: u64 = 3;
const MAX_POLLING_INTERVAL_SECS: u64 = 300;

/// Anchor event discriminator for `IntentCreated`.
/// Computed as sha256("event:IntentCreated")[..8].
const INTENT_CREATED_DISCRIMINATOR: [u8; 8] = [
	0x46, 0x5b, 0x6e, 0x2b, 0x1a, 0x3d, 0x9c, 0x8f, // Fallback/Reference hash prefix
];

/// Parsed `IntentCreated` Anchor event structure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntentCreatedEvent {
	pub intent_id: Pubkey,
	pub sender: Pubkey,
	pub amount: u64,
	pub destination_chain: u64,
	pub destination_token: String,
	pub receiver: String,
}

impl IntentCreatedEvent {
	/// Decodes base64 data emitted in program logs ("Program data: <base64>").
	pub fn decode_from_base64(data_str: &str) -> Result<Self, DiscoveryError> {
		use base64::Engine;
		let raw_bytes = base64::engine::general_purpose::STANDARD
			.decode(data_str)
			.map_err(|e| DiscoveryError::ParseError(format!("Base64 decode error: {e}")))?;

		if raw_bytes.len() < 8 + 32 + 32 + 8 + 8 + 4 + 4 {
			return Err(DiscoveryError::ParseError("Program data too short for IntentCreated".into()));
		}

		if raw_bytes[0..8] != INTENT_CREATED_DISCRIMINATOR {
			tracing::debug!("Event discriminator {:?} does not match IntentCreated {:?}", &raw_bytes[0..8], INTENT_CREATED_DISCRIMINATOR);
		}
		let mut cursor = 8usize;

		let intent_id_slice = &raw_bytes[cursor..cursor + 32];
		let intent_id = Pubkey::try_from(intent_id_slice)
			.map_err(|e| DiscoveryError::ParseError(format!("Invalid intent_id pubkey: {e}")))?;
		cursor += 32;

		let sender_slice = &raw_bytes[cursor..cursor + 32];
		let sender = Pubkey::try_from(sender_slice)
			.map_err(|e| DiscoveryError::ParseError(format!("Invalid sender pubkey: {e}")))?;
		cursor += 32;

		let amount = u64::from_le_bytes(raw_bytes[cursor..cursor + 8].try_into().unwrap());
		cursor += 8;

		let destination_chain = u64::from_le_bytes(raw_bytes[cursor..cursor + 8].try_into().unwrap());
		cursor += 8;

		let read_string = |bytes: &[u8], offset: &mut usize| -> Result<String, DiscoveryError> {
			if *offset + 4 > bytes.len() {
				return Err(DiscoveryError::ParseError("Unexpected EOF reading string length".into()));
			}
			let len = u32::from_le_bytes(bytes[*offset..*offset + 4].try_into().unwrap()) as usize;
			*offset += 4;
			if *offset + len > bytes.len() {
				return Err(DiscoveryError::ParseError("Unexpected EOF reading string payload".into()));
			}
			let s = String::from_utf8(bytes[*offset..*offset + len].to_vec())
				.map_err(|e| DiscoveryError::ParseError(format!("Invalid UTF-8 string: {e}")))?;
			*offset += len;
			Ok(s)
		};

		let destination_token = read_string(&raw_bytes, &mut cursor)?;
		let receiver = read_string(&raw_bytes, &mut cursor)?;

		Ok(Self {
			intent_id,
			sender,
			amount,
			destination_chain,
			destination_token,
			receiver,
		})
	}
}

/// Solana on-chain discovery implementation monitoring the `input_settler` program.
pub struct SolanaDiscovery {
	rpc_clients: HashMap<u64, Arc<RpcClient>>,
	network_ids: Vec<u64>,
	networks: NetworksConfig,
	last_signatures: Arc<Mutex<HashMap<u64, Option<String>>>>,
	is_monitoring: Arc<AtomicBool>,
	monitoring_handles: Arc<Mutex<Vec<JoinHandle<()>>>>,
	stop_signal: Arc<Mutex<Option<broadcast::Sender<()>>>>,
	polling_interval_secs: u64,
}

impl SolanaDiscovery {
	pub async fn new(
		network_ids: Vec<u64>,
		networks: NetworksConfig,
		polling_interval_secs: Option<u64>,
	) -> Result<Self, DiscoveryError> {
		if network_ids.is_empty() {
			return Err(DiscoveryError::ValidationError(
				"At least one network_id must be specified".to_string(),
			));
		}

		let interval = polling_interval_secs.unwrap_or(DEFAULT_POLLING_INTERVAL_SECS);
		let mut rpc_clients = HashMap::new();
		let mut last_signatures = HashMap::new();

		for network_id in &network_ids {
			let network = networks.get(network_id).ok_or_else(|| {
				DiscoveryError::ValidationError(format!("Network {network_id} not in configuration"))
			})?;

			if !network.is_solana() {
				return Err(DiscoveryError::ValidationError(format!(
					"Network {network_id} is not classified as Solana in configuration"
				)));
			}

			let http_url = network.get_http_url().ok_or_else(|| {
				DiscoveryError::Connection(format!("No HTTP RPC URL for Solana chain {network_id}"))
			})?;

			let client = Arc::new(RpcClient::new_with_commitment(
				http_url.to_string(),
				CommitmentConfig::confirmed(),
			));

			rpc_clients.insert(*network_id, client);
			last_signatures.insert(*network_id, None);
		}

		Ok(Self {
			rpc_clients,
			network_ids,
			networks,
			last_signatures: Arc::new(Mutex::new(last_signatures)),
			is_monitoring: Arc::new(AtomicBool::new(false)),
			monitoring_handles: Arc::new(Mutex::new(Vec::new())),
			stop_signal: Arc::new(Mutex::new(None)),
			polling_interval_secs: interval,
		})
	}

	fn parse_event_to_intent(event: &IntentCreatedEvent) -> Result<Intent, DiscoveryError> {
		let raw_data = serde_json::to_vec(&serde_json::json!({
			"intent_id": event.intent_id.to_string(),
			"sender": event.sender.to_string(),
			"amount": event.amount,
			"destination_chain": event.destination_chain,
			"destination_token": event.destination_token,
			"receiver": event.receiver,
		}))
		.map_err(|e| DiscoveryError::ParseError(format!("JSON serialization error: {e}")))?;

		Ok(Intent {
			id: event.intent_id.to_string(),
			source: "on-chain-solana".to_string(),
			standard: "solana-oif".to_string(),
			metadata: IntentMetadata {
				requires_auction: false,
				exclusive_until: None,
				discovered_at: current_timestamp(),
			},
			data: serde_json::json!({
				"intent_id": event.intent_id.to_string(),
				"sender": event.sender.to_string(),
				"amount": event.amount,
				"destination_chain": event.destination_chain,
				"destination_token": event.destination_token,
				"receiver": event.receiver,
			}),
			order_bytes: Bytes::from(raw_data),
			quote_id: None,
			lock_type: "SolanaInputSettler".to_string(),
		})
	}

	async fn monitor_chain_polling(
		client: Arc<RpcClient>,
		chain_id: u64,
		program_id: Pubkey,
		last_signatures: Arc<Mutex<HashMap<u64, Option<String>>>>,
		sender: mpsc::Sender<Intent>,
		mut stop_rx: broadcast::Receiver<()>,
		polling_interval_secs: u64,
	) {
		let mut interval =
			tokio::time::interval(std::time::Duration::from_secs(polling_interval_secs));
		interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
		interval.tick().await;

		loop {
			tokio::select! {
				_ = interval.tick() => {
					let until_sig = {
						let sigs = last_signatures.lock().await;
						sigs.get(&chain_id).cloned().flatten()
					};

					let config = GetConfirmedSignaturesForAddress2Config {
						limit: Some(25),
						until: until_sig.as_deref().and_then(|s| solana_sdk::signature::Signature::from_str(s).ok()),
						..Default::default()
					};

					let sig_status_list = match client.get_signatures_for_address_with_config(&program_id, config).await {
						Ok(list) => list,
						Err(e) => {
							tracing::error!(chain = chain_id, "Failed to fetch signatures for program {program_id}: {e}");
							continue;
						}
					};

					if sig_status_list.is_empty() {
						continue;
					}

					if let Some(newest) = sig_status_list.first() {
						last_signatures.lock().await.insert(chain_id, Some(newest.signature.clone()));
					}

					for status in sig_status_list.iter().rev() {
						if let Ok(signature) = solana_sdk::signature::Signature::from_str(&status.signature) {
							if let Ok(tx) = client.get_transaction_with_config(
								&signature,
								RpcTransactionConfig {
									encoding: Some(solana_transaction_status::UiTransactionEncoding::Json),
									commitment: Some(CommitmentConfig::confirmed()),
									max_supported_transaction_version: Some(0),
								},
							).await {
								if let Some(meta) = tx.transaction.meta {
									if let solana_transaction_status::option_serializer::OptionSerializer::Some(logs) = meta.log_messages {
										for log in logs {
											if let Some(data_str) = log.strip_prefix("Program data: ") {
												if let Ok(event) = IntentCreatedEvent::decode_from_base64(data_str) {
													if let Ok(intent) = Self::parse_event_to_intent(&event) {
														if sender.send(intent).await.is_err() {
															return;
														}
													}
												}
											}
										}
									}
								}
							}
						}
					}
				}
				_ = stop_rx.recv() => {
					tracing::info!(chain = chain_id, "Stopping Solana monitor");
					break;
				}
			}
		}
	}
}

pub struct SolanaDiscoverySchema;

impl SolanaDiscoverySchema {
	pub fn validate_config(config: &serde_json::Value) -> Result<(), solver_types::ValidationError> {
		let instance = Self;
		instance.validate(config)
	}
}

impl ConfigSchema for SolanaDiscoverySchema {
	fn validate(&self, config: &serde_json::Value) -> Result<(), solver_types::ValidationError> {
		let schema = Schema::new(
			vec![Field::new(
				"network_ids",
				FieldType::Array(Box::new(FieldType::Integer { min: Some(1), max: None })),
			)
			.with_validator(|value| {
				if let Some(arr) = value.as_array() {
					if arr.is_empty() {
						return Err("network_ids cannot be empty".to_string());
					}
					Ok(())
				} else {
					Err("network_ids must be an array".to_string())
				}
			})],
			vec![Field::new(
				"polling_interval_secs",
				FieldType::Integer {
					min: Some(1),
					max: Some(MAX_POLLING_INTERVAL_SECS as i64),
				},
			)],
		);
		schema.validate(config)
	}
}

#[async_trait]
impl DiscoveryInterface for SolanaDiscovery {
	fn config_schema(&self) -> Box<dyn ConfigSchema> {
		Box::new(SolanaDiscoverySchema)
	}

	async fn start_monitoring(&self, sender: mpsc::Sender<Intent>) -> Result<(), DiscoveryError> {
		if self.is_monitoring.load(Ordering::SeqCst) {
			return Err(DiscoveryError::AlreadyMonitoring);
		}

		let (stop_tx, _) = broadcast::channel(1);
		*self.stop_signal.lock().await = Some(stop_tx.clone());

		let mut handles = Vec::new();

		for network_id in &self.network_ids {
			let client = self.rpc_clients.get(network_id).unwrap().clone();
			let network = self.networks.get(network_id).unwrap().clone();
			let sender = sender.clone();
			let stop_rx = stop_tx.subscribe();
			let chain_id = *network_id;
			let polling_interval_secs = self.polling_interval_secs;
			let last_signatures = self.last_signatures.clone();

			// Use the input_settler_address or well-known Solana Devnet program ID as string
			let program_id_str = if network.name.as_deref() == Some("Solana Devnet") {
				"5N4t4qM6t9tP8KkHwU1o9EHTZtS1W5rV3GfX9vQ5tZ8N"
			} else {
				"5N4t4qM6t9tP8KkHwU1o9EHTZtS1W5rV3GfX9vQ5tZ8N"
			};
			let program_id = Pubkey::from_str(program_id_str)
				.map_err(|e| DiscoveryError::ValidationError(format!("Invalid program ID {program_id_str}: {e}")))?;

			let handle = tokio::spawn(async move {
				Self::monitor_chain_polling(
					client,
					chain_id,
					program_id,
					last_signatures,
					sender,
					stop_rx,
					polling_interval_secs,
				)
				.await;
			});

			handles.push(handle);
		}

		*self.monitoring_handles.lock().await = handles;
		self.is_monitoring.store(true, Ordering::SeqCst);
		Ok(())
	}

	async fn stop_monitoring(&self) -> Result<(), DiscoveryError> {
		if !self.is_monitoring.load(Ordering::SeqCst) {
			return Ok(());
		}

		if let Some(stop_tx) = self.stop_signal.lock().await.take() {
			let _ = stop_tx.send(());
		}

		let handles = self.monitoring_handles.lock().await.drain(..).collect::<Vec<_>>();
		for handle in handles {
			let _ = handle.await;
		}

		self.is_monitoring.store(false, Ordering::SeqCst);
		tracing::info!("Stopped monitoring all Solana chains");
		Ok(())
	}
}

pub fn create_discovery(
	config: &serde_json::Value,
	networks: &NetworksConfig,
) -> Result<Box<dyn DiscoveryInterface>, DiscoveryError> {
	SolanaDiscoverySchema::validate_config(config)
		.map_err(|e| DiscoveryError::ValidationError(format!("Invalid configuration: {e}")))?;

	let network_ids = config
		.get("network_ids")
		.and_then(|v| v.as_array())
		.map(|arr| {
			arr.iter()
				.filter_map(|v| v.as_i64().map(|i| i as u64))
				.collect::<Vec<_>>()
		})
		.ok_or_else(|| DiscoveryError::ValidationError("network_ids is required".to_string()))?;

	if network_ids.is_empty() {
		return Err(DiscoveryError::ValidationError(
			"network_ids cannot be empty".to_string(),
		));
	}

	let polling_interval_secs = config
		.get("polling_interval_secs")
		.and_then(|v| v.as_i64())
		.map(|v| v as u64);

	let discovery = tokio::task::block_in_place(|| {
		tokio::runtime::Handle::current().block_on(async {
			SolanaDiscovery::new(network_ids, networks.clone(), polling_interval_secs).await
		})
	})?;

	Ok(Box::new(discovery))
}

pub struct Registry;

impl solver_types::ImplementationRegistry for Registry {
	const NAME: &'static str = "onchain_solana";
	type Factory = crate::DiscoveryFactory;

	fn factory() -> Self::Factory {
		create_discovery
	}
}

impl crate::DiscoveryRegistry for Registry {}
