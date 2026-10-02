use axum::{extract::State, http::StatusCode, response::Json};
use oif_service::push_quote_ranker::{PushQuoteRanker, PushQuoteRankerError};
use tracing::{info, warn};

use crate::handlers::common::ErrorResponse;
use crate::state::AppState;
use oif_types::quotes::request::QuoteRequest;
use oif_types::quotes::response::QuotesResponse;

/// Get quotes for a swap request using standard OIF format.
///
/// **Push-only** — quotes are sourced exclusively from `SolverQuote`s persisted
/// by solver operators via the dashboard (`POST /solver-api/quotes`). The
/// legacy pull-path fan-out to live solver binaries has been removed; the
/// aggregator no longer talks to a `solver-service` HTTP endpoint.
///
/// Selection is performed by `oif_service::push_quote_ranker::PushQuoteRanker`,
/// which scores every matching push-quote on a four-factor equal-weight basis
/// (output, reputation, success rate, latency) and returns the top N.
#[cfg_attr(feature = "openapi", utoipa::path(
    post,
    path = "/api/v1/quotes",
    request_body = QuoteRequest,
    responses(
        (status = 200, description = "Quotes aggregated successfully", body = QuotesResponse),
        (status = 400, description = "Invalid request", body = ErrorResponse),
        (status = 500, description = "Internal error", body = ErrorResponse)
    ),
    tag = "quotes"
))]
/// POST /api/v1/quotes - Get quotes
pub async fn post_quotes(
	State(state): State<AppState>,
	Json(request): Json<QuoteRequest>,
) -> Result<Json<QuotesResponse>, (StatusCode, Json<ErrorResponse>)> {
	info!(
		"Received quotes request with {} inputs and {} outputs",
		request.quote_request.inputs().len(),
		request.quote_request.outputs().len()
	);

	// Validate the request
	if let Err(e) = request.validate() {
		return Err((
			StatusCode::BAD_REQUEST,
			Json(ErrorResponse {
				error: "VALIDATION_ERROR".to_string(),
				message: format!("Invalid request: {}", e),
				timestamp: chrono::Utc::now().timestamp(),
			}),
		));
	}

	// Build the ranker on the fly from app-state references. Cheap (it just
	// stores Arcs) and avoids forcing callers to wire it through AppState.
	let ranker = PushQuoteRanker::new(
		Arc::clone(&state.storage),
		Arc::clone(&state.integrity_service),
		Arc::clone(&state.chain_registry),
	);

	// Derive the request inputs the ranker needs. The user arrives as an
	// ERC-7930 interop address; the ranker (exclusivity matching + the
	// Permit2 witness) wants the plain EVM address.
	let user_address = request.quote_request.user.extract_address();
	let (from_chain, to_chain, from_asset, to_asset, input_amount_base_units) =
		extract_request_params(&request);

	let (quotes, ranking_meta) = match ranker
		.rank_to_quotes(
			&user_address,
			input_amount_base_units,
			&from_chain,
			&to_chain,
			&from_asset,
			&to_asset,
			50, // max results
		)
		.await
	{
		Ok(v) => v,
		Err(PushQuoteRankerError::Storage(msg)) => {
			warn!(error = %msg, "storage error during quote ranking");
			return Err((
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "STORAGE_ERROR".to_string(),
					message: msg,
					timestamp: chrono::Utc::now().timestamp(),
				}),
			));
		},
		Err(PushQuoteRankerError::Integrity(e)) => {
			warn!(error = %e, "integrity error during quote ranking");
			return Err((
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "INTEGRITY_ERROR".to_string(),
					message: e.to_string(),
					timestamp: chrono::Utc::now().timestamp(),
				}),
			));
		},
	};

	// Translate the ranker's lightweight metadata into the OIF aggregation
	// metadata the client expects. All push-path-only semantics — there is no
	// "solver fan-out" anymore, so solver-timed-out / responded-error counts
	// are always zero.
	let api_metadata = oif_types::quotes::response::AggregationMetadata {
		total_duration_ms: ranking_meta.total_duration_ms,
		solver_timeout_ms: 0,
		global_timeout_ms: ranking_meta.total_duration_ms,
		early_termination: false,
		total_solvers_available: ranking_meta.total_pushed,
		solvers_queried: ranking_meta.total_pushed,
		solvers_responded_success: ranking_meta.returned,
		solvers_responded_error: ranking_meta.total_filtered_out,
		solvers_timed_out: 0,
		min_quotes_required: 1,
		solver_selection_mode: oif_types::quotes::request::SolverSelection::All,
	};

	let response = match QuotesResponse::from_domain_quotes_with_metadata(quotes, api_metadata) {
		Ok(resp) => resp,
		Err(e) => {
			return Err((
				StatusCode::INTERNAL_SERVER_ERROR,
				Json(ErrorResponse {
					error: "CONVERSION_ERROR".to_string(),
					message: format!("Failed to convert quotes: {}", e),
					timestamp: chrono::Utc::now().timestamp(),
				}),
			))
		},
	};

	info!(
		"Returning {} quotes for request (duration: {}ms, {} push-quotes matched)",
		response.total_quotes, ranking_meta.total_duration_ms, ranking_meta.total_pushed
	);
	Ok(Json(response))
}

use std::sync::Arc;

/// Reduce the OIF `QuoteRequest` to the four fields the ranker needs:
/// chain IDs (CAIP-style), asset identifiers, and the input amount in base units.
///
/// Falls back to empty strings / 0 when the request is missing fields so the
/// ranker's filters (which match on equality) cleanly skip every quote rather
/// than mis-matching partial data.
fn extract_request_params(
	request: &QuoteRequest,
) -> (String, String, String, String, u128) {
	let from_chain = request
		.quote_request
		.intent
		.inputs
		.first()
		.map(|i| chain_id_to_caip(&i.asset))
		.unwrap_or_default();
	let to_chain = request
		.quote_request
		.intent
		.outputs
		.first()
		.map(|o| chain_id_to_caip(&o.asset))
		.unwrap_or_default();
	let from_asset = request
		.quote_request
		.intent
		.inputs
		.first()
		.map(|i| i.asset.extract_address())
		.unwrap_or_default();
	let to_asset = request
		.quote_request
		.intent
		.outputs
		.first()
		.map(|o| o.asset.extract_address())
		.unwrap_or_default();
	let input_amount_base_units = request
		.quote_request
		.inputs()
		.first()
		.and_then(|i| i.amount.as_ref().map(|a| a.to_string()))
		.and_then(|s| s.parse::<u128>().ok())
		.unwrap_or(0);
	(from_chain, to_chain, from_asset, to_asset, input_amount_base_units)
}

/// Convert an OIF `InteropAddress` into a CAIP-style chain identifier
/// (e.g. `"eip155:11155420"`) via its embedded chain reference. An
/// unparseable chain yields the empty string — the ranker treats that as
/// a non-match for every quote (safe default).
fn chain_id_to_caip(asset: &oif_types::InteropAddress) -> String {
	asset
		.extract_chain_id()
		.map(|id| format!("eip155:{id}"))
		.unwrap_or_default()
}
