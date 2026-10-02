/* Sealing a gift card code so that only its recipient can read it.
 *
 * The aggregator stores what this produces and holds no key that opens it.
 * That is the point: a database of plaintext gift card codes turns any
 * breach into a total loss, so the plaintext never leaves the two browsers
 * that legitimately need it.
 *
 * Scheme: ECIES over secp256k1 — an ephemeral keypair, ECDH against the
 * recipient's public key, HKDF-SHA256 to a 32-byte key, then AES-256-GCM.
 * The ephemeral key means the same code sealed twice produces two unrelated
 * envelopes, and the GCM tag means a tampered envelope fails to open rather
 * than decrypting to garbage.
 *
 * # Where the key comes from
 *
 * NOT the wallet keypair. Sealing to a wallet's public key is easy; opening
 * it needs that wallet's private key, and no browser wallet will hand one to
 * a page. A scheme built that way encrypts perfectly and can never be
 * decrypted by anybody.
 *
 * So each party derives a *separate* encryption keypair from a signature
 * over a fixed message. ECDSA signing is deterministic (RFC 6979), so the
 * same wallet signing the same message always produces the same signature,
 * and therefore always the same key — nothing has to be stored, and losing
 * the browser loses nothing.
 *
 * # Why the server cannot read any of it
 *
 * The derivation signature IS the private key, in effect, so it never leaves
 * the browser. What the server gets is the public key plus a *second*
 * signature, over a message naming that key and the trade. From that the
 * server can prove the key belongs to the party it expects, and can learn
 * nothing that helps it decrypt. Sending the derivation signature instead
 * would be far simpler and would hand the server every code on the platform.
 */

import { gcm } from '@noble/ciphers/aes';
import { secp256k1 } from '@noble/curves/secp256k1';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';

import type { SealedCode } from '../types/trades';

/** Bound to the envelope's `alg`, so a future scheme cannot be opened by
 *  this one by accident. */
const ALG = 'ECIES-secp256k1-AES256GCM';
const ENVELOPE_VERSION = 1;

/** Domain separation for the derived key: the same ECDH secret used for a
 *  different purpose elsewhere would otherwise produce the same AES key. */
const HKDF_INFO = new TextEncoder().encode('recoilpay/giftcard-code/v1');

const GCM_TAG_BYTES = 16;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, '');
  if (clean.length % 2 !== 0) throw new Error('hex string has an odd length');
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error('not a hex string');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** `keccak256` of the UTF-8 code — the commitment the server stores.
 *
 *  In a dispute the claimant must reveal a code that hashes to this, so
 *  neither party can substitute a different code after the fact. It hashes
 *  the code alone, deliberately: an adjudicator handed nothing but the code
 *  has to be able to reproduce it. */
export function commitToCode(code: string): string {
  return bytesToHex(keccak_256(new TextEncoder().encode(code.trim())));
}

/** Seal `code` so that only the holder of `recipientPubkeyHex` can open it. */
export function sealCode(code: string, recipientPubkeyHex: string): SealedCode {
  const plaintext = new TextEncoder().encode(code.trim());
  if (plaintext.length === 0) throw new Error('refusing to seal an empty code');

  const recipient = hexToBytes(recipientPubkeyHex);
  if (recipient.length !== 65 || recipient[0] !== 0x04) {
    throw new Error('recipient public key must be 65 bytes uncompressed (0x04…)');
  }

  const ephemeralPriv = secp256k1.utils.randomPrivateKey();
  const ephemeralPub = secp256k1.getPublicKey(ephemeralPriv, false);

  // getSharedSecret returns a 33-byte compressed point; its X coordinate is
  // the shared secret. The leading parity byte carries no entropy, so it is
  // dropped rather than fed to the KDF.
  const shared = secp256k1.getSharedSecret(ephemeralPriv, recipient, true).slice(1);
  const key = hkdf(sha256, shared, ephemeralPub, HKDF_INFO, 32);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = gcm(key, iv).encrypt(plaintext);

  // @noble's gcm appends the tag to the ciphertext. Splitting them keeps the
  // envelope readable by any standard GCM implementation.
  const ct = sealed.slice(0, sealed.length - GCM_TAG_BYTES);
  const tag = sealed.slice(sealed.length - GCM_TAG_BYTES);

  return {
    v: ENVELOPE_VERSION,
    alg: ALG,
    epk: bytesToHex(ephemeralPub),
    iv: bytesToHex(iv),
    ct: bytesToHex(ct),
    tag: bytesToHex(tag),
  };
}

/** Open an envelope addressed to `recipientPrivkeyHex`.
 *
 *  Throws if the envelope was tampered with, which is the behaviour that
 *  matters here: a silently-wrong plaintext would be redeemed, fail at the
 *  brand, and look exactly like a bad card. */
export function openCode(sealed: SealedCode, recipientPrivkeyHex: string): string {
  if (sealed.alg !== ALG) throw new Error(`unsupported envelope algorithm: ${sealed.alg}`);
  if (sealed.v !== ENVELOPE_VERSION) throw new Error(`unsupported envelope version: ${sealed.v}`);

  const priv = hexToBytes(recipientPrivkeyHex);
  const epk = hexToBytes(sealed.epk);

  const shared = secp256k1.getSharedSecret(priv, epk, true).slice(1);
  const key = hkdf(sha256, shared, epk, HKDF_INFO, 32);

  const ct = hexToBytes(sealed.ct);
  const tag = hexToBytes(sealed.tag);
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct);
  combined.set(tag, ct.length);

  return new TextDecoder().decode(gcm(key, hexToBytes(sealed.iv)).decrypt(combined));
}

/** The address a public key owns — the same derivation the server performs
 *  before it will accept a key, mirrored here so the UI can catch a mismatch
 *  before the round trip rather than after a rejection. */
export function addressFromPubkey(pubkeyHex: string): string {
  const bytes = hexToBytes(pubkeyHex);
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error('public key must be 65 bytes uncompressed (0x04…)');
  }
  return bytesToHex(keccak_256(bytes.slice(1)).slice(12));
}

/** The EIP-191 digest of a `personal_sign` message. */
export function eip191Hash(message: string): Uint8Array {
  const body = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
  const joined = new Uint8Array(prefix.length + body.length);
  joined.set(prefix);
  joined.set(body, prefix.length);
  return keccak_256(joined);
}

/** Recover the signer's uncompressed public key from an EIP-191 signature.
 *
 *  This is how a party obtains their own key to publish: sign anything with
 *  the wallet, then recover the key from the signature. No wallet RPC simply
 *  returns it, and an address cannot be reversed into one. */
export function pubkeyFromSignature(messageHash: Uint8Array, signatureHex: string): string {
  const raw = hexToBytes(signatureHex);
  if (raw.length !== 65) throw new Error('signature must be 65 bytes');
  // The last byte is v, as 27/28 — or 0/1 from some wallets.
  const v = raw[64];
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) throw new Error(`unexpected recovery byte: ${v}`);
  const sig = secp256k1.Signature.fromCompact(raw.slice(0, 64)).addRecoveryBit(recovery);
  return bytesToHex(sig.recoverPublicKey(messageHash).toRawBytes(false));
}

/** The message whose signature seeds a party's encryption key.
 *
 *  Fixed and app-wide, deliberately: the key must come out the same every
 *  time the same person signs, across trades, sessions and devices. Scoping
 *  it to a trade would mean a different key per trade, and a code sealed
 *  yesterday could not be opened today.
 *
 *  The wording is aimed at the person staring at a wallet prompt, since
 *  "sign this opaque string" is how people get phished. */
export const KEY_DERIVATION_MESSAGE = [
  'RecoilPay Gift Cards',
  '',
  'Sign to unlock your encryption key.',
  '',
  'This is not a transaction and cannot move funds. The signature never',
  'leaves your browser — it is what lets you read gift card codes sent to',
  'you, and nobody else can read them without it.',
].join('\n');

/** A party's encryption keypair, derived from their signature over
 *  [`KEY_DERIVATION_MESSAGE`].
 *
 *  The signature is hashed rather than used directly: a raw secp256k1
 *  signature is 65 bytes and structured, while a private key must be a
 *  32-byte scalar below the curve order. keccak256 gives the right size, and
 *  the retry below handles the vanishingly rare out-of-range result rather
 *  than producing an invalid key. */
export function deriveEncryptionKeypair(derivationSignatureHex: string): {
  privateKey: string;
  publicKey: string;
} {
  const sig = hexToBytes(derivationSignatureHex);
  if (sig.length !== 65) throw new Error('derivation signature must be 65 bytes');

  let seed = keccak_256(sig);
  // secp256k1 rejects 0 and anything >= n. The odds are about 2^-128, but a
  // silent throw at signing time months later is a bad way to find out.
  for (let i = 0; i < 8 && !secp256k1.utils.isValidPrivateKey(seed); i++) {
    seed = keccak_256(seed);
  }
  if (!secp256k1.utils.isValidPrivateKey(seed)) {
    throw new Error('could not derive a valid key from that signature');
  }

  return {
    privateKey: bytesToHex(seed),
    publicKey: bytesToHex(secp256k1.getPublicKey(seed, false)),
  };
}

/** The message a party signs to *publish* their encryption key.
 *
 *  Distinct from the derivation message and sent to the server, where
 *  recovering it proves the key belongs to this party on this trade. It
 *  names both, so a disclosure harvested from one trade cannot be replayed
 *  to nominate a key on another.
 *
 *  Must match `key_disclosure_message` in the Rust handler byte for byte. */
export function pubkeyDisclosureMessage(tradeId: string, publicKeyHex: string): string {
  const key = publicKeyHex.trim().toLowerCase();
  return `RecoilPay: encryption key for trade ${tradeId} is ${key}`;
}
