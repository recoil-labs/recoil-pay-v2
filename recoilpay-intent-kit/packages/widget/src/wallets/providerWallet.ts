import { stripDomainType, type IntentWallet } from '@recoilpay/intent-core';
import { createClient, custom, getAddress, type Address, type EIP1193Provider } from 'viem';
import { addChain, getChainId, sendTransaction, signTypedData, switchChain, writeContract } from 'viem/actions';
import { chainById } from './chains';

/** First account the provider exposes. `prompt` shows the wallet's connect dialog. */
export async function requestAccount(provider: EIP1193Provider, prompt: boolean): Promise<Address | null> {
  const accounts = (await provider.request({ method: prompt ? 'eth_requestAccounts' : 'eth_accounts' } as never)) as string[];
  return accounts?.[0] ? getAddress(accounts[0]) : null;
}

/**
 * Whether an error means "this wallet doesn't know that chain" (EIP-3326
 * code 4902). Wallets nest it differently — MetaMask Mobile wraps it in a
 * -32603 with `data.originalError` — so look through the whole cause chain.
 */
export function isUnknownChainError(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 6; depth++) {
    if (e.code === 4902 || e.data?.originalError?.code === 4902) return true;
    if (typeof e.message === 'string' && /unrecognized chain|unknown chain|chain .* not (added|configured)/i.test(e.message)) return true;
    e = e.cause;
  }
  return false;
}

/**
 * An `IntentWallet` over any EIP-1193 provider (an injected extension, a
 * WalletConnect session, or one the host page hands us). Switching to a
 * chain the wallet doesn't have adds it first.
 *
 * Built from a bare viem client and individual actions — createWalletClient
 * would pull every wallet action into the bundle.
 */
export function providerWallet(provider: EIP1193Provider, address: Address): IntentWallet {
  const client = createClient({ account: address, transport: custom(provider) });
  const doSwitch = (id: number) => switchChain(client, { id });

  return {
    address,
    getChainId: () => getChainId(client),
    async switchChain(chainId) {
      try {
        await doSwitch(chainId);
      } catch (err) {
        const chain = chainById(chainId);
        if (!chain || !isUnknownChainError(err)) throw err;
        await addChain(client, { chain });
        // Most wallets switch as part of adding; asking again is harmless
        // for them and needed for the ones that don't.
        await doSwitch(chainId);
      }
    },
    signTypedData: (args) =>
      signTypedData(client, {
        account: address,
        domain: args.domain,
        types: stripDomainType(args.types),
        primaryType: args.primaryType,
        message: args.message,
      } as Parameters<typeof signTypedData>[1]),
    writeContract: (req) =>
      writeContract(client, {
        account: address,
        chain: null,
        address: req.address,
        abi: req.abi,
        functionName: req.functionName,
        args: req.args,
      } as Parameters<typeof writeContract>[1]),
    sendTransaction: (req) =>
      sendTransaction(client, { account: address, chain: null, to: req.to, value: req.value } as Parameters<typeof sendTransaction>[1]),
  };
}
