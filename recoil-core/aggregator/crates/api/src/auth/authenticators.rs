//! Authentication implementations

use oif_types::auth::{
	errors::AuthError,
	traits::{
		AuthContext, AuthRequest, AuthenticationResult, Authenticator, Permission, RateLimits,
	},
};

use async_trait::async_trait;
use std::time::Duration;
use tokio::sync::RwLock;
use dashmap::DashMap;
use std::sync::Arc;
use tracing::{debug, warn};
use serde::{Deserialize, Serialize};

/// No-op authenticator that allows all requests
#[derive(Debug, Default)]
pub struct NoAuthenticator;

#[async_trait]
impl Authenticator for NoAuthenticator {
	async fn authenticate(&self, _request: &AuthRequest) -> AuthenticationResult {
		debug!("NoAuthenticator: bypassing authentication");
		AuthenticationResult::Bypassed
	}

	async fn authorize(&self, _context: &AuthContext, _permission: &Permission) -> bool {
		true
	}

	fn get_rate_limits(&self, _context: &AuthContext) -> Option<RateLimits> {
		None
	}

	async fn health_check(&self) -> Result<bool, AuthError> {
		Ok(true)
	}

	fn name(&self) -> &str {
		"NoAuthenticator"
	}
}

/// Simple API key authenticator
#[derive(Debug)]
pub struct ApiKeyAuthenticator {
	/// Valid API keys mapped to user contexts
	api_keys: Arc<DashMap<String, AuthContext>>,
}

impl ApiKeyAuthenticator {
	/// Create a new API key authenticator
	pub fn new() -> Self {
		Self {
			api_keys: Arc::new(DashMap::new()),
		}
	}

	/// Add an API key with associated context
	pub fn add_key(&self, api_key: String, context: AuthContext) {
		self.api_keys.insert(api_key, context);
	}

	/// Remove an API key
	pub fn remove_key(&self, api_key: &str) -> Option<AuthContext> {
		self.api_keys.remove(api_key).map(|(_, context)| context)
	}

	/// Create with default admin key
	pub fn with_admin_key(admin_key: String) -> Self {
		let auth = Self::new();
		let admin_context = AuthContext::new("admin".to_string())
			.with_role("admin".to_string())
			.with_permission(Permission::Admin)
			.with_permission(Permission::ReadQuotes)
			.with_permission(Permission::SubmitOrders)
			.with_permission(Permission::ReadOrders)
			.with_permission(Permission::HealthCheck);

		auth.add_key(admin_key, admin_context);
		auth
	}
}

#[async_trait]
impl Authenticator for ApiKeyAuthenticator {
	async fn authenticate(&self, request: &AuthRequest) -> AuthenticationResult {
		if let Some(api_key) = request.get_api_key() {
			if let Some(context) = self.api_keys.get(api_key) {
				if context.is_expired() {
					warn!("API key {} has expired", api_key);
					return AuthenticationResult::Unauthorized("API key expired".to_string());
				}
				debug!(
					"API key {} authenticated for user {}",
					api_key, context.user_id
				);
				return AuthenticationResult::Authorized(context.clone());
			}
		}

		AuthenticationResult::Unauthorized("Invalid or missing API key".to_string())
	}

	async fn authorize(&self, context: &AuthContext, permission: &Permission) -> bool {
		// Admin can do anything
		if context.has_role("admin") || context.has_permission(&Permission::Admin) {
			return true;
		}

		// Check specific permission
		context.has_permission(permission)
	}

	fn get_rate_limits(&self, context: &AuthContext) -> Option<RateLimits> {
		context.rate_limits.clone()
	}

	async fn health_check(&self) -> Result<bool, AuthError> {
		Ok(true)
	}

	fn name(&self) -> &str {
		"ApiKeyAuthenticator"
	}
}

impl Default for ApiKeyAuthenticator {
	fn default() -> Self {
		Self::new()
	}
}

/// DB-backed operator authenticator.
///
/// Replaces the previous `with_admin_key` pattern (one shared key across
/// every dashboard). On each request, looks up the incoming `x-api-key`
/// against the `operators.api_key` column and returns an `AuthContext`
/// scoped to just that operator. The result is cached in-memory for
/// `cache_ttl` so the auth middleware doesn't hammer the DB on every
/// request from an active dashboard.
///
/// The `Permission` set returned is intentionally narrow: an operator
/// can read quotes, submit orders, and read their own operator row, but
/// not admin-level operations (rotating other operators' keys, deleting
/// quotes, etc.). The legacy `with_admin_key` static key with
/// `Permission::Admin` is GONE.
pub struct DbApiKeyAuthenticator {
	storage: Arc<dyn oif_types::storage::OperatorStorageTrait>,
	cache: RwLock<std::collections::HashMap<String, (AuthContext, std::time::Instant)>>,
	cache_ttl: Duration,
}

impl std::fmt::Debug for DbApiKeyAuthenticator {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		f.debug_struct("DbApiKeyAuthenticator")
			.field("cache_ttl", &self.cache_ttl)
			.field("cache_size", &self.cache.try_read().map(|c| c.len()).unwrap_or(0))
			.finish()
	}
}

impl DbApiKeyAuthenticator {
	pub fn new(storage: Arc<dyn oif_types::storage::OperatorStorageTrait>) -> Self {
		Self {
			storage,
			cache: RwLock::new(std::collections::HashMap::new()),
			cache_ttl: Duration::from_secs(60),
		}
	}

	/// Drop the cache entry for `api_key`. Called after an operator
	/// rotates their key so the next auth lookup reflects the new value.
	pub async fn invalidate(&self, api_key: &str) {
		self.cache.write().await.remove(api_key);
	}
}

#[async_trait]
impl Authenticator for DbApiKeyAuthenticator {
	async fn authenticate(&self, request: &AuthRequest) -> AuthenticationResult {
		let api_key = match request.get_api_key() {
			Some(k) => k.to_string(),
			None => {
				return AuthenticationResult::Unauthorized("Invalid or missing API key".to_string());
			},
		};

		// Fast path: cache hit. The `peek` doesn’t hold the lock across
		// the DB call.
		if let Some((ctx, ts)) = self.cache.read().await.get(&api_key).cloned() {
			if ts.elapsed() < self.cache_ttl {
				if ctx.is_expired() {
					return AuthenticationResult::Unauthorized("API key expired".to_string());
				}
				return AuthenticationResult::Authorized(ctx);
			}
		}

		// Slow path: DB lookup.
		let operator = match self.storage.get_operator_by_api_key(&api_key).await {
			Ok(Some(op)) => op,
			Ok(None) => {
				return AuthenticationResult::Unauthorized("Invalid or missing API key".to_string());
			},
			Err(e) => {
				warn!(error = %e, "operator api_key lookup failed");
				return AuthenticationResult::Unauthorized(
					"Internal auth error".to_string(),
				);
			},
		};

		// AuthContext scoped to this operator. No admin, no global
		// permissions — only what the dashboard needs to manage this
		// operator's own resources.
		let ctx = AuthContext::new(operator.solver_id.clone())
			.with_role("operator".to_string())
			.with_permission(Permission::ReadQuotes)
			.with_permission(Permission::SubmitOrders)
			.with_permission(Permission::ReadOrders)
			.with_permission(Permission::HealthCheck);

		self.cache
			.write()
			.await
			.insert(api_key, (ctx.clone(), std::time::Instant::now()));

		AuthenticationResult::Authorized(ctx)
	}

	async fn authorize(&self, context: &AuthContext, permission: &Permission) -> bool {
		// Operators are not admins. They can only do what their
		// permission set allows.
		context.has_permission(permission)
	}

	fn get_rate_limits(&self, context: &AuthContext) -> Option<RateLimits> {
		context.rate_limits.clone()
	}

	async fn health_check(&self) -> Result<bool, AuthError> {
		Ok(true)
	}

	fn name(&self) -> &str {
		"DbApiKeyAuthenticator"
	}
}

/// JWT Authenticator
#[derive(Debug)]
pub struct JwtAuthenticator {
	secret: String,
}

impl JwtAuthenticator {
	pub fn new(secret: String) -> Self {
		Self { secret }
	}
}

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
	sub: String,
	exp: usize,
}

#[async_trait]
impl Authenticator for JwtAuthenticator {
	async fn authenticate(&self, request: &AuthRequest) -> AuthenticationResult {
		if let Some(token) = request.get_bearer_token() {
			let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256);
			validation.validate_exp = true;
			
			match jsonwebtoken::decode::<Claims>(
				&token,
				&jsonwebtoken::DecodingKey::from_secret(self.secret.as_bytes()),
				&validation,
			) {
				Ok(token_data) => {
					let context = AuthContext::new(token_data.claims.sub);
					return AuthenticationResult::Authorized(context);
				}
				Err(e) => {
					warn!("JWT validation failed: {}", e);
					return AuthenticationResult::Unauthorized("Invalid JWT token".to_string());
				}
			}
		}
		AuthenticationResult::Unauthorized("Missing JWT token".to_string())
	}

	async fn authorize(&self, _context: &AuthContext, _permission: &Permission) -> bool {
		true // Simple approach for now
	}

	fn get_rate_limits(&self, _context: &AuthContext) -> Option<RateLimits> {
		None
	}

	async fn health_check(&self) -> Result<bool, AuthError> {
		Ok(true)
	}

	fn name(&self) -> &str {
		"JwtAuthenticator"
	}
}

/// Combined Authenticator tries JWT first, then falls back to API Key
#[derive(Debug)]
pub struct CombinedAuthenticator {
	jwt: JwtAuthenticator,
	api_key: Arc<dyn Authenticator>,
}

impl CombinedAuthenticator {
	pub fn new(jwt: JwtAuthenticator, api_key: Arc<dyn Authenticator>) -> Self {
		Self { jwt, api_key }
	}
}

#[async_trait]
impl Authenticator for CombinedAuthenticator {
	async fn authenticate(&self, request: &AuthRequest) -> AuthenticationResult {
		// Try JWT first
		if request.get_bearer_token().is_some() {
			return self.jwt.authenticate(request).await;
		}
		// Fallback to API Key
		self.api_key.authenticate(request).await
	}

	async fn authorize(&self, context: &AuthContext, permission: &Permission) -> bool {
		// Both delegates can handle authorize, we default to ApiKey for roles
		self.api_key.authorize(context, permission).await
	}

	fn get_rate_limits(&self, context: &AuthContext) -> Option<RateLimits> {
		self.api_key.get_rate_limits(context)
	}

	async fn health_check(&self) -> Result<bool, AuthError> {
		Ok(self.jwt.health_check().await.is_ok() && self.api_key.health_check().await.is_ok())
	}

	fn name(&self) -> &str {
		"CombinedAuthenticator"
	}
}
