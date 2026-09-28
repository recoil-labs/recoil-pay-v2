//! Natural-language intent parsing endpoint.
//!
//! Public, like the rest of the swap surface: the intent UI and embedded
//! widgets call it before a user has connected anything. It is the only
//! endpoint here that spends money per call (an LLM request on our Hugging
//! Face account), so it is rate-limited per client IP and input is capped.

use axum::{extract::State, http::HeaderMap, http::StatusCode, response::Json};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tracing::warn;
#[cfg(feature = "openapi")]
use utoipa::ToSchema;

use crate::handlers::common::ErrorResponse;
use crate::intent_parser::{ParseError, RawIntent, MAX_INPUT_CHARS};
use crate::state::AppState;

const PARSE_RATE_LIMIT_PER_MINUTE: u32 = 20;
const PARSE_RATE_BURST: u32 = 5;

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[cfg_attr(feature = "openapi", schema(example = json!({ "text": "swap 10 USDC on Base for ETH on Arbitrum" })))]
pub struct ParseIntentRequest {
	/// What the user typed, in plain English. At most 500 characters.
	pub text: String,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "openapi", derive(ToSchema))]
pub struct ParseIntentResponse {
	/// One entry per intent, in the order the user stated them.
	pub intents: Vec<RawIntent>,
}

type ApiError = (StatusCode, Json<ErrorResponse>);

fn error(status: StatusCode, code: &str, message: impl Into<String>) -> ApiError {
	(
		status,
		Json(ErrorResponse {
			error: code.into(),
			message: message.into(),
			timestamp: Utc::now().timestamp(),
		}),
	)
}

/// First hop of `x-forwarded-for` (Cloud Run's front end always sets it),
/// then `x-real-ip`.
fn client_ip(headers: &HeaderMap) -> String {
	headers
		.get("x-forwarded-for")
		.and_then(|v| v.to_str().ok())
		.and_then(|s| s.split(',').next())
		.map(|s| s.trim().to_string())
		.or_else(|| headers.get("x-real-ip").and_then(|v| v.to_str().ok()).map(str::to_string))
		.unwrap_or_else(|| "unknown".to_string())
}

/// POST /api/v1/intents/parse — turn a plain-English request into
/// structured swap/send intents.
#[cfg_attr(feature = "openapi", utoipa::path(
	post,
	path = "/api/v1/intents/parse",
	tag = "intents",
	request_body = ParseIntentRequest,
	responses(
		(status = 200, description = "Intents found in the text. Token and chain names are the \
		 raw aliases the user typed; resolve them against /api/v1/solvers assets.", body = ParseIntentResponse),
		(status = 400, description = "Empty text, or longer than 500 characters", body = ErrorResponse),
		(status = 422, description = "No swap or send intent could be recognised", body = ErrorResponse),
		(status = 429, description = "Too many requests from this IP", body = ErrorResponse),
		(status = 502, description = "The intent model failed; retry shortly", body = ErrorResponse),
		(status = 503, description = "Intent parsing is not configured on this deployment", body = ErrorResponse),
	)
))]
pub async fn post_parse_intent(
	State(state): State<AppState>,
	headers: HeaderMap,
	Json(payload): Json<ParseIntentRequest>,
) -> Result<Json<ParseIntentResponse>, ApiError> {
	let text = payload.text.trim();
	if text.is_empty() {
		return Err(error(StatusCode::BAD_REQUEST, "EMPTY_INTENT", "text is empty"));
	}
	if text.chars().count() > MAX_INPUT_CHARS {
		return Err(error(
			StatusCode::BAD_REQUEST,
			"INTENT_TOO_LONG",
			format!("text must be at most {MAX_INPUT_CHARS} characters"),
		));
	}

	let Some(parser) = state.intent_parser.as_ref() else {
		return Err(error(
			StatusCode::SERVICE_UNAVAILABLE,
			"INTENT_PARSING_UNAVAILABLE",
			"intent parsing is not configured on this deployment",
		));
	};

	// Checked after the cheap validation so malformed requests don't use
	// up a caller's allowance, but before the paid model call.
	let ip = client_ip(&headers);
	let rate_key = format!("intent-parse:{ip}");
	let limits = oif_types::auth::RateLimits {
		requests_per_minute: PARSE_RATE_LIMIT_PER_MINUTE,
		burst_size: PARSE_RATE_BURST,
		custom_windows: vec![],
	};
	match state.rate_limiter.check_rate_limit(&rate_key, &limits).await {
		Ok(check) if !check.allowed => {
			return Err(error(
				StatusCode::TOO_MANY_REQUESTS,
				"RATE_LIMIT_EXCEEDED",
				format!(
					"too many intent requests from this IP; retry in {}s",
					check.reset_at.signed_duration_since(Utc::now()).num_seconds().max(1)
				),
			));
		}
		Ok(_) => {
			if let Err(e) = state.rate_limiter.record_request(&rate_key).await {
				warn!(error = %e, "intent-parse rate-limit record failed");
			}
		}
		Err(e) => warn!(error = %e, "intent-parse rate-limit check errored; allowing through"),
	}

	match parser.parse(text).await {
		Ok(intents) => Ok(Json(ParseIntentResponse { intents })),
		Err(ParseError::Unrecognized) => Err(error(
			StatusCode::UNPROCESSABLE_ENTITY,
			"UNRECOGNIZED_INTENT",
			"no swap or send intent could be recognised in the text",
		)),
		Err(ParseError::Upstream(detail)) => {
			warn!(detail = %detail, "intent model call failed");
			Err(error(StatusCode::BAD_GATEWAY, "INTENT_MODEL_UNAVAILABLE", "the intent model failed; retry shortly"))
		}
	}
}
