//! HTTP broadcaster — talks to the aggregator to:
//! - register the fill-worker URL,
//! - send heartbeats,
//! - poll the next order to fill,
//! - report fill outcomes,
//! - broadcast a signed fill via the configured chain RPC.
//!
//! The on-chain broadcast is delegated to a `ChainRpc` so the broadcaster
//! stays a thin aggregator-HTTP adapter. `broadcast_fill` is the trait
//! method that the orchestrator calls; the trait takes the signer + a
//! pre-built `FillRequest` and the impl stitches the two together.

use std::sync::Arc;

use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio_tungstenite::tungstenite::{
	client::IntoClientRequest,
	handshake::client::Request,
	Message as WsMessage,
};
use tracing::warn;

use crate::{
	auth::{apply_signed_headers, sign_request},
	chain_rpc::{sign_and_broadcast_fill, ChainRpc, FillRequest},
	FillOutcome, FillWorkerError, FillWorkerResult, OrderFillRequest, OrderSigner,
};

#[derive(Debug, Deserialize)]
struct OrderListResponse {
	data: Vec<OrderFillRequest>,
}

#[derive(Debug, Serialize)]
struct SetWorkerUrlRequest {
	url: String,
}

#[async_trait]
pub trait Broadcaster: Send + Sync {
	async fn set_worker_url(&self, solver_id: &str, url: String) -> FillWorkerResult<()>;
	async fn heartbeat(&self, solver_id: &str) -> FillWorkerResult<()>;

	/// Open a live order subscription to the aggregator's `/ws/orders`
	/// endpoint. The returned [`OrderSubscription`] is a stream of
	/// `OrderFillRequest` payloads — implementations own the underlying
	/// WebSocket and clean it up when the subscription is dropped.
	///
	/// Replaces the older `poll_next_order` method: workers no longer
	/// need to hammer `/api/v1/orders` every few seconds. The signed
	/// handshake on the WebSocket upgrade is still required — see
	/// `auth::sign_request`.
	async fn subscribe_orders(
		&self,
		solver_id: &str,
	) -> FillWorkerResult<Box<dyn OrderSubscription>>;

	/// Poll the orders list once and return the next fillable order.
	///
	/// **Deprecated** — `subscribe_orders` is the preferred path because
	/// it avoids one signed request per poll (and the corresponding
	/// nonce-cache churn). Kept on the trait so older orchestrators and
	/// test fixtures still compile.
	#[deprecated(note = "use subscribe_orders; poll_next_order hammers the aggregator")]
	async fn poll_next_order(&self, solver_id: &str)
		-> FillWorkerResult<Option<OrderFillRequest>>;

	async fn report_outcome(&self, outcome: &FillOutcome) -> FillWorkerResult<()>;

	/// Look up the operator's settlement contract for `chain_id`. Returns
	/// `None` if the operator hasn't registered one. Default impl returns
	/// `None` for non-aggregator broadcasters.
	async fn fetch_settlement_contract(
		&self,
		_chain_id: u64,
	) -> FillWorkerResult<Option<String>> {
		Ok(None)
	}

	/// Look up the operator's fill-wallet address. The aggregator holds
	/// this in the encrypted fill-wallet key record — the worker needs
	/// it for nonce lookup on the destination chain RPC.
	///
	/// Default impl returns `None` for non-aggregator broadcasters.
	async fn fetch_fill_wallet_address(
		&self,
		_solver_id: &str,
	) -> FillWorkerResult<Option<String>> {
		Ok(None)
	}

	/// Claim up to `limit` orders from the aggregator's durable queue.
	///
	/// This is the delivery path that cannot lose work: orders sit in
	/// Postgres until a worker leases them, so a dropped socket or a
	/// restart costs latency rather than an order. Default returns
	/// nothing for in-memory test broadcasters.
	async fn claim_orders(
		&self,
		worker_id: &str,
		limit: usize,
		lease_secs: i64,
	) -> FillWorkerResult<Vec<OrderFillRequest>> {
		let _ = (worker_id, limit, lease_secs);
		Ok(Vec::new())
	}

	/// Extend the lease on an order still being settled. Returns `false`
	/// when the lease was already reassigned, in which case the caller
	/// must stop working on it.
	async fn extend_claim(
		&self,
		order_id: &str,
		worker_id: &str,
		lease_secs: i64,
	) -> FillWorkerResult<bool> {
		let _ = (order_id, worker_id, lease_secs);
		Ok(true)
	}

	/// Report a settlement-stage status transition for an order to the
	/// aggregator (`POST /solver-api/orders/{id}/status`). Default no-op
	/// so in-memory test broadcasters don't have to implement it.
	async fn update_order_status(
		&self,
		order_id: &str,
		status: &str,
		stage: Option<&str>,
		tx_hash: Option<&str>,
		error: Option<&str>,
	) -> FillWorkerResult<()> {
		let _ = (order_id, status, stage, tx_hash, error);
		Ok(())
	}

	/// Per-operator settlement (payout) address lookup for `chain_id` —
	/// the multi-tenant worker resolves this per incoming order, unlike
	/// [`fetch_settlement_contract`](Self::fetch_settlement_contract)
	/// which relies on a broadcaster-bound operator id. Default `None`.
	async fn fetch_settlement_contract_for(
		&self,
		_solver_id: &str,
		_chain_id: u64,
	) -> FillWorkerResult<Option<String>> {
		Ok(None)
	}

	/// Sign an EIP-1559 fill for `req` and broadcast via the chain RPC.
	/// Returns the on-chain transaction hash.
	async fn broadcast_fill(
		&self,
		req: &FillRequest,
		signer: &dyn OrderSigner,
	) -> FillWorkerResult<String>;

	/// Aggregator base URL (e.g. `http://recoil-aggregator:10000`).
	/// Used by helpers like the [`crate::remote_signer::RemoteFillSigner`]
	/// to build absolute URLs for new endpoints without binding them to
	/// a specific broadcaster implementation.
	fn aggregator_base_url(&self) -> &str;

	/// Sign + attach the four `x-auth-*` headers to an arbitrary
	/// outbound request using this broadcaster's bound worker identity.
	/// Lets helpers like [`crate::remote_signer::RemoteFillSigner`] make
	/// signed HTTP calls without re-implementing the signature scheme.
	async fn sign_request(
		&self,
		method: &str,
		path: &str,
		builder: reqwest::RequestBuilder,
	) -> FillWorkerResult<reqwest::RequestBuilder>;
}

/// Outcome of a single `next()` call on an [`OrderSubscription`].
/// The orchestrator uses the `Lagged` variant to decide when to
/// drop the subscription and reconnect.
#[derive(Debug)]
pub enum OrderEvent {
	/// A real order arrived. Caller should fill it.
	Order(OrderFillRequest),
	/// Aggregator reported that `n` messages were dropped because the
	/// in-memory broadcast channel overflowed. Caller should consider
	/// reconnecting.
	Lagged(u64),
	/// The subscription was closed cleanly (server-side close, or the
	/// underlying stream ended). Caller should reopen.
	Closed,
}

/// A live order stream returned by [`Broadcaster::subscribe_orders`].
///
/// Implementations hold the underlying WebSocket connection and parse
/// each incoming text frame into an `OrderFillRequest`. `next_event()`
/// resolves to `OrderEvent::Closed` when the subscription is closed
/// cleanly by the aggregator; an `Err` indicates a network/protocol
/// failure.
#[async_trait]
pub trait OrderSubscription: Send {
	/// Await the next event on the stream.
	async fn next_event(&mut self) -> FillWorkerResult<OrderEvent>;

	/// Convenience wrapper: returns the inner `OrderFillRequest` when
	/// the next event is `Order`, `None` when it's `Closed`, and `Err`
	/// for everything else (including `Lagged` so the orchestrator can
	/// decide to reconnect).
	async fn next(&mut self) -> FillWorkerResult<Option<OrderFillRequest>> {
		loop {
			match self.next_event().await? {
				OrderEvent::Order(req) => return Ok(Some(req)),
				OrderEvent::Lagged(_) => continue, // keep going; orchestrator can poll lagged_count() periodically
				OrderEvent::Closed => return Ok(None),
			}
		}
	}

	/// Number of messages the aggregator has dropped because the
	/// in-memory broadcast channel overflowed (the `Lagged` heartbeat
	/// count). Starts at `0` and is monotonically increasing across the
	/// lifetime of the subscription. When this crosses a caller-defined
	/// threshold the orchestrator should drop the subscription and
	/// reconnect to refresh the lag accounting.
	///
	/// Default impl returns `0` for in-memory test subscriptions that
	/// don't model backpressure.
	fn lagged_count(&self) -> u64 {
		0
	}
}

/// Backwards-compatible alias — older callers used `HttpBroadcaster`.
pub type HttpBroadcaster = dyn Broadcaster;

#[derive(Clone)]
pub struct AggregatorBroadcaster {
	base_url: String,
	client: Client,
	/// Operator id used in signed requests. Wrapped in an `RwLock` so the
	/// identity store can swap it at runtime without restarting the worker.
	operator_id: Arc<std::sync::RwLock<Option<String>>>,
	chain_rpc: Option<Arc<dyn ChainRpc>>,
	/// Signer used to sign every outbound request. Wrapped in an `RwLock` so
	/// the identity store can swap it at runtime without restarting the
	/// worker.
	signer: Arc<std::sync::RwLock<Option<Arc<dyn OrderSigner>>>>,
	/// Shared first-party token (`FILL_WORKER_TOKEN`) attached as
	/// `x-worker-token` on every REST call so the aggregator's auth
	/// middleware admits the hosted worker.
	worker_token: Option<String>,
}

impl AggregatorBroadcaster {
	pub fn new(base_url: impl Into<String>) -> Self {
		Self {
			base_url: base_url.into().trim_end_matches('/').to_string(),
			client: Client::new(),
			operator_id: Arc::new(std::sync::RwLock::new(None)),
			chain_rpc: None,
			signer: Arc::new(std::sync::RwLock::new(None)),
			worker_token: None,
		}
	}

	/// Bind the shared worker token attached to every outbound call.
	pub fn with_worker_token(mut self, token: Option<String>) -> Self {
		self.worker_token = token.filter(|t| !t.trim().is_empty());
		self
	}

	/// Bind the operator id used in fill-outcome reports. Called by the
	/// orchestrator before the order loop starts.
	pub fn with_operator_id(self, operator_id: impl Into<String>) -> Self {
		*self.operator_id.write().unwrap() = Some(operator_id.into());
		self
	}

	/// Re-bind the operator id at runtime (used by the identity store on
	/// `PUT /identity`). Cheap; just a mutex swap.
	pub fn set_operator_id(&self, operator_id: impl Into<String>) {
		*self.operator_id.write().unwrap() = Some(operator_id.into());
	}

	/// Bind the chain RPC used by `broadcast_fill`. When absent, the
	/// broadcaster falls back to the stub broadcast (placeholder hash).
	pub fn with_chain_rpc(mut self, chain_rpc: Arc<dyn ChainRpc>) -> Self {
		self.chain_rpc = Some(chain_rpc);
		self
	}

	/// Bind the signer used to sign every outbound aggregator request.
	/// When set, the four `x-auth-*` headers are attached to every call.
	pub fn with_signer(self, signer: Arc<dyn OrderSigner>) -> Self {
		*self.signer.write().unwrap() = Some(signer);
		self
	}

	/// Re-bind the signer at runtime. Hot-swaps the signing identity.
	pub fn set_signer(&self, signer: Arc<dyn OrderSigner>) {
		*self.signer.write().unwrap() = Some(signer);
	}

	pub fn into_arc(self) -> std::sync::Arc<dyn Broadcaster> {
		std::sync::Arc::new(self)
	}

	/// Sign + attach the four `x-auth-*` headers to an outbound request.
	/// When no signer is bound the headers are skipped (test paths only).
	async fn signed(
		&self,
		method: &str,
		path: &str,
		builder: reqwest::RequestBuilder,
	) -> FillWorkerResult<reqwest::RequestBuilder> {
		// First-party worker token, when configured.
		let builder = match self.worker_token.as_deref() {
			Some(token) => builder.header("x-worker-token", token),
			None => builder,
		};
		let signer_opt = self.signer.read().unwrap().clone();
		match signer_opt.as_ref() {
			Some(signer) => {
				let h = sign_request(signer.as_ref(), method, path).await?;
				Ok(apply_signed_headers(builder, &h))
			},
			None => Ok(builder),
		}
	}

	/// Public variant of [`signed`](Self::signed) for callers that need
	/// to authenticate as a one-off signer — used by the bootstrap
	/// identity pull in `main.rs`, where the worker has only the
	/// `OPERATOR_PRIVATE_KEY` env var (not a hot-swapped fill-wallet).
	pub async fn sign_with(
		&self,
		signer: &dyn OrderSigner,
		method: &str,
		path: &str,
		builder: reqwest::RequestBuilder,
	) -> FillWorkerResult<reqwest::RequestBuilder> {
		let h = sign_request(signer, method, path).await?;
		Ok(apply_signed_headers(builder, &h))
	}

	/// Cheap snapshot of the currently-bound operator id.
	fn current_operator_id(&self) -> Option<String> {
		self.operator_id.read().unwrap().clone()
	}

	/// Fetch the operator's fill-wallet address from the aggregator.
	/// Used by the multi-tenant fill-worker to discover which on-chain
	/// address to look up the nonce for when broadcasting a fill.
	pub async fn fetch_fill_wallet_address(
		&self,
		solver_id: &str,
	) -> FillWorkerResult<Option<String>> {
		#[derive(serde::Deserialize)]
		struct Resp {
			data: OperatorRow,
		}
		// The operators API serializes camelCase (`fillWalletAddress`).
		// Without this rename the body fails to decode and every
		// settlement dies before its first transaction.
		#[derive(serde::Deserialize)]
		#[serde(rename_all = "camelCase")]
		struct OperatorRow {
			fill_wallet_address: String,
		}
		let path = format!("/solver-api/operators/{}", solver_id);
		let url = format!("{}{}", self.base_url, path);
		let builder = self.client.get(&url);
		let builder = self.signed("GET", &path, builder).await?;
		let res = builder
			.send()
			.await
			.map_err(|e| FillWorkerError::Http(e.to_string()))?;
		if !res.status().is_success() {
			return Err(FillWorkerError::Http(format!(
				"get_operator returned {}",
				res.status()
			)));
		}
		let body: Resp = res
			.json()
			.await
			.map_err(|e| FillWorkerError::Http(e.to_string()))?;
		Ok(Some(body.data.fill_wallet_address))
	}

	/// Fetch the operator's settlement contract for `chain_id`. Returns
	/// `None` when the operator hasn't registered one (the caller should
	/// skip the fill rather than broadcast to `Address::ZERO`).
	pub async fn fetch_settlement_contract(
		&self,
		solver_id: &str,
		chain_id: u64,
	) -> FillWorkerResult<Option<String>> {
		#[derive(serde::Deserialize)]
		struct Resp {
			data: std::collections::HashMap<u64, String>,
		}
		let path = format!(
			"/solver-api/operators/{}/settlement-contracts",
			solver_id
		);
		let url = format!("{}{}", self.base_url, path);
		let builder = self.client.get(&url);
		let builder = self.signed("GET", &path, builder).await?;
		let res = builder
			.send()
			.await
			.map_err(|e| FillWorkerError::Http(e.to_string()))?;
		if !res.status().is_success() {
			return Err(FillWorkerError::Http(format!(
				"settlement-contracts lookup returned {}",
				res.status()
			)));
		}
		let body: Resp = res
			.json()
			.await
			.map_err(|e| FillWorkerError::Http(e.to_string()))?;
		Ok(body.data.get(&chain_id).cloned())
	}
}

#[async_trait]
impl Broadcaster for AggregatorBroadcaster {
	async fn set_worker_url(
		&self,
		solver_id: &str,
		url: String,
	) -> FillWorkerResult<()> {
		// Workers self-register on the dedicated /solver-api/workers/{id}
		// endpoint (not the operator endpoints, which require an operator
		// row to exist). The aggregator stores the worker's URL
		// idempotently and uses it for liveness + (future) order routing.
		let path = format!("/solver-api/workers/{}", solver_id);
		let endpoint = format!("{}{}", self.base_url, path);
		let builder = self
			.client
			.post(&endpoint)
			.json(&SetWorkerUrlRequest { url });
		let builder = self.signed("POST", &path, builder).await?;
		let res = builder
			.send()
			.await
			.map_err(|e| FillWorkerError::Http(e.to_string()))?;
		if !res.status().is_success() {
			return Err(FillWorkerError::Http(format!(
				"register_worker returned {}",
				res.status()
			)));
		}
		Ok(())
	}

	async fn heartbeat(&self, solver_id: &str) -> FillWorkerResult<()> {
		// Hit the worker-scoped heartbeat endpoint, not the operator one.
		// The aggregator creates a worker row idempotently on first
		// register; subsequent heartbeats are no-ops on the DB side until
		// the worker has registered at least once.
		let path = format!("/solver-api/workers/{}/heartbeat", solver_id);
		let url = format!("{}{}", self.base_url, path);
		// An explicit empty JSON body, not a bodyless POST. Without a
		// body reqwest sends no Content-Length, and some fronting proxies
		// (Cloud Run's among them) reject such a POST with 411 before it
		// ever reaches the service.
		let builder = self.client.post(&url).json(&serde_json::json!({}));
		let builder = self.signed("POST", &path, builder).await?;
		let res = builder
			.send()
			.await
			.map_err(|e| FillWorkerError::Http(e.to_string()))?;
		if !res.status().is_success() {
			warn!(
				solver_id = %solver_id,
				status = %res.status(),
				"heartbeat non-2xx"
			);
		}
		Ok(())
	}

	/// Open a signed WebSocket subscription on `/ws/orders`. The
	/// upgrade request carries the same four `x-auth-*` headers as any
	/// other signed call; the aggregator validates them **before**
	/// upgrading so an unauthenticated client cannot tie up a
	/// long-lived socket.
	async fn subscribe_orders(
		&self,
		_solver_id: &str,
	) -> FillWorkerResult<Box<dyn OrderSubscription>> {
		let signer_opt = self.signer.read().unwrap().clone();
		let signer = signer_opt.as_ref().ok_or_else(|| {
			FillWorkerError::Config(
				"subscribe_orders requires a signer; call with_signer() before running".into(),
			)
		})?;

		let path = "/ws/orders";
		let ws_path = format!("{}{}", self.base_url, path);
		// http(s) → ws(s) for the upgrade request.
		let ws_url = ws_path
			.replacen("https://", "wss://", 1)
			.replacen("http://", "ws://", 1);

		let signed = sign_request(signer.as_ref(), "GET", path).await?;

		// Build a tungstenite `Request` so we can attach the four
		// headers before the handshake. `IntoClientRequest` parses the
		// URL and adds the `Host` header for us.
		let mut req: Request = ws_url
			.into_client_request()
			.map_err(|e| FillWorkerError::Http(format!("ws request build: {e}")))?;
		{
			let h = req.headers_mut();
			h.insert(
				"x-solver-id",
				signed
					.solver_id
					.parse()
					.map_err(|e| FillWorkerError::Http(format!("x-solver-id: {e}")))?,
			);
			h.insert(
				"x-auth-timestamp",
				signed
					.timestamp
					.to_string()
					.parse()
					.map_err(|e| FillWorkerError::Http(format!("x-auth-timestamp: {e}")))?,
			);
			h.insert(
				"x-auth-nonce",
				signed
					.nonce
					.parse()
					.map_err(|e| FillWorkerError::Http(format!("x-auth-nonce: {e}")))?,
			);
			h.insert(
				"x-auth-signature",
				signed
					.signature
					.parse()
					.map_err(|e| FillWorkerError::Http(format!("x-auth-signature: {e}")))?,
			);
		}

		// Bounded connect. `connect_async` has no internal timeout, so a
		// stalled TCP/TLS handshake would otherwise hang this future
		// forever — which is exactly how the worker went silently deaf
		// after a dropped socket: it logged "reconnecting" and then
		// awaited a connect that never resolved, while its heartbeat task
		// kept reporting healthy.
		const WS_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
		let (ws_stream, _resp) =
			tokio::time::timeout(WS_CONNECT_TIMEOUT, tokio_tungstenite::connect_async(req))
				.await
				.map_err(|_| {
					FillWorkerError::Http(format!(
						"ws handshake timed out after {}s",
						WS_CONNECT_TIMEOUT.as_secs()
					))
				})?
				.map_err(|e| FillWorkerError::Http(format!("ws handshake: {e}")))?;
		Ok(Box::new(WsOrderSubscription::new(ws_stream)))
	}

	async fn poll_next_order(
		&self,
		_solver_id: &str,
	) -> FillWorkerResult<Option<OrderFillRequest>> {
		// For now we poll the orders endpoint and pick the first non-final
		// order that this operator is expected to fill. In production this
		// becomes a WebSocket subscription.
		let path = "/api/v1/orders".to_string();
		let url = format!("{}{}", self.base_url, path);
		let builder = self.client.get(&url);
		let builder = self.signed("GET", &path, builder).await?;
		let res = builder
			.send()
			.await
			.map_err(|e| FillWorkerError::Http(e.to_string()))?;
		if !res.status().is_success() {
			return Err(FillWorkerError::Http(format!(
				"poll_next_order returned {}",
				res.status()
			)));
		}
		let body: OrderListResponse = res
			.json()
			.await
			.map_err(|e| FillWorkerError::Http(e.to_string()))?;
		Ok(body.data.into_iter().next())
	}

	async fn report_outcome(&self, outcome: &FillOutcome) -> FillWorkerResult<()> {
		// Credit the operator that owns the order, not this worker. The
		// multi-tenant worker settles for every operator on the platform,
		// so its own identity is never the right target here.
		let solver_id = if outcome.solver_id.is_empty() {
			self.current_operator_id()
				.unwrap_or_else(|| "_unknown_".to_string())
		} else {
			outcome.solver_id.clone()
		};
		let path = format!("/solver-api/operators/{}/fills", solver_id);
		let url = format!("{}{}", self.base_url, path);
		let builder = self.client.post(&url).json(outcome);
		let builder = self.signed("POST", &path, builder).await?;
		let res = builder
			.send()
			.await
			.map_err(|e| FillWorkerError::Http(e.to_string()))?;
		if !res.status().is_success() {
			warn!(
				order_id = %outcome.order_id,
				solver_id = %solver_id,
				status = %res.status(),
				"fill outcome report non-2xx"
			);
		}
		Ok(())
	}

	/// Override the default trait impl with the aggregator-backed lookup.
	/// Returns `Err` if `set_operator_id` was never called.
	async fn fetch_settlement_contract(
		&self,
		chain_id: u64,
	) -> FillWorkerResult<Option<String>> {
		let solver_id = self.current_operator_id().ok_or_else(|| {
			FillWorkerError::Config("operator_id not bound to broadcaster".into())
		})?;
		AggregatorBroadcaster::fetch_settlement_contract(self, &solver_id, chain_id).await
	}

	async fn claim_orders(
		&self,
		worker_id: &str,
		limit: usize,
		lease_secs: i64,
	) -> FillWorkerResult<Vec<OrderFillRequest>> {
		#[derive(serde::Deserialize)]
		#[serde(rename_all = "camelCase")]
		struct ClaimedOrder {
			order_id: String,
			solver_id: String,
			signed_order: crate::settlement::SignedOrder,
		}
		#[derive(serde::Deserialize)]
		struct Resp {
			data: Vec<ClaimedOrder>,
		}

		let path = "/solver-api/orders/claim";
		let url = format!("{}{}", self.base_url, path);
		let builder = self.client.post(&url).json(&serde_json::json!({
			"workerId": worker_id,
			"limit": limit,
			"leaseSecs": lease_secs,
		}));
		let builder = self.signed("POST", path, builder).await?;
		let res = builder
			.send()
			.await
			.map_err(|e| FillWorkerError::Http(e.to_string()))?;
		if !res.status().is_success() {
			return Err(FillWorkerError::Http(format!(
				"claim_orders returned {}",
				res.status()
			)));
		}
		let body: Resp = res
			.json()
			.await
			.map_err(|e| FillWorkerError::Http(e.to_string()))?;

		// The claim response is deliberately minimal — everything the
		// settlement engine needs lives inside `signedOrder`, so the flat
		// legacy fields are left empty here.
		Ok(body
			.data
			.into_iter()
			.map(|c| OrderFillRequest {
				order_id: c.order_id,
				intent_id: String::new(),
				solver_id: c.solver_id,
				from_chain: String::new(),
				to_chain: String::new(),
				from_asset: String::new(),
				to_asset: String::new(),
				input_amount: String::new(),
				output_amount: String::new(),
				user_address: String::new(),
				expiry: 0,
				user_signature: String::new(),
				signed_order: Some(c.signed_order),
			})
			.collect())
	}

	async fn extend_claim(
		&self,
		order_id: &str,
		worker_id: &str,
		lease_secs: i64,
	) -> FillWorkerResult<bool> {
		let path = format!("/solver-api/orders/{}/extend-claim", order_id);
		let url = format!("{}{}", self.base_url, path);
		let builder = self.client.post(&url).json(&serde_json::json!({
			"workerId": worker_id,
			"leaseSecs": lease_secs,
		}));
		let builder = self.signed("POST", &path, builder).await?;
		let res = builder
			.send()
			.await
			.map_err(|e| FillWorkerError::Http(e.to_string()))?;
		// 409 = the lease was reassigned; the caller must abandon it.
		Ok(res.status().is_success())
	}

	async fn update_order_status(
		&self,
		order_id: &str,
		status: &str,
		stage: Option<&str>,
		tx_hash: Option<&str>,
		error: Option<&str>,
	) -> FillWorkerResult<()> {
		let path = format!("/solver-api/orders/{}/status", order_id);
		let url = format!("{}{}", self.base_url, path);
		let mut body = serde_json::json!({ "status": status });
		if let Some(s) = stage {
			body["stage"] = serde_json::Value::String(s.into());
		}
		if let Some(t) = tx_hash {
			body["txHash"] = serde_json::Value::String(t.into());
		}
		if let Some(e) = error {
			body["error"] = serde_json::Value::String(e.into());
		}
		let builder = self.client.post(&url).json(&body);
		let builder = self.signed("POST", &path, builder).await?;
		let res = builder
			.send()
			.await
			.map_err(|e| FillWorkerError::Http(e.to_string()))?;
		if !res.status().is_success() {
			warn!(
				order_id = %order_id,
				status = %status,
				http_status = %res.status(),
				"order status report non-2xx"
			);
		}
		Ok(())
	}

	async fn fetch_settlement_contract_for(
		&self,
		solver_id: &str,
		chain_id: u64,
	) -> FillWorkerResult<Option<String>> {
		AggregatorBroadcaster::fetch_settlement_contract(self, solver_id, chain_id).await
	}

	/// Override the default trait impl with the aggregator-backed lookup.
	/// Multi-tenant workers use this per-order since the operator id is
	/// on the incoming `OrderFillRequest`, not on the broadcaster.
	async fn fetch_fill_wallet_address(
		&self,
		solver_id: &str,
	) -> FillWorkerResult<Option<String>> {
		AggregatorBroadcaster::fetch_fill_wallet_address(self, solver_id).await
	}

	/// Sign an EIP-1559 fill for `req` and broadcast via the chain RPC.
	///
	/// Behaviour:
	/// - **chain_rpc present**: builds an EIP-1559 tx, signs it with the
	///   `signer`, RLP-encodes the envelope, and submits via
	///   `eth_sendRawTransaction`. Returns the on-chain tx hash.
	/// - **chain_rpc absent** (no `CHAIN_RPCS` set): falls back to a
	///   deterministic placeholder so the rest of the order loop can be
	///   exercised end-to-end without burning real RPC calls.
	async fn broadcast_fill(
		&self,
		req: &FillRequest,
		signer: &dyn OrderSigner,
	) -> FillWorkerResult<String> {
		match self.chain_rpc.as_ref() {
			Some(rpc) => {
				let tx_hash = sign_and_broadcast_fill(rpc.clone(), signer, req).await?;
				Ok(format!("0x{tx_hash}"))
			},
			None => {
				warn!(
					order_id = %req.order.order_id,
					"no chain RPC configured — returning placeholder fill hash"
				);
				Ok(format!(
					"0xstub_{}_{}",
					req.order.order_id,
					req.user_signature
						.iter()
						.take(8)
						.map(|b| format!("{b:02x}"))
						.collect::<String>()
				))
			},
		}
	}

	fn aggregator_base_url(&self) -> &str {
		&self.base_url
	}

	async fn sign_request(
		&self,
		method: &str,
		path: &str,
		builder: reqwest::RequestBuilder,
	) -> FillWorkerResult<reqwest::RequestBuilder> {
		// The `x-auth-*` envelope below identifies *which* worker is
		// asking, but the aggregator's auth middleware does not accept it
		// as a credential — it only understands the public prefixes, the
		// first-party `x-worker-token`, a bearer JWT and `x-api-key`. Sent
		// alone, a `/sign-fill` request is therefore rejected as
		// unauthenticated and every settlement fails with a 401.
		//
		// So attach the worker token here exactly as `signed()` does for
		// claim/heartbeat/status. That is the credential the aggregator
		// recognises, and `ensure_operator_scope` deliberately lets it act
		// for any operator — which is what a multi-tenant worker needs.
		let builder = match self.worker_token.as_deref() {
			Some(token) => builder.header("x-worker-token", token),
			None => builder,
		};

		let signer_opt = self.signer.read().unwrap().clone();
		let signer = signer_opt.as_ref().ok_or_else(|| {
			FillWorkerError::Config(
				"sign_request requires a signer bound to the broadcaster".into(),
			)
		})?;
		let h = crate::auth::sign_request(signer.as_ref(), method, path)
			.await
			.map_err(|e| FillWorkerError::Http(e.to_string()))?;
		Ok(apply_signed_headers(builder, &h))
	}
}

/// WebSocket-backed [`OrderSubscription`] returned by
/// [`AggregatorBroadcaster::subscribe_orders`].
///
/// Wire format (text frames):
/// - `{"status":"connected", "solver_id": "…", "message": "…"}` — hello
///   frame, sent once after the handshake.
/// - `{"status":"order", "order": {…}}` — a real order envelope.
///   The inner `order` payload is deserialized as `OrderFillRequest`.
/// - `{"status":"lagged", "dropped": N}` — surfaced when the
///   aggregator's broadcast channel overflowed; we just keep going.
/// - Any other JSON shape is ignored (forward-compat for new envelope
///   kinds).
pub struct WsOrderSubscription<S = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>>
where
	S: futures_util::Stream<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
		+ futures_util::Sink<WsMessage, Error = tokio_tungstenite::tungstenite::Error>
		+ Unpin
		+ Send
		+ 'static,
{
	stream: S,
	/// Running total of aggregator-reported `Lagged` heartbeat drops.
	/// Surfaced via [`OrderSubscription::lagged_count`].
	lagged_total: u64,
}

impl<S> WsOrderSubscription<S>
where
	S: futures_util::Stream<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
		+ futures_util::Sink<WsMessage, Error = tokio_tungstenite::tungstenite::Error>
		+ Unpin
		+ Send
		+ 'static,
{
	pub fn new(stream: S) -> Self {
		Self {
			stream,
			lagged_total: 0,
		}
	}
}

#[async_trait]
impl<S> OrderSubscription for WsOrderSubscription<S>
where
	S: futures_util::Stream<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
		+ futures_util::Sink<WsMessage, Error = tokio_tungstenite::tungstenite::Error>
		+ Unpin
		+ Send
		+ 'static,
{
	async fn next_event(&mut self) -> FillWorkerResult<OrderEvent> {
		loop {
			match self.stream.next().await {
				Some(Ok(WsMessage::Text(text))) => {
					let envelope: serde_json::Value = match serde_json::from_str(&text) {
						Ok(v) => v,
						Err(e) => {
							warn!(error = %e, "ws_orders: skipping malformed JSON frame");
							continue;
						}
					};
					// Dispatch on the `status` field so the orchestrator
					// can react to Lagged heartbeats (e.g. by deciding to
					// reconnect when the running drop count crosses a
					// threshold).
					let status = envelope.get("status").and_then(|v| v.as_str());
					match status {
						Some("order") => {
							let payload = match envelope.get("order") {
								Some(p) => p,
								None => {
									warn!("ws_orders: order frame missing 'order' field");
									continue;
								}
							};
							match serde_json::from_value::<OrderFillRequest>(payload.clone()) {
								Ok(req) => return Ok(OrderEvent::Order(req)),
								Err(e) => {
									warn!(error = %e, "ws_orders: failed to parse OrderFillRequest");
									continue;
								}
							}
						}
						Some("lagged") => {
							let dropped = envelope
								.get("dropped")
								.and_then(|v| v.as_u64())
								.unwrap_or(0);
							self.lagged_total = self.lagged_total.saturating_add(dropped);
							warn!(
								dropped,
								lagged_total = self.lagged_total,
								"ws_orders: subscriber lagged"
							);
							return Ok(OrderEvent::Lagged(dropped));
						}
						Some("connected") => {
							// Hello frame — ignore and pull the next.
							continue;
						}
						_ => {
							// Unknown status — log and skip (forward-compat).
							warn!(?envelope, "ws_orders: unknown frame status");
							continue;
						}
					}
				}
				Some(Ok(WsMessage::Ping(payload))) => {
					// Reply to ping with a pong so the connection stays
					// healthy through idle periods.
					if let Err(e) = self.stream.send(WsMessage::Pong(payload)).await {
						warn!(error = %e, "ws_orders: failed to send pong");
					}
				}
				Some(Ok(WsMessage::Close(_))) => {
					return Ok(OrderEvent::Closed);
				}
				Some(Err(e)) => {
					return Err(FillWorkerError::Http(format!("ws read: {e}")));
				}
				None => {
					// Stream closed without an explicit Close frame.
					return Ok(OrderEvent::Closed);
				}
				_ => {
					// Binary frames are not part of the protocol; skip.
					continue;
				}
			}
		}
	}

	fn lagged_count(&self) -> u64 {
		self.lagged_total
	}
}
