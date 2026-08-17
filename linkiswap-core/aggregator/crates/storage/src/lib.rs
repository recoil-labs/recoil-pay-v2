//! OIF Storage
//!
//! Storage implementations for the Open Order Framework Aggregator.

pub mod memory_store;
#[cfg(feature = "postgres")]
pub mod postgres_store;
pub mod traits;

pub use memory_store::MemoryStore;
#[cfg(feature = "postgres")]
pub use postgres_store::PostgresStore;
pub use traits::Storage;
