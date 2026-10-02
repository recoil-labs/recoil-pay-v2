//! Solvers handlers

use axum::{
	extract::{Path, Query, State},
	http::StatusCode,
	response::Json,
};
use tracing::debug;

use crate::handlers::common::ErrorResponse;
use crate::pagination::PaginationQuery;
use crate::state::AppState;
use oif_types::solvers::response::{SolverResponse, SolversResponse};

/// GET /api/v1/solvers - List all solvers
#[cfg_attr(feature = "openapi", utoipa::path(
    get,
    path = "/api/v1/solvers",
    params(
        ("page" = Option<u32>, Query, description = "Page number (1-based)", example = 1),
        ("page_size" = Option<u32>, Query, description = "Items per page (1-100)", example = 25)
    ),
    responses((status = 200, description = "List of solvers", body = SolversResponse)),
    tag = "solvers"
))]
pub async fn get_solvers(
	State(state): State<AppState>,
	Query(pq): Query<PaginationQuery>,
) -> Result<Json<SolversResponse>, (StatusCode, Json<ErrorResponse>)> {
	debug!("Listing solvers with pagination");
	let (page_items, _total, _active_count, _healthy_count) = state
		.solver_service
		.list_solvers_paginated(pq.page, pq.page_size)
		.await
		.map_err(|e| {
			(
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".to_string(),
					message: e.to_string(),
					timestamp: chrono::Utc::now().timestamp(),
				}),
			)
		})?;

	// Build page responses
	let mut responses: Vec<_> = page_items.iter().map(SolverResponse::try_from).collect::<Result<Vec<_>, _>>().map_err(|e| {
		(
			StatusCode::INTERNAL_SERVER_ERROR,
			Json(ErrorResponse {
				error: "CONVERSION_ERROR".to_string(),
				message: e.to_string(),
				timestamp: chrono::Utc::now().timestamp(),
			}),
		)
	})?;

	// Enrich solver list with push-solver quote inventory from Postgres
	let push_quotes = state.storage.list_solver_quotes(None).await.unwrap_or_default();
	if !push_quotes.is_empty() {
		let mut assets = Vec::new();
		for sq in &push_quotes {
			let from_chain_id: u64 = sq.from_chain
				.strip_prefix("eip155:")
				.or_else(|| sq.from_chain.strip_prefix("solana:"))
				.unwrap_or(&sq.from_chain)
				.parse()
				.unwrap_or(1);
			let to_chain_id: u64 = sq.to_chain
				.strip_prefix("eip155:")
				.or_else(|| sq.to_chain.strip_prefix("solana:"))
				.unwrap_or(&sq.to_chain)
				.parse()
				.unwrap_or(1);

			// Clients (the V2 intent parser) match on bare 0x token
			// addresses + real symbols/decimals, so resolve each quoted
			// asset against the chain registry rather than echoing the
			// operator's raw CAIP-19/symbol string.
			assets.push(asset_response_for(
				&state.chain_registry,
				from_chain_id,
				&sq.from_asset,
				sq.from_decimals,
			));
			assets.push(asset_response_for(
				&state.chain_registry,
				to_chain_id,
				&sq.to_asset,
				sq.to_decimals,
			));
		}

		// Group by solver_id — create one SolverResponse per unique registered push solver
		let mut seen = std::collections::HashSet::new();
		for sq in &push_quotes {
			if seen.insert(&sq.solver_id) {
				responses.push(oif_types::solvers::response::SolverResponse {
					solver_id: sq.solver_id.clone(),
					adapter_id: "oif-v1".to_string(),
					name: Some(format!("Push Solver ({})", &sq.solver_id)),
					description: Some("Registered push solver".to_string()),
					endpoint: "http://localhost:5174".to_string(),
					status: oif_types::solvers::SolverStatus::Active,
					supported_assets: oif_types::solvers::response::SupportedAssetsResponse::Assets {
						assets: assets.clone(),
						source: "push".to_string(),
					},
					created_at: sq.created_at.to_rfc3339(),
					last_seen: Some(sq.updated_at.to_rfc3339()),
				});
			}
		}
	}

	let response = SolversResponse {
		total_solvers: responses.len(),
		solvers: responses,

	};
	Ok(Json(response))
}

/// GET /api/v1/solvers/{id} - Get solver by id
#[cfg_attr(feature = "openapi", utoipa::path(
    get,
    path = "/api/v1/solvers/{id}",
    params(("id" = String, Path, description = "Solver ID")),
    responses((status = 200, description = "Solver details", body = SolverResponse), (status = 404, description = "Not found", body = ErrorResponse)),
    tag = "solvers"
))]
pub async fn get_solver_by_id(
	State(state): State<AppState>,
	Path(solver_id): Path<String>,
) -> Result<Json<SolverResponse>, (StatusCode, Json<ErrorResponse>)> {
	let solver = match state.solver_service.get_solver(&solver_id).await {
		Ok(Some(solver)) => solver,
		Ok(None) => {
			return Err((
				StatusCode::NOT_FOUND,
				Json(ErrorResponse {
					error: "SOLVER_NOT_FOUND".to_string(),
					message: format!("Solver {} not found", solver_id),
					timestamp: chrono::Utc::now().timestamp(),
				}),
			))
		},
		Err(e) => {
			return Err(match e {
				oif_service::SolverServiceError::Storage(msg) => (
					StatusCode::INTERNAL_SERVER_ERROR,
					Json(ErrorResponse {
						error: "STORAGE_ERROR".to_string(),
						message: msg,
						timestamp: chrono::Utc::now().timestamp(),
					}),
				),
				// NotFound is no longer an error case - handled above as Ok(None)
				oif_service::SolverServiceError::NotFound(_) => {
					unreachable!("NotFound should not occur with new signature")
				},
				oif_service::SolverServiceError::Adapter(msg) => (
					StatusCode::INTERNAL_SERVER_ERROR,
					Json(ErrorResponse {
						error: "SOLVER_ADAPTER_ERROR".to_string(),
						message: msg,
						timestamp: chrono::Utc::now().timestamp(),
					}),
				),
			});
		},
	};

	let response = SolverResponse::try_from(&solver).map_err(|e| {
		(
			StatusCode::INTERNAL_SERVER_ERROR,
			Json(ErrorResponse {
				error: "CONVERSION_ERROR".to_string(),
				message: e.to_string(),
				timestamp: chrono::Utc::now().timestamp(),
			}),
		)
	})?;
	Ok(Json(response))
}

/// Resolve a quoted asset string (symbol, bare address, or CAIP-19) into
/// the `AssetResponse` clients consume. Falls back to the bare address +
/// the quote's own decimals when the token isn't in the registry.
fn asset_response_for(
	registry: &oif_config::ChainRegistry,
	chain_id: u64,
	asset_str: &str,
	fallback_decimals: u8,
) -> oif_types::solvers::response::AssetResponse {
	let bare = asset_str
		.rsplit([':', '/'])
		.next()
		.unwrap_or(asset_str)
		.to_string();
	let token = registry.get(chain_id).and_then(|c| {
		c.token_by_symbol(asset_str)
			.or_else(|| c.token_by_address(&bare))
	});
	match token {
		Some(t) => oif_types::solvers::response::AssetResponse {
			chain_id,
			address: t.address.clone(),
			symbol: t.symbol.clone(),
			decimals: t.decimals,
			name: t.symbol.clone(),
		},
		None => oif_types::solvers::response::AssetResponse {
			chain_id,
			address: bare,
			symbol: "TOKEN".to_string(),
			decimals: fallback_decimals,
			name: "TOKEN".to_string(),
		},
	}
}
