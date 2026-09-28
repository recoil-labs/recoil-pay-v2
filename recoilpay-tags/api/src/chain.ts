import { createPublicClient, http, type Chain, type PublicClient } from 'viem';
import { arbitrum, base, mainnet, optimism, polygon } from 'viem/chains';
import type { Verifier } from './registry.ts';

const CHAINS: Chain[] = [mainnet, base, arbitrum, optimism, polygon];

const clients = new Map<number, PublicClient>(
  CHAINS.map((chain) => [
    chain.id,
    // RPC_URL_<chainId> overrides viem's public endpoint, which is fine for
    // a few verifications a minute but rate-limits under a launch spike.
    createPublicClient({ chain, transport: http(process.env[`RPC_URL_${chain.id}`], { timeout: 8_000 }) }) as PublicClient,
  ]),
);

/**
 * Verifies against the chain the wallet signed on. viem's verifyMessage
 * checks plain EOA signatures locally and falls back to ERC-1271 / ERC-6492
 * on-chain, which is what smart wallets (Coinbase Smart Wallet, Safe) need.
 */
export const verifySignature: Verifier = async ({ address, message, signature, chainId }) => {
  // A wallet sitting on a chain we don't list still signs a valid EOA
  // message; that check is local, so any client will do for it.
  const client = clients.get(chainId) ?? clients.get(mainnet.id)!;
  return client.verifyMessage({ address, message, signature });
};

const ensCache = new Map<string, { name: string | null; at: number }>();
const ENS_TTL_MS = 60 * 60 * 1000;

/** Primary ENS name for an address, or null. Never throws and never waits long. */
export async function ensName(address: string): Promise<string | null> {
  const hit = ensCache.get(address);
  if (hit && Date.now() - hit.at < ENS_TTL_MS) return hit.name;
  const lookup = clients
    .get(mainnet.id)!
    .getEnsName({ address: address as `0x${string}` })
    .catch(() => null);
  const name = await Promise.race([lookup, new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
  ensCache.set(address, { name, at: Date.now() });
  return name;
}
