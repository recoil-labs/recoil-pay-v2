//! Chain registry endpoint.
//!
//! Exposes the aggregator's chain registry (settlement contracts, tokens
//! with decimals, and RPC URLs) so the operator dashboard and other
//! clients can build chain/token pickers and read balances without
//! hardcoding addresses. All of this data is public on-chain
//! configuration — no auth required.

use axum::{extract::State, response::Json};
use serde::Serialize;
#[cfg(feature = "openapi")]
use utoipa::ToSchema;

use crate::state::AppState;

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "openapi", derive(ToSchema))]
pub struct ChainsResponse {
	pub data: Vec<oif_config::ChainInfo>,
}

/// GET /api/v1/chains — the supported chains, their settlement
/// contracts, tokens, and RPC endpoints.
#[cfg_attr(feature = "openapi", utoipa::path(
	get,
	path = "/api/v1/chains",
	tag = "chains",
	responses(
		(status = 200, description = "Supported chains, sorted by chain_id. Keys are \
		 snake_case on this endpoint only.", body = ChainsResponse)
	)
))]
pub async fn get_chains(State(state): State<AppState>) -> Json<ChainsResponse> {
	let mut data: Vec<oif_config::ChainInfo> = state.chain_registry.iter().cloned().collect();
	data.sort_by_key(|c| c.chain_id);
	Json(ChainsResponse { data })
}
