//! Quote request model and validation

use crate::constants::limits::{
	MAX_GLOBAL_TIMEOUT_MS, MAX_PRIORITY_THRESHOLD, MAX_SOLVER_TIMEOUT_MS, MIN_SOLVER_TIMEOUT_MS,
};
use crate::oif::OifGetQuoteRequestLatest;
use serde::{Deserialize, Serialize};
#[cfg(feature = "openapi")]
#[allow(unused_imports)]
use serde_json::json;
#[cfg(feature = "openapi")]
use utoipa::ToSchema;

use super::{QuoteValidationError, QuoteValidationResult};

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[serde(rename_all = "lowercase")]
pub enum SolverSelection {
	#[default]
	All,
	Sampled,
	Priority,
}

/// API request body for /api/v1/quotes endpoint
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[cfg_attr(feature = "openapi", schema(example = json!({
    "includeSolvers": ["example-solver"],
    "timeout": 4000,
    "solverTimeout": 2000,
    "minQuotes": 1,
    "solverSelection": "all"
})))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SolverOptions {
	/// Solver IDs to include (overrides circuit breaker Open state with warning)
	pub include_solvers: Option<Vec<String>>,
	/// Solver IDs to exclude from query
	pub exclude_solvers: Option<Vec<String>>,
	/// Overall request timeout (ms) for POST /quotes
	pub timeout: Option<u64>,
	/// Per-solver timeout (ms) for individual quote responses
	pub solver_timeout: Option<u64>,
	/// Minimum number of valid quotes required before responding
	pub min_quotes: Option<u64>,
	/// Solver selection strategy
	pub solver_selection: Option<SolverSelection>,
	/// Max solvers to query in 'sampled' mode
	pub sample_size: Option<u64>,
	/// Min solver confidence threshold
	pub priority_threshold: Option<u64>,
}

impl SolverOptions {
	/// Validate solver options to prevent abuse and logical errors
	///
	/// Applied validations:
	/// - **minQuotes**: Must be ≥ 1 (cannot aggregate 0 quotes)
	/// - **sampleSize**: Must be ≥ 1 when using sampled selection
	/// - **priorityThreshold**: Must be 0-100 (percentage range)
	/// - **timeout** (global): Must be within MIN_SOLVER_TIMEOUT_MS to MAX_GLOBAL_TIMEOUT_MS range
	/// - **solverTimeout** (per-solver): Must be within MIN_SOLVER_TIMEOUT_MS to MAX_SOLVER_TIMEOUT_MS range
	/// - **Logical consistency**: Global timeout must be ≥ per-solver timeout
	///
	/// These validations ensure reasonable resource usage and prevent configuration errors
	/// that could lead to poor user experience or system abuse.
	pub fn validate(&self) -> QuoteValidationResult<()> {
		// Validate minQuotes - must be positive
		if let Some(min_quotes) = self.min_quotes {
			if min_quotes == 0 {
				return Err(QuoteValidationError::InvalidSolverOptions {
					field: "minQuotes".to_string(),
					reason: "minQuotes must be at least 1 (cannot aggregate 0 quotes)".to_string(),
				});
			}
		}

		// Validate sampleSize - must be positive when specified
		if let Some(sample_size) = self.sample_size {
			if sample_size == 0 {
				return Err(QuoteValidationError::InvalidSolverOptions {
					field: "sampleSize".to_string(),
					reason: "sampleSize must be at least 1 when using sampled selection"
						.to_string(),
				});
			}
		}

		// Validate priorityThreshold - should be reasonable range (0-100)
		if let Some(threshold) = self.priority_threshold {
			if threshold > MAX_PRIORITY_THRESHOLD {
				return Err(QuoteValidationError::InvalidSolverOptions {
					field: "priorityThreshold".to_string(),
					reason: format!(
						"priorityThreshold must be between 0-{}",
						MAX_PRIORITY_THRESHOLD
					),
				});
			}
		}

		// Validate timeout values
		// Validate global timeout (allow more generous limits for aggregation)
		if let Some(timeout) = self.timeout {
			if timeout < MIN_SOLVER_TIMEOUT_MS {
				return Err(QuoteValidationError::InvalidSolverOptions {
					field: "timeout".to_string(),
					reason: format!(
						"Global timeout {}ms is too low (minimum: {}ms)",
						timeout, MIN_SOLVER_TIMEOUT_MS
					),
				});
			}

			// Allow up to 2 minutes for global timeout (longer than individual solver timeout)
			if timeout > MAX_GLOBAL_TIMEOUT_MS {
				return Err(QuoteValidationError::InvalidSolverOptions {
					field: "timeout".to_string(),
					reason: format!(
						"Global timeout {}ms is too high (maximum: {}ms)",
						timeout, MAX_GLOBAL_TIMEOUT_MS
					),
				});
			}
		}

		// Validate per-solver timeout
		if let Some(solver_timeout) = self.solver_timeout {
			if solver_timeout < MIN_SOLVER_TIMEOUT_MS {
				return Err(QuoteValidationError::InvalidSolverOptions {
					field: "solverTimeout".to_string(),
					reason: format!(
						"Per-solver timeout {}ms is too low (minimum: {}ms)",
						solver_timeout, MIN_SOLVER_TIMEOUT_MS
					),
				});
			}

			if solver_timeout > MAX_SOLVER_TIMEOUT_MS {
				return Err(QuoteValidationError::InvalidSolverOptions {
					field: "solverTimeout".to_string(),
					reason: format!(
						"Per-solver timeout {}ms is too high (maximum: {}ms)",
						solver_timeout, MAX_SOLVER_TIMEOUT_MS
					),
				});
			}
		}

		// Validate logical consistency: global timeout should be >= per-solver timeout
		if let (Some(global), Some(per_solver)) = (self.timeout, self.solver_timeout) {
			if global < per_solver {
				return Err(QuoteValidationError::InvalidSolverOptions {
					field: "timeout".to_string(),
					reason: format!(
						"Global timeout ({}ms) should not be less than per-solver timeout ({}ms)",
						global, per_solver
					),
				});
			}
		}

		Ok(())
	}
}

/// API request body for /api/v1/quotes endpoint
#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(feature = "openapi", derive(ToSchema))]
// Swap 1 USDC on Base Sepolia for USDC on Optimism Sepolia.
//
// This example is the body Swagger UI pre-fills for "Try it out", so it
// has to be a request that actually works. Three things it gets right
// that the previous (upstream) example did not:
//
//   * `user` and `supportedTypes` are present. Both are required and
//     non-optional, so a body without them fails to deserialise before
//     validation even runs.
//   * No `minValidUntil`. This deployment copies that value verbatim
//     into the authorization's absolute `validBefore`, so a relative
//     `600` yields an order that expired in 1970. Omitting it lets the
//     solver set a proper absolute deadline and report it as
//     `validUntil` on the quote.
//   * `permit2` / `oif-escrow-v0` only. Offering `eip3009` lets a
//     solver prefer it, and that open path currently reverts on-chain
//     with `SignatureAndInputsNotEqual`.
//
// Addresses are ERC-7930 interop-encoded (version 0x0001, chainType
// 0x0000 for EIP-155, minimal big-endian chainRef, then the 20 address
// bytes) — plain 0x addresses are rejected. `014a34` is Base Sepolia
// (84532); `aa37dc` is Optimism Sepolia (11155420).
#[cfg_attr(feature = "openapi", schema(example = json!({
    "user": "0x0001000003014a3414632bf0d0d6468908378c3ccfac4e788b115e0e55",
    "intent": {
        "intentType": "oif-swap",
        "inputs": [
            {
                "user": "0x0001000003014a3414632bf0d0d6468908378c3ccfac4e788b115e0e55",
                "asset": "0x0001000003014a341473c83dacc74bb8a704717ac09703b959e74b9705",
                "amount": "1000000"
            }
        ],
        "outputs": [
            {
                "receiver": "0x0001000003aa37dc14632bf0d0d6468908378c3ccfac4e788b115e0e55",
                "asset": "0x0001000003aa37dc14191688b2ff5be8f0a5bcab3e819c900a810faaf6"
            }
        ],
        "swapType": "exact-input",
        "originSubmission": {
            "mode": "user",
            "schemes": ["permit2"]
        }
    },
    "supportedTypes": ["oif-escrow-v0"],
    "solverOptions": {
        "timeout": 8000,
        "solverTimeout": 5000,
        "minQuotes": 1
    }
})))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuoteRequest {
	#[serde(flatten)]
	pub quote_request: OifGetQuoteRequestLatest,
	/// Solver options
	pub solver_options: Option<SolverOptions>,
	/// Optional metadata for custom adapter use
	/// This allows clients to include adapter-specific information in quote requests
	#[serde(skip_serializing_if = "Option::is_none")]
	pub metadata: Option<serde_json::Value>,
}

impl QuoteRequest {
	/// Validate the ERC-7930 quotes request
	///
	/// Applied validations:
	/// - **Required fields**: Must have at least one available input and one requested output
	/// - **User address**: Must be a valid ERC-7930 InteropAddress format
	/// - **Available inputs**:
	///   - User address must be valid InteropAddress
	///   - Asset address must be valid InteropAddress  
	///   - Amount must be > 0
	/// - **Requested outputs**:
	///   - Receiver address must be valid InteropAddress
	///   - Asset address must be valid InteropAddress
	///   - Amount must be > 0
	/// - **Solver options**: Validates all solver option parameters (see SolverOptions::validate)
	///
	/// This ensures the request is well-formed and contains valid addresses, amounts, and configuration
	/// before processing, preventing invalid requests from reaching the solver network.
	pub fn validate(&self) -> QuoteValidationResult<()> {
		// First validate the OIF GetQuoteRequest portion
		self.quote_request
			.validate()
			.map_err(|e| QuoteValidationError::InvalidTokenAddress {
				field: format!("OIF validation failed: {}", e),
			})?;

		// Validate solver options if provided
		if let Some(options) = &self.solver_options {
			options.validate()?;
		}

		Ok(())
	}
}

impl TryFrom<&QuoteRequest> for crate::oif::OifGetQuoteRequest {
	type Error = QuoteValidationError;

	/// Convert from QuoteRequest to OifGetQuoteRequest using proper error handling
	///
	/// This conversion validates the request and extracts the OIF-compliant request
	/// that adapters expect, providing better error handling than cloning.
	fn try_from(request: &QuoteRequest) -> Result<Self, Self::Error> {
		// Validate the request first
		request.validate()?;

		// Wrap the inner v0 request in the version-agnostic wrapper
		Ok(crate::oif::OifGetQuoteRequest::new(
			request.quote_request.clone(),
		))
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::test_utils::{QuoteRequestBuilder, TestQuoteRequests};
	use crate::{InteropAddress, SwapType};

	fn create_valid_erc7930_request() -> QuoteRequest {
		TestQuoteRequests::minimal_valid()
	}

	#[test]
	fn test_erc7930_request_validation() {
		let request = create_valid_erc7930_request();
		assert!(request.validate().is_ok());
	}

	#[test]
	fn test_erc7930_empty_inputs() {
		let request = TestQuoteRequests::empty_inputs();
		assert!(request.validate().is_err());
	}

	#[test]
	fn test_erc7930_empty_outputs() {
		let request = QuoteRequestBuilder::new()
		.add_simple_input(1, "0xA0b86a33E6417a77C9A0C65f8E69b8b6e2b0c4A0", "1000000000")
		.outputs(vec![])
		.swap_type(SwapType::ExactOutput) // Empty outputs
		.build();

		assert!(request.validate().is_err());
	}

	#[test]
	fn test_erc7930_zero_amount() {
		let request = TestQuoteRequests::zero_amount_input();
		assert!(request.validate().is_err());
	}

	#[test]
	fn test_erc7930_address_extraction() {
		let addr = InteropAddress::from_text("eip155:1:0xA0b86a33E6417a77C9A0C65f8E69b8b6e2b0c4A0")
			.unwrap();

		let chain_id = addr.extract_chain_id().unwrap();
		assert_eq!(chain_id, 1);

		let address = addr.extract_address();
		assert_eq!(address, "0xa0b86a33e6417a77c9a0c65f8e69b8b6e2b0c4a0");
	}

	#[test]
	fn test_erc7930_invalid_address_format() {
		// Missing eip155 prefix
		assert!(InteropAddress::from_text("1:0xA0b86a33E6417a77C9A0C65f8E69b8b6e2b0c4A0").is_err());

		// Invalid format
		assert!(InteropAddress::from_text("invalid-address").is_err());
	}
}
