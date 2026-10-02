/* Verifies the code-sealing scheme in src/crypto/sealedCode.ts.
 *
 * This is the one part of the app whose failure is silent and expensive: a
 * scheme that encrypts but round-trips wrongly, or that is deterministic, or
 * that decrypts tampered input to garbage, all look like working code until
 * someone loses a gift card over it. So it gets checked rather than assumed.
 *
 * Run with `npm run verify:sealing`. It bundles the TypeScript module with
 * esbuild and exercises the real thing — not a copy of it, which would drift.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'recoil-sealing-'));
const bundle = join(dir, 'sealed.mjs');

try {
  execFileSync(
    'npx',
    [
      'esbuild', 'src/crypto/sealedCode.ts',
      '--bundle', '--format=esm', '--platform=node',
      `--outfile=${bundle}`, '--log-level=error',
    ],
    { stdio: 'inherit' },
  );

  const { secp256k1 } = await import('@noble/curves/secp256k1');
  const {
    KEY_DERIVATION_MESSAGE, addressFromPubkey, commitToCode, deriveEncryptionKeypair,
    eip191Hash, openCode, pubkeyDisclosureMessage, pubkeyFromSignature, sealCode,
  } = await import(pathToFileURL(bundle).href);

  const hex = (b) => `0x${Buffer.from(b).toString('hex')}`;
  let failed = 0;
  const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
    if (!ok) failed++;
  };

  const priv = secp256k1.utils.randomPrivateKey();
  const pub = hex(secp256k1.getPublicKey(priv, false));
  const CODE = 'AMZN-4K7Q-9XF2-TTBD';
  const sealed = sealCode(CODE, pub);

  check('seals and opens back to the same code', openCode(sealed, hex(priv)) === CODE);

  // The whole premise: whatever the server stores must not contain the code.
  check('ciphertext does not contain the plaintext', !JSON.stringify(sealed).includes(CODE));
  check('envelope names its algorithm', sealed.alg === 'ECIES-secp256k1-AES256GCM');

  let denied = false;
  try { openCode(sealed, hex(secp256k1.utils.randomPrivateKey())); } catch { denied = true; }
  check('a different key cannot open it', denied);

  // Without the GCM tag check, a tampered envelope would decrypt to garbage,
  // be redeemed, fail at the brand, and be indistinguishable from a bad card.
  const flipped = sealed.ct.slice(0, -2) + (sealed.ct.endsWith('00') ? '01' : '00');
  let caught = false;
  try { openCode({ ...sealed, ct: flipped }, hex(priv)); } catch { caught = true; }
  check('a tampered ciphertext throws rather than returning garbage', caught);

  // A deterministic scheme would leak that two trades carry the same code.
  const again = sealCode(CODE, pub);
  check(
    'the same code seals to two unrelated envelopes',
    again.ct !== sealed.ct && again.epk !== sealed.epk,
  );

  check('commitment is deterministic', commitToCode(CODE) === commitToCode(` ${CODE} `));
  check(
    'commitment differs for a different code',
    commitToCode(CODE) !== commitToCode('AMZN-0000-0000-0000'),
  );

  // Cross-language: the server rejects a public key whose derived address
  // does not match the caller's. If the two derivations ever disagree, every
  // escrow-funding call fails. Vector is the generator point (private key 1).
  const generator = hex(secp256k1.getPublicKey(new Uint8Array([...Array(31).fill(0), 1]), false));
  check(
    'address derivation agrees with the Rust server',
    addressFromPubkey(generator) === '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
    addressFromPubkey(generator),
  );

  const msg = 'RecoilPay: publish my encryption key for trade gct-abc';
  const digest = eip191Hash(msg);
  const sig = secp256k1.sign(digest, priv);
  const sigHex = hex(new Uint8Array([...sig.toCompactRawBytes(), 27 + sig.recovery]));
  check(
    'recovers the signer public key from an EIP-191 signature',
    pubkeyFromSignature(digest, sigHex) === pub,
  );

  let refused = false;
  try { sealCode('   ', pub); } catch { refused = true; }
  check('refuses to seal an empty code', refused);

  // ── the derived encryption key ────────────────────────────────────────
  //
  // The whole flow in miniature. Sealing to a WALLET key is the trap: it
  // encrypts fine and can never be opened, because no wallet gives a page
  // its private key. These checks are what prove the real path works.

  const walletKey = secp256k1.utils.randomPrivateKey();
  const signDerivation = () => {
    const sig = secp256k1.sign(eip191Hash(KEY_DERIVATION_MESSAGE), walletKey);
    return hex(new Uint8Array([...sig.toCompactRawBytes(), 27 + sig.recovery]));
  };

  const derived = deriveEncryptionKeypair(signDerivation());

  // Determinism is the load-bearing property: without it a code sealed
  // yesterday could not be opened today, on any device.
  check(
    'the same wallet derives the same key every time',
    deriveEncryptionKeypair(signDerivation()).privateKey === derived.privateKey,
  );

  const otherWallet = secp256k1.utils.randomPrivateKey();
  const otherSig = secp256k1.sign(eip191Hash(KEY_DERIVATION_MESSAGE), otherWallet);
  const otherDerived = deriveEncryptionKeypair(
    hex(new Uint8Array([...otherSig.toCompactRawBytes(), 27 + otherSig.recovery])),
  );
  check(
    'a different wallet derives a different key',
    otherDerived.privateKey !== derived.privateKey,
  );

  // End to end: seal to the derived PUBLIC key, open with the derived
  // PRIVATE key. This is exactly what the two browsers do.
  const sealedToDerived = sealCode(CODE, derived.publicKey);
  check(
    'a code sealed to a derived key opens with it',
    openCode(sealedToDerived, derived.privateKey) === CODE,
  );
  let wrongWalletDenied = false;
  try { openCode(sealedToDerived, otherDerived.privateKey); } catch { wrongWalletDenied = true; }
  check('another wallet cannot open it', wrongWalletDenied);

  // The derived key owns a different address than the wallet, which is why
  // the server verifies it by signature rather than by address.
  check(
    'the derived key is not the wallet key',
    addressFromPubkey(derived.publicKey) !== addressFromPubkey(hex(secp256k1.getPublicKey(walletKey, false))),
  );

  // Must match `key_disclosure_message` in the Rust handler byte for byte.
  check(
    'the disclosure message matches the server wording',
    pubkeyDisclosureMessage('gct-1', '0x04AB') ===
      'RecoilPay: encryption key for trade gct-1 is 0x04ab',
  );
  check(
    'a disclosure is scoped to one trade',
    pubkeyDisclosureMessage('gct-1', '0x04ab') !== pubkeyDisclosureMessage('gct-2', '0x04ab'),
  );

  console.log(failed === 0 ? '\nall sealing checks passed' : `\n${failed} CHECK(S) FAILED`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
