//! Aggregator-side order broadcaster.
//!
//! When a user submits an order via `POST /api/v1/orders` and the
//! order service persists it, we publish a copy of the order on a
//! `tokio::sync::broadcast` channel. Fill-workers that have
//! successfully completed the signed-handshake on `GET /ws/orders`
//! receive every published order on their WebSocket, so they don't
//! have to poll `/api/v1/orders` repeatedly.
//!
//! ## Backpressure & dropped messages
//!
//! `tokio::sync::broadcast` is lossless up to its `capacity`. When a
//! subscriber falls behind (their inbox fills past the capacity) the
//! oldest message is evicted and `RecvError::Lagged(n)` is surfaced
//! on the next `recv()`. The handler logs `Lagged` and continues —
//! the worker will eventually pick the order up on the next broadcast
//! or via the synchronous fallback used in tests.
//!
//! Capacity is `1024` which is enough for ~17 minutes at one order
//! per second with a slow subscriber, while keeping memory bounded.
//!
//! ## Signed handshake
//!
//! The WebSocket upgrade endpoint *requires* the same four
//! `x-auth-*` headers that any other fill-worker call carries. The
//! handshake is enforced in `handlers::solver_api::ws_orders` so a
//! misbehaving client can't open a long-lived socket and DoS the
//! server.

use std::sync::Arc;
use tokio::sync::broadcast;

/// Generic order envelope broadcast over the WebSocket. Using a
/// `serde_json::Value` rather than a typed struct lets the same
/// broadcaster carry both the canonical `OrderResponse` and any
/// test/diagnostic payload the operator wants to surface.
pub type OrderEnvelope = serde_json::Value;

/// In-memory broadcaster shared across handlers. Cheap to clone
/// (`Arc<broadcast::Sender>`).
#[derive(Clone)]
pub struct OrderBroadcaster {
	inner: Arc<broadcast::Sender<OrderEnvelope>>,
}

impl OrderBroadcaster {
	/// Construct a new broadcaster with the given channel capacity.
	/// `1024` is a safe default for production; tests use smaller
	/// values to surface `Lagged` errors quickly.
	pub fn new(capacity: usize) -> Self {
		let (tx, _rx) = broadcast::channel(capacity);
		Self { inner: Arc::new(tx) }
	}

	/// Publish a new order envelope to every subscriber. Returns the
	/// number of receivers that got the message — useful for
	/// telemetry. Zero receivers is fine; the message simply drops.
	pub fn publish(&self, envelope: OrderEnvelope) -> usize {
		// `send` only fails if there are zero receivers, which is a
		// no-op for us — we don't want the order submission to fail
		// just because no fill-worker is connected.
		self.inner.send(envelope).unwrap_or(0)
	}

	/// Get a fresh `broadcast::Receiver`. The handler holds this for
	/// the lifetime of the WebSocket connection and pulls messages
	/// out of it inside the read loop.
	pub fn subscribe(&self) -> broadcast::Receiver<OrderEnvelope> {
		self.inner.subscribe()
	}

	/// Number of currently-active subscribers. Handy for `/health`
	/// extensions and tests.
	pub fn receiver_count(&self) -> usize {
		self.inner.receiver_count()
	}
}

impl Default for OrderBroadcaster {
	fn default() -> Self {
		Self::new(1024)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	#[test]
	fn publish_to_zero_receivers_does_not_error() {
		let bc = OrderBroadcaster::new(16);
		// No subscriber — should still return 0 and not panic.
		assert_eq!(bc.publish(json!({"id":"abc"})), 0);
	}

	#[test]
	fn subscribe_receives_published_messages() {
		let bc = OrderBroadcaster::new(16);
		let mut rx = bc.subscribe();
		bc.publish(json!({"id":"abc"}));
		bc.publish(json!({"id":"def"}));
		let got = rx.try_recv().expect("first message");
		assert_eq!(got["id"], "abc");
		let got = rx.try_recv().expect("second message");
		assert_eq!(got["id"], "def");
	}

	#[test]
	fn lagged_subscriber_surfaces_lagged_error() {
		// Tiny capacity so we overflow immediately.
		let bc = OrderBroadcaster::new(2);
		let mut rx = bc.subscribe();
		bc.publish(json!({"id":"a"}));
		bc.publish(json!({"id":"b"}));
		bc.publish(json!({"id":"c"}));
		bc.publish(json!({"id":"d"}));
		// First two are stale; the next recv() surfaces Lagged.
		match rx.try_recv() {
			Err(broadcast::error::TryRecvError::Lagged(n)) => assert!(n >= 1),
			other => panic!("expected Lagged, got {other:?}"),
		}
	}

	#[test]
	fn receiver_count_tracks_subscribers() {
		let bc = OrderBroadcaster::new(4);
		assert_eq!(bc.receiver_count(), 0);
		let _r1 = bc.subscribe();
		assert_eq!(bc.receiver_count(), 1);
		let _r2 = bc.subscribe();
		assert_eq!(bc.receiver_count(), 2);
	}
}