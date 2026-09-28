import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { verifyMessage } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { manageMessage, normalizeTag, reservationMessage } from '../../shared/tag.ts';
import { createApp } from '../src/app.ts';
import { createPgliteDb, migrate, type Db } from '../src/db.ts';
import { createRegistry } from '../src/registry.ts';

const ORIGIN = 'https://tags.recoilpay.com';
let db: Db;
let app: ReturnType<typeof createApp>;

// Real signatures from throwaway keys, checked by viem's local EOA verifier —
// the same code path production uses before it would fall back on-chain.
const verify = ({ address, message, signature }: { address: `0x${string}`; message: string; signature: `0x${string}` }) =>
  verifyMessage({ address, message, signature });

const wallet = () => privateKeyToAccount(generatePrivateKey());

async function signed(account: ReturnType<typeof wallet>, tag: string, opts: { issuedAt?: string; origin?: string; manage?: boolean } = {}) {
  const body = { tag, address: account.address, chainId: 8453, issuedAt: opts.issuedAt ?? new Date().toISOString(), origin: opts.origin ?? ORIGIN };
  // Like the page: the message carries the normalised tag, the body may not.
  const message = (opts.manage ? manageMessage : reservationMessage)({ ...body, tag: normalizeTag(tag) });
  return { ...body, signature: await account.signMessage({ message }) };
}

const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  db = await createPgliteDb();
  await migrate(db);
  app = createApp({ registry: createRegistry(db, verify, { allowedOrigins: [ORIGIN] }), publicOrigin: ORIGIN, corsOrigins: [], rateLimits: false });
});
beforeEach(async () => {
  await db.query('TRUNCATE tags RESTART IDENTITY CASCADE');
});
after(() => db.close());

describe('availability', () => {
  it('reports a free tag as available, normalising case and @', async () => {
    const res = await app.request('/api/availability/@Tolu');
    assert.deepEqual(await res.json(), { status: 'available', tag: 'tolu' });
  });

  it('states the rule for an invalid tag', async () => {
    const body = await (await app.request('/api/availability/ab')).json();
    assert.equal(body.status, 'invalid');
    assert.match(body.reason, /3/);
  });

  it('holds back reserved brand names', async () => {
    const body = await (await app.request('/api/availability/coinbase')).json();
    assert.equal(body.status, 'taken');
    assert.equal(body.reserved, true);
  });

  it('offers three free alternatives when taken, skipping ones that are also taken', async () => {
    const a = wallet();
    await post('/api/reservations', await signed(a, 'tolu'));
    await post('/api/reservations', await signed(a, 'tolu2'));
    const body = await (await app.request('/api/availability/TOLU')).json();
    assert.equal(body.status, 'taken');
    assert.equal(body.reserved, false);
    assert.deepEqual(body.suggestions, ['tolu_', 'tolupay', 'tolu_x']);
  });
});

describe('reservations', () => {
  it('reserves with a valid signature and maps the wallet as the default address', async () => {
    const a = wallet();
    const res = await post('/api/reservations', await signed(a, 'jasonobb'));
    assert.equal(res.status, 201);
    const { tag, editToken } = await res.json();
    assert.equal(tag, 'jasonobb');
    assert.ok(editToken.length > 30);

    const { rows } = await db.query<{ route: string; address: string }>('SELECT route, address FROM tag_routes');
    assert.deepEqual(rows, [{ route: '*', address: a.address.toLowerCase() }]);
  });

  it('rejects a signature from a different wallet', async () => {
    const body = await signed(wallet(), 'jasonobb');
    const res = await post('/api/reservations', { ...body, address: wallet().address });
    assert.equal(res.status, 401);
  });

  it('rejects a signature over a different tag', async () => {
    const body = await signed(wallet(), 'jasonobb');
    const res = await post('/api/reservations', { ...body, tag: 'someoneelse' });
    assert.equal(res.status, 401);
  });

  it('rejects a stale signature', async () => {
    const res = await post('/api/reservations', await signed(wallet(), 'jasonobb', { issuedAt: new Date(Date.now() - 11 * 60_000).toISOString() }));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'signature_expired');
  });

  it('rejects a message signed for another origin', async () => {
    const res = await post('/api/reservations', await signed(wallet(), 'jasonobb', { origin: 'https://evil.example' }));
    assert.equal(res.status, 400);
  });

  it('refuses reserved names even with a valid signature', async () => {
    const res = await post('/api/reservations', await signed(wallet(), 'recoilpay'));
    assert.equal(res.status, 409);
  });

  it('refuses a case variant of a taken tag', async () => {
    await post('/api/reservations', await signed(wallet(), 'jasonobb'));
    const res = await post('/api/reservations', await signed(wallet(), 'JasonObb'));
    assert.equal(res.status, 409);
  });

  it('lets exactly one of two simultaneous claims win', async () => {
    const [x, y] = await Promise.all([signed(wallet(), 'race'), signed(wallet(), 'race')]);
    const statuses = (await Promise.all([post('/api/reservations', x), post('/api/reservations', y)])).map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409]);
  });

  it('enforces the database uniqueness even if the API check were skipped', async () => {
    await db.query("INSERT INTO tags (tag, owner, chain_id, message, signature) VALUES ('dup', '0x0000000000000000000000000000000000000001', 1, '', '0x')");
    await assert.rejects(
      db.query("INSERT INTO tags (tag, owner, chain_id, message, signature) VALUES ('dup', '0x0000000000000000000000000000000000000002', 1, '', '0x')"),
      /duplicate key/,
    );
  });

  it('caps tags per wallet at three', async () => {
    const a = wallet();
    for (const t of ['one_', 'two_', 'three_']) assert.equal((await post('/api/reservations', await signed(a, t))).status, 201);
    const res = await post('/api/reservations', await signed(a, 'four_'));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'wallet_limit');
  });
});

describe('routes and the public tag', () => {
  it('keeps addresses private until the owner opts in', async () => {
    const a = wallet();
    const { editToken } = await (await post('/api/reservations', await signed(a, 'jasonobb'))).json();

    let pub = await (await app.request('/api/tags/JasonObb')).json();
    assert.equal(pub.tag, 'jasonobb');
    assert.equal(pub.routes, null);

    const other = wallet().address;
    const put = await app.request('/api/tags/jasonobb/routes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${editToken}` },
      body: JSON.stringify({ routes: { '*': a.address, 'usdc:8453': other }, showAddresses: true }),
    });
    assert.equal(put.status, 200);

    pub = await (await app.request('/api/tags/jasonobb')).json();
    assert.equal(pub.routes['usdc:8453'], other.toLowerCase());
  });

  it('rejects route edits without a valid token', async () => {
    await post('/api/reservations', await signed(wallet(), 'jasonobb'));
    const res = await app.request('/api/tags/jasonobb/routes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' },
      body: JSON.stringify({ routes: { '*': wallet().address } }),
    });
    assert.equal(res.status, 401);
  });

  it('issues a fresh edit session only to the owner', async () => {
    const a = wallet();
    await post('/api/reservations', await signed(a, 'jasonobb'));
    assert.equal((await post('/api/manage', await signed(wallet(), 'jasonobb', { manage: true }))).status, 403);
    // A reservation signature can't be replayed as a manage signature.
    assert.equal((await post('/api/manage', await signed(a, 'jasonobb'))).status, 401);

    const ok = await post('/api/manage', await signed(a, 'jasonobb', { manage: true }));
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.routes['*'], a.address.toLowerCase());
  });

  it('counts real reservations only', async () => {
    assert.deepEqual(await (await app.request('/api/stats')).json(), { reserved: 0 });
    await post('/api/reservations', await signed(wallet(), 'jasonobb'));
    assert.deepEqual(await (await app.request('/api/stats')).json(), { reserved: 1 });
  });
});
