import { useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";

export function useSolanaWallet() {
  const {
    publicKey,
    connected,
    sendTransaction,
    connect: walletConnect,
    disconnect: walletDisconnect,
    wallet,
  } = useWallet();
  const { connection } = useConnection();

  const connect = useCallback(async () => {
    if (wallet) await walletConnect();
  }, [wallet, walletConnect]);

  const disconnect = useCallback(async () => {
    await walletDisconnect();
  }, [walletDisconnect]);

  const signAndSend = useCallback(
    async (txData: any): Promise<string> => {
      if (!publicKey) throw new Error("Solana wallet not connected");
      
      // Attempt to decode the base64 transaction string provided by the solver or aggregator
      const txBytes = txData.transaction
        ? Buffer.from(txData.transaction, "base64")
        : txData.data
        ? Buffer.from(txData.data, "base64")
        : null;

      if (!txBytes) {
        throw new Error("No valid Solana transaction data provided");
      }

      let txObj;
      try {
        const { VersionedTransaction, Transaction } = await import("@solana/web3.js");
        // Try VersionedTransaction first
        try {
          txObj = VersionedTransaction.deserialize(txBytes);
        } catch {
          txObj = Transaction.from(txBytes);
        }
        
        const signature = await sendTransaction(txObj, connection);
        return signature;
      } catch (err: any) {
        throw new Error(`Failed to send Solana transaction: ${err.message}`);
      }
    },
    [publicKey, sendTransaction, connection]
  );

  return {
    type: "solana",
    address: publicKey ? publicKey.toString() : null,
    isConnected: connected,
    connect,
    disconnect,
    signAndSend,
  };
}
