//! In-memory storage implementation using DashMap

use crate::traits::{MetricsStorage, OrderStorage, SolverStorage, Storage, StorageResult};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use oif_types::storage::CircuitBreakerStorageTrait;
use oif_types::storage::OperatorStorageTrait;
use oif_types::storage::VaultStorageTrait;
use oif_types::storage::WorkerStorageTrait;
use oif_types::storage::SolverQuoteStorageTrait;
use oif_types::{
	storage::Repository, CircuitBreakerState, MetricsTimeSeries, Operator, Order, RollingMetrics,
	Solver, SolverQuote, VaultBalance,
};
use std::sync::Arc;

/// In-memory storage for solvers, quotes, and orders
///
/// Performance optimization: MetricsTimeSeries is wrapped in Arc to avoid expensive
/// cloning of large time-series data structures. This significantly improves performance
/// for read operations while only cloning when the trait interface requires owned values.
#[derive(Clone)]
pub struct MemoryStore {
	pub solvers: Arc<DashMap<String, Solver>>,
	pub orders: Arc<DashMap<String, Order>>,
	pub metrics_timeseries: Arc<DashMap<String, Arc<MetricsTimeSeries>>>,
	pub circuit_states: Arc<DashMap<String, CircuitBreakerState>>,
	pub solver_quotes: Arc<DashMap<String, SolverQuote>>,
	pub operators: Arc<DashMap<String, Operator>>,
	/// Pending hot-wallet private keys queued by the dashboard for the
	/// worker's next-boot poll. Stored alongside the operator row so a
	/// restart of this in-memory store loses them (acceptable for tests).
	pub pending_identities: Arc<DashMap<String, (String, DateTime<Utc>)>>,
	/// Encrypted fill-wallet private keys, keyed by `solver_id`. Stored
	/// alongside the operator row so the in-memory store's lifetime
	/// matches the operator's lifetime.
	pub encrypted_fill_wallet_keys: Arc<DashMap<String, Vec<u8>>>,
	/// Worker registry: `worker_id` → `(public_url, last_active_at)`.
	/// Workers self-register on boot via `POST /solver-api/workers/{id}`.
	pub workers: Arc<DashMap<String, (String, DateTime<Utc>)>>,

	/// Vault balance snapshots, keyed by
	/// `{solver_id}::{chain}::{asset_address}` (all lower-cased) so the
	/// in-memory store can express the same composite key the Postgres
	/// PK does without an extra map.
	pub vault_balances: Arc<DashMap<String, VaultBalance>>,

	/// Order claim leases: `order_id` → `(worker_id, expires_at, attempts)`.
	/// Mirrors the `claimed_by` / `claim_expires_at` / `attempts` columns
	/// the Postgres store keeps on the orders table, so the claim-queue
	/// behaves identically in tests and single-process runs.
	pub order_claims: Arc<DashMap<String, (String, DateTime<Utc>, i32)>>,
}

impl MemoryStore {
	/// Create a new memory store instance
	pub fn new() -> Self {
		Self {
			solvers: Arc::new(DashMap::new()),
			orders: Arc::new(DashMap::new()),
			metrics_timeseries: Arc::new(DashMap::new()),
			circuit_states: Arc::new(DashMap::new()),
			solver_quotes: Arc::new(DashMap::new()),
			operators: Arc::new(DashMap::new()),
			pending_identities: Arc::new(DashMap::new()),
			encrypted_fill_wallet_keys: Arc::new(DashMap::new()),
			workers: Arc::new(DashMap::new()),
			vault_balances: Arc::new(DashMap::new()),
			order_claims: Arc::new(DashMap::new()),
		}
	}

	/// Get Arc<MetricsTimeSeries> for efficient access without cloning
	/// This is a more efficient alternative to get_metrics_timeseries when you don't need ownership
	pub async fn get_metrics_timeseries_arc(
		&self,
		solver_id: &str,
	) -> StorageResult<Option<Arc<MetricsTimeSeries>>> {
		Ok(self
			.metrics_timeseries
			.get(solver_id)
			.map(|ts_arc| ts_arc.value().clone()))
	}

	/// Check if metrics exist without loading/cloning the data
	pub async fn has_metrics_timeseries(&self, solver_id: &str) -> StorageResult<bool> {
		Ok(self.metrics_timeseries.contains_key(solver_id))
	}
}

/// Storage statistics
impl Default for MemoryStore {
	fn default() -> Self {
		Self::new()
	}
}

#[async_trait]
impl Repository<Order> for MemoryStore {
	async fn create(&self, order: Order) -> StorageResult<Order> {
		self.orders.insert(order.order_id.clone(), order.clone());
		Ok(order)
	}

	async fn get(&self, order_id: &str) -> StorageResult<Option<Order>> {
		Ok(self.orders.get(order_id).map(|i| i.clone()))
	}

	async fn update(&self, order: Order) -> StorageResult<Order> {
		self.orders.insert(order.order_id.clone(), order.clone());
		Ok(order)
	}

	async fn delete(&self, order_id: &str) -> StorageResult<bool> {
		Ok(self.orders.remove(order_id).is_some())
	}

	async fn count(&self) -> StorageResult<usize> {
		Ok(self.orders.len())
	}

	async fn list_all(&self) -> StorageResult<Vec<Order>> {
		Ok(self.orders.iter().map(|e| e.value().clone()).collect())
	}

	async fn list_paginated(&self, offset: usize, limit: usize) -> StorageResult<Vec<Order>> {
		let all = self.list_all().await?;
		let start = offset.min(all.len());
		let end = (start + limit).min(all.len());
		Ok(all[start..end].to_vec())
	}
}

#[async_trait]
impl OrderStorage for MemoryStore {
	async fn get_by_status(&self, status: oif_types::OrderStatus) -> StorageResult<Vec<Order>> {
		let orders: Vec<Order> = self
			.orders
			.iter()
			.filter_map(|entry| {
				let order = entry.value();
				if order.status().clone() == status {
					Some(order.clone())
				} else {
					None
				}
			})
			.collect();
		Ok(orders)
	}

	async fn get_finalised(&self) -> StorageResult<Vec<Order>> {
		let orders: Vec<Order> =
			self.orders
				.iter()
				.filter_map(|entry| {
					let order = entry.value();
					match order.status() {
						oif_types::OrderStatus::Finalized
						| oif_types::OrderStatus::Failed(_, _) => Some(order.clone()),
						_ => None,
					}
				})
				.collect();
		Ok(orders)
	}

	/// In-memory mirror of the Postgres claim. `DashMap::entry` gives the
	/// per-key exclusion that stands in for `FOR UPDATE SKIP LOCKED`:
	/// two concurrent claimers cannot both take the same order.
	async fn claim_orders(
		&self,
		worker_id: &str,
		limit: usize,
		lease_secs: i64,
		max_attempts: i32,
	) -> StorageResult<Vec<Order>> {
		let now = Utc::now();
		let expires_at = now + chrono::Duration::seconds(lease_secs);

		// Oldest first, matching the Postgres `ORDER BY created_at ASC`.
		let mut candidates: Vec<Order> = self
			.orders
			.iter()
			.map(|e| e.value().clone())
			.filter(|o| {
				!matches!(
					o.status(),
					oif_types::OrderStatus::Finalized
						| oif_types::OrderStatus::Refunded
						| oif_types::OrderStatus::Failed(_, _)
				)
			})
			.collect();
		candidates.sort_by_key(|o| o.order.created_at());

		let mut claimed = Vec::new();
		for order in candidates {
			if claimed.len() >= limit {
				break;
			}
			let mut taken = false;
			match self.order_claims.entry(order.order_id.clone()) {
				dashmap::mapref::entry::Entry::Occupied(mut slot) => {
					let (_holder, expiry, attempts) = slot.get().clone();
					// Only steal a lease that has actually lapsed.
					if expiry < now && attempts < max_attempts {
						slot.insert((worker_id.to_string(), expires_at, attempts + 1));
						taken = true;
					}
				},
				dashmap::mapref::entry::Entry::Vacant(slot) => {
					if max_attempts > 0 {
						slot.insert((worker_id.to_string(), expires_at, 1));
						taken = true;
					}
				},
			}
			if taken {
				claimed.push(order);
			}
		}
		Ok(claimed)
	}

	async fn release_claim(&self, order_id: &str) -> StorageResult<bool> {
		Ok(self.order_claims.remove(order_id).is_some())
	}

	async fn extend_claim(
		&self,
		order_id: &str,
		worker_id: &str,
		lease_secs: i64,
	) -> StorageResult<bool> {
		let expires_at = Utc::now() + chrono::Duration::seconds(lease_secs);
		match self.order_claims.get_mut(order_id) {
			// Scoped to the holder, matching the Postgres `AND claimed_by = $2`.
			Some(mut slot) if slot.0 == worker_id => {
				slot.1 = expires_at;
				Ok(true)
			},
			_ => Ok(false),
		}
	}
}

#[async_trait]
impl Repository<Solver> for MemoryStore {
	async fn create(&self, solver: Solver) -> StorageResult<Solver> {
		self.solvers
			.insert(solver.solver_id.clone(), solver.clone());
		Ok(solver)
	}

	async fn get(&self, solver_id: &str) -> StorageResult<Option<Solver>> {
		Ok(self.solvers.get(solver_id).map(|s| s.clone()))
	}

	async fn update(&self, solver: Solver) -> StorageResult<Solver> {
		self.solvers
			.insert(solver.solver_id.clone(), solver.clone());
		Ok(solver)
	}

	async fn delete(&self, solver_id: &str) -> StorageResult<bool> {
		Ok(self.solvers.remove(solver_id).is_some())
	}

	async fn count(&self) -> StorageResult<usize> {
		Ok(self.solvers.len())
	}

	async fn list_all(&self) -> StorageResult<Vec<Solver>> {
		Ok(self.solvers.iter().map(|e| e.value().clone()).collect())
	}

	async fn list_paginated(&self, offset: usize, limit: usize) -> StorageResult<Vec<Solver>> {
		let all = self.list_all().await?;
		let start = offset.min(all.len());
		let end = (start + limit).min(all.len());
		Ok(all[start..end].to_vec())
	}
}

#[async_trait]
impl SolverStorage for MemoryStore {
	async fn get_active(&self) -> StorageResult<Vec<Solver>> {
		use oif_types::SolverStatus;
		let solvers: Vec<Solver> = self
			.solvers
			.iter()
			.filter_map(|entry| {
				let solver = entry.value();
				if solver.status == SolverStatus::Active {
					Some(solver.clone())
				} else {
					None
				}
			})
			.collect();
		Ok(solvers)
	}
}

#[async_trait]
impl MetricsStorage for MemoryStore {
	async fn update_metrics_timeseries(
		&self,
		solver_id: &str,
		timeseries: MetricsTimeSeries,
	) -> StorageResult<()> {
		self.metrics_timeseries
			.insert(solver_id.to_string(), Arc::new(timeseries));
		Ok(())
	}

	async fn get_metrics_timeseries(
		&self,
		solver_id: &str,
	) -> StorageResult<Option<MetricsTimeSeries>> {
		// Clone Arc contents only when trait interface requires owned value
		Ok(self.metrics_timeseries.get(solver_id).map(|ts_arc| {
			let ts: &MetricsTimeSeries = ts_arc.value();
			ts.clone()
		}))
	}

	async fn get_rolling_metrics(&self, solver_id: &str) -> StorageResult<Option<RollingMetrics>> {
		// More efficient: clone only the small RollingMetrics, not the entire timeseries
		Ok(self
			.metrics_timeseries
			.get(solver_id)
			.map(|ts_arc| ts_arc.value().rolling_metrics.clone()))
	}

	async fn delete_metrics_timeseries(&self, solver_id: &str) -> StorageResult<bool> {
		Ok(self.metrics_timeseries.remove(solver_id).is_some())
	}

	async fn list_solvers_with_metrics(&self) -> StorageResult<Vec<String>> {
		Ok(self
			.metrics_timeseries
			.iter()
			.map(|entry| entry.key().clone())
			.collect())
	}

	async fn cleanup_old_metrics(&self, older_than: DateTime<Utc>) -> StorageResult<usize> {
		let mut removed_count = 0;

		// Get a list of keys to remove (to avoid borrowing issues)
		// More efficient: only access last_updated field, no cloning needed
		let keys_to_remove: Vec<String> = self
			.metrics_timeseries
			.iter()
			.filter_map(|entry| {
				let timeseries_arc = entry.value();
				if timeseries_arc.last_updated < older_than {
					Some(entry.key().clone())
				} else {
					None
				}
			})
			.collect();

		// Remove the identified keys
		for key in keys_to_remove {
			if self.metrics_timeseries.remove(&key).is_some() {
				removed_count += 1;
			}
		}

		Ok(removed_count)
	}

	async fn count_metrics_timeseries(&self) -> StorageResult<usize> {
		Ok(self.metrics_timeseries.len())
	}
}

#[async_trait]
impl CircuitBreakerStorageTrait for MemoryStore {
	async fn get_circuit_state(
		&self,
		solver_id: &str,
	) -> StorageResult<Option<CircuitBreakerState>> {
		Ok(self
			.circuit_states
			.get(solver_id)
			.map(|entry| entry.clone()))
	}

	async fn update_circuit_state(&self, state: CircuitBreakerState) -> StorageResult<()> {
		self.circuit_states.insert(state.solver_id.clone(), state);
		Ok(())
	}

	async fn delete_circuit_state(&self, solver_id: &str) -> StorageResult<bool> {
		Ok(self.circuit_states.remove(solver_id).is_some())
	}

	async fn list_circuit_states(&self) -> StorageResult<Vec<CircuitBreakerState>> {
		Ok(self
			.circuit_states
			.iter()
			.map(|entry| entry.value().clone())
			.collect())
	}

	async fn cleanup_stale_circuits(&self, older_than: DateTime<Utc>) -> StorageResult<usize> {
		let keys_to_remove: Vec<String> = self
			.circuit_states
			.iter()
			.filter_map(|entry| {
				if entry.value().last_updated < older_than {
					Some(entry.key().clone())
				} else {
					None
				}
			})
			.collect();

		let mut removed = 0;
		for key in keys_to_remove {
			if self.circuit_states.remove(&key).is_some() {
				removed += 1;
			}
		}
		Ok(removed)
	}
}

#[async_trait]
impl Storage for MemoryStore {
	async fn health_check(&self) -> StorageResult<bool> {
		// For in-memory storage, just check if the maps are accessible
		Ok(true)
	}

	async fn close(&self) -> StorageResult<()> {
		// For memory store, there's nothing to close
		Ok(())
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use oif_types::MetricsTimeSeries;

	use oif_types::oif::common::{OrderStatus, Settlement, SettlementType};
	use oif_types::oif::v0::GetOrderResponse;
	use oif_types::oif::OifGetOrderResponse;

	/// Minimal non-terminal order for exercising the claim queue.
	fn test_order(id: &str, status: OrderStatus) -> Order {
		Order::new(
			"solver-test".to_string(),
			OifGetOrderResponse::new(GetOrderResponse {
				id: id.to_string(),
				status,
				created_at: 1_700_000_000,
				updated_at: 1_700_000_000,
				quote_id: Some("q-1".to_string()),
				input_amounts: vec![],
				output_amounts: vec![],
				settlement: Settlement {
					settlement_type: SettlementType::Escrow,
					data: serde_json::json!({}),
				},
				fill_transaction: None,
			}),
			None,
		)
	}

	/// The core guarantee: an order is leased to exactly ONE worker, so
	/// two workers racing can never both settle the same order.
	#[tokio::test]
	async fn claim_gives_an_order_to_exactly_one_worker() {
		let store = MemoryStore::new();
		store
			.create_order(test_order("ord-1", OrderStatus::Created))
			.await
			.unwrap();

		let first = store.claim_orders("worker-a", 10, 300, 5).await.unwrap();
		let second = store.claim_orders("worker-b", 10, 300, 5).await.unwrap();

		assert_eq!(first.len(), 1, "first worker takes the order");
		assert_eq!(first[0].order_id, "ord-1");
		assert!(second.is_empty(), "second worker must not get a live lease");
	}

	/// The reason this replaced the broadcast channel: an order that is
	/// never claimed stays in the queue instead of evaporating.
	#[tokio::test]
	async fn unclaimed_orders_survive_until_a_worker_arrives() {
		let store = MemoryStore::new();
		store
			.create_order(test_order("ord-late", OrderStatus::Created))
			.await
			.unwrap();

		// No worker for a while... then one shows up.
		let claimed = store.claim_orders("worker-late", 10, 300, 5).await.unwrap();
		assert_eq!(claimed.len(), 1);
		assert_eq!(claimed[0].order_id, "ord-late");
	}

	/// A worker that dies mid-settlement must not strand the order.
	#[tokio::test]
	async fn expired_lease_returns_the_order_to_the_pool() {
		let store = MemoryStore::new();
		store
			.create_order(test_order("ord-2", OrderStatus::Created))
			.await
			.unwrap();

		// Claim with a lease that is already in the past.
		let claimed = store.claim_orders("worker-dead", 10, -1, 5).await.unwrap();
		assert_eq!(claimed.len(), 1);

		let recovered = store.claim_orders("worker-live", 10, 300, 5).await.unwrap();
		assert_eq!(recovered.len(), 1, "expired lease must be reclaimable");
		assert_eq!(recovered[0].order_id, "ord-2");
	}

	/// Terminal orders are done — redelivering them would re-settle a
	/// completed swap.
	#[tokio::test]
	async fn terminal_orders_are_never_claimed() {
		let store = MemoryStore::new();
		store
			.create_order(test_order("ord-done", OrderStatus::Finalized))
			.await
			.unwrap();
		store
			.create_order(test_order("ord-refunded", OrderStatus::Refunded))
			.await
			.unwrap();

		let claimed = store.claim_orders("worker-a", 10, 300, 5).await.unwrap();
		assert!(claimed.is_empty(), "terminal orders must stay done");
	}

	/// Stop redelivering an order that keeps killing its handler.
	#[tokio::test]
	async fn attempts_are_capped() {
		let store = MemoryStore::new();
		store
			.create_order(test_order("ord-poison", OrderStatus::Created))
			.await
			.unwrap();

		// Each claim uses an already-expired lease, so it is immediately
		// reclaimable — but attempts still accumulate.
		for _ in 0..2 {
			let c = store.claim_orders("worker-a", 10, -1, 2).await.unwrap();
			assert_eq!(c.len(), 1);
		}
		let blocked = store.claim_orders("worker-a", 10, -1, 2).await.unwrap();
		assert!(blocked.is_empty(), "poison order must stop being redelivered");
	}

	/// Only the lease holder may extend it, so a stale worker cannot keep
	/// a lease it has already lost.
	#[tokio::test]
	async fn only_the_holder_can_extend_a_lease() {
		let store = MemoryStore::new();
		store
			.create_order(test_order("ord-3", OrderStatus::Created))
			.await
			.unwrap();
		store.claim_orders("worker-a", 10, 300, 5).await.unwrap();

		assert!(store.extend_claim("ord-3", "worker-a", 600).await.unwrap());
		assert!(!store.extend_claim("ord-3", "worker-b", 600).await.unwrap());
	}

	/// Releasing hands the order straight back rather than waiting for
	/// the lease to lapse.
	#[tokio::test]
	async fn release_makes_an_order_immediately_claimable() {
		let store = MemoryStore::new();
		store
			.create_order(test_order("ord-4", OrderStatus::Created))
			.await
			.unwrap();
		store.claim_orders("worker-a", 10, 300, 5).await.unwrap();
		assert!(store.claim_orders("worker-b", 10, 300, 5).await.unwrap().is_empty());

		assert!(store.release_claim("ord-4").await.unwrap());
		let after = store.claim_orders("worker-b", 10, 300, 5).await.unwrap();
		assert_eq!(after.len(), 1);
	}

	#[tokio::test]
	async fn test_arc_optimization_efficiency() {
		let store = MemoryStore::new();

		// Create a test timeseries
		let timeseries = MetricsTimeSeries::new("test-solver".to_string());

		// Store it
		store
			.update_metrics_timeseries("test-solver", timeseries)
			.await
			.unwrap();

		// Test efficient Arc access (no cloning of large data)
		let arc_result = store
			.get_metrics_timeseries_arc("test-solver")
			.await
			.unwrap();
		assert!(arc_result.is_some());

		// Test that we can get multiple Arc references efficiently
		let arc_result2 = store
			.get_metrics_timeseries_arc("test-solver")
			.await
			.unwrap();
		assert!(arc_result2.is_some());

		// Both should reference the same underlying data
		// (in a real scenario, this avoids expensive clones)

		// Test existence check without loading data
		assert!(store.has_metrics_timeseries("test-solver").await.unwrap());
		assert!(!store.has_metrics_timeseries("nonexistent").await.unwrap());
	}

	#[tokio::test]
	async fn test_pending_identity_round_trip() {
		let store = MemoryStore::new();
		let solver_id = "solver-test-1";

		// Empty store: nothing pending.
		assert!(
			store
				.take_pending_identity(solver_id)
				.await
				.unwrap()
				.is_none()
		);

		// Queue a key.
		store
			.set_pending_identity(solver_id, "0xdeadbeef".to_string())
			.await
			.unwrap();

		// Take returns it exactly once.
		let first = store.take_pending_identity(solver_id).await.unwrap();
		assert_eq!(first.as_deref(), Some("0xdeadbeef"));

		// Subsequent takes return None (single-shot semantics).
		let second = store.take_pending_identity(solver_id).await.unwrap();
		assert!(second.is_none());

		// Clear is idempotent.
		store.clear_pending_identity(solver_id).await.unwrap();
		store.clear_pending_identity(solver_id).await.unwrap();
		assert!(
			store
				.take_pending_identity(solver_id)
				.await
				.unwrap()
				.is_none()
		);
	}

	#[tokio::test]
	async fn test_pending_identity_ttl_expires() {
		let store = MemoryStore::new();
		let solver_id = "solver-test-ttl";

		// Manually inject an already-expired entry so we don't have to
		// wait for the real TTL (24h) inside a unit test.
		let expired_at = chrono::Utc::now()
			- chrono::Duration::seconds(oif_types::PENDING_IDENTITY_TTL_SECS as i64 + 60);
		store
			.pending_identities
			.insert(solver_id.to_string(), ("0xexpired".to_string(), expired_at));

		// Take should drop the expired entry on the floor and return None.
		let result = store.take_pending_identity(solver_id).await.unwrap();
		assert!(result.is_none());

		// Subsequent takes also return None — the entry was removed.
		let second = store.take_pending_identity(solver_id).await.unwrap();
		assert!(second.is_none());
	}
}

#[async_trait]
impl SolverQuoteStorageTrait for MemoryStore {
	async fn create_solver_quote(&self, quote: SolverQuote) -> StorageResult<SolverQuote> {
		self.solver_quotes.insert(quote.id.clone(), quote.clone());
		Ok(quote)
	}

	async fn list_solver_quotes(
		&self,
		solver_id: Option<&str>,
	) -> StorageResult<Vec<SolverQuote>> {
		let quotes: Vec<SolverQuote> = self
			.solver_quotes
			.iter()
			.filter(|entry| {
				solver_id.map_or(true, |id| entry.value().solver_id == id)
			})
			.map(|entry| entry.value().clone())
			.collect();
		Ok(quotes)
	}

	async fn delete_solver_quote(&self, id: &str) -> StorageResult<bool> {
		Ok(self.solver_quotes.remove(id).is_some())
	}

	async fn toggle_pause_solver_quote(&self, id: &str) -> StorageResult<Option<SolverQuote>> {
		if let Some(mut entry) = self.solver_quotes.get_mut(id) {
			entry.value_mut().paused = !entry.value().paused;
			entry.value_mut().updated_at = chrono::Utc::now();
			Ok(Some(entry.value().clone()))
		} else {
			Ok(None)
		}
	}
}

#[async_trait]
impl OperatorStorageTrait for MemoryStore {
	async fn upsert_operator(&self, operator: Operator) -> StorageResult<Operator> {
		let mut op = operator;
		op.updated_at = Utc::now();
		self.operators.insert(op.solver_id.clone(), op.clone());
		Ok(op)
	}

	async fn get_operator(&self, solver_id: &str) -> StorageResult<Option<Operator>> {
		Ok(self.operators.get(solver_id).map(|o| o.value().clone()))
	}

	async fn get_operator_by_api_key(
		&self,
		api_key: &str,
	) -> StorageResult<Option<Operator>> {
		// Linear scan; the in-memory store is for tests and the
		// multi-tenant deploy doesn't use it.
		Ok(self
			.operators
			.iter()
			.find(|e| e.value().api_key == api_key)
			.map(|e| e.value().clone()))
	}

	async fn list_operators(&self) -> StorageResult<Vec<Operator>> {
		Ok(self.operators.iter().map(|e| e.value().clone()).collect())
	}

	async fn record_fill_outcome(
		&self,
		solver_id: &str,
		succeeded: bool,
		latency_ms: u64,
	) -> StorageResult<f64> {
		let mut entry = match self.operators.get_mut(solver_id) {
			Some(e) => e,
			None => {
				return Err(crate::traits::StorageError::NotFound {
					id: format!("operator:{solver_id}"),
				});
			},
		};
		let op = entry.value_mut();
		op.fills_total = op.fills_total.saturating_add(1);
		if succeeded {
			op.fills_succeeded = op.fills_succeeded.saturating_add(1);
		}
		// Rolling average latency (exponential moving average, α = 0.3).
		op.avg_latency_ms = if op.avg_latency_ms == 0 {
			latency_ms
		} else {
			(((op.avg_latency_ms as f64) * 0.7) + ((latency_ms as f64) * 0.3)) as u64
		};
		// Reputation score updates: small upward nudge on success, larger
		// downward nudge on failure. Capped to [0, 1].
		let delta = if succeeded { 0.02 } else { -0.10 };
		op.reputation_score =
			(op.reputation_score + delta).clamp(oif_types::MIN_REPUTATION_SCORE, oif_types::MAX_REPUTATION_SCORE);
		op.updated_at = Utc::now();
		Ok(op.reputation_score)
	}

	async fn record_heartbeat(&self, solver_id: &str) -> StorageResult<()> {
		if let Some(mut e) = self.operators.get_mut(solver_id) {
			e.value_mut().last_active_at = Some(Utc::now());
			e.value_mut().updated_at = Utc::now();
		}
		Ok(())
	}

	async fn set_fill_worker_url(
		&self,
		solver_id: &str,
		url: Option<String>,
	) -> StorageResult<()> {
		if let Some(mut e) = self.operators.get_mut(solver_id) {
			e.value_mut().fill_worker_url = url;
			e.value_mut().updated_at = Utc::now();
		}
		Ok(())
	}

	async fn set_settlement_contract(
		&self,
		solver_id: &str,
		chain_id: u64,
		address: String,
	) -> StorageResult<()> {
		if let Some(mut e) = self.operators.get_mut(solver_id) {
			e.value_mut().settlement_contracts.insert(chain_id, address);
			e.value_mut().updated_at = Utc::now();
		}
		Ok(())
	}

	async fn get_settlement_contract(
		&self,
		solver_id: &str,
		chain_id: u64,
	) -> StorageResult<Option<String>> {
		Ok(self
			.operators
			.get(solver_id)
			.and_then(|o| o.value().settlement_contracts.get(&chain_id).cloned()))
	}

	async fn delete_settlement_contract(
		&self,
		solver_id: &str,
		chain_id: u64,
	) -> StorageResult<u64> {
		let removed = if let Some(mut e) = self.operators.get_mut(solver_id) {
			let removed = e.value_mut().settlement_contracts.remove(&chain_id).is_some();
			if removed {
				e.value_mut().updated_at = Utc::now();
			}
			removed as u64
		} else {
			0
		};
		Ok(removed)
	}

	async fn set_pending_identity(
		&self,
		solver_id: &str,
		private_key: String,
	) -> StorageResult<()> {
		self.pending_identities
			.insert(solver_id.to_string(), (private_key, Utc::now()));
		Ok(())
	}

	async fn take_pending_identity(
		&self,
		solver_id: &str,
	) -> StorageResult<Option<String>> {
		// Atomic check-and-clear via `remove`: if there's a fresh-enough
		// entry, take it; otherwise leave whatever was there alone so
		// the next caller (after TTL elapses) sees an empty map.
		match self.pending_identities.remove(solver_id) {
			// DashMap's `remove` returns `Option<(K, V)>` where V here is
			// the (private_key, set_at) tuple. Destructure both layers.
			Some((_, (pk, set_at))) => {
				let age_secs = (Utc::now() - set_at).num_seconds().max(0) as u64;
				if age_secs >= oif_types::PENDING_IDENTITY_TTL_SECS {
					// Expired — drop on the floor.
					Ok(None)
				} else {
					Ok(Some(pk))
				}
			}
			None => Ok(None),
		}
	}

	async fn clear_pending_identity(&self, solver_id: &str) -> StorageResult<()> {
		self.pending_identities.remove(solver_id);
		Ok(())
	}

	async fn set_encrypted_fill_wallet_key(
		&self,
		solver_id: &str,
		ciphertext: Vec<u8>,
	) -> StorageResult<()> {
		self.encrypted_fill_wallet_keys
			.insert(solver_id.to_string(), ciphertext);
		Ok(())
	}

	async fn get_encrypted_fill_wallet_key(
		&self,
		solver_id: &str,
	) -> StorageResult<Option<Vec<u8>>> {
		Ok(self
			.encrypted_fill_wallet_keys
			.get(solver_id)
			.map(|v| v.value().clone()))
	}
}

#[async_trait]
impl WorkerStorageTrait for MemoryStore {
    async fn register_worker(
        &self,
        worker_id: &str,
        public_url: &str,
    ) -> StorageResult<()> {
        self.workers
            .insert(worker_id.to_string(), (public_url.to_string(), Utc::now()));
        Ok(())
    }

    async fn worker_heartbeat(&self, worker_id: &str) -> StorageResult<()> {
        if let Some(mut entry) = self.workers.get_mut(worker_id) {
            entry.value_mut().1 = Utc::now();
        }
        Ok(())
    }

    async fn get_worker(&self, worker_id: &str) -> StorageResult<Option<String>> {
        Ok(self
            .workers
            .get(worker_id)
            .map(|v| v.value().0.clone()))
    }
}

#[async_trait]
impl VaultStorageTrait for MemoryStore {
    async fn upsert_vault_balance(&self, balance: VaultBalance) -> StorageResult<()> {
        let key = format!(
            "{}::{}::{}",
            balance.solver_id,
            balance.chain,
            balance.asset_address
        );
        self.vault_balances.insert(key, balance);
        Ok(())
    }

    async fn list_vault_balances(&self, solver_id: &str) -> StorageResult<Vec<VaultBalance>> {
        let mut out: Vec<VaultBalance> = self
            .vault_balances
            .iter()
            .filter(|e| e.value().solver_id == solver_id)
            .map(|e| e.value().clone())
            .collect();
        // Match the Postgres impl's ordering for predictable UI.
        out.sort_by(|a, b| a.chain.cmp(&b.chain).then(a.symbol.cmp(&b.symbol)));
        Ok(out)
    }

    async fn delete_vault_balance(
        &self,
        solver_id: &str,
        chain: &str,
        asset_address: &str,
    ) -> StorageResult<bool> {
        let key = format!(
            "{}::{}::{}",
            solver_id,
            chain,
            asset_address.to_lowercase()
        );
        Ok(self.vault_balances.remove(&key).is_some())
    }
}
