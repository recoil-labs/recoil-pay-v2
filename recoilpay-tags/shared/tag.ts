/**
 * Tag rules, shared by the page and the API so the two can never disagree
 * about what a valid tag is. The database enforces the same shape with a
 * CHECK constraint; this module only exists to give people a readable reason.
 */

export const TAG_MIN = 3;
export const TAG_MAX = 20;
export const TAG_PATTERN = /^[a-z0-9_]{3,20}$/;
export const TAG_RULE = `${TAG_MIN}–${TAG_MAX} characters, letters, numbers and underscore`;

/** Tags a single wallet may hold. Enforced in the API inside the insert transaction. */
export const MAX_TAGS_PER_WALLET = 3;

/** Strip a leading @ and lowercase. Never rejects — validation is separate. */
export function normalizeTag(input: string): string {
  return input.trim().replace(/^@+/, '').toLowerCase();
}

export type TagValidity = { ok: true } | { ok: false; reason: string };

export function validateTag(tag: string): TagValidity {
  if (tag.length === 0) return { ok: false, reason: TAG_RULE };
  if (/[^a-z0-9_]/.test(tag)) return { ok: false, reason: `Only ${TAG_RULE.split(', ').slice(1).join(', ')}` };
  if (tag.length < TAG_MIN) return { ok: false, reason: `At least ${TAG_MIN} characters` };
  if (tag.length > TAG_MAX) return { ok: false, reason: `At most ${TAG_MAX} characters` };
  return { ok: true };
}

/**
 * Names held back from public reservation: our own, obvious brands and
 * tickers, and words that would read as official. The spec asks for an honest
 * scarcity signal — these show as "held by RecoilPay", never as someone's.
 */
export const RESERVED_TAGS: ReadonlySet<string> = new Set([
  // RecoilPay and system words
  'recoil', 'recoilpay', 'recoil_pay', 'linkiswap', 'admin', 'administrator', 'root', 'system',
  'support', 'help', 'helpdesk', 'official', 'team', 'staff', 'security', 'verify', 'verified',
  'api', 'www', 'app', 'tags', 'tag', 'claim', 'reserve', 'send', 'pay', 'wallet', 'solver',
  'null', 'undefined', 'anonymous', 'everyone', 'here', 'mod', 'moderator', 'test',
  // Chains and tickers
  'ethereum', 'eth', 'bitcoin', 'btc', 'usdc', 'usdt', 'dai', 'weth', 'wbtc', 'sol', 'solana',
  'base', 'arbitrum', 'arb', 'optimism', 'op', 'polygon', 'matic', 'pol', 'avalanche', 'avax',
  'bnb', 'bsc', 'tron', 'trx', 'linea', 'scroll', 'zksync', 'starknet', 'blast',
  // Obvious brands
  'coinbase', 'binance', 'kraken', 'okx', 'bybit', 'metamask', 'rainbow', 'phantom', 'ledger',
  'trezor', 'uniswap', 'opensea', 'circle', 'tether', 'ens', 'chainlink', 'aave', 'lido',
  'across', 'stripe', 'paypal', 'visa', 'mastercard', 'google', 'apple', 'x', 'twitter',
  'vitalik', 'satoshi',
]);

export function isReservedTag(tag: string): boolean {
  return RESERVED_TAGS.has(tag);
}

/** Candidate alternatives offered when a tag is taken, in preference order. */
export function suggestionCandidates(tag: string): string[] {
  const base = tag.slice(0, TAG_MAX - 3);
  return [`${base}2`, `${base}_`, `${base}pay`, `${base}_x`, `${base}3`, `the${base}`, `${base}hq`]
    .filter((c) => c !== tag && TAG_PATTERN.test(c) && !isReservedTag(c));
}

/**
 * The exact text a wallet signs. The API rebuilds it from the submitted
 * fields and compares byte-for-byte, so the page can't slip in a different
 * promise than the one the server verifies.
 */
export function reservationMessage(p: { tag: string; address: string; chainId: number; issuedAt: string; origin: string }): string {
  return [
    `RecoilPay Tags`,
    ``,
    `Reserve @${p.tag} for this wallet.`,
    ``,
    `This is a signature, not a transaction. It is free and costs no gas.`,
    `Reservations do not expire.`,
    ``,
    `Tag: @${p.tag}`,
    `Wallet: ${p.address}`,
    `Chain ID: ${p.chainId}`,
    `Issued: ${p.issuedAt}`,
    `URI: ${p.origin}`,
  ].join('\n');
}

/** Signed to prove ownership when returning later to change mapped addresses. */
export function manageMessage(p: { tag: string; address: string; chainId: number; issuedAt: string; origin: string }): string {
  return [
    `RecoilPay Tags`,
    ``,
    `Manage the addresses for @${p.tag}.`,
    ``,
    `This is a signature, not a transaction. It is free and costs no gas.`,
    ``,
    `Tag: @${p.tag}`,
    `Wallet: ${p.address}`,
    `Chain ID: ${p.chainId}`,
    `Issued: ${p.issuedAt}`,
    `URI: ${p.origin}`,
  ].join('\n');
}

/** How long a signed message stays acceptable after it was issued. */
export const SIGNATURE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Token routes a tag can carry. `*` is the default address that every route
 * without its own entry falls back to — one address is a complete tag.
 */
export const ROUTES = [
  { key: 'eth:1', token: 'ETH', chain: 'Ethereum', chainId: 1 },
  { key: 'eth:8453', token: 'ETH', chain: 'Base', chainId: 8453 },
  { key: 'usdc:1', token: 'USDC', chain: 'Ethereum', chainId: 1 },
  { key: 'usdc:8453', token: 'USDC', chain: 'Base', chainId: 8453 },
  { key: 'usdc:42161', token: 'USDC', chain: 'Arbitrum', chainId: 42161 },
  { key: 'usdc:137', token: 'USDC', chain: 'Polygon', chainId: 137 },
] as const;

export type RouteKey = (typeof ROUTES)[number]['key'] | '*';
export const ROUTE_KEYS: ReadonlySet<string> = new Set(['*', ...ROUTES.map((r) => r.key)]);

export const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function truncateAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
