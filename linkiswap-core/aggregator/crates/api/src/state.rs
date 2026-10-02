use std::sync::Arc;

use oif_service::{
	AggregatorTrait, IntegrityTrait, JobProcessor, OrderServiceTrait, SolverServiceTrait,
};
use oif_storage::Storage;
use oif_types::Sealer;

use crate::order_broadcast::OrderBroadcaster;

/// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
	pub aggregator_service: Arc<dyn AggregatorTrait>,
	pub order_service: Arc<dyn OrderServiceTrait>,
	pub solver_service: Arc<dyn SolverServiceTrait>,
	pub integrity_service: Arc<dyn IntegrityTrait>,
	pub storage: Arc<dyn Storage>,
	/// On-chain settlement for gift card trades. Present even when no
	/// attestor key is configured — it reports itself disabled, and the
	/// endpoints refuse trades rather than accepting ones they could never
	/// pay out.
	pub giftcard_escrow: Arc<oif_service::GiftCardEscrowClient>,
	/// Background job processor for maintenance tasks
	pub job_processor: Arc<JobProcessor>,

	// Authentication
	pub authenticator: Arc<dyn oif_types::auth::Authenticator>,
	pub rate_limiter: Arc<dyn oif_types::auth::RateLimiter>,
	pub auth_config: crate::auth::middleware::AuthConfig,

	/// Replay-protection cache for fill-worker signed requests. Single
	/// instance shared across the whole server; entries are evicted on
	/// a TTL basis.
	pub fill_worker_nonce_cache: Arc<crate::auth::fill_worker_auth::NonceCache>,

	/// Server-side order broadcast channel used to push new orders to
	/// subscribed fill-workers in real time via `/ws/orders`. Replaces
	/// the previous `poll_next_order` loop.
	pub order_broadcaster: OrderBroadcaster,

	/// AES-256-GCM sealer for encrypting operator fill-wallet private
	/// keys at rest. Optional so unit tests that don't exercise the
	/// encryption path don't need to construct one; the registration
	/// handler refuses to run without it (returns 503 on `None`).
	pub sealer: Option<Arc<Sealer>>,

	/// Per-chain settlement contract addresses, tokens, and RPC
	/// endpoints. Loaded once at startup (baked-in testnet defaults +
	/// `CHAIN_RPCS` / `CHAIN_REGISTRY_JSON` env overrides).
	pub chain_registry: Arc<oif_config::ChainRegistry>,

	/// Shared secret authenticating the hosted multi-tenant fill-worker's
	/// server-to-server calls (`x-worker-token` header). `None` disables
	/// the token path entirely. Sourced from `FILL_WORKER_TOKEN`.
	pub worker_token: Option<String>,
}
