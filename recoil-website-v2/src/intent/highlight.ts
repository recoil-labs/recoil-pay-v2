import { CHAIN_ALIASES, TOKEN_ALIASES } from './registry';

/* ── live entity recognition for the composer ─────────────────────────────
   As the user types, the UI shows what the parser will recognise — amounts,
   token symbols, chain names — using the *same alias tables* the real parse
   resolves against. That is what keeps this honest: it cannot claim to
   understand something the parser would reject, because both read one
   registry.

   This is deliberately not a parse. It finds vocabulary, not structure; the
   grammar (what connects to what) stays the parser's job at submit time. */

export type EntityKind = 'amount' | 'token' | 'chain';

export interface Entity {
  kind: EntityKind;
  /** The text as the user typed it. */
  text: string;
  /** What it resolves to — canonical chain name, or upper-cased symbol. */
  canonical: string;
  start: number;
  end: number;
}

interface Vocab {
  alias: string;
  kind: EntityKind;
  canonical: string;
}

/** Longest alias first, so "base sepolia" wins over "base" and "op sepolia"
 *  over "op" — the same precedence the parser applies. Built once. */
const VOCAB: Vocab[] = [
  ...Object.entries(CHAIN_ALIASES).map(([alias, c]) => ({
    alias,
    kind: 'chain' as const,
    canonical: c.name,
  })),
  ...Object.keys(TOKEN_ALIASES).map(alias => ({
    alias,
    kind: 'token' as const,
    canonical: alias.toUpperCase(),
  })),
].sort((a, b) => b.alias.length - a.alias.length);

const AMOUNT = /(?:\$\s*)?\d+(?:[.,]\d+)?/g;

function overlaps(entities: Entity[], start: number, end: number): boolean {
  return entities.some(e => start < e.end && end > e.start);
}

export function extractEntities(input: string): Entity[] {
  const text = input.toLowerCase();
  const found: Entity[] = [];

  for (const v of VOCAB) {
    let from = 0;
    while (from <= text.length - v.alias.length) {
      const i = text.indexOf(v.alias, from);
      if (i === -1) break;
      const end = i + v.alias.length;
      // Word boundaries by hand: "op" must not light up inside "shopping".
      const before = i === 0 ? ' ' : text[i - 1];
      const after = end >= text.length ? ' ' : text[end];
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after) && !overlaps(found, i, end)) {
        found.push({ kind: v.kind, text: input.slice(i, end), canonical: v.canonical, start: i, end });
      }
      from = end;
    }
  }

  let m: RegExpExecArray | null;
  AMOUNT.lastIndex = 0;
  while ((m = AMOUNT.exec(input)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (!overlaps(found, start, end)) {
      found.push({ kind: 'amount', text: m[0], canonical: m[0], start, end });
    }
  }

  return found.sort((a, b) => a.start - b.start);
}
