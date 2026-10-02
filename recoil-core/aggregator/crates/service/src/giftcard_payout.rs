//! Pays out gift card trades that have reached a terminal paying state.
//!
//! Deliberately a worker rather than part of the request that settles a
//! trade. Three reasons, all learned the expensive way elsewhere in this
//! codebase:
//!
//! - A merchant attesting "card is good" must not get a 500 because an RPC
//!   was briefly unreachable. The attestation is a fact; the payment is a
//!   consequence, and the two should not fail together.
//! - Retries come for free. A release that fails is simply still unpaid on
//!   the next pass.
//! - The timeout resolver and the attestation path both produce terminal
//!   trades. One payout queue means one implementation of "who gets paid",
//!   rather than the same derivation copied into each.
//!
//! Idempotency has two independent guards, because paying an escrow out
//! twice is the one failure here that cannot be undone: `release_tx_hash` is
//! written under a `WHERE release_tx_hash IS NULL`, and the contract itself
//! rejects a second release on a lock it has already settled.

use oif_storage::Storage;
use oif_types::GiftCardTrade;
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info, warn};

use crate::giftcard_escrow::{EscrowError, GiftCardEscrowClient};

pub const DEFAULT_PAYOUT_BATCH: i64 = 25;
pub const DEFAULT_PAYOUT_INTERVAL_SECS: u64 = 20;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct PayoutPass {
	pub considered: usize,
	pub paid: usize,
	/// Already released by another pass or another worker.
	pub skipped: usize,
	pub failed: usize,
}

pub struct GiftCardPayoutWorker {
	storage: Arc<dyn Storage>,
	escrow: Arc<GiftCardEscrowClient>,
	batch_size: i64,
	interval: Duration,
}

impl GiftCardPayoutWorker {
	pub fn new(storage: Arc<dyn Storage>, escrow: Arc<GiftCardEscrowClient>) -> Self {
		Self {
			storage,
			escrow,
			batch_size: DEFAULT_PAYOUT_BATCH,
			interval: Duration::from_secs(DEFAULT_PAYOUT_INTERVAL_SECS),
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

	pub async fn run(self) {
		if !self.escrow.is_enabled() {
			// Loud and once: a deployment with no attestor key cannot pay
			// anyone, and silently running an inert loop would make that
			// look like "no trades" rather than "settlement is off".
			warn!("gift card payout worker not started — no attestor key configured");
			return;
		}
		info!(
			interval_secs = self.interval.as_secs(),
			batch = self.batch_size,
			"gift card payout worker started"
		);
		let mut ticker = tokio::time::interval(self.interval);
		loop {
			ticker.tick().await;
			match self.run_once().await {
				Ok(pass) if pass.considered > 0 => info!(
					considered = pass.considered,
					paid = pass.paid,
					skipped = pass.skipped,
					failed = pass.failed,
					"gift card payouts"
				),
				Ok(_) => {}
				Err(e) => error!(error = %e, "gift card payout pass failed"),
			}
		}
	}

	pub async fn run_once(&self) -> Result<PayoutPass, String> {
		let unpaid = self
			.storage
			.claim_unpaid_trades(self.batch_size)
			.await
			.map_err(|e| e.to_string())?;

		let mut pass = PayoutPass {
			considered: unpaid.len(),
			..Default::default()
		};

		for trade in unpaid {
			match self.pay_one(&trade).await {
				Ok(true) => pass.paid += 1,
				Ok(false) => pass.skipped += 1,
				Err(e) => {
					pass.failed += 1;
					error!(trade_id = %trade.id, error = %e, "could not release gift card escrow");
				}
			}
		}
		Ok(pass)
	}

	async fn pay_one(&self, trade: &GiftCardTrade) -> Result<bool, String> {
		// The payee comes from the trade's terminal state, never from a
		// request field, so a payout cannot disagree with the outcome that
		// was recorded against it.
		let Some((party, address)) = trade.payee() else {
			warn!(trade_id = %trade.id, state = %trade.state, "queued for payout but owes nobody");
			return Ok(false);
		};

		if address.trim().is_empty() {
			return Err(format!("no payout address recorded for the {party}"));
		}

		// A trade that was never funded has nothing to release. Marking it
		// paid with an empty hash would be a lie, so it is left alone and
		// reported — these need a human, not a retry.
		if trade.escrow_tx_hash.is_none() {
			warn!(trade_id = %trade.id, "terminal trade has no escrow lock; nothing to release");
			return Ok(false);
		}

		match self.escrow.is_open(&trade.payout_chain, &trade.id).await {
			Ok(false) => {
				// Already settled on-chain — most likely this worker sent it
				// and then failed to record the hash. Record that it is done
				// so the queue drains; the on-chain truth is what counts.
				warn!(trade_id = %trade.id, "escrow already closed on-chain; marking paid");
				let _ = self
					.storage
					.mark_giftcard_trade_paid(&trade.id, "closed-on-chain")
					.await;
				return Ok(false);
			}
			Ok(true) => {}
			// A read failure is not evidence of anything. Attempting the
			// release anyway is safe: the contract rejects a double release.
			Err(e) => warn!(trade_id = %trade.id, error = %e, "could not read escrow state; attempting release"),
		}

		let tx_hash = self
			.escrow
			.release(&trade.payout_chain, &trade.id, address)
			.await
			.map_err(|e| match e {
				EscrowError::NoEscrowOnChain(c) => {
					format!("no gift card escrow deployed on {c}; deploy one and set it in the chain registry")
				}
				other => other.to_string(),
			})?;

		let recorded = self
			.storage
			.mark_giftcard_trade_paid(&trade.id, &tx_hash)
			.await
			.map_err(|e| e.to_string())?;

		if recorded {
			info!(trade_id = %trade.id, %party, %address, tx = %tx_hash, "gift card escrow released");
		} else {
			// The release landed but another pass recorded first. The
			// contract will have rejected one of the two.
			warn!(trade_id = %trade.id, tx = %tx_hash, "release sent but another pass recorded it first");
		}
		Ok(recorded)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use chrono::Utc;
	use oif_config::ChainRegistry;
	use oif_storage::MemoryStore;
	use oif_types::storage::GiftCardTradeStorageTrait;
	use oif_types::{GiftCardSide, TradeState};

	fn trade(id: &str, state: TradeState, funded: bool) -> GiftCardTrade {
		GiftCardTrade {
			id: id.into(),
			quote_id: "gcq-1".into(),
			solver_id: "solver-1".into(),
			side: GiftCardSide::Buy,
			brand: "Amazon".into(),
			country_code: "US".into(),
			currency: "USD".into(),
			card_type: oif_types::GiftCardType::Ecode,
			face_minor_units: "10000".into(),
			rate: "0.88".into(),
			// A chain with no escrow deployed, so every release attempt
			// fails — which is what lets these tests exercise the queue
			// without a chain.
			payout_chain: "eip155:11155111".into(),
			payout_asset: "USDC".into(),
			payout_minor_units: "88000000".into(),
			user_address: "0x0000000000000000000000000000000000000001".into(),
			merchant_address: "0x0000000000000000000000000000000000000002".into(),
			state,
			recipient_pubkey: None,
			code_commitment: None,
			sealed_code: None,
			deadline_at: None,
			resolution_note: None,
			escrow_tx_hash: funded.then(|| "0xabc".to_string()),
			release_tx_hash: None,
			created_at: Utc::now(),
			updated_at: Utc::now(),
		}
	}

	async fn worker_with(trades: Vec<GiftCardTrade>) -> (GiftCardPayoutWorker, Arc<dyn Storage>) {
		let store = MemoryStore::new();
		for t in trades {
			store.create_giftcard_trade(t).await.unwrap();
		}
		let storage: Arc<dyn Storage> = Arc::new(store);
		// No attestor key and no deployed escrow: every release attempt
		// fails, which is what lets these tests exercise the queue's
		// selection and bookkeeping without a chain.
		let escrow = Arc::new(GiftCardEscrowClient::new(
			Arc::new(ChainRegistry::testnet_default()),
			None,
		));
		(
			GiftCardPayoutWorker::new(storage.clone(), escrow),
			storage,
		)
	}

	#[tokio::test]
	async fn only_terminal_paying_trades_are_queued() {
		let (worker, _) = worker_with(vec![
			trade("a", TradeState::AwaitingCode, true),
			trade("b", TradeState::AwaitingAttestation, true),
			trade("c", TradeState::Disputed, true),
			trade("d", TradeState::Failed, true),
			trade("e", TradeState::SettledToCardSender, true),
			trade("f", TradeState::RefundedToFunder, true),
		])
		.await;

		let pass = worker.run_once().await.unwrap();
		// Only the two paying terminal states; `failed` moved no money.
		assert_eq!(pass.considered, 2);
	}

	#[tokio::test]
	async fn a_trade_that_was_never_funded_is_not_marked_paid() {
		// Otherwise a trade that timed out before escrow ever landed would
		// be recorded as settled with no transaction behind it.
		let (worker, storage) =
			worker_with(vec![trade("a", TradeState::SettledToCardSender, false)]).await;

		let pass = worker.run_once().await.unwrap();
		assert_eq!(pass.paid, 0);
		assert_eq!(pass.skipped, 1);
		let t = storage.get_giftcard_trade("a").await.unwrap().unwrap();
		assert!(t.release_tx_hash.is_none());
	}

	#[tokio::test]
	async fn a_release_that_cannot_be_sent_is_reported_not_swallowed() {
		// No escrow deployed on the chain. The trade must stay unpaid and
		// visible, never be quietly marked done.
		let (worker, storage) =
			worker_with(vec![trade("a", TradeState::SettledToCardSender, true)]).await;

		let pass = worker.run_once().await.unwrap();
		assert_eq!(pass.failed, 1);
		assert_eq!(pass.paid, 0);
		let t = storage.get_giftcard_trade("a").await.unwrap().unwrap();
		assert!(t.release_tx_hash.is_none(), "an unpaid trade must stay unpaid");
	}

	#[tokio::test]
	async fn an_already_paid_trade_leaves_the_queue() {
		let mut t = trade("a", TradeState::SettledToCardSender, true);
		t.release_tx_hash = Some("0xdone".into());
		let (worker, _) = worker_with(vec![t]).await;
		assert_eq!(worker.run_once().await.unwrap().considered, 0);
	}

	#[tokio::test]
	async fn recording_a_payout_is_idempotent() {
		// The second writer must lose, so two workers cannot both believe
		// they paid.
		let (_, storage) = worker_with(vec![trade("a", TradeState::SettledToCardSender, true)]).await;
		assert!(storage.mark_giftcard_trade_paid("a", "0x1").await.unwrap());
		assert!(!storage.mark_giftcard_trade_paid("a", "0x2").await.unwrap());

		let t = storage.get_giftcard_trade("a").await.unwrap().unwrap();
		assert_eq!(t.release_tx_hash.as_deref(), Some("0x1"));
	}

	#[tokio::test]
	async fn the_payee_follows_the_terminal_state_not_the_direction() {
		// Buy-side settled pays the user; buy-side refunded pays the
		// merchant. Same trade, opposite outcome, opposite address.
		let settled = trade("a", TradeState::SettledToCardSender, true);
		let refunded = trade("b", TradeState::RefundedToFunder, true);
		assert_eq!(settled.payee().unwrap().1, settled.user_address);
		assert_eq!(refunded.payee().unwrap().1, refunded.merchant_address);
	}
}
