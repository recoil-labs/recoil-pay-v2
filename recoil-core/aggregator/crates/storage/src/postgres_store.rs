use async_trait::async_trait;
use sqlx::{postgres::{PgConnectOptions, PgPoolOptions, PgSslMode}, PgPool, Row};
use std::str::FromStr;
use std::time::Duration;
use crate::traits::*;
use oif_types::storage::OperatorStorageTrait;
use oif_types::storage::VaultStorageTrait;
use oif_types::storage::WorkerStorageTrait;
use oif_types::VaultBalance;
use oif_types::{GiftCardQuote, GiftCardSide, GiftCardTrade, GiftCardType, SealedCode, TradeState};

/// Postgres `jsonb` cannot hold a NUL byte: writing one fails the whole
/// statement with "unsupported Unicode escape sequence". EVM revert reasons
/// arrive as raw bytes and regularly contain them, so a failed settlement
/// would poison the very write that records the failure — the order stayed
/// in `settling` forever and the UI showed it as stuck.
///
/// Scrub NULs from every string (and key) on the way to the database. They
/// carry no information here; the alternative is losing the whole update.
fn scrub_nul(value: serde_json::Value) -> serde_json::Value {
	use serde_json::Value;
	match value {
		Value::String(s) => Value::String(s.replace('\u{0}', "")),
		Value::Array(items) => Value::Array(items.into_iter().map(scrub_nul).collect()),
		Value::Object(fields) => Value::Object(
			fields
				.into_iter()
				.map(|(k, v)| (k.replace('\u{0}', ""), scrub_nul(v)))
				.collect(),
		),
		other => other,
	}
}
use oif_types::{
	CircuitBreakerState, MetricsTimeSeries, Operator, Order, OrderStatus, RollingMetrics, Solver,
	SolverQuote,
};

#[derive(Clone)]
pub struct PostgresStore {
	pool: PgPool,
}

impl PostgresStore {
	pub async fn new(database_url: &str) -> StorageResult<Self> {
		let opts = PgConnectOptions::from_str(database_url)
			.map_err(|e| StorageError::Connection { message: e.to_string() })?
			.ssl_mode(PgSslMode::Disable);

		let pool = PgPoolOptions::new()
			.max_connections(5)
			.acquire_timeout(Duration::from_secs(3))
			.connect_with(opts)
			.await
			.map_err(|e| StorageError::Connection { message: e.to_string() })?;

		// Run migrations
		println!("Running migrations on database...");
		let migrator = sqlx::migrate!("./migrations");
		migrator
			.run(&pool)
			.await
			.map_err(|e| StorageError::Connection { message: format!("Migration failed: {}", e) })?;
		println!("Migrations completed successfully!");

		Ok(Self { pool })
	}
}


#[async_trait]
impl Repository<Order> for PostgresStore {
	async fn create(&self, entity: Order) -> StorageResult<Order> {
		let data = scrub_nul(serde_json::to_value(&entity).map_err(|e| StorageError::Operation { message: e.to_string() })?);
		let status = serde_json::to_string(&entity.status()).unwrap_or_default().trim_matches('"').to_string();

		sqlx::query(
			"INSERT INTO orders (id, solver_id, status, data) VALUES ($1, $2, $3, $4)"
		)
		.bind(&entity.order_id)
		.bind(&entity.solver_id)
		.bind(&status)
		.bind(&data)
		.execute(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(entity)
	}

	async fn get(&self, id: &str) -> StorageResult<Option<Order>> {
		let record = sqlx::query("SELECT data FROM orders WHERE id = $1")
			.bind(id)
			.fetch_optional(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		if let Some(row) = record {
			let data: serde_json::Value = row.try_get("data")
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			let order: Order = serde_json::from_value(data)
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			Ok(Some(order))
		} else {
			Ok(None)
		}
	}

	async fn update(&self, entity: Order) -> StorageResult<Order> {
		let data = scrub_nul(serde_json::to_value(&entity).map_err(|e| StorageError::Operation { message: e.to_string() })?);
		let status = serde_json::to_string(&entity.status()).unwrap_or_default().trim_matches('"').to_string();

		let result = sqlx::query(
			"UPDATE orders SET status = $1, data = $2, updated_at = NOW() WHERE id = $3"
		)
		.bind(&status)
		.bind(&data)
		.bind(&entity.order_id)
		.execute(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		if result.rows_affected() == 0 {
			return Err(StorageError::NotFound { id: format!("Order {}", entity.order_id) });
		}

		Ok(entity)
	}

	async fn delete(&self, id: &str) -> StorageResult<bool> {
		let result = sqlx::query("DELETE FROM orders WHERE id = $1")
			.bind(id)
			.execute(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(result.rows_affected() > 0)
	}

	async fn count(&self) -> StorageResult<usize> {
		let row = sqlx::query("SELECT COUNT(*) as count FROM orders")
			.fetch_one(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		let count: i64 = row.try_get("count").unwrap_or(0);
		Ok(count as usize)
	}

	async fn list_all(&self) -> StorageResult<Vec<Order>> {
		let records = sqlx::query("SELECT data FROM orders")
			.fetch_all(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		let mut orders = Vec::new();
		for row in records {
			let data: serde_json::Value = row.try_get("data")
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			let order: Order = serde_json::from_value(data)
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			orders.push(order);
		}
		Ok(orders)
	}

	async fn list_paginated(&self, offset: usize, limit: usize) -> StorageResult<Vec<Order>> {
		let records = sqlx::query("SELECT data FROM orders ORDER BY created_at DESC OFFSET $1 LIMIT $2")
			.bind(offset as i64)
			.bind(limit as i64)
			.fetch_all(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		let mut orders = Vec::new();
		for row in records {
			let data: serde_json::Value = row.try_get("data")
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			let order: Order = serde_json::from_value(data)
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			orders.push(order);
		}
		Ok(orders)
	}
}

#[async_trait]
impl OrderStorage for PostgresStore {
	async fn get_by_status(&self, status: OrderStatus) -> StorageResult<Vec<Order>> {
		let status_str = serde_json::to_string(&status).unwrap_or_default().trim_matches('"').to_string();
		let records = sqlx::query("SELECT data FROM orders WHERE status = $1")
			.bind(&status_str)
			.fetch_all(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		let mut orders = Vec::new();
		for row in records {
			let data: serde_json::Value = row.try_get("data")
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			let order: Order = serde_json::from_value(data)
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			orders.push(order);
		}
		Ok(orders)
	}

	async fn get_finalised(&self) -> StorageResult<Vec<Order>> {
		let records = sqlx::query("SELECT data FROM orders WHERE status = 'Finalized' OR status LIKE 'Failed%'")
			.fetch_all(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		let mut orders = Vec::new();
		for row in records {
			let data: serde_json::Value = row.try_get("data")
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			let order: Order = serde_json::from_value(data)
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			orders.push(order);
		}
		Ok(orders)
	}

	/// Atomic lease acquisition.
	///
	/// The CTE selects candidate rows with `FOR UPDATE SKIP LOCKED`, so
	/// two workers claiming concurrently never see the same row: the
	/// second skips whatever the first has locked instead of blocking.
	/// The UPDATE then stamps the lease in the same transaction, so a
	/// crash between select and update leaves the order claimable.
	///
	/// A row is claimable when it is not in a terminal state, has
	/// attempts left, and is either unclaimed or holds an expired lease
	/// (which is how work is recovered from a worker that died).
	async fn claim_orders(
		&self,
		worker_id: &str,
		limit: usize,
		lease_secs: i64,
		max_attempts: i32,
	) -> StorageResult<Vec<Order>> {
		let expires_at = chrono::Utc::now() + chrono::Duration::seconds(lease_secs);
		let records = sqlx::query(
			"WITH claimable AS ( \
			   SELECT id FROM orders \
			   WHERE status NOT IN ('finalized', 'refunded', 'Finalized', 'Refunded') \
			     AND status NOT LIKE '%ailed%' \
			     AND attempts < $4 \
			     AND (claimed_by IS NULL OR claim_expires_at < NOW()) \
			   ORDER BY created_at ASC \
			   LIMIT $2 \
			   FOR UPDATE SKIP LOCKED \
			 ) \
			 UPDATE orders o \
			 SET claimed_by = $1, \
			     claimed_at = NOW(), \
			     claim_expires_at = $3, \
			     attempts = o.attempts + 1, \
			     updated_at = NOW() \
			 FROM claimable c \
			 WHERE o.id = c.id \
			 RETURNING o.data",
		)
		.bind(worker_id)
		.bind(limit as i64)
		.bind(expires_at)
		.bind(max_attempts)
		.fetch_all(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		let mut orders = Vec::new();
		for row in records {
			let data: serde_json::Value = row
				.try_get("data")
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			let order: Order = serde_json::from_value(data)
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			orders.push(order);
		}
		Ok(orders)
	}

	async fn release_claim(&self, order_id: &str) -> StorageResult<bool> {
		let result = sqlx::query(
			"UPDATE orders SET claimed_by = NULL, claimed_at = NULL, \
			 claim_expires_at = NULL, updated_at = NOW() WHERE id = $1",
		)
		.bind(order_id)
		.execute(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(result.rows_affected() > 0)
	}

	async fn extend_claim(
		&self,
		order_id: &str,
		worker_id: &str,
		lease_secs: i64,
	) -> StorageResult<bool> {
		let expires_at = chrono::Utc::now() + chrono::Duration::seconds(lease_secs);
		// Scoped to the holding worker so a stale worker cannot extend a
		// lease that has already been reassigned.
		let result = sqlx::query(
			"UPDATE orders SET claim_expires_at = $3, updated_at = NOW() \
			 WHERE id = $1 AND claimed_by = $2",
		)
		.bind(order_id)
		.bind(worker_id)
		.bind(expires_at)
		.execute(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(result.rows_affected() > 0)
	}
}

#[async_trait]
impl Repository<Solver> for PostgresStore {
	async fn create(&self, entity: Solver) -> StorageResult<Solver> {
		let data = scrub_nul(serde_json::to_value(&entity).map_err(|e| StorageError::Operation { message: e.to_string() })?);

		sqlx::query(
			"INSERT INTO solvers (id, is_active, data) VALUES ($1, $2, $3)
			 ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active, data = EXCLUDED.data, updated_at = NOW()"
		)
			.bind(&entity.solver_id)
			.bind(entity.status == oif_types::SolverStatus::Active)
			.bind(&data)
			.execute(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(entity)
	}

	async fn get(&self, id: &str) -> StorageResult<Option<Solver>> {
		let record = sqlx::query("SELECT data FROM solvers WHERE id = $1")
			.bind(id)
			.fetch_optional(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		if let Some(row) = record {
			let data: serde_json::Value = row.try_get("data")
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			let solver: Solver = serde_json::from_value(data)
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			Ok(Some(solver))
		} else {
			Ok(None)
		}
	}

	async fn update(&self, entity: Solver) -> StorageResult<Solver> {
		let data = scrub_nul(serde_json::to_value(&entity).map_err(|e| StorageError::Operation { message: e.to_string() })?);

		let result = sqlx::query("UPDATE solvers SET is_active = $1, data = $2, updated_at = NOW() WHERE id = $3")
			.bind(entity.status == oif_types::SolverStatus::Active)
			.bind(&data)
			.bind(&entity.solver_id)
			.execute(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		if result.rows_affected() == 0 {
			return Err(StorageError::NotFound { id: format!("Solver {}", entity.solver_id) });
		}

		Ok(entity)
	}

	async fn delete(&self, id: &str) -> StorageResult<bool> {
		let result = sqlx::query("DELETE FROM solvers WHERE id = $1")
			.bind(id)
			.execute(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(result.rows_affected() > 0)
	}

	async fn count(&self) -> StorageResult<usize> {
		let row = sqlx::query("SELECT COUNT(*) as count FROM solvers")
			.fetch_one(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		let count: i64 = row.try_get("count").unwrap_or(0);
		Ok(count as usize)
	}

	async fn list_all(&self) -> StorageResult<Vec<Solver>> {
		let records = sqlx::query("SELECT data FROM solvers")
			.fetch_all(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		let mut solvers = Vec::new();
		for row in records {
			let data: serde_json::Value = row.try_get("data")
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			let solver: Solver = serde_json::from_value(data)
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			solvers.push(solver);
		}
		Ok(solvers)
	}

	async fn list_paginated(&self, offset: usize, limit: usize) -> StorageResult<Vec<Solver>> {
		let records = sqlx::query("SELECT data FROM solvers ORDER BY created_at DESC OFFSET $1 LIMIT $2")
			.bind(offset as i64)
			.bind(limit as i64)
			.fetch_all(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		let mut solvers = Vec::new();
		for row in records {
			let data: serde_json::Value = row.try_get("data")
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			let solver: Solver = serde_json::from_value(data)
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			solvers.push(solver);
		}
		Ok(solvers)
	}
}

#[async_trait]
impl SolverStorage for PostgresStore {
	async fn get_active(&self) -> StorageResult<Vec<Solver>> {
		let records = sqlx::query("SELECT data FROM solvers WHERE is_active = true")
			.fetch_all(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		let mut solvers = Vec::new();
		for row in records {
			let data: serde_json::Value = row.try_get("data")
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			let solver: Solver = serde_json::from_value(data)
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			solvers.push(solver);
		}
		Ok(solvers)
	}
}

#[async_trait]
impl MetricsStorage for PostgresStore {
	async fn update_metrics_timeseries(
		&self,
		solver_id: &str,
		timeseries: MetricsTimeSeries,
	) -> StorageResult<()> {
		let data = serde_json::to_value(&timeseries).map_err(|e| StorageError::Operation { message: e.to_string() })?;

		sqlx::query("INSERT INTO metrics (solver_id, data) VALUES ($1, $2) ON CONFLICT (solver_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()")
			.bind(solver_id)
			.bind(&data)
			.execute(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(())
	}

	async fn get_metrics_timeseries(
		&self,
		solver_id: &str,
	) -> StorageResult<Option<MetricsTimeSeries>> {
		let record = sqlx::query("SELECT data FROM metrics WHERE solver_id = $1")
			.bind(solver_id)
			.fetch_optional(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		if let Some(row) = record {
			let data: serde_json::Value = row.try_get("data")
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			let ts: MetricsTimeSeries = serde_json::from_value(data)
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			Ok(Some(ts))
		} else {
			Ok(None)
		}
	}

	async fn get_rolling_metrics(&self, solver_id: &str) -> StorageResult<Option<RollingMetrics>> {
		let ts = self.get_metrics_timeseries(solver_id).await?;
		Ok(ts.map(|ts| ts.rolling_metrics))
	}

	async fn delete_metrics_timeseries(&self, solver_id: &str) -> StorageResult<bool> {
		let result = sqlx::query("DELETE FROM metrics WHERE solver_id = $1")
			.bind(solver_id)
			.execute(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(result.rows_affected() > 0)
	}

	async fn list_solvers_with_metrics(&self) -> StorageResult<Vec<String>> {
		let records = sqlx::query("SELECT solver_id FROM metrics")
			.fetch_all(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		let mut solver_ids = Vec::new();
		for row in records {
			let id: String = row.try_get("solver_id").map_err(|e| StorageError::Operation { message: e.to_string() })?;
			solver_ids.push(id);
		}
		Ok(solver_ids)
	}

	async fn cleanup_old_metrics(&self, older_than: chrono::DateTime<chrono::Utc>) -> StorageResult<usize> {
		let result = sqlx::query("DELETE FROM metrics WHERE updated_at < $1")
			.bind(older_than)
			.execute(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(result.rows_affected() as usize)
	}

	async fn count_metrics_timeseries(&self) -> StorageResult<usize> {
		let row = sqlx::query("SELECT COUNT(*) as count FROM metrics")
			.fetch_one(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		let count: i64 = row.try_get("count").unwrap_or(0);
		Ok(count as usize)
	}
}

#[async_trait]
impl CircuitBreakerStorage for PostgresStore {
	async fn get_circuit_state(&self, solver_id: &str) -> StorageResult<Option<CircuitBreakerState>> {
		let record = sqlx::query("SELECT data FROM circuit_breakers WHERE solver_id = $1")
			.bind(solver_id)
			.fetch_optional(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		if let Some(row) = record {
			let data: serde_json::Value = row.try_get("data")
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			let state: CircuitBreakerState = serde_json::from_value(data)
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			Ok(Some(state))
		} else {
			Ok(None)
		}
	}

	async fn update_circuit_state(&self, state: CircuitBreakerState) -> StorageResult<()> {
		let data = serde_json::to_value(&state).map_err(|e| StorageError::Operation { message: e.to_string() })?;

		sqlx::query("INSERT INTO circuit_breakers (solver_id, data) VALUES ($1, $2) ON CONFLICT (solver_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()")
			.bind(&state.solver_id)
			.bind(&data)
			.execute(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(())
	}

	async fn delete_circuit_state(&self, solver_id: &str) -> StorageResult<bool> {
		let result = sqlx::query("DELETE FROM circuit_breakers WHERE solver_id = $1")
			.bind(solver_id)
			.execute(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(result.rows_affected() > 0)
	}

	async fn list_circuit_states(&self) -> StorageResult<Vec<CircuitBreakerState>> {
		let records = sqlx::query("SELECT data FROM circuit_breakers")
			.fetch_all(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		let mut states = Vec::new();
		for row in records {
			let data: serde_json::Value = row.try_get("data")
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			let state: CircuitBreakerState = serde_json::from_value(data)
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			states.push(state);
		}
		Ok(states)
	}

	async fn cleanup_stale_circuits(&self, older_than: chrono::DateTime<chrono::Utc>) -> StorageResult<usize> {
		let result = sqlx::query("DELETE FROM circuit_breakers WHERE updated_at < $1")
			.bind(older_than)
			.execute(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(result.rows_affected() as usize)
	}
}

#[async_trait]
impl Storage for PostgresStore {
	async fn health_check(&self) -> StorageResult<bool> {
		sqlx::query("SELECT 1")
			.execute(&self.pool)
			.await
			.map(|_| true)
			.map_err(|e| StorageError::Operation { message: e.to_string() })
	}

	async fn close(&self) -> StorageResult<()> {
		self.pool.close().await;
		Ok(())
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use oif_types::solvers::{AssetSource, SolverMetadata, SolverMetrics, SupportedAssets};
	use oif_types::{CircuitBreakerState, CircuitState, MetricsTimeSeries, Solver, SolverStatus};
	use std::env;

	async fn get_test_store() -> Option<PostgresStore> {
		let db_url = env::var("DATABASE_URL")
			.unwrap_or_else(|_| "postgres://recoilpay:password@127.0.0.1:5433/oif_aggregator".to_string());
		match PostgresStore::new(&db_url).await {
			Ok(store) => Some(store),
			Err(e) => {
				eprintln!("PostgresStore::new error for '{}': {:?}", db_url, e);
				None
			}
		}
	}


	#[tokio::test]
	async fn test_postgres_solver_crud() {
		let Some(store) = get_test_store().await else {
			eprintln!("Skipping Postgres solver test: DB unavailable");
			return;
		};

		let id_suffix = std::time::SystemTime::now()
			.duration_since(std::time::UNIX_EPOCH)
			.unwrap()
			.as_nanos();
		let solver_id = format!("test-solver-{}", id_suffix);
		let solver = Solver {
			solver_id: solver_id.clone(),
			adapter_id: "mock_adapter".to_string(),
			endpoint: "http://localhost:8080".to_string(),
			status: SolverStatus::Active,
			metadata: SolverMetadata {
				name: Some("Test Solver".to_string()),
				description: Some("Test".to_string()),
				version: Some("1.0.0".to_string()),
				supported_assets: SupportedAssets::Assets {
					assets: vec![],
					source: AssetSource::Config,
				},
				headers: None,
			},
			created_at: chrono::Utc::now(),
			last_seen: Some(chrono::Utc::now()),
			metrics: SolverMetrics::default(),
			headers: None,
			adapter_metadata: None,
		};

		// Create
		let created = Repository::<Solver>::create(&store, solver.clone()).await.unwrap();
		assert_eq!(created.solver_id, solver_id);

		// Get
		let fetched = Repository::<Solver>::get(&store, &solver_id).await.unwrap();
		assert!(fetched.is_some());

		// Count
		let count = Repository::<Solver>::count(&store).await.unwrap();
		assert!(count > 0);

		// Active solvers
		let active = SolverStorage::get_active(&store).await.unwrap();
		assert!(active.iter().any(|s| s.solver_id == solver_id));

		// Update
		let mut updated_solver = solver.clone();
		updated_solver.metadata.name = Some("Updated Test Solver".to_string());
		let updated = Repository::<Solver>::update(&store, updated_solver).await.unwrap();
		assert_eq!(updated.metadata.name.as_deref(), Some("Updated Test Solver"));

		// Delete
		let deleted = Repository::<Solver>::delete(&store, &solver_id).await.unwrap();
		assert!(deleted);
	}

	#[tokio::test]
	async fn test_postgres_circuit_breaker() {
		let Some(store) = get_test_store().await else {
			eprintln!("Skipping Postgres circuit breaker test: DB unavailable");
			return;
		};

		let id_suffix = std::time::SystemTime::now()
			.duration_since(std::time::UNIX_EPOCH)
			.unwrap()
			.as_nanos();
		let solver_id = format!("test-cb-{}", id_suffix);
		let cb_state = CircuitBreakerState {
			solver_id: solver_id.clone(),
			state: CircuitState::Closed,
			opened_at: None,
			failure_count_when_opened: 0,
			timeout_duration: chrono::Duration::seconds(60),
			next_test_at: None,
			reason: None,
			test_request_count: 0,
			successful_test_requests: 5,
			failed_test_requests: 0,
			recovery_attempt_count: 0,
			created_at: chrono::Utc::now(),
			last_updated: chrono::Utc::now(),
		};

		store.update_circuit_state(cb_state.clone()).await.unwrap();

		let fetched = store.get_circuit_state(&solver_id).await.unwrap();
		assert!(fetched.is_some());
		assert_eq!(fetched.unwrap().successful_test_requests, 5);

		let list = store.list_circuit_states().await.unwrap();
		assert!(list.iter().any(|cb| cb.solver_id == solver_id));

		let deleted = store.delete_circuit_state(&solver_id).await.unwrap();
		assert!(deleted);
	}

	#[tokio::test]
	async fn test_postgres_health_check() {
		let Some(store) = get_test_store().await else {
			eprintln!("Skipping Postgres health check test: DB unavailable");
			return;
		};

		let healthy = store.health_check().await.unwrap();
		assert!(healthy);
	}

	#[tokio::test]
	async fn test_postgres_metrics_crud() {
		let Some(store) = get_test_store().await else {
			eprintln!("Skipping Postgres metrics test: DB unavailable");
			return;
		};

		let id_suffix = std::time::SystemTime::now()
			.duration_since(std::time::UNIX_EPOCH)
			.unwrap()
			.as_nanos();
		let solver_id = format!("test-metrics-solver-{}", id_suffix);
		let ts = MetricsTimeSeries::new(solver_id.clone());

		store.update_metrics_timeseries(&solver_id, ts.clone()).await.unwrap();

		let fetched = store.get_metrics_timeseries(&solver_id).await.unwrap();
		assert!(fetched.is_some());

		let solvers = store.list_solvers_with_metrics().await.unwrap();
		assert!(solvers.contains(&solver_id));

		let count = store.count_metrics_timeseries().await.unwrap();
		assert!(count > 0);

		let deleted = store.delete_metrics_timeseries(&solver_id).await.unwrap();
		assert!(deleted);
	}
}

// ─── SolverQuote Storage ──────────────────────────────────────────────────────

#[async_trait]
impl SolverQuoteStorageTrait for PostgresStore {
	async fn create_solver_quote(&self, quote: SolverQuote) -> StorageResult<SolverQuote> {
		sqlx::query(
			"INSERT INTO solver_quotes \
			 (id, solver_id, from_chain, to_chain, from_asset, to_asset, from_decimals, to_decimals, \
			  quote, min_amount, max_amount, fixed_cost, expiry, exclusive_for, paused, created_at, updated_at) \
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
		)
		.bind(&quote.id)
		.bind(&quote.solver_id)
		.bind(&quote.from_chain)
		.bind(&quote.to_chain)
		.bind(&quote.from_asset)
		.bind(&quote.to_asset)
		.bind(quote.from_decimals as i16)
		.bind(quote.to_decimals as i16)
		.bind(&quote.quote)
		.bind(&quote.min_amount)
		.bind(&quote.max_amount)
		.bind(&quote.fixed_cost)
		.bind(&quote.expiry)
		.bind(&quote.exclusive_for)
		.bind(quote.paused)
		.bind(quote.created_at)
		.bind(quote.updated_at)
		.execute(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(quote)
	}

	async fn list_solver_quotes(
		&self,
		solver_id: Option<&str>,
	) -> StorageResult<Vec<SolverQuote>> {
		let rows = if let Some(sid) = solver_id {
			sqlx::query(
				"SELECT id, solver_id, from_chain, to_chain, from_asset, to_asset, \
				 from_decimals, to_decimals, quote, min_amount, max_amount, fixed_cost, \
				 expiry, exclusive_for, paused, created_at, updated_at \
				FROM solver_quotes WHERE solver_id = $1 ORDER BY created_at DESC",
			)
			.bind(sid)
			.fetch_all(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?
		} else {
			sqlx::query(
				"SELECT id, solver_id, from_chain, to_chain, from_asset, to_asset, \
				 from_decimals, to_decimals, quote, min_amount, max_amount, fixed_cost, \
				 expiry, exclusive_for, paused, created_at, updated_at \
				FROM solver_quotes ORDER BY created_at DESC",
			)
			.fetch_all(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?
		};

		let quotes = rows
			.iter()
			.map(|row| SolverQuote {
				id: row.get("id"),
				solver_id: row.get("solver_id"),
				from_chain: row.get("from_chain"),
				to_chain: row.get("to_chain"),
				from_asset: row.get("from_asset"),
				to_asset: row.get("to_asset"),
				from_decimals: row.get::<i16, _>("from_decimals") as u8,
				to_decimals: row.get::<i16, _>("to_decimals") as u8,
				quote: row.get("quote"),
				min_amount: row.get("min_amount"),
				max_amount: row.get("max_amount"),
				fixed_cost: row.get("fixed_cost"),
				expiry: row.get("expiry"),
				exclusive_for: row.get("exclusive_for"),
				paused: row.get("paused"),
				created_at: row.get("created_at"),
				updated_at: row.get("updated_at"),
			})
			.collect();
		Ok(quotes)
	}

	async fn delete_solver_quote(&self, id: &str) -> StorageResult<bool> {
		let result = sqlx::query("DELETE FROM solver_quotes WHERE id = $1")
			.bind(id)
			.execute(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(result.rows_affected() > 0)
	}

	async fn toggle_pause_solver_quote(&self, id: &str) -> StorageResult<Option<SolverQuote>> {
		// Toggle paused flag and return updated row
		let row = sqlx::query(
			"UPDATE solver_quotes SET paused = NOT paused, updated_at = now() \
			WHERE id = $1 \
			RETURNING id, solver_id, from_chain, to_chain, from_asset, to_asset, \
			           from_decimals, to_decimals, quote, min_amount, max_amount, fixed_cost, \
			           expiry, exclusive_for, paused, created_at, updated_at",
		)
		.bind(id)
		.fetch_optional(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(row.map(|r| SolverQuote {
			id: r.get("id"),
			solver_id: r.get("solver_id"),
			from_chain: r.get("from_chain"),
			to_chain: r.get("to_chain"),
			from_asset: r.get("from_asset"),
			to_asset: r.get("to_asset"),
			from_decimals: r.get::<i16, _>("from_decimals") as u8,
			to_decimals: r.get::<i16, _>("to_decimals") as u8,
			quote: r.get("quote"),
			min_amount: r.get("min_amount"),
			max_amount: r.get("max_amount"),
			fixed_cost: r.get("fixed_cost"),
			expiry: r.get("expiry"),
			exclusive_for: r.get("exclusive_for"),
			paused: r.get("paused"),
			created_at: r.get("created_at"),
			updated_at: r.get("updated_at"),
		}))
	}
}

// ─── Gift Card Quote Storage ─────────────────────────────────────────────────

/// `side` and `card_type` cross the sqlx boundary as plain strings and come
/// back through `FromStr`. A row whose `side` cannot be parsed is **skipped**
/// rather than defaulted: `side` decides who funds escrow first and which way
/// a silence timeout resolves, so guessing it would route someone's money the
/// wrong way. The table's CHECK constraint means this should be unreachable —
/// it is here so that if it ever happens the quote vanishes from the book
/// instead of mis-settling.
fn giftcard_quote_from_row(r: &sqlx::postgres::PgRow) -> Option<GiftCardQuote> {
	let side_raw: String = r.get("side");
	let card_type_raw: String = r.get("card_type");
	let side = match GiftCardSide::from_str(&side_raw) {
		Ok(s) => s,
		Err(e) => {
			tracing::error!(
				quote_id = %r.get::<String, _>("id"),
				error = %e,
				"skipping gift card quote with unparseable side"
			);
			return None;
		}
	};
	let card_type = match GiftCardType::from_str(&card_type_raw) {
		Ok(t) => t,
		Err(e) => {
			tracing::error!(
				quote_id = %r.get::<String, _>("id"),
				error = %e,
				"skipping gift card quote with unparseable card_type"
			);
			return None;
		}
	};

	Some(GiftCardQuote {
		id: r.get("id"),
		solver_id: r.get("solver_id"),
		side,
		product_id: r.get("product_id"),
		brand: r.get("brand"),
		country_code: r.get("country_code"),
		currency: r.get("currency"),
		card_type,
		face_decimals: r.get::<i16, _>("face_decimals") as u8,
		min_face: r.get("min_face"),
		max_face: r.get("max_face"),
		quote: r.get("quote"),
		fixed_cost: r.get("fixed_cost"),
		payout_chain: r.get("payout_chain"),
		payout_asset: r.get("payout_asset"),
		payout_decimals: r.get::<i16, _>("payout_decimals") as u8,
		expiry: r.get("expiry"),
		exclusive_for: r.get("exclusive_for"),
		paused: r.get("paused"),
		created_at: r.get("created_at"),
		updated_at: r.get("updated_at"),
	})
}

#[async_trait]
impl GiftCardQuoteStorageTrait for PostgresStore {
	async fn create_giftcard_quote(&self, quote: GiftCardQuote) -> StorageResult<GiftCardQuote> {
		sqlx::query(
			"INSERT INTO giftcard_quotes \
			 (id, solver_id, side, product_id, brand, country_code, currency, card_type, \
			  face_decimals, min_face, max_face, quote, fixed_cost, payout_chain, \
			  payout_asset, payout_decimals, expiry, exclusive_for, paused, created_at, updated_at) \
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)",
		)
		.bind(&quote.id)
		.bind(&quote.solver_id)
		.bind(quote.side.as_str())
		.bind(quote.product_id)
		.bind(&quote.brand)
		.bind(&quote.country_code)
		.bind(&quote.currency)
		.bind(quote.card_type.as_str())
		.bind(quote.face_decimals as i16)
		.bind(&quote.min_face)
		.bind(&quote.max_face)
		.bind(&quote.quote)
		.bind(&quote.fixed_cost)
		.bind(&quote.payout_chain)
		.bind(&quote.payout_asset)
		.bind(quote.payout_decimals as i16)
		.bind(&quote.expiry)
		.bind(&quote.exclusive_for)
		.bind(quote.paused)
		.bind(quote.created_at)
		.bind(quote.updated_at)
		.execute(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(quote)
	}

	async fn list_giftcard_quotes(
		&self,
		solver_id: Option<&str>,
	) -> StorageResult<Vec<GiftCardQuote>> {
		let rows = if let Some(sid) = solver_id {
			sqlx::query(
				"SELECT id, solver_id, side, product_id, brand, country_code, currency, card_type, \
			 face_decimals, min_face, max_face, quote, fixed_cost, payout_chain, \
			 payout_asset, payout_decimals, expiry, exclusive_for, paused, created_at, updated_at \
				FROM giftcard_quotes WHERE solver_id = $1 ORDER BY created_at DESC",
			)
			.bind(sid)
			.fetch_all(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?
		} else {
			sqlx::query(
				"SELECT id, solver_id, side, product_id, brand, country_code, currency, card_type, \
			 face_decimals, min_face, max_face, quote, fixed_cost, payout_chain, \
			 payout_asset, payout_decimals, expiry, exclusive_for, paused, created_at, updated_at \
				FROM giftcard_quotes ORDER BY created_at DESC",
			)
			.fetch_all(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?
		};

		Ok(rows.iter().filter_map(giftcard_quote_from_row).collect())
	}

	async fn delete_giftcard_quote(&self, id: &str) -> StorageResult<bool> {
		let result = sqlx::query("DELETE FROM giftcard_quotes WHERE id = $1")
			.bind(id)
			.execute(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(result.rows_affected() > 0)
	}

	async fn toggle_pause_giftcard_quote(
		&self,
		id: &str,
	) -> StorageResult<Option<GiftCardQuote>> {
		let row = sqlx::query(
			"UPDATE giftcard_quotes SET paused = NOT paused, updated_at = now() \
			WHERE id = $1 \
			RETURNING id, solver_id, side, product_id, brand, country_code, currency, card_type, \
			 face_decimals, min_face, max_face, quote, fixed_cost, payout_chain, \
			 payout_asset, payout_decimals, expiry, exclusive_for, paused, created_at, updated_at",
		)
		.bind(id)
		.fetch_optional(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(row.as_ref().and_then(giftcard_quote_from_row))
	}
}

// ─── Gift Card Trade Storage ─────────────────────────────────────────────────

/// `side` and `state` cross the boundary as strings. A row that will not
/// parse is skipped rather than defaulted, for the same reason as the quote
/// reader: `side` decides who funds escrow and which way a timeout resolves,
/// and `state` decides whether a deadline may fire at all. The CHECK
/// constraints make this unreachable; if it ever happens the trade drops out
/// of the resolver's view instead of being mis-settled.
fn giftcard_trade_from_row(r: &sqlx::postgres::PgRow) -> Option<GiftCardTrade> {
	let id: String = r.get("id");
	let side = match GiftCardSide::from_str(&r.get::<String, _>("side")) {
		Ok(v) => v,
		Err(e) => {
			tracing::error!(trade_id = %id, error = %e, "skipping trade with unparseable side");
			return None;
		}
	};
	let card_type = match GiftCardType::from_str(&r.get::<String, _>("card_type")) {
		Ok(v) => v,
		Err(e) => {
			tracing::error!(trade_id = %id, error = %e, "skipping trade with unparseable card_type");
			return None;
		}
	};
	let state = match TradeState::from_str(&r.get::<String, _>("state")) {
		Ok(v) => v,
		Err(e) => {
			tracing::error!(trade_id = %id, error = %e, "skipping trade with unparseable state");
			return None;
		}
	};

	// A malformed envelope is dropped rather than failing the read: the
	// envelope is opaque to this process anyway, and losing the whole row
	// would hide a live trade from its own participants.
	let sealed_code = r
		.get::<Option<serde_json::Value>, _>("sealed_code")
		.and_then(|v| match serde_json::from_value::<SealedCode>(v) {
			Ok(sc) => Some(sc),
			Err(e) => {
				tracing::error!(trade_id = %id, error = %e, "trade has an unreadable sealed_code envelope");
				None
			}
		});

	Some(GiftCardTrade {
		id,
		quote_id: r.get("quote_id"),
		solver_id: r.get("solver_id"),
		side,
		brand: r.get("brand"),
		country_code: r.get("country_code"),
		currency: r.get("currency"),
		card_type,
		face_minor_units: r.get("face_minor_units"),
		rate: r.get("rate"),
		payout_chain: r.get("payout_chain"),
		payout_asset: r.get("payout_asset"),
		payout_minor_units: r.get("payout_minor_units"),
		user_address: r.get("user_address"),
		merchant_address: r.get("merchant_address"),
		state,
		recipient_pubkey: r.get("recipient_pubkey"),
		code_commitment: r.get("code_commitment"),
		sealed_code,
		deadline_at: r.get("deadline_at"),
		resolution_note: r.get("resolution_note"),
		escrow_tx_hash: r.get("escrow_tx_hash"),
		release_tx_hash: r.get("release_tx_hash"),
		created_at: r.get("created_at"),
		updated_at: r.get("updated_at"),
	})
}

#[async_trait]
impl GiftCardTradeStorageTrait for PostgresStore {
	async fn create_giftcard_trade(&self, trade: GiftCardTrade) -> StorageResult<GiftCardTrade> {
		let sealed = match &trade.sealed_code {
			Some(sc) => Some(scrub_nul(
				serde_json::to_value(sc)
					.map_err(|e| StorageError::Operation { message: e.to_string() })?,
			)),
			None => None,
		};

		sqlx::query(
			"INSERT INTO giftcard_trades \
			 (id, quote_id, solver_id, side, brand, country_code, currency, card_type, \
			  face_minor_units, rate, payout_chain, payout_asset, payout_minor_units, \
			  user_address, merchant_address, state, recipient_pubkey, code_commitment, sealed_code, \
			  deadline_at, resolution_note, escrow_tx_hash, release_tx_hash, created_at, updated_at) \
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)",
		)
		.bind(&trade.id)
		.bind(&trade.quote_id)
		.bind(&trade.solver_id)
		.bind(trade.side.as_str())
		.bind(&trade.brand)
		.bind(&trade.country_code)
		.bind(&trade.currency)
		.bind(trade.card_type.as_str())
		.bind(&trade.face_minor_units)
		.bind(&trade.rate)
		.bind(&trade.payout_chain)
		.bind(&trade.payout_asset)
		.bind(&trade.payout_minor_units)
		.bind(&trade.user_address)
		.bind(&trade.merchant_address)
		.bind(trade.state.as_str())
		.bind(&trade.recipient_pubkey)
		.bind(&trade.code_commitment)
		.bind(&sealed)
		.bind(trade.deadline_at)
		.bind(&trade.resolution_note)
		.bind(&trade.escrow_tx_hash)
		.bind(&trade.release_tx_hash)
		.bind(trade.created_at)
		.bind(trade.updated_at)
		.execute(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(trade)
	}

	async fn get_giftcard_trade(&self, id: &str) -> StorageResult<Option<GiftCardTrade>> {
		let row = sqlx::query("SELECT id, quote_id, solver_id, side, brand, country_code, currency, card_type, \
			 face_minor_units, rate, payout_chain, payout_asset, payout_minor_units, \
			 user_address, merchant_address, state, recipient_pubkey, code_commitment, sealed_code, deadline_at, \
			 resolution_note, escrow_tx_hash, release_tx_hash, created_at, updated_at FROM giftcard_trades WHERE id = $1")
			.bind(id)
			.fetch_optional(&self.pool)
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(row.as_ref().and_then(giftcard_trade_from_row))
	}

	async fn list_giftcard_trades(
		&self,
		solver_id: Option<&str>,
		user_address: Option<&str>,
	) -> StorageResult<Vec<GiftCardTrade>> {
		// Both filters are optional and NULL means "don't filter", so one
		// statement covers all four combinations rather than four branches
		// that can drift apart.
		let rows = sqlx::query(
			"SELECT id, quote_id, solver_id, side, brand, country_code, currency, card_type, \
			 face_minor_units, rate, payout_chain, payout_asset, payout_minor_units, \
			 user_address, merchant_address, state, recipient_pubkey, code_commitment, sealed_code, deadline_at, \
			 resolution_note, escrow_tx_hash, release_tx_hash, created_at, updated_at FROM giftcard_trades \
			 WHERE ($1::text IS NULL OR solver_id = $1) \
			   AND ($2::text IS NULL OR lower(user_address) = lower($2)) \
			 ORDER BY created_at DESC",
		)
		.bind(solver_id)
		.bind(user_address)
		.fetch_all(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(rows.iter().filter_map(giftcard_trade_from_row).collect())
	}

	async fn transition_giftcard_trade(
		&self,
		id: &str,
		expected_state: &str,
		update: GiftCardTradeUpdate,
	) -> StorageResult<Option<GiftCardTrade>> {
		let mut tx = self
			.pool
			.begin()
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		// The state guard is part of the UPDATE, not a prior SELECT: a
		// check-then-write would let two actors both observe
		// `awaiting_attestation` and both transition it, paying the escrow
		// out twice. COALESCE keeps unset fields at their current values so a
		// caller that only changes the state cannot blank the commitment.
		let sealed = update.sealed_code.map(scrub_nul);
		let row = sqlx::query(
			"UPDATE giftcard_trades SET \
			   state = $3, \
			   deadline_at = $4, \
			   resolution_note = COALESCE($5, resolution_note), \
			   recipient_pubkey = COALESCE($10, recipient_pubkey), \
			   code_commitment = COALESCE($6, code_commitment), \
			   sealed_code = COALESCE($7, sealed_code), \
			   escrow_tx_hash = COALESCE($8, escrow_tx_hash), \
			   release_tx_hash = COALESCE($9, release_tx_hash), \
			   updated_at = now() \
			 WHERE id = $1 AND state = $2 \
			 RETURNING id, quote_id, solver_id, side, brand, country_code, currency, card_type, \
			 face_minor_units, rate, payout_chain, payout_asset, payout_minor_units, \
			 user_address, merchant_address, state, recipient_pubkey, code_commitment, sealed_code, deadline_at, \
			 resolution_note, escrow_tx_hash, release_tx_hash, created_at, updated_at",
		)
		.bind(id)
		.bind(expected_state)
		.bind(&update.state)
		.bind(update.deadline_at)
		.bind(&update.resolution_note)
		.bind(&update.code_commitment)
		.bind(&sealed)
		.bind(&update.escrow_tx_hash)
		.bind(&update.release_tx_hash)
		.bind(&update.recipient_pubkey)
		.fetch_optional(&mut *tx)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		let Some(row) = row else {
			// No row matched: either the id is unknown or someone else moved
			// it first. Either way this caller's view is stale.
			tx.rollback()
				.await
				.map_err(|e| StorageError::Operation { message: e.to_string() })?;
			return Ok(None);
		};

		sqlx::query(
			"INSERT INTO giftcard_trade_events (trade_id, from_state, to_state, actor, note) \
			 VALUES ($1,$2,$3,$4,$5)",
		)
		.bind(id)
		.bind(expected_state)
		.bind(&update.state)
		.bind(&update.actor)
		.bind(update.resolution_note.as_deref().unwrap_or(""))
		.execute(&mut *tx)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		tx.commit()
			.await
			.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(giftcard_trade_from_row(&row))
	}

	async fn claim_due_trades(&self, limit: i64) -> StorageResult<Vec<GiftCardTrade>> {
		// Read-only lease: the worker decides each trade's outcome in Rust and
		// writes it back through `transition_giftcard_trade`, whose own state
		// guard is what actually prevents a double payout. SKIP LOCKED here
		// just stops two workers doing the same arithmetic at once.
		let rows = sqlx::query(
			"SELECT id, quote_id, solver_id, side, brand, country_code, currency, card_type, \
			 face_minor_units, rate, payout_chain, payout_asset, payout_minor_units, \
			 user_address, merchant_address, state, recipient_pubkey, code_commitment, sealed_code, deadline_at, \
			 resolution_note, escrow_tx_hash, release_tx_hash, created_at, updated_at FROM giftcard_trades \
			 WHERE deadline_at IS NOT NULL AND deadline_at <= now() \
			   AND state IN ('awaiting_code', 'awaiting_attestation') \
			 ORDER BY deadline_at \
			 LIMIT $1 \
			 FOR UPDATE SKIP LOCKED",
		)
		.bind(limit)
		.fetch_all(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(rows.iter().filter_map(giftcard_trade_from_row).collect())
	}

	async fn claim_unpaid_trades(&self, limit: i64) -> StorageResult<Vec<GiftCardTrade>> {
		let rows = sqlx::query(
			"SELECT id, quote_id, solver_id, side, brand, country_code, currency, card_type, \
			 face_minor_units, rate, payout_chain, payout_asset, payout_minor_units, \
			 user_address, merchant_address, state, recipient_pubkey, code_commitment, sealed_code, deadline_at, \
			 resolution_note, escrow_tx_hash, release_tx_hash, created_at, updated_at FROM giftcard_trades \
			 WHERE release_tx_hash IS NULL \
			   AND state IN ('settled_to_card_sender', 'refunded_to_funder') \
			 ORDER BY updated_at \
			 LIMIT $1 \
			 FOR UPDATE SKIP LOCKED",
		)
		.bind(limit)
		.fetch_all(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(rows.iter().filter_map(giftcard_trade_from_row).collect())
	}

	async fn mark_giftcard_trade_paid(
		&self,
		id: &str,
		release_tx_hash: &str,
	) -> StorageResult<bool> {
		// The NULL guard is the idempotency key for payouts: two workers that
		// both released would otherwise both record success, and the second
		// release already reverted on-chain anyway.
		let res = sqlx::query(
			"UPDATE giftcard_trades SET release_tx_hash = $2, updated_at = now() \
			 WHERE id = $1 AND release_tx_hash IS NULL",
		)
		.bind(id)
		.bind(release_tx_hash)
		.execute(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(res.rows_affected() > 0)
	}
}

// ─── Operator Storage ────────────────────────────────────────────────────────

#[async_trait]
impl OperatorStorageTrait for PostgresStore {
	async fn upsert_operator(&self, operator: Operator) -> StorageResult<Operator> {
		let op = operator;
		// When the caller didn't supply an api_key (legacy paths, tests,
		// upsert-on-failure paths) but the row already exists, preserve
		// the existing key. Otherwise generate a fresh one.
		let api_key = if op.api_key.is_empty() {
			None
		} else {
			Some(op.api_key.clone())
		};
		sqlx::query(
			"INSERT INTO operators \
			   (solver_id, wallet_address, fill_wallet_address, fill_worker_url, reputation_score, \
			    fills_total, fills_succeeded, avg_latency_ms, last_active_at, \
			    circuit_breaker_open, api_key, created_at, updated_at) \
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) \
			 ON CONFLICT (solver_id) DO UPDATE SET \
			   wallet_address = EXCLUDED.wallet_address, \
			   fill_wallet_address = EXCLUDED.fill_wallet_address, \
			   fill_worker_url = EXCLUDED.fill_worker_url, \
			   api_key = COALESCE(EXCLUDED.api_key, operators.api_key), \
			   updated_at = now()",
		)
		.bind(&op.solver_id)
		.bind(&op.wallet_address)
		.bind(&op.fill_wallet_address)
		.bind(&op.fill_worker_url)
		.bind(op.reputation_score)
		.bind(op.fills_total as i64)
		.bind(op.fills_succeeded as i64)
		.bind(op.avg_latency_ms as i64)
		.bind(op.last_active_at)
		.bind(op.circuit_breaker_open)
		.bind(api_key)
		.bind(op.created_at)
		.bind(chrono::Utc::now())
		.execute(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(op)
	}

	async fn get_operator(&self, solver_id: &str) -> StorageResult<Option<Operator>> {
		let row = sqlx::query(
			"SELECT solver_id, wallet_address, fill_wallet_address, fill_worker_url, reputation_score, \
			        fills_total, fills_succeeded, avg_latency_ms, last_active_at, \
			        circuit_breaker_open, created_at, updated_at, \
			        settlement_contracts, api_key \
			 FROM operators WHERE solver_id = $1",
		)
		.bind(solver_id)
		.fetch_optional(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(row.map(row_to_operator))
	}

	async fn get_operator_by_api_key(
		&self,
		api_key: &str,
	) -> StorageResult<Option<Operator>> {
		// The unique index on `api_key` makes this O(1).
		let row = sqlx::query(
			"SELECT solver_id, wallet_address, fill_wallet_address, fill_worker_url, reputation_score, \
			        fills_total, fills_succeeded, avg_latency_ms, last_active_at, \
			        circuit_breaker_open, created_at, updated_at, \
			        settlement_contracts, api_key \
			 FROM operators WHERE api_key = $1",
		)
		.bind(api_key)
		.fetch_optional(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(row.map(row_to_operator))
	}

	async fn list_operators(&self) -> StorageResult<Vec<Operator>> {
		let rows = sqlx::query(
			"SELECT solver_id, wallet_address, fill_wallet_address, fill_worker_url, reputation_score, \
			        fills_total, fills_succeeded, avg_latency_ms, last_active_at, \
			        circuit_breaker_open, created_at, updated_at, \
			        settlement_contracts, api_key \
			 FROM operators ORDER BY reputation_score DESC",
		)
		.fetch_all(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(rows.into_iter().map(row_to_operator).collect())
	}

	async fn record_fill_outcome(
		&self,
		solver_id: &str,
		succeeded: bool,
		latency_ms: u64,
	) -> StorageResult<f64> {
		// Two-step: bump counters, then read back the new reputation_score.
		// We compute the rolling avg and reputation nudge in a single SQL
		// statement so concurrent updates don't race.
		let new_score: f64 = sqlx::query_scalar(
			"UPDATE operators SET \
			   fills_total = fills_total + 1, \
			   fills_succeeded = fills_succeeded + CASE WHEN $2 THEN 1 ELSE 0 END, \
			   avg_latency_ms = CASE \
			     WHEN avg_latency_ms = 0 THEN $3::bigint \
			     ELSE (avg_latency_ms::float8 * 0.7 + $3::float8 * 0.3)::bigint \
			   END, \
			   reputation_score = GREATEST(0.0, LEAST(1.0, \
			     reputation_score + CASE WHEN $2 THEN 0.02 ELSE -0.10 END)), \
			   updated_at = now() \
			 WHERE solver_id = $1 \
			 RETURNING reputation_score",
		)
		.bind(solver_id)
		.bind(succeeded)
		.bind(latency_ms as i64)
		.fetch_optional(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?
		.ok_or_else(|| StorageError::NotFound {
			id: format!("operator:{solver_id}"),
		})?;
		Ok(new_score)
	}

	async fn record_heartbeat(&self, solver_id: &str) -> StorageResult<()> {
		sqlx::query(
			"UPDATE operators SET last_active_at = now(), updated_at = now() \
			 WHERE solver_id = $1",
		)
		.bind(solver_id)
		.execute(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(())
	}

	async fn set_fill_worker_url(
		&self,
		solver_id: &str,
		url: Option<String>,
	) -> StorageResult<()> {
		sqlx::query(
			"UPDATE operators SET fill_worker_url = $2, updated_at = now() \
			 WHERE solver_id = $1",
		)
		.bind(solver_id)
		.bind(url)
		.execute(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(())
	}

	async fn set_settlement_contract(
		&self,
		solver_id: &str,
		chain_id: u64,
		address: String,
	) -> StorageResult<()> {
		// Persist the contract map as JSONB. Requires migration
		// `20260727000001_settlement_contracts.sql` to add the
		// `settlement_contracts JSONB NOT NULL DEFAULT '{}'::jsonb`
		// column on the `operators` table.
		sqlx::query(
			"UPDATE operators SET \
			 settlement_contracts = COALESCE(settlement_contracts, '{}'::jsonb) || \
			 jsonb_build_object($2::text, $3::text)::jsonb, \
			 updated_at = now() \
			 WHERE solver_id = $1",
		)
		.bind(solver_id)
		.bind(chain_id.to_string())
		.bind(address)
		.execute(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(())
	}

	async fn delete_settlement_contract(
		&self,
		solver_id: &str,
		chain_id: u64,
	) -> StorageResult<u64> {
		// JSONB remove key → returns the (possibly) updated object. The
		// RETURNING clause lets us distinguish "row updated" from "row
		// unchanged" without a follow-up SELECT.
		let result = sqlx::query(
			"UPDATE operators SET \
			   settlement_contracts = settlement_contracts - $2::text, \
			   updated_at = now() \
			 WHERE solver_id = $1 \
			   AND settlement_contracts ? $2::text \
			 RETURNING solver_id",
		)
		.bind(solver_id)
		.bind(chain_id.to_string())
		.fetch_optional(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(if result.is_some() { 1 } else { 0 })
	}

	async fn set_pending_identity(
		&self,
		solver_id: &str,
		private_key: String,
	) -> StorageResult<()> {
		sqlx::query(
			"UPDATE operators SET \
			   pending_private_key = $2, \
			   pending_identity_set_at = now(), \
			   updated_at = now() \
			 WHERE solver_id = $1",
		)
		.bind(solver_id)
		.bind(private_key)
		.execute(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(())
	}

	async fn take_pending_identity(
		&self,
		solver_id: &str,
	) -> StorageResult<Option<String>> {
		// Atomic check-and-clear: only return the key if (a) one is
		// queued, and (b) it's still inside the TTL window. The
		// CTE-with-RFC layout below lets us do both in a single round
		// trip so two workers polling at the same instant can never both
		// grab the same key.
		let row = sqlx::query(
			"UPDATE operators SET \
			   pending_private_key = NULL, \
			   pending_identity_set_at = NULL, \
			   updated_at = now() \
			 WHERE solver_id = $1 \
			   AND pending_private_key IS NOT NULL \
			   AND pending_identity_set_at IS NOT NULL \
			   AND now() - pending_identity_set_at < make_interval(secs => $2) \
			 RETURNING pending_private_key",
		)
		.bind(solver_id)
		.bind(oif_types::PENDING_IDENTITY_TTL_SECS as i64)
		.fetch_optional(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;

		Ok(row.map(|r| r.get::<String, _>("pending_private_key")))
	}

	async fn clear_pending_identity(&self, solver_id: &str) -> StorageResult<()> {
		sqlx::query(
			"UPDATE operators SET \
			   pending_private_key = NULL, \
			   pending_identity_set_at = NULL, \
			   updated_at = now() \
			 WHERE solver_id = $1",
		)
		.bind(solver_id)
		.execute(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(())
	}

	async fn set_encrypted_fill_wallet_key(
		&self,
		solver_id: &str,
		ciphertext: Vec<u8>,
	) -> StorageResult<()> {
		sqlx::query(
			"UPDATE operators SET \
			   fill_wallet_private_key_ciphertext = $2, \
			   fill_wallet_private_key_set_at = now(), \
			   updated_at = now() \
			 WHERE solver_id = $1",
		)
		.bind(solver_id)
		.bind(&ciphertext)
		.execute(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(())
	}

	async fn get_encrypted_fill_wallet_key(
		&self,
		solver_id: &str,
	) -> StorageResult<Option<Vec<u8>>> {
		let row: Option<(Option<Vec<u8>>,)> = sqlx::query_as(
			"SELECT fill_wallet_private_key_ciphertext FROM operators WHERE solver_id = $1",
		)
		.bind(solver_id)
		.fetch_optional(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(row.and_then(|(v,)| v))
	}

	async fn get_settlement_contract(
		&self,
		solver_id: &str,
		chain_id: u64,
	) -> StorageResult<Option<String>> {
		let row: Option<(Option<serde_json::Value>,)> = sqlx::query_as(
			"SELECT settlement_contracts FROM operators WHERE solver_id = $1",
		)
		.bind(solver_id)
		.fetch_optional(&self.pool)
		.await
		.map_err(|e| StorageError::Operation { message: e.to_string() })?;
		Ok(row
			.and_then(|(v,)| v)
			.and_then(|v| v.get(chain_id.to_string()).map(|x| x.as_str().unwrap_or_default().to_string()))
			.filter(|s| !s.is_empty()))
	}
}

#[async_trait]
impl WorkerStorageTrait for PostgresStore {
  async fn register_worker(
    &self,
    worker_id: &str,
    public_url: &str,
  ) -> StorageResult<()> {
    sqlx::query(
      "INSERT INTO workers (worker_id, public_url, last_active_at, created_at, updated_at)
       VALUES ($1, $2, now(), now(), now())
       ON CONFLICT (worker_id) DO UPDATE SET
         public_url = EXCLUDED.public_url,
         last_active_at = now(),
         updated_at = now()",
    )
    .bind(worker_id)
    .bind(public_url)
    .execute(&self.pool)
    .await
    .map_err(|e| StorageError::Operation { message: e.to_string() })?;
    Ok(())
  }

  async fn worker_heartbeat(&self, worker_id: &str) -> StorageResult<()> {
    sqlx::query(
      "UPDATE workers SET last_active_at = now(), updated_at = now()
       WHERE worker_id = $1",
    )
    .bind(worker_id)
    .execute(&self.pool)
    .await
    .map_err(|e| StorageError::Operation { message: e.to_string() })?;
    Ok(())
  }

  async fn get_worker(&self, worker_id: &str) -> StorageResult<Option<String>> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
      "SELECT public_url FROM workers WHERE worker_id = $1",
    )
    .bind(worker_id)
    .fetch_optional(&self.pool)
    .await
    .map_err(|e| StorageError::Operation { message: e.to_string() })?;
    Ok(row.and_then(|(v,)| v))
  }
}

#[async_trait]
impl VaultStorageTrait for PostgresStore {
  async fn upsert_vault_balance(&self, balance: VaultBalance) -> StorageResult<()> {
    // `available` is overwritten; `locked` is preserved so a future
    // vault-contract integration can write escrow state into the same
    // row without changing the schema. `updated_at` is bumped on every
    // upsert so the dashboard can show "last refreshed at" honestly.
    sqlx::query(
      "INSERT INTO vault_balances \
         (solver_id, chain, asset_address, symbol, name, available, locked, updated_at) \
       VALUES ($1, $2, $3, $4, $5, $6, $7, now()) \
       ON CONFLICT (solver_id, chain, asset_address) DO UPDATE SET \
         symbol = EXCLUDED.symbol, \
         name = EXCLUDED.name, \
         available = EXCLUDED.available, \
         updated_at = now()",
    )
    .bind(&balance.solver_id)
    .bind(&balance.chain)
    .bind(&balance.asset_address)
    .bind(&balance.symbol)
    .bind(&balance.name)
    .bind(&balance.available)
    .bind(&balance.locked)
    .execute(&self.pool)
    .await
    .map_err(|e| StorageError::Operation { message: e.to_string() })?;
    Ok(())
  }

  async fn list_vault_balances(&self, solver_id: &str) -> StorageResult<Vec<VaultBalance>> {
    // (chain, symbol) ordering is stable for the dashboard's
    // table render and cheap on a unique PK.
    let rows = sqlx::query(
      "SELECT solver_id, chain, asset_address, symbol, name, available, locked, updated_at \
       FROM vault_balances WHERE solver_id = $1 \
       ORDER BY chain ASC, symbol ASC",
    )
    .bind(solver_id)
    .fetch_all(&self.pool)
    .await
    .map_err(|e| StorageError::Operation { message: e.to_string() })?;

    Ok(rows.into_iter().map(row_to_vault_balance).collect())
  }

  async fn delete_vault_balance(
    &self,
    solver_id: &str,
    chain: &str,
    asset_address: &str,
  ) -> StorageResult<bool> {
    let res = sqlx::query(
      "DELETE FROM vault_balances \
       WHERE solver_id = $1 AND chain = $2 AND asset_address = $3",
    )
    .bind(solver_id)
    .bind(chain)
    .bind(asset_address.to_lowercase())
    .execute(&self.pool)
    .await
    .map_err(|e| StorageError::Operation { message: e.to_string() })?;
    Ok(res.rows_affected() > 0)
  }
}

fn row_to_vault_balance(r: sqlx::postgres::PgRow) -> VaultBalance {
  VaultBalance {
    solver_id: r.get("solver_id"),
    chain: r.get("chain"),
    asset_address: r.get("asset_address"),
    symbol: r.get("symbol"),
    name: r.get("name"),
    available: r.get("available"),
    locked: r.get("locked"),
    updated_at: r.get("updated_at"),
  }
}

fn row_to_operator(r: sqlx::postgres::PgRow) -> Operator {
	// `fill_wallet_address` was added in migration 20260728000000. Older
	// rows may not have it; fall back to `wallet_address` so the row
	// still deserialises.
	let fill_wallet_address: String = r
		.try_get::<Option<String>, _>("fill_wallet_address")
		.ok()
		.flatten()
		.unwrap_or_else(|| r.get("wallet_address"));
	Operator {
		solver_id: r.get("solver_id"),
		wallet_address: r.get("wallet_address"),
		fill_wallet_address,
		fill_worker_url: r.get("fill_worker_url"),
		reputation_score: r.get("reputation_score"),
		fills_total: r.get::<i64, _>("fills_total") as u64,
		fills_succeeded: r.get::<i64, _>("fills_succeeded") as u64,
		avg_latency_ms: r.get::<i64, _>("avg_latency_ms") as u64,
		last_active_at: r.get("last_active_at"),
		circuit_breaker_open: r.get("circuit_breaker_open"),
		// The `settlement_contracts` JSONB column is optional (older
		// deployments may not have the migration applied yet). Default
		// to empty when missing.
		settlement_contracts: r
			.try_get::<Option<serde_json::Value>, _>("settlement_contracts")
			.ok()
			.flatten()
			.and_then(|v| serde_json::from_value(v).ok())
			.unwrap_or_default(),
		// `api_key` was added in migration 20260729000000. Older rows
		// before that migration get a deterministic placeholder so the
		// row still deserialises; the registration handler will rewrite
		// it on the next dashboard interaction.
		api_key: r
			.try_get::<Option<String>, _>("api_key")
			.ok()
			.flatten()
			.unwrap_or_default(),
		created_at: r.get("created_at"),
		updated_at: r.get("updated_at"),
	}
}

#[cfg(test)]
mod insert_shape_tests {
	/// Every `INSERT` in this file must name as many value expressions as it
	/// does columns.
	///
	/// This exists because a real one did not. `create_giftcard_trade` grew a
	/// `card_type` column and a matching `.bind`, but its `VALUES` list kept
	/// 24 placeholders for 25 columns. Postgres rejected it at runtime with
	/// "INSERT has more target columns than expressions" — in production,
	/// because every storage test here runs against the in-memory store and
	/// never sees this SQL at all.
	///
	/// Counting expressions rather than `$n` placeholders matters: several
	/// statements legitimately pass `now()` for a column, so a placeholder
	/// count alone reports false mismatches.
	const SOURCE: &str = include_str!("postgres_store.rs");

	/// Rust string literals here wrap lines with a trailing backslash; undo
	/// that so the SQL is one line before parsing it.
	fn unwrap_continuations(sql: &str) -> String {
		let mut out = String::with_capacity(sql.len());
		let mut chars = sql.chars().peekable();
		while let Some(c) = chars.next() {
			if c == '\\' && chars.peek() == Some(&'\n') {
				chars.next();
				while chars.peek().is_some_and(|c| c.is_whitespace()) {
					chars.next();
				}
				out.push(' ');
			} else {
				out.push(c);
			}
		}
		out
	}

	/// Split on top-level commas, ignoring those nested in parentheses — a
	/// value like `coalesce(a, b)` is one expression, not two.
	fn count_items(list: &str) -> usize {
		let (mut depth, mut items, mut seen) = (0i32, 1usize, false);
		for c in list.chars() {
			match c {
				'(' => depth += 1,
				')' => depth -= 1,
				',' if depth == 0 => items += 1,
				c if !c.is_whitespace() => seen = true,
				_ => {},
			}
		}
		if seen { items } else { 0 }
	}

	/// The parenthesised group starting at or after `from`.
	fn group_after(hay: &str, from: usize) -> Option<(String, usize)> {
		let open = hay[from..].find('(')? + from;
		let (mut depth, mut end) = (0i32, open);
		for (i, c) in hay[open..].char_indices() {
			match c {
				'(' => depth += 1,
				')' => {
					depth -= 1;
					if depth == 0 {
						end = open + i;
						break;
					}
				},
				_ => {},
			}
		}
		Some((hay[open + 1..end].to_string(), end))
	}

	#[test]
	fn every_insert_has_one_expression_per_column() {
		let sql = unwrap_continuations(SOURCE);
		let mut checked = 0;

		for (idx, _) in sql.match_indices("INSERT INTO ") {
			let after = idx + "INSERT INTO ".len();
			let table: String = sql[after..]
				.chars()
				.take_while(|c| c.is_alphanumeric() || *c == '_')
				.collect();

			// This test reads its own source, which contains the search
			// string itself; those matches have no table name.
			if table.is_empty() {
				continue;
			}

			let Some((columns, cols_end)) = group_after(&sql, after) else { continue };
			let Some(values_at) = sql[cols_end..].find("VALUES") else { continue };
			let Some((values, _)) = group_after(&sql, cols_end + values_at) else { continue };

			let n_cols = count_items(&columns);
			let n_vals = count_items(&values);
			assert_eq!(
				n_cols, n_vals,
				"INSERT INTO {table}: {n_cols} columns but {n_vals} value expressions"
			);
			checked += 1;
		}

		// If the parser silently matches nothing, the test passes while
		// guarding nothing.
		assert!(checked >= 8, "expected to check several INSERTs, checked {checked}");
	}
}
