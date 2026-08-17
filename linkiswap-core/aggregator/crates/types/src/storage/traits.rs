//! Storage traits for pluggable storage implementations

use crate::{CircuitBreakerState, MetricsTimeSeries, Operator, Order, RollingMetrics, Solver, SolverQuote, StorageResult, VaultBalance};
use async_trait::async_trait;
use chrono::{DateTime, Utc};

/// Generic repository abstraction for basic CRUD operations over an entity type.
///
/// Object-safe variant with `&str` identifiers so it works with trait objects.
#[async_trait]
pub trait Repository<Entity>: Send + Sync {
	async fn create(&self, entity: Entity) -> StorageResult<Entity>;
	async fn get(&self, id: &str) -> StorageResult<Option<Entity>>;
	async fn update(&self, entity: Entity) -> StorageResult<Entity>;
	async fn delete(&self, id: &str) -> StorageResult<bool>;
	async fn count(&self) -> StorageResult<usize>;

	/// List all entities
	async fn list_all(&self) -> StorageResult<Vec<Entity>>;

	/// List entities using offset/limit pagination
	async fn list_paginated(&self, offset: usize, limit: usize) -> StorageResult<Vec<Entity>>;
}

/// Trait for order storage operations (CRUD naming)
#[async_trait]
pub trait OrderStorageTrait: Repository<Order> + Send + Sync {
	/// Get orders with a specific status
	async fn get_by_status(&self, status: crate::OrderStatus) -> StorageResult<Vec<Order>>;

	/// Get orders in final status (Finalized or any Failed)
	async fn get_finalised(&self) -> StorageResult<Vec<Order>>;

	/// Atomically lease up to `limit` unclaimed, non-terminal orders to
	/// `worker_id` for `lease_secs`.
	///
	/// This is the durable replacement for pushing orders down a
	/// fire-and-forget broadcast channel: an order stays in the queue
	/// until a worker actually takes it, so a disconnected or restarting
	/// worker costs latency rather than losing the order.
	///
	/// Concurrent workers are safe — the Postgres implementation uses
	/// `FOR UPDATE SKIP LOCKED`, so each order goes to exactly one
	/// worker. Orders whose lease has expired become claimable again,
	/// which recovers work from a worker that died mid-settlement.
	///
	/// `max_attempts` caps redelivery so an order that keeps killing its
	/// handler is not retried forever.
	async fn claim_orders(
		&self,
		worker_id: &str,
		limit: usize,
		lease_secs: i64,
		max_attempts: i32,
	) -> StorageResult<Vec<Order>>;

	/// Release a claim without completing it, returning the order to the
	/// pool immediately (used when a worker rejects an order it cannot
	/// handle, e.g. an unsupported chain).
	async fn release_claim(&self, order_id: &str) -> StorageResult<bool>;

	/// Extend the lease on an in-progress order. Settlement spans three
	/// on-chain transactions and can outlive the initial lease, so the
	/// worker heartbeats progress through this.
	async fn extend_claim(
		&self,
		order_id: &str,
		worker_id: &str,
		lease_secs: i64,
	) -> StorageResult<bool>;
}

/// Trait for solver storage operations (CRUD naming)
#[async_trait]
pub trait SolverStorageTrait: Repository<Solver> + Send + Sync {
	/// Get active solvers only
	async fn get_active(&self) -> StorageResult<Vec<Solver>>;
}

/// Trait for solver quote inventory storage operations
#[async_trait]
pub trait SolverQuoteStorageTrait: Send + Sync {
	/// Persist a new solver quote
	async fn create_solver_quote(&self, quote: SolverQuote) -> StorageResult<SolverQuote>;

	/// List all quotes (optionally filtered by solver_id)
	async fn list_solver_quotes(
		&self,
		solver_id: Option<&str>,
	) -> StorageResult<Vec<SolverQuote>>;

	/// Delete a quote by ID
	async fn delete_solver_quote(&self, id: &str) -> StorageResult<bool>;

	/// Toggle the paused flag on a quote
	async fn toggle_pause_solver_quote(&self, id: &str) -> StorageResult<Option<SolverQuote>>;
}

/// Trait for circuit breaker state storage operations
#[async_trait]
pub trait CircuitBreakerStorageTrait: Send + Sync {
	/// Get circuit breaker state for a solver
	async fn get_circuit_state(
		&self,
		solver_id: &str,
	) -> StorageResult<Option<CircuitBreakerState>>;

	/// Update or create circuit breaker state for a solver
	async fn update_circuit_state(&self, state: CircuitBreakerState) -> StorageResult<()>;

	/// Delete circuit breaker state for a solver
	async fn delete_circuit_state(&self, solver_id: &str) -> StorageResult<bool>;

	/// List all circuit breaker states
	async fn list_circuit_states(&self) -> StorageResult<Vec<CircuitBreakerState>>;

	/// Clean up circuit breaker states older than the specified timestamp
	async fn cleanup_stale_circuits(&self, older_than: DateTime<Utc>) -> StorageResult<usize>;
}

/// Trait for operator (push-quote publisher) storage operations.
///
/// Operators are the entities that submit quotes via the dashboard. The
/// push-quote ranker reads operator reputation to score quotes.
#[async_trait]
pub trait OperatorStorageTrait: Send + Sync {
	/// Insert or replace an operator row (idempotent on `solver_id`).
	async fn upsert_operator(&self, operator: Operator) -> StorageResult<Operator>;

	/// Fetch an operator by their `solver_id`.
	async fn get_operator(&self, solver_id: &str) -> StorageResult<Option<Operator>>;

	/// Fetch an operator by their dashboard API key. Used by the auth
	/// middleware to resolve every incoming `x-api-key` to an operator
	/// row. The DB has a unique index on `api_key` so this is O(1).
	async fn get_operator_by_api_key(
		&self,
		api_key: &str,
	) -> StorageResult<Option<Operator>>;

	/// List all operators (e.g. for the dashboard leaderboard).
	async fn list_operators(&self) -> StorageResult<Vec<Operator>>;

	/// Increment fill counters and update rolling latency. Returns the new
	/// reputation score after the update.
	async fn record_fill_outcome(
		&self,
		solver_id: &str,
		succeeded: bool,
		latency_ms: u64,
	) -> StorageResult<f64>;

	/// Record a heartbeat from the operator's fill-worker.
	async fn record_heartbeat(&self, solver_id: &str) -> StorageResult<()>;

	/// Set the `fill_worker_url` field.
	async fn set_fill_worker_url(
		&self,
		solver_id: &str,
		url: Option<String>,
	) -> StorageResult<()>;

	/// Set / upsert a single (chain_id, contract_address) entry in the
	/// operator's settlement-contracts map.
	async fn set_settlement_contract(
		&self,
		solver_id: &str,
		chain_id: u64,
		address: String,
	) -> StorageResult<()>;

	/// Look up the settlement contract for an operator on a specific chain.
	/// Returns `None` if the operator hasn't registered one for that chain.
	async fn get_settlement_contract(
		&self,
		solver_id: &str,
		chain_id: u64,
	) -> StorageResult<Option<String>>;

	/// Remove the settlement contract entry for one chain. Returns the
	/// number of rows whose JSONB map changed — i.e. `0` if no entry
	/// existed for that chain, `1` if the entry was deleted. Useful for
	/// the dashboard's "Remove contract" button so it can distinguish a
	/// successful no-op from a real delete.
	async fn delete_settlement_contract(
		&self,
		solver_id: &str,
		chain_id: u64,
	) -> StorageResult<u64>;

	/// Queue a freshly-minted hot-wallet private key for the operator's
	/// fill-worker to pull on next boot. Stored alongside the operator
	/// row; wiped as soon as `take_pending_identity` consumes it.
	///
	/// Security model:
	/// - Plaintext at rest (same as the previous "push from dashboard" path).
	///   Acceptable here because the same database row already lives
	///   behind Render's private network + Postgres TLS.
	/// - Single-shot: `take_pending_identity` returns the value once and
	///   then NULLs it out. Subsequent calls return `None`.
	/// - TTL-bounded: rows older than `PENDING_IDENTITY_TTL_SECS` are
	///   purged on `take_pending_identity` so a stale entry doesn't
	///   linger if the worker never boots.
	async fn set_pending_identity(
		&self,
		solver_id: &str,
		private_key: String,
	) -> StorageResult<()>;

	/// Pull-and-clear the pending identity, if one is queued and not
	/// expired. Returns `Some(private_key)` exactly once per
	/// `set_pending_identity`; subsequent calls return `None`.
	async fn take_pending_identity(
		&self,
		solver_id: &str,
	) -> StorageResult<Option<String>>;

	/// Clear any pending identity without returning it. Used when the
	/// dashboard cancels a key rotation.
	async fn clear_pending_identity(&self, solver_id: &str) -> StorageResult<()>;

	/// Persist the AES-256-GCM ciphertext of the operator's fill-wallet
	/// private key. `ciphertext` is the raw output of `Sealer::seal` —
	/// `nonce(12) || ciphertext || tag(16)`. Called once at registration
	/// time after the aggregator generates the fill-wallet keypair.
	async fn set_encrypted_fill_wallet_key(
		&self,
		solver_id: &str,
		ciphertext: Vec<u8>,
	) -> StorageResult<()>;

	/// Fetch the encrypted fill-wallet key. Returns `None` when the
	/// operator hasn't been registered yet, or for legacy operators
	/// registered before this migration.
	async fn get_encrypted_fill_wallet_key(
		&self,
		solver_id: &str,
	) -> StorageResult<Option<Vec<u8>>>;
}

/// Trait for fill-worker registry operations.
///
/// Workers are **multi-tenant**: a single fill-worker fleet fills
/// orders for every operator on the platform, so workers register
/// themselves with the aggregator (rather than the dashboard
/// registering them on the operator's behalf like `operators`).
#[async_trait]
pub trait WorkerStorageTrait: Send + Sync {
	/// Idempotent worker registration. Creates the row if it doesn't
	/// exist; updates `public_url` and bumps `last_active_at` if it
	/// does. Workers call this once on boot and again whenever their
	/// self-reported URL changes.
	async fn register_worker(
		&self,
		worker_id: &str,
		public_url: &str,
	) -> StorageResult<()>;

	/// Liveness ping from a worker. Bumps `last_active_at`. No-op if
	/// the worker hasn't registered yet (the next register call will
	/// set `last_active_at` to now).
	async fn worker_heartbeat(&self, worker_id: &str) -> StorageResult<()>;

	/// Read the worker's self-reported public URL. Used by the
	/// `/ws/orders` subscription handler so it knows which worker(s)
	/// to forward orders to. Returns `None` for unknown workers.
	async fn get_worker(&self, worker_id: &str) -> StorageResult<Option<String>>;
}

/// Trait for operator-attested vault balance storage.
///
/// The aggregator does **not** read on-chain ERC-20 balances directly
/// (that requires a multi-chain RPC registry + ABI-encoded calls + a
/// price oracle, none of which exist yet). Until the vault contract
/// is designed and deployed, balances are operator-reported: the
/// dashboard reads balances from the operator's wallet UI, asks the
/// operator to confirm, then POSTs to `/solver-api/vaults/snapshot`.
///
/// Each row is keyed by `(solver_id, chain, asset_address)` and is
/// upserted on every snapshot — operators can refresh as often as
/// they want. The aggregator treats the row as best-effort truth;
/// it is **not** authoritative for fill-time escrow.
#[async_trait]
pub trait VaultStorageTrait: Send + Sync {
	/// Upsert one (chain, asset) balance row. On conflict (same
	/// operator reports the same chain+asset twice) we update
	/// `available` and bump `updated_at`. `locked` is preserved —
	/// only the operator's `available` is overwritten.
	async fn upsert_vault_balance(&self, balance: VaultBalance) -> StorageResult<()>;

	/// Read all balance rows for one operator. Used by
	/// `GET /solver-api/vaults`. Returns rows in `(chain, symbol)`
	/// order so the dashboard renders consistently.
	async fn list_vault_balances(&self, solver_id: &str) -> StorageResult<Vec<VaultBalance>>;

	/// Delete one (chain, asset) row. Useful when an operator
	/// removes a token from their dashboard tracking. Returns
	/// `true` if a row was actually deleted.
	async fn delete_vault_balance(
		&self,
		solver_id: &str,
		chain: &str,
		asset_address: &str,
	) -> StorageResult<bool>;
}

/// Trait for metrics time-series storage operations
#[async_trait]
pub trait MetricsStorageTrait: Send + Sync {
	/// Update or create metrics time-series for a solver
	async fn update_metrics_timeseries(
		&self,
		solver_id: &str,
		timeseries: MetricsTimeSeries,
	) -> StorageResult<()>;

	/// Get metrics time-series for a solver
	async fn get_metrics_timeseries(
		&self,
		solver_id: &str,
	) -> StorageResult<Option<MetricsTimeSeries>>;

	/// Get rolling metrics for a solver for specific time windows
	async fn get_rolling_metrics(&self, solver_id: &str) -> StorageResult<Option<RollingMetrics>>;

	/// Delete metrics time-series for a solver
	async fn delete_metrics_timeseries(&self, solver_id: &str) -> StorageResult<bool>;

	/// Get all solver IDs that have metrics data
	async fn list_solvers_with_metrics(&self) -> StorageResult<Vec<String>>;

	/// Clean up metrics data older than the specified timestamp
	async fn cleanup_old_metrics(&self, older_than: DateTime<Utc>) -> StorageResult<usize>;

	/// Get the total number of metrics time-series records
	async fn count_metrics_timeseries(&self) -> StorageResult<usize>;
}

/// Main storage trait that combines all storage operations
#[async_trait]
pub trait StorageTrait:
	OrderStorageTrait
	+ SolverStorageTrait
	+ MetricsStorageTrait
	+ CircuitBreakerStorageTrait
	+ SolverQuoteStorageTrait
	+ OperatorStorageTrait
	+ WorkerStorageTrait
	+ VaultStorageTrait
{
	/// Health check for the storage system
	async fn health_check(&self) -> StorageResult<bool>;

	/// Close the storage connection
	async fn close(&self) -> StorageResult<()>;

	// ===============================
	// Solver convenience methods
	// ===============================

	/// List all solvers
	async fn list_all_solvers(&self) -> StorageResult<Vec<Solver>> {
		<Self as Repository<Solver>>::list_all(self).await
	}

	/// List solvers with pagination
	async fn list_solvers_paginated(
		&self,
		offset: usize,
		limit: usize,
	) -> StorageResult<Vec<Solver>> {
		<Self as Repository<Solver>>::list_paginated(self, offset, limit).await
	}

	/// Count total solvers
	async fn count_solvers(&self) -> StorageResult<usize> {
		<Self as Repository<Solver>>::count(self).await
	}

	/// Get a specific solver by ID
	async fn get_solver(&self, id: &str) -> StorageResult<Option<Solver>> {
		<Self as Repository<Solver>>::get(self, id).await
	}

	/// Create a new solver
	async fn create_solver(&self, solver: Solver) -> StorageResult<Solver> {
		<Self as Repository<Solver>>::create(self, solver).await
	}

	/// Update an existing solver
	async fn update_solver(&self, solver: Solver) -> StorageResult<Solver> {
		<Self as Repository<Solver>>::update(self, solver).await
	}

	/// Delete a solver by ID
	async fn delete_solver(&self, id: &str) -> StorageResult<bool> {
		<Self as Repository<Solver>>::delete(self, id).await
	}

	/// Get active solvers only
	async fn get_active_solvers(&self) -> StorageResult<Vec<Solver>> {
		<Self as SolverStorageTrait>::get_active(self).await
	}

	// ===============================
	// Order convenience methods
	// ===============================

	/// List all orders
	async fn list_all_orders(&self) -> StorageResult<Vec<Order>> {
		<Self as Repository<Order>>::list_all(self).await
	}

	/// List orders with pagination
	async fn list_orders_paginated(
		&self,
		offset: usize,
		limit: usize,
	) -> StorageResult<Vec<Order>> {
		<Self as Repository<Order>>::list_paginated(self, offset, limit).await
	}

	/// Count total orders
	async fn count_orders(&self) -> StorageResult<usize> {
		<Self as Repository<Order>>::count(self).await
	}

	/// Get a specific order by ID
	async fn get_order(&self, id: &str) -> StorageResult<Option<Order>> {
		<Self as Repository<Order>>::get(self, id).await
	}

	/// Create a new order
	async fn create_order(&self, order: Order) -> StorageResult<Order> {
		<Self as Repository<Order>>::create(self, order).await
	}

	/// Update an existing order
	async fn update_order(&self, order: Order) -> StorageResult<Order> {
		<Self as Repository<Order>>::update(self, order).await
	}

	/// Delete an order by ID
	async fn delete_order(&self, id: &str) -> StorageResult<bool> {
		<Self as Repository<Order>>::delete(self, id).await
	}

	/// Get orders by status
	async fn get_orders_by_status(&self, status: crate::OrderStatus) -> StorageResult<Vec<Order>> {
		<Self as OrderStorageTrait>::get_by_status(self, status).await
	}

	/// Get orders in final status (Finalized or any Failed)
	async fn get_finalised_orders(&self) -> StorageResult<Vec<Order>> {
		<Self as OrderStorageTrait>::get_finalised(self).await
	}

	// ===============================
	// Metrics convenience methods
	// ===============================

	/// Update or create metrics time-series for a solver
	async fn update_solver_metrics_timeseries(
		&self,
		solver_id: &str,
		timeseries: MetricsTimeSeries,
	) -> StorageResult<()> {
		<Self as MetricsStorageTrait>::update_metrics_timeseries(self, solver_id, timeseries).await
	}

	/// Get metrics time-series for a solver
	async fn get_solver_metrics_timeseries(
		&self,
		solver_id: &str,
	) -> StorageResult<Option<MetricsTimeSeries>> {
		<Self as MetricsStorageTrait>::get_metrics_timeseries(self, solver_id).await
	}

	/// Get rolling metrics for a solver for specific time windows
	async fn get_solver_rolling_metrics(
		&self,
		solver_id: &str,
	) -> StorageResult<Option<RollingMetrics>> {
		<Self as MetricsStorageTrait>::get_rolling_metrics(self, solver_id).await
	}

	/// Delete metrics time-series for a solver
	async fn delete_solver_metrics_timeseries(&self, solver_id: &str) -> StorageResult<bool> {
		<Self as MetricsStorageTrait>::delete_metrics_timeseries(self, solver_id).await
	}

	/// Get all solver IDs that have metrics data
	async fn list_all_solvers_with_metrics(&self) -> StorageResult<Vec<String>> {
		<Self as MetricsStorageTrait>::list_solvers_with_metrics(self).await
	}

	/// Clean up metrics data older than the specified timestamp
	async fn cleanup_old_solver_metrics(&self, older_than: DateTime<Utc>) -> StorageResult<usize> {
		<Self as MetricsStorageTrait>::cleanup_old_metrics(self, older_than).await
	}

	/// Get the total number of metrics time-series records
	async fn count_solver_metrics_timeseries(&self) -> StorageResult<usize> {
		<Self as MetricsStorageTrait>::count_metrics_timeseries(self).await
	}

	// ===============================
	// Circuit breaker convenience methods
	// ===============================

	/// Get circuit breaker state for a solver
	async fn get_solver_circuit_state(
		&self,
		solver_id: &str,
	) -> StorageResult<Option<CircuitBreakerState>> {
		<Self as CircuitBreakerStorageTrait>::get_circuit_state(self, solver_id).await
	}

	/// Update or create circuit breaker state for a solver
	async fn update_solver_circuit_state(&self, state: CircuitBreakerState) -> StorageResult<()> {
		<Self as CircuitBreakerStorageTrait>::update_circuit_state(self, state).await
	}

	/// Delete circuit breaker state for a solver
	async fn delete_solver_circuit_state(&self, solver_id: &str) -> StorageResult<bool> {
		<Self as CircuitBreakerStorageTrait>::delete_circuit_state(self, solver_id).await
	}

	/// List all circuit breaker states
	async fn list_all_circuit_states(&self) -> StorageResult<Vec<CircuitBreakerState>> {
		<Self as CircuitBreakerStorageTrait>::list_circuit_states(self).await
	}

	/// Clean up stale circuit breaker states
	async fn cleanup_stale_solver_circuits(
		&self,
		older_than: DateTime<Utc>,
	) -> StorageResult<usize> {
		<Self as CircuitBreakerStorageTrait>::cleanup_stale_circuits(self, older_than).await
	}
}
