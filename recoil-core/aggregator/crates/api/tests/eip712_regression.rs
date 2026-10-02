use alloy_primitives::{Address, B256, U256};
use alloy_sol_types::{eip712_domain, sol, SolStruct};
use serde::{Deserialize, Serialize};

// Define EIP-712 domain and structures for Permitted
// We're mimicking the on-chain structures

sol! {
    struct TokenAmount {
        address token;
        uint256 amount;
    }

    struct Permitted {
        address permitted;
        uint256 amount;
    }

    struct BatchCompact {
        Permitted[] permitteds;
        uint256 nonce;
        uint256 deadline;
    }
}

fn recoilpay_domain(chain_id: u64, verifying_contract: Address) -> alloy_sol_types::Eip712Domain {
    eip712_domain! {
        name: "RecoilPay",
        version: "1",
        chain_id: chain_id,
        verifying_contract: verifying_contract,
    }
}

#[test]
fn test_eip712_witness_hashing() {
    let verifying_contract = Address::ZERO; // For test
    let domain = recoilpay_domain(11155420, verifying_contract);

    let permitted = Permitted {
        permitted: Address::ZERO,
        amount: U256::from(100),
    };

    let batch = BatchCompact {
        permitteds: vec![permitted],
        nonce: U256::from(1),
        deadline: U256::from(1234567890),
    };

    let hash = batch.eip712_signing_hash(&domain);
    
    // Ensure the hash computes properly without panic
    assert_ne!(hash, B256::ZERO);
}
