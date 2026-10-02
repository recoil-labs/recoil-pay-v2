// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {GiftCardEscrow} from "../src/GiftCardEscrow.sol";
import {MerchantBond} from "../src/MerchantBond.sol";

/// @notice Deploys one escrow per chain.
///
/// The attestor is passed in rather than defaulted to the deployer: the
/// deploying key is usually a person at a terminal, while the attestor is the
/// aggregator's long-lived key. Conflating them is how an operator ends up
/// unable to release a trade because the deploy key lives on a laptop.
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url <url> --broadcast
/// with ATTESTOR_ADDRESS set, and the deploying key supplied by whichever
/// means you normally use (--ledger, --account, or an env var).
contract Deploy is Script {
    function run() external returns (GiftCardEscrow escrow, MerchantBond bond) {
        address attestor = vm.envAddress("ATTESTOR_ADDRESS");
        require(attestor != address(0), "ATTESTOR_ADDRESS is required");

        // Both in one broadcast: a chain with an escrow but no bond can take
        // trades it cannot enforce rulings on, and the exposure cap would
        // read zero bond and refuse every trade anyway.
        vm.startBroadcast();
        escrow = new GiftCardEscrow(attestor);
        bond = new MerchantBond(attestor);
        vm.stopBroadcast();

        console.log("GiftCardEscrow:", address(escrow));
        console.log("MerchantBond:  ", address(bond));
        console.log("attestor:      ", attestor);
    }
}
