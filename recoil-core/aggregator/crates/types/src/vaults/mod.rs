//! Vault balance domain model.
//!
//! Per-operator, per-chain, per-asset inventory snapshot. Each row
//! represents a balance the operator reported (via the dashboard) at
//! a specific timestamp. The aggregator does **not** read on-chain
//! balances directly; doing so would require a multi-chain RPC
//! registry, ABI-encoded ERC-20 `balanceOf` calls, and a price oracle
//! for USD valuation — all of which are deferred until the on-chain
//! vault contract is designed and deployed.
//!
//! Until that happens, balances are operator-attested. Auth on the
//! write endpoint (`POST /solver-api/vaults/snapshot`) is the
//! per-operator api_key, which is already a strong proof of identity:
//! only the operator who controls the dashboard session can submit
//! rows tagged with their own solver_id.
//!
//! The `locked` field is always 0 today. Real escrow tracking
//! requires the vault contract on each chain and is intentionally not
//! part of this row.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// One (chain, asset) row per operator. The composite of
/// `solver_id + chain + asset_address` is unique (enforced by the DB).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultBalance {
	/// Owning operator. Matches `operators.solver_id`.
	pub solver_id: String,
	/// Human-readable chain id. Either CAIP-2 (`eip155:84532`) or a
	/// human label (`Base Sepolia`). The dashboard normalizes on
	/// display; the aggregator stores whichever the operator sent.
	pub chain: String,
	/// ERC-20 contract address (`0x...`) or `native` for the chain's
	/// gas token. Lower-cased on storage.
	pub asset_address: String,
	/// Trading symbol (e.g. `USDC`). Used purely for display; the
	/// asset_address is the authoritative identifier.
	pub symbol: String,
	/// Optional human-friendly asset name (`USD Coin`).
	#[serde(default)]
	pub name: String,
	/// Free balance, as a decimal string in the asset's smallest
	/// unit (`1.23` for 1.23 USDC). String because uint256 doesn't
	/// fit in f64 and the dashboard does its own formatting.
	pub available: String,
	/// Funds committed to active solves. Always `"0"` until the
	/// vault contract lands. We keep the column to avoid a
	/// breaking-schema change later.
	#[serde(default)]
	pub locked: String,
	/// Last time the operator updated this row. Monotonic per row
	/// (server-assigned, not the operator's clock).
	pub updated_at: DateTime<Utc>,
}

impl VaultBalance {
	pub fn new(
		solver_id: impl Into<String>,
		chain: impl Into<String>,
		asset_address: impl Into<String>,
		symbol: impl Into<String>,
		available: impl Into<String>,
	) -> Self {
		Self {
			solver_id: solver_id.into(),
			chain: chain.into(),
			asset_address: asset_address.into().to_lowercase(),
			symbol: symbol.into(),
			name: String::new(),
			available: available.into(),
			locked: "0".to_string(),
			updated_at: Utc::now(),
		}
	}

	/// Sum of `available + locked`, as a decimal string.
	pub fn total(&self) -> String {
		let a = self.available.parse::<f64>().unwrap_or(0.0);
		let l = self.locked.parse::<f64>().unwrap_or(0.0);
		let total = a + l;
		if total.fract() == 0.0 && total.abs() < 1e15 {
			format!("{}", total as i64)
		} else {
			// Up to 6 decimal places, no trailing zeros.
			format!("{:.6}", total)
				.trim_end_matches('0')
				.trim_end_matches('.')
				.to_string()
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn total_sums_available_and_locked() {
		let mut b = VaultBalance::new("s1", "eip155:1", "0xabc", "USDC", "10.5");
		b.locked = "2.25".to_string();
		assert_eq!(b.total(), "12.75");
	}

	#[test]
	fn total_handles_invalid_locked() {
		let b = VaultBalance::new("s1", "eip155:1", "0xabc", "USDC", "10");
		assert_eq!(b.total(), "10");
	}

	#[test]
	fn asset_address_is_lowercased_on_construct() {
		let b = VaultBalance::new("s1", "eip155:1", "0xABC", "USDC", "0");
		assert_eq!(b.asset_address, "0xabc");
	}
}