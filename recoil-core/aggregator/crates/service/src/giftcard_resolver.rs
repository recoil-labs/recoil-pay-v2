//! Resolves gift card trades whose deadline has passed.
//!
//! This worker is the thing that makes the escrow safe to stand behind. A
//! gift card's validity is a fact about a brand's database, so release has to
//! be attested — and an attestation can simply be withheld. Without a clock,
//! whichever party ends up holding the asset nobody can verify could just
//! stop replying and keep both the card and the money.
//!
//! The decision itself lives in [`oif_types::GiftCardTrade::on_deadline_passed`]
//! and is one branch: **whoever the clock is waiting on, loses.** This module
//! is only the loop around it — find due trades, ask the trade what should
//! happen, write it back under a state guard.
//!
//! Note what is deliberately *not* here: no direction-specific branch, no
//! `if side == Buy`. Every attempt to special-case a direction in the worker
//! is an opportunity to get one of them backwards, so the worker never looks
//! at `side` at all.

use oif_storage::Storage;
use oif_types::{GiftCardTrade, GiftCardTradeUpdate, Party};
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tracing::{error, info, warn};

/// How many due trades one pass takes. Bounded so a backlog is worked
/// through in steady batches rather than one enormous transaction.
pub const DEFAULT_BATCH_SIZE: i64 = 50;

/// Gap between passes. Deadlines are measured in tens of minutes, so polling
/// faster than this buys nothing.
pub const DEFAULT_INTERVAL_SECS: u64 = 30;

#[derive(Debug, Error)]
pub enum ResolverError {
	#[error("storage error: {0}")]
	Storage(String),
}

pub type ResolverResult<T> = Result<T, ResolverError>;

/// What one pass did.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ResolverPass {
	pub considered: usize,
	/// Trades moved to a terminal state by this pass.
	pub resolved: usize,
	/// Trades another actor moved first. Expected, not an error: a merchant
	/// attesting in the same second as the deadline is a race the state
	/// guard settles, and the merchant should win it.
	pub raced: usize,
	pub failed: usize,
	/// Escrow released to each party, for the metrics the dispute console
	/// surfaces — a merchant whose trades mostly resolve by timeout is a
	/// merchant to look at.
	pub paid_user: usize,
	pub paid_merchant: usize,
}

pub struct GiftCardResolver {
	storage: Arc<dyn Storage>,
	batch_size: i64,
	interval: Duration,
}

impl GiftCardResolver {
	pub fn new(storage: Arc<dyn Storage>) -> Self {
		Self {
			storage,
			batch_size: DEFAULT_BATCH_SIZE,
			interval: Duration::from_secs(DEFAULT_INTERVAL_SECS),
		}
	}

	pub fn with_batch_size(mut self, n: i64) -> Self {
		self.batch_size = n;
		self
	}

	pub fn with_interval(mut self, d: Duration) -> Self {
		self.interval = d;
		self
	}

	/// Run forever. Intended to be spawned once at startup.
	pub async fn run(self) {
		info!(
			interval_secs = self.interval.as_secs(),
			batch = self.batch_size,
			"gift card deadline resolver started"
		);
		let mut ticker = tokio::time::interval(self.interval);
		loop {
			ticker.tick().await;
			match self.run_once().await {
				Ok(pass) if pass.considered > 0 => {
					info!(
						considered = pass.considered,
						resolved = pass.resolved,
						raced = pass.raced,
						failed = pass.failed,
						"resolved expired gift card trades"
					);
				}
				Ok(_) => {}
				// A failed pass must not kill the loop: the next tick retries,
				// and the deadlines it missed are still due.
				Err(e) => error!(error = %e, "gift card resolver pass failed"),
			}
		}
	}

	/// One pass. Separated from [`Self::run`] so it can be driven directly
	/// in tests and from an admin endpoint.
	pub async fn run_once(&self) -> ResolverResult<ResolverPass> {
		let due = self
			.storage
			.claim_due_trades(self.batch_size)
			.await
			.map_err(|e| ResolverError::Storage(e.to_string()))?;

		let mut pass = ResolverPass {
			considered: due.len(),
			..Default::default()
		};

		for trade in due {
			match self.resolve_one(&trade).await {
				Ok(Some(paid)) => {
					pass.resolved += 1;
					match paid {
						Party::User => pass.paid_user += 1,
						Party::Merchant => pass.paid_merchant += 1,
					}
				}
				Ok(None) => pass.raced += 1,
				Err(e) => {
					pass.failed += 1;
					error!(trade_id = %trade.id, error = %e, "could not resolve expired trade");
				}
			}
		}

		Ok(pass)
	}

	/// `Ok(Some(party))` when this pass resolved the trade and paid `party`.
	/// `Ok(None)` when somebody else got there first.
	async fn resolve_one(&self, trade: &GiftCardTrade) -> ResolverResult<Option<Party>> {
		let now = chrono::Utc::now();

		// Re-deriving the decision from the trade means the worker holds no
		// policy of its own. If the deadline turns out not to have passed
		// after all — a clock skew, a row that changed between the claim and
		// here — the trade says so and nothing happens.
		let transition = match trade.on_deadline_passed(now) {
			Ok(t) => t,
			Err(reason) => {
				warn!(trade_id = %trade.id, state = %trade.state, reason = %reason, "skipping trade that is no longer due");
				return Ok(None);
			}
		};

		let updated = self
			.storage
			.transition_giftcard_trade(
				&trade.id,
				trade.state.as_str(),
				GiftCardTradeUpdate {
					state: transition.next.as_str().to_string(),
					deadline_at: transition.deadline_at,
					resolution_note: Some(transition.note.clone()),
					// `actor` is what tells a later reader that nobody chose
					// this outcome — the clock did.
					actor: "system".to_string(),
					..Default::default()
				},
			)
			.await
			.map_err(|e| ResolverError::Storage(e.to_string()))?;

		match updated {
			Some(_) => {
				info!(
					trade_id = %trade.id,
					from = %trade.state,
					to = %transition.next,
					pays = ?transition.pays,
					"deadline passed"
				);
				Ok(transition.pays)
			}
			// The state guard rejected the write, so the trade moved on
			// between the claim and now — the other party acted just in time.
			None => {
				info!(trade_id = %trade.id, "trade changed state before the deadline could fire");
				Ok(None)
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use chrono::{Duration as ChronoDuration, Utc};
	use oif_storage::MemoryStore;
	use oif_types::storage::GiftCardTradeStorageTrait;
	use oif_types::{GiftCardSide, GiftCardTrade, TradeState};

	fn trade(id: &str, side: GiftCardSide, state: TradeState, due: bool) -> GiftCardTrade {
		GiftCardTrade {
			id: id.into(),
			quote_id: "gcq-1".into(),
			solver_id: "solver-1".into(),
			side,
			brand: "Amazon".into(),
			country_code: "US".into(),
			currency: "USD".into(),
			card_type: oif_types::GiftCardType::Ecode,
			face_minor_units: "10000".into(),
			rate: "0.88".into(),
			payout_chain: "eip155:84532".into(),
			payout_asset: "USDC".into(),
			payout_minor_units: "88000000".into(),
			user_address: "0xuser".into(),
			merchant_address: "0xmerchant".into(),
			state,
			recipient_pubkey: None,
			code_commitment: None,
			sealed_code: None,
			deadline_at: Some(if due {
				Utc::now() - ChronoDuration::minutes(1)
			} else {
				Utc::now() + ChronoDuration::hours(1)
			}),
			resolution_note: None,
			escrow_tx_hash: None,
			release_tx_hash: None,
			created_at: Utc::now(),
			updated_at: Utc::now(),
		}
	}

	async fn store_with(trades: Vec<GiftCardTrade>) -> Arc<dyn Storage> {
		let store = MemoryStore::new();
		for t in trades {
			store.create_giftcard_trade(t).await.unwrap();
		}
		Arc::new(store)
	}

	#[tokio::test]
	async fn a_stalling_merchant_pays_the_user_who_sold_the_card() {
		// Merchant is buying, user already sent the code, merchant went
		// quiet. The user must not lose both the card and the money.
		let storage =
			store_with(vec![trade("t1", GiftCardSide::Buy, TradeState::AwaitingAttestation, true)])
				.await;
		let pass = GiftCardResolver::new(storage.clone()).run_once().await.unwrap();

		assert_eq!(pass.resolved, 1);
		assert_eq!(pass.paid_user, 1);
		assert_eq!(pass.paid_merchant, 0);

		let t = storage.get_giftcard_trade("t1").await.unwrap().unwrap();
		assert_eq!(t.state, TradeState::SettledToCardSender);
		assert!(t.deadline_at.is_none(), "a resolved trade keeps no clock");
	}

	#[tokio::test]
	async fn a_buyer_who_never_confirms_pays_the_merchant_who_delivered() {
		// The mirror case: merchant sold, user has the code and stayed quiet.
		let storage = store_with(vec![trade(
			"t1",
			GiftCardSide::Sell,
			TradeState::AwaitingAttestation,
			true,
		)])
		.await;
		let pass = GiftCardResolver::new(storage.clone()).run_once().await.unwrap();

		assert_eq!(pass.paid_merchant, 1);
		let t = storage.get_giftcard_trade("t1").await.unwrap().unwrap();
		assert_eq!(t.state, TradeState::SettledToCardSender);
	}

	#[tokio::test]
	async fn a_card_that_never_arrives_refunds_whoever_funded_escrow() {
		let storage = store_with(vec![
			trade("buy", GiftCardSide::Buy, TradeState::AwaitingCode, true),
			trade("sell", GiftCardSide::Sell, TradeState::AwaitingCode, true),
		])
		.await;
		let pass = GiftCardResolver::new(storage.clone()).run_once().await.unwrap();

		assert_eq!(pass.resolved, 2);
		// Merchant funded the buy-side trade; user funded the sell-side one.
		assert_eq!(pass.paid_merchant, 1);
		assert_eq!(pass.paid_user, 1);

		for id in ["buy", "sell"] {
			let t = storage.get_giftcard_trade(id).await.unwrap().unwrap();
			assert_eq!(t.state, TradeState::RefundedToFunder, "{id}");
		}
	}

	#[tokio::test]
	async fn a_trade_whose_clock_is_still_running_is_left_alone() {
		let storage =
			store_with(vec![trade("t1", GiftCardSide::Buy, TradeState::AwaitingAttestation, false)])
				.await;
		let pass = GiftCardResolver::new(storage.clone()).run_once().await.unwrap();

		assert_eq!(pass.considered, 0);
		assert_eq!(pass.resolved, 0);
		let t = storage.get_giftcard_trade("t1").await.unwrap().unwrap();
		assert_eq!(t.state, TradeState::AwaitingAttestation);
	}

	#[tokio::test]
	async fn a_disputed_trade_is_never_resolved_by_the_clock() {
		// A human is deciding this one. A timeout firing underneath them
		// would settle the case by accident.
		let mut t = trade("t1", GiftCardSide::Buy, TradeState::Disputed, true);
		// Force a stale deadline onto it, which the DB CHECK would reject but
		// which the worker must still refuse to act on.
		t.deadline_at = Some(Utc::now() - ChronoDuration::hours(5));
		let storage = store_with(vec![t]).await;

		let pass = GiftCardResolver::new(storage.clone()).run_once().await.unwrap();
		assert_eq!(pass.resolved, 0);
		let t = storage.get_giftcard_trade("t1").await.unwrap().unwrap();
		assert_eq!(t.state, TradeState::Disputed);
	}

	#[tokio::test]
	async fn resolving_twice_pays_out_only_once() {
		// The failure this guards against is the expensive one: two passes,
		// or two workers, both releasing the same escrow.
		let storage =
			store_with(vec![trade("t1", GiftCardSide::Buy, TradeState::AwaitingAttestation, true)])
				.await;
		let resolver = GiftCardResolver::new(storage.clone());

		let first = resolver.run_once().await.unwrap();
		let second = resolver.run_once().await.unwrap();

		assert_eq!(first.resolved, 1);
		assert_eq!(second.resolved, 0, "the second pass must not pay again");
		assert_eq!(second.considered, 0);
	}

	#[tokio::test]
	async fn the_batch_size_bounds_one_pass() {
		let storage = store_with(
			(0..5)
				.map(|i| {
					trade(
						&format!("t{i}"),
						GiftCardSide::Buy,
						TradeState::AwaitingCode,
						true,
					)
				})
				.collect(),
		)
		.await;

		let pass = GiftCardResolver::new(storage)
			.with_batch_size(2)
			.run_once()
			.await
			.unwrap();
		assert_eq!(pass.considered, 2);
	}
}
