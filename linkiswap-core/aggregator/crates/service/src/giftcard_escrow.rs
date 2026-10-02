//! On-chain settlement for gift card trades.
//!
//! Two jobs, and they are deliberately the only two:
//!
//! 1. **Verify** that a funder's lock really landed — the right trade, the
//!    right token, the right amount, the right two parties. A trade must
//!    never advance on a transaction hash somebody typed.
//! 2. **Release** a settled trade to whichever party the attestation named.
//!
//! The contract is `GiftCardEscrow` (see `v2/giftcard-escrow`), not the OIF
//! input settler. The OIF escrow releases on proof that a fill happened on a
//! destination chain; a gift card has no on-chain leg for such a proof to
//! exist about, so `finalise` could never be called and the funds would sit
//! there until they expired.

use alloy_network::{EthereumWallet, TransactionBuilder};
use alloy_primitives::{keccak256, Address, B256, U256};
use alloy_provider::{Provider, ProviderBuilder};
use alloy_rpc_types_eth::TransactionRequest;
use alloy_signer_local::PrivateKeySigner;
use alloy_sol_types::{sol, SolCall, SolEvent};
use oif_config::ChainRegistry;
use std::str::FromStr;
use std::sync::Arc;
use thiserror::Error;
use tracing::{info, warn};

sol! {
	event Locked(
		bytes32 indexed tradeId,
		address indexed funder,
		address indexed counterparty,
		address token,
		uint256 amount
	);

	function release(bytes32 tradeId, address to) external;
	function isOpen(bytes32 tradeId) external view returns (bool);

	function availableBond(address merchant, address token) external view returns (uint256);
	function proposeSlash(
		address merchant,
		address token,
		uint256 amount,
		address beneficiary,
		bytes32 tradeId
	) external;
}

#[derive(Debug, Error)]
pub enum EscrowError {
	#[error("chain {0} is not in the registry")]
	UnknownChain(String),
	#[error("no gift card escrow deployed on {0}")]
	NoEscrowOnChain(String),
	#[error("rpc error: {0}")]
	Rpc(String),
	#[error("no attestor key configured; gift card settlement is disabled")]
	NoAttestorKey,
	#[error("bad address {0}")]
	BadAddress(String),
	#[error("escrow verification failed: {0}")]
	Verification(String),
	#[error("no merchant bond contract deployed on {0}")]
	NoBondOnChain(String),
}

pub type EscrowResult<T> = Result<T, EscrowError>;

/// What a verified lock contained. Returned rather than compared inside the
/// verifier so the caller can log exactly what it accepted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedLock {
	pub trade_id: B256,
	pub funder: Address,
	pub counterparty: Address,
	pub token: Address,
	pub amount: U256,
}

/// Terms a lock has to match before a trade may advance.
#[derive(Debug, Clone)]
pub struct ExpectedLock {
	pub trade_id: String,
	pub funder: String,
	pub counterparty: String,
	pub token: String,
	pub amount: U256,
}

/// The on-chain identity of a trade: `keccak256` of its id.
///
/// The aggregator's ids are strings and the contract keys on `bytes32`, so
/// the mapping has to be fixed in one place. Hashing rather than truncating
/// means two ids can never collide into one lock.
pub fn trade_id_hash(trade_id: &str) -> B256 {
	keccak256(trade_id.as_bytes())
}

pub struct GiftCardEscrowClient {
	chains: Arc<ChainRegistry>,
	/// The key that may direct releases. Absent in deployments that have not
	/// been given one, in which case settlement is refused rather than faked.
	attestor: Option<PrivateKeySigner>,
}

impl GiftCardEscrowClient {
	pub fn new(chains: Arc<ChainRegistry>, attestor_key: Option<&str>) -> Self {
		let attestor = attestor_key
			.map(str::trim)
			.filter(|k| !k.is_empty())
			.and_then(|k| match PrivateKeySigner::from_str(k) {
				Ok(signer) => Some(signer),
				Err(e) => {
					// Logged without the key, and treated as absent: a
					// malformed key must disable settlement loudly, never
					// silently fall back to some other identity.
					warn!(error = %e, "GIFTCARD_ATTESTOR_KEY is not a valid private key; gift card settlement disabled");
					None
				}
			});

		if let Some(s) = &attestor {
			info!(attestor = %s.address(), "gift card escrow attestor loaded");
		}

		Self { chains, attestor }
	}

	/// True when this deployment can actually settle. Endpoints check it
	/// before accepting a trade rather than discovering it at payout time.
	pub fn is_enabled(&self) -> bool {
		self.attestor.is_some()
	}

	pub fn attestor_address(&self) -> Option<Address> {
		self.attestor.as_ref().map(|s| s.address())
	}

	fn bond_address(&self, caip2: &str) -> EscrowResult<(Address, String)> {
		let chain = self
			.chains
			.by_caip2(caip2)
			.ok_or_else(|| EscrowError::UnknownChain(caip2.to_string()))?;
		if chain.merchant_bond.trim().is_empty() {
			return Err(EscrowError::NoBondOnChain(caip2.to_string()));
		}
		Ok((parse_address(&chain.merchant_bond)?, chain.rpc_url.clone()))
	}

	/// A merchant's stake on this chain, less anything a pending slash has
	/// already earmarked.
	///
	/// This is the figure an exposure cap must be computed from. Using the
	/// posted amount instead would let a merchant with a live claim against
	/// them keep taking on new trades backed by money already spoken for.
	pub async fn available_bond(
		&self,
		caip2: &str,
		merchant: &str,
		token: &str,
	) -> EscrowResult<U256> {
		let (bond, rpc_url) = self.bond_address(caip2)?;
		let provider = ProviderBuilder::new()
			.connect(&rpc_url)
			.await
			.map_err(|e| EscrowError::Rpc(e.to_string()))?;

		let call = availableBondCall {
			merchant: parse_address(merchant)?,
			token: parse_address(token)?,
		};
		let out = provider
			.call(TransactionRequest::default().with_to(bond).with_input(call.abi_encode()))
			.await
			.map_err(|e| EscrowError::Rpc(e.to_string()))?;

		availableBondCall::abi_decode_returns(&out).map_err(|e| EscrowError::Rpc(e.to_string()))
	}

	/// Propose taking `amount` from a merchant's bond for `beneficiary`.
	///
	/// Proposed, not executed: the contract holds it for a delay during
	/// which the merchant can see the claim and a compromised attestor can
	/// be rotated out and its proposals cancelled. Execution is
	/// permissionless once mature, so the wronged party is not left
	/// depending on this service coming back for it.
	pub async fn propose_slash(
		&self,
		caip2: &str,
		merchant: &str,
		token: &str,
		amount: U256,
		beneficiary: &str,
		trade_id: &str,
	) -> EscrowResult<String> {
		let signer = self.attestor.as_ref().ok_or(EscrowError::NoAttestorKey)?;
		let (bond, rpc_url) = self.bond_address(caip2)?;

		let provider = ProviderBuilder::new()
			.wallet(EthereumWallet::from(signer.clone()))
			.connect(&rpc_url)
			.await
			.map_err(|e| EscrowError::Rpc(e.to_string()))?;

		let call = proposeSlashCall {
			merchant: parse_address(merchant)?,
			token: parse_address(token)?,
			amount,
			beneficiary: parse_address(beneficiary)?,
			tradeId: trade_id_hash(trade_id),
		};

		let pending = provider
			.send_transaction(
				TransactionRequest::default().with_to(bond).with_input(call.abi_encode()),
			)
			.await
			.map_err(|e| EscrowError::Rpc(e.to_string()))?;

		let hash = *pending.tx_hash();
		info!(trade_id, merchant, %amount, tx = %hash, "merchant bond slash proposed");
		Ok(format!("{hash:#x}"))
	}

	fn escrow_address(&self, caip2: &str) -> EscrowResult<(Address, String)> {
		let chain = self
			.chains
			.by_caip2(caip2)
			.ok_or_else(|| EscrowError::UnknownChain(caip2.to_string()))?;
		if chain.giftcard_escrow.trim().is_empty() {
			return Err(EscrowError::NoEscrowOnChain(caip2.to_string()));
		}
		let addr = parse_address(&chain.giftcard_escrow)?;
		Ok((addr, chain.rpc_url.clone()))
	}

	/// Confirm `tx_hash` locked exactly what the trade says it should.
	///
	/// Every field is checked. Accepting a receipt merely because it
	/// succeeded would let a funder point at any transaction at all — their
	/// own unrelated transfer, or somebody else's lock for a different
	/// trade — and have the trade advance against money that is not there.
	pub async fn verify_lock(
		&self,
		caip2: &str,
		tx_hash: &str,
		expected: &ExpectedLock,
	) -> EscrowResult<VerifiedLock> {
		let (escrow, rpc_url) = self.escrow_address(caip2)?;
		let provider = ProviderBuilder::new()
			.connect(&rpc_url)
			.await
			.map_err(|e| EscrowError::Rpc(e.to_string()))?;

		let hash = B256::from_str(tx_hash.trim())
			.map_err(|_| EscrowError::Verification(format!("{tx_hash} is not a transaction hash")))?;

		let receipt = provider
			.get_transaction_receipt(hash)
			.await
			.map_err(|e| EscrowError::Rpc(e.to_string()))?
			.ok_or_else(|| {
				// Not yet mined, or on a different chain. Either way the
				// client should retry rather than treat it as a rejection.
				EscrowError::Verification("transaction not found or not yet mined".to_string())
			})?;

		if !receipt.status() {
			return Err(EscrowError::Verification("transaction reverted".to_string()));
		}

		let want_trade = trade_id_hash(&expected.trade_id);
		let want_funder = parse_address(&expected.funder)?;
		let want_counterparty = parse_address(&expected.counterparty)?;
		let want_token = parse_address(&expected.token)?;

		for log in receipt.inner.logs() {
			// Only logs from the escrow itself count. Without this, a token
			// with a lookalike event could be mistaken for a lock.
			if log.address() != escrow {
				continue;
			}
			let Ok(decoded) = Locked::decode_log(&log.inner) else {
				continue;
			};
			if decoded.tradeId != want_trade {
				continue;
			}

			if decoded.funder != want_funder {
				return Err(EscrowError::Verification(format!(
					"lock was funded by {} but this trade expects {want_funder}",
					decoded.funder
				)));
			}
			if decoded.counterparty != want_counterparty {
				return Err(EscrowError::Verification(
					"lock names a different counterparty".to_string(),
				));
			}
			if decoded.token != want_token {
				return Err(EscrowError::Verification(format!(
					"lock is in token {} but this trade settles in {want_token}",
					decoded.token
				)));
			}
			// Greater-or-equal rather than exact: overpaying is the funder's
			// own loss and should not strand a trade. Underpaying must not
			// pass, which is the case this guards.
			if decoded.amount < expected.amount {
				return Err(EscrowError::Verification(format!(
					"lock is {} but this trade needs {}",
					decoded.amount, expected.amount
				)));
			}

			return Ok(VerifiedLock {
				trade_id: decoded.tradeId,
				funder: decoded.funder,
				counterparty: decoded.counterparty,
				token: decoded.token,
				amount: decoded.amount,
			});
		}

		Err(EscrowError::Verification(
			"that transaction contains no lock for this trade".to_string(),
		))
	}

	/// Pay a settled trade out to `to`, and return the transaction hash.
	///
	/// The contract will only accept one of the lock's two parties, so a bug
	/// here cannot send money to a stranger — it can at worst pay the wrong
	/// one of the two, which is why the caller derives `to` from the trade's
	/// own transition rather than from a request field.
	pub async fn release(&self, caip2: &str, trade_id: &str, to: &str) -> EscrowResult<String> {
		let signer = self.attestor.as_ref().ok_or(EscrowError::NoAttestorKey)?;
		let (escrow, rpc_url) = self.escrow_address(caip2)?;
		let recipient = parse_address(to)?;

		let provider = ProviderBuilder::new()
			.wallet(EthereumWallet::from(signer.clone()))
			.connect(&rpc_url)
			.await
			.map_err(|e| EscrowError::Rpc(e.to_string()))?;

		let call = releaseCall {
			tradeId: trade_id_hash(trade_id),
			to: recipient,
		};

		let tx = TransactionRequest::default()
			.with_to(escrow)
			.with_input(call.abi_encode());

		let pending = provider
			.send_transaction(tx)
			.await
			.map_err(|e| EscrowError::Rpc(e.to_string()))?;

		let hash = *pending.tx_hash();
		info!(trade_id, %recipient, tx = %hash, "gift card escrow release submitted");
		Ok(format!("{hash:#x}"))
	}

	/// Whether the contract still holds this trade's funds. Used to avoid
	/// re-sending a release for a lock that is already paid out.
	pub async fn is_open(&self, caip2: &str, trade_id: &str) -> EscrowResult<bool> {
		let (escrow, rpc_url) = self.escrow_address(caip2)?;
		let provider = ProviderBuilder::new()
			.connect(&rpc_url)
			.await
			.map_err(|e| EscrowError::Rpc(e.to_string()))?;

		let call = isOpenCall {
			tradeId: trade_id_hash(trade_id),
		};
		let tx = TransactionRequest::default()
			.with_to(escrow)
			.with_input(call.abi_encode());

		let out = provider
			.call(tx)
			.await
			.map_err(|e| EscrowError::Rpc(e.to_string()))?;

		isOpenCall::abi_decode_returns(&out).map_err(|e| EscrowError::Rpc(e.to_string()))
	}
}

fn parse_address(s: &str) -> EscrowResult<Address> {
	Address::from_str(s.trim()).map_err(|_| EscrowError::BadAddress(s.to_string()))
}

#[cfg(test)]
mod tests {
	use super::*;
	use oif_config::ChainRegistry;

	fn registry() -> Arc<ChainRegistry> {
		Arc::new(ChainRegistry::testnet_default())
	}

	#[test]
	fn a_trade_id_hashes_to_a_stable_distinct_key() {
		assert_eq!(trade_id_hash("gct-1"), trade_id_hash("gct-1"));
		assert_ne!(trade_id_hash("gct-1"), trade_id_hash("gct-2"));
		// Prefix collisions are the reason this hashes rather than truncates.
		assert_ne!(trade_id_hash("gct-1"), trade_id_hash("gct-10"));
	}

	#[test]
	fn settlement_is_disabled_without_a_key_rather_than_faked() {
		let client = GiftCardEscrowClient::new(registry(), None);
		assert!(!client.is_enabled());
		assert!(client.attestor_address().is_none());
	}

	#[test]
	fn a_malformed_attestor_key_disables_settlement() {
		// Must not fall back to some other identity: a deployment that
		// cannot release should refuse trades, not accept and strand them.
		let client = GiftCardEscrowClient::new(registry(), Some("not-a-key"));
		assert!(!client.is_enabled());
	}

	#[test]
	fn a_blank_key_is_treated_as_absent() {
		assert!(!GiftCardEscrowClient::new(registry(), Some("   ")).is_enabled());
	}

	/// A chain the registry knows but has no contracts on. Eth Sepolia is
	/// deliberately left unconfigured; naming a deployed chain here would
	/// make this test pass for the wrong reason the moment someone deployed
	/// to it, which is exactly what happened to its first version.
	const UNCONFIGURED_CHAIN: &str = "eip155:11155111";

	#[tokio::test]
	async fn a_chain_without_a_deployed_escrow_is_refused() {
		// The guard that stops a trade advancing against nothing.
		let client = GiftCardEscrowClient::new(registry(), None);
		let err = client
			.is_open(UNCONFIGURED_CHAIN, "gct-1")
			.await
			.expect_err("should refuse without a deployment");
		assert!(matches!(err, EscrowError::NoEscrowOnChain(_)), "{err}");
	}

	#[tokio::test]
	async fn a_chain_without_a_deployed_bond_is_refused() {
		let client = GiftCardEscrowClient::new(registry(), None);
		let err = client
			.available_bond(
				UNCONFIGURED_CHAIN,
				"0x0000000000000000000000000000000000000001",
				"0x0000000000000000000000000000000000000002",
			)
			.await
			.expect_err("should refuse without a bond deployment");
		assert!(matches!(err, EscrowError::NoBondOnChain(_)), "{err}");
	}

	#[tokio::test]
	async fn proposing_a_slash_without_a_key_fails_before_touching_the_chain() {
		let client = GiftCardEscrowClient::new(registry(), None);
		let err = client
			.propose_slash(
				UNCONFIGURED_CHAIN,
				"0x0000000000000000000000000000000000000001",
				"0x0000000000000000000000000000000000000002",
				U256::from(1u64),
				"0x0000000000000000000000000000000000000003",
				"gct-1",
			)
			.await
			.expect_err("should refuse without an attestor");
		assert!(matches!(err, EscrowError::NoAttestorKey), "{err}");
	}

	#[tokio::test]
	async fn an_unknown_chain_is_refused() {
		let client = GiftCardEscrowClient::new(registry(), None);
		let err = client
			.is_open("eip155:999999", "gct-1")
			.await
			.expect_err("should refuse an unknown chain");
		assert!(matches!(err, EscrowError::UnknownChain(_)), "{err}");
	}

	#[tokio::test]
	async fn releasing_without_a_key_fails_before_touching_the_chain() {
		let client = GiftCardEscrowClient::new(registry(), None);
		let err = client
			.release(UNCONFIGURED_CHAIN, "gct-1", "0x0000000000000000000000000000000000000001")
			.await
			.expect_err("should refuse without an attestor");
		assert!(matches!(err, EscrowError::NoAttestorKey), "{err}");
	}
}
