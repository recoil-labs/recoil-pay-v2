//! Push-quote ranker — selects and scores quotes persisted by solver operators
//! via the dashboard (push path).
//!
//! This service replaces the previous pull-path fan-out for `POST /api/v1/quotes`.
//! All quotes returned to end users originate from operators that have submitted
//! `QuoteItemDto`s via `POST /solver-api/quotes` (or `POST /quotes/submit`).
//!
//! ## Selection algorithm
//!
//! For each user request:
//!
//! 1. Load all non-paused, non-expired `SolverQuote`s from storage.
//! 2. Filter by:
//!    - chain pair match (`from_chain`, `to_chain`)
//!    - asset pair match (`from_asset`, `to_asset`)
//!    - input amount in `[min_amount, max_amount]`
//!    - `exclusive_for` matches the requester (or is `None`)
//!    - operator is not circuit-broken
//! 3. Score each match using the equal-weight four-factor formula:
//!
//!    ```text
//!    score = output_usd_norm * 0.50
//!          + reputation      * 0.25
//!          + success_rate    * 0.15
//!          + (1-latency)     * 0.10
//!    ```
//!
//! 4. Return the top N quotes sorted by score (descending).
//!
//! All four signals are normalised to `[0, 1]` before weighting. Reputation and
//! success rate come from `Operator` rows; latency is derived from `avg_latency_ms`.
//!
//! ## Outputs
//!
//! Each matched `SolverQuote` is shaped into an OIF v0-compatible
//! `QuoteResponse` (the same envelope the old pull path produced), with an
//! `integrity_checksum` computed by `IntegrityService`.

use crate::integrity::{IntegrityError, IntegrityTrait};
use async_trait::async_trait;
use chrono::Utc;
use oif_config::{ChainInfo, ChainRegistry, TokenInfo};
use oif_storage::Storage;
use oif_types::quotes::response::QuoteResponse;
use oif_types::{IntegrityPayload, InteropAddress, Operator, Quote, SolverQuote};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tracing::{debug, info, warn};

/// Default scoring weights (equal-weight four-factor).
///
/// Exposed as constants so tests and dashboards can reference the same values.
/// Weights are deliberately tunable; see `RankingWeights` for the configurable variant.
/// Permit2 signature deadline (seconds from quote issuance). The user must
/// submit the signed order before this passes; it doubles as the quote's
/// `validUntil`.
pub const FILL_DEADLINE_SECS: u64 = 300;
/// Escrow expiry (seconds from quote issuance). After this an un-filled
/// order's escrowed funds can be reclaimed by the user on-chain.
pub const ORDER_EXPIRES_SECS: u64 = 600;

pub const DEFAULT_OUTPUT_WEIGHT: f64 = 0.50;
pub const DEFAULT_REPUTATION_WEIGHT: f64 = 0.25;
pub const DEFAULT_SUCCESS_RATE_WEIGHT: f64 = 0.15;
pub const DEFAULT_LATENCY_WEIGHT: f64 = 0.10;

/// Ranking weights — sum should equal 1.0 for predictable score ranges.
#[derive(Debug, Clone, Copy)]
pub struct RankingWeights {
	pub output: f64,
	pub reputation: f64,
	pub success_rate: f64,
	pub latency: f64,
}

impl Default for RankingWeights {
	fn default() -> Self {
		Self {
			output: DEFAULT_OUTPUT_WEIGHT,
			reputation: DEFAULT_REPUTATION_WEIGHT,
			success_rate: DEFAULT_SUCCESS_RATE_WEIGHT,
			latency: DEFAULT_LATENCY_WEIGHT,
		}
	}
}

impl RankingWeights {
	/// Defensive constructor — clamps to `[0, 1]` and normalises so the weights
	/// sum to 1.0 even if the caller passes a misconfigured value.
	pub fn new(output: f64, reputation: f64, success_rate: f64, latency: f64) -> Self {
		let raw = [
			output.max(0.0),
			reputation.max(0.0),
			success_rate.max(0.0),
			latency.max(0.0),
		];
		let sum: f64 = raw.iter().sum();
		if sum <= f64::EPSILON {
			return Self::default();
		}
		Self {
			output: raw[0] / sum,
			reputation: raw[1] / sum,
			success_rate: raw[2] / sum,
			latency: raw[3] / sum,
		}
	}
}

/// Errors from the push-quote ranker.
#[derive(Debug, Error)]
pub enum PushQuoteRankerError {
	#[error("storage error: {0}")]
	Storage(String),
	#[error("integrity error: {0}")]
	Integrity(#[from] IntegrityError),
}

pub type PushQuoteRankerResult<T> = Result<T, PushQuoteRankerError>;

/// Inputs needed to score a single quote. Built from the user's `QuoteRequest`
/// plus the operator's published `SolverQuote`.
#[derive(Debug, Clone)]
pub struct QuoteMatchInputs {
	pub solver_quote: SolverQuote,
	pub operator: Option<Operator>,
	pub output_amount_base_units: u128,
	/// Token prices in USD, keyed by `<chain>:<asset>`.
	pub price_usd_by_token: HashMap<String, f64>,
}

/// Scored candidate produced by the ranker.
#[derive(Debug, Clone)]
pub struct ScoredQuote {
	pub solver_quote: SolverQuote,
	pub output_amount_base_units: u128,
	pub output_usd: f64,
	pub output_usd_norm: f64,
	pub reputation: f64,
	pub success_rate: f64,
	pub latency_norm: f64,
	pub composite_score: f64,
	pub reasons: Vec<String>,
}

impl ScoredQuote {
	/// True when this quote should be discarded (e.g. amount out of range,
	/// exclusive to a different user, expired). The ranker pre-filters these,
	/// but downstream code may want a single source of truth.
	pub fn is_excluded(&self) -> bool {
		!self.reasons.is_empty()
	}
}

/// Aggregate result of a ranking pass.
#[derive(Debug, Clone, Default)]
pub struct RankingResult {
	pub matches: Vec<ScoredQuote>,
	pub total_pushed: usize,
	pub total_filtered_out: usize,
	pub duration_ms: u64,
}

/// Trait so callers can mock the ranker in tests.
#[async_trait]
#[cfg_attr(test, mockall::automock)]
pub trait PushQuoteRankerTrait: Send + Sync {
	/// Rank push-quotes against a user request and return shaped OIF `Quote`s
	/// in score-descending order.
	async fn rank_and_shape(
		&self,
		user_address: &str,
		input_amount_base_units: u128,
		from_chain: &str,
		to_chain: &str,
		from_asset: &str,
		to_asset: &str,
		max_results: usize,
	) -> PushQuoteRankerResult<RankingResult>;
}

/// Default implementation. Holds a reference to storage + the integrity
/// service + the chain registry (settler/oracle/token addresses per chain).
pub struct PushQuoteRanker {
	pub storage: Arc<dyn Storage>,
	pub integrity: Arc<dyn IntegrityTrait>,
	pub chain_registry: Arc<ChainRegistry>,
	pub weights: RankingWeights,
	/// Cap how many quotes we return to the user. The OIF aggregator
	/// historically returns up to ~50; we keep that as a sensible default.
	pub default_max_results: usize,
}

impl PushQuoteRanker {
	pub fn new(
		storage: Arc<dyn Storage>,
		integrity: Arc<dyn IntegrityTrait>,
		chain_registry: Arc<ChainRegistry>,
	) -> Self {
		Self {
			storage,
			integrity,
			chain_registry,
			weights: RankingWeights::default(),
			default_max_results: 50,
		}
	}

	pub fn with_weights(mut self, weights: RankingWeights) -> Self {
		self.weights = weights;
		self
	}

	pub fn with_max_results(mut self, n: usize) -> Self {
		self.default_max_results = n;
		self
	}

	/// Pull all push-quotes from storage and apply filters.
	async fn load_candidates(
		&self,
		from_chain: &str,
		to_chain: &str,
		from_asset: &str,
		to_asset: &str,
		input_amount_base_units: u128,
		user_address: &str,
	) -> PushQuoteRankerResult<Vec<(SolverQuote, Option<Operator>)>> {
		let all = self
			.storage
			.list_solver_quotes(None)
			.await
			.map_err(|e| PushQuoteRankerError::Storage(e.to_string()))?;

		let now = Utc::now();

		// Pre-load all known operators once (avoids N+1 storage calls).
		let operators_by_id = self.load_operator_index().await?;

		let mut kept = Vec::with_capacity(all.len());
		let mut total = 0usize;
		for q in all.into_iter().filter(|q| !q.paused) {
			total += 1;

			// Expiry check (string-encoded RFC-3339).
			if let Ok(exp) = chrono::DateTime::parse_from_rfc3339(&q.expiry) {
				if exp < now {
					debug!(quote_id = %q.id, "skipping expired quote");
					continue;
				}
			}

			// Chain + asset match.
			if q.from_chain != from_chain
				|| q.to_chain != to_chain
				|| !assets_match(&q.from_asset, from_asset)
				|| !assets_match(&q.to_asset, to_asset)
			{
				continue;
			}

			// Amount range (in base units).
			let min = parse_base_units(&q.min_amount);
			let max = parse_base_units(&q.max_amount);
			if let Some(min) = min {
				if input_amount_base_units < min {
					continue;
				}
			}
			if let Some(max) = max {
				if input_amount_base_units > max {
					continue;
				}
			}

			// Exclusive quotes.
			if let Some(excl) = q.exclusive_for.as_deref() {
				if !excl.eq_ignore_ascii_case(user_address) {
					continue;
				}
			}

			// Circuit-broken operators are skipped (defensive — even though
			// the ranker doesn't actively flip the breaker, we honour it).
			let operator = operators_by_id.get(&q.solver_id).cloned();
			if let Some(op) = &operator {
				if op.circuit_breaker_open {
					debug!(solver_id = %q.solver_id, "skipping circuit-broken operator");
					continue;
				}
			}

			kept.push((q, operator));
		}

		info!(
			total_pushed = total,
			kept = kept.len(),
			"push-quote filter pass"
		);
		Ok(kept)
	}

	async fn load_operator_index(&self) -> PushQuoteRankerResult<HashMap<String, Operator>> {
		// Pull every operator row once. The ranker is called per quote request,
		// so this is on the hot path; in practice the operator set is small
		// (hundreds at most) so a single SELECT is fine. Caching can be added
		// later behind an ArcSwap if traffic warrants it.
		let operators = self
			.storage
			.list_operators()
			.await
			.map_err(|e| PushQuoteRankerError::Storage(e.to_string()))?;
		Ok(operators
			.into_iter()
			.map(|op| (op.solver_id.clone(), op))
			.collect())
	}

	/// Score each surviving candidate and return top-N.
	fn score(
		&self,
		candidates: Vec<(SolverQuote, Option<Operator>)>,
		input_amount_base_units: u128,
	) -> Vec<ScoredQuote> {
		if candidates.is_empty() {
			return Vec::new();
		}

		// Compute the per-quote output amount in base units.
		let mut with_outputs: Vec<(SolverQuote, Option<Operator>, u128)> = candidates
			.into_iter()
			.map(|(q, op)| {
				let out = compute_output_base_units(input_amount_base_units, &q);
				(q, op, out)
			})
			.collect();

		// For USD-normalisation we need a price feed. Until Phase 4 we treat
		// every token as $1 — this gives a stable ordinal ranking while the
		// price service is added.
		let price_usd: HashMap<String, f64> = HashMap::new();
		let max_output_base = with_outputs
			.iter()
			.map(|(_, _, out)| *out)
			.max()
			.unwrap_or(1);

		let mut scored: Vec<ScoredQuote> = with_outputs
			.drain(..)
			.map(|(q, op, out_base)| {
				// Output normalisation: best output = 1.0, others scaled.
				let output_norm = if max_output_base == 0 {
					0.0
				} else {
					out_base as f64 / max_output_base as f64
				};

				// Reputation: 0..1. Default 0.5 when unknown.
				let reputation = op
					.as_ref()
					.map(|o| clamp01(o.reputation_score))
					.unwrap_or(0.5);

				// Success rate: 0..1. Default 1.0 when no history.
				let success_rate = op
					.as_ref()
					.filter(|o| o.fills_total > 0)
					.map(|o| o.fills_succeeded as f64 / o.fills_total as f64)
					.unwrap_or(1.0);

				// Latency normalisation: 0..1 where 1 = fast. Baseline:
				// 0ms latency = 1.0, 1000ms latency = 0.0.
				let latency_norm = op
					.as_ref()
					.map(|o| clamp01(1.0 - (o.avg_latency_ms as f64 / 1000.0)))
					.unwrap_or(1.0);

				let composite = self.weights.output * output_norm
					+ self.weights.reputation * reputation
					+ self.weights.success_rate * success_rate
					+ self.weights.latency * latency_norm;

				ScoredQuote {
					output_amount_base_units: out_base,
					output_usd: output_norm, // placeholder until price feed
					output_usd_norm: output_norm,
					reputation,
					success_rate,
					latency_norm,
					composite_score: composite,
					solver_quote: q,
					reasons: Vec::new(),
				}
			})
			.collect();

		scored.sort_by(|a, b| {
			b.composite_score
				.partial_cmp(&a.composite_score)
				.unwrap_or(std::cmp::Ordering::Equal)
		});

		// Reference the price map to silence unused-warning until Phase 4 wires
		// real prices in.
		let _ = price_usd;
		scored
	}

	/// Shape a `ScoredQuote` into a signable OIF `oif-escrow-v0` quote.
	///
	/// The payload is a genuine Permit2 `PermitBatchWitnessTransferFrom`
	/// EIP-712 envelope — domain = the origin chain's Permit2 contract,
	/// spender = the origin InputSettler, witness = the OIF mandate binding
	/// the destination-chain output. Signing it authorises the settler to
	/// escrow the user's input via `openFor`. The field layout mirrors the
	/// OIF solver's quote generation
	/// (`solver-service/src/apis/quote/signing/payloads/permit2.rs`) so the
	/// deployed settlers accept the signature unchanged.
	async fn shape(
		&self,
		scored: &ScoredQuote,
		user_address: &str,
		input_amount_base_units: u128,
	) -> Option<Quote> {
		let sq = &scored.solver_quote;

		// A zero input can't produce a fillable escrow order.
		if input_amount_base_units == 0 {
			warn!(quote_id = %sq.id, "skipping shape: request carried no input amount");
			return None;
		}

		// Resolve both chains from the registry; quotes referencing chains
		// we don't know how to settle on never surface to users.
		let origin = match self.chain_registry.by_caip2(&sq.from_chain) {
			Some(c) => c,
			None => {
				warn!(quote_id = %sq.id, from_chain = %sq.from_chain, "skipping shape: origin chain not in registry");
				return None;
			},
		};
		let dest = match self.chain_registry.by_caip2(&sq.to_chain) {
			Some(c) => c,
			None => {
				warn!(quote_id = %sq.id, to_chain = %sq.to_chain, "skipping shape: destination chain not in registry");
				return None;
			},
		};

		// Resolve the traded tokens (symbol, bare address, or CAIP-19).
		let input_token = match resolve_quote_token(origin, &sq.from_asset) {
			Some(t) => t,
			None => {
				warn!(quote_id = %sq.id, asset = %sq.from_asset, chain_id = origin.chain_id, "skipping shape: input token not in registry");
				return None;
			},
		};
		let output_token = match resolve_quote_token(dest, &sq.to_asset) {
			Some(t) => t,
			None => {
				warn!(quote_id = %sq.id, asset = %sq.to_asset, chain_id = dest.chain_id, "skipping shape: output token not in registry");
				return None;
			},
		};

		let user_evm = match parse_evm_address(user_address) {
			Some(a) => a,
			None => {
				warn!(quote_id = %sq.id, user = %user_address, "skipping shape: unparseable user address");
				return None;
			},
		};

		let input_amount_str = input_amount_base_units.to_string();
		let output_amount_str = scored.output_amount_base_units.to_string();

		// Timing: nonce = issuance millis (unique per quote), deadline =
		// Permit2 signature validity, expires = escrow reclaim horizon.
		let now = Utc::now();
		let nonce_ms = now.timestamp_millis().to_string();
		let deadline = (now.timestamp() as u64) + FILL_DEADLINE_SECS;
		let expires: u32 = ((now.timestamp() as u64) + ORDER_EXPIRES_SECS)
			.try_into()
			.ok()?;

		// bytes32-padded fields for the MandateOutput struct.
		let dest_oracle32 = bytes32_hex(&dest.oracle)?;
		let output_settler32 = bytes32_hex(&dest.output_settler)?;
		let output_token32 = bytes32_hex(&output_token.address)?;
		let recipient32 = bytes32_hex(&user_evm)?;

		// ERC-7930 interop-hex addresses for the preview block.
		let user_interop = InteropAddress::from_chain_and_address(origin.chain_id, &user_evm)
			.ok()?
			.to_hex();
		let receiver_interop = InteropAddress::from_chain_and_address(dest.chain_id, &user_evm)
			.ok()?
			.to_hex();
		let input_asset_interop =
			InteropAddress::from_chain_and_address(origin.chain_id, &input_token.address)
				.ok()?
				.to_hex();
		let output_asset_interop =
			InteropAddress::from_chain_and_address(dest.chain_id, &output_token.address)
				.ok()?
				.to_hex();

		let envelope = serde_json::json!({
			"quoteId": sq.id,
			"solverId": sq.solver_id,
			"order": {
				"type": "oif-escrow-v0",
				"payload": {
					"signatureType": "eip712",
					"domain": {
						"name": "Permit2",
						"chainId": origin.chain_id,
						"verifyingContract": origin.permit2
					},
					"primaryType": "PermitBatchWitnessTransferFrom",
					"message": {
						"permitted": [{
							"token": input_token.address,
							"amount": input_amount_str
						}],
						"spender": origin.input_settler,
						"nonce": nonce_ms,
						"deadline": deadline.to_string(),
						"witness": {
							"user": user_evm,
							"expires": expires,
							"inputOracle": origin.oracle,
							"outputs": [{
								"oracle": dest_oracle32,
								"settler": output_settler32,
								"chainId": dest.chain_id,
								"token": output_token32,
								"amount": output_amount_str,
								"recipient": recipient32,
								"callbackData": "0x",
								"context": "0x"
							}]
						}
					},
					"types": permit2_eip712_types()
				}
			},
			"validUntil": deadline,
			"eta": 30,
			"provider": sq.solver_id.clone(),
			"failureHandling": "refund-automatic",
			"partialFill": false,
			"preview": {
				"inputs": [{
					"user": user_interop,
					"asset": input_asset_interop,
					"amount": input_amount_str
				}],
				"outputs": [{
					"receiver": receiver_interop,
					"asset": output_asset_interop,
					"amount": output_amount_str
				}]
			},
			"integrityChecksum": "temp",
			"metadata": {
				"score": scored.composite_score,
				"reputation": scored.reputation,
				"successRate": scored.success_rate,
				"latencyNorm": scored.latency_norm,
				"settlement": {
					"originChainId": origin.chain_id,
					"destinationChainId": dest.chain_id,
					"inputSettler": origin.input_settler,
					"outputSettler": dest.output_settler,
					"inputOracle": origin.oracle,
					"outputOracle": dest.oracle,
					"inputToken": input_token.address,
					"outputToken": output_token.address,
					"inputAmount": input_amount_str,
					"outputAmount": output_amount_str,
					"recipient": user_evm
				}
			}
		});

		let resp: QuoteResponse = match serde_json::from_value(envelope) {
			Ok(r) => r,
			Err(e) => {
				warn!(quote_id = %sq.id, error = %e, "skipping shape: envelope failed to parse as QuoteResponse");
				return None;
			},
		};
		let mut quote = Quote::try_from(resp).ok()?;
		let payload = quote.to_integrity_payload();
		match self.integrity.generate_checksum_from_payload(&payload) {
			Ok(checksum) => quote.integrity_checksum = checksum,
			Err(e) => warn!(quote_id = %sq.id, error = %e, "failed to compute integrity checksum"),
		}
		Some(quote)
	}
}

#[async_trait]
impl PushQuoteRankerTrait for PushQuoteRanker {
	async fn rank_and_shape(
		&self,
		user_address: &str,
		input_amount_base_units: u128,
		from_chain: &str,
		to_chain: &str,
		from_asset: &str,
		to_asset: &str,
		max_results: usize,
	) -> PushQuoteRankerResult<RankingResult> {
		let start = std::time::Instant::now();
		let total_pushed = self
			.storage
			.list_solver_quotes(None)
			.await
			.map_err(|e| PushQuoteRankerError::Storage(e.to_string()))?
			.len();

		let candidates = self
			.load_candidates(
				from_chain,
				to_chain,
				from_asset,
				to_asset,
				input_amount_base_units,
				user_address,
			)
			.await?;

		let total_filtered = total_pushed.saturating_sub(candidates.len());
		let scored = self.score(candidates, input_amount_base_units);

		// Shaping into OIF quotes is the caller's concern (`rank_to_quotes`);
		// here we only score. `max_results` is applied at shaping time.
		let _ = max_results;

		let duration_ms = start.elapsed().as_millis() as u64;
		info!(
			total_pushed,
			kept = scored.len(),
			duration_ms,
			"push-quote ranking complete"
		);

		Ok(RankingResult {
			matches: scored,
			total_pushed,
			total_filtered_out: total_filtered,
			duration_ms,
		})
	}
}

impl PushQuoteRanker {
	/// Convenience helper used by the HTTP handler. Produces shaped OIF quotes
	/// for the top-N scored matches.
	pub async fn rank_to_quotes(
		&self,
		user_address: &str,
		input_amount_base_units: u128,
		from_chain: &str,
		to_chain: &str,
		from_asset: &str,
		to_asset: &str,
		max_results: usize,
	) -> PushQuoteRankerResult<(Vec<Quote>, RankingMetadata)> {
		let result = self
			.rank_and_shape(
				user_address,
				input_amount_base_units,
				from_chain,
				to_chain,
				from_asset,
				to_asset,
				max_results,
			)
			.await?;

		let mut quotes = Vec::with_capacity(max_results.min(result.matches.len()));
		for s in result.matches.iter().take(max_results) {
			if let Some(q) = self
				.shape(s, user_address, input_amount_base_units)
				.await
			{
				quotes.push(q);
			}
		}

		let metadata = RankingMetadata {
			total_duration_ms: result.duration_ms,
			total_pushed: result.total_pushed,
			total_filtered_out: result.total_filtered_out,
			returned: quotes.len(),
		};

		Ok((quotes, metadata))
	}
}

/// Lightweight metadata returned to the HTTP layer.
#[derive(Debug, Clone)]
pub struct RankingMetadata {
	pub total_duration_ms: u64,
	pub total_pushed: usize,
	pub total_filtered_out: usize,
	pub returned: usize,
}

// ─── helpers ────────────────────────────────────────────────────────────────

/// Case-insensitive comparison that accepts either checksummed or lowercase
/// addresses and tolerates trailing differences (e.g. "USDC" vs an address).
fn assets_match(a: &str, b: &str) -> bool {
	if a.eq_ignore_ascii_case(b) {
		return true;
	}
	// Allow operators to advertise "USDC" while callers send the checksummed
	// address by comparing the lowercased suffix.
	let al = a.to_ascii_lowercase();
	let bl = b.to_ascii_lowercase();
	if al.len() >= 8 && bl.len() >= 8 {
		return al.ends_with(&bl[bl.len() - 8..]) || bl.ends_with(&al[al.len() - 8..]);
	}
	false
}

/// Parse a base-units string into `u128`. Returns `None` on parse failure so
/// the caller can choose how to handle it (we currently skip the candidate).
fn parse_base_units(s: &str) -> Option<u128> {
	s.parse::<u128>().ok().or_else(|| {
		// Some operators may post decimal-form strings (e.g. "100.5"). We
		// truncate rather than round to keep this lossless for non-USD pairs.
		s.parse::<f64>().ok().map(|f| f as u128)
	})
}

/// Apply a quote rate to an input amount, returning the output in base units.
/// `quote` is interpreted as a multiplier in `(0, 2]` — values outside that
/// range are clamped.
fn compute_output_base_units(input_base_units: u128, q: &SolverQuote) -> u128 {
	let rate = q.quote.parse::<f64>().unwrap_or(1.0).clamp(0.0, 2.0);
	let fixed = q
		.fixed_cost
		.as_deref()
		.and_then(|s| s.parse::<u128>().ok())
		.unwrap_or(0);
	let raw = (input_base_units as f64) * rate;
	let out = raw as u128;
	out.saturating_sub(fixed)
}

fn clamp01(v: f64) -> f64 {
	v.clamp(0.0, 1.0)
}

/// Extract a plain 0x EVM address from either a bare `0x…` 20-byte hex
/// string or an ERC-7930 interop-hex string. Returned lowercased.
fn parse_evm_address(s: &str) -> Option<String> {
	let s = s.trim();
	// A bare address is exactly 42 chars; an interop-hex string is always
	// longer, so the two forms can't collide.
	if let Some(hex_part) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
		if hex_part.len() == 40 && hex_part.chars().all(|c| c.is_ascii_hexdigit()) {
			return Some(format!("0x{}", hex_part.to_ascii_lowercase()));
		}
	}
	if let Ok(interop) = InteropAddress::from_hex(s) {
		let addr = interop.extract_address();
		if addr.len() == 42 {
			return Some(addr.to_ascii_lowercase());
		}
	}
	None
}

/// Left-pad a 20-byte 0x address to a 32-byte 0x hex string — the
/// `bytes32` encoding OIF's MandateOutput uses for addresses.
fn bytes32_hex(address: &str) -> Option<String> {
	let hex_part = address.strip_prefix("0x")?;
	if hex_part.len() != 40 || !hex_part.chars().all(|c| c.is_ascii_hexdigit()) {
		return None;
	}
	Some(format!("0x{}{}", "0".repeat(24), hex_part.to_ascii_lowercase()))
}

/// Resolve an operator-published asset string against a chain's token
/// list. Accepts a symbol ("USDC"), a bare address, or CAIP-19
/// ("eip155:…/erc20:0x…").
fn resolve_quote_token<'a>(chain: &'a ChainInfo, asset: &str) -> Option<&'a TokenInfo> {
	if let Some(t) = chain.token_by_symbol(asset) {
		return Some(t);
	}
	let addr = asset.rsplit(['/', ':']).next().unwrap_or(asset);
	chain.token_by_address(addr)
}

/// Canonical Permit2 `PermitBatchWitnessTransferFrom` EIP-712 type set,
/// matching the V2 signer's canonical definitions (`oif/sign.ts`).
fn permit2_eip712_types() -> serde_json::Value {
	serde_json::json!({
		"PermitBatchWitnessTransferFrom": [
			{ "name": "permitted", "type": "TokenPermissions[]" },
			{ "name": "spender", "type": "address" },
			{ "name": "nonce", "type": "uint256" },
			{ "name": "deadline", "type": "uint256" },
			{ "name": "witness", "type": "Permit2Witness" }
		],
		"TokenPermissions": [
			{ "name": "token", "type": "address" },
			{ "name": "amount", "type": "uint256" }
		],
		"Permit2Witness": [
			{ "name": "user", "type": "address" },
			{ "name": "expires", "type": "uint32" },
			{ "name": "inputOracle", "type": "address" },
			{ "name": "outputs", "type": "MandateOutput[]" }
		],
		"MandateOutput": [
			{ "name": "oracle", "type": "bytes32" },
			{ "name": "settler", "type": "bytes32" },
			{ "name": "chainId", "type": "uint256" },
			{ "name": "token", "type": "bytes32" },
			{ "name": "amount", "type": "uint256" },
			{ "name": "recipient", "type": "bytes32" },
			{ "name": "callbackData", "type": "bytes" },
			{ "name": "context", "type": "bytes" }
		]
	})
}

// ─── tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn weights_normalise_to_unit_sum() {
		let w = RankingWeights::new(2.0, 2.0, 2.0, 2.0);
		assert!((w.output + w.reputation + w.success_rate + w.latency - 1.0).abs() < 1e-9);

		// Zero weights fall back to defaults.
		let z = RankingWeights::new(0.0, 0.0, 0.0, 0.0);
		assert!((z.output - DEFAULT_OUTPUT_WEIGHT).abs() < 1e-9);
	}

	#[test]
	fn assets_match_handles_case_and_address_suffix() {
		assert!(assets_match("USDC", "usdc"));
		assert!(assets_match(
			"0x5fd84259d66cd46123540766be93dfe6d43130d7",
			"0x5fd84259d66cd46123540766be93dfe6d43130d7"
		));
		assert!(assets_match(
			"USDC",
			"0x036CbD53842c5426634e7929541eC2318f3dCF7e"
		) == false); // symbols never partial-match addresses
	}

	#[test]
	fn output_computation_respects_fixed_cost() {
		let q = SolverQuote {
			id: "q1".into(),
			solver_id: "s1".into(),
			from_chain: "eip155:11155420".into(),
			to_chain: "eip155:84532".into(),
			from_asset: "USDC".into(),
			to_asset: "USDC".into(),
			from_decimals: 6,
			to_decimals: 6,
			quote: "0.9985".into(),
			min_amount: "0".into(),
			max_amount: "999999999".into(),
			fixed_cost: Some("100000".into()), // 0.1 USDC
			expiry: "2099-01-01T00:00:00Z".into(),
			exclusive_for: None,
			paused: false,
			created_at: Utc::now(),
			updated_at: Utc::now(),
		};
		// 100 USDC = 100_000_000 base units
		let out = compute_output_base_units(100_000_000, &q);
		// 100_000_000 * 0.9985 = 99_850_000, minus fixed 100_000 = 99_750_000
		assert_eq!(out, 99_750_000);
	}

	#[test]
	fn evm_address_parses_bare_and_interop_forms() {
		assert_eq!(
			parse_evm_address("0xF748bF5188579Ded99e0365Cd83c6376eaA5c310").as_deref(),
			Some("0xf748bf5188579ded99e0365cd83c6376eaa5c310")
		);
		let interop =
			InteropAddress::from_chain_and_address(84532, "0xF748bF5188579Ded99e0365Cd83c6376eaA5c310")
				.unwrap()
				.to_hex();
		assert_eq!(
			parse_evm_address(&interop).as_deref(),
			Some("0xf748bf5188579ded99e0365cd83c6376eaa5c310")
		);
		assert!(parse_evm_address("not-an-address").is_none());
		assert!(parse_evm_address("0x1234").is_none());
	}

	#[test]
	fn bytes32_pads_addresses_left() {
		assert_eq!(
			bytes32_hex("0xBE85Bb9ADb91D42fa148dE3a929BE1b9C46270A5").as_deref(),
			Some("0x000000000000000000000000be85bb9adb91d42fa148de3a929be1b9c46270a5")
		);
		assert!(bytes32_hex("0x1234").is_none());
		assert!(bytes32_hex("be85").is_none());
	}

	#[test]
	fn quote_tokens_resolve_by_symbol_address_and_caip19() {
		let registry = ChainRegistry::testnet_default();
		let op = registry.by_caip2("eip155:11155420").unwrap();
		assert_eq!(resolve_quote_token(op, "USDC").unwrap().decimals, 6);
		assert!(resolve_quote_token(op, "0x191688B2Ff5Be8F0A5BCAB3E819C900a810FAaf6").is_some());
		assert!(resolve_quote_token(
			op,
			"eip155:11155420/erc20:0x191688b2ff5be8f0a5bcab3e819c900a810faaf6"
		)
		.is_some());
		assert!(resolve_quote_token(op, "DOGE").is_none());
	}

	#[tokio::test]
	async fn shape_builds_signable_permit2_escrow_payload() {
		let ranker = PushQuoteRanker::new(
			Arc::new(oif_storage::MemoryStore::new()),
			Arc::new(crate::integrity::IntegrityService::new(
				oif_types::SecretString::from("push-quote-ranker-test-secret-0123456789"),
			)),
			Arc::new(ChainRegistry::testnet_default()),
		);
		let sq = SolverQuote {
			id: "q-shape".into(),
			solver_id: "solver-abc".into(),
			from_chain: "eip155:11155420".into(),
			to_chain: "eip155:84532".into(),
			from_asset: "eip155:11155420/erc20:0x191688B2Ff5Be8F0A5BCAB3E819C900a810FAaf6".into(),
			to_asset: "0x73c83DAcc74bB8a704717AC09703b959E74b9705".into(),
			from_decimals: 6,
			to_decimals: 6,
			quote: "0.99".into(),
			min_amount: "0".into(),
			max_amount: "999999999999".into(),
			fixed_cost: None,
			expiry: "2099-01-01T00:00:00Z".into(),
			exclusive_for: None,
			paused: false,
			created_at: Utc::now(),
			updated_at: Utc::now(),
		};
		let scored = ScoredQuote {
			solver_quote: sq,
			output_amount_base_units: 990_000,
			output_usd: 1.0,
			output_usd_norm: 1.0,
			reputation: 0.5,
			success_rate: 1.0,
			latency_norm: 1.0,
			composite_score: 0.9,
			reasons: Vec::new(),
		};

		let user = "0xF748bF5188579Ded99e0365Cd83c6376eaA5c310";
		let quote = ranker
			.shape(&scored, user, 1_000_000)
			.await
			.expect("shape should produce a quote");

		let resp = QuoteResponse::try_from(quote).expect("quote converts to response");
		let json = serde_json::to_value(&resp).unwrap();
		let payload = &json["order"]["payload"];

		// Domain must be the origin chain's canonical Permit2.
		assert_eq!(payload["domain"]["name"], "Permit2");
		assert_eq!(payload["domain"]["chainId"], 11155420);
		assert_eq!(
			payload["domain"]["verifyingContract"],
			"0x000000000022D473030F116dDEE9F6B43aC78BA3"
		);
		assert_eq!(payload["primaryType"], "PermitBatchWitnessTransferFrom");

		// Message: the user's requested amount, the origin InputSettler as
		// spender, and a mandate output on the destination chain.
		let msg = &payload["message"];
		assert_eq!(msg["permitted"][0]["amount"], "1000000");
		assert_eq!(
			msg["permitted"][0]["token"],
			"0x191688B2Ff5Be8F0A5BCAB3E819C900a810FAaf6"
		);
		assert_eq!(msg["spender"], "0x9EF00F018b4afDCAa89093EF3015E6D918a58003");
		assert_eq!(
			msg["witness"]["user"],
			"0xf748bf5188579ded99e0365cd83c6376eaa5c310"
		);
		assert_eq!(
			msg["witness"]["inputOracle"],
			"0x309eAdeDfB7b7Da32b8714a9AA950c8B02924a8e"
		);
		let out = &msg["witness"]["outputs"][0];
		assert_eq!(out["chainId"], 84532);
		assert_eq!(out["amount"], "990000");
		// bytes32-padded destination fields.
		assert_eq!(
			out["settler"],
			"0x0000000000000000000000009ef00f018b4afdcaa89093ef3015e6d918a58003"
		);
		assert_eq!(
			out["token"],
			"0x00000000000000000000000073c83dacc74bb8a704717ac09703b959e74b9705"
		);
		assert_eq!(
			out["recipient"],
			"0x000000000000000000000000f748bf5188579ded99e0365cd83c6376eaa5c310"
		);
		assert_eq!(out["callbackData"], "0x");
		assert_eq!(out["context"], "0x");

		// Types must carry the canonical Permit2 set.
		assert!(payload["types"]["PermitBatchWitnessTransferFrom"].is_array());
		assert!(payload["types"]["MandateOutput"].is_array());

		// Preview amounts reflect the real request, as interop addresses.
		assert_eq!(json["preview"]["inputs"][0]["amount"], "1000000");
		assert_eq!(json["preview"]["outputs"][0]["amount"], "990000");

		// Integrity checksum must be computed (not the placeholder).
		assert_ne!(json["integrityChecksum"], "temp");
		assert!(!json["integrityChecksum"].as_str().unwrap().is_empty());
	}
}
