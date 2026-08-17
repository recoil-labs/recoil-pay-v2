//! Worker handlers — endpoints that let multi-tenant fill-workers
//! register themselves and heartbeat the aggregator.
//!
//! These power the fill-worker's lifecycle on the multi-tenant
//! platform:
//! - `POST /solver-api/workers/{id}`               → register worker URL
//! - `POST /solver-api/workers/{id}/heartbeat`     → liveness ping
//!
//! Workers are **distinct from operators**: a single worker fleet
//! fills orders for every operator on the platform. They get their
//! own table and endpoints so the aggregator doesn't conflate them
//! with operator accounts (which are registered via the dashboard
//! and have encrypted fill-wallet keys attached).

use axum::{
	extract::{Path, State},
	http::StatusCode,
	response::Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::handlers::common::ErrorResponse;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterWorkerRequest {
	pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterWorkerResponse {
	pub worker_id: String,
	pub registered_at: String,
}

/// POST /solver-api/workers/{id}
///
/// Idempotent worker registration. The worker calls this once on
/// boot (and again whenever its self-reported `FILL_WORKER_URL`
/// changes) so the aggregator knows where to forward orders.
///
/// Unlike operator registration, this endpoint does not require the
/// worker to have a pre-existing row — the upsert creates it on
/// first call. This is intentional: workers are deployed by us, not
/// registered by a human, so there's no chance of a typo'd `id`
/// silently creating a stray row.
pub async fn register_worker(
	State(state): State<AppState>,
	Path(worker_id): Path<String>,
	Json(payload): Json<RegisterWorkerRequest>,
) -> Result<Json<RegisterWorkerResponse>, (StatusCode, Json<ErrorResponse>)> {
	let url = payload.url.trim();
	if url.is_empty() {
		return Err((
			StatusCode::BAD_REQUEST,
			Json(ErrorResponse {
				error: "INVALID_URL".into(),
				message: "worker url cannot be empty".into(),
				timestamp: Utc::now().timestamp(),
			}),
		));
	}

	state
		.storage
		.register_worker(&worker_id, url)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;

	info!(
		worker_id = %worker_id,
		url = %url,
		"worker registered"
	);
	Ok(Json(RegisterWorkerResponse {
		worker_id: worker_id.clone(),
		registered_at: Utc::now().to_rfc3339(),
	}))
}

/// POST /solver-api/workers/{id}/heartbeat
///
/// Liveness ping from a running worker. No-op when the worker
/// hasn't registered yet (the next register call sets
/// `last_active_at` to now).
pub async fn worker_heartbeat(
	State(state): State<AppState>,
	Path(worker_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
	state
		.storage
		.worker_heartbeat(&worker_id)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;
	Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetWorkerResponse {
	pub worker_id: String,
	pub public_url: Option<String>,
	pub last_active_at: Option<String>,
}

/// GET /solver-api/workers/{id}
///
/// Diagnostic endpoint for the dashboard. Returns the worker's
/// self-reported URL and last heartbeat timestamp, or `null` for
/// the URL if the worker has never registered.
pub async fn get_worker(
	State(state): State<AppState>,
	Path(worker_id): Path<String>,
) -> Result<Json<GetWorkerResponse>, (StatusCode, Json<ErrorResponse>)> {
	let url = state
		.storage
		.get_worker(&worker_id)
		.await
		.map_err(|e| {
			warn!(error = %e, worker_id = %worker_id, "get_worker storage error");
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".into(),
					message: e.to_string(),
					timestamp: Utc::now().timestamp(),
				}),
			)
		})?;
	Ok(Json(GetWorkerResponse {
		worker_id,
		public_url: url,
		// last_active_at is currently stored alongside public_url in the
		// memory store; we don't surface it from postgres yet because
		// it would require a column read. The heartbeat endpoint is the
		// source of truth for liveness tracking.
		last_active_at: None,
	}))
}
