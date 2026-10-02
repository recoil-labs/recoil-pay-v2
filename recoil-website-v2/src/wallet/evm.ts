import { useCallback } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { getWalletClient } from '@wagmi/core';
import { wagmiConfig } from './config';
import type { WalletAdapter } from './types';

export function useEvmWallet(): WalletAdapter {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();

  const connect = useCallback(async () => {
    const connector = connectors[0];
    if (connector) await connectAsync({ connector });
  }, [connectAsync, connectors]);

  const disconnect = useCallback(async () => {
    await disconnectAsync();
  }, [disconnectAsync]);

  const signAndSend = useCallback(async (txData: any): Promise<string> => {
    if (!address) throw new Error('Wallet not connected');

    const walletClient = await getWalletClient(wagmiConfig);
    if (!walletClient) throw new Error('Wallet client not available');

    const tx: any = {
      account: address,
      to: txData.to as `0x${string}`,
      value: txData.value ? BigInt(txData.value) : BigInt(0),
    };
    if (txData.data) tx.data = txData.data;

    const hash = await walletClient.sendTransaction(tx);
    return hash;
  }, [address]);

  return {
    type: 'evm',
    address: address ?? null,
    isConnected,
    connect,
    disconnect,
    signAndSend,
  };
}
