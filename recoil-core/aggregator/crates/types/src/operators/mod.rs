//! Operator domain model.
//!
//! Represents a solver-operator account that pushes quotes through the
//! dashboard. Each operator owns:
//!
//! - A wallet address (used for EIP-712 challenges).
//! - An optional fill-worker URL (where the aggregator forwards signed orders).
//! - Aggregated reputation metrics that the ranker reads when scoring quotes.
//!
//! Operators are persisted by the aggregator and consulted by the push-quote
//! ranker in `oif_service::push_quote_ranker`.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Default reputation score assigned to a brand-new operator. We anchor at 0.5
/// (neutral) so newcomers are not punished by comparison, but can grow up
/// to 1.0 by completing fills successfully.
pub const DEFAULT_REPUTATION_SCORE: f64 = 0.5;
/// Floor — operators who fail too often drift toward this but never below.
pub const MIN_REPUTATION_SCORE: f64 = 0.0;
/// Ceiling — operators who complete many fills cap out here.
pub const MAX_REPUTATION_SCORE: f64 = 1.0;
/// Maximum age (seconds) of a queued-but-unpicked-up fill-wallet
/// private key before it's auto-purged on next `take_pending_identity`.
/// 24h gives an operator plenty of time to redeploy their worker after
/// a Render rebuild; anything older is almost certainly abandoned.
pub const PENDING_IDENTITY_TTL_SECS: u64 = 24 * 60 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Operator {
	/// Stable identifier. Conventionally lower-cased wallet address or a
	/// dashboard-derived handle.
	pub solver_id: String,
	/// Wallet that signed the registration challenge. Authoritative.
	/// Used only to verify operator identity — it does NOT sign fills.
	pub wallet_address: String,
	/// Hot-wallet that signs on-chain fill transactions. Generated
	/// automatically at registration and shown to the operator once.
	/// Distinct from `wallet_address` so a compromised fill-worker
	/// doesn't compromise the operator's identity.
	pub fill_wallet_address: String,
	/// Optional URL of the operator's fill-worker binary. When set, the
	/// aggregator forwards signed orders here for on-chain execution.
	pub fill_worker_url: Option<String>,
	/// Cached aggregated reputation in `[0, 1]`.
	pub reputation_score: f64,
	/// Total number of fill attempts the operator has been assigned.
	pub fills_total: u64,
	/// Number of fills that completed successfully (settled + claimed).
	pub fills_succeeded: u64,
	/// Rolling average fill latency in milliseconds.
	pub avg_latency_ms: u64,
	/// Last time the operator's fill-worker checked in (heartbeat).
	pub last_active_at: Option<DateTime<Utc>>,
	/// When the aggregator's circuit breaker has tripped on this operator.
	/// While true, no quotes from them are surfaced.
	pub circuit_breaker_open: bool,
	/// Per-chain settlement contract addresses that this operator will
	/// receive fills against. Keyed by chain id (e.g. `11155420` for
	/// Optimism Sepolia). An operator must register at least one
	/// contract per chain they want to fill on.
	pub settlement_contracts: HashMap<u64, String>,
	/// Per-operator dashboard API key. Sent as `x-api-key` on every
	/// dashboard request and as `apiKey` in the WebSocket query string.
	/// Generated server-side at registration time and surfaced in the
	/// registration response so the dashboard can persist it. Each
	/// operator has a unique key — there is no shared admin key.
	pub api_key: String,
	pub created_at: DateTime<Utc>,
	pub updated_at: DateTime<Utc>,
}

impl Operator {
	/// Construct an Operator where the operator's registered wallet is
	/// also the fill-wallet. Used as a fallback when no separate fill
	/// key was generated (e.g. during backfill for pre-Option-A operators).
	pub fn new(solver_id: impl Into<String>, wallet_address: impl Into<String>) -> Self {
		let addr = wallet_address.into();
		Self::with_fill_wallet(solver_id, addr.clone(), addr)
	}

	/// Construct an Operator with a dedicated fill-wallet that is
	/// distinct from the operator's registered wallet. This is the
	/// constructor used by the registration flow under Option A.
	pub fn with_fill_wallet(
		solver_id: impl Into<String>,
		wallet_address: impl Into<String>,
		fill_wallet_address: impl Into<String>,
	) -> Self {
		let now = Utc::now();
		Self {
			solver_id: solver_id.into(),
			wallet_address: wallet_address.into(),
			fill_wallet_address: fill_wallet_address.into(),
			fill_worker_url: None,
			reputation_score: DEFAULT_REPUTATION_SCORE,
			fills_total: 0,
			fills_succeeded: 0,
			avg_latency_ms: 0,
			last_active_at: None,
			circuit_breaker_open: false,
			settlement_contracts: HashMap::new(),
			// Set by the registration handler before persisting. Defaults
			// to an empty string so the `with_fill_wallet` constructor
			// remains usable for tests / backfill paths that don't care
			// about dashboard auth.
			api_key: String::new(),
			created_at: now,
			updated_at: now,
		}
	}

	/// Computed historical success rate in `[0, 1]`. Returns 1.0 when no
	/// history exists yet — newcomers are not penalised for empty stats.
	pub fn success_rate(&self) -> f64 {
		if self.fills_total == 0 {
			return 1.0;
		}
		self.fills_succeeded as f64 / self.fills_total as f64
	}
}
