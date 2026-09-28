import { OIF_API_BASE_URL } from '../oif/client';
import type { ParseResult, RawIntent } from './types';

export const TEMPLATE_HINT =
  'Try: swap <amount> <token> on <chain> for <token> on <chain> [to <address>] (e.g. swap 10 USDC on Base for ETH on Arbitrum to 7aXy...) OR send <amount> <token> on <chain> to <address>';

/** Matches the aggregator's cap; longer text is rejected there with a 400. */
const MAX_INPUT_CHARS = 500;

/**
 * Natural-language parsing runs on the aggregator
 * (`POST /api/v1/intents/parse`). It used to call Hugging Face from here,
 * which put the access token in the public bundle; the aggregator now holds
 * the token, builds the prompt, and returns validated intents.
 */
export async function parseIntent(input: string): Promise<ParseResult> {
  const norm = input.trim();
  if (!norm) return { ok: false, offTemplate: true, message: TEMPLATE_HINT };
  if (norm.length > MAX_INPUT_CHARS) {
    return { ok: false, offTemplate: true, message: `Keep it under ${MAX_INPUT_CHARS} characters. ${TEMPLATE_HINT}` };
  }

  let res: Response;
  try {
    res = await fetch(`${OIF_API_BASE_URL}/api/v1/intents/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ text: norm }),
    });
  } catch (error) {
    console.error('Intent parsing request failed:', error);
    return { ok: false, offTemplate: true, message: 'Could not reach the intent parser. Check your connection and try again.' };
  }

  if (res.ok) {
    const body = (await res.json().catch(() => null)) as { intents?: RawIntent[] } | null;
    if (body?.intents?.length) return { ok: true, intents: body.intents };
    return { ok: false, offTemplate: true, message: TEMPLATE_HINT };
  }

  switch (res.status) {
    case 422: // nothing recognisable in the text
    case 400:
      return { ok: false, offTemplate: true, message: TEMPLATE_HINT };
    case 429:
      return { ok: false, offTemplate: true, message: 'Too many requests — wait a moment and try again.' };
    case 503:
      return { ok: false, offTemplate: true, message: 'Natural-language parsing is unavailable right now. ' + TEMPLATE_HINT };
    default:
      console.error('Intent parsing failed:', res.status, await res.text().catch(() => ''));
      return { ok: false, offTemplate: true, message: 'Failed to understand intent via NLP. ' + TEMPLATE_HINT };
  }
}
