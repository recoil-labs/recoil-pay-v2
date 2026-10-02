//! Guards on the published OpenAPI document.
//!
//! The spec is developer-facing: it powers Swagger UI at `/swagger-ui` and
//! is what partners point codegen at. The failure mode that matters is not
//! "the spec is missing" — it is "the spec is present and wrong", which
//! sends people confidently in the wrong direction.
//!
//! These tests pin the properties that were actually broken when the spec
//! was first wired up, so they cannot silently return.

#![cfg(feature = "openapi")]

use oif_api::openapi::ApiDoc;
use utoipa::OpenApi;

fn spec() -> serde_json::Value {
	serde_json::to_value(ApiDoc::openapi()).expect("spec must serialise to JSON")
}

/// Every route a partner needs must be documented. `/api/v1/chains` was
/// missing from the inherited spec even though it is public and the docs
/// tell integrators to read token decimals from it.
#[test]
fn documents_the_whole_public_integration_surface() {
	let spec = spec();
	let paths = spec["paths"].as_object().expect("spec must have paths");

	for path in [
		"/health",
		"/api/v1/chains",
		"/api/v1/solvers",
		"/api/v1/quotes",
		"/api/v1/orders",
	] {
		assert!(
			paths.contains_key(path),
			"{path} is part of the public surface and must be in the spec; \
			 documented paths: {:?}",
			paths.keys().collect::<Vec<_>>()
		);
	}
}

/// The spec must not advertise authenticated operator tooling. Publishing
/// `/solver-api/*` would both mislead partners and inventory private
/// routes for anyone who asks.
#[test]
fn omits_authenticated_operator_routes() {
	let spec = spec();
	for path in spec["paths"].as_object().unwrap().keys() {
		assert!(
			!path.starts_with("/solver-api"),
			"{path} is authenticated operator tooling and must stay out of the public spec"
		);
	}
}

/// Swagger UI pre-fills "Try it out" from this example, so it has to be a
/// request that actually succeeds.
///
/// The inherited example omitted `user` and `supportedTypes` — both
/// required and non-optional, so it failed to deserialise — and carried
/// `minValidUntil: 600`, which this deployment copies verbatim into an
/// absolute `validBefore` and thereby produces an order that expired in
/// 1970. A developer's first click must not hand them a broken order.
#[test]
fn quote_example_is_a_request_that_works() {
	let spec = spec();
	let example = &spec["components"]["schemas"]["QuoteRequest"]["example"];
	assert!(
		example.is_object(),
		"QuoteRequest must carry an example — it is the pre-filled Try-it-out body"
	);

	assert!(
		example["user"].is_string(),
		"`user` is required and non-optional; without it the example fails to deserialise"
	);

	let supported = example["supportedTypes"]
		.as_array()
		.expect("`supportedTypes` is required and validated non-empty");
	assert!(
		!supported.is_empty(),
		"validation rejects an empty supportedTypes"
	);
	assert_eq!(
		supported[0], "oif-escrow-v0",
		"escrow is the only settlement route that works end to end today"
	);

	assert!(
		example["intent"].get("minValidUntil").is_none(),
		"minValidUntil must stay out of the example: it is copied verbatim into an \
		 absolute validBefore, so a relative value yields an order expired since 1970"
	);

	// EIP-3009's open path currently reverts on-chain, and offering the
	// scheme is enough for a solver to prefer it over Permit2.
	let schemes = example["intent"]["originSubmission"]["schemes"]
		.as_array()
		.expect("the example must pin an origin submission scheme");
	assert_eq!(
		schemes,
		&vec![serde_json::json!("permit2")],
		"the example must request permit2 only"
	);
}

/// Addresses in the example must be ERC-7930 interop-encoded, not plain
/// `0x` addresses — the API rejects the latter, and a wrong encoding
/// fails *silently* with zero quotes, which is the single most common
/// integration mistake.
#[test]
fn quote_example_uses_interop_encoded_addresses() {
	let spec = spec();
	let intent = &spec["components"]["schemas"]["QuoteRequest"]["example"]["intent"];

	for (label, value) in [
		("inputs[0].user", &intent["inputs"][0]["user"]),
		("inputs[0].asset", &intent["inputs"][0]["asset"]),
		("outputs[0].receiver", &intent["outputs"][0]["receiver"]),
		("outputs[0].asset", &intent["outputs"][0]["asset"]),
	] {
		let addr = value.as_str().unwrap_or_else(|| panic!("{label} must be a string"));
		// version 0x0001 + chainType 0x0000 for EIP-155.
		assert!(
			addr.starts_with("0x00010000"),
			"{label} must be ERC-7930 encoded (0x0001 version + 0x0000 chainType), got {addr}"
		);
		// A plain EVM address is 42 chars; an interop address is longer
		// because it carries the chain reference and two length bytes.
		assert!(
			addr.len() > 42,
			"{label} looks like a plain 0x address, which the API rejects: {addr}"
		);
	}
}
