/* Talking to the escrow and bond contracts from the browser.
 *
 * The aggregator publishes its chain registry at `/api/v1/chains`, contract
 * addresses and token decimals included, so nothing here is hardcoded. A
 * contract redeployed on the server side is picked up without a client
 * release — which matters, because an address baked into a bundle and an
 * address in the registry drifting apart would mean locks landing in a
 * contract the server does not watch.
 */

import { keccak256, toBytes } from 'viem';

export interface ChainToken {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
}

export interface ChainInfo {
  chain_id: number;
  name: string;
  rpc_url: string;
  giftcard_escrow: string;
  merchant_bond: string;
  tokens: ChainToken[];
}

/** The on-chain identity of a trade.
 *
 *  Must match `trade_id_hash` in the Rust escrow client exactly: the
 *  aggregator keys locks by this, so a different hash here means a lock the
 *  server can never find and a trade that can never settle. */
export function tradeIdHash(tradeId: string): `0x${string}` {
  return keccak256(toBytes(tradeId));
}

/** Minimal ERC-20 surface: just what approving and reading an allowance
 *  needs. */
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export const ESCROW_ABI = [
  {
    type: 'function',
    name: 'lock',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tradeId', type: 'bytes32' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'counterparty', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isOpen',
    stateMutability: 'view',
    inputs: [{ name: 'tradeId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

export const BOND_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'merchant', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'availableBond',
    stateMutability: 'view',
    inputs: [
      { name: 'merchant', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'requestWithdrawal',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

/** `eip155:84532` → `84532`. */
export function chainIdFromCaip2(caip2: string): number | null {
  const n = Number(caip2.trim().replace(/^eip155:/, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

let cache: ChainInfo[] | null = null;

/** The registry, fetched once per page load. */
export async function loadChains(baseUrl: string): Promise<ChainInfo[]> {
  if (cache) return cache;
  const res = await fetch(`${baseUrl}/api/v1/chains`);
  if (!res.ok) throw new Error(`could not load the chain registry: ${res.status}`);
  const body = (await res.json()) as { data?: ChainInfo[] };
  cache = body.data ?? [];
  return cache;
}

export interface Settlement {
  chainId: number;
  escrow: `0x${string}`;
  bond: `0x${string}`;
  token: ChainToken;
}

/** Everything needed to lock a trade's payout, or `null` with a reason.
 *
 *  Resolving all of it up front means the UI can refuse clearly — "no escrow
 *  deployed on this chain" — instead of letting someone approve a token and
 *  then fail on the lock. */
export function resolveSettlement(
  chains: ChainInfo[],
  payoutChain: string,
  payoutAsset: string,
): { ok: Settlement } | { error: string } {
  const chainId = chainIdFromCaip2(payoutChain);
  if (chainId === null) return { error: `${payoutChain} is not a chain id we understand` };

  const chain = chains.find((c) => c.chain_id === chainId);
  if (!chain) return { error: `chain ${chainId} is not in the registry` };

  if (!chain.giftcard_escrow) {
    return { error: `no gift card escrow is deployed on ${chain.name} yet` };
  }
  if (!chain.merchant_bond) {
    return { error: `no merchant bond contract is deployed on ${chain.name} yet` };
  }

  const token =
    chain.tokens.find((t) => t.symbol.toLowerCase() === payoutAsset.toLowerCase()) ??
    chain.tokens.find((t) => t.address.toLowerCase() === payoutAsset.toLowerCase());
  if (!token) return { error: `${payoutAsset} is not a known token on ${chain.name}` };

  return {
    ok: {
      chainId,
      escrow: chain.giftcard_escrow as `0x${string}`,
      bond: chain.merchant_bond as `0x${string}`,
      token,
    },
  };
}
