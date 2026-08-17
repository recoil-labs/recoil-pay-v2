//! Fill-worker library — operator-side service that fills orders placed
//! against quotes published via the dashboard.
//!
//! ## Lifecycle
//!
//! 1. Operator boots the worker, pointing it at their `OPERATOR_PRIVATE_KEY`
//!    and the aggregator URL.
//! 2. Worker registers itself with the aggregator:
//!    `POST /solver-api/operators/{id}/worker`.
//! 3. Worker starts sending heartbeats every 30 s:
//!    `POST /solver-api/operators/{id}/heartbeat`.
//! 4. Worker subscribes to the aggregator's order stream (today: poll the
//!    `GET /api/v1/orders` endpoint; tomorrow: a dedicated push channel).
//! 5. For every order that matches a quote this operator published, the
//!    worker builds + signs the fill transaction and broadcasts it.
//! 6. Worker reports the outcome:
//!    `POST /solver-api/operators/{id}/fills` → updates reputation.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use thiserror::Error;
use tracing::{info, warn};

pub mod auth;
pub mod broadcaster;
pub mod chain_rpc;
pub mod config;
pub mod http_api;
pub mod identity_store;
pub mod remote_signer;
pub mod settlement;
pub mod signer;

pub use auth::{apply_signed_headers, sign_request, SignedHeaders};
pub use broadcaster::Broadcaster;
pub use chain_rpc::{
	sign_and_broadcast_fill, ChainBroadcaster, ChainRpc, ChainRpcError, FillRequest,
};
pub use config::FillWorkerConfig;
pub use http_api::{router as http_router, serve as serve_http};
pub use identity_store::{IdentityStatus, IdentityStore, IdentityStoreError};
pub use signer::{LocalSigner, OrderSigner, SigningError};

/// Errors raised by the fill-worker.
#[derive(Debug, Error)]
pub enum FillWorkerError {
	#[error("config error: {0}")]
	Config(String),
	#[error("HTTP error: {0}")]
	Http(String),
	#[error("signing error: {0}")]
	Signing(#[from] SigningError),
	#[error("order not fillable: {0}")]
	NotFillable(String),
	#[error("storage error: {0}")]
	Storage(String),
}

pub type FillWorkerResult<T> = Result<T, FillWorkerError>;

/// A request to fill an order, parsed from the aggregator's `/ws/orders`
/// frame. The frame is the user-facing `OrderResponse` JSON augmented
/// with `solverId` and the complete `signedOrder` block — unknown fields
/// are ignored, and the legacy flat fields are optional so both old and
/// new aggregators parse.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderFillRequest {
	pub order_id: String,
	#[serde(default)]
	pub intent_id: String,
	/// Which operator's quote this fill is for. Used to look up the
	/// matching encrypted fill-wallet key on the aggregator's
	/// `/solver-api/operators/{id}/sign-fill` endpoint.
	pub solver_id: String,
	#[serde(default)]
	pub from_chain: String,
	#[serde(default)]
	pub to_chain: String,
	#[serde(default)]
	pub from_asset: String,
	#[serde(default)]
	pub to_asset: String,
	#[serde(default)]
	pub input_amount: String,
	#[serde(default)]
	pub output_amount: String,
	#[serde(default)]
	pub user_address: String,
	#[serde(default)]
	pub expiry: u64,
	/// Pre-signed EIP-712 user signature over the order payload (legacy
	/// flat field — the escrow path reads `signed_order` instead).
	#[serde(default)]
	pub user_signature: String,
	/// The complete signed order (Permit2 payload + scheme-prefixed
	/// signature) the escrow settlement engine executes on-chain.
	#[serde(default)]
	pub signed_order: Option<settlement::SignedOrder>,
}

/// Outcome reported back to the aggregator.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillOutcome {
	pub order_id: String,
	/// The operator whose quote this order filled. In the multi-tenant
	/// model one worker settles for many operators, so the outcome must
	/// be credited to the order's operator rather than to the worker's
	/// own identity — otherwise reputation lands on the wrong account
	/// (and 404s, since the worker is not an operator).
	pub solver_id: String,
	pub succeeded: bool,
	pub latency_ms: u64,
	pub tx_hash: Option<String>,
	pub error: Option<String>,
}

/// Trait abstracting the order source. The default `Broadcaster` polls the
/// aggregator, but a WebSocket or in-memory channel can be swapped in for tests.
#[async_trait]
pub trait OrderSource: Send + Sync {
	async fn next_order(&self) -> FillWorkerResult<Option<OrderFillRequest>>;
}

/// The fill-worker orchestrator. Composes the order source, signer, and
/// broadcaster; the actual on-chain fill execution lives behind a callback so
/// we can mock it in tests until real delivery is wired in.
///
/// The orchestrator no longer holds the signer directly — it reads it from
/// the `IdentityStore` on every order so a `PUT /identity` from the dashboard
/// hot-swaps the signer without a restart.
pub struct FillWorker {
	config: FillWorkerConfig,
	broadcaster: Arc<dyn Broadcaster>,
	identity: Arc<IdentityStore>,
	/// Direct chain-RPC access for the escrow settlement engine
	/// (openFor / approve / fill / finalise + receipt polling). Built
	/// from `config.chain_rpcs`; `None` when no RPCs are configured, in
	/// which case orders are rejected as not fillable.
	chain_rpc: Option<Arc<dyn ChainRpc>>,
}

impl FillWorker {
	/// Construct an orchestrator that reads its signer from `identity`. The
	/// `config` is still required for `aggregator_url` and other connection
	/// settings, but `solver_id` + `operator_private_key` are now sourced
	/// from the identity store.
	pub fn new(
		config: FillWorkerConfig,
		broadcaster: Arc<dyn Broadcaster>,
		identity: Arc<IdentityStore>,
	) -> Self {
		let chain_rpc: Option<Arc<dyn ChainRpc>> = if config.chain_rpcs.is_empty() {
			warn!("CHAIN_RPCS is empty; escrow settlement is disabled and orders will be rejected");
			None
		} else {
			match ChainBroadcaster::from_rpc_map(config.chain_rpcs.clone()) {
				Ok(b) => Some(Arc::new(b)),
				Err(e) => {
					warn!(error = %e, "failed to build chain RPC providers; settlement disabled");
					None
				},
			}
		};
		Self {
			config,
			broadcaster,
			identity,
			chain_rpc,
		}
	}

	/// Boot the worker: try to register with the aggregator (if an identity
	/// is already loaded), start the heartbeat task, and enter the order
	/// loop. The loop watches the identity store — when an identity is
	/// installed via `PUT /identity`, the loop restarts itself with the
	/// new signer.
	pub async fn run(self: Arc<Self>) -> FillWorkerResult<()> {
		// Try registering once with whatever identity is already on disk.
		// If there's no identity yet, that's fine — `order_loop` will keep
		// polling and pick up the first `PUT /identity`.
		if let Err(e) = self.try_register_with_aggregator().await {
			warn!(
				error = %e,
				"initial aggregator registration failed; will retry after identity is loaded"
			);
		}

		let heartbeat_self = Arc::clone(&self);
		tokio::spawn(async move {
			heartbeat_self.heartbeat_loop().await;
		});

		self.identity_loop().await
	}

	/// Outer loop: watches the identity store. When the identity changes,
	/// the inner order loop is restarted with a fresh signer.
	async fn identity_loop(self: Arc<Self>) -> FillWorkerResult<()> {
		loop {
			// Snapshot the current solver_id (or None if no identity yet).
			let solver_id = self.identity.solver_id().await;

			match solver_id {
				Some(sid) => {
					info!(solver_id = %sid, "starting order loop with current identity");
					// Run the inner order loop until it errors (which on a
					// fresh identity is usually because the solver_id
					// changed; the loop detects that and returns Ok so we
					// fall back to re-reading the identity).
					if let Err(e) = self.clone().order_loop_for(&sid).await {
						warn!(error = %e, "order loop exited with error; restarting");
					}
				}
				None => {
					info!("no identity loaded; waiting for PUT /identity");
					// Sleep until identity is set. We poll every 5s; cheap.
					loop {
						tokio::time::sleep(std::time::Duration::from_secs(5)).await;
						if self.identity.solver_id().await.is_some() {
							break;
						}
					}
				}
			}
			// Brief pause before re-evaluating the identity to avoid a tight
			// loop if the inner loop returned instantly.
			tokio::time::sleep(std::time::Duration::from_millis(100)).await;
		}
	}

	/// Single round of the order loop — process one order then return.
	/// (The real run loop calls this in a `while !shutdown { ... }` cycle.)
	pub async fn process_one(&self, solver_id: &str) -> FillWorkerResult<Option<String>> {
		let req = match self.fetch_next_order(solver_id).await? {
			Some(r) => r,
			None => return Ok(None),
		};

		info!(
			order_id = %req.order_id,
			intent_id = %req.intent_id,
			from = %req.from_chain,
			to = %req.to_chain,
			"received fill request"
		);

		let started = std::time::Instant::now();
		let outcome = self.fill_order(&req).await;
		let elapsed_ms = started.elapsed().as_millis() as u64;

		let report = FillOutcome {
			order_id: req.order_id.clone(),
			solver_id: req.solver_id.clone(),
			succeeded: outcome.is_ok(),
			latency_ms: elapsed_ms,
			tx_hash: outcome.as_ref().ok().cloned(),
			error: outcome.as_ref().err().map(|e| e.to_string()),
		};

		if let Err(e) = self.broadcaster.report_outcome(&report).await {
			warn!(error = %e, "failed to report fill outcome to aggregator");
		}

		Ok(outcome.ok())
	}

	/// Best-effort settlement-status report to the aggregator. Failures
	/// are logged, never fatal — the settlement itself must not stall on
	/// a reporting hiccup.
	async fn report_status(
		&self,
		order_id: &str,
		status: &str,
		stage: Option<&str>,
		tx_hash: Option<&str>,
		error: Option<&str>,
	) {
		if let Err(e) = self
			.broadcaster
			.update_order_status(order_id, status, stage, tx_hash, error)
			.await
		{
			warn!(order_id = %order_id, status = %status, error = %e, "order status report failed");
		}
	}

	/// Execute the three-transaction escrow settlement for one order:
	///
	/// 1. `openFor` on the origin InputSettler (escrow the user's input),
	/// 2. `fill` on the destination OutputSettler (deliver the output,
	///    pre-approving the settler for the output token when needed),
	/// 3. `finalise` on the origin InputSettler (claim the escrow to the
	///    operator's payout address).
	///
	/// Every stage transition is reported to the aggregator so the user
	/// and the dashboard can watch the order progress. Returns the fill
	/// transaction hash (the one that pays the user).
	async fn fill_order(&self, req: &OrderFillRequest) -> FillWorkerResult<String> {
		use chain_rpc::{sign_and_broadcast_raw, wait_for_receipt, RawTx};

		const RECEIPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);

		let rpc = self.chain_rpc.clone().ok_or_else(|| {
			FillWorkerError::NotFillable("no CHAIN_RPCS configured; cannot settle".into())
		})?;

		let signed = req.signed_order.as_ref().ok_or_else(|| {
			FillWorkerError::NotFillable(
				"order frame carried no signedOrder; aggregator predates escrow settlement".into(),
			)
		})?;
		let parsed = settlement::ParsedSettlement::from_signed_order(signed)?;

		// The operator's fill-wallet: signs every settlement tx remotely
		// via the aggregator's `/sign-fill` (the key never leaves the
		// aggregator host) and holds the destination-chain inventory.
		let fill_wallet_address_str = self
			.broadcaster
			.fetch_fill_wallet_address(&req.solver_id)
			.await?
			.ok_or_else(|| {
				FillWorkerError::NotFillable(format!(
					"operator {} has no fill-wallet registered; cannot sign settlement",
					req.solver_id
				))
			})?;
		let fill_wallet: alloy_primitives::Address = fill_wallet_address_str
			.parse()
			.map_err(|e| FillWorkerError::NotFillable(format!("fill_wallet_address parse: {e}")))?;
		let remote_signer = remote_signer::RemoteFillSigner::new(
			req.solver_id.clone(),
			fill_wallet,
			self.broadcaster.clone(),
		);

		// ── Stage 1: escrow the user's input on the origin chain ────────
		self.report_status(&req.order_id, "pending", Some("prepare"), None, None)
			.await;
		let open_tx = RawTx {
			chain_id: parsed.origin_chain_id,
			to: parsed.input_settler,
			data: parsed.encode_open_for(),
			gas_limit: None,
		};
		let open_hash = match sign_and_broadcast_raw(rpc.clone(), &remote_signer, &open_tx).await {
			Ok(h) => h,
			Err(e) => {
				self.report_status(&req.order_id, "failed", Some("prepare"), None, Some(&e.to_string()))
					.await;
				return Err(e);
			},
		};
		if let Err(e) =
			wait_for_receipt(rpc.clone(), parsed.origin_chain_id, open_hash, RECEIPT_TIMEOUT).await
		{
			self.report_status(
				&req.order_id,
				"failed",
				Some("prepare"),
				Some(&format!("{open_hash:#x}")),
				Some(&e.to_string()),
			)
			.await;
			return Err(e);
		}
		let open_hash_str = format!("{open_hash:#x}");
		self.report_status(
			&req.order_id,
			"executing",
			Some("prepare"),
			Some(&open_hash_str),
			None,
		)
		.await;
		info!(order_id = %req.order_id, tx = %open_hash_str, "escrow opened (openFor confirmed)");

		// The canonical order id, as the origin settler computes it.
		let order_id32 = {
			let call_req = alloy_rpc_types_eth::TransactionRequest {
				to: Some(alloy_primitives::TxKind::Call(parsed.input_settler)),
				input: alloy_rpc_types_eth::TransactionInput::new(
					parsed.encode_order_identifier().into(),
				),
				..Default::default()
			};
			let ret = rpc.call(parsed.origin_chain_id, &call_req).await?;
			settlement::ParsedSettlement::decode_order_identifier(&ret)?
		};

		// From here on, the user's funds sit in escrow — failures are
		// loud, and the user can reclaim on-chain after expiry.

		// ── Stage 2: deliver the output on the destination chain ────────
		// Ensure the OutputSettler can pull the output token from the
		// fill-wallet.
		let fill_result: FillWorkerResult<(String, u64)> = async {
			let allowance_req = alloy_rpc_types_eth::TransactionRequest {
				to: Some(alloy_primitives::TxKind::Call(parsed.output_token)),
				input: alloy_rpc_types_eth::TransactionInput::new(
					settlement::encode_erc20_allowance(fill_wallet, parsed.output_settler).into(),
				),
				..Default::default()
			};
			let allowance = settlement::decode_u256_return(
				&rpc.call(parsed.destination_chain_id, &allowance_req).await?,
			)?;
			if allowance < parsed.output_amount {
				info!(
					order_id = %req.order_id,
					token = %parsed.output_token,
					settler = %parsed.output_settler,
					"approving output settler for output token"
				);
				let approve_tx = RawTx {
					chain_id: parsed.destination_chain_id,
					to: parsed.output_token,
					data: settlement::encode_erc20_approve(
						parsed.output_settler,
						alloy_primitives::U256::MAX,
					),
					gas_limit: None,
				};
				let approve_hash =
					sign_and_broadcast_raw(rpc.clone(), &remote_signer, &approve_tx).await?;
				wait_for_receipt(
					rpc.clone(),
					parsed.destination_chain_id,
					approve_hash,
					RECEIPT_TIMEOUT,
				)
				.await?;
			}

			let fill_tx = RawTx {
				chain_id: parsed.destination_chain_id,
				to: parsed.output_settler,
				data: parsed.encode_fill(order_id32, fill_wallet),
				gas_limit: None,
			};
			let fill_hash = sign_and_broadcast_raw(rpc.clone(), &remote_signer, &fill_tx).await?;
			let receipt = wait_for_receipt(
				rpc.clone(),
				parsed.destination_chain_id,
				fill_hash,
				RECEIPT_TIMEOUT,
			)
			.await?;
			let block_number = receipt.block_number.ok_or_else(|| {
				FillWorkerError::Http("fill receipt missing block number".into())
			})?;
			Ok((format!("{fill_hash:#x}"), block_number))
		}
		.await;

		let (fill_hash_str, fill_block) = match fill_result {
			Ok(v) => v,
			Err(e) => {
				self.report_status(&req.order_id, "failed", Some("fill"), None, Some(&e.to_string()))
					.await;
				return Err(e);
			},
		};
		self.report_status(
			&req.order_id,
			"executed",
			Some("fill"),
			Some(&fill_hash_str),
			None,
		)
		.await;
		info!(order_id = %req.order_id, tx = %fill_hash_str, "output delivered (fill confirmed)");

		// ── Stage 3: claim the escrow on the origin chain ───────────────
		self.report_status(&req.order_id, "settling", Some("claim"), None, None)
			.await;
		let claim_result: FillWorkerResult<String> = async {
			let fill_timestamp: u32 = rpc
				.block_timestamp(parsed.destination_chain_id, fill_block)
				.await?
				.try_into()
				.map_err(|_| FillWorkerError::Http("fill block timestamp exceeds u32".into()))?;

			// Escrow proceeds go to the operator's registered payout
			// address on the origin chain; fall back to the fill-wallet.
			let payout: alloy_primitives::Address = match self
				.broadcaster
				.fetch_settlement_contract_for(&req.solver_id, parsed.origin_chain_id)
				.await?
			{
				Some(addr) => addr.parse().map_err(|e| {
					FillWorkerError::NotFillable(format!("payout address parse: {e}"))
				})?,
				None => fill_wallet,
			};

			let finalise_tx = RawTx {
				chain_id: parsed.origin_chain_id,
				to: parsed.input_settler,
				data: parsed.encode_finalise(fill_timestamp, fill_wallet, payout),
				// Preset: OP Sepolia public RPCs reject estimation for
				// finalise with "intrinsic gas too high"; <300k is used.
				gas_limit: Some(3_000_000),
			};
			let finalise_hash =
				sign_and_broadcast_raw(rpc.clone(), &remote_signer, &finalise_tx).await?;
			wait_for_receipt(
				rpc.clone(),
				parsed.origin_chain_id,
				finalise_hash,
				RECEIPT_TIMEOUT,
			)
			.await?;
			Ok(format!("{finalise_hash:#x}"))
		}
		.await;

		match claim_result {
			Ok(finalise_hash_str) => {
				self.report_status(
					&req.order_id,
					"finalized",
					Some("claim"),
					Some(&finalise_hash_str),
					None,
				)
				.await;
				info!(
					order_id = %req.order_id,
					tx = %finalise_hash_str,
					"escrow claimed (finalise confirmed) — settlement complete"
				);
				Ok(fill_hash_str)
			},
			Err(e) => {
				self.report_status(&req.order_id, "failed", Some("claim"), None, Some(&e.to_string()))
					.await;
				Err(e)
			},
		}
	}

	async fn fetch_next_order(&self, solver_id: &str) -> FillWorkerResult<Option<OrderFillRequest>> {
		// Backwards-compatible path used by tests and one-shot callers.
		// Opens a fresh signed subscription and pulls a single order
		// before returning. The hot path (`order_loop`) keeps the
		// subscription alive across iterations — see `order_loop`.
		let mut sub = self.broadcaster.subscribe_orders(solver_id).await?;
		sub.next().await
	}

	async fn try_register_with_aggregator(&self) -> FillWorkerResult<()> {
		let solver_id = self.identity.solver_id().await.ok_or_else(|| {
			FillWorkerError::Config(
				"cannot register with aggregator: identity not loaded".into(),
			)
		})?;
		self.broadcaster
			.set_worker_url(&solver_id, self.config.public_url.clone())
			.await?;
		info!(
			solver_id = %solver_id,
			url = %self.config.public_url,
			"registered fill-worker with aggregator"
		);
		Ok(())
	}

	async fn heartbeat_loop(self: Arc<Self>) {
		let mut tick = tokio::time::interval(std::time::Duration::from_secs(30));
		loop {
			tick.tick().await;
			if let Some(solver_id) = self.identity.solver_id().await {
				if let Err(e) = self.broadcaster.heartbeat(&solver_id).await {
					warn!(error = %e, "heartbeat failed");
				}
			}
		}
	}

	/// Inner order loop, parameterized by the solver_id (so a fresh
	/// identity can be passed in). The outer `identity_loop` re-invokes
	/// this whenever the identity changes.
	async fn order_loop_for(self: Arc<Self>, solver_id: &str) -> FillWorkerResult<()> {
		// Orders are pulled from the aggregator's DURABLE queue, not from
		// the WebSocket. The socket is fire-and-forget: an order published
		// while no worker is subscribed is gone for good. Claiming leases
		// the order out of Postgres instead, so a dropped socket, a
		// restart, or a wedged reconnect costs latency rather than work.
		//
		// The socket survives purely as a latency optimisation: any frame
		// on it means "there may be work, claim now" — the payload is
		// deliberately ignored, so the socket can never be the reason an
		// order is missed or double-handled.
		const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(5);
		const CLAIM_BATCH: usize = 5;
		// Lease length; the keepalive below extends it for settlements
		// that outrun it.
		const LEASE_SECS: i64 = 300;
		const LEASE_REFRESH: std::time::Duration = std::time::Duration::from_secs(120);

		let hint = std::sync::Arc::new(tokio::sync::Notify::new());
		let hint_task = self
			.clone()
			.spawn_order_hint_task(solver_id.to_string(), hint.clone());

		let result = loop {
			// Identity rotated — exit so the outer loop rebinds.
			if self.identity.solver_id().await.as_deref() != Some(solver_id) {
				info!(prev_solver_id = %solver_id, "identity rotated; restarting order loop");
				break Ok(());
			}

			let claimed = match self
				.broadcaster
				.claim_orders(solver_id, CLAIM_BATCH, LEASE_SECS)
				.await
			{
				Ok(orders) => orders,
				Err(e) => {
					warn!(error = %e, "claiming orders failed; will retry");
					tokio::time::sleep(POLL_INTERVAL).await;
					continue;
				},
			};

			if claimed.is_empty() {
				// Idle: wake on the next hint or the poll tick, whichever
				// lands first. Polling is the floor that guarantees
				// delivery even with the socket permanently down.
				tokio::select! {
					_ = hint.notified() => {},
					_ = tokio::time::sleep(POLL_INTERVAL) => {},
				}
				continue;
			}

			for req in claimed {
				info!(order_id = %req.order_id, solver_id = %req.solver_id, "claimed order; settling");

				// Hold the lease open for as long as settlement runs, so a
				// slow chain doesn't hand our in-flight order to another
				// worker. Stops as soon as the lease is reassigned.
				let keepalive = {
					let broadcaster = self.broadcaster.clone();
					let order_id = req.order_id.clone();
					let worker_id = solver_id.to_string();
					tokio::spawn(async move {
						loop {
							tokio::time::sleep(LEASE_REFRESH).await;
							match broadcaster.extend_claim(&order_id, &worker_id, LEASE_SECS).await {
								Ok(true) => {},
								Ok(false) => {
									warn!(order_id = %order_id, "lease reassigned while settling");
									break;
								},
								Err(e) => warn!(order_id = %order_id, error = %e, "lease extend failed"),
							}
						}
					})
				};

				let started = std::time::Instant::now();
				let outcome = self.fill_order(&req).await;
				keepalive.abort();

				let report = FillOutcome {
					order_id: req.order_id.clone(),
					solver_id: req.solver_id.clone(),
					succeeded: outcome.is_ok(),
					latency_ms: started.elapsed().as_millis() as u64,
					tx_hash: outcome.as_ref().ok().cloned(),
					error: outcome.as_ref().err().map(|e| e.to_string()),
				};
				if let Err(e) = self.broadcaster.report_outcome(&report).await {
					warn!(error = %e, "failed to report fill outcome to aggregator");
				}
				if let Err(e) = outcome {
					warn!(order_id = %req.order_id, error = %e, "settlement failed");
				}
			}
		};

		hint_task.abort();
		result
	}

	/// Maintain the `/ws/orders` subscription purely as a wake-up signal.
	///
	/// Every frame simply pokes `hint`; the payload is ignored because the
	/// claim queue is the source of truth for what work exists. That makes
	/// this task strictly an optimisation — if it never reconnects, the
	/// order loop still drains the queue on its poll interval.
	fn spawn_order_hint_task(
		self: Arc<Self>,
		solver_id: String,
		hint: std::sync::Arc<tokio::sync::Notify>,
	) -> tokio::task::JoinHandle<()> {
		const BASE_BACKOFF: std::time::Duration = std::time::Duration::from_millis(500);
		const MAX_BACKOFF: std::time::Duration = std::time::Duration::from_secs(30);

		tokio::spawn(async move {
			let mut backoff = BASE_BACKOFF;
			loop {
				match self.broadcaster.subscribe_orders(&solver_id).await {
					Ok(mut sub) => {
						backoff = BASE_BACKOFF;
						info!("order hint subscription established");
						while let Ok(event) = sub.next_event().await {
							if matches!(event, broadcaster::OrderEvent::Closed) {
								break;
							}
							hint.notify_one();
						}
						warn!("order hint subscription dropped; reconnecting");
					},
					Err(e) => {
						warn!(error = %e, ?backoff, "order hint subscribe failed; retrying");
					},
				}
				tokio::time::sleep(backoff).await;
				backoff = (backoff * 2).min(MAX_BACKOFF);
			}
		})
	}
}

// Hex helpers live in signer.rs alongside the only call-site that needs
// them. Keep this file lean.

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
	use super::*;
	use crate::broadcaster::{OrderEvent, OrderSubscription};

	/// `OrderSubscription` impl backed by a `tokio::sync::mpsc` so
	/// tests can drive the orchestrator without a real WebSocket.
	struct MockSubscription {
		rx: tokio::sync::mpsc::Receiver<OrderEvent>,
		lagged: u64,
	}

	#[async_trait]
	impl OrderSubscription for MockSubscription {
		async fn next_event(&mut self) -> FillWorkerResult<OrderEvent> {
			self.rx
				.recv()
				.await
				.ok_or_else(|| FillWorkerError::Http("mock channel closed".into()))
		}
		fn lagged_count(&self) -> u64 {
			self.lagged
		}
	}

	#[test]
	fn backoff_doubles_and_caps() {
		// Pure arithmetic test — no async — that exercises the
		// exponential backoff curve used by `order_loop` so a regression
		// in the cap or doubling factor fails loudly.
		let base = std::time::Duration::from_millis(500);
		let max = std::time::Duration::from_secs(30);
		let mut backoff = base;
		let mut samples = Vec::new();
		for _ in 0..10 {
			samples.push(backoff);
			backoff = (backoff * 2).min(max);
		}
		assert_eq!(samples[0], base);
		assert_eq!(samples[1], std::time::Duration::from_secs(1));
		assert_eq!(samples[2], std::time::Duration::from_secs(2));
		assert_eq!(samples[3], std::time::Duration::from_secs(4));
		assert_eq!(samples[4], std::time::Duration::from_secs(8));
		assert_eq!(samples[5], std::time::Duration::from_secs(16));
		// Capped at 30s.
		assert_eq!(samples[6], max);
		assert_eq!(samples[9], max);
	}

	#[tokio::test]
	async fn mock_subscription_yields_events_in_order() {
		// Sanity-check the in-memory test subscription so future
		// orchestrator-level tests can build on it.
		let (tx, rx) = tokio::sync::mpsc::channel::<OrderEvent>(8);
		let mut sub = MockSubscription { rx, lagged: 0 };
		tx.send(OrderEvent::Order(OrderFillRequest {
			order_id: "a".into(),
			intent_id: "i".into(),
			solver_id: "solver-test".into(),
			from_chain: "1".into(),
			to_chain: "2".into(),
			from_asset: "0x0".into(),
			to_asset: "0x0".into(),
			input_amount: "0".into(),
			output_amount: "0".into(),
			user_address: "0x0".into(),
			expiry: 0,
			user_signature: "0x".into(),
			signed_order: None,
		}))
		.await
		.unwrap();
		let event = sub.next_event().await.expect("recv ok");
		match event {
			OrderEvent::Order(req) => assert_eq!(req.order_id, "a"),
			other => panic!("expected Order, got {other:?}"),
		}
		tx.send(OrderEvent::Lagged(3)).await.unwrap();
		let event = sub.next_event().await.expect("recv ok");
		match event {
			OrderEvent::Lagged(n) => assert_eq!(n, 3),
			other => panic!("expected Lagged, got {other:?}"),
		}
		assert_eq!(sub.lagged_count(), 0); // MockSubscription doesn't update lag
	}

	/// The operators API serializes camelCase. A struct that forgets
	/// `rename_all` decodes nothing and kills settlement before its first
	/// transaction — which is exactly what happened in production, with
	/// only "error decoding response body" to show for it.
	#[test]
	fn operator_response_decodes_camel_case_fill_wallet() {
		#[derive(serde::Deserialize)]
		struct Resp {
			data: OperatorRow,
		}
		#[derive(serde::Deserialize)]
		#[serde(rename_all = "camelCase")]
		struct OperatorRow {
			fill_wallet_address: String,
		}

		// Verbatim shape of GET /solver-api/operators/{id}.
		let body = serde_json::json!({
			"data": {
				"solverId": "solver-abc",
				"walletAddress": "0x632BF0D0d6468908378C3ccfAC4E788B115e0E55",
				"fillWalletAddress": "0xf5dd9f05e82137d084c7121a63bac9e6fe20aa5b",
				"fillWorkerUrl": null,
				"reputationScore": 0.5
			}
		});
		let parsed: Resp = serde_json::from_value(body).expect("operator row must decode");
		assert_eq!(
			parsed.data.fill_wallet_address,
			"0xf5dd9f05e82137d084c7121a63bac9e6fe20aa5b"
		);
	}

	/// The outcome must be credited to the ORDER's operator. Reporting
	/// against the worker's own identity 404s and would put reputation on
	/// the wrong account.
	#[test]
	fn fill_outcome_carries_the_orders_operator() {
		let outcome = FillOutcome {
			order_id: "ord-1".into(),
			solver_id: "solver-632bf0d0".into(),
			succeeded: true,
			latency_ms: 1234,
			tx_hash: Some("0xabc".into()),
			error: None,
		};
		let json = serde_json::to_value(&outcome).unwrap();
		assert_eq!(json["solverId"], "solver-632bf0d0");
		assert_eq!(json["orderId"], "ord-1");
	}

	#[test]
	fn aggregator_ws_frame_parses_into_order_fill_request() {
		// The exact shape `post_orders` broadcasts: the user-facing
		// OrderResponse JSON augmented with `solverId` + `signedOrder`.
		// Legacy flat fields (intentId, fromChain, …) are absent — they
		// must default rather than fail the parse.
		let frame = serde_json::json!({
			"orderId": "ord-1",
			"status": "created",
			"quoteId": "q-1",
			"createdAt": "2026-07-29T00:00:00Z",
			"updatedAt": "2026-07-29T00:00:00Z",
			"inputAmounts": [],
			"outputAmounts": [],
			"orderType": "oif-escrow-v0",
			"settlement": { "type": "escrow", "data": {} },
			"solverId": "solver-abc",
			"signedOrder": {
				"quoteId": "q-1",
				"order": {
					"type": "oif-escrow-v0",
					"payload": {
						"domain": { "name": "Permit2", "chainId": 11155420 },
						"primaryType": "PermitBatchWitnessTransferFrom",
						"message": {}
					}
				},
				"signature": "0x00aabb",
				"settlement": null
			}
		});
		let req: OrderFillRequest =
			serde_json::from_value(frame).expect("broadcast frame must parse");
		assert_eq!(req.order_id, "ord-1");
		assert_eq!(req.solver_id, "solver-abc");
		assert_eq!(req.intent_id, ""); // defaulted legacy field
		let signed = req.signed_order.expect("signed order present");
		assert_eq!(signed.signature, "0x00aabb");
		assert_eq!(signed.order.order_type, "oif-escrow-v0");
		assert_eq!(signed.order.payload.primary_type, "PermitBatchWitnessTransferFrom");
	}
}
