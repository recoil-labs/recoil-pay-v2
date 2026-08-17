//! Chain registry — per-chain contract addresses, tokens, and RPC URLs.
//!
//! The aggregator needs to know, for every supported chain:
//!
//! - where the OIF settlement contracts live (`input_settler`,
//!   `output_settler`, the attestation `oracle`, and `permit2`),
//! - which tokens are tradable (address + decimals, so quotes can be
//!   priced in base units), and
//! - an RPC endpoint for on-chain reads.
//!
//! The registry ships with the deployed testnet addresses baked in
//! (`ChainRegistry::testnet_default`) and supports two env overrides:
//!
//! - `CHAIN_RPCS` — `"<chain_id>:<url>,<chain_id>:<url>"`, the same
//!   format the fill-worker already uses. Overrides RPC URLs only.
//! - `CHAIN_REGISTRY_JSON` — a full JSON registry (array of
//!   `ChainInfo`). Replaces the baked-in set entirely, so new chains
//!   can be added without a rebuild.
//!
//! Addresses are stored as `0x`-prefixed hex strings rather than a
//! concrete address type so this crate stays dependency-light; callers
//! that need typed addresses parse at the boundary.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Canonical Permit2 address — identical on every EVM chain.
pub const PERMIT2_ADDRESS: &str = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/// A tradable token on a specific chain.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TokenInfo {
	pub symbol: String,
	/// 0x-prefixed EVM address.
	pub address: String,
	pub decimals: u8,
}

/// Everything the aggregator knows about one chain.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChainInfo {
	pub chain_id: u64,
	/// Human-readable name (matches the OIF solver config naming).
	pub name: String,
	/// JSON-RPC endpoint used for on-chain reads.
	pub rpc_url: String,
	/// OIF InputSettler (escrow) address on this chain.
	pub input_settler: String,
	/// OIF OutputSettler address on this chain.
	pub output_settler: String,
	/// Attestation oracle consulted before escrow finalisation.
	pub oracle: String,
	/// Permit2 address (canonical on all chains, but kept per-chain so
	/// a future chain with a non-canonical deployment still fits).
	pub permit2: String,
	pub tokens: Vec<TokenInfo>,
}

impl ChainInfo {
	/// CAIP-2 identifier, e.g. `eip155:84532`.
	pub fn caip2(&self) -> String {
		format!("eip155:{}", self.chain_id)
	}

	/// Find a token by its 0x address (case-insensitive).
	pub fn token_by_address(&self, address: &str) -> Option<&TokenInfo> {
		self.tokens
			.iter()
			.find(|t| t.address.eq_ignore_ascii_case(address))
	}

	/// Find a token by symbol (case-insensitive).
	pub fn token_by_symbol(&self, symbol: &str) -> Option<&TokenInfo> {
		self.tokens
			.iter()
			.find(|t| t.symbol.eq_ignore_ascii_case(symbol))
	}
}

/// Registry of all chains the aggregator supports.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChainRegistry {
	chains: HashMap<u64, ChainInfo>,
}

impl ChainRegistry {
	pub fn new(chains: Vec<ChainInfo>) -> Self {
		Self {
			chains: chains.into_iter().map(|c| (c.chain_id, c)).collect(),
		}
	}

	/// The deployed testnet environment. Contract addresses were pulled
	/// from the live OIF solver deployment
	/// (`solver/config/testnet-mine-bootstrap.json`):
	///
	/// - OP Sepolia and Base Sepolia share two settler contracts with
	///   the input/output roles mirrored between the chains.
	/// - Ethereum Sepolia and Polygon Amoy use the canonical OIF
	///   deployments.
	/// - The oracle on every chain is an `AlwaysYesOracle` (testnet
	///   only — attests everything).
	pub fn testnet_default() -> Self {
		let permit2 = PERMIT2_ADDRESS.to_string();
		let usdc = |address: &str| TokenInfo {
			symbol: "USDC".into(),
			address: address.into(),
			decimals: 6,
		};
		Self::new(vec![
			ChainInfo {
				chain_id: 11155420,
				name: "optimism-sepolia".into(),
				rpc_url: "https://sepolia.optimism.io".into(),
				input_settler: "0x9EF00F018b4afDCAa89093EF3015E6D918a58003".into(),
				output_settler: "0xBE85Bb9ADb91D42fa148dE3a929BE1b9C46270A5".into(),
				oracle: "0x309eAdeDfB7b7Da32b8714a9AA950c8B02924a8e".into(),
				permit2: permit2.clone(),
				tokens: vec![
					usdc("0x191688B2Ff5Be8F0A5BCAB3E819C900a810FAaf6"),
					TokenInfo {
						symbol: "USDT".into(),
						address: "0x8D13AE83C2D23518299bBbA47975731b88c844D8".into(),
						decimals: 6,
					},
				],
			},
			ChainInfo {
				chain_id: 84532,
				name: "base-sepolia".into(),
				rpc_url: "https://sepolia.base.org".into(),
				input_settler: "0xBE85Bb9ADb91D42fa148dE3a929BE1b9C46270A5".into(),
				output_settler: "0x9EF00F018b4afDCAa89093EF3015E6D918a58003".into(),
				oracle: "0x309eAdeDfB7b7Da32b8714a9AA950c8B02924a8e".into(),
				permit2: permit2.clone(),
				tokens: vec![usdc("0x73c83DAcc74bB8a704717AC09703b959E74b9705")],
			},
			ChainInfo {
				chain_id: 11155111,
				name: "ethereum-sepolia".into(),
				rpc_url: "https://ethereum-sepolia-rpc.publicnode.com".into(),
				input_settler: "0x1CC9260E285C2C8AC8D2E7102F3978056Ec1d0a8".into(),
				output_settler: "0x52602D7cc3D833F5d28ee6D01C7F82C9b2322e10".into(),
				oracle: "0x306766B063383DF67035465BA883c46bBCf6254c".into(),
				permit2: permit2.clone(),
				tokens: vec![usdc("0x8c1963bA445dd562Da0B6c6fbCa070921B3fa8E6")],
			},
			ChainInfo {
				chain_id: 80002,
				name: "polygon-amoy".into(),
				rpc_url: "https://rpc-amoy.polygon.technology".into(),
				input_settler: "0x1CC9260E285C2C8AC8D2E7102F3978056Ec1d0a8".into(),
				output_settler: "0x52602D7cc3D833F5d28ee6D01C7F82C9b2322e10".into(),
				oracle: "0x306766B063383DF67035465BA883c46bBCf6254c".into(),
				permit2,
				tokens: vec![usdc("0x8c1963bA445dd562Da0B6c6fbCa070921B3fa8E6")],
			},
		])
	}

	/// Build the registry from the environment: start from
	/// `CHAIN_REGISTRY_JSON` if set (full replacement), otherwise the
	/// baked-in testnet set, then apply `CHAIN_RPCS` URL overrides.
	pub fn from_env() -> Self {
		let mut registry = match std::env::var("CHAIN_REGISTRY_JSON") {
			Ok(json) if !json.trim().is_empty() => {
				match serde_json::from_str::<Vec<ChainInfo>>(&json) {
					Ok(chains) => Self::new(chains),
					Err(e) => {
						tracing::warn!(
							error = %e,
							"CHAIN_REGISTRY_JSON is set but failed to parse; \
							 falling back to the baked-in testnet registry"
						);
						Self::testnet_default()
					},
				}
			},
			_ => Self::testnet_default(),
		};
		if let Ok(spec) = std::env::var("CHAIN_RPCS") {
			registry.apply_rpc_overrides(&spec);
		}
		registry
	}

	/// Apply `"<chain_id>:<url>,<chain_id>:<url>"` RPC overrides (the
	/// fill-worker's `CHAIN_RPCS` format). Unknown chain ids and
	/// malformed entries are skipped with a warning.
	pub fn apply_rpc_overrides(&mut self, spec: &str) {
		for entry in spec.split(',') {
			let entry = entry.trim();
			if entry.is_empty() {
				continue;
			}
			let Some((id, url)) = entry.split_once(':') else {
				tracing::warn!(entry, "malformed CHAIN_RPCS entry; expected <chain_id>:<url>");
				continue;
			};
			let Ok(chain_id) = id.trim().parse::<u64>() else {
				tracing::warn!(entry, "malformed CHAIN_RPCS chain id");
				continue;
			};
			match self.chains.get_mut(&chain_id) {
				Some(chain) => chain.rpc_url = url.trim().to_string(),
				None => {
					tracing::warn!(chain_id, "CHAIN_RPCS entry for unknown chain id; skipped")
				},
			}
		}
	}

	pub fn get(&self, chain_id: u64) -> Option<&ChainInfo> {
		self.chains.get(&chain_id)
	}

	/// Look up by CAIP-2 (`eip155:84532`) or a bare numeric id.
	pub fn by_caip2(&self, caip2: &str) -> Option<&ChainInfo> {
		let id = caip2.rsplit(':').next()?.trim().parse::<u64>().ok()?;
		self.get(id)
	}

	pub fn chain_ids(&self) -> Vec<u64> {
		let mut ids: Vec<u64> = self.chains.keys().copied().collect();
		ids.sort_unstable();
		ids
	}

	pub fn iter(&self) -> impl Iterator<Item = &ChainInfo> {
		self.chains.values()
	}

	pub fn len(&self) -> usize {
		self.chains.len()
	}

	pub fn is_empty(&self) -> bool {
		self.chains.is_empty()
	}

	/// Resolve a CAIP-19 asset id (`eip155:84532/erc20:0x…`) to the
	/// chain and token it names. Also tolerates a bare `0x…` address
	/// when `default_chain` is provided (legacy quotes stored the
	/// address without the chain prefix).
	pub fn resolve_asset<'a>(
		&'a self,
		asset: &str,
		default_chain: Option<u64>,
	) -> Option<(&'a ChainInfo, &'a TokenInfo)> {
		let (chain, address) = match asset.split_once('/') {
			Some((chain_part, asset_part)) => {
				let chain = self.by_caip2(chain_part)?;
				let address = asset_part.rsplit(':').next()?;
				(chain, address)
			},
			None => {
				let chain = self.get(default_chain?)?;
				(chain, asset)
			},
		};
		let token = chain.token_by_address(address)?;
		Some((chain, token))
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn testnet_default_has_all_four_chains() {
		let reg = ChainRegistry::testnet_default();
		assert_eq!(reg.chain_ids(), vec![80002, 84532, 11155111, 11155420]);
		for chain in reg.iter() {
			assert!(chain.input_settler.starts_with("0x"));
			assert!(chain.output_settler.starts_with("0x"));
			assert!(chain.oracle.starts_with("0x"));
			assert_eq!(chain.permit2, PERMIT2_ADDRESS);
			assert!(!chain.tokens.is_empty());
		}
	}

	#[test]
	fn op_and_base_settlers_are_mirrored() {
		let reg = ChainRegistry::testnet_default();
		let op = reg.get(11155420).unwrap();
		let base = reg.get(84532).unwrap();
		assert_eq!(op.input_settler, base.output_settler);
		assert_eq!(op.output_settler, base.input_settler);
	}

	#[test]
	fn caip2_lookup_and_format() {
		let reg = ChainRegistry::testnet_default();
		let base = reg.by_caip2("eip155:84532").unwrap();
		assert_eq!(base.name, "base-sepolia");
		assert_eq!(base.caip2(), "eip155:84532");
		assert!(reg.by_caip2("eip155:1").is_none());
		assert!(reg.by_caip2("garbage").is_none());
	}

	#[test]
	fn token_lookup_is_case_insensitive() {
		let reg = ChainRegistry::testnet_default();
		let base = reg.get(84532).unwrap();
		let lower = base
			.token_by_address("0x73c83dacc74bb8a704717ac09703b959e74b9705")
			.unwrap();
		assert_eq!(lower.symbol, "USDC");
		assert_eq!(lower.decimals, 6);
		assert!(base.token_by_symbol("usdc").is_some());
	}

	#[test]
	fn resolve_asset_caip19_and_bare_address() {
		let reg = ChainRegistry::testnet_default();
		let (chain, token) = reg
			.resolve_asset(
				"eip155:84532/erc20:0x73c83DAcc74bB8a704717AC09703b959E74b9705",
				None,
			)
			.unwrap();
		assert_eq!(chain.chain_id, 84532);
		assert_eq!(token.symbol, "USDC");

		let (chain, token) = reg
			.resolve_asset("0x191688B2Ff5Be8F0A5BCAB3E819C900a810FAaf6", Some(11155420))
			.unwrap();
		assert_eq!(chain.chain_id, 11155420);
		assert_eq!(token.symbol, "USDC");

		assert!(reg.resolve_asset("eip155:84532/erc20:0xdead", None).is_none());
	}

	#[test]
	fn rpc_overrides_apply_and_skip_malformed() {
		let mut reg = ChainRegistry::testnet_default();
		reg.apply_rpc_overrides(
			"84532:https://base.example.com, 11155420:https://op.example.com/x, \
			 999:https://unknown.example.com, garbage, :nourl",
		);
		assert_eq!(reg.get(84532).unwrap().rpc_url, "https://base.example.com");
		assert_eq!(
			reg.get(11155420).unwrap().rpc_url,
			"https://op.example.com/x"
		);
		// Untouched chain keeps its default.
		assert_eq!(
			reg.get(80002).unwrap().rpc_url,
			"https://rpc-amoy.polygon.technology"
		);
	}

	#[test]
	fn registry_round_trips_through_json() {
		let reg = ChainRegistry::testnet_default();
		let json = serde_json::to_string(&reg.iter().cloned().collect::<Vec<_>>()).unwrap();
		let parsed: Vec<ChainInfo> = serde_json::from_str(&json).unwrap();
		let rebuilt = ChainRegistry::new(parsed);
		assert_eq!(rebuilt.chain_ids(), reg.chain_ids());
	}
}
