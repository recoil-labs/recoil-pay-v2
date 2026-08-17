//! OIF Aggregator Server
//!
//! Main entry point for the aggregator server

use oif_aggregator::AggregatorBuilder;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
	// Load configuration
	dotenvy::dotenv().ok();
	let database_url = std::env::var("DATABASE_URL").unwrap_or_default();

	if !database_url.is_empty() {
		#[cfg(feature = "postgres")]
		{
			use oif_storage::PostgresStore;
			tracing::info!("Using PostgreSQL storage");
			let storage = PostgresStore::new(&database_url).await
				.expect("Failed to initialize PostgreSQL storage");
			AggregatorBuilder::with_storage(storage).start_server().await
		}
		#[cfg(not(feature = "postgres"))]
		{
			tracing::warn!("DATABASE_URL provided but postgres feature is not enabled. Falling back to memory storage.");
			AggregatorBuilder::new().start_server().await
		}
	} else {
		tracing::info!("Using Memory storage (no DATABASE_URL provided)");
		AggregatorBuilder::new().start_server().await
	}
}
