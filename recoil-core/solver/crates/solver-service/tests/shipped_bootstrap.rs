//! The live solver boots seedless from `config/testnet-mine-bootstrap.json`
//! (`--bootstrap-config … --force-seed`). A bad edit to that file should
//! fail here rather than at deploy time.

use alloy_primitives::address;
use solver_service::config_merge::{build_runtime_config, merge_to_operator_config_seedless};
use solver_types::SeedOverrides;

#[test]
fn shipped_testnet_bootstrap_merges_with_all_to_all_routes() {
	let overrides: SeedOverrides =
		serde_json::from_str(include_str!("../../../config/testnet-mine-bootstrap.json"))
			.expect("bootstrap parses");
	let op_config = merge_to_operator_config_seedless(overrides).expect("merge ok");
	build_runtime_config(&op_config).expect("runtime config ok");

	let mut chain_ids: Vec<u64> = op_config.networks.keys().copied().collect();
	chain_ids.sort_unstable();
	assert_eq!(chain_ids, vec![97, 80002, 84532, 11155111, 11155420]);

	// Routes are an explicit adjacency map: a missing direction silently
	// produces no quotes for that pair.
	let direct = op_config.settlement.direct.as_ref().expect("direct settlement");
	for chain_id in &chain_ids {
		assert!(direct.oracles.input.contains_key(chain_id), "input oracle {chain_id}");
		assert!(direct.oracles.output.contains_key(chain_id), "output oracle {chain_id}");
		let mut dests = direct.routes[chain_id].clone();
		dests.sort_unstable();
		let others: Vec<u64> = chain_ids.iter().copied().filter(|c| c != chain_id).collect();
		assert_eq!(dests, others, "routes from {chain_id}");
	}

	// BSC testnet's mock USDC is 6 decimals; real BSC USDC is 18.
	let usdc = &op_config.networks[&97].tokens[0];
	assert_eq!(usdc.address, address!("67bF9ba31f64de698EfD23c2CB0208191A5C2A9e"));
	assert_eq!(usdc.decimals, 6);
}
