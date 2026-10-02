//! On-chain broadcast: build an EIP-1559 fill transaction, sign it with the
//! operator's hot-wallet, encode the RLP envelope, and submit it via the
//! chain RPC.
//!
//! ## Lifecycle
//!
//! 1. Construct a `ChainBroadcaster` from a chain-id → RPC-URL map.
//! 2. For each `OrderFillRequest`:
//!    a. Resolve the destination chain's RPC provider from the map.
//!    b. Fetch the chain head (`eth_getBlockByNumber("latest")`) so we can
//!       fill in `max_fee_per_gas` (2x base fee + priority tip) and
//!       `gas_limit` (constant for now).
//!    c. Build an EIP-1559 `TxEip1559` from the order + head.
//!    d. Sign the tx with the operator's `LocalSigner`.
//!    e. RLP-encode the signed envelope (EIP-2718 form).
//!    f. Verify the signature locally before broadcasting.
//!    g. Broadcast via `eth_sendRawTransaction` → return the tx hash.
//!
//! For test environments the broadcaster can be substituted with a mock
//! that captures the RLP bytes.

use std::collections::HashMap;
use std::sync::Arc;

use alloy_consensus::{
	transaction::{SignerRecoverable, SignableTransaction},
	TxEip1559, TxEnvelope,
};
use alloy_eips::eip2718::Encodable2718;
use alloy_primitives::{Address, Bytes, ChainId, TxHash, TxKind, U256};
use alloy_provider::{Provider, RootProvider};
use alloy_rpc_types_eth::Block;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::{FillWorkerError, FillWorkerResult, OrderFillRequest, OrderSigner};

/// Errors raised by the chain broadcaster.
#[derive(Debug, thiserror::Error)]
pub enum ChainRpcError {
	#[error("no RPC configured for chain_id {0}")]
	NoRpcForChain(u64),
	#[error("RPC error: {0}")]
	Rpc(String),
	#[error("invalid order field: {0}")]
	InvalidOrder(String),
}

impl From<ChainRpcError> for FillWorkerError {
	fn from(e: ChainRpcError) -> Self {
		FillWorkerError::Http(e.to_string())
	}
}

/// Per-fill request context for the broadcaster. The fill-worker produces
/// this from the order and the resolved chain RPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillRequest {
	pub order: OrderFillRequest,
	pub destination_chain_id: u64,
	pub settlement_contract: Address,
	pub input_token: Address,
	pub input_amount: U256,
	pub output_token: Address,
	pub output_amount: U256,
	pub user_address: Address,
	pub expiry: u64,
	/// User's EIP-712 signature over the order (raw bytes).
	pub user_signature: Bytes,
}

/// Trait abstracting the chain RPC layer. Lets tests substitute a mock.
#[async_trait]
pub trait ChainRpc: Send + Sync {
	/// Fetch the latest block header so we can derive gas parameters.
	async fn latest_block(&self, chain_id: u64) -> FillWorkerResult<Block>;

	/// Return the on-chain transaction count for `address` (pending nonce).
	async fn nonce_at(
		&self,
		chain_id: u64,
		address: Address,
	) -> FillWorkerResult<u64>;

	/// Estimate gas for `tx` against the destination chain. Implementations
	/// may add a small buffer internally.
	async fn estimate_gas(
		&self,
		chain_id: u64,
		tx: &alloy_rpc_types_eth::TransactionRequest,
	) -> FillWorkerResult<u64>;

	/// Submit a signed, RLP-encoded transaction envelope to the chain.
	/// Returns the transaction hash.
	async fn send_raw_transaction(
		&self,
		chain_id: u64,
		encoded: &[u8],
	) -> FillWorkerResult<TxHash>;

	/// Execute an `eth_call` (staticcall) and return the raw result bytes.
	/// Default errors so lightweight mocks don't have to implement it.
	async fn call(
		&self,
		chain_id: u64,
		tx: &alloy_rpc_types_eth::TransactionRequest,
	) -> FillWorkerResult<Bytes> {
		let _ = (chain_id, tx);
		Err(ChainRpcError::Rpc("eth_call not supported by this RPC impl".into()).into())
	}

	/// Fetch a transaction receipt. `None` while the tx is still pending.
	async fn transaction_receipt(
		&self,
		chain_id: u64,
		tx_hash: TxHash,
	) -> FillWorkerResult<Option<alloy_rpc_types_eth::TransactionReceipt>> {
		let _ = (chain_id, tx_hash);
		Err(ChainRpcError::Rpc("receipts not supported by this RPC impl".into()).into())
	}

	/// Timestamp of a block — used as the fill attestation timestamp in
	/// `finalise`'s SolveParams.
	async fn block_timestamp(&self, chain_id: u64, block_number: u64) -> FillWorkerResult<u64> {
		let _ = (chain_id, block_number);
		Err(ChainRpcError::Rpc("blocks not supported by this RPC impl".into()).into())
	}

	/// Reports whether this RPC impl actually broadcasts (false for mocks).
	fn is_live(&self) -> bool;
}

/// Production broadcaster backed by alloy HTTP providers, one per chain.
#[derive(Clone, Debug)]
pub struct ChainBroadcaster {
	providers: HashMap<u64, Arc<RootProvider>>,
}

impl ChainBroadcaster {
	/// Build a broadcaster from a chain-id → RPC URL map. Each provider is
	/// constructed eagerly (HTTP clients are cheap to hold open) and shared
	/// across fills for the same chain.
	pub fn from_rpc_map(rpc_map: HashMap<u64, String>) -> FillWorkerResult<Self> {
		let mut providers: HashMap<u64, Arc<RootProvider>> = HashMap::new();
		for (chain_id, url) in rpc_map {
			let parsed = url
				.parse::<reqwest::Url>()
				.map_err(|e| ChainRpcError::Rpc(format!("invalid rpc url {url}: {e}")))?;
			let provider = RootProvider::new_http(parsed);
			providers.insert(chain_id, Arc::new(provider));
		}
		Ok(Self { providers })
	}

	/// Fetch the provider for a chain, returning a useful error if absent.
	fn provider_for(&self, chain_id: u64) -> FillWorkerResult<&Arc<RootProvider>> {
		self.providers
			.get(&chain_id)
			.ok_or_else(|| ChainRpcError::NoRpcForChain(chain_id).into())
	}
}

#[async_trait]
impl ChainRpc for ChainBroadcaster {
	async fn latest_block(&self, chain_id: u64) -> FillWorkerResult<Block> {
		let provider = self.provider_for(chain_id)?;
		provider
			.get_block_by_number(alloy_eips::BlockNumberOrTag::Latest)
			.await
			.map_err(|e| ChainRpcError::Rpc(e.to_string()))?
			.ok_or_else(|| ChainRpcError::Rpc("latest block not found".into()).into())
	}

	async fn nonce_at(
		&self,
		chain_id: u64,
		address: Address,
	) -> FillWorkerResult<u64> {
		let provider = self.provider_for(chain_id)?;
		provider
			.get_transaction_count(address)
			.await
			.map_err(|e| ChainRpcError::Rpc(e.to_string()).into())
	}

	async fn estimate_gas(
		&self,
		chain_id: u64,
		tx: &alloy_rpc_types_eth::TransactionRequest,
	) -> FillWorkerResult<u64> {
		let provider = self.provider_for(chain_id)?;
		let raw = provider
			.estimate_gas(tx.clone())
			.await
			.map_err(|e| ChainRpcError::Rpc(e.to_string()))?;
		Ok(gas_with_headroom(raw))
	}

	async fn send_raw_transaction(
		&self,
		chain_id: u64,
		encoded: &[u8],
	) -> FillWorkerResult<TxHash> {
		let provider = self.provider_for(chain_id)?;
		let pending = provider
			.send_raw_transaction(encoded)
			.await
			.map_err(|e| ChainRpcError::Rpc(e.to_string()))?;
		Ok(*pending.tx_hash())
	}

	async fn call(
		&self,
		chain_id: u64,
		tx: &alloy_rpc_types_eth::TransactionRequest,
	) -> FillWorkerResult<Bytes> {
		let provider = self.provider_for(chain_id)?;
		provider
			.call(tx.clone())
			.await
			.map_err(|e| ChainRpcError::Rpc(e.to_string()).into())
	}

	async fn transaction_receipt(
		&self,
		chain_id: u64,
		tx_hash: TxHash,
	) -> FillWorkerResult<Option<alloy_rpc_types_eth::TransactionReceipt>> {
		let provider = self.provider_for(chain_id)?;
		provider
			.get_transaction_receipt(tx_hash)
			.await
			.map_err(|e| ChainRpcError::Rpc(e.to_string()).into())
	}

	async fn block_timestamp(&self, chain_id: u64, block_number: u64) -> FillWorkerResult<u64> {
		let provider = self.provider_for(chain_id)?;
		let block = provider
			.get_block_by_number(alloy_eips::BlockNumberOrTag::Number(block_number))
			.await
			.map_err(|e| ChainRpcError::Rpc(e.to_string()))?
			.ok_or_else(|| ChainRpcError::Rpc(format!("block {block_number} not found")))?;
		Ok(block.header.timestamp)
	}

	fn is_live(&self) -> bool {
		true
	}
}

// ─── Build / sign / broadcast pipeline ───────────────────────────────────────

/// Default priority fee (1 gwei) when no head is available.
const DEFAULT_MAX_PRIORITY_FEE_PER_GAS: u128 = 1_000_000_000;

/// Safety margin added on top of `eth_estimateGas` to absorb calldata
/// variations across different order sizes.
const GAS_ESTIMATE_HEADROOM_PCT: u128 = 20;

/// Build an EIP-1559 tx skeleton from an order + chain head + nonce +
/// gas estimate. The nonce and gas fields are filled in by the caller
/// (they require an RPC round-trip each).
fn build_eip1559_tx(
	req: &FillRequest,
	head: &Block,
	nonce: u64,
	gas_limit: u64,
	_operator: Address,
) -> FillWorkerResult<TxEip1559> {
	// `block.header.inner` is the consensus `Header`, which carries the
	// `base_fee_per_gas: Option<u64>` field. The outer rpc-types `Header`
	// wraps it and exposes its own `base_fee: Option<U256>` field for
	// serde — we go straight to the consensus header to avoid an extra
	// conversion.
	let base_fee = head
		.header
		.inner
		.base_fee_per_gas
		.ok_or_else(|| ChainRpcError::InvalidOrder("head missing base_fee_per_gas".into()))?
		as u128;
	// max_fee_per_gas = 2 * base_fee + priority (safe headroom against
	// next-block base fee spikes).
	let max_fee_per_gas = base_fee
		.saturating_mul(2)
		.saturating_add(DEFAULT_MAX_PRIORITY_FEE_PER_GAS);

	Ok(TxEip1559 {
		chain_id: ChainId::from(req.destination_chain_id),
		nonce,
		gas_limit,
		max_fee_per_gas,
		max_priority_fee_per_gas: DEFAULT_MAX_PRIORITY_FEE_PER_GAS,
		to: TxKind::Call(req.settlement_contract),
		value: U256::ZERO,
		access_list: Default::default(),
		input: encode_fill_calldata(req),
	})
}

/// Add a `GAS_ESTIMATE_HEADROOM_PCT%` buffer to a raw gas estimate so the
/// transaction doesn't revert on small calldata variations.
fn gas_with_headroom(raw: u64) -> u64 {
	let headroom = (raw as u128).saturating_mul(GAS_ESTIMATE_HEADROOM_PCT) / 100;
	raw.saturating_add(headroom as u64)
}

/// Encode the calldata the fill-worker sends to the settlement contract.
/// Today this is a placeholder payload — the production encoding will be
/// the ABI-encoded `settle(bytes order, bytes userSig)` call against the
/// deployed contract. Keeping it empty for now so the rest of the pipeline
/// (sign + broadcast) can be exercised end-to-end without pulling in the
/// full contract ABI.
fn encode_fill_calldata(_req: &FillRequest) -> Bytes {
	Bytes::new()
}

/// Build + sign + broadcast a fill in one shot. The single entry point
/// the `Broadcaster::broadcast_fill` implementation calls.
pub async fn sign_and_broadcast_fill(
	rpc: Arc<dyn ChainRpc>,
	signer: &dyn OrderSigner,
	req: &FillRequest,
) -> FillWorkerResult<TxHash> {
	let operator = signer.address();

	// Fetch chain head, on-chain nonce for `operator`, and gas estimate in
	// parallel. Each is a separate RPC round-trip.
	let (head, nonce, gas_limit) = tokio::try_join!(
		rpc.latest_block(req.destination_chain_id),
		rpc.nonce_at(req.destination_chain_id, operator),
		async {
			// Build a minimal request that mirrors what we'll send on-chain
			// so the estimator sees the right calldata / destination.
			let probe = build_estimate_request(req, operator);
			rpc.estimate_gas(req.destination_chain_id, &probe).await
		}
	)?;

	let tx = build_eip1559_tx(req, &head, nonce, gas_limit, operator)?;

	// Sign via alloy's SignableTransaction trait.
	let signature = signer
		.sign_digest(&tx.signature_hash())
		.await
		.map_err(|e| FillWorkerError::Http(format!("signing failed: {e}")))?;
	let signed = tx.into_signed(signature);
	let envelope: TxEnvelope = TxEnvelope::Eip1559(signed);

	// Verify the signature locally before broadcasting — fails fast on
	// bad keys without burning an RPC call.
	let recovered = envelope
		.recover_signer()
		.map_err(|e| FillWorkerError::Http(format!("ecrecover failed: {e}")))?;
	if recovered != operator {
		return Err(FillWorkerError::Http(format!(
			"signature recovery mismatch: expected {operator}, got {recovered}"
		)));
	}

	// RLP-encode the envelope in EIP-2718 form (type byte || rlp), exactly
	// what `eth_sendRawTransaction` expects.
	let encoded = envelope.encoded_2718();

	info!(
		chain_id = req.destination_chain_id,
		order_id = %req.order.order_id,
		operator = %operator,
		nonce,
		gas_limit,
		tx_size_bytes = encoded.len(),
		"broadcasting fill transaction"
	);

	rpc.send_raw_transaction(req.destination_chain_id, &encoded).await
}

/// Build a `TransactionRequest` mirroring the fill's destination +
/// calldata so `eth_estimateGas` returns an accurate value.
fn build_estimate_request(req: &FillRequest, operator: Address) -> alloy_rpc_types_eth::TransactionRequest {
	alloy_rpc_types_eth::TransactionRequest {
		from: Some(operator),
		to: Some(alloy_primitives::TxKind::Call(req.settlement_contract)),
		value: Some(alloy_primitives::U256::ZERO),
		input: alloy_rpc_types_eth::TransactionInput::new(encode_fill_calldata(req)),
		..Default::default()
	}
}

// ─── Generic settlement transactions ─────────────────────────────────────────

/// An arbitrary contract call the settlement engine wants broadcast
/// (openFor / approve / fill / finalise).
#[derive(Debug, Clone)]
pub struct RawTx {
	pub chain_id: u64,
	pub to: Address,
	pub data: Vec<u8>,
	/// Preset gas limit. `None` = estimate (+headroom). `finalise`
	/// presets 3M because OP Sepolia's public RPCs reject the default
	/// estimation flow with "intrinsic gas too high".
	pub gas_limit: Option<u64>,
}

/// Build + sign + broadcast an arbitrary settlement call with the same
/// EIP-1559 pipeline (parallel head/nonce/gas fetch, local ecrecover
/// check, EIP-2718 encoding) as the fill path.
pub async fn sign_and_broadcast_raw(
	rpc: Arc<dyn ChainRpc>,
	signer: &dyn OrderSigner,
	raw: &RawTx,
) -> FillWorkerResult<TxHash> {
	let operator = signer.address();

	let estimate_req = alloy_rpc_types_eth::TransactionRequest {
		from: Some(operator),
		to: Some(TxKind::Call(raw.to)),
		value: Some(U256::ZERO),
		input: alloy_rpc_types_eth::TransactionInput::new(Bytes::from(raw.data.clone())),
		..Default::default()
	};

	let (head, nonce, gas_limit) = tokio::try_join!(
		rpc.latest_block(raw.chain_id),
		rpc.nonce_at(raw.chain_id, operator),
		async {
			match raw.gas_limit {
				Some(preset) => Ok(preset),
				None => rpc.estimate_gas(raw.chain_id, &estimate_req).await,
			}
		}
	)?;

	let base_fee = head
		.header
		.inner
		.base_fee_per_gas
		.ok_or_else(|| ChainRpcError::InvalidOrder("head missing base_fee_per_gas".into()))?
		as u128;
	let max_fee_per_gas = base_fee
		.saturating_mul(2)
		.saturating_add(DEFAULT_MAX_PRIORITY_FEE_PER_GAS);

	let tx = TxEip1559 {
		chain_id: ChainId::from(raw.chain_id),
		nonce,
		gas_limit,
		max_fee_per_gas,
		max_priority_fee_per_gas: DEFAULT_MAX_PRIORITY_FEE_PER_GAS,
		to: TxKind::Call(raw.to),
		value: U256::ZERO,
		access_list: Default::default(),
		input: Bytes::from(raw.data.clone()),
	};

	let signature = signer
		.sign_digest(&tx.signature_hash())
		.await
		.map_err(|e| FillWorkerError::Http(format!("signing failed: {e}")))?;
	let signed = tx.into_signed(signature);
	let envelope: TxEnvelope = TxEnvelope::Eip1559(signed);

	let recovered = envelope
		.recover_signer()
		.map_err(|e| FillWorkerError::Http(format!("ecrecover failed: {e}")))?;
	if recovered != operator {
		return Err(FillWorkerError::Http(format!(
			"signature recovery mismatch: expected {operator}, got {recovered}"
		)));
	}

	let encoded = envelope.encoded_2718();
	info!(
		chain_id = raw.chain_id,
		to = %raw.to,
		operator = %operator,
		nonce,
		gas_limit,
		tx_size_bytes = encoded.len(),
		"broadcasting settlement transaction"
	);
	rpc.send_raw_transaction(raw.chain_id, &encoded).await
}

/// Poll for a transaction receipt until it lands or `timeout` passes.
/// A reverted receipt is surfaced as an error.
pub async fn wait_for_receipt(
	rpc: Arc<dyn ChainRpc>,
	chain_id: u64,
	tx_hash: TxHash,
	timeout: std::time::Duration,
) -> FillWorkerResult<alloy_rpc_types_eth::TransactionReceipt> {
	const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);
	let deadline = std::time::Instant::now() + timeout;
	loop {
		if let Some(receipt) = rpc.transaction_receipt(chain_id, tx_hash).await? {
			if !receipt.status() {
				return Err(FillWorkerError::Http(format!(
					"transaction {tx_hash} reverted on chain {chain_id}"
				)));
			}
			return Ok(receipt);
		}
		if std::time::Instant::now() >= deadline {
			return Err(FillWorkerError::Http(format!(
				"timed out waiting for receipt of {tx_hash} on chain {chain_id}"
			)));
		}
		tokio::time::sleep(POLL_INTERVAL).await;
	}
}

/// Read a block's timestamp, retrying until it is served or `timeout`
/// passes.
///
/// Called right after a receipt confirms the block exists, so a miss is the
/// RPC lagging, not a missing block: load-balanced public endpoints (e.g.
/// `sepolia.base.org`) can return the receipt from one node and "block not
/// found" from the next. Failing there would strand the escrow unclaimed.
pub async fn wait_for_block_timestamp(
	rpc: Arc<dyn ChainRpc>,
	chain_id: u64,
	block_number: u64,
	timeout: std::time::Duration,
) -> FillWorkerResult<u64> {
	const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(500);
	let deadline = std::time::Instant::now() + timeout;
	loop {
		match rpc.block_timestamp(chain_id, block_number).await {
			Ok(timestamp) => return Ok(timestamp),
			Err(e) if std::time::Instant::now() < deadline => {
				info!(chain_id, block_number, error = %e, "block not served yet; retrying");
				tokio::time::sleep(POLL_INTERVAL).await;
			},
			Err(e) => return Err(e),
		}
	}
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
	use super::*;
	use crate::signer::LocalSigner;

	fn mock_order() -> OrderFillRequest {
		OrderFillRequest {
			order_id: "order-123".into(),
			intent_id: "intent-456".into(),
			solver_id: "solver-632bf0d0d6468908378c3ccfac4e788b115e0e55".into(),
			from_chain: "1".into(),
			to_chain: "11155420".into(),
			from_asset: "USDC".into(),
			to_asset: "USDC".into(),
			input_amount: "1000000".into(),
			output_amount: "999000".into(),
			user_address: "0x000000000000000000000000000000000000dead".into(),
			expiry: 1_900_000_000,
			user_signature: "0x".into(),
			signed_order: None,
		}
	}

	fn mock_fill_request() -> FillRequest {
		FillRequest {
			order: mock_order(),
			destination_chain_id: 11155420,
			settlement_contract: "0x1111111111111111111111111111111111111111"
				.parse()
				.unwrap(),
			input_token: "0x2222222222222222222222222222222222222222"
				.parse()
				.unwrap(),
			input_amount: U256::from(1_000_000u64),
			output_token: "0x3333333333333333333333333333333333333333"
				.parse()
				.unwrap(),
			output_amount: U256::from(999_000u64),
			user_address: "0x000000000000000000000000000000000000dead"
				.parse()
				.unwrap(),
			expiry: 1_900_000_000,
			user_signature: Bytes::new(),
		}
	}

	/// Build a minimal `Block` with just the fields we read (`base_fee_per_gas`).
	fn mock_block() -> Block {
		Block {
			header: alloy_rpc_types_eth::Header::new(
				alloy_consensus::Header {
					base_fee_per_gas: Some(1_000_000_000),
					..Default::default()
				},
			),
			..Default::default()
		}
	}

	#[test]
	fn gas_with_headroom_adds_20_percent() {
		// 100_000 + 20% = 120_000
		assert_eq!(gas_with_headroom(100_000), 120_000);
		// 50_000 + 20% = 60_000
		assert_eq!(gas_with_headroom(50_000), 60_000);
		// Zero stays zero (saturating math)
		assert_eq!(gas_with_headroom(0), 0);
	}

	#[test]
	fn eip1559_tx_has_correct_chain_id_and_to() {
		let req = mock_fill_request();
		let head = mock_block();
		let operator: Address = "0xabcdef0000000000000000000000000000000001"
			.parse()
			.unwrap();
		let tx = build_eip1559_tx(&req, &head, 7, 250_000, operator).unwrap();
		assert_eq!(tx.chain_id, 11155420);
		assert_eq!(tx.to, TxKind::Call(req.settlement_contract));
		assert_eq!(tx.value, U256::ZERO);
		assert_eq!(tx.nonce, 7);
		assert_eq!(tx.gas_limit, 250_000);
		// 2x base_fee (2 gwei) + 1 gwei priority = 3 gwei
		assert_eq!(tx.max_fee_per_gas, 3_000_000_000);
		assert_eq!(tx.max_priority_fee_per_gas, 1_000_000_000);
	}

	#[test]
	fn eip1559_tx_rejects_head_without_base_fee() {
		let req = mock_fill_request();
		let head = Block::default();
		let operator: Address = "0xabcdef0000000000000000000000000000000001"
			.parse()
			.unwrap();
		let err = build_eip1559_tx(&req, &head, 0, 100_000, operator).unwrap_err();
		assert!(err.to_string().contains("base_fee_per_gas"));
	}

	#[tokio::test]
	async fn signed_envelope_recovers_to_operator_address() {
		// Generate a deterministic keypair, build + sign an EIP-1559 tx,
		// and verify the recovered signer matches the operator address.
		let signer = LocalSigner::new(&"ab".repeat(32)).unwrap();
		let operator = signer.address();

		let req = mock_fill_request();
		let head = mock_block();
		let tx = build_eip1559_tx(&req, &head, 0, 200_000, operator).unwrap();

		let signature = signer.sign_digest(&tx.signature_hash()).await.unwrap();
		let signed = tx.into_signed(signature);
		let envelope: TxEnvelope = TxEnvelope::Eip1559(signed);

		let recovered = envelope.recover_signer().unwrap();
		assert_eq!(recovered, operator);
	}

	#[tokio::test]
	async fn encoded_envelope_is_valid_2718() {
		let signer = LocalSigner::new(&"ab".repeat(32)).unwrap();
		let operator = signer.address();

		let req = mock_fill_request();
		let head = mock_block();
		let tx = build_eip1559_tx(&req, &head, 0, 200_000, operator).unwrap();

		let signature = signer.sign_digest(&tx.signature_hash()).await.unwrap();
		let signed = tx.into_signed(signature);
		let envelope: TxEnvelope = TxEnvelope::Eip1559(signed);

		let encoded = envelope.encoded_2718();
		// EIP-2718: first byte is the type (0x02 for EIP-1559), followed
		// by RLP-encoded fields.
		assert_eq!(encoded[0], 0x02);
		assert!(encoded.len() > 1);
	}

	#[tokio::test]
	async fn different_signers_produce_distinct_addresses() {
		let s1 = LocalSigner::new(&"ab".repeat(32)).unwrap();
		let s2 = LocalSigner::new(&"cd".repeat(32)).unwrap();
		assert_ne!(s1.address(), s2.address());
	}

	#[test]
	fn from_rpc_map_handles_invalid_url() {
		let mut map = HashMap::new();
		map.insert(1u64, "not a url".to_string());
		let err = ChainBroadcaster::from_rpc_map(map).unwrap_err();
		assert!(err.to_string().contains("invalid rpc url"));
	}

	#[test]
	fn no_rpc_for_chain_surfaces_clean_error() {
		// Build an empty broadcaster; asking for any chain should fail.
		let broadcaster = ChainBroadcaster::from_rpc_map(HashMap::new()).unwrap();
		let rt = tokio::runtime::Runtime::new().unwrap();
		let result = rt.block_on(broadcaster.latest_block(42));
		assert!(result.is_err());
		let msg = result.unwrap_err().to_string();
		assert!(msg.contains("no RPC configured for chain_id 42"));
	}

	/// Serves a block only after `misses` lookups, like a load-balanced RPC
	/// whose next node hasn't seen the block yet.
	struct LaggingBlocks {
		misses: std::sync::atomic::AtomicUsize,
	}

	#[async_trait]
	impl ChainRpc for LaggingBlocks {
		async fn latest_block(&self, _: u64) -> FillWorkerResult<Block> {
			unimplemented!()
		}
		async fn nonce_at(&self, _: u64, _: Address) -> FillWorkerResult<u64> {
			unimplemented!()
		}
		async fn estimate_gas(
			&self,
			_: u64,
			_: &alloy_rpc_types_eth::TransactionRequest,
		) -> FillWorkerResult<u64> {
			unimplemented!()
		}
		async fn send_raw_transaction(&self, _: u64, _: &[u8]) -> FillWorkerResult<TxHash> {
			unimplemented!()
		}
		async fn block_timestamp(&self, _: u64, block_number: u64) -> FillWorkerResult<u64> {
			use std::sync::atomic::Ordering;
			if self.misses.load(Ordering::SeqCst) > 0 {
				self.misses.fetch_sub(1, Ordering::SeqCst);
				return Err(ChainRpcError::Rpc(format!("block {block_number} not found")).into());
			}
			Ok(1_790_000_000)
		}
		fn is_live(&self) -> bool {
			false
		}
	}

	#[tokio::test]
	async fn block_timestamp_retries_while_the_rpc_lags() {
		let rpc: Arc<dyn ChainRpc> = Arc::new(LaggingBlocks { misses: 2.into() });
		let ts = wait_for_block_timestamp(rpc, 84532, 47582926, std::time::Duration::from_secs(10))
			.await
			.expect("served once the node catches up");
		assert_eq!(ts, 1_790_000_000);
	}

	#[tokio::test]
	async fn block_timestamp_gives_up_after_the_timeout() {
		let rpc: Arc<dyn ChainRpc> = Arc::new(LaggingBlocks { misses: usize::MAX.into() });
		let err = wait_for_block_timestamp(rpc, 84532, 47582926, std::time::Duration::from_millis(100))
			.await
			.unwrap_err();
		assert!(err.to_string().contains("block 47582926 not found"));
	}
}
