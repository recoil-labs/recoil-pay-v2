//! Natural-language intent parsing.
//!
//! Turns "swap 10 USDC on Base for ETH on Arbitrum" into structured intents
//! by asking an LLM on Hugging Face's inference router. This used to run in
//! the browser, which shipped the Hugging Face token inside the public
//! bundle. Running it here keeps the token server-side, and because the
//! server builds the prompt, callers can only ever get intent extraction
//! out of it — not a general-purpose model on our account.
//!
//! The output is validated before it leaves: whatever the model says, a
//! caller receives either well-formed intents or `Unrecognized`.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{info, warn};
#[cfg(feature = "openapi")]
use utoipa::ToSchema;

const DEFAULT_ROUTER_URL: &str = "https://router.huggingface.co/v1/chat/completions";
const DEFAULT_MODEL: &str = "Qwen/Qwen2.5-Coder-32B-Instruct";
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(20);

/// Longest input accepted, in characters. A real intent is a sentence or
/// two; anything longer is either a mistake or someone using the endpoint
/// as a free LLM.
pub const MAX_INPUT_CHARS: usize = 500;

const SYSTEM_PROMPT: &str = r#"You are an intent extraction engine for a cross-chain swap protocol.
Your job is to parse the user's natural language request into a strict JSON array of objects representing their intents.
If the user specifies multiple intents (e.g. "swap X and then send Y"), return multiple objects in the array.
The JSON objects must perfectly match the following TypeScript interface:

type AmountKind = "token" | "usd";
type IntentAction = "swap" | "send";

interface RawIntent {
  action: IntentAction;
  amount: string | null;          // numeric string, no leading '$'. e.g. "100" (null if not stated)
  amountKind: AmountKind;         // "usd" if they mention dollars/bucks, "token" otherwise
  tokenIn: string | null;         // raw token symbol/alias as typed, e.g. "USDC"
  chainIn: string | null;         // raw chain alias as typed, e.g. "Base"
  tokenOut: string | null;        // target token (optional for send)
  chainOut: string | null;        // target chain (optional for send)
  recipient: string | null;       // address/ens (required for 'send', optional for 'swap')
}

Return ONLY the JSON array, nothing else. If you absolutely cannot determine any intents, return {"error": "unrecognized"}. Do not make up information that is missing; use null."#;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[serde(rename_all = "lowercase")]
pub enum IntentAction {
	Swap,
	Send,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[serde(rename_all = "lowercase")]
pub enum AmountKind {
	Token,
	Usd,
}

/// One intent as the user typed it. Token and chain names are raw aliases
/// ("usdc", "arb"); resolving them to assets and chain ids is the client's
/// job, against the live supported-asset list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "openapi", derive(ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct RawIntent {
	pub action: IntentAction,
	/// Numeric string with no currency sign, e.g. "100". Null when not stated.
	pub amount: Option<String>,
	pub amount_kind: AmountKind,
	pub token_in: Option<String>,
	pub chain_in: Option<String>,
	pub token_out: Option<String>,
	pub chain_out: Option<String>,
	/// Address or ENS name. Required for `send`, optional for `swap`.
	pub recipient: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
	/// The model could not find an intent in the text.
	#[error("no intent recognised")]
	Unrecognized,
	/// Hugging Face failed or returned something unusable.
	#[error("intent model unavailable: {0}")]
	Upstream(String),
}

/// Calls the model. Built once at startup from the environment.
pub struct IntentParser {
	http: reqwest::Client,
	token: String,
	model: String,
	url: String,
}

impl IntentParser {
	/// `HF_ACCESS_TOKEN` enables parsing; without it the endpoint answers
	/// 503. `HF_INTENT_MODEL` and `HF_ROUTER_URL` override the defaults.
	pub fn from_env() -> Option<Self> {
		let token = std::env::var("HF_ACCESS_TOKEN").ok().filter(|t| !t.trim().is_empty());
		let Some(token) = token else {
			warn!("HF_ACCESS_TOKEN not set; POST /api/v1/intents/parse will return 503");
			return None;
		};
		let model = std::env::var("HF_INTENT_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string());
		let url = std::env::var("HF_ROUTER_URL").unwrap_or_else(|_| DEFAULT_ROUTER_URL.to_string());
		let http = match reqwest::Client::builder().timeout(UPSTREAM_TIMEOUT).build() {
			Ok(c) => c,
			Err(e) => {
				warn!(error = %e, "could not build HTTP client for intent parsing");
				return None;
			}
		};
		info!(model = %model, "intent parser configured");
		Some(Self { http, token, model, url })
	}

	pub async fn parse(&self, text: &str) -> Result<Vec<RawIntent>, ParseError> {
		let body = serde_json::json!({
			"model": self.model,
			"messages": [
				{ "role": "system", "content": SYSTEM_PROMPT },
				{ "role": "user", "content": text },
			],
			"max_tokens": 250,
			"temperature": 0.1,
		});

		let res = self
			.http
			.post(&self.url)
			.bearer_auth(&self.token)
			.json(&body)
			.send()
			.await
			.map_err(|e| ParseError::Upstream(e.to_string()))?;

		let status = res.status();
		if !status.is_success() {
			let detail = res.text().await.unwrap_or_default();
			return Err(ParseError::Upstream(format!(
				"{status}: {}",
				detail.chars().take(200).collect::<String>()
			)));
		}

		let completion: ChatCompletion =
			res.json().await.map_err(|e| ParseError::Upstream(e.to_string()))?;
		let content = completion
			.choices
			.into_iter()
			.next()
			.and_then(|c| c.message.content)
			.unwrap_or_default();

		extract_intents(&content)
	}
}

#[derive(Deserialize)]
struct ChatCompletion {
	choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
	message: Message,
}

#[derive(Deserialize)]
struct Message {
	content: Option<String>,
}

/// Pulls the JSON out of a model reply and validates it into intents.
/// Models wrap JSON in code fences or add a sentence around it, so this
/// accepts a fenced block, or else the span from the first `{`/`[` to the
/// last `}`/`]`.
pub fn extract_intents(content: &str) -> Result<Vec<RawIntent>, ParseError> {
	let content = content.trim();
	let json = fenced_block(content).unwrap_or_else(|| bracketed_span(content).unwrap_or(content));
	let parsed: Value = serde_json::from_str(json).map_err(|_| ParseError::Unrecognized)?;

	let items = match parsed {
		Value::Array(items) => items,
		Value::Object(ref obj) if obj.contains_key("error") => return Err(ParseError::Unrecognized),
		obj @ Value::Object(_) => vec![obj],
		_ => return Err(ParseError::Unrecognized),
	};
	if items.is_empty() {
		return Err(ParseError::Unrecognized);
	}

	items.iter().map(to_intent).collect()
}

fn fenced_block(s: &str) -> Option<&str> {
	let start = s.find("```")?;
	let after = &s[start + 3..];
	// Skip an optional language tag (```json) up to the newline.
	let body_start = after.find('\n')? + 1;
	let body = &after[body_start..];
	let end = body.find("```")?;
	Some(body[..end].trim())
}

fn bracketed_span(s: &str) -> Option<&str> {
	let start = s.find(['{', '['])?;
	let end = s.rfind(['}', ']'])?;
	(end >= start).then(|| &s[start..=end])
}

fn to_intent(v: &Value) -> Result<RawIntent, ParseError> {
	let obj = v.as_object().ok_or(ParseError::Unrecognized)?;
	let action = match obj.get("action").and_then(Value::as_str) {
		Some("swap") => IntentAction::Swap,
		Some("send") => IntentAction::Send,
		_ => return Err(ParseError::Unrecognized),
	};
	let text = |key: &str| {
		obj.get(key)
			.and_then(Value::as_str)
			.map(str::trim)
			.filter(|s| !s.is_empty())
			.map(str::to_string)
	};
	let amount = match obj.get("amount") {
		Some(Value::String(s)) if !s.trim().is_empty() => Some(s.trim().to_string()),
		Some(Value::Number(n)) => Some(n.to_string()),
		_ => None,
	};
	let amount_kind = match obj.get("amountKind").and_then(Value::as_str) {
		Some("usd") => AmountKind::Usd,
		_ => AmountKind::Token,
	};
	Ok(RawIntent {
		action,
		amount,
		amount_kind,
		token_in: text("tokenIn"),
		chain_in: text("chainIn"),
		token_out: text("tokenOut"),
		chain_out: text("chainOut"),
		recipient: text("recipient"),
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reads_a_plain_json_array() {
		let out = extract_intents(
			r#"[{"action":"swap","amount":"10","amountKind":"token","tokenIn":"USDC","chainIn":"Base","tokenOut":"ETH","chainOut":"Arbitrum","recipient":null}]"#,
		)
		.unwrap();
		assert_eq!(
			out,
			vec![RawIntent {
				action: IntentAction::Swap,
				amount: Some("10".into()),
				amount_kind: AmountKind::Token,
				token_in: Some("USDC".into()),
				chain_in: Some("Base".into()),
				token_out: Some("ETH".into()),
				chain_out: Some("Arbitrum".into()),
				recipient: None,
			}]
		);
	}

	#[test]
	fn reads_a_fenced_block_with_prose_around_it() {
		let out = extract_intents(
			"Sure! Here you go:\n```json\n[{\"action\":\"send\",\"amount\":5,\"tokenIn\":\"USDC\",\"chainIn\":\"Base\",\"recipient\":\"0xabc\"}]\n```\nLet me know.",
		)
		.unwrap();
		assert_eq!(out[0].action, IntentAction::Send);
		// Numbers are accepted and normalised to strings.
		assert_eq!(out[0].amount.as_deref(), Some("5"));
		assert_eq!(out[0].recipient.as_deref(), Some("0xabc"));
	}

	#[test]
	fn reads_a_bare_object_and_prose_wrapped_json() {
		let out = extract_intents(r#"The intent is {"action":"swap","amount":"100","amountKind":"usd","tokenIn":"ETH"} ok"#).unwrap();
		assert_eq!(out.len(), 1);
		assert_eq!(out[0].amount_kind, AmountKind::Usd);
	}

	#[test]
	fn keeps_multiple_intents_in_order() {
		let out = extract_intents(r#"[{"action":"swap"},{"action":"send","recipient":"vitalik.eth"}]"#).unwrap();
		assert_eq!(out.iter().map(|i| i.action).collect::<Vec<_>>(), vec![IntentAction::Swap, IntentAction::Send]);
	}

	#[test]
	fn blank_strings_become_null() {
		let out = extract_intents(r#"[{"action":"swap","amount":"  ","tokenIn":" ","chainIn":"base "}]"#).unwrap();
		assert_eq!(out[0].amount, None);
		assert_eq!(out[0].token_in, None);
		assert_eq!(out[0].chain_in.as_deref(), Some("base"));
	}

	#[test]
	fn rejects_the_models_error_object_and_garbage() {
		for reply in [
			r#"{"error":"unrecognized"}"#,
			"I can't help with that.",
			"[]",
			r#"[{"action":"bridge"}]"#,
			r#"[{"action":"swap"}, "nope"]"#,
			"",
		] {
			assert!(matches!(extract_intents(reply), Err(ParseError::Unrecognized)), "should reject: {reply:?}");
		}
	}

	#[test]
	fn serialises_with_the_clients_field_names() {
		let json = serde_json::to_value(RawIntent {
			action: IntentAction::Send,
			amount: None,
			amount_kind: AmountKind::Usd,
			token_in: None,
			chain_in: None,
			token_out: None,
			chain_out: None,
			recipient: Some("0xabc".into()),
		})
		.unwrap();
		assert_eq!(json["action"], "send");
		assert_eq!(json["amountKind"], "usd");
		assert!(json.get("tokenIn").is_some(), "nulls are sent, not omitted");
		assert_eq!(json["recipient"], "0xabc");
	}
}
