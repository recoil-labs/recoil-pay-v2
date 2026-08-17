/** Intent parser types. See docs/intent-parser-design.md. */

export type IntentAction = 'swap' | 'send';
export type AmountKind = 'token' | 'usd';

/** Output of the grammar parser, before resolution. Raw alias strings as typed. */
export interface RawIntent {
  action: IntentAction;
  amount: string | null; // numeric string, no leading '$'
  amountKind: AmountKind; // "$100" → usd, "100 USDC" → token
  tokenIn: string | null;
  chainIn: string | null;
  tokenOut: string | null; // swap only
  chainOut: string | null; // swap only
  recipient: string | null; // send only
}

export type ParseResult =
  | { ok: true; intents: RawIntent[] }
  | { ok: false; offTemplate: true; message: string };

export type IssueField =
  | 'amount'
  | 'tokenIn'
  | 'chainIn'
  | 'tokenOut'
  | 'chainOut'
  | 'recipient';

export type IssueKind = 'missing' | 'unknown' | 'unsupported';

export interface ValidationIssue {
  field: IssueField;
  kind: IssueKind;
  message: string; // user-facing
}

/** Fully resolved intent ready for the OIF order builder. */
export interface ResolvedIntent {
  action: IntentAction;
  user: string;
  srcChainId: number;
  dstChainId: number;
  inputToken: string;
  inputDecimals: number;
  inputAmount: bigint; // base units
  outputToken: string;
  recipient: string; // = user for swap; the recipient for send
}
