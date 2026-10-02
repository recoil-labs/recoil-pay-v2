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
 * Why secp256k1 rather than a fresh keypair the app manages: both parties
 * already hold one — it is how they authenticate — so there is no new key to
 * distribute, store or lose. The cost is that a public key must be obtained
 * explicitly, because an Ethereum address is a hash of one and cannot be
 * reversed; the recipient supplies theirs when they fund escrow, and the
 * server verifies it against their address before storing it.
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

/** The message a party signs to publish their public key. Includes the trade
 *  id so a signature harvested from one trade cannot be replayed to nominate
 *  a key on another. */
export function pubkeyDisclosureMessage(tradeId: string): string {
  return `RecoilPay: publish my encryption key for trade ${tradeId}`;
}
