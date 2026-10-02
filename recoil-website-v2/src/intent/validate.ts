import type { RawIntent, ValidationIssue, IssueField } from './types';
import {
  normalizeToken,
  normalizeChain,
  findAsset,
  type CanonicalChain,
  type SupportedSet,
} from './registry';

const LABEL: Record<IssueField, string> = {
  amount: 'Amount',
  tokenIn: 'Source token',
  chainIn: 'Source chain',
  tokenOut: 'Destination token',
  chainOut: 'Destination chain',
  recipient: 'Recipient',
};

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function checkChain(
  field: IssueField,
  raw: string | null,
  supported: SupportedSet,
  issues: ValidationIssue[],
): CanonicalChain | null {
  if (!raw) {
    issues.push({ field, kind: 'missing', message: `${LABEL[field]} is not stated.` });
    return null;
  }
  const c = normalizeChain(raw);
  if (!c) {
    issues.push({ field, kind: 'unknown', message: `Chain '${raw}' isn't recognized.` });
    return null;
  }
  if (typeof c.id !== 'number' || !supported.chains.has(c.id)) {
    issues.push({ field, kind: 'unsupported', message: `${c.name} isn't supported yet.` });
    return null;
  }
  return c;
}

function checkToken(
  field: IssueField,
  raw: string | null,
  chain: CanonicalChain | null,
  supported: SupportedSet,
  issues: ValidationIssue[],
): void {
  if (!raw) {
    issues.push({ field, kind: 'missing', message: `${LABEL[field]} is not stated.` });
    return;
  }
  const sym = normalizeToken(raw);
  if (!sym) {
    issues.push({ field, kind: 'unknown', message: `Token '${raw}' isn't recognized.` });
    return;
  }
  // Only assert support once the chain resolved to a supported EVM chain.
  if (chain && typeof chain.id === 'number') {
    if (!findAsset(supported, chain.id, sym)) {
      issues.push({
        field,
        kind: 'unsupported',
        message: `${sym} isn't supported on ${chain.name} yet.`,
      });
    }
  }
}

function checkRecipient(raw: string | null, chainOutId: number | undefined, issues: ValidationIssue[]): void {
  if (!raw) {
    issues.push({ field: 'recipient', kind: 'missing', message: 'Recipient is not stated.' });
    return;
  }
  // Check if chainOut is a Solana virtual chain (9000000001 or 9000000002)
  if (chainOutId === 9000000001 || chainOutId === 9000000002) {
    if (SOLANA_ADDRESS_RE.test(raw)) return;
    issues.push({
      field: 'recipient',
      kind: 'unknown',
      message: `Recipient '${raw}' isn’t a valid Solana address.`,
    });
    return;
  }

  // Fallback to EVM for all other chains for now
  if (EVM_ADDRESS_RE.test(raw)) return;
  if (raw.endsWith('.eth')) {
    issues.push({
      field: 'recipient',
      kind: 'unsupported',
      message: 'ENS recipients aren’t supported yet — use a 0x address.',
    });
    return;
  }
  issues.push({
    field: 'recipient',
    kind: 'unknown',
    message: `Recipient '${raw}' isn’t a valid 0x address.`,
  });
}

/**
 * Validate a parsed intent against the live support set. Collects EVERY problem
 * (missing / unknown / unsupported) so the user can fix them in one edit.
 * Empty array = ready to resolve.
 */
export function validateIntent(raw: RawIntent, supported: SupportedSet): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Amount
  if (!raw.amount) {
    issues.push({ field: 'amount', kind: 'missing', message: 'Amount is not stated.' });
  } else if (!(Number(raw.amount) > 0)) {
    issues.push({ field: 'amount', kind: 'unknown', message: 'Amount must be a positive number.' });
  }

  // Source side
  const chainIn = checkChain('chainIn', raw.chainIn, supported, issues);
  checkToken('tokenIn', raw.tokenIn, chainIn, supported, issues);

  if (raw.action === 'swap') {
    const chainOut = checkChain('chainOut', raw.chainOut, supported, issues);
    checkToken('tokenOut', raw.tokenOut, chainOut, supported, issues);
    if (raw.recipient) {
      checkRecipient(raw.recipient, chainOut?.id, issues);
    }
  } else {
    let chainOut: CanonicalChain | null = chainIn;
    if (raw.chainOut) {
      chainOut = checkChain('chainOut', raw.chainOut, supported, issues);
    }
    checkRecipient(raw.recipient, chainOut?.id, issues);

    if (raw.tokenOut) {
      checkToken('tokenOut', raw.tokenOut, chainOut, supported, issues);
    } else if (chainOut && chainOut.id !== chainIn?.id) {
      // If sending to another chain but no token specified, ensure the source token exists on destination chain
      checkToken('tokenOut', raw.tokenIn, chainOut, supported, issues);
    }
  }

  return issues;
}
