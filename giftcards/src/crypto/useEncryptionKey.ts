import { useCallback, useRef } from 'react';
import { useSignMessage } from 'wagmi';
import {
  KEY_DERIVATION_MESSAGE,
  deriveEncryptionKeypair,
  pubkeyDisclosureMessage,
} from './sealedCode';

/** A party's encryption keypair plus the proof it is theirs. */
export interface DisclosedKey {
  publicKey: string;
  /** Signature over the disclosure message, for the server. */
  signature: string;
}

/* Deriving and using the encryption key.
 *
 * Two different signatures, and conflating them would be a serious bug:
 *
 * - The *derivation* signature seeds the private key. It never leaves the
 *   browser and is never sent anywhere. A server holding it could decrypt
 *   every code on the platform.
 * - The *disclosure* signature names the resulting public key and a trade,
 *   and goes to the server as proof the key belongs to this party. It
 *   reveals nothing that helps decrypt.
 *
 * The derived private key is cached for the session so a person is not
 * prompted to sign on every action. It is held in a ref rather than written
 * to localStorage: a key on disk outlives the tab and is readable by anything
 * that can run script on this origin, which is exactly the hoard this design
 * exists to avoid. Re-deriving costs one wallet prompt.
 */
export function useEncryptionKey() {
  const { signMessageAsync } = useSignMessage();
  const cached = useRef<{ privateKey: string; publicKey: string } | null>(null);

  /** Derive (or reuse) this session's keypair. Prompts the wallet once. */
  const unlock = useCallback(async () => {
    if (cached.current) return cached.current;
    const signature = await signMessageAsync({ message: KEY_DERIVATION_MESSAGE });
    const pair = deriveEncryptionKeypair(signature);
    cached.current = pair;
    return pair;
  }, [signMessageAsync]);

  /** Derive the keypair and sign the disclosure for `tradeId`.
   *
   *  Two wallet prompts the first time: one to unlock, one to disclose. */
  const discloseFor = useCallback(
    async (tradeId: string): Promise<DisclosedKey> => {
      const { publicKey } = await unlock();
      const signature = await signMessageAsync({
        message: pubkeyDisclosureMessage(tradeId, publicKey),
      });
      return { publicKey, signature };
    },
    [unlock, signMessageAsync],
  );

  return { unlock, discloseFor };
}
