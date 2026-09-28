import { createHash, randomBytes } from 'node:crypto';
import {
  ADDRESS_PATTERN,
  MAX_TAGS_PER_WALLET,
  ROUTE_KEYS,
  SIGNATURE_MAX_AGE_MS,
  isReservedTag,
  manageMessage,
  normalizeTag,
  reservationMessage,
  suggestionCandidates,
  validateTag,
} from '../../shared/tag.ts';
import type { Db, Queryable } from './db.ts';

export type Verifier = (p: { address: `0x${string}`; message: string; signature: `0x${string}`; chainId: number }) => Promise<boolean>;

export class RegistryError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Availability =
  | { status: 'available'; tag: string }
  | { status: 'invalid'; tag: string; reason: string }
  | { status: 'taken'; tag: string; reserved: boolean; suggestions: string[] };

export interface SignedRequest {
  tag: string;
  address: string;
  chainId: number;
  issuedAt: string;
  origin: string;
  signature: string;
}

const EDIT_TOKEN_TTL_MS = 60 * 60 * 1000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function createRegistry(db: Db, verify: Verifier, opts: { allowedOrigins: string[]; now?: () => number }) {
  const now = opts.now ?? Date.now;

  async function isTaken(q: Queryable, tag: string): Promise<boolean> {
    const { rows } = await q.query('SELECT 1 FROM tags WHERE lower(tag) = lower($1)', [tag]);
    return rows.length > 0;
  }

  async function suggestions(tag: string): Promise<string[]> {
    const candidates = suggestionCandidates(tag);
    if (candidates.length === 0) return [];
    const { rows } = await db.query<{ tag: string }>('SELECT lower(tag) AS tag FROM tags WHERE lower(tag) = ANY($1)', [candidates]);
    const taken = new Set(rows.map((r) => r.tag));
    return candidates.filter((c) => !taken.has(c)).slice(0, 3);
  }

  /** Validates the shape and freshness of a signed request, then the signature itself. */
  async function checkSignature(req: SignedRequest, build: typeof reservationMessage): Promise<{ tag: string; owner: string; message: string }> {
    const tag = normalizeTag(req.tag);
    const v = validateTag(tag);
    if (!v.ok) throw new RegistryError(400, 'invalid_tag', v.reason);
    if (!ADDRESS_PATTERN.test(req.address)) throw new RegistryError(400, 'invalid_address', 'Not a wallet address');
    if (!Number.isInteger(req.chainId) || req.chainId <= 0) throw new RegistryError(400, 'invalid_chain', 'Unknown chain');
    if (!opts.allowedOrigins.includes(req.origin)) throw new RegistryError(400, 'invalid_origin', 'Signed for a different site');
    if (!/^0x[0-9a-fA-F]+$/.test(req.signature)) throw new RegistryError(400, 'invalid_signature', 'Malformed signature');

    const issued = Date.parse(req.issuedAt);
    if (Number.isNaN(issued) || new Date(issued).toISOString() !== req.issuedAt) {
      throw new RegistryError(400, 'invalid_issued_at', 'Malformed timestamp');
    }
    const age = now() - issued;
    // A minute of allowance for a wallet clock that runs ahead of ours.
    if (age > SIGNATURE_MAX_AGE_MS || age < -60_000) {
      throw new RegistryError(401, 'signature_expired', 'That signature has expired — sign again');
    }

    const message = build({ tag, address: req.address, chainId: req.chainId, issuedAt: req.issuedAt, origin: req.origin });
    const ok = await verify({
      address: req.address as `0x${string}`,
      message,
      signature: req.signature as `0x${string}`,
      chainId: req.chainId,
    }).catch(() => false);
    if (!ok) throw new RegistryError(401, 'bad_signature', 'The signature does not match this wallet');

    return { tag, owner: req.address.toLowerCase(), message };
  }

  async function issueEditToken(q: Queryable, tagId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await q.query('DELETE FROM edit_tokens WHERE expires_at < now()');
    await q.query('INSERT INTO edit_tokens (token_hash, tag_id, expires_at) VALUES ($1, $2, $3)', [
      sha256(token),
      tagId,
      new Date(now() + EDIT_TOKEN_TTL_MS).toISOString(),
    ]);
    return token;
  }

  return {
    async availability(input: string): Promise<Availability> {
      const tag = normalizeTag(input);
      const v = validateTag(tag);
      if (!v.ok) return { status: 'invalid', tag, reason: v.reason };
      if (isReservedTag(tag)) return { status: 'taken', tag, reserved: true, suggestions: await suggestions(tag) };
      if (await isTaken(db, tag)) return { status: 'taken', tag, reserved: false, suggestions: await suggestions(tag) };
      return { status: 'available', tag };
    },

    async reserve(req: SignedRequest): Promise<{ tag: string; editToken: string }> {
      const { tag, owner, message } = await checkSignature(req, reservationMessage);
      if (isReservedTag(tag)) throw new RegistryError(409, 'reserved', `@${tag} is held by RecoilPay`);

      try {
        return await db.tx(async (q) => {
          // Serialise claims per wallet so the limit can't be raced past
          // with parallel requests.
          await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [owner]);
          const { rows } = await q.query<{ n: number }>('SELECT count(*)::int AS n FROM tags WHERE owner = $1', [owner]);
          if (rows[0].n >= MAX_TAGS_PER_WALLET) {
            throw new RegistryError(403, 'wallet_limit', `Each wallet can reserve up to ${MAX_TAGS_PER_WALLET} tags`);
          }
          const inserted = await q.query<{ id: string }>(
            'INSERT INTO tags (tag, owner, chain_id, message, signature) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [tag, owner, req.chainId, message, req.signature],
          );
          const id = inserted.rows[0].id;
          await q.query('INSERT INTO tag_routes (tag_id, route, address) VALUES ($1, $2, $3)', [id, '*', owner]);
          return { tag, editToken: await issueEditToken(q, id) };
        });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new RegistryError(409, 'taken', `@${tag} was just taken`);
        throw err;
      }
    },

    /** A fresh signature from the owner trades for an edit token. */
    async manage(req: SignedRequest): Promise<{ tag: string; editToken: string; routes: Record<string, string>; showAddresses: boolean }> {
      const { tag, owner } = await checkSignature(req, manageMessage);
      const { rows } = await db.query<{ id: string; owner: string; show_addresses: boolean }>(
        'SELECT id, owner, show_addresses FROM tags WHERE lower(tag) = $1',
        [tag],
      );
      if (rows.length === 0) throw new RegistryError(404, 'not_found', `@${tag} is not reserved`);
      if (rows[0].owner !== owner) throw new RegistryError(403, 'not_owner', 'This wallet does not own that tag');
      const routes = await db.query<{ route: string; address: string }>('SELECT route, address FROM tag_routes WHERE tag_id = $1', [rows[0].id]);
      return {
        tag,
        editToken: await issueEditToken(db, rows[0].id),
        routes: Object.fromEntries(routes.rows.map((r) => [r.route, r.address])),
        showAddresses: rows[0].show_addresses,
      };
    },

    async setRoutes(input: string, token: string, body: { routes: Record<string, string>; showAddresses: boolean }): Promise<void> {
      const tag = normalizeTag(input);
      const entries = Object.entries(body.routes ?? {});
      if (!entries.some(([k]) => k === '*')) throw new RegistryError(400, 'missing_default', 'A default address is required');
      for (const [key, address] of entries) {
        if (!ROUTE_KEYS.has(key)) throw new RegistryError(400, 'invalid_route', `Unknown route ${key}`);
        if (!ADDRESS_PATTERN.test(address)) throw new RegistryError(400, 'invalid_address', `Not a wallet address: ${address}`);
      }

      await db.tx(async (q) => {
        const { rows } = await q.query<{ tag_id: string }>(
          `SELECT e.tag_id FROM edit_tokens e JOIN tags t ON t.id = e.tag_id
            WHERE e.token_hash = $1 AND e.expires_at > $2 AND lower(t.tag) = $3`,
          [sha256(token), new Date(now()).toISOString(), tag],
        );
        if (rows.length === 0) throw new RegistryError(401, 'bad_token', 'Session expired — sign again to edit');
        const id = rows[0].tag_id;
        await q.query('DELETE FROM tag_routes WHERE tag_id = $1', [id]);
        for (const [key, address] of entries) {
          await q.query('INSERT INTO tag_routes (tag_id, route, address) VALUES ($1, $2, $3)', [id, key, address.toLowerCase()]);
        }
        await q.query('UPDATE tags SET show_addresses = $2, updated_at = now() WHERE id = $1', [id, Boolean(body.showAddresses)]);
      });
    },

    async get(input: string) {
      const tag = normalizeTag(input);
      const { rows } = await db.query<{ id: string; tag: string; owner: string; show_addresses: boolean; created_at: Date | string }>(
        'SELECT id, tag, owner, show_addresses, created_at FROM tags WHERE lower(tag) = $1',
        [tag],
      );
      if (rows.length === 0) return null;
      const row = rows[0];
      const routes = row.show_addresses
        ? Object.fromEntries(
            (await db.query<{ route: string; address: string }>('SELECT route, address FROM tag_routes WHERE tag_id = $1', [row.id])).rows.map(
              (r) => [r.route, r.address],
            ),
          )
        : null;
      return {
        tag: row.tag,
        owner: row.owner,
        reservedAt: new Date(row.created_at).toISOString(),
        routes,
      };
    },

    async count(): Promise<number> {
      const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM tags');
      return rows[0].n;
    },
  };
}

export type Registry = ReturnType<typeof createRegistry>;
