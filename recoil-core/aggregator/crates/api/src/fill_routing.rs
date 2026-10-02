//! Fill-worker routing — looks up the operator that published the winning
//! quote and forwards the signed order to their fill-worker URL.
//!
//! This is the bridge that makes push-quotes actually execute: without it the
//! aggregator accepts an order, records it as `Created`, and waits forever
//! because there is no live solver binary to pick it up. With it, the order
//! reaches the operator's fill-worker, which signs + broadcasts the fill on
//! the destination chain.

use chrono::Utc;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::{info, warn};

use oif_types::storage::OperatorStorageTrait;
use oif_types::OrderRequest;

/// Errors from the fill-routing layer.
#[derive(Debug, thiserror::Error)]
pub enum FillRoutingError {
	#[error("operator not found for quote: {0}")]
	OperatorNotFound(String),
	#[error("operator has no fill-worker URL registered: {0}")]
	NoFillWorkerUrl(String),
	#[error("fill-worker request failed: {0}")]
	Upstream(String),
}

/// Request body sent to the operator's fill-worker.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FillDispatch {
	pub order_id: String,
	pub quote_id: String,
	pub solver_id: String,
	pub from_chain: String,
	pub to_chain: String,
	pub from_asset: String,
	pub to_asset: String,
	pub input_amount: String,
	pub output_amount: String,
	pub user_address: String,
	pub expiry: u64,
	pub user_signature: String,
}

/// Response expected from the operator's fill-worker.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillDispatchResponse {
	pub accepted: bool,
	#[serde(default)]
	pub tx_hash: Option<String>,
	#[serde(default)]
	pub error: Option<String>,
}

/// The fill-router — looks up operators and forwards orders to their
/// fill-workers. Constructed cheaply; holds a shared HTTP client.
#[derive(Clone)]
pub struct FillRouter {
	client: Client,
}

impl FillRouter {
	pub fn new() -> Self {
		let client = Client::builder()
			.timeout(Duration::from_secs(5))
			.build()
			.expect("failed to build HTTP client for FillRouter");
		Self { client }
	}

	/// Resolve the operator for the given quote (by `solver_id`) and POST the
	/// order to their fill-worker URL. Returns the dispatch response.
	pub async fn dispatch(
		&self,
		storage: &dyn OperatorStorageTrait,
		order_request: &OrderRequest,
		order_id: &str,
	) -> Result<FillDispatchResponse, FillRoutingError> {
		// The order carries the quote_id; the operator id is recoverable by
		// looking up the quote in storage. For simplicity in the MVP, the
		// dashboard includes `solverId` in the OrderRequest so we use that
		// directly.
		let solver_id = order_request
			.quote_response
			.provider
			.clone()
			.ok_or_else(|| FillRoutingError::OperatorNotFound(order_request.quote_response.quote_id.clone()))?;

		let operator = storage
			.get_operator(&solver_id)
			.await
			.map_err(|e| FillRoutingError::Upstream(e.to_string()))?
			.ok_or_else(|| FillRoutingError::OperatorNotFound(solver_id.clone()))?;

		let worker_url = operator
			.fill_worker_url
			.clone()
			.ok_or_else(|| FillRoutingError::NoFillWorkerUrl(solver_id.clone()))?;

		let dispatch = FillDispatch {
			order_id: order_id.to_string(),
			quote_id: order_request.quote_response.quote_id.clone(),
			solver_id,
			from_chain: order_request
				.quote_response
				.preview
				.inputs
				.first()
				.map(|i| i.asset.to_string())
				.unwrap_or_default(),
			to_chain: order_request
				.quote_response
				.preview
				.outputs
				.first()
				.map(|o| o.asset.to_string())
				.unwrap_or_default(),
			from_asset: order_request
				.quote_response
				.preview
				.inputs
				.first()
				.map(|i| i.asset.to_string())
				.unwrap_or_default(),
			to_asset: order_request
				.quote_response
				.preview
				.outputs
				.first()
				.map(|o| o.asset.to_string())
				.unwrap_or_default(),
			input_amount: order_request
				.quote_response
				.preview
				.inputs
				.first()
				.and_then(|i| i.amount.as_ref().map(|a| a.to_string()))
				.unwrap_or_default(),
			output_amount: order_request
				.quote_response
				.preview
				.outputs
				.first()
				.and_then(|o| o.amount.as_ref().map(|a| a.to_string()))
				.unwrap_or_default(),
			user_address: order_request
				.quote_response
				.preview
				.inputs
				.first()
				.map(|i| i.user.to_string())
				.unwrap_or_default(),
			expiry: order_request.quote_response.valid_until.unwrap_or(0),
			user_signature: order_request.signature.clone(),
		};

		let endpoint = format!("{}/fill", worker_url.trim_end_matches('/'));
		info!(
			order_id = %order_id,
			solver_id = %dispatch.solver_id,
			endpoint = %endpoint,
			"dispatching order to fill-worker"
		);

		let res = self
			.client
			.post(&endpoint)
			.json(&dispatch)
			.send()
			.await
			.map_err(|e| FillRoutingError::Upstream(e.to_string()))?;

		if !res.status().is_success() {
			let status = res.status();
			let body = res.text().await.unwrap_or_default();
			warn!(
				order_id = %order_id,
				status = %status,
				body = %body,
				"fill-worker returned non-2xx"
			);
			return Err(FillRoutingError::Upstream(format!(
				"fill-worker returned {status}: {body}"
			)));
		}

		let body: FillDispatchResponse = res
			.json()
			.await
			.map_err(|e| FillRoutingError::Upstream(e.to_string()))?;

		info!(
			order_id = %order_id,
			accepted = body.accepted,
			tx_hash = ?body.tx_hash,
			"fill-worker accepted order"
		);
		Ok(body)
	}
}

impl Default for FillRouter {
	fn default() -> Self {
		Self::new()
	}
}

#[allow(dead_code)]
fn _ts() -> i64 {
	Utc::now().timestamp()
}