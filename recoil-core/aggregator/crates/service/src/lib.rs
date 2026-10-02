//! OIF Service
//!
//! Core logic for quote aggregation and scoring.

pub mod aggregator;
pub mod circuit_breaker;
pub mod giftcard_escrow;
pub mod giftcard_exposure;
pub mod giftcard_payout;
pub mod giftcard_ranker;
pub mod giftcard_resolver;
pub mod integrity;
pub mod jobs;
pub mod order;
pub mod push_quote_ranker;
pub mod solver_adapter;
pub mod solver_filter;
pub mod solver_repository;

pub use aggregator::{
	AggregatorResult, AggregatorService, AggregatorServiceError, AggregatorTrait, SolverTaskResult,
	TaskExecutor, TaskExecutorTrait,
};
pub use circuit_breaker::{CircuitBreakerService, CircuitBreakerTrait};
pub use giftcard_exposure::{
	Exposure, DEFAULT_EXPOSURE_MULTIPLE,
};
pub use giftcard_escrow::{
	EscrowError, ExpectedLock, GiftCardEscrowClient, VerifiedLock,
};
pub use giftcard_payout::{
	GiftCardPayoutWorker, PayoutPass, DEFAULT_PAYOUT_BATCH, DEFAULT_PAYOUT_INTERVAL_SECS,
};
pub use giftcard_resolver::{
	GiftCardResolver, ResolverError, ResolverPass, DEFAULT_BATCH_SIZE, DEFAULT_INTERVAL_SECS,
};
pub use giftcard_ranker::{
	GiftCardIntent, GiftCardRanker, GiftCardRankerError, GiftCardRankingResult,
	ScoredGiftCardQuote,
};

#[cfg(test)]
pub use aggregator::{MockAggregatorTrait, MockTaskExecutorTrait};
pub use integrity::{IntegrityError, IntegrityService, IntegrityTrait};
pub use oif_types::models::health::SolverStats;
pub use oif_types::IntegrityPayload;
#[cfg(test)]
pub use order::MockOrderServiceTrait;
pub use order::{OrderService, OrderServiceError, OrderServiceTrait};
pub use solver_adapter::{SolverAdapterError, SolverAdapterService, SolverAdapterTrait};
pub use solver_filter::{
	Compatibility, CompatibilityAnalyzer, CompatibilityAnalyzerTrait, SolverFilterService,
	SolverFilterTrait, SolverSelector, SolverSelectorTrait,
};
#[cfg(test)]
pub use solver_filter::{
	MockCompatibilityAnalyzerTrait, MockSolverFilterTrait, MockSolverSelectorTrait,
};
#[cfg(test)]
pub use solver_repository::MockSolverServiceTrait;
pub use solver_repository::{SolverService, SolverServiceError, SolverServiceTrait};
#[cfg(test)]
pub use {circuit_breaker::MockCircuitBreakerTrait, integrity::MockIntegrityTrait};

// Background job processing
#[cfg(test)]
pub use jobs::processor::JobHandler;
pub use jobs::{
	BackgroundJob, BackgroundJobHandler, JobError, JobInfo, JobInfoStats, JobProcessor,
	JobProcessorConfig, JobResult, JobStatus, RetryPolicy, ScheduledJob,
};
