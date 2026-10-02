//! Storage traits for pluggable storage implementations

// Re-export the storage traits from types crate
pub use oif_types::storage::{
	MetricsStorageTrait as MetricsStorage, OrderStorageTrait as OrderStorage,
	SolverStorageTrait as SolverStorage, SolverQuoteStorageTrait, GiftCardQuoteStorageTrait,
	GiftCardTradeStorageTrait, GiftCardTradeUpdate,
	StorageError, StorageResult,
	StorageTrait as Storage, CircuitBreakerStorageTrait as CircuitBreakerStorage, Repository,
};
