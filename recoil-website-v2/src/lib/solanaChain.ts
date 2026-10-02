/**
 * Solana chain constants and helpers used by the recoilpay UI.
 *
 * The virtual chain IDs here must match `solver_types::virtual_chain_ids`
 * in the Rust solver backend.
 */

// ── Virtual chain IDs ─────────────────────────────────────────────────────────

/** Virtual chain ID for Solana mainnet (internal solver routing only). */
export const SOLANA_MAINNET_CHAIN_ID = 9_000_000_001;

/** Virtual chain ID for Solana devnet (internal solver routing only). */
export const SOLANA_DEVNET_CHAIN_ID = 9_000_000_002;

// ── Network metadata ──────────────────────────────────────────────────────────

export interface SolanaNetworkInfo {
  name: string;
  chainId: number;
  rpcUrl: string;
  isTestnet: boolean;
  nativeCurrency: { symbol: string; decimals: number };
}

export const SOLANA_NETWORKS: Record<number, SolanaNetworkInfo> = {
  [SOLANA_MAINNET_CHAIN_ID]: {
    name: "Solana",
    chainId: SOLANA_MAINNET_CHAIN_ID,
    rpcUrl: "https://api.mainnet-beta.solana.com",
    isTestnet: false,
    nativeCurrency: { symbol: "SOL", decimals: 9 },
  },
  [SOLANA_DEVNET_CHAIN_ID]: {
    name: "Solana Devnet",
    chainId: SOLANA_DEVNET_CHAIN_ID,
    rpcUrl: "https://api.devnet.solana.com",
    isTestnet: true,
    nativeCurrency: { symbol: "SOL", decimals: 9 },
  },
};

/** Returns true when a virtual chain ID belongs to Solana. */
export function isSolanaChainId(chainId: number): boolean {
  return chainId === SOLANA_MAINNET_CHAIN_ID || chainId === SOLANA_DEVNET_CHAIN_ID;
}

// ── Well-known SPL token mints ────────────────────────────────────────────────

export const SPL_MINTS: Record<"mainnet" | "devnet", Record<string, string>> = {
  mainnet: {
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    SOL: "So11111111111111111111111111111111111111112", // Wrapped SOL
  },
  devnet: {
    USDC: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    SOL: "So11111111111111111111111111111111111111112",
  },
};

// ── Solver payload builder ────────────────────────────────────────────────────

/**
 * Builds the JSON payload that the solver's `SolanaDelivery` expects inside
 * `Transaction.data` for a native SOL transfer.
 */
export function buildSolTransferPayload(
  recipient: string,
  lamports: bigint
): object {
  return {
    kind: "sol",
    recipient,
    lamports: lamports.toString(),
  };
}

/**
 * Builds the JSON payload for an SPL-token transfer (e.g., USDC on Solana).
 */
export function buildSplTransferPayload(
  recipient: string,
  mint: string,
  amount: bigint,
  decimals: number
): object {
  return {
    kind: "spl",
    recipient,
    mint,
    amount: amount.toString(),
    decimals,
  };
}

// ── Amount helpers ────────────────────────────────────────────────────────────

/** Convert SOL (as a decimal string) to lamports. */
export function solToLamports(sol: string): bigint {
  const [whole, frac = ""] = sol.split(".");
  const fracPadded = frac.padEnd(9, "0").slice(0, 9);
  return BigInt(whole) * BigInt(1_000_000_000) + BigInt(fracPadded);
}

/** Convert lamports to SOL string (e.g. "1.5"). */
export function lamportsToSol(lamports: bigint): string {
  const sol = lamports / BigInt(1_000_000_000);
  const rem = lamports % BigInt(1_000_000_000);
  return `${sol}.${rem.toString().padStart(9, "0").replace(/0+$/, "") || "0"}`;
}

/** Convert USDC (6 decimals) amount string to smallest unit. */
export function usdcToSmallestUnit(usdc: string): bigint {
  const [whole, frac = ""] = usdc.split(".");
  const fracPadded = frac.padEnd(6, "0").slice(0, 6);
  return BigInt(whole) * BigInt(1_000_000) + BigInt(fracPadded);
}

// ── Chain name resolver ───────────────────────────────────────────────────────

/**
 * Converts user-facing chain name strings to their virtual chain IDs.
 * Used by the intent parser to map "solana" → 9000000002 (devnet) or
 * 9000000001 (mainnet) based on environment.
 *
 * @param name - Chain name as typed by the user (case-insensitive).
 * @param useDevnet - If true, resolves to devnet IDs (default: false for mainnet).
 */
export function solanaNameToChainId(
  name: string,
  useDevnet = false
): number | null {
  const lower = name.toLowerCase().trim();
  if (["solana", "sol", "solana mainnet"].includes(lower)) {
    return useDevnet ? SOLANA_DEVNET_CHAIN_ID : SOLANA_MAINNET_CHAIN_ID;
  }
  if (["solana devnet", "sol devnet", "solana-devnet"].includes(lower)) {
    return SOLANA_DEVNET_CHAIN_ID;
  }
  return null;
}
