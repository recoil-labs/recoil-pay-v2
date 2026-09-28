import type { Abi, Address, Hex, WalletClient } from 'viem';
import type { TypedDataSigner } from './oif/sign';

/**
 * Everything the intent flow needs from a wallet. Deliberately small so any
 * stack can supply it: wagmi, a viem WalletClient (see `viemWallet`), an
 * embedded wallet SDK, or a test double.
 */
export interface IntentWallet {
  /** The connected EVM account. */
  address: Address;
  /** Solana account, when the host also has one connected (Solana-destination swaps). */
  solanaAddress?: string | null;
  getChainId(): Promise<number>;
  switchChain(chainId: number): Promise<void>;
  /** EIP-712 signing. `types` never includes `EIP712Domain`. */
  signTypedData: TypedDataSigner;
  writeContract(req: { chainId: number; address: Address; abi: Abi; functionName: string; args: readonly unknown[] }): Promise<Hex>;
  sendTransaction(req: { chainId: number; to: Address; value: bigint }): Promise<Hex>;
}

/** Adapt a viem `WalletClient` (with an account attached) to `IntentWallet`. */
export function viemWallet(client: WalletClient): IntentWallet {
  const account = client.account;
  if (!account) throw new Error('viemWallet: the WalletClient has no account attached');

  // Transactions go to whatever chain the wallet is on; `switchChain` has
  // already moved it to the right one before any write.
  return {
    address: account.address,
    getChainId: () => client.getChainId(),
    switchChain: (id) => client.switchChain({ id }),
    signTypedData: (args) =>
      client.signTypedData({
        account,
        domain: args.domain,
        types: stripDomainType(args.types),
        primaryType: args.primaryType,
        message: args.message,
      } as Parameters<WalletClient['signTypedData']>[0]),
    writeContract: (req) =>
      client.writeContract({
        account,
        chain: null,
        address: req.address,
        abi: req.abi,
        functionName: req.functionName,
        args: req.args,
      } as Parameters<WalletClient['writeContract']>[0]),
    sendTransaction: (req) =>
      client.sendTransaction({ account, chain: null, to: req.to, value: req.value } as Parameters<WalletClient['sendTransaction']>[0]),
  };
}

/** viem rejects an `EIP712Domain` entry inside `types`; wallets add it themselves. */
export function stripDomainType(
  types: Record<string, ReadonlyArray<{ name: string; type: string }>>,
): Record<string, ReadonlyArray<{ name: string; type: string }>> {
  const out: Record<string, ReadonlyArray<{ name: string; type: string }>> = {};
  for (const [name, fields] of Object.entries(types)) if (name !== 'EIP712Domain') out[name] = fields;
  return out;
}
