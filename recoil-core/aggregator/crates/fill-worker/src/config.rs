//! Worker configuration loaded from env vars / CLI flags.

use std::collections::HashMap;

use crate::FillWorkerError;

#[derive(Debug, Clone)]
pub struct FillWorkerConfig {
	/// Aggregator base URL (e.g. `http://recoil-aggregator:10000`).
	pub aggregator_url: String,
	/// Public URL the aggregator should record as this worker's endpoint.
	/// Used only as a diagnostic / heartbeat target — the worker itself
	/// doesn't expose a meaningful HTTP surface any more.
	pub public_url: String,
	/// Per-chain RPC URLs for on-chain fill broadcasting. Keyed by chain id
	/// (e.g. `11155420` for Optimism Sepolia). Parsed from
	/// `CHAIN_RPCS=<chain>:<url>,<chain>:<url>` env var.
	pub chain_rpcs: HashMap<u64, String>,
	/// Shared first-party token (`FILL_WORKER_TOKEN`) the aggregator's
	/// auth middleware accepts on the worker's server-to-server calls.
	pub worker_token: Option<String>,
}

impl FillWorkerConfig {
	pub fn from_env() -> Result<Self, FillWorkerError> {
		let chain_rpcs = parse_chain_rpcs_env(
			std::env::var("CHAIN_RPCS").unwrap_or_default().as_str(),
		);
		Ok(Self {
			aggregator_url: std::env::var("AGGREGATOR_URL")
				.unwrap_or_else(|_| "http://127.0.0.1:4000".to_string()),
			public_url: std::env::var("FILL_WORKER_URL")
				.unwrap_or_else(|_| "http://127.0.0.1:8080".to_string()),
			chain_rpcs,
			worker_token: std::env::var("FILL_WORKER_TOKEN")
				.ok()
				.filter(|t| !t.trim().is_empty()),
		})
	}
}

/// Parse a comma-separated `CHAIN_RPCS` env var into a chain-id → URL map.
///
/// Format: `CHAIN_RPCS="11155420:https://sepolia.optimism.io,1:https://eth.llamarpc.com"`
///
/// Whitespace around entries is trimmed. Empty input returns an empty map.
/// Invalid entries (no `:` separator, non-numeric chain id) are silently
/// skipped so a typo doesn't crash the worker at boot.
pub fn parse_chain_rpcs_env(input: &str) -> HashMap<u64, String> {
	let mut out = HashMap::new();
	for entry in input.split(',') {
		let entry = entry.trim();
		if entry.is_empty() {
			continue;
		}
		if let Some((chain_id_str, url)) = entry.split_once(':') {
			if let Ok(chain_id) = chain_id_str.trim().parse::<u64>() {
				out.insert(chain_id, url.trim().to_string());
			}
		}
	}
	out
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_multiple_chain_entries() {
		let env = "11155420:https://sepolia.optimism.io,1:https://eth.llamarpc.com";
		let map = parse_chain_rpcs_env(env);
		assert_eq!(map.len(), 2);
		assert_eq!(map.get(&11155420).unwrap(), "https://sepolia.optimism.io");
		assert_eq!(map.get(&1).unwrap(), "https://eth.llamarpc.com");
	}

	#[test]
	fn handles_empty_input() {
		assert!(parse_chain_rpcs_env("").is_empty());
	}

	#[test]
	fn handles_whitespace() {
		let env = "  11155420 : https://x , 1:https://y  ";
		let map = parse_chain_rpcs_env(env);
		assert_eq!(map.get(&11155420).unwrap(), "https://x");
		assert_eq!(map.get(&1).unwrap(), "https://y");
	}

	#[test]
	fn skips_malformed_entries() {
		// No colon, non-numeric chain — silently dropped.
		let env = "garbage,abc:https://x,1:https://y";
		let map = parse_chain_rpcs_env(env);
		assert_eq!(map.len(), 1);
		assert_eq!(map.get(&1).unwrap(), "https://y");
	}
}
