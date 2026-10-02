/**
 * Permit2 allowance helpers.
 *
 * The OIF escrow (Permit2) flow needs the input ERC-20 to be approved for the
 * canonical Permit2 spender before an escrow order can pull funds. These helpers
 * are framework-light: reads take a viem `PublicClient`, and the approve is
 * exposed both as a plain contract-write request (use with wagmi `useWriteContract`
 * or any signer) and as a convenience that sends via a viem `WalletClient`.
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem';

/** Canonical Permit2 contract address (same on every chain). */
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address;

/** Max uint256 — used for an unlimited approval. */
export const MAX_UINT256 = (1n << 256n) - 1n;

const ERC20_ALLOWANCE_ABI = [
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const ERC20_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/**
 * Read the current Permit2 allowance the owner has granted on `token`
 * (i.e. allowance(owner, PERMIT2_ADDRESS)).
 */
export function getPermit2Allowance(
  publicClient: PublicClient,
  token: Address,
  owner: Address,
): Promise<bigint> {
  return publicClient.readContract({
    address: token,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: 'allowance',
    args: [owner, PERMIT2_ADDRESS],
  });
}

/** True if the owner's Permit2 allowance on `token` covers `required`. */
export async function hasPermit2Allowance(
  publicClient: PublicClient,
  token: Address,
  owner: Address,
  required: bigint,
): Promise<boolean> {
  const allowance = await getPermit2Allowance(publicClient, token, owner);
  return allowance >= required;
}

/**
 * Build the contract-write request to approve Permit2 to spend `token`.
 * Defaults to an unlimited (max uint256) approval. Returns a plain object you
 * can hand to wagmi `writeContract`/`useWriteContract` or viem `writeContract`.
 */
export function buildPermit2ApproveRequest(token: Address, amount: bigint = MAX_UINT256) {
  return {
    address: token,
    abi: ERC20_APPROVE_ABI,
    functionName: 'approve' as const,
    args: [PERMIT2_ADDRESS, amount] as const,
  };
}

/**
 * Send the Permit2 approval transaction via a viem `WalletClient` and return
 * the transaction hash. Defaults to an unlimited approval.
 */
export function sendPermit2Approval(
  walletClient: WalletClient,
  token: Address,
  amount: bigint = MAX_UINT256,
): Promise<Hex> {
  return walletClient.writeContract({
    address: token,
    abi: ERC20_APPROVE_ABI,
    functionName: 'approve',
    args: [PERMIT2_ADDRESS, amount],
    account: walletClient.account ?? null,
    chain: walletClient.chain,
  });
}
