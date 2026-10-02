//! OIF Aggregator Library
//!
//! A high-performance aggregator for Open Intent Framework (OIF) solvers,
//! providing quote aggregation, intent submission, and solver management.

use oif_service::{
	jobs::UpgradableJobScheduler, BackgroundJob, BackgroundJobHandler, IntegrityService,
	GiftCardPayoutWorker, GiftCardResolver, IntegrityTrait, JobProcessor, JobProcessorConfig,
	SolverFilterService,
	SolverFilterTrait,
	SolverService, SolverServiceTrait,
};

// Core domain types - the most commonly used types
pub use oif_types::{
	chrono,
	// External dependencies for convenience
	serde_json,
	// Core types
	Adapter,
	AdapterError,

	AuthContext,
	AuthRequest,
	// Auth traits
	Authenticator,
	Order,
	OrderError,
	OrderRequest,
	OrderResponse,
	OrderStatus,
	Permission,
	// Primary domain entities
	Quote,
	// Error types
	QuoteError,
	QuoteRequest,
	QuoteResponse,
	RateLimiter,
	RateLimits,
	Solver,
	SolverConfig,
	SolverError,
	SolverStatus,
};

// Service layer
pub use oif_service::{
	AggregatorService,
	CircuitBreakerService,
	CircuitBreakerTrait,
	SolverServiceError,
	SolverStats,
	// Keep the full module for more advanced usage
};

// Storage layer
pub use oif_storage::{
	traits::{OrderStorage, SolverStorage, StorageError, StorageResult},
	MemoryStore, Storage,
};

// Storage traits module for advanced usage
pub mod traits {
	pub use oif_storage::traits::*;
}

// API layer
pub use oif_api::{create_router, AppState};
// Re-export auth implementations for convenience
pub use oif_api::auth::{ApiKeyAuthenticator, MemoryRateLimiter, NoAuthenticator};

// Adapters
pub use oif_adapters::{AdapterRegistry, AdapterResult, SolverAdapter};

// Config
pub use oif_config::{load_config, log_service_info, log_startup_complete, Settings};

pub mod models {
	pub use oif_types::*;
}

pub mod storage {
	pub use oif_storage::*;
}

pub mod config {
	pub use oif_config::*;
}

pub mod adapters {
	pub use oif_adapters::*;
}

pub mod api {
	pub use oif_api::*;
	pub mod routes {
		pub use oif_api::{create_router, AppState};
	}
}

pub mod service {
	pub use oif_service::*;
}

pub mod mocks;

// Re-export so the aggregator binary can `use oif_aggregator::Sealer`.
// The canonical home for `Sealer` is `oif_types` (so other crates can
// depend on it without pulling in the whole aggregator).
pub use oif_types::Sealer;

use std::net::SocketAddr;
use std::sync::Arc;
use tracing::{info, warn};

// Re-export external dependencies for examples
pub use async_trait;
pub use reqwest;

/// Builder pattern for configuring the aggregator
pub struct AggregatorBuilder<S = MemoryStore, A = NoAuthenticator, R = MemoryRateLimiter>
where
	S: Storage + 'static,
	A: Authenticator + 'static,
	R: RateLimiter + 'static,
{
	settings: Option<Settings>,
	storage: S,
	authenticator: A,
	rate_limiter: R,
	adapter_registry: Option<oif_adapters::AdapterRegistry>,
	solvers: Vec<Solver>,
	job_processor_config: JobProcessorConfig,
}

impl<S> AggregatorBuilder<S, NoAuthenticator, MemoryRateLimiter>
where
	S: Storage + Clone + 'static,
{
	/// Create a new aggregator builder with the provided storage
	pub fn with_storage(storage: S) -> Self {
		Self {
			settings: None,
			storage,
			authenticator: NoAuthenticator,
			rate_limiter: MemoryRateLimiter::new(),
			adapter_registry: None,
			solvers: Vec::new(),
			job_processor_config: JobProcessorConfig::default(),
		}
	}
}

// Default constructor using MemoryStore for convenience
impl Default for AggregatorBuilder<MemoryStore, NoAuthenticator, MemoryRateLimiter> {
	fn default() -> Self {
		Self::new()
	}
}

impl AggregatorBuilder<MemoryStore, NoAuthenticator, MemoryRateLimiter> {
	/// Create a new aggregator builder with default memory storage
	pub fn new() -> Self {
		Self::with_storage(MemoryStore::new())
	}

	/// Create aggregator builder from configuration using default memory storage
	pub async fn from_config(settings: Settings) -> Self {
		Self::from_config_with_storage(settings, MemoryStore::new()).await
	}
}

impl<S, A, R> AggregatorBuilder<S, A, R>
where
	S: Storage + Clone + 'static,
	A: Authenticator + 'static,
	R: RateLimiter + 'static,
{
	/// Ensure adapter registry is initialized with defaults if not already set
	fn ensure_adapter_registry_initialized(&mut self) {
		if self.adapter_registry.is_none() {
			self.adapter_registry = Some(oif_adapters::AdapterRegistry::with_defaults());
		}
	}

	/// Validate that a solver's adapter_id exists in the adapter registry
	fn validate_solver_adapter(&self, solver: &Solver) -> Result<(), String> {
		if let Some(registry) = &self.adapter_registry {
			if registry.get(&solver.adapter_id).is_none() {
				return Err(format!(
					"Solver '{}' references unknown adapter_id '{}'. Available adapters: [{}]",
					solver.solver_id,
					solver.adapter_id,
					registry.get_adapter_ids().join(", ")
				));
			}
		}
		Ok(())
	}

	/// Common validation and storage logic for solvers
	async fn upsert_solver(&self, solver: &Solver, errors: &mut Vec<String>) {
		// Validate solver before creating
		if let Err(validation_error) = solver.validate() {
			errors.push(format!(
				"Solver '{}' validation failed: {}",
				solver.solver_id, validation_error
			));
			return;
		}

		// Validate adapter exists
		if let Err(adapter_error) = self.validate_solver_adapter(solver) {
			errors.push(adapter_error);
			return;
		}

		// Try to create solver in storage
		if let Err(storage_error) = self.storage.create_solver(solver.clone()).await {
			errors.push(format!(
				"Failed to create solver '{}': {}",
				solver.solver_id, storage_error
			));
		}
	}

	/// Convert solver configuration to Solver domain object
	fn solver_from_config(&self, solver_config: &oif_config::settings::SolverConfig) -> Solver {
		// Convert config layer SolverConfig to domain layer SolverConfig
		let domain_config: oif_types::SolverConfig = solver_config.clone().into();

		// Convert domain SolverConfig to domain Solver using TryFrom
		let mut solver =
			Solver::try_from(domain_config).expect("Failed to convert valid config to solver");

		// Set runtime status (source is already set in the conversion)
		solver.status = SolverStatus::Active;

		solver
	}

	/// Upsert all solvers (from settings and collected programmatically) into storage
	async fn upsert_all_solvers(&self, settings: &Settings) -> Result<(), String> {
		let mut errors = Vec::new();

		// Process solvers from configuration settings
		for solver_config in settings.enabled_solvers().values() {
			let solver = self.solver_from_config(solver_config);
			self.upsert_solver(&solver, &mut errors).await;
		}

		// Process solvers collected programmatically via with_solver() calls
		for solver in &self.solvers {
			self.upsert_solver(solver, &mut errors).await;
		}

		if !errors.is_empty() {
			return Err(format!(
				"Solver initialization errors found:\n{}",
				errors.join("\n")
			));
		}

		Ok(())
	}

	/// Set custom authenticator
	pub fn with_auth<NewA>(self, authenticator: NewA) -> AggregatorBuilder<S, NewA, R>
	where
		NewA: Authenticator + 'static,
	{
		AggregatorBuilder {
			settings: self.settings,
			storage: self.storage,
			authenticator,
			rate_limiter: self.rate_limiter,
			adapter_registry: self.adapter_registry,
			solvers: self.solvers,
			job_processor_config: self.job_processor_config,
		}
	}

	/// Set custom rate limiter
	pub fn with_rate_limiter<NewR>(self, rate_limiter: NewR) -> AggregatorBuilder<S, A, NewR>
	where
		NewR: RateLimiter + 'static,
	{
		AggregatorBuilder {
			settings: self.settings,
			storage: self.storage,
			authenticator: self.authenticator,
			rate_limiter,
			adapter_registry: self.adapter_registry,
			solvers: self.solvers,
			job_processor_config: self.job_processor_config,
		}
	}

	/// Register a custom adapter (uses adapter's own ID)
	/// Panics if adapter registration fails (this is intentional for startup-time configuration errors)
	pub fn with_adapter(mut self, adapter: Box<dyn SolverAdapter>) -> Self {
		let mut registry = self
			.adapter_registry
			.unwrap_or_else(oif_adapters::AdapterRegistry::with_defaults);
		registry.register(adapter).expect(
			"Failed to register adapter during startup - this is a fatal configuration error",
		);
		self.adapter_registry = Some(registry);
		self
	}

	/// Configure the job processor
	pub fn with_job_processor_config(mut self, config: JobProcessorConfig) -> Self {
		self.job_processor_config = config;
		self
	}
}

impl<S, A, R> AggregatorBuilder<S, A, R>
where
	S: Storage + Clone + 'static,
	A: Authenticator + 'static,
	R: RateLimiter + 'static,
{
	/// Create aggregator builder from configuration with any storage
	pub async fn from_config_with_storage(
		settings: Settings,
		storage: S,
	) -> AggregatorBuilder<S, NoAuthenticator, MemoryRateLimiter> {
		let mut builder = AggregatorBuilder {
			settings: Some(settings.clone()),
			storage,
			authenticator: NoAuthenticator,
			rate_limiter: MemoryRateLimiter::new(),
			adapter_registry: None,
			solvers: Vec::new(),
			job_processor_config: JobProcessorConfig::default(),
		};

		// Initialize adapter registry early for validation
		builder.ensure_adapter_registry_initialized();

		builder
	}
	/// Add a solver to the aggregator
	/// Note: Adapter validation will be performed when start() is called
	pub fn with_solver(mut self, solver: Solver) -> Self {
		self.solvers.push(solver);
		self
	}

	/// Set custom settings
	pub fn with_settings(mut self, settings: Settings) -> Self {
		self.settings = Some(settings);
		self
	}

	/// Get the current settings
	pub fn settings(&self) -> Option<&Settings> {
		self.settings.as_ref()
	}

	/// Initialize tracing with configuration-based settings
	fn init_tracing_from_settings(
		&self,
		settings: &Settings,
	) -> Result<(), Box<dyn std::error::Error>> {
		use oif_config::settings::LogFormat;

		// Create env filter using config level with RUST_LOG override
		let log_level = settings.get_log_level();
		let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
			.unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(log_level));

		// Initialize tracing with the configuration
		let logging_config = settings.get_logging();
		match logging_config.format {
			LogFormat::Json => {
				let subscriber = tracing_subscriber::fmt().json().with_env_filter(env_filter);

				if logging_config.structured {
					subscriber.with_target(true).with_thread_ids(true).init();
				} else {
					subscriber.init();
				}
			},
			LogFormat::Pretty => {
				let subscriber = tracing_subscriber::fmt()
					.pretty()
					.with_env_filter(env_filter);

				if logging_config.structured {
					subscriber.with_target(true).with_thread_ids(true).init();
				} else {
					subscriber.init();
				}
			},
			LogFormat::Compact => {
				let subscriber = tracing_subscriber::fmt()
					.compact()
					.with_env_filter(env_filter);

				if logging_config.structured {
					subscriber.with_target(true).with_thread_ids(true).init();
				} else {
					subscriber.init();
				}
			},
		}

		info!(
			"Logging configuration applied: level={}, format={:?}, structured={}",
			settings.get_log_level(),
			logging_config.format,
			logging_config.structured
		);

		Ok(())
	}

	/// Start the aggregator and return the configured router with state
	pub async fn start(mut self) -> Result<(axum::Router, AppState), Box<dyn std::error::Error>> {
		// Initialize the aggregator service
		let settings = self.settings.clone().unwrap_or_default();

		// Ensure adapter registry is initialized early for validation
		self.ensure_adapter_registry_initialized();

		// Upsert all solvers (from settings and programmatic calls) into storage
		self.upsert_all_solvers(&settings).await?;

		// Use the already-initialized adapter registry
		let adapter_registry = Arc::new(
			self.adapter_registry
				.take()
				.expect("Adapter registry should be initialized at this point"),
		);
		// Check solver count for logging
		let solver_count = self
			.storage
			.count_solvers()
			.await
			.map_err(|e| format!("Failed to get solver count: {}", e))?;

		info!("Successfully initialized with {} solver(s)", solver_count);

		// Get integrity secret wrapped in SecretString for secure handling
		let integrity_secret = settings
			.get_integrity_secret_secure()
		.map_err(|e| {
			format!(
				"Failed to resolve integrity secret: {}. Please set the INTEGRITY_SECRET environment variable with a secure random string (minimum 32 characters).",
				e
			)
			})?;

		// Initialize core services first
		let storage_arc: Arc<dyn Storage> = Arc::new(self.storage.clone());
		let integrity_service =
			Arc::new(IntegrityService::new(integrity_secret)) as Arc<dyn IntegrityTrait>;

		// Create circuit breaker
		let circuit_breaker = Arc::new(CircuitBreakerService::new(
			Arc::clone(&storage_arc),
			settings.get_circuit_breaker(),
		)) as Arc<dyn CircuitBreakerTrait>;

		let solver_filter_service = Arc::new(SolverFilterService::new(Arc::clone(&circuit_breaker)))
			as Arc<dyn SolverFilterTrait>;

		// Create an upgradable job scheduler (works immediately, gets upgraded later)
		let job_scheduler = Arc::new(UpgradableJobScheduler::new())
			as Arc<dyn oif_service::jobs::scheduler::JobScheduler>;

		// Create aggregator service
		let aggregator_service = AggregatorService::with_config(
			Arc::clone(&storage_arc),
			Arc::clone(&adapter_registry),
			Arc::clone(&integrity_service),
			Arc::clone(&solver_filter_service),
			settings.get_aggregation().into(),
			Some(Arc::clone(&job_scheduler)),
		);

		let aggregator_service =
			Arc::new(aggregator_service) as Arc<dyn oif_service::AggregatorTrait>;
		let solver_service = Arc::new(SolverService::new(
			Arc::clone(&storage_arc),
			Arc::clone(&adapter_registry),
			Some(Arc::clone(&job_scheduler)),
			Arc::clone(&circuit_breaker),
		)) as Arc<dyn SolverServiceTrait>;

		// Create the order service with the upgradable scheduler
		let order_service_impl = oif_service::order::OrderService::new(
			Arc::clone(&storage_arc),
			Arc::clone(&adapter_registry),
			Arc::clone(&integrity_service),
			Arc::clone(&job_scheduler),
			Arc::clone(&circuit_breaker),
		);
		let order_service =
			Arc::new(order_service_impl) as Arc<dyn oif_service::order::OrderServiceTrait>;

		// Create the job handler with all real services
		let job_handler = Arc::new(BackgroundJobHandler::new(
			Arc::clone(&storage_arc),
			Arc::clone(&adapter_registry),
			Arc::clone(&solver_service),
			Arc::clone(&aggregator_service),
			Arc::clone(&integrity_service),
			Arc::clone(&order_service),
			Arc::clone(&job_scheduler),
			settings.clone(),
			Arc::clone(&circuit_breaker),
		));

		// Create the JobProcessor with the real handler
		let job_processor = JobProcessor::new(
			job_handler as Arc<dyn oif_service::jobs::processor::JobHandler>,
			self.job_processor_config.clone(),
		)
		.map_err(|e| format!("Failed to initialize job processor: {}", e))?;
		let job_processor_arc = Arc::new(job_processor);

		// Upgrade the scheduler with the JobProcessor
		if let Some(upgradable_scheduler) = job_scheduler
			.as_any()
			.downcast_ref::<UpgradableJobScheduler>()
		{
			upgradable_scheduler
				.initialize_processor(Arc::clone(&job_processor_arc))
				.await;
		}

		// Schedule recurring maintenance jobs
		self.schedule_recurring_jobs(&job_processor_arc).await;

		info!("Background job processor initialized and solver initialization jobs submitted");

		// Setup Auth and Rate Limiting.
		//
		// The previous design used a single hardcoded admin key
		// (`the old shared admin key`) shared by every dashboard. That meant
		// anyone with the dashboard source could read/write any
		// operator's data on the aggregator. We now resolve the
		// incoming `x-api-key` against the `operators.api_key` column
		// (one per operator, generated server-side at registration).
		//
		// Both the Postgres and Memory stores implement
		// `OperatorStorageTrait::get_operator_by_api_key`, so tests
		// using the in-memory store keep working.
		let storage_for_auth: Arc<dyn oif_types::storage::OperatorStorageTrait> = storage_arc.clone();
		let db_api_key_auth = oif_api::auth::authenticators::DbApiKeyAuthenticator::new(storage_for_auth);
		let jwt_auth = oif_api::auth::authenticators::JwtAuthenticator::new("recoilpay_jwt_secret_2026".to_string());
		let combined_auth = oif_api::auth::authenticators::CombinedAuthenticator::new(jwt_auth, Arc::new(db_api_key_auth));

		let authenticator = Arc::new(combined_auth);
		let rate_limiter = Arc::new(oif_api::auth::rate_limit::MemoryRateLimiter::new());
		// Worker endpoints self-authenticate via signed `x-auth-*` headers
		// (handled by the handlers themselves + NonceCache), so they bypass
		// the API-key/JWT auth middleware.
		let mut auth_config = oif_api::auth::middleware::AuthConfig::default();
		auth_config
			.public_paths
			.push("/solver-api/workers".to_string());
		let fill_worker_nonce_cache =
			Arc::new(oif_api::auth::fill_worker_auth::NonceCache::default());
		let order_broadcaster = oif_api::order_broadcast::OrderBroadcaster::default();

		// Chain registry: settlement contracts + tokens + RPC endpoints
		// per chain. Baked-in testnet defaults, overridable via
		// CHAIN_RPCS / CHAIN_REGISTRY_JSON.
		let chain_registry = Arc::new(oif_config::ChainRegistry::from_env());
		info!(
			chains = ?chain_registry.chain_ids(),
			"chain registry loaded"
		);

		// Gift card settlement. The key is read from the environment rather
		// than config so it never lands in a file; without it the client
		// reports itself disabled and the gift card endpoints refuse trades
		// instead of accepting ones nobody could ever pay out.
		let giftcard_escrow = Arc::new(oif_service::GiftCardEscrowClient::new(
			Arc::clone(&chain_registry),
			std::env::var("GIFTCARD_ATTESTOR_KEY").ok().as_deref(),
		));
		if !giftcard_escrow.is_enabled() {
			warn!("GIFTCARD_ATTESTOR_KEY is not set — gift card trades cannot be settled");
		}

		// Create application state
		let app_state = AppState {
			aggregator_service,
			order_service,
			solver_service,
			storage: storage_arc,
			giftcard_escrow: Arc::clone(&giftcard_escrow),
			integrity_service,
			job_processor: job_processor_arc,
			authenticator,
			rate_limiter,
			auth_config,
			fill_worker_nonce_cache,
			order_broadcaster,
			// Operator fill-wallet encryption. The sealer is mandatory
			// for the multi-tenant fill flow: registration refuses to run
			// without it, and the /sign-fill endpoint refuses to serve
			// without it. If the env var is missing we log a warning and
			// keep going — operators can still register once it's
			// configured and the service is restarted, but in-flight
			// registrations will return 503.
			sealer: match Sealer::from_env() {
				Ok(s) => {
					info!("fill-wallet sealer loaded from FILL_WALLET_ENCRYPTION_KEY");
					Some(Arc::new(s))
				}
				Err(e) => {
					warn!(
						error = %e,
						"fill-wallet sealer not configured; \
						 registration + sign-fill will return 503 until FILL_WALLET_ENCRYPTION_KEY is set"
					);
					None
				}
			},
			chain_registry,
			// Shared secret for the hosted fill-worker's server-to-server
			// calls. Optional: when unset, worker-facing endpoints fall
			// back to the standard api-key/JWT auth (and the worker's
			// calls will be rejected until it is configured).
			worker_token: match std::env::var("FILL_WORKER_TOKEN") {
				Ok(t) if !t.trim().is_empty() => {
					info!("fill-worker token loaded from FILL_WORKER_TOKEN");
					Some(t)
				}
				_ => {
					warn!(
						"FILL_WORKER_TOKEN not set; the hosted fill-worker cannot \
						 authenticate to sign-fill / status endpoints until it is"
					);
					None
				}
			},
		};

		// Create router with state
		let router = create_router()
			.layer(axum::middleware::from_fn_with_state(
				app_state.clone(),
				oif_api::auth::middleware::auth_middleware,
			))
			.with_state(app_state.clone());

		Ok((router, app_state))
	}

	/// Start the complete server with all defaults and setup
	/// This method handles everything needed to run the server, including:
	/// - Loading .env file
	/// - Loading configuration with defaults
	/// - Initializing tracing
	/// - Starting TTL cleanup
	/// - Binding and serving the application
	pub async fn start_server(mut self) -> Result<(), Box<dyn std::error::Error>> {
		// Load .env file if it exists
		dotenvy::dotenv().ok();

		// Use provided settings or load from config with defaults
		let using_provided_settings = self.settings.is_some();
		let settings = if using_provided_settings {
			self.settings.take().unwrap()
		} else {
			load_config().unwrap_or_else(|e| {
				println!("Failed to load config: {:?}", e);
				Settings::default()
			})
		};

		// Initialize tracing with configuration-based settings
		self.init_tracing_from_settings(&settings)?;

		// Log comprehensive service startup information
		log_service_info();

		info!(
			"Using configuration: loaded from {}",
			if using_provided_settings {
				"provided settings"
			} else {
				"config file or defaults"
			}
		);
		info!("Configuration loaded successfully");

		// Validate configuration early - fail fast if invalid
		if let Err(e) = settings.validate() {
			return Err(format!("Configuration validation failed: {}", e).into());
		}

		info!("🔧 Configuring OIF Aggregator server");
		// Log enabled solvers
		let enabled_solvers = settings.enabled_solvers();
		info!("Enabled solvers: {}", enabled_solvers.len());
		for (id, solver) in &enabled_solvers {
			info!("  - {}: {}", id, solver.endpoint);
		}

		// Parse bind address
		let bind_addr = settings.bind_address();
		let addr: SocketAddr = bind_addr
			.parse()
			.map_err(|e| format!("Invalid bind address '{}': {}", bind_addr, e))?;

		// Ensure we have proper configuration in the builder
		if self.settings.is_none() {
			self.settings = Some(settings.clone());
		}

		// Create the router using the builder pattern
		let (app, app_state) = self.start().await?;

		// TTL cleanup is storage-specific and should be handled by the storage implementation
		info!("Storage backend initialized successfully");

		// Gift card trades have deadlines, and a deadline with nobody
		// watching it is not a deadline. Without this task running, a party
		// holding the leg no contract can verify could keep both the card
		// and the money simply by never replying. Spawned here rather than
		// as a scheduled job because it must outlive any one request and
		// needs no coordination with the job queue.
		{
			let resolver = GiftCardResolver::new(app_state.storage.clone());
			tokio::spawn(resolver.run());
			info!("Gift card deadline resolver spawned");

			// Separate from the resolver because terminal trades arrive from
			// two places — a deadline firing and a merchant attesting — and
			// both should drain through one implementation of "who gets
			// paid". It no-ops loudly when no attestor key is configured.
			let payouts = GiftCardPayoutWorker::new(
				app_state.storage.clone(),
				app_state.giftcard_escrow.clone(),
			);
			tokio::spawn(payouts.run());
		}

		// Start the server
		let listener = tokio::net::TcpListener::bind(addr).await?;

		// Log startup completion with comprehensive information
		log_startup_complete(&bind_addr);
		info!("API endpoints available:");
		info!("  GET  /health");
		info!("  POST /api/v1/quotes");
		info!("  POST /api/v1/orders");
		info!("  GET  /api/v1/orders/{{id}}");
		info!("  GET  /api/v1/solvers");
		info!("  GET  /api/v1/solvers/{{id}}");
		info!("  GET  /api/v1/chains");
		if cfg!(feature = "openapi") {
			info!("  GET  /swagger-ui");
			info!("  GET  /api-docs/openapi.json");
		}

		// Apply global rate limiting based on settings at the make_service level
		let rate_cfg = &settings.get_environment().rate_limiting;
		if rate_cfg.enabled {
			use std::time::Duration;
			use tower::limit::RateLimitLayer;
			use tower::ServiceBuilder;
			let make_svc = ServiceBuilder::new()
				.layer(RateLimitLayer::new(
					rate_cfg.requests_per_minute as u64,
					Duration::from_secs(60),
				))
				.service(app.into_make_service());
			axum::serve(listener, make_svc).await?;
		} else {
			axum::serve(listener, app).await?;
		}

		Ok(())
	}

	/// Schedule recurring maintenance jobs for the system
	async fn schedule_recurring_jobs(&self, job_processor: &Arc<JobProcessor>) {
		// Schedule health checks for all solvers every 5 minutes (run immediately on startup)
		if let Err(e) = job_processor
			.schedule_job(
				1,
				BackgroundJob::AllSolversHealthCheck,
				"Periodic health check for all solvers".to_string(),
				Some("health-check-all-solvers".to_string()), // ID used for both scheduling and deduplication
				true,                                         // Run immediately on startup
				None, // No retry policy for now, but could be added if needed
			)
			.await
		{
			warn!("Failed to schedule health check job: {}", e);
		} else {
			info!("Scheduled health checks to run immediately and then every 5 minutes for all solvers");
		}

		// Schedule asset fetching for all solvers every 20 minutes (run immediately on startup)
		if let Err(e) = job_processor
			.schedule_job(
				20, // 20 minutes
				BackgroundJob::AllSolversFetchAssets,
				"Periodic asset fetch for all solvers".to_string(),
				Some("fetch-assets-all-solvers".to_string()), // ID used for both scheduling and deduplication
				true,                                         // Run immediately on startup
				None, // No retry policy for now, but could be added if needed
			)
			.await
		{
			warn!("Failed to schedule asset fetch job: {}", e);
		} else {
			info!("Scheduled asset fetching to run immediately and then every 20 minutes for all solvers");
		}

		// Schedule orders cleanup once a day (24 * 60 = 1440 minutes)
		if let Err(e) = job_processor
			.schedule_job(
				1440, // 24 hours (1440 minutes)
				BackgroundJob::OrdersCleanup,
				"Daily cleanup of old orders in final status".to_string(),
				Some("orders-cleanup-daily".to_string()), // ID used for both scheduling and deduplication
				true,                                     // Run immediately on startup
				None, // No retry policy for now, but could be added if needed
			)
			.await
		{
			warn!("Failed to schedule orders cleanup job: {}", e);
		} else {
			info!("Scheduled daily orders cleanup to run every 24 hours");
		}

		// Schedule metrics cleanup (always enabled since metrics collection is always on)
		if let Some(ref settings) = self.settings {
			let cleanup_interval_hours = settings.get_metrics_cleanup_interval_hours();
			let cleanup_interval_minutes = cleanup_interval_hours * 60;

			if let Err(e) = job_processor
				.schedule_job(
					cleanup_interval_minutes as u64,
					BackgroundJob::MetricsCleanup,
					format!(
						"Cleanup of old time-series metrics data (retention: {}h)",
						settings.get_metrics_retention_hours()
					),
					Some("metrics-cleanup-periodic".to_string()),
					false, // Don't run immediately on startup, wait for first interval
					None,  // No retry policy for now
				)
				.await
			{
				warn!("Failed to schedule metrics cleanup job: {}", e);
			} else {
				info!(
					"Scheduled metrics cleanup to run every {} hours (retention: {} hours)",
					cleanup_interval_hours,
					settings.get_metrics_retention_hours()
				);
			}
		}
	}
}
