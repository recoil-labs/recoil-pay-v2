import { useAccount, useSignMessage } from 'wagmi';
import { manageMessage, reservationMessage } from '../../../shared/tag.ts';
import type { SignedRequest } from '../lib/api.ts';

/**
 * Builds the exact message the API will rebuild and asks the wallet to sign
 * it. Nothing is sent on-chain; the chain id only tells the API where to
 * check a smart-wallet signature.
 */
export function useSignTag(kind: 'reserve' | 'manage') {
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();

  return async (tag: string): Promise<SignedRequest> => {
    if (!address) throw new Error('Connect a wallet first');
    const fields = { tag, address, chainId: chainId ?? 1, issuedAt: new Date().toISOString(), origin: window.location.origin };
    const message = (kind === 'reserve' ? reservationMessage : manageMessage)(fields);
    const signature = await signMessageAsync({ message });
    return { ...fields, signature };
  };
}

/** Wallets report a declined signature in several shapes; all mean the same. */
export const isUserRejection = (err: unknown) =>
  /user rejected|user denied|rejected the request|cancel/i.test(String((err as { shortMessage?: string; message?: string })?.shortMessage ?? (err as Error)?.message ?? ''));
