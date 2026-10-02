/* One complete gift card trade, start to finish, against real contracts.
 *
 * Everything else has been proven in isolation: the contracts have 35 tests,
 * the aggregator has 218, the sealing has 18, and the smoke test proves a
 * trade can be *opened* in production. This is the only thing that proves a
 * trade can be *finished* — locked, delivered, attested, and paid out of
 * escrow by the worker.
 *
 * It drives the merchant-buys direction (a user selling a card), which
 * exercises both sides: the merchant funds escrow and attests, the user
 * delivers the code.
 *
 * Run:
 *   export MERCHANT_KEY=0x...     # two different wallets — lock() reverts
 *   export USER_KEY=0x...         # SamePartyTwice if they match
 *   npm run e2e
 *
 * Both wallets need Base Sepolia ETH for gas. The merchant also needs test
 * USDC for the bond and the escrow.
 */

import { createPublicClient, createWalletClient, http, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { secp256k1 } from '@noble/curves/secp256k1';

import {
  KEY_DERIVATION_MESSAGE,
  commitToCode,
  deriveEncryptionKeypair,
  eip191Hash,
  openCode,
  pubkeyDisclosureMessage,
  sealCode,
} from '../src/crypto/sealedCode.ts';

const BASE = process.env.SMOKE_BASE ?? 'https://api.recoilpay.com';
const CHAIN = baseSepolia;
const BRAND = 'Amazon';
const COUNTRY = 'US';
const FACE_MINOR = 10_000n; // $100.00 in cents
const RATE = '0.88';
const BOND_MAJOR = 500n; // $500 stake → $2,500 of capacity at 5x

let step = 0;
const say = (msg, extra = '') => console.log(`\n[${++step}] ${msg}${extra ? `\n    ${extra}` : ''}`);
const ok = (msg) => console.log(`    ✓ ${msg}`);
const die = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

const ERC20 = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 's', type: 'address' }, { name: 'a', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
];
const ESCROW = [
  { type: 'function', name: 'lock', stateMutability: 'nonpayable',
    inputs: [{ name: 'tradeId', type: 'bytes32' }, { name: 'token', type: 'address' },
             { name: 'amount', type: 'uint256' }, { name: 'counterparty', type: 'address' }], outputs: [] },
  { type: 'function', name: 'isOpen', stateMutability: 'view',
    inputs: [{ name: 't', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
];
const BOND = [
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable',
    inputs: [{ name: 'm', type: 'address' }, { name: 't', type: 'address' }, { name: 'a', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'availableBond', stateMutability: 'view',
    inputs: [{ name: 'm', type: 'address' }, { name: 't', type: 'address' }], outputs: [{ type: 'uint256' }] },
];

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

const hex = (b) => `0x${Buffer.from(b).toString('hex')}`;

/** The derived encryption keypair, and the disclosure proving it is theirs.
 *  Two signatures: the derivation one never leaves this process. */
function encryptionIdentity(account, privKey, tradeId) {
  const derivationSig = signEip191(KEY_DERIVATION_MESSAGE, privKey);
  const { privateKey, publicKey } = deriveEncryptionKeypair(derivationSig);
  const keySignature = signEip191(pubkeyDisclosureMessage(tradeId, publicKey), privKey);
  return { privateKey, publicKey, keySignature, address: account.address };
}

function signEip191(message, privKeyHex) {
  const sig = secp256k1.sign(eip191Hash(message), privKeyHex.replace(/^0x/, ''));
  return hex(new Uint8Array([...sig.toCompactRawBytes(), 27 + sig.recovery]));
}

// ── setup ────────────────────────────────────────────────────────────────
const MERCHANT_KEY = process.env.MERCHANT_KEY;
const USER_KEY = process.env.USER_KEY;
if (!MERCHANT_KEY || !USER_KEY) die('set MERCHANT_KEY and USER_KEY');

const merchant = privateKeyToAccount(MERCHANT_KEY);
const user = privateKeyToAccount(USER_KEY);
if (merchant.address.toLowerCase() === user.address.toLowerCase()) {
  die('MERCHANT_KEY and USER_KEY must be different wallets — lock() reverts SamePartyTwice');
}

const pub = createPublicClient({ chain: CHAIN, transport: http() });
const merchantWallet = createWalletClient({ account: merchant, chain: CHAIN, transport: http() });

console.log(`merchant ${merchant.address}`);
console.log(`user     ${user.address}`);
console.log(`api      ${BASE}`);

// ── 1. chain registry ────────────────────────────────────────────────────
say('Reading the chain registry');
const chains = (await api('/api/v1/chains')).body?.data ?? [];
const chain = chains.find((c) => c.chain_id === CHAIN.id);
if (!chain?.giftcard_escrow) die(`no gift card escrow configured on ${CHAIN.name}`);
const usdc = chain.tokens.find((t) => t.symbol === 'USDC');
if (!usdc) die('no USDC on this chain');
ok(`escrow ${chain.giftcard_escrow}`);
ok(`bond   ${chain.merchant_bond}`);
ok(`USDC   ${usdc.address} (${usdc.decimals} decimals)`);

const unit = 10n ** BigInt(usdc.decimals);
const payout = (FACE_MINOR * BigInt(Math.round(Number(RATE) * 1e6)) * unit) / (100n * 1_000_000n);

// ── 2. gas + balance ─────────────────────────────────────────────────────
say('Checking balances');
// Only the funder transacts. This is the merchant-buys direction, so the
// merchant approves, stakes, and locks, while the user signs messages
// off-chain and receives the payout — they never send a transaction and
// need no gas at all. Requiring it from them would turn an empty throwaway
// wallet into a blocker for no reason.
const gas = await pub.getBalance({ address: merchant.address });
if (gas === 0n) die(`merchant ${merchant.address} has no ${CHAIN.name} ETH for gas`);
ok(`merchant gas ${gas} wei`);
ok(`user needs no gas — it only signs and receives`);
const usdcBal = await pub.readContract({
  address: usdc.address, abi: ERC20, functionName: 'balanceOf', args: [merchant.address],
});
ok(`merchant USDC ${usdcBal}`);
const needed = BOND_MAJOR * unit + payout;
if (usdcBal < needed) {
  die(`merchant needs ${needed} USDC units (bond ${BOND_MAJOR * unit} + escrow ${payout}), has ${usdcBal}`);
}

// ── 3. register the merchant ─────────────────────────────────────────────
say('Registering the merchant');
const challenge = await api(`/api/v1/solver/register/message?address=${merchant.address}`);
const message = challenge.body?.data?.message ?? challenge.body?.message;
if (!message) die('no registration challenge returned');
const reg = await api('/solver-api/account/register', {
  method: 'POST',
  body: JSON.stringify({ address: merchant.address, message, signature: signEip191(message, MERCHANT_KEY) }),
});
const solverId = reg.body?.solverId;
const apiKey = reg.body?.apiKey;
if (!solverId || !apiKey) die(`registration failed: ${JSON.stringify(reg.body)}`);
ok(solverId);

// ── 4. stake the bond ────────────────────────────────────────────────────
say('Staking the bond', `${BOND_MAJOR} USDC → ${BOND_MAJOR * 5n} USDC of trade capacity`);
const bondNow = await pub.readContract({
  address: chain.merchant_bond, abi: BOND, functionName: 'availableBond',
  args: [merchant.address, usdc.address],
});
if (bondNow < BOND_MAJOR * unit) {
  const want = BOND_MAJOR * unit;
  const allowance = await pub.readContract({
    address: usdc.address, abi: ERC20, functionName: 'allowance',
    args: [merchant.address, chain.merchant_bond],
  });
  if (allowance < want) {
    const tx = await merchantWallet.writeContract({
      address: usdc.address, abi: ERC20, functionName: 'approve', args: [chain.merchant_bond, want],
    });
    await pub.waitForTransactionReceipt({ hash: tx });
    ok(`approved ${tx}`);
  }
  const tx = await merchantWallet.writeContract({
    address: chain.merchant_bond, abi: BOND, functionName: 'deposit',
    args: [merchant.address, usdc.address, want],
  });
  await pub.waitForTransactionReceipt({ hash: tx });
  ok(`staked ${tx}`);
} else {
  ok(`already staked ${bondNow}`);
}

// ── 5. publish a buy rate ────────────────────────────────────────────────
say('Publishing a buy rate', `${BRAND} ${COUNTRY} $25–$500 at ${Number(RATE) * 100}%`);
const submit = await api('/solver-api/giftcard-quotes/submit', {
  method: 'POST',
  headers: { 'x-api-key': apiKey },
  body: JSON.stringify({
    solverId,
    quotes: [{
      side: 'buy', brand: BRAND, countryCode: COUNTRY, currency: 'USD', cardType: 'ecode',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      payoutChain: `eip155:${CHAIN.id}`, payoutAsset: 'USDC',
      ranges: [{ minFace: '2500', maxFace: '50000', quote: RATE }],
    }],
  }),
});
if (submit.body?.quotesAdded !== 1) die(`publish failed: ${JSON.stringify(submit.body)}`);
ok('published');

// ── 6. user ranks and opens a trade ──────────────────────────────────────
say('User searches for a rate');
const ranked = await api('/api/v1/giftcard-quotes/rank', {
  method: 'POST',
  body: JSON.stringify({
    userIsSelling: true, brand: BRAND, countryCode: COUNTRY, cardType: 'ecode',
    faceMinorUnits: FACE_MINOR.toString(), userAddress: user.address,
  }),
});
const offer = (ranked.body?.data ?? []).find((o) => o.solverId === solverId);
if (!offer) die(`our quote did not rank: ${JSON.stringify(ranked.body)}`);
ok(`offered ${offer.payoutMinorUnits} USDC units at ${offer.rate}`);

say('Opening the trade');
const opened = await api('/api/v1/giftcard-trades', {
  method: 'POST',
  body: JSON.stringify({
    quoteId: offer.quoteId, faceMinorUnits: FACE_MINOR.toString(), userAddress: user.address,
  }),
});
if (opened.status !== 201) die(`open failed: ${opened.status} ${JSON.stringify(opened.body)}`);
const trade = opened.body.data;
ok(`${trade.id}  state=${trade.state}`);
ok(`card sender ${trade.cardSender}, funder ${trade.funder}`);
if (trade.funder !== 'merchant') die(`expected the merchant to fund a buy-side trade, got ${trade.funder}`);

// ── 7. merchant locks escrow ─────────────────────────────────────────────
say('Merchant locks escrow');
const tradeKey = keccak256(toBytes(trade.id));
const amount = BigInt(trade.payoutMinorUnits);
const esAllow = await pub.readContract({
  address: usdc.address, abi: ERC20, functionName: 'allowance',
  args: [merchant.address, chain.giftcard_escrow],
});
if (esAllow < amount) {
  const tx = await merchantWallet.writeContract({
    address: usdc.address, abi: ERC20, functionName: 'approve', args: [chain.giftcard_escrow, amount],
  });
  await pub.waitForTransactionReceipt({ hash: tx });
  ok(`approved ${tx}`);
}
const lockTx = await merchantWallet.writeContract({
  address: chain.giftcard_escrow, abi: ESCROW, functionName: 'lock',
  args: [tradeKey, usdc.address, amount, user.address],
});
const lockReceipt = await pub.waitForTransactionReceipt({ hash: lockTx });
if (lockReceipt.status !== 'success') die('the lock reverted');
ok(`locked ${amount} USDC units  ${lockTx}`);

const merchantKeys = encryptionIdentity(merchant, MERCHANT_KEY, trade.id);
const funded = await api(`/api/v1/giftcard-trades/${trade.id}/escrow`, {
  method: 'POST',
  headers: { 'x-api-key': apiKey },
  body: JSON.stringify({
    txHash: lockTx,
    recipientPubkey: merchantKeys.publicKey,
    keySignature: merchantKeys.keySignature,
  }),
});
if (funded.status !== 200) die(`escrow verification refused: ${funded.status} ${JSON.stringify(funded.body)}`);
ok(`verified on-chain, state=${funded.body.data.state}`);

// ── 8. user delivers the code ────────────────────────────────────────────
const CODE = `AMZN-${Math.random().toString(36).slice(2, 6).toUpperCase()}-TEST-${Date.now() % 10000}`;
say('User seals and delivers the code', `plaintext stays here: ${CODE}`);
const sealed = sealCode(CODE, funded.body.data.recipientPubkey);
if (JSON.stringify(sealed).includes(CODE)) die('the envelope leaks the plaintext');
const delivered = await api(`/api/v1/giftcard-trades/${trade.id}/code`, {
  method: 'POST',
  body: JSON.stringify({
    commitment: commitToCode(CODE),
    sealed,
    signature: signEip191(trade.id, USER_KEY),
  }),
});
if (delivered.status !== 200) die(`delivery refused: ${delivered.status} ${JSON.stringify(delivered.body)}`);
ok(`delivered, state=${delivered.body.data.state}`);

// ── 9. merchant opens it ─────────────────────────────────────────────────
say('Merchant decrypts the code');
const revealed = openCode(delivered.body.data.sealedCode, merchantKeys.privateKey);
if (revealed !== CODE) die(`decrypted to ${revealed}, expected ${CODE}`);
ok(`read back exactly: ${revealed}`);
if (commitToCode(revealed) !== delivered.body.data.codeCommitment) die('commitment mismatch');
ok('matches the commitment the server stored');

// ── 10. merchant attests ─────────────────────────────────────────────────
say('Merchant attests the card is good');
const attested = await api(`/api/v1/giftcard-trades/${trade.id}/attest`, {
  method: 'POST',
  headers: { 'x-api-key': apiKey },
  body: JSON.stringify({ valid: true }),
});
if (attested.status !== 200) die(`attest refused: ${attested.status} ${JSON.stringify(attested.body)}`);
ok(`state=${attested.body.data.state}`);

// ── 11. the payout worker releases ───────────────────────────────────────
say('Waiting for the payout worker', 'it polls every 20s');
const before = await pub.readContract({
  address: usdc.address, abi: ERC20, functionName: 'balanceOf', args: [user.address],
});

let paid = null;
for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  const t = (await api(`/api/v1/giftcard-trades/${trade.id}`)).body?.data;
  process.stdout.write(`    …${t?.state}${t?.releaseTxHash ? ' released' : ''}\n`);
  if (t?.releaseTxHash) { paid = t; break; }
}
if (!paid) die('the payout worker did not release within 150s — check the aggregator logs');
ok(`release tx ${paid.releaseTxHash}`);

const after = await pub.readContract({
  address: usdc.address, abi: ERC20, functionName: 'balanceOf', args: [user.address],
});
const gained = after - before;
if (gained !== amount) die(`user received ${gained}, expected ${amount}`);
ok(`user received ${gained} USDC units on-chain`);

const stillOpen = await pub.readContract({
  address: chain.giftcard_escrow, abi: ESCROW, functionName: 'isOpen', args: [tradeKey],
});
if (stillOpen) die('the escrow still reports the lock as open');
ok('escrow closed');

// ── tidy up ──────────────────────────────────────────────────────────────
for (const q of (await api(`/solver-api/giftcard-quotes?solverId=${solverId}`, {
  headers: { 'x-api-key': apiKey },
})).body?.data ?? []) {
  await api(`/solver-api/giftcard-quotes/${q.id}`, {
    method: 'DELETE', headers: { 'x-api-key': apiKey },
  });
}

console.log(`\n✓ A complete gift card trade settled on ${CHAIN.name}.`);
console.log(`  trade   ${trade.id}`);
console.log(`  lock    ${lockTx}`);
console.log(`  release ${paid.releaseTxHash}`);
