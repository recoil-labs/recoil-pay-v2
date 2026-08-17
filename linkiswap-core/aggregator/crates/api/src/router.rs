use axum::{
	routing::{delete, get, post},
	Router,
};
use tower::ServiceBuilder;
use tower_http::{
	compression::CompressionLayer,
	cors::CorsLayer,
	limit::RequestBodyLimitLayer,
	request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
	trace::TraceLayer,
};
use tracing::Level;

use crate::handlers::{
	delete_settlement_contract, delete_solver_quote, delete_vault_asset, generate_operator_key,
	get_chains, get_operator, get_operators, get_order, get_register_message,
	get_settlement_contracts,
	get_solver_by_id, get_solver_identities, get_solvers, get_supported_contracts,
	get_solver_quotes, get_telemetry, get_vault_balances, get_worker, health,
	operator_heartbeat, post_account_register, post_account_unregister, post_orders,
	post_quotes, post_quotes_submit, post_trust_components, post_vault_snapshot,
	claim_orders, extend_order_claim, record_fill_outcome, register_worker, rotate_api_key,
	set_settlement_contract, sign_fill, toggle_pause_solver_quote, update_order_status,
	worker_heartbeat, ws_orders,
};
use crate::security::add_security_headers;
use crate::state::AppState;
// State is applied at the application level using `.with_state(...)`.
#[cfg(feature = "openapi")]
use crate::openapi::ApiDoc;
#[cfg(feature = "openapi")]
use utoipa::OpenApi;
#[cfg(feature = "openapi")]
use utoipa_swagger_ui::SwaggerUi;

pub fn create_router() -> Router<AppState> {
	// Layers prepared first so they're in scope for all cfg paths
	let cors = CorsLayer::permissive();
	let body_limit = RequestBodyLimitLayer::new(1024 * 1024);
	let trace = TraceLayer::new_for_http()
		.make_span_with(|req: &axum::http::Request<_>| {
			let req_id = req
				.headers()
				.get("x-request-id")
				.and_then(|v| v.to_str().ok())
				.unwrap_or("-");
			tracing::info_span!(
				"http_request",
				method = %req.method(),
				uri = %req.uri(),
				req_id
			)
		})
		.on_request(tower_http::trace::DefaultOnRequest::new().level(Level::INFO))
		.on_response(
			tower_http::trace::DefaultOnResponse::new()
				.level(Level::INFO)
				.latency_unit(tower_http::LatencyUnit::Millis),
		);
	let req_id = ServiceBuilder::new()
		.layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
		.layer(PropagateRequestIdLayer::x_request_id());

	// Base router
	let base_router = Router::new()
		.route("/health", get(health))
		.route("/health/", get(health))
		.route("/api/v1/chains", get(get_chains))
		.route("/api/v1/quotes", post(post_quotes))
		.route("/api/v1/quotes/", post(post_quotes))
		.route("/quotes/submit", post(post_quotes_submit))
		.route("/quotes/submit/", post(post_quotes_submit))
		.route("/api/v1/quotes/submit", post(post_quotes_submit))
		.route("/solver-api/quotes/submit", post(post_quotes_submit))
		.route("/solver-api/account/register", post(post_account_register))
		.route("/solver-api/account/unregister", post(post_account_unregister))
		.route("/solver-api/solver/identities", get(get_solver_identities))
		.route("/api/v1/solver/register/message", get(get_register_message))
		.route("/api/v1/solver/supported-contracts", get(get_supported_contracts))
		.route("/api/v1/solver/supported-contracts", post(get_supported_contracts))
		.route("/api/v1/orders", post(post_orders))
		.route("/api/v1/orders/", post(post_orders))
		.route("/api/v1/orders/{id}", get(get_order))
		.route("/api/v1/orders/{id}/", get(get_order))
		.route("/api/v1/solvers", get(get_solvers))
		.route("/api/v1/solvers/", get(get_solvers))
		.route("/api/v1/solvers/{id}", get(get_solver_by_id))
		.route("/api/v1/solvers/{id}/", get(get_solver_by_id))
		.route("/solver-api/quotes", get(get_solver_quotes))
		.route("/solver-api/quotes/{id}", delete(delete_solver_quote))
		.route("/solver-api/quotes/{id}/pause", post(toggle_pause_solver_quote))
		.route("/solver-api/telemetry", get(get_telemetry))
		// Vault balance tracking — operator-attested until the
		// vault contract lands. `GET` returns the dashboard's view
		// of every (chain, asset) row for the authenticated
		// operator; `POST /solver-api/vaults/snapshot` is the
		// upsert path; `DELETE /solver-api/vaults/{chain}/{asset}`
		// removes one row.
		.route("/solver-api/vaults", get(get_vault_balances))
		.route("/solver-api/vaults/snapshot", post(post_vault_snapshot))
		.route(
			"/solver-api/vaults/{chain}/{asset}",
			delete(delete_vault_asset),
		)
		.route("/quotes/trustComponents", post(post_trust_components))
		.route("/ws/orders", get(ws_orders))
		// Operator reputation endpoints — power the dashboard leaderboard and
		// let the fill-worker publish heartbeats + fill outcomes.
		.route("/solver-api/operators", get(get_operators))
		.route("/solver-api/operators/{id}", get(get_operator))
		.route("/solver-api/operators/{id}/heartbeat", post(operator_heartbeat))
		.route("/solver-api/operators/{id}/fills", post(record_fill_outcome))
		.route("/solver-api/orders/{id}/status", post(update_order_status))
		.route("/solver-api/orders/claim", post(claim_orders))
		.route("/solver-api/orders/{id}/extend-claim", post(extend_order_claim))
		// Server-side fill signing — multi-tenant fill-worker calls this
		// to get a digest signed by the operator's encrypted fill-wallet.
		.route("/solver-api/operators/{id}/sign-fill", post(sign_fill))
		.route("/solver-api/operators/{id}/key", post(generate_operator_key))
		.route("/solver-api/operators/{id}/api-key", post(rotate_api_key))
		.route(
			"/solver-api/operators/{id}/settlement-contract",
			post(set_settlement_contract)
				.put(set_settlement_contract)
				.delete(delete_settlement_contract),
		)
		.route(
			"/solver-api/operators/{id}/settlement-contracts",
			get(get_settlement_contracts),
		)
		// Worker endpoints — multi-tenant fill-worker self-registration
		// + heartbeat. Workers are NOT operators: they're a separate
		// fleet-managed registry, so they get their own URL space.
		.route("/solver-api/workers/{id}", post(register_worker).get(get_worker))
		.route("/solver-api/workers/{id}/heartbeat", post(worker_heartbeat));
	// Conditionally add OpenAPI endpoints
	#[cfg(feature = "openapi")]
	let router = {
		// SwaggerUI automatically provides the OpenAPI JSON endpoint
		base_router
			.merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
	};

	#[cfg(not(feature = "openapi"))]
	let router = base_router;

	// Apply common layers and auth
	let router = router
		.layer(cors)
		.layer(body_limit)
		.layer(CompressionLayer::new())
		.layer(req_id)
		.layer(trace);

	add_security_headers(router)
}
