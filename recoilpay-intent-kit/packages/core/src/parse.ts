import type { AmountKind, IntentAction, ParseResult, RawIntent } from './intent/types';

export const TEMPLATE_HINT =
  'Try: swap <amount> <token> on <chain> for <token> on <chain> [to <address>] (e.g. swap 10 USDC on Base for ETH on Arbitrum) OR send <amount> <token> on <chain> to <address>';

/** Hugging Face's OpenAI-compatible router: the endpoint @huggingface/inference's chatCompletion uses. */
export const HF_ROUTER_URL = 'https://router.huggingface.co/v1/chat/completions';
export const DEFAULT_INTENT_MODEL = 'Qwen/Qwen2.5-Coder-32B-Instruct';

export interface ParserOptions {
  /**
   * Your Hugging Face access token. Parsing runs in the browser, so this
   * token is visible to anyone who loads your page: use a dedicated,
   * inference-only token you can rotate. Without one, parsing is off.
   */
  hfAccessToken?: string | null;
  /** Model on the Hugging Face router. */
  model?: string;
  fetch?: typeof fetch;
}

const SYSTEM_PROMPT = `You are an intent extraction engine for a cross-chain swap protocol.
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

Return ONLY the JSON array, nothing else. If you absolutely cannot determine any intents, return {"error": "unrecognized"}. Do not make up information that is missing; use null.`;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const readString = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v : null);
const readAmount = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const readAmountKind = (v: unknown): AmountKind => (v === 'usd' ? 'usd' : 'token');
const readAction = (v: unknown): IntentAction | null => (v === 'swap' || v === 'send' ? v : null);

const offTemplate = (message = TEMPLATE_HINT): ParseResult => ({ ok: false, offTemplate: true, message });

/**
 * Pulls intents out of a model reply. Models wrap JSON in code fences or add
 * a sentence around it, so this takes a fenced block, or else the span from
 * the first `{`/`[` to the last `}`/`]`.
 */
export function extractIntents(content: string): ParseResult {
  let json = content.trim();
  const fenced = json.match(/```json\n([\s\S]*?)\n```/) || json.match(/```\n([\s\S]*?)\n```/);
  if (fenced) {
    json = fenced[1];
  } else {
    const first = Math.min(...['{', '['].map((c) => (json.indexOf(c) === -1 ? Infinity : json.indexOf(c))));
    const last = Math.max(json.lastIndexOf('}'), json.lastIndexOf(']'));
    if (first !== Infinity && last !== -1) json = json.slice(first, last + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return offTemplate();
  }
  if ((isRecord(parsed) && parsed.error) || (!Array.isArray(parsed) && !isRecord(parsed))) return offTemplate();

  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (items.length === 0 || !items.every(isRecord)) return offTemplate();

  const intents: RawIntent[] = [];
  for (const item of items) {
    const action = readAction(item.action);
    if (!action) return offTemplate();
    intents.push({
      action,
      amount: readAmount(item.amount),
      amountKind: readAmountKind(item.amountKind),
      tokenIn: readString(item.tokenIn),
      chainIn: readString(item.chainIn),
      tokenOut: readString(item.tokenOut),
      chainOut: readString(item.chainOut),
      recipient: readString(item.recipient),
    });
  }
  return { ok: true, intents };
}

/**
 * Plain English → intents, by asking a model on Hugging Face from the
 * browser. Never throws: every failure is `{ ok: false, message }` with text
 * that can be shown to the user as-is.
 */
export async function parseIntent(text: string, options: ParserOptions = {}): Promise<ParseResult> {
  const norm = text.trim();
  if (!norm) return offTemplate();
  const token = options.hfAccessToken?.trim();
  if (!token) return offTemplate(`Natural-language parsing isn't set up here. ${TEMPLATE_HINT}`);

  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let res: Response;
  try {
    res = await doFetch(HF_ROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model ?? DEFAULT_INTENT_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: norm },
        ],
        max_tokens: 250,
        temperature: 0.1,
      }),
    });
  } catch {
    return offTemplate(`Could not reach the intent parser. Check your connection and try again.`);
  }

  if (!res.ok) {
    if (res.status === 429) return offTemplate('Too many requests — wait a moment and try again.');
    return offTemplate(`Failed to understand that. ${TEMPLATE_HINT}`);
  }
  const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  return extractIntents(body?.choices?.[0]?.message?.content ?? '');
}
