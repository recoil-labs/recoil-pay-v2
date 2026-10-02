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
import { baseSepolia, bscTestnet, optimismSepolia, polygonAmoy, sepolia } from 'viem/chains';
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

/** Which chain to settle on. The aggregator decides what it supports; this
 *  only has to name one of them, and the RPC comes from its registry rather
 *  than from viem's default — the registry is what the aggregator itself
 *  uses, so a run here exercises the same endpoint settlement will. */
const CHAINS_BY_ID = {
  84532: baseSepolia,
  11155420: optimismSepolia,
  97: bscTestnet,
  80002: polygonAmoy,
  11155111: sepolia,
};
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 84532);
const CHAIN = CHAINS_BY_ID[CHAIN_ID];
if (!CHAIN) {
  console.error(`CHAIN_ID ${CHAIN_ID} is not one of: ${Object.keys(CHAINS_BY_ID).join(', ')}`);
  process.exit(1);
}
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
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable',
    inputs: [{ name: 't', type: 'address' }, { name: 'a', type: 'uint256' }], outputs: [{ type: 'bool' }] },
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

/** Approve `spender` for at least `want`, and do not return until a read
 *  actually observes it.
 *
 *  Waiting for the approve receipt is not enough. Public RPCs are load
 *  balanced, so the next call can land on a node that has not seen that
 *  block yet, read the allowance as zero, and revert — which surfaces as
 *  `TransferFailed()` from inside the contract and looks like a contract
 *  bug rather than a stale read. */
async function approveAndConfirm(wallet, owner, token, spender, want, label) {
  const current = await pub.readContract({
    address: token, abi: ERC20, functionName: 'allowance', args: [owner, spender],
  });
  if (current >= want) {
    ok(`${label} already approved`);
    return;
  }

  const tx = await wallet.writeContract({
    address: token, abi: ERC20, functionName: 'approve', args: [spender, want],
  });
  await pub.waitForTransactionReceipt({ hash: tx });
  ok(`approved ${label} ${tx}`);

  for (let i = 0; i < 20; i++) {
    const seen = await pub.readContract({
      address: token, abi: ERC20, functionName: 'allowance', args: [owner, spender],
    });
    if (seen >= want) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  die(`approved ${label} but no RPC read reflected it after 60s`);
}

/** The derived encryption keypair, and the disclosure proving it is theirs.
 *  Two signatures: the derivation one never leaves this process. */
function encryptionIdentity(_unused, privKey, tradeId) {
  const derivationSig = signEip191(KEY_DERIVATION_MESSAGE, privKey);
  const { privateKey, publicKey } = deriveEncryptionKeypair(derivationSig);
  const keySignature = signEip191(pubkeyDisclosureMessage(tradeId, publicKey), privKey);
  return { privateKey, publicKey, keySignature };
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

// Read the registry first: the clients below use the aggregator's own RPC
// rather than viem's default, so a green run here means the endpoint
// settlement depends on is actually working — not merely that some public
// node somewhere is.
const chains = (await api('/api/v1/chains')).body?.data ?? [];
const chain = chains.find((c) => c.chain_id === CHAIN_ID);
if (!chain) die(`the aggregator does not serve chain ${CHAIN_ID}`);
if (!chain.giftcard_escrow) die(`no gift card escrow configured on ${chain.name}`);

const transport = http(chain.rpc_url);
const pub = createPublicClient({ chain: CHAIN, transport });
const merchantWallet = createWalletClient({ account: merchant, chain: CHAIN, transport });
const userWallet = createWalletClient({ account: user, chain: CHAIN, transport });

/** Which direction to run: `buy` (the merchant buys, a user sells a card),
 *  `sell` (the merchant sells, a user buys one), or `both`.
 *
 *  Worth running both: the two directions swap who funds escrow, who hands
 *  over the code and who attests, so almost nothing about the settlement
 *  path is shared between them. */
const DIRECTION = (process.env.DIRECTION ?? 'both').toLowerCase();

console.log(`merchant ${merchant.address}`);
console.log(`user     ${user.address}`);
console.log(`api      ${BASE}`);

// ── 1. chain registry ────────────────────────────────────────────────────
say(`Settling on ${chain.name}`, `rpc ${chain.rpc_url}`);
const usdc = chain.tokens.find((t) => t.symbol === 'USDC');
if (!usdc) die('no USDC on this chain');
ok(`escrow ${chain.giftcard_escrow}`);
ok(`bond   ${chain.merchant_bond}`);
ok(`USDC   ${usdc.address} (${usdc.decimals} decimals)`);

const unit = 10n ** BigInt(usdc.decimals);
const payout = (FACE_MINOR * BigInt(Math.round(Number(RATE) * 1e6)) * unit) / (100n * 1_000_000n);

// ── 2. gas + balance ─────────────────────────────────────────────────────
say('Checking balances');
// Only the funder transacts, and which party that is flips with direction:
// the merchant funds a buy, the user funds a sell. The merchant always
// needs gas — it stakes the bond either way — and tops the user up when a
// sell run needs it, rather than making someone fund a second wallet by
// hand mid-test.
const gas = await pub.getBalance({ address: merchant.address });
if (gas === 0n) die(`merchant ${merchant.address} has no ${CHAIN.name} ETH for gas`);
ok(`merchant gas ${gas} wei`);
const usdcBal = await pub.readContract({
  address: usdc.address, abi: ERC20, functionName: 'balanceOf', args: [merchant.address],
});
ok(`merchant USDC ${usdcBal}`);
// Worst case: the bond, the buy-side escrow, and twice the sell-side
// escrow (the top-up sends double so a re-run does not need another).
const needed = BOND_MAJOR * unit + payout * 3n;
if (usdcBal < needed) {
  die(`merchant needs ${needed} USDC units (bond ${BOND_MAJOR * unit} + escrow ${payout} + user top-up ${payout * 2n}), has ${usdcBal}`);
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
  await approveAndConfirm(merchantWallet, merchant.address, usdc.address, chain.merchant_bond, want, 'bond');
  const tx = await merchantWallet.writeContract({
    address: chain.merchant_bond, abi: BOND, functionName: 'deposit',
    args: [merchant.address, usdc.address, want],
  });
  await pub.waitForTransactionReceipt({ hash: tx });
  ok(`staked ${tx}`);
} else {
  ok(`already staked ${bondNow}`);
}

// ── one complete trade, in whichever direction ───────────────────────────
//
// Nothing below branches on `side` to decide who does what. The trade itself
// reports `cardSender`, `cardReceiver` and `funder`, and every step is driven
// off those — the same way both UIs do it. A flow that re-derived the roles
// from `side` would be a second place to get the asymmetry wrong.
async function runTrade(side) {
  const userIsSelling = side === 'buy'; // a merchant BUY quote fills a seller
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  ${side === 'buy' ? 'MERCHANT BUYS — a user sells a card' : 'MERCHANT SELLS — a user buys a card'}`);
  console.log('═'.repeat(64));

  say('Publishing a rate', `${side} ${BRAND} ${COUNTRY} $25–$500 at ${Number(RATE) * 100}%`);
  const submit = await api('/solver-api/giftcard-quotes/submit', {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    body: JSON.stringify({
      solverId,
      quotes: [{
        side, brand: BRAND, countryCode: COUNTRY, currency: 'USD', cardType: 'ecode',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        payoutChain: `eip155:${CHAIN.id}`, payoutAsset: 'USDC',
        ranges: [{ minFace: '2500', maxFace: '50000', quote: RATE }],
      }],
    }),
  });
  if (submit.body?.quotesAdded !== 1) die(`publish failed: ${JSON.stringify(submit.body)}`);
  ok('published');

  say('User searches');
  const ranked = await api('/api/v1/giftcard-quotes/rank', {
    method: 'POST',
    body: JSON.stringify({
      userIsSelling, brand: BRAND, countryCode: COUNTRY, cardType: 'ecode',
      faceMinorUnits: FACE_MINOR.toString(), userAddress: user.address,
    }),
  });
  const offer = (ranked.body?.data ?? []).find((o) => o.solverId === solverId);
  if (!offer) die(`our quote did not rank: ${JSON.stringify(ranked.body)}`);
  ok(`${userIsSelling ? 'would receive' : 'would pay'} ${offer.payoutMinorUnits} USDC units`);

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
  ok(`card sender ${trade.cardSender}, receiver ${trade.cardReceiver}, funder ${trade.funder}`);

  // The invariant the whole timeout rule rests on.
  if (trade.funder !== trade.cardReceiver) {
    die(`funder (${trade.funder}) and card receiver (${trade.cardReceiver}) must be the same party`);
  }
  const expectedFunder = side === 'buy' ? 'merchant' : 'user';
  if (trade.funder !== expectedFunder) die(`expected ${expectedFunder} to fund a ${side} trade`);

  // Who is who, for this direction.
  const asMerchant = (p) => p === 'merchant';
  const funderIsMerchant = asMerchant(trade.funder);
  const funderWallet = funderIsMerchant ? merchantWallet : userWallet;
  const funderAddr = funderIsMerchant ? merchant.address : user.address;
  const funderKey = funderIsMerchant ? MERCHANT_KEY : USER_KEY;
  const counterparty = funderIsMerchant ? user.address : merchant.address;
  const amount = BigInt(trade.payoutMinorUnits);

  // Auth differs by party: a merchant presents the api key, a user signs the
  // trade id. Neither can act in the other's role.
  const authFor = (party, extra = {}) =>
    asMerchant(party)
      ? { headers: { 'x-api-key': apiKey }, body: extra }
      : { headers: {}, body: { ...extra, signature: signEip191(trade.id, USER_KEY) } };

  say(`${trade.funder} locks escrow`);
  if (!funderIsMerchant) await ensureUserCanTransact(amount);
  await approveAndConfirm(funderWallet, funderAddr, usdc.address, chain.giftcard_escrow, amount, 'escrow');
  const tradeKey = keccak256(toBytes(trade.id));
  const lockTx = await funderWallet.writeContract({
    address: chain.giftcard_escrow, abi: ESCROW, functionName: 'lock',
    args: [tradeKey, usdc.address, amount, counterparty],
  });
  const lockReceipt = await pub.waitForTransactionReceipt({ hash: lockTx });
  if (lockReceipt.status !== 'success') die('the lock reverted');
  ok(`locked ${amount} USDC units  ${lockTx}`);

  const keys = encryptionIdentity(null, funderKey, trade.id);
  const a = authFor(trade.funder, {
    txHash: lockTx, recipientPubkey: keys.publicKey, keySignature: keys.keySignature,
  });
  const funded = await api(`/api/v1/giftcard-trades/${trade.id}/escrow`, {
    method: 'POST', headers: a.headers, body: JSON.stringify(a.body),
  });
  if (funded.status !== 200) die(`escrow verification refused: ${funded.status} ${JSON.stringify(funded.body)}`);
  ok(`verified on-chain, state=${funded.body.data.state}`);

  const CODE = `AMZN-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${side.toUpperCase()}-${Date.now() % 10000}`;
  say(`${trade.cardSender} seals and delivers the code`, `plaintext never leaves here: ${CODE}`);
  const sealed = sealCode(CODE, funded.body.data.recipientPubkey);
  if (JSON.stringify(sealed).includes(CODE)) die('the envelope leaks the plaintext');
  const d = authFor(trade.cardSender, { commitment: commitToCode(CODE), sealed });
  const delivered = await api(`/api/v1/giftcard-trades/${trade.id}/code`, {
    method: 'POST', headers: d.headers, body: JSON.stringify(d.body),
  });
  if (delivered.status !== 200) die(`delivery refused: ${delivered.status} ${JSON.stringify(delivered.body)}`);
  ok(`delivered, state=${delivered.body.data.state}`);

  say(`${trade.cardReceiver} decrypts it`);
  const revealed = openCode(delivered.body.data.sealedCode, keys.privateKey);
  if (revealed !== CODE) die(`decrypted to ${revealed}, expected ${CODE}`);
  ok(`read back exactly: ${revealed}`);
  if (commitToCode(revealed) !== delivered.body.data.codeCommitment) die('commitment mismatch');
  ok('matches the commitment the server stored');

  say(`${trade.cardReceiver} attests the card is good`);
  const at = authFor(trade.cardReceiver, { valid: true });
  const attested = await api(`/api/v1/giftcard-trades/${trade.id}/attest`, {
    method: 'POST', headers: at.headers, body: JSON.stringify(at.body),
  });
  if (attested.status !== 200) die(`attest refused: ${attested.status} ${JSON.stringify(attested.body)}`);
  ok(`state=${attested.body.data.state}`);

  // Settling pays the card sender — the opposite party from the funder.
  const payeeAddr = trade.cardSender === 'merchant' ? merchant.address : user.address;
  say('Waiting for the payout worker', `it should pay the ${trade.cardSender}`);
  const before = await pub.readContract({
    address: usdc.address, abi: ERC20, functionName: 'balanceOf', args: [payeeAddr],
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
    address: usdc.address, abi: ERC20, functionName: 'balanceOf', args: [payeeAddr],
  });
  if (after - before !== amount) die(`${trade.cardSender} received ${after - before}, expected ${amount}`);
  ok(`${trade.cardSender} received ${after - before} USDC units on-chain`);

  if (await pub.readContract({
    address: chain.giftcard_escrow, abi: ESCROW, functionName: 'isOpen', args: [tradeKey],
  })) die('the escrow still reports the lock as open');
  ok('escrow closed');

  return { side, trade: trade.id, lock: lockTx, release: paid.releaseTxHash };
}

/** The user wallet is a throwaway in the buy direction and never needs
 *  anything. In the sell direction it has to lock escrow, so top it up from
 *  the merchant — both keys are already here, and asking someone to fund a
 *  second wallet by hand mid-test is a poor use of their time. */
async function ensureUserCanTransact(amount) {
  const gas = await pub.getBalance({ address: user.address });
  if (gas < 10n ** 15n) {
    const tx = await merchantWallet.sendTransaction({ to: user.address, value: 10n ** 15n });
    await pub.waitForTransactionReceipt({ hash: tx });
    ok(`funded the user with gas ${tx}`);
  }
  const bal = await pub.readContract({
    address: usdc.address, abi: ERC20, functionName: 'balanceOf', args: [user.address],
  });
  if (bal < amount) {
    const tx = await merchantWallet.writeContract({
      address: usdc.address, abi: ERC20, functionName: 'transfer', args: [user.address, amount * 2n],
    });
    await pub.waitForTransactionReceipt({ hash: tx });
    ok(`sent the user ${amount * 2n} USDC units ${tx}`);
    for (let i = 0; i < 20; i++) {
      const seen = await pub.readContract({
        address: usdc.address, abi: ERC20, functionName: 'balanceOf', args: [user.address],
      });
      if (seen >= amount) return;
      await new Promise((r) => setTimeout(r, 3000));
    }
    die('sent the user USDC but no RPC read reflected it');
  }
}

const results = [];
for (const side of DIRECTION === 'both' ? ['buy', 'sell'] : [DIRECTION]) {
  if (!['buy', 'sell'].includes(side)) die(`DIRECTION must be buy, sell or both`);
  results.push(await runTrade(side));
}

// Leave the book as we found it.
for (const q of (await api(`/solver-api/giftcard-quotes?solverId=${solverId}`, {
  headers: { 'x-api-key': apiKey },
})).body?.data ?? []) {
  await api(`/solver-api/giftcard-quotes/${q.id}`, {
    method: 'DELETE', headers: { 'x-api-key': apiKey },
  });
}

console.log(`\n${'═'.repeat(64)}`);
for (const r of results) {
  console.log(`✓ ${r.side.padEnd(4)} settled on ${CHAIN.name}`);
  console.log(`    trade   ${r.trade}`);
  console.log(`    lock    ${r.lock}`);
  console.log(`    release ${r.release}`);
}
