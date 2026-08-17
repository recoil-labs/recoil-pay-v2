/**
 * Unified wallet abstraction for multi-chain support.
 * Each chain type implements this interface to provide a consistent API
 * for connecting wallets and signing transactions.
 */
export interface WalletAdapter {
  type: string;
  address: string | null;
  isConnected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Sign and broadcast a transaction. Returns the tx hash/signature. */
  signAndSend(txData: any): Promise<string>;
}
