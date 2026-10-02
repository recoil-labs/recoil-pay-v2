import { parseUnits, getAddress } from 'viem';
import type { RawIntent, ResolvedIntent } from './types';
import { normalizeToken, normalizeChain, findAsset, type SupportedSet } from './registry';

/**
 * Resolve a validated RawIntent into a ResolvedIntent (canonical addresses, chain
 * ids, base-unit amount). PRECONDITION: validateIntent(raw, supported) returned [].
 * Throws if that precondition is violated.
 */
export function resolveIntent(
  raw: RawIntent,
  supported: SupportedSet,
  user: string,
  solanaUser?: string | null,
): ResolvedIntent {
  const chainIn = normalizeChain(raw.chainIn);
  const symIn = normalizeToken(raw.tokenIn);
  if (!chainIn || typeof chainIn.id !== 'number' || !symIn || !raw.amount) {
    throw new Error('resolveIntent called on an unvalidated/invalid intent');
  }
  const srcChainId = chainIn.id;
  const inAsset = findAsset(supported, srcChainId, symIn);
  if (!inAsset) throw new Error(`No supported asset for ${symIn} on ${chainIn.name}`);

  const inputToken = isSolana(srcChainId) ? inAsset.address : getAddress(inAsset.address);
  const inputAmount = parseUnits(raw.amount, inAsset.decimals);

  let dstChainId: number;
  let outputToken: string;
  let recipient: string;

  if (raw.action === 'swap') {
    const chainOut = normalizeChain(raw.chainOut);
    const symOut = normalizeToken(raw.tokenOut);
    if (!chainOut || typeof chainOut.id !== 'number' || !symOut) {
      throw new Error('resolveIntent: unresolved destination on a swap');
    }
    dstChainId = chainOut.id;
    const outAsset = findAsset(supported, dstChainId, symOut);
    if (!outAsset) throw new Error(`No supported asset for ${symOut} on ${chainOut.name}`);
    outputToken = isSolana(dstChainId) ? outAsset.address : getAddress(outAsset.address);
    recipient = raw.recipient 
      ? (isSolana(dstChainId) ? raw.recipient : getAddress(raw.recipient))
      : (isSolana(dstChainId) ? (solanaUser ?? user) : user);
  } else {
    if (!raw.recipient) throw new Error('resolveIntent: send without recipient');
    
    // Cross-chain send if chainOut is specified
    if (raw.chainOut) {
      const chainOut = normalizeChain(raw.chainOut);
      if (!chainOut || typeof chainOut.id !== 'number') {
        throw new Error('resolveIntent: unresolved destination chain on a send');
      }
      dstChainId = chainOut.id;
    } else {
      dstChainId = srcChainId;
    }

    if (raw.tokenOut) {
      const symOut = normalizeToken(raw.tokenOut);
      if (!symOut) throw new Error('resolveIntent: unresolved destination token on a send');
      const outAsset = findAsset(supported, dstChainId, symOut);
      if (!outAsset) throw new Error(`No supported asset for ${symOut} on destination chain`);
      outputToken = isSolana(dstChainId) ? outAsset.address : getAddress(outAsset.address);
    } else {
      if (dstChainId !== srcChainId) {
        const outAsset = findAsset(supported, dstChainId, symIn);
        if (!outAsset) throw new Error(`No supported asset for ${symIn} on destination chain`);
        outputToken = isSolana(dstChainId) ? outAsset.address : getAddress(outAsset.address);
      } else {
        outputToken = inputToken;
      }
    }
    
    recipient = isSolana(dstChainId) ? raw.recipient : getAddress(raw.recipient);
  }

  return {
    action: raw.action,
    user,
    srcChainId,
    dstChainId,
    inputToken,
    inputDecimals: inAsset.decimals,
    inputAmount,
    outputToken,
    recipient,
  };
}

function isSolana(chainId: number): boolean {
  return chainId === 9000000001 || chainId === 9000000002;
}
