//! Authentication middleware using the auth traits

use axum::{
	extract::{Request, State},
	http::{HeaderMap, StatusCode},
	middleware::Next,
	response::Response,
};
use oif_types::auth::{
	AuthRequest, AuthenticationResult, Authenticator, Permission, RateLimiter, RateLimits,
};
use std::sync::Arc;
use tracing::{debug, warn};
use crate::state::AppState;

/// Auth middleware configuration.
///
/// Authentication is **deny by default**: anything not in `public_paths`
/// requires a credential, and a failed check is rejected rather than
/// logged and waved through.
///
/// `protected_paths` no longer decides *whether* to authenticate — only
/// whether to additionally enforce a permission. It previously served
/// double duty, and because it defaulted to empty and was never
/// populated, every authentication failure fell through to the handler.
/// The whole API was effectively public.
#[derive(Debug, Clone)]
pub struct AuthConfig {
	/// Paths that additionally require a permission check once
	/// authenticated.
	pub protected_paths: Vec<String>,
	/// Prefixes reachable with no credential at all.
	pub public_paths: Vec<String>,
	/// Whether to enable rate limiting
	pub enable_rate_limiting: bool,
	/// Default rate limits for unauthenticated users
	pub default_rate_limits: Option<RateLimits>,
}

impl Default for AuthConfig {
	fn default() -> Self {
		Self {
			protected_paths: vec![],
			// Everything here is deliberately reachable by anonymous
			// callers. Keep this list short and justified.
			public_paths: vec![
				// Liveness.
				"/health".to_string(),
				// The end-user swap surface. Users are anonymous by
				// design: they authorise with an on-chain signature on
				// the order itself, not with an account here.
				"/api/v1/solvers".to_string(),
				"/api/v1/orders".to_string(),
				"/api/v1/quotes".to_string(),
				"/api/v1/chains".to_string(),
				// Registration bootstrap: an operator has no credential
				// until these succeed. Both verify an EIP-191 signature
				// internally, so they are not unauthenticated in effect.
				"/api/v1/solver/register/message".to_string(),
				"/api/v1/solver/supported-contracts".to_string(),
				"/solver-api/account/register".to_string(),
				// Performs its own signed-header / api-key handshake
				// before upgrading; the middleware cannot inspect a
				// WebSocket upgrade usefully.
				"/ws/orders".to_string(),
				// Worker fleet registration + heartbeat. Identified by
				// signed headers verified in the handlers.
				"/solver-api/workers".to_string(),
			],
			enable_rate_limiting: true,
			default_rate_limits: Some(RateLimits::default()),
		}
	}
}

/// Auth middleware layer
pub struct AuthMiddleware<A, R>
where
	A: Authenticator,
	R: RateLimiter,
{
	#[allow(dead_code)]
	authenticator: Arc<A>,
	#[allow(dead_code)]
	rate_limiter: Arc<R>,
	config: AuthConfig,
}

impl<A, R> AuthMiddleware<A, R>
where
	A: Authenticator,
	R: RateLimiter,
{
	/// Create new auth middleware
	pub fn new(authenticator: Arc<A>, rate_limiter: Arc<R>) -> Self {
		Self {
			authenticator,
			rate_limiter,
			config: AuthConfig::default(),
		}
	}

	/// Create with custom config
	pub fn with_config(authenticator: Arc<A>, rate_limiter: Arc<R>, config: AuthConfig) -> Self {
		Self {
			authenticator,
			rate_limiter,
			config,
		}
	}

	/// Add a protected path
	pub fn protect_path(mut self, path: &str) -> Self {
		self.config.protected_paths.push(path.to_string());
		self
	}

	/// Add a public path
	pub fn add_public_path(mut self, path: &str) -> Self {
		self.config.public_paths.push(path.to_string());
		self
	}
}

/// Authentication middleware function
pub async fn auth_middleware(
	State(state): State<AppState>,
	request: Request,
	next: Next,
) -> Result<Response, StatusCode> {
	let authenticator = state.authenticator.clone();
	let rate_limiter = state.rate_limiter.clone();
	let config = state.auth_config.clone();
	let path = request.uri().path().to_string();
	let method = request.method().to_string();

	// CORS preflight must never be authenticated. Browsers deliberately
	// strip Authorization, x-api-key and every other custom header from
	// the OPTIONS probe, so it can only ever look unauthenticated —
	// rejecting it kills the real request before it is sent, and the
	// browser reports it as a CORS error rather than a 401.
	//
	// This layer sits *outside* CorsLayer (see `create_router` usage in
	// src/lib.rs), so returning early is what hands the preflight to CORS
	// to answer. Nothing is leaked: a preflight response carries no
	// application data, and the request that follows it is authenticated
	// normally.
	if is_cors_preflight(request.method()) {
		debug!("CORS preflight for {}, deferring to CorsLayer", path);
		return Ok(next.run(request).await);
	}

	// Check if path is public
	if config.public_paths.iter().any(|p| path.starts_with(p)) {
		debug!("Public path {}, skipping auth", path);
		return Ok(next.run(request).await);
	}

	// First-party fill-worker: the hosted multi-tenant worker authenticates
	// its server-to-server calls (sign-fill, heartbeats, fill outcomes,
	// order status updates) with a shared bearer token. A wrong token falls
	// through to the normal authenticator, which will reject it.
	if let (Some(expected), Some(provided)) = (
		state.worker_token.as_deref(),
		request
			.headers()
			.get("x-worker-token")
			.and_then(|v| v.to_str().ok()),
	) {
		if constant_time_str_eq(expected, provided) {
			debug!("Worker token accepted for {}", path);
			return Ok(next.run(request).await);
		}
	}

	// Convert headers to HashMap
	let headers = headers_to_map(request.headers());

	// Extract client IP (simplified - in production, use proper forwarded headers)
	let client_ip = headers
		.get("x-forwarded-for")
		.or_else(|| headers.get("x-real-ip"))
		.cloned();

	let auth_request = AuthRequest::new(method.clone(), path.clone())
		.with_header(
			"authorization".to_string(),
			headers
				.get("authorization")
				.unwrap_or(&String::new())
				.clone(),
		)
		.with_header(
			"x-api-key".to_string(),
			headers.get("x-api-key").unwrap_or(&String::new()).clone(),
		);

	// Authenticate the request
	let auth_result = authenticator.authenticate(&auth_request).await;

	let (auth_context, rate_limits) = match auth_result {
		AuthenticationResult::Authorized(context) => {
			debug!("Request authenticated for user: {}", context.user_id);
			let limits = authenticator.get_rate_limits(&context);
			(Some(context), limits)
		},
		AuthenticationResult::Bypassed => {
			debug!("Authentication bypassed for path: {}", path);
			(None, config.default_rate_limits.clone())
		},
		AuthenticationResult::Unauthorized(reason) => {
			// Deny by default. Public prefixes returned earlier, and the
			// first-party worker token was checked above, so reaching
			// here means an unauthenticated caller on a private path.
			//
			// This used to fall through to the handler whenever
			// `protected_paths` did not match — and it never matched,
			// because nothing populated it. Every private endpoint,
			// including operator key rotation and fill signing, was
			// served to anonymous callers.
			warn!("Rejecting unauthenticated request to {}: {}", path, reason);
			return Err(StatusCode::UNAUTHORIZED);
		},
	};

	// Check authorization for protected paths
	if config.protected_paths.iter().any(|p| path.starts_with(p)) {
		if let Some(ref context) = auth_context {
			// Determine required permission based on path and method
			let required_permission = match (path.as_str(), method.as_str()) {
				(p, "POST") if p.starts_with("/api/v1/orders") => Permission::SubmitOrders,
				(p, "GET") if p.starts_with("/api/v1/orders") => Permission::ReadOrders,
				(p, "POST") if p.starts_with("/api/v1/quotes") => Permission::ReadQuotes,
				_ => Permission::ReadQuotes, // Default permission
			};

			if !authenticator.authorize(context, &required_permission).await {
				warn!(
					"Authorization failed for user {} on path {}",
					context.user_id, path
				);
				return Err(StatusCode::FORBIDDEN);
			}
		} else {
			// Protected path but no auth context
			return Err(StatusCode::UNAUTHORIZED);
		}
	}

	// Rate limiting
	if config.enable_rate_limiting {
		if let Some(limits) = rate_limits {
			let rate_key = if let Some(context) = &auth_context {
				format!("user:{}", context.user_id)
			} else {
				format!("ip:{}", client_ip.unwrap_or_else(|| "unknown".to_string()))
			};

			match rate_limiter.check_rate_limit(&rate_key, &limits).await {
				Ok(check) => {
					if !check.allowed {
						warn!("Rate limit exceeded for key: {}", rate_key);
						return Err(StatusCode::TOO_MANY_REQUESTS);
					}

					// Record the request
					if let Err(e) = rate_limiter.record_request(&rate_key).await {
						warn!("Failed to record request for rate limiting: {}", e);
					}
				},
				Err(e) => {
					warn!("Rate limiter error: {}", e);
					// Continue without rate limiting on error
				},
			}
		}
	}

	// Add auth context to request extensions if available
	let mut request = request;
	if let Some(context) = auth_context {
		request.extensions_mut().insert(context);
	}

	Ok(next.run(request).await)
}

/// Whether a request is a CORS preflight, which is exempt from
/// authentication. See the rationale in [`auth_middleware`].
fn is_cors_preflight(method: &axum::http::Method) -> bool {
	method == axum::http::Method::OPTIONS
}

/// Constant-time string comparison so the worker-token check doesn't leak
/// prefix-length information through response timing.
fn constant_time_str_eq(a: &str, b: &str) -> bool {
	let (a, b) = (a.as_bytes(), b.as_bytes());
	if a.len() != b.len() {
		return false;
	}
	a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Helper function to convert HeaderMap to HashMap<String, String>
fn headers_to_map(headers: &HeaderMap) -> std::collections::HashMap<String, String> {
	let mut map = std::collections::HashMap::new();

	for (name, value) in headers.iter() {
		if let Ok(value_str) = value.to_str() {
			map.insert(name.as_str().to_lowercase(), value_str.to_string());
		}
	}

	map
}

#[cfg(test)]
mod deny_by_default_tests {
	use super::*;

	fn is_public(cfg: &AuthConfig, path: &str) -> bool {
		cfg.public_paths.iter().any(|p| path.starts_with(p))
	}

	/// Anything that can move funds, mint credentials or read another
	/// operator's data must require a credential. These were all served
	/// to anonymous callers while auth failed open.
	#[test]
	fn sensitive_paths_are_not_public() {
		let cfg = AuthConfig::default();
		for path in [
			"/solver-api/operators/solver-abc/sign-fill",
			"/solver-api/operators/solver-abc/api-key",
			"/solver-api/operators/solver-abc/key",
			"/solver-api/operators/solver-abc/settlement-contract",
			"/solver-api/orders/claim",
			"/solver-api/orders/ord-1/status",
			"/solver-api/operators",
			"/solver-api/telemetry",
			"/solver-api/vaults",
			"/solver-api/quotes",
		] {
			assert!(!is_public(&cfg, path), "{path} must require authentication");
		}
	}

	/// The anonymous surface the product genuinely needs: the end-user
	/// swap flow, liveness, and the registration bootstrap (which has no
	/// credential to present yet and verifies a wallet signature itself).
	#[test]
	fn intended_public_paths_stay_public() {
		let cfg = AuthConfig::default();
		for path in [
			"/health",
			"/api/v1/quotes",
			"/api/v1/orders",
			"/api/v1/chains",
			"/api/v1/solvers",
			"/api/v1/solver/register/message",
			"/solver-api/account/register",
			"/ws/orders",
			"/solver-api/workers/worker-1/heartbeat",
		] {
			assert!(is_public(&cfg, path), "{path} must stay reachable anonymously");
		}
	}

	/// `protected_paths` used to gate whether authentication was enforced
	/// at all, and defaulted to empty — which is what made the API
	/// public. It must never regain that meaning.
	#[test]
	fn empty_protected_paths_does_not_disable_auth() {
		let cfg = AuthConfig::default();
		assert!(cfg.protected_paths.is_empty());
		assert!(
			!is_public(&cfg, "/solver-api/operators/solver-abc/sign-fill"),
			"an empty protected_paths must not make private routes public"
		);
	}

	/// Deny-by-default must not extend to CORS preflight. Browsers strip
	/// credentials from OPTIONS, so authenticating it 401s every
	/// cross-origin call from the dashboard before the real request is
	/// ever sent — which is exactly what broke operator registration.
	#[test]
	fn cors_preflight_is_exempt_from_auth() {
		use axum::http::Method;
		assert!(is_cors_preflight(&Method::OPTIONS));
		for m in [Method::GET, Method::POST, Method::DELETE, Method::PUT] {
			assert!(!is_cors_preflight(&m), "{m} must still be authenticated");
		}
	}

	#[test]
	fn worker_token_comparison_is_length_and_content_safe() {
		assert!(constant_time_str_eq("abc123", "abc123"));
		assert!(!constant_time_str_eq("abc123", "abc124"));
		assert!(!constant_time_str_eq("abc", "abc123"));
		assert!(!constant_time_str_eq("", "x"));
	}
}
