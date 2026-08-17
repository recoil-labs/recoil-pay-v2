import { HfInference } from '@huggingface/inference';
import type { AmountKind, ParseResult, RawIntent, IntentAction } from './types';

export const TEMPLATE_HINT =
  'Try: swap <amount> <token> on <chain> for <token> on <chain> [to <address>] (e.g. swap 10 USDC on Base for ETH on Arbitrum to 7aXy...) OR send <amount> <token> on <chain> to <address>';

const hf = new HfInference(import.meta.env.VITE_HF_ACCESS_TOKEN || '');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readAmount(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function readAmountKind(value: unknown): AmountKind {
  return value === 'usd' ? 'usd' : 'token';
}

function readIntentAction(value: unknown): IntentAction | null {
  return value === 'swap' || value === 'send' ? value : null;
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

export async function parseIntent(input: string): Promise<ParseResult> {
  const norm = input.trim();
  if (!norm) return { ok: false, offTemplate: true, message: TEMPLATE_HINT };

  if (!import.meta.env.VITE_HF_ACCESS_TOKEN) {
    console.warn("No VITE_HF_ACCESS_TOKEN provided. NLP parsing unavailable.");
    return { ok: false, offTemplate: true, message: "NLP Parsing unavailable: missing HF token." };
  }

  try {
    const res = await hf.chatCompletion({
      model: "Qwen/Qwen2.5-Coder-32B-Instruct",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: norm }
      ],
      max_tokens: 250,
      temperature: 0.1,
    });

    const content = res.choices[0]?.message?.content?.trim() || "";
    
    // Extract JSON block if it added markdown
    let jsonStr = content;
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    } else {
      // In case it's just raw JSON without code blocks but might have prefix/suffix text
      const firstBrace = Math.min(
        content.indexOf('{') === -1 ? Infinity : content.indexOf('{'),
        content.indexOf('[') === -1 ? Infinity : content.indexOf('[')
      );
      const lastBrace = Math.max(content.lastIndexOf('}'), content.lastIndexOf(']'));
      if (firstBrace !== Infinity && lastBrace !== -1) {
        jsonStr = content.slice(firstBrace, lastBrace + 1);
      }
    }

    const parsed: unknown = JSON.parse(jsonStr);

    if ((isRecord(parsed) && parsed.error) || (!Array.isArray(parsed) && !isRecord(parsed))) {
      return { ok: false, offTemplate: true, message: TEMPLATE_HINT };
    }

    const intentArray = Array.isArray(parsed) ? parsed : [parsed];
    
    if (intentArray.length === 0 || !intentArray.every(isRecord)) {
      return { ok: false, offTemplate: true, message: TEMPLATE_HINT };
    }

    const intents: RawIntent[] = [];
    for (const candidate of intentArray) {
      const action = readIntentAction(candidate.action);
      if (!action) return { ok: false, offTemplate: true, message: TEMPLATE_HINT };

      intents.push({
        action,
        amount: readAmount(candidate.amount),
        amountKind: readAmountKind(candidate.amountKind),
        tokenIn: readStringOrNull(candidate.tokenIn),
        chainIn: readStringOrNull(candidate.chainIn),
        tokenOut: readStringOrNull(candidate.tokenOut),
        chainOut: readStringOrNull(candidate.chainOut),
        recipient: readStringOrNull(candidate.recipient),
      });
    }

    return { ok: true, intents };
  } catch (error) {
    console.error("NLP parsing error:", error);
    return { ok: false, offTemplate: true, message: "Failed to understand intent via NLP. " + TEMPLATE_HINT };
  }
}
