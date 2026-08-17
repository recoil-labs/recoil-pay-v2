//! Order handlers
use axum::{
	extract::{Path, State},
	http::StatusCode,
	response::Json,
};
use tracing::debug;

use crate::handlers::common::ErrorResponse;
use crate::state::AppState;
use oif_types::{OrderRequest, OrderResponse};

/// Submit a new order
#[cfg_attr(feature = "openapi", utoipa::path(
    post,
    path = "/api/v1/orders",
    request_body = OrderRequest,
    responses(
        (status = 200, description = "Order created", body = OrderResponse),
        (status = 400, description = "Invalid request", body = ErrorResponse),
        (status = 404, description = "Quote not found", body = ErrorResponse),
        (status = 500, description = "Internal error", body = ErrorResponse)
    ),
    tag = "orders"
))]
/// POST /api/v1/orders - Submit an order
pub async fn post_orders(
	State(state): State<AppState>,
	Json(request): Json<OrderRequest>,
) -> Result<Json<OrderResponse>, (StatusCode, Json<ErrorResponse>)> {
	debug!(
		"Received order submission for quote {}",
		request.quote_response.quote_id
	);

	let order: oif_types::Order = match state.order_service.submit_order(&request).await {
		Ok(order) => order,
		Err(e) => {
			return Err(match e {
				oif_service::OrderServiceError::Validation(msg) => (
					StatusCode::BAD_REQUEST,
					Json(ErrorResponse {
						error: "VALIDATION_ERROR".to_string(),
						message: msg,
						timestamp: chrono::Utc::now().timestamp(),
					}),
				),
				oif_service::OrderServiceError::QuoteNotFound(q) => (
					StatusCode::NOT_FOUND,
					Json(ErrorResponse {
						error: "QUOTE_NOT_FOUND".to_string(),
						message: format!("Quote {} not found", q),
						timestamp: chrono::Utc::now().timestamp(),
					}),
				),
				oif_service::OrderServiceError::QuoteExpired(q) => (
					StatusCode::BAD_REQUEST,
					Json(ErrorResponse {
						error: "QUOTE_EXPIRED".to_string(),
						message: format!("Quote {} has expired", q),
						timestamp: chrono::Utc::now().timestamp(),
					}),
				),
				oif_service::OrderServiceError::Storage(msg) => (
					StatusCode::INTERNAL_SERVER_ERROR,
					Json(ErrorResponse {
						error: "STORAGE_ERROR".to_string(),
						message: msg,
						timestamp: chrono::Utc::now().timestamp(),
					}),
				),
				oif_service::OrderServiceError::SolverAdapter(e) => (
					StatusCode::BAD_GATEWAY,
					Json(ErrorResponse {
						error: "SOLVER_ADAPTER_ERROR".to_string(),
						message: e.to_string(),
						timestamp: chrono::Utc::now().timestamp(),
					}),
				),
				_ => (
					StatusCode::INTERNAL_SERVER_ERROR,
					Json(ErrorResponse {
						error: "INTERNAL_ERROR".to_string(),
						message: format!("Failed to submit order: {}", e),
						timestamp: chrono::Utc::now().timestamp(),
					}),
				),
			})
		},
	};

	let response = match OrderResponse::try_from(&order) {
		Ok(resp) => resp,
		Err(e) => {
			return Err((
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "CONVERSION_ERROR".to_string(),
					message: format!("Failed to convert order: {}", e),
					timestamp: chrono::Utc::now().timestamp(),
				}),
			))
		},
	};

	debug!("Created order {}", order.order_id);

	// Best-effort: dispatch the order to the operator's fill-worker. We don't
	// fail the HTTP response if dispatch fails — the order is recorded and the
	// operator can pick it up via the polling endpoint. We only log.
	let router = crate::fill_routing::FillRouter::new();
	match router.dispatch(&*state.storage, &request, &order.order_id).await {
		Ok(_) => tracing::info!(order_id = %order.order_id, "order dispatched to fill-worker"),
		Err(e) => tracing::warn!(order_id = %order.order_id, error = %e, "fill dispatch deferred"),
	}

	// Push the order on the in-memory broadcaster so any fill-workers
	// connected to `/ws/orders` see it in real time. This replaces the
	// previous `poll_next_order` loop — workers no longer need to hammer
	// `/api/v1/orders` every few seconds. The raw `OrderResponse`
	// payload is published, augmented with the underlying `solver_id`
	// so the multi-tenant fill-worker knows which operator's encrypted
	// fill-wallet key to ask the aggregator to sign with.
	// The WS handler wraps this in a `{ "status": "order", "order": … }`
	// envelope on the wire.
	match serde_json::to_value(&response) {
		Ok(mut payload) => {
			// Merge the `solver_id` into the broadcast payload. We do
			// this rather than adding it to `OrderResponse` because the
			// response is the user-facing API surface and exposing the
			// internal `solver_id` there would be confusing for the
			// order's submitter.
			if let serde_json::Value::Object(ref mut map) = payload {
				map.insert(
					"solverId".into(),
					serde_json::Value::String(order.solver_id.clone()),
				);
				// The fill-worker needs the complete signed order to
				// execute settlement on-chain: the Permit2 payload the
				// user signed (`openFor` input), the scheme-prefixed
				// signature, and the quote's settlement addresses.
				map.insert(
					"signedOrder".into(),
					serde_json::json!({
						"quoteId": request.quote_response.quote_id,
						"order": request.quote_response.order,
						"signature": request.signature,
						"settlement": request
							.quote_response
							.metadata
							.as_ref()
							.and_then(|m| m.get("settlement"))
							.cloned()
							.unwrap_or(serde_json::Value::Null),
					}),
				);
			}
			let n = state.order_broadcaster.publish(payload);
			tracing::debug!(
				order_id = %order.order_id,
				solver_id = %order.solver_id,
				subscribers = n,
				"order pushed to /ws/orders subscribers"
			);
		}
		Err(e) => tracing::warn!(
			order_id = %order.order_id,
			error = %e,
			"failed to serialize order for /ws/orders broadcast"
		),
	}

	Ok(Json(response))
}

/// Get order status by ID
#[cfg_attr(feature = "openapi", utoipa::path(
    get,
    path = "/api/v1/orders/{id}",
    params(("id" = String, Path, description = "Order ID")),
    responses(
        (status = 200, description = "Order details", body = OrderResponse),
        (status = 404, description = "Order not found", body = ErrorResponse),
        (status = 500, description = "Internal error", body = ErrorResponse)
    ),
    tag = "orders"
))]
/// GET /api/v1/orders/:id - Get order details by ID
pub async fn get_order(
	State(state): State<AppState>,
	Path(order_id): Path<String>,
) -> Result<Json<OrderResponse>, (StatusCode, Json<ErrorResponse>)> {
	debug!("Querying status for order {}", order_id);

	let order = match state.order_service.refresh_order(&order_id).await {
		Ok(Some(order)) => order,
		Ok(None) => {
			return Err((
				StatusCode::NOT_FOUND,
				Json(ErrorResponse {
					error: "ORDER_NOT_FOUND".to_string(),
					message: format!("Order {} not found", order_id),
					timestamp: chrono::Utc::now().timestamp(),
				}),
			))
		},
		Err(e) => {
			return Err(match e {
				oif_service::OrderServiceError::Storage(msg) => (
					StatusCode::INTERNAL_SERVER_ERROR,
					Json(ErrorResponse {
						error: "STORAGE_ERROR".to_string(),
						message: msg,
						timestamp: chrono::Utc::now().timestamp(),
					}),
				),
				oif_service::OrderServiceError::SolverAdapter(e) => (
					StatusCode::BAD_GATEWAY,
					Json(ErrorResponse {
						error: "SOLVER_ADAPTER_ERROR".to_string(),
						message: e.to_string(),
						timestamp: chrono::Utc::now().timestamp(),
					}),
				),
				_ => (
					StatusCode::INTERNAL_SERVER_ERROR,
					Json(ErrorResponse {
						error: "INTERNAL_ERROR".to_string(),
						message: format!("Failed to retrieve order: {}", e),
						timestamp: chrono::Utc::now().timestamp(),
					}),
				),
			})
		},
	};

	let response = match OrderResponse::try_from(&order) {
		Ok(resp) => resp,
		Err(e) => {
			return Err((
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "CONVERSION_ERROR".to_string(),
					message: format!("Failed to convert order: {}", e),
					timestamp: chrono::Utc::now().timestamp(),
				}),
			))
		},
	};

	debug!("Retrieved order {}", order.order_id);
	Ok(Json(response))
}

// ─── Worker-reported settlement status ───────────────────────────────────────
//
// The multi-tenant fill-worker executes the escrow settlement in three
// on-chain steps (openFor → fill → finalise) and reports each transition
// here so the order's status + tx hashes stay observable by the user (V2
// polls `GET /api/v1/orders/{id}`) and the operator dashboard.

use oif_types::oif::common::{OrderStatus, TransactionType};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderStatusUpdateRequest {
	/// Target status: `created | pending | executing | executed | settling
	/// | settled | finalized | refunded | failed`.
	pub status: String,
	/// Settlement stage the update refers to: `prepare | fill | claim`
	/// (plus `postFill` / `preClaim`). Required when `status = failed`;
	/// used as the tx-hash key otherwise.
	#[serde(default)]
	pub stage: Option<String>,
	/// On-chain transaction hash for this stage, if one was broadcast.
	#[serde(default)]
	pub tx_hash: Option<String>,
	/// Failure description when `status = failed`.
	#[serde(default)]
	pub error: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderStatusUpdateResponse {
	pub order_id: String,
	pub status: OrderStatus,
}

fn parse_stage(stage: Option<&str>) -> TransactionType {
	match stage.unwrap_or("fill") {
		"prepare" => TransactionType::Prepare,
		"postFill" | "post_fill" => TransactionType::PostFill,
		"preClaim" | "pre_claim" => TransactionType::PreClaim,
		"claim" => TransactionType::Claim,
		_ => TransactionType::Fill,
	}
}

fn parse_status(req: &OrderStatusUpdateRequest) -> Option<OrderStatus> {
	Some(match req.status.as_str() {
		"created" => OrderStatus::Created,
		"pending" => OrderStatus::Pending,
		"executing" => OrderStatus::Executing,
		"executed" => OrderStatus::Executed,
		"settling" => OrderStatus::Settling,
		"settled" => OrderStatus::Settled,
		"finalized" => OrderStatus::Finalized,
		"refunded" => OrderStatus::Refunded,
		"failed" => OrderStatus::Failed(
			parse_stage(req.stage.as_deref()),
			req.error.clone().unwrap_or_else(|| "unspecified".into()),
		),
		_ => return None,
	})
}

/// POST /solver-api/orders/{id}/status — fill-worker settlement updates.
///
/// Authenticated via the shared `x-worker-token` (see the auth
/// middleware); terminal orders reject further updates with 409.
pub async fn update_order_status(
	State(state): State<AppState>,
	Path(order_id): Path<String>,
	Json(payload): Json<OrderStatusUpdateRequest>,
) -> Result<Json<OrderStatusUpdateResponse>, (StatusCode, Json<ErrorResponse>)> {
	let new_status = parse_status(&payload).ok_or_else(|| {
		(
			StatusCode::BAD_REQUEST,
			Json(ErrorResponse {
				error: "INVALID_STATUS".into(),
				message: format!("unknown status '{}'", payload.status),
				timestamp: chrono::Utc::now().timestamp(),
			}),
		)
	})?;

	let mut order = state
		.storage
		.get_order(&order_id)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: chrono::Utc::now().timestamp(),
				}),
			)
		})?
		.ok_or_else(|| {
			(
				StatusCode::NOT_FOUND,
				Json(ErrorResponse {
					error: "NOT_FOUND".into(),
					message: format!("order {order_id} not found"),
					timestamp: chrono::Utc::now().timestamp(),
				}),
			)
		})?;

	// Terminal orders are immutable.
	if matches!(
		order.order.status(),
		OrderStatus::Finalized | OrderStatus::Failed(_, _) | OrderStatus::Refunded
	) {
		return Err((
			StatusCode::CONFLICT,
			Json(ErrorResponse {
				error: "ORDER_TERMINAL".into(),
				message: format!(
					"order {order_id} is already {:?} and cannot transition",
					order.order.status()
				),
				timestamp: chrono::Utc::now().timestamp(),
			}),
		));
	}

	if let Some(tx_hash) = payload.tx_hash.as_deref() {
		order
			.order
			.record_stage_tx(payload.stage.as_deref().unwrap_or("fill"), tx_hash);
	}
	order.order.set_status(new_status.clone());

	state.storage.update_order(order).await.map_err(|e| {
		(
			StatusCode::INTERNAL_SERVER_ERROR,
			Json(ErrorResponse {
				error: "STORAGE_ERROR".into(),
				message: e.to_string(),
				timestamp: chrono::Utc::now().timestamp(),
			}),
		)
	})?;

	tracing::info!(
		order_id = %order_id,
		status = %payload.status,
		stage = payload.stage.as_deref().unwrap_or(""),
		tx_hash = payload.tx_hash.as_deref().unwrap_or(""),
		"order settlement status updated by fill-worker"
	);

	Ok(Json(OrderStatusUpdateResponse {
		order_id,
		status: new_status,
	}))
}

#[cfg(test)]
mod status_tests {
	use super::*;

	fn req(status: &str, stage: Option<&str>, error: Option<&str>) -> OrderStatusUpdateRequest {
		OrderStatusUpdateRequest {
			status: status.into(),
			stage: stage.map(String::from),
			tx_hash: None,
			error: error.map(String::from),
		}
	}

	#[test]
	fn parses_lifecycle_statuses() {
		assert!(matches!(
			parse_status(&req("pending", None, None)),
			Some(OrderStatus::Pending)
		));
		assert!(matches!(
			parse_status(&req("finalized", None, None)),
			Some(OrderStatus::Finalized)
		));
		assert!(parse_status(&req("bogus", None, None)).is_none());
	}

	#[test]
	fn failed_carries_stage_and_message() {
		match parse_status(&req("failed", Some("prepare"), Some("escrow revert"))) {
			Some(OrderStatus::Failed(TransactionType::Prepare, msg)) => {
				assert_eq!(msg, "escrow revert")
			},
			other => panic!("unexpected: {other:?}"),
		}
	}
}

// ─── Durable claim queue ─────────────────────────────────────────────────────
//
// The `/ws/orders` broadcast is fire-and-forget: an order published while
// no worker is subscribed is gone. Workers therefore CLAIM work out of
// the orders table instead, which survives disconnects and restarts on
// both sides. The socket remains as a latency optimisation — it tells a
// worker to claim *now* rather than on its next poll tick.

/// How long a claim is held before it lapses and the order returns to the
/// pool. Settlement spans three on-chain transactions with receipt waits,
/// so this is generous; workers extend it as they make progress.
const DEFAULT_CLAIM_LEASE_SECS: i64 = 300;
/// Stop redelivering an order that keeps failing its handler.
const MAX_CLAIM_ATTEMPTS: i32 = 5;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimOrdersRequest {
	/// Identifies the claiming worker, so a lease can be scoped to its
	/// holder and expired leases attributed.
	pub worker_id: String,
	#[serde(default)]
	pub limit: Option<usize>,
	#[serde(default)]
	pub lease_secs: Option<i64>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedOrder {
	pub order_id: String,
	pub solver_id: String,
	/// Same shape the WS feed publishes, so the worker's settlement
	/// engine consumes claimed and pushed orders through one code path.
	pub signed_order: serde_json::Value,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimOrdersResponse {
	pub data: Vec<ClaimedOrder>,
	pub lease_expires_in_secs: i64,
}

/// Rebuild the `signedOrder` block from the persisted order. Everything
/// needed is already stored: the quote carries the Permit2 payload the
/// user signed, and the order carries their signature.
fn signed_order_payload(order: &oif_types::Order) -> Option<serde_json::Value> {
	let quote = order.quote_details.as_ref()?;
	let signature = order.signature.as_ref()?;
	Some(serde_json::json!({
		"quoteId": quote.quote_id,
		"order": quote.quote.order(),
		"signature": signature,
		"settlement": quote.quote.metadata()
			.and_then(|m| m.get("settlement"))
			.cloned()
			.unwrap_or(serde_json::Value::Null),
	}))
}

/// POST /solver-api/orders/claim — lease pending orders to a worker.
///
/// Authenticated by the shared worker token. Returns only orders that
/// carry a signature and quote (anything else can never be settled, so
/// handing it out would just burn attempts).
pub async fn claim_orders(
	State(state): State<AppState>,
	Json(payload): Json<ClaimOrdersRequest>,
) -> Result<Json<ClaimOrdersResponse>, (StatusCode, Json<ErrorResponse>)> {
	let limit = payload.limit.unwrap_or(5).clamp(1, 50);
	let lease_secs = payload
		.lease_secs
		.unwrap_or(DEFAULT_CLAIM_LEASE_SECS)
		.clamp(30, 3600);

	let orders = state
		.storage
		.claim_orders(&payload.worker_id, limit, lease_secs, MAX_CLAIM_ATTEMPTS)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: chrono::Utc::now().timestamp(),
				}),
			)
		})?;

	let mut data = Vec::with_capacity(orders.len());
	for order in orders {
		match signed_order_payload(&order) {
			Some(signed_order) => data.push(ClaimedOrder {
				order_id: order.order_id.clone(),
				solver_id: order.solver_id.clone(),
				signed_order,
			}),
			None => {
				// Unsettleable — release rather than hold a lease on it.
				tracing::warn!(
					order_id = %order.order_id,
					"claimed order has no signature/quote; releasing"
				);
				let _ = state.storage.release_claim(&order.order_id).await;
			},
		}
	}

	if !data.is_empty() {
		tracing::info!(
			worker_id = %payload.worker_id,
			count = data.len(),
			"orders claimed"
		);
	}

	Ok(Json(ClaimOrdersResponse {
		data,
		lease_expires_in_secs: lease_secs,
	}))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtendClaimRequest {
	pub worker_id: String,
	#[serde(default)]
	pub lease_secs: Option<i64>,
}

/// POST /solver-api/orders/{id}/extend-claim — keep a lease alive while a
/// long settlement is still progressing.
pub async fn extend_order_claim(
	State(state): State<AppState>,
	Path(order_id): Path<String>,
	Json(payload): Json<ExtendClaimRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
	let lease_secs = payload
		.lease_secs
		.unwrap_or(DEFAULT_CLAIM_LEASE_SECS)
		.clamp(30, 3600);
	let extended = state
		.storage
		.extend_claim(&order_id, &payload.worker_id, lease_secs)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: chrono::Utc::now().timestamp(),
				}),
			)
		})?;
	// 409 when the lease has already been reassigned — the worker should
	// stop working on it rather than race the new holder.
	Ok(if extended {
		StatusCode::NO_CONTENT
	} else {
		StatusCode::CONFLICT
	})
}
