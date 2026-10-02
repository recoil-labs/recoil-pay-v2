/* End-to-end smoke test of the gift card pipeline against a local aggregator.
 *
 * Registers a merchant, publishes a two-band rate, ranks a user intent
 * against it, and checks the trade-creation guard. Everything a real client
 * does, over HTTP, with real signatures.
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';

const BASE = 'http://127.0.0.1:4000';
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failed++;
};

const hex = (b) => `0x${Buffer.from(b).toString('hex')}`;

function eip191Hash(message) {
  const body = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
  return keccak_256(new Uint8Array([...prefix, ...body]));
}

function addressOf(priv) {
  const pub = secp256k1.getPublicKey(priv, false);
  return hex(keccak_256(pub.slice(1)).slice(12));
}

function sign(message, priv) {
  const sig = secp256k1.sign(eip191Hash(message), priv);
  return hex(new Uint8Array([...sig.toCompactRawBytes(), 27 + sig.recovery]));
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, body };
}

// ── 1. register a merchant ────────────────────────────────────────────────
const merchantKey = secp256k1.utils.randomPrivateKey();
const merchantAddr = addressOf(merchantKey);

const challenge = await api(
  `/api/v1/solver/register/message?address=${merchantAddr}`,
);
const message = challenge.body?.data?.message ?? challenge.body?.message;
check('register challenge issued', typeof message === 'string' && message.length > 0);

const registered = await api('/solver-api/account/register', {
  method: 'POST',
  body: JSON.stringify({
    address: merchantAddr,
    message,
    signature: sign(message, merchantKey),
  }),
});
const solverId = registered.body?.solverId;
const apiKey = registered.body?.apiKey;
check('merchant registered with a signature', Boolean(solverId && apiKey), solverId ?? '');

// ── 2. publish a two-band rate ────────────────────────────────────────────
const submitted = await api('/solver-api/giftcard-quotes/submit', {
  method: 'POST',
  headers: { 'x-api-key': apiKey },
  body: JSON.stringify({
    solverId,
    quotes: [
      {
        side: 'buy',
        brand: 'Amazon',
        countryCode: 'us',
        currency: 'USD',
        cardType: 'ecode',
        expiry: 4_000_000_000,
        payoutChain: 'eip155:84532',
        payoutAsset: 'USDC',
        ranges: [
          { minFace: '2500', maxFace: '20000', quote: '0.88' },
          { minFace: '20001', maxFace: '50000', quote: '0.90' },
        ],
      },
    ],
  }),
});
// Both bands must land. This is the bug that was silently losing all but the
// first band of a multi-band quote on the swap side.
check(
  'both bands of a multi-band quote persist',
  submitted.body?.quotesAdded === 2,
  `added ${submitted.body?.quotesAdded}`,
);

// ── 3. validation rejects a percentage typed as a rate ─────────────────────
const badRate = await api('/solver-api/giftcard-quotes/submit', {
  method: 'POST',
  headers: { 'x-api-key': apiKey },
  body: JSON.stringify({
    solverId,
    quotes: [
      {
        side: 'buy',
        brand: 'Steam',
        countryCode: 'US',
        cardType: 'ecode',
        expiry: 4_000_000_000,
        payoutChain: 'eip155:84532',
        payoutAsset: 'USDC',
        ranges: [{ minFace: '2500', maxFace: '20000', quote: '88' }],
      },
    ],
  }),
});
check(
  'a rate of "88" is rejected as a misplaced decimal',
  badRate.body?.quotesAdded === 0 && (badRate.body?.rejected?.length ?? 0) === 1,
  badRate.body?.rejected?.[0]?.reason?.slice(0, 48) ?? '',
);

// ── 4. rank a user intent ─────────────────────────────────────────────────
const userKey = secp256k1.utils.randomPrivateKey();
const userAddr = addressOf(userKey);

const ranked = await api('/api/v1/giftcard-quotes/rank', {
  method: 'POST',
  body: JSON.stringify({
    userIsSelling: true, // a seller matches merchant BUY quotes
    brand: 'amazon', // lower case on purpose
    countryCode: 'us',
    cardType: 'ecode',
    faceMinorUnits: '10000', // $100 → the 0.88 band
    userAddress: userAddr,
  }),
});
const offers = ranked.body?.data ?? [];
check('ranking is public (no api key needed)', ranked.status === 200);
check('a seller matches the merchant buy side', offers.length === 1, `${offers.length} offer(s)`);
check(
  'the $100 face hits the 0.88 band, not the 0.90 one',
  Number(offers[0]?.rate) === 0.88,
  offers[0]?.rate ?? '',
);
// $100 at 0.88 = $88, which in 6-decimal USDC is 88000000 — not 8800.
check(
  'payout rescales card cents to token minor units',
  offers[0]?.payoutMinorUnits === '88000000',
  offers[0]?.payoutMinorUnits ?? '',
);

// A buyer must not match the same quote.
const wrongSide = await api('/api/v1/giftcard-quotes/rank', {
  method: 'POST',
  body: JSON.stringify({
    userIsSelling: false,
    brand: 'Amazon',
    countryCode: 'US',
    cardType: 'ecode',
    faceMinorUnits: '10000',
  }),
});
check('a buyer is never matched to a buy quote', (wrongSide.body?.data ?? []).length === 0);

// Out of band.
const outOfBand = await api('/api/v1/giftcard-quotes/rank', {
  method: 'POST',
  body: JSON.stringify({
    userIsSelling: true,
    brand: 'Amazon',
    countryCode: 'US',
    cardType: 'ecode',
    faceMinorUnits: '90000', // above both bands
  }),
});
check('a face value above every band matches nothing', (outOfBand.body?.data ?? []).length === 0);

// ── 5. trade creation refuses when settlement is not configured ───────────
const trade = await api('/api/v1/giftcard-trades', {
  method: 'POST',
  body: JSON.stringify({
    quoteId: offers[0]?.quoteId,
    faceMinorUnits: '10000',
    userAddress: userAddr,
  }),
});
// No GIFTCARD_ATTESTOR_KEY here, so this must refuse rather than open a trade
// it could never pay out.
check(
  'a trade is refused when settlement is unconfigured',
  trade.status === 503 && trade.body?.error === 'settlement_disabled',
  `${trade.status} ${trade.body?.error ?? ''}`,
);

// ── 6. pause takes a rate off the book ────────────────────────────────────
const quoteId = offers[0].quoteId;
await api(`/solver-api/giftcard-quotes/${quoteId}/pause`, {
  method: 'POST',
  headers: { 'x-api-key': apiKey },
});
const afterPause = await api('/api/v1/giftcard-quotes/rank', {
  method: 'POST',
  body: JSON.stringify({
    userIsSelling: true,
    brand: 'Amazon',
    countryCode: 'US',
    cardType: 'ecode',
    faceMinorUnits: '10000',
  }),
});
check('a paused rate leaves the book', (afterPause.body?.data ?? []).length === 0);

console.log(failed === 0 ? '\nall smoke checks passed' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
