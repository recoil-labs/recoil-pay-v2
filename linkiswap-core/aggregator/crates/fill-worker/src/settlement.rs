//! OIF escrow settlement encodings for the multi-tenant fill-worker.
//!
//! A marketplace swap settles in three on-chain transactions, all built
//! from the **user-signed Permit2 payload** the aggregator forwards with
//! every `/ws/orders` frame:
//!
//! 1. `openFor(order, sponsor, signature)` on the **origin** chain's
//!    InputSettler — pulls the user's input tokens into escrow using
//!    their Permit2 signature.
//! 2. `fill(orderId, output, fillDeadline, fillerData)` on the
//!    **destination** chain's OutputSettler — delivers the output tokens
//!    from the operator's fill-wallet to the user.
//! 3. `finalise(order, solveParams, destination, call)` back on the
//!    origin InputSettler — claims the escrowed input to the operator's
//!    payout address once the oracle attests the fill.
//!
//! The `sol!` declarations mirror the OIF reference implementation
//! (`solver/crates/solver-types/src/standards/eip7683.rs`) — do not edit
//! the field order or types: the ABI encoding must match the deployed
//! contracts byte-for-byte.
//!
//! Everything here derives from the *signed* message (never from
//! unsigned metadata), so the calldata always matches what the user
//! authorised.

use alloy_primitives::{Address, Bytes, FixedBytes, U256};
use alloy_sol_types::{sol, SolCall};
use serde::{Deserialize, Serialize};

use crate::{FillWorkerError, FillWorkerResult};

sol! {
	/// StandardOrder for the OIF contracts (ABI encoding).
	#[derive(Debug, PartialEq)]
	struct StandardOrder {
		address user;
		uint256 nonce;
		uint256 originChainId;
		uint32 expires;
		uint32 fillDeadline;
		address inputOracle;
		uint256[2][] inputs;
		SolMandateOutput[] outputs;
	}

	/// MandateOutput for the OIF contracts (ABI encoding).
	#[derive(Debug, PartialEq)]
	struct SolMandateOutput {
		bytes32 oracle;
		bytes32 settler;
		uint256 chainId;
		bytes32 token;
		uint256 amount;
		bytes32 recipient;
		bytes callbackData;
		bytes context;
	}

	/// Solve parameters combining fill timestamp and solver identity.
	#[derive(Debug, PartialEq)]
	struct SolveParams {
		uint32 timestamp;
		bytes32 solver;
	}

	/// Escrow-style input settler (origin chain).
	interface IInputSettlerEscrow {
		function openFor(StandardOrder calldata order, address sponsor, bytes calldata signature) external;
		function finalise(StandardOrder calldata order, SolveParams[] calldata solveParams, bytes32 destination, bytes calldata call) external;
		function orderIdentifier(StandardOrder calldata order) external view returns (bytes32);
	}

	/// Simple output settler (destination chain).
	interface IOutputSettlerSimple {
		function fill(bytes32 orderId, SolMandateOutput calldata output, uint48 fillDeadline, bytes calldata fillerData) external returns (bytes32);
	}

	/// Minimal ERC-20 surface the worker needs.
	interface IERC20 {
		function approve(address spender, uint256 amount) external returns (bool);
		function allowance(address owner, address spender) external view returns (uint256);
		function balanceOf(address owner) external view returns (uint256);
	}
}

/// The `signedOrder` block the aggregator merges into every `/ws/orders`
/// frame (see `oif-api` `post_orders`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedOrder {
	#[serde(default)]
	pub quote_id: Option<String>,
	pub order: OifOrderEnvelope,
	/// Scheme-prefixed signature (`0x00…` = Permit2 escrow).
	pub signature: String,
	/// Informational settlement block from the quote metadata. Never
	/// trusted for calldata — everything on-chain derives from `order`.
	#[serde(default)]
	pub settlement: serde_json::Value,
}

/// `{ "type": "oif-escrow-v0", "payload": { … } }`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OifOrderEnvelope {
	#[serde(rename = "type")]
	pub order_type: String,
	pub payload: OrderPayload,
}

/// The EIP-712 payload the user signed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderPayload {
	pub domain: serde_json::Value,
	pub primary_type: String,
	pub message: serde_json::Value,
}

/// Everything the settlement engine needs, derived from a `SignedOrder`.
#[derive(Debug, Clone)]
pub struct ParsedSettlement {
	pub order: StandardOrder,
	/// Scheme-prefixed signature bytes, passed to `openFor` unchanged —
	/// the settler reads the prefix byte to pick the verification path.
	pub signature: Bytes,
	/// The user — sponsor of the escrow.
	pub sponsor: Address,
	pub origin_chain_id: u64,
	pub destination_chain_id: u64,
	/// InputSettler on the origin chain (= the signed `spender`).
	pub input_settler: Address,
	/// OutputSettler on the destination chain (from the mandate output).
	pub output_settler: Address,
	pub output_token: Address,
	pub output_amount: U256,
	pub fill_deadline: u32,
}

impl ParsedSettlement {
	/// Parse and validate a `SignedOrder` into on-chain-ready structures.
	///
	/// Only single-input/single-output `oif-escrow-v0` orders are
	/// supported (the only shape the aggregator's quote ranker emits).
	pub fn from_signed_order(signed: &SignedOrder) -> FillWorkerResult<Self> {
		if signed.order.order_type != "oif-escrow-v0" {
			return Err(FillWorkerError::NotFillable(format!(
				"unsupported order type '{}'",
				signed.order.order_type
			)));
		}
		let payload = &signed.order.payload;
		if payload.primary_type != "PermitBatchWitnessTransferFrom" {
			return Err(FillWorkerError::NotFillable(format!(
				"unsupported primary type '{}'",
				payload.primary_type
			)));
		}

		let msg = &payload.message;
		let witness = msg
			.get("witness")
			.ok_or_else(|| not_fillable("payload message missing witness"))?;

		// Origin chain comes from the signed EIP-712 domain.
		let origin_chain_id = payload
			.domain
			.get("chainId")
			.and_then(|v| v.as_u64())
			.ok_or_else(|| not_fillable("payload domain missing numeric chainId"))?;

		// Single-input Permit2 batch.
		let permitted = msg
			.get("permitted")
			.and_then(|v| v.as_array())
			.filter(|a| a.len() == 1)
			.ok_or_else(|| not_fillable("expected exactly one permitted input"))?;
		let input_token = addr(str_field(&permitted[0], "token")?)?;
		let input_amount = u256_dec(str_field(&permitted[0], "amount")?)?;

		// Single mandate output.
		let outputs = witness
			.get("outputs")
			.and_then(|v| v.as_array())
			.filter(|a| a.len() == 1)
			.ok_or_else(|| not_fillable("expected exactly one witness output"))?;
		let out = &outputs[0];

		let sol_output = SolMandateOutput {
			oracle: b32(str_field(out, "oracle")?)?,
			settler: b32(str_field(out, "settler")?)?,
			chainId: U256::from(
				out.get("chainId")
					.and_then(|v| v.as_u64())
					.ok_or_else(|| not_fillable("output missing numeric chainId"))?,
			),
			token: b32(str_field(out, "token")?)?,
			amount: u256_dec(str_field(out, "amount")?)?,
			recipient: b32(str_field(out, "recipient")?)?,
			callbackData: hex_bytes(
				out.get("callbackData").and_then(|v| v.as_str()).unwrap_or("0x"),
			)?,
			context: hex_bytes(out.get("context").and_then(|v| v.as_str()).unwrap_or("0x"))?,
		};

		let user = addr(str_field(witness, "user")?)?;
		let expires: u32 = witness
			.get("expires")
			.and_then(|v| v.as_u64())
			.and_then(|v| u32::try_from(v).ok())
			.ok_or_else(|| not_fillable("witness missing u32 expires"))?;
		let fill_deadline: u32 = str_field(msg, "deadline")?
			.parse::<u64>()
			.ok()
			.and_then(|v| u32::try_from(v).ok())
			.ok_or_else(|| not_fillable("message deadline is not a u32-range integer"))?;

		let destination_chain_id: u64 = sol_output.chainId.try_into().map_err(|_| {
			not_fillable("output chainId exceeds u64")
		})?;

		let order = StandardOrder {
			user,
			nonce: u256_dec(str_field(msg, "nonce")?)?,
			originChainId: U256::from(origin_chain_id),
			expires,
			fillDeadline: fill_deadline,
			inputOracle: addr(str_field(witness, "inputOracle")?)?,
			inputs: vec![[addr_to_u256(input_token), input_amount]],
			outputs: vec![sol_output.clone()],
		};

		let signature = hex_bytes(&signed.signature)?;
		if signature.is_empty() {
			return Err(not_fillable("empty order signature"));
		}

		Ok(Self {
			order,
			signature,
			sponsor: user,
			origin_chain_id,
			destination_chain_id,
			input_settler: addr(str_field(msg, "spender")?)?,
			output_settler: addr_from_b32(&sol_output.settler),
			output_token: addr_from_b32(&sol_output.token),
			output_amount: sol_output.amount,
			fill_deadline,
		})
	}

	/// Calldata for `openFor` on the origin InputSettler.
	pub fn encode_open_for(&self) -> Vec<u8> {
		IInputSettlerEscrow::openForCall {
			order: self.order.clone(),
			sponsor: self.sponsor,
			signature: self.signature.clone(),
		}
		.abi_encode()
	}

	/// Calldata for the `orderIdentifier` staticcall on the origin
	/// InputSettler — the canonical order id the destination fill must
	/// reference.
	pub fn encode_order_identifier(&self) -> Vec<u8> {
		IInputSettlerEscrow::orderIdentifierCall {
			order: self.order.clone(),
		}
		.abi_encode()
	}

	/// Decode the `orderIdentifier` return value.
	pub fn decode_order_identifier(ret: &[u8]) -> FillWorkerResult<FixedBytes<32>> {
		IInputSettlerEscrow::orderIdentifierCall::abi_decode_returns(ret)
			.map_err(|e| not_fillable(&format!("orderIdentifier return decode: {e}")))
	}

	/// Calldata for `fill` on the destination OutputSettler. `filler` is
	/// the operator's fill-wallet — recorded on-chain as the solver that
	/// must later be credited by `finalise`.
	pub fn encode_fill(&self, order_id: FixedBytes<32>, filler: Address) -> Vec<u8> {
		IOutputSettlerSimple::fillCall {
			orderId: order_id,
			output: self.order.outputs[0].clone(),
			fillDeadline: alloy_primitives::Uint::<48, 1>::from(self.fill_deadline as u64),
			fillerData: Bytes::from(addr_to_b32(&filler).to_vec()),
		}
		.abi_encode()
	}

	/// Calldata for `finalise` on the origin InputSettler. `solver` must
	/// equal the fill's recorded filler; `destination` is where the
	/// escrowed input tokens are paid out; `fill_timestamp` is the
	/// destination-chain block timestamp of the fill.
	pub fn encode_finalise(
		&self,
		fill_timestamp: u32,
		solver: Address,
		destination: Address,
	) -> Vec<u8> {
		IInputSettlerEscrow::finaliseCall {
			order: self.order.clone(),
			solveParams: vec![SolveParams {
				timestamp: fill_timestamp,
				solver: addr_to_b32(&solver),
			}],
			destination: addr_to_b32(&destination),
			call: Bytes::new(),
		}
		.abi_encode()
	}
}

/// Calldata for `approve(spender, amount)` on an ERC-20.
pub fn encode_erc20_approve(spender: Address, amount: U256) -> Vec<u8> {
	IERC20::approveCall { spender, amount }.abi_encode()
}

/// Calldata for the `allowance(owner, spender)` staticcall.
pub fn encode_erc20_allowance(owner: Address, spender: Address) -> Vec<u8> {
	IERC20::allowanceCall { owner, spender }.abi_encode()
}

/// Calldata for the `balanceOf(owner)` staticcall.
pub fn encode_erc20_balance_of(owner: Address) -> Vec<u8> {
	IERC20::balanceOfCall { owner }.abi_encode()
}

/// Decode a single-`uint256` return value (allowance / balanceOf).
pub fn decode_u256_return(ret: &[u8]) -> FillWorkerResult<U256> {
	IERC20::allowanceCall::abi_decode_returns(ret)
		.map_err(|e| not_fillable(&format!("uint256 return decode: {e}")))
}

// ─── helpers ────────────────────────────────────────────────────────────────

fn not_fillable(msg: &str) -> FillWorkerError {
	FillWorkerError::NotFillable(msg.to_string())
}

fn str_field<'a>(v: &'a serde_json::Value, key: &str) -> FillWorkerResult<&'a str> {
	v.get(key)
		.and_then(|x| x.as_str())
		.ok_or_else(|| not_fillable(&format!("missing string field '{key}'")))
}

fn addr(s: &str) -> FillWorkerResult<Address> {
	s.parse::<Address>()
		.map_err(|e| not_fillable(&format!("bad address '{s}': {e}")))
}

fn b32(s: &str) -> FillWorkerResult<FixedBytes<32>> {
	s.parse::<FixedBytes<32>>()
		.map_err(|e| not_fillable(&format!("bad bytes32 '{s}': {e}")))
}

fn u256_dec(s: &str) -> FillWorkerResult<U256> {
	U256::from_str_radix(s.trim_start_matches("0x"), if s.starts_with("0x") { 16 } else { 10 })
		.map_err(|e| not_fillable(&format!("bad uint '{s}': {e}")))
}

fn hex_bytes(s: &str) -> FillWorkerResult<Bytes> {
	let stripped = s.trim_start_matches("0x");
	if stripped.is_empty() {
		return Ok(Bytes::new());
	}
	alloy_primitives::hex::decode(stripped)
		.map(Bytes::from)
		.map_err(|e| not_fillable(&format!("bad hex '{s}': {e}")))
}

fn addr_to_b32(a: &Address) -> FixedBytes<32> {
	let mut out = [0u8; 32];
	out[12..].copy_from_slice(a.as_slice());
	FixedBytes::<32>::from(out)
}

fn addr_from_b32(b: &FixedBytes<32>) -> Address {
	Address::from_slice(&b.as_slice()[12..])
}

fn addr_to_u256(a: Address) -> U256 {
	U256::from_be_slice(a.as_slice())
}

#[cfg(test)]
mod tests {
	use super::*;

	/// A signed-order JSON in exactly the shape the aggregator's
	/// `push_quote_ranker::shape` emits and `post_orders` broadcasts.
	fn sample_signed_order() -> SignedOrder {
		serde_json::from_value(serde_json::json!({
			"quoteId": "q-1",
			"order": {
				"type": "oif-escrow-v0",
				"payload": {
					"signatureType": "eip712",
					"domain": {
						"name": "Permit2",
						"chainId": 11155420u64,
						"verifyingContract": "0x000000000022D473030F116dDEE9F6B43aC78BA3"
					},
					"primaryType": "PermitBatchWitnessTransferFrom",
					"message": {
						"permitted": [{
							"token": "0x191688B2Ff5Be8F0A5BCAB3E819C900a810FAaf6",
							"amount": "1000000"
						}],
						"spender": "0x9EF00F018b4afDCAa89093EF3015E6D918a58003",
						"nonce": "1753776000000",
						"deadline": "1900000000",
						"witness": {
							"user": "0xf748bf5188579ded99e0365cd83c6376eaa5c310",
							"expires": 1900000300u64,
							"inputOracle": "0x309eAdeDfB7b7Da32b8714a9AA950c8B02924a8e",
							"outputs": [{
								"oracle": "0x000000000000000000000000309eadedfb7b7da32b8714a9aa950c8b02924a8e",
								"settler": "0x0000000000000000000000009ef00f018b4afdcaa89093ef3015e6d918a58003",
								"chainId": 84532u64,
								"token": "0x00000000000000000000000073c83dacc74bb8a704717ac09703b959e74b9705",
								"amount": "990000",
								"recipient": "0x000000000000000000000000f748bf5188579ded99e0365cd83c6376eaa5c310",
								"callbackData": "0x",
								"context": "0x"
							}]
						}
					},
					"types": {}
				}
			},
			"signature": "0x00aabbcc",
			"settlement": { "originChainId": 11155420u64 }
		}))
		.expect("sample signed order parses")
	}

	#[test]
	fn parses_standard_order_from_signed_payload() {
		let parsed = ParsedSettlement::from_signed_order(&sample_signed_order()).unwrap();

		assert_eq!(parsed.origin_chain_id, 11155420);
		assert_eq!(parsed.destination_chain_id, 84532);
		assert_eq!(
			parsed.input_settler,
			"0x9EF00F018b4afDCAa89093EF3015E6D918a58003".parse::<Address>().unwrap()
		);
		assert_eq!(
			parsed.output_settler,
			"0x9EF00F018b4afDCAa89093EF3015E6D918a58003".parse::<Address>().unwrap()
		);
		assert_eq!(
			parsed.output_token,
			"0x73c83DAcc74bB8a704717AC09703b959E74b9705".parse::<Address>().unwrap()
		);
		assert_eq!(parsed.output_amount, U256::from(990_000u64));
		assert_eq!(parsed.fill_deadline, 1_900_000_000);

		let order = &parsed.order;
		assert_eq!(order.originChainId, U256::from(11155420u64));
		assert_eq!(order.expires, 1_900_000_300);
		assert_eq!(order.inputs.len(), 1);
		// inputs[0] = [token-as-uint256, amount]
		assert_eq!(
			order.inputs[0][0],
			addr_to_u256("0x191688B2Ff5Be8F0A5BCAB3E819C900a810FAaf6".parse().unwrap())
		);
		assert_eq!(order.inputs[0][1], U256::from(1_000_000u64));
		assert_eq!(order.outputs.len(), 1);

		// The scheme prefix must be preserved on the signature.
		assert_eq!(parsed.signature.as_ref()[0], 0x00);
	}

	#[test]
	fn open_for_calldata_round_trips() {
		let parsed = ParsedSettlement::from_signed_order(&sample_signed_order()).unwrap();
		let data = parsed.encode_open_for();
		let decoded = IInputSettlerEscrow::openForCall::abi_decode(&data).unwrap();
		assert_eq!(decoded.order, parsed.order);
		assert_eq!(decoded.sponsor, parsed.sponsor);
		assert_eq!(decoded.signature, parsed.signature);
	}

	#[test]
	fn fill_calldata_round_trips_with_filler_bytes32() {
		let parsed = ParsedSettlement::from_signed_order(&sample_signed_order()).unwrap();
		let filler: Address = "0xf5dd9f05e82137d084c7121a63bac9e6fe20aa5b".parse().unwrap();
		let order_id = FixedBytes::<32>::from([7u8; 32]);
		let data = parsed.encode_fill(order_id, filler);
		let decoded = IOutputSettlerSimple::fillCall::abi_decode(&data).unwrap();
		assert_eq!(decoded.orderId, order_id);
		assert_eq!(decoded.output, parsed.order.outputs[0]);
		assert_eq!(decoded.fillDeadline, alloy_primitives::Uint::<48, 1>::from(parsed.fill_deadline as u64));
		// fillerData = 32 bytes, address left-padded.
		assert_eq!(decoded.fillerData.len(), 32);
		assert_eq!(&decoded.fillerData[12..], filler.as_slice());
	}

	#[test]
	fn finalise_calldata_round_trips() {
		let parsed = ParsedSettlement::from_signed_order(&sample_signed_order()).unwrap();
		let solver: Address = "0xf5dd9f05e82137d084c7121a63bac9e6fe20aa5b".parse().unwrap();
		let payout: Address = "0x632BF0D0d6468908378C3ccfAC4E788B115e0E55".parse().unwrap();
		let data = parsed.encode_finalise(1_900_000_100, solver, payout);
		let decoded = IInputSettlerEscrow::finaliseCall::abi_decode(&data).unwrap();
		assert_eq!(decoded.order, parsed.order);
		assert_eq!(decoded.solveParams.len(), 1);
		assert_eq!(decoded.solveParams[0].timestamp, 1_900_000_100);
		assert_eq!(&decoded.solveParams[0].solver.as_slice()[12..], solver.as_slice());
		assert_eq!(&decoded.destination.as_slice()[12..], payout.as_slice());
		assert!(decoded.call.is_empty());
	}

	#[test]
	fn rejects_wrong_order_type_and_missing_fields() {
		let mut so = sample_signed_order();
		so.order.order_type = "oif-3009-v0".into();
		assert!(ParsedSettlement::from_signed_order(&so).is_err());

		let mut so = sample_signed_order();
		so.order.payload.message["permitted"] = serde_json::json!([]);
		assert!(ParsedSettlement::from_signed_order(&so).is_err());

		let mut so = sample_signed_order();
		so.signature = "0x".into();
		assert!(ParsedSettlement::from_signed_order(&so).is_err());
	}

	#[test]
	fn erc20_helpers_encode_and_decode() {
		let owner: Address = "0xf5dd9f05e82137d084c7121a63bac9e6fe20aa5b".parse().unwrap();
		let spender: Address = "0x9EF00F018b4afDCAa89093EF3015E6D918a58003".parse().unwrap();
		let approve = encode_erc20_approve(spender, U256::MAX);
		assert_eq!(&approve[..4], &IERC20::approveCall::SELECTOR);
		let allowance = encode_erc20_allowance(owner, spender);
		assert_eq!(&allowance[..4], &IERC20::allowanceCall::SELECTOR);

		// A uint256 return decodes.
		let ret = U256::from(42u64).to_be_bytes::<32>();
		assert_eq!(decode_u256_return(&ret).unwrap(), U256::from(42u64));
	}
}
