//! HTTP server for the fill-worker.
//!
//! Exposes the local control plane used by the dashboard to install and rotate
//! the worker's signing identity. The server is intentionally small — just
//! the four endpoints the dashboard needs to manage the worker:
//!
//! - `GET  /health`   — liveness; always 200 if the process is up.
//! - `GET  /readyz`   — readiness; 200 iff an identity is loaded AND the last
//!                       aggregator handshake succeeded.
//! - `GET  /identity` — read-only snapshot of the current identity (no key).
//! - `PUT  /identity` — install or replace the identity. Persisted to disk
//!                       and the signer is hot-swapped.
//! - `DELETE /identity` — wipe the identity; the worker stops signing fills.
//!
//! The server binds to whatever `FILL_WORKER_URL` resolves to (default
//! `0.0.0.0:8080`). On Render this port is **not** publicly exposed — the
//! service is a `pserv` (private), so only other Render services in the
//! same region can reach it.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
	extract::State,
	http::StatusCode,
	response::{IntoResponse, Json, Response},
	routing::get,
	Router,
};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::identity_store::{IdentityStatus, IdentityStore, IdentityStoreError};

/// Shared state passed to every handler. Cheap to clone (`Arc`).
#[derive(Clone)]
struct AppState {
	store: Arc<IdentityStore>,
}

/// Build the axum router. Caller is responsible for binding to a TcpListener.
pub fn router(store: Arc<IdentityStore>) -> Router {
	Router::new()
		.route("/health", get(health))
		.route("/readyz", get(readyz))
		.route("/identity", get(get_identity).put(put_identity).delete(delete_identity))
		.with_state(AppState { store })
}

/// Start the server on the given address and run until the process exits.
pub async fn serve(store: Arc<IdentityStore>, addr: SocketAddr) -> Result<(), std::io::Error> {
	let app = router(store.clone());
	info!(%addr, "fill-worker HTTP API listening");
	let listener = tokio::net::TcpListener::bind(addr).await?;
	axum::serve(listener, app).await
}

// --- handlers ---

async fn health() -> &'static str {
	"ok"
}

async fn readyz(State(state): State<AppState>) -> Response {
	let status = state.store.status().await;
	if status.loaded && status.last_register_error.is_none() {
		(StatusCode::OK, Json(status)).into_response()
	} else {
		(StatusCode::SERVICE_UNAVAILABLE, Json(status)).into_response()
	}
}

async fn get_identity(State(state): State<AppState>) -> Json<IdentityStatus> {
	Json(state.store.status().await)
}

#[derive(Debug, Deserialize)]
struct PutIdentityRequest {
	solver_id: String,
	private_key: String,
}

async fn put_identity(
	State(state): State<AppState>,
	Json(req): Json<PutIdentityRequest>,
) -> Result<(StatusCode, Json<IdentityStatus>), ApiError> {
	let status = state
		.store
		.set_identity(req.solver_id, req.private_key)
		.await?;
	info!("identity installed via /identity endpoint");
	Ok((StatusCode::OK, Json(status)))
}

async fn delete_identity(State(state): State<AppState>) -> Result<StatusCode, ApiError> {
	state.store.clear_identity().await?;
	info!("identity cleared via /identity endpoint");
	Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize)]
struct ApiErrorBody {
	error: String,
	message: String,
}

/// Map store errors into proper HTTP responses. Bad JSON → 400, signing
/// errors (bad key) → 400, io/serde → 500.
struct ApiError(IdentityStoreError);

impl IntoResponse for ApiError {
	fn into_response(self) -> Response {
		match &self.0 {
			IdentityStoreError::Signing(_) => {
				let body = ApiErrorBody {
					error: "BAD_SIGNING_KEY".into(),
					message: self.0.to_string(),
				};
				(StatusCode::BAD_REQUEST, Json(body)).into_response()
			}
			IdentityStoreError::Io(_) | IdentityStoreError::Json(_) => {
				warn!(error = %self.0, "identity store io/json error");
				let body = ApiErrorBody {
					error: "STORE_ERROR".into(),
					message: self.0.to_string(),
				};
				(StatusCode::INTERNAL_SERVER_ERROR, Json(body)).into_response()
			}
			IdentityStoreError::NotLoaded => {
				let body = ApiErrorBody {
					error: "NO_IDENTITY".into(),
					message: self.0.to_string(),
				};
				(StatusCode::CONFLICT, Json(body)).into_response()
			}
		}
	}
}

impl From<IdentityStoreError> for ApiError {
	fn from(e: IdentityStoreError) -> Self {
		ApiError(e)
	}
}
