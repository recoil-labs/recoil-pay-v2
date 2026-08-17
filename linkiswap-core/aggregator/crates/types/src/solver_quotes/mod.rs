//! SolverQuote domain model — persisted quote inventory submitted by solver operators.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolverQuote {
	pub id: String,
	pub solver_id: String,
	pub from_chain: String,
	pub to_chain: String,
	pub from_asset: String,
	pub to_asset: String,
	pub from_decimals: u8,
	pub to_decimals: u8,
	pub quote: String,
	pub min_amount: String,
	pub max_amount: String,
	pub fixed_cost: Option<String>,
	pub expiry: String,
	pub exclusive_for: Option<String>,
	pub paused: bool,
	pub created_at: DateTime<Utc>,
	pub updated_at: DateTime<Utc>,
}

impl SolverQuote {
	pub fn new(
		id: String,
		solver_id: String,
		from_chain: String,
		to_chain: String,
		from_asset: String,
		to_asset: String,
		from_decimals: u8,
		to_decimals: u8,
		quote: String,
		min_amount: String,
		max_amount: String,
		fixed_cost: Option<String>,
		expiry: String,
		exclusive_for: Option<String>,
	) -> Self {
		let now = Utc::now();
		Self {
			id,
			solver_id,
			from_chain,
			to_chain,
			from_asset,
			to_asset,
			from_decimals,
			to_decimals,
			quote,
			min_amount,
			max_amount,
			fixed_cost,
			expiry,
			exclusive_for,
			paused: false,
			created_at: now,
			updated_at: now,
		}
	}
}
