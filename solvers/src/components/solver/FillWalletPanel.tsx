import React, { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { createPublicClient, erc20Abi, formatUnits, http } from 'viem';
import { SolverApiService, type ChainInfoDto } from '../../services/solverApi';

/**
 * Fill-wallet funding panel.
 *
 * The aggregator generated a hot-wallet for this operator at
 * registration (the key stays encrypted server-side). Every settlement
 * transaction — escrowing the user's input, delivering the output,
 * claiming the escrow — is signed by that wallet, so it needs:
 *
 *  - native gas on EVERY chain the operator quotes (origin + destination),
 *  - output-token inventory on each destination chain.
 *
 * Balances are read client-side straight from each chain's RPC (from the
 * aggregator's chain registry), so what's shown is the on-chain truth.
 */

interface TokenBalance {
  symbol: string;
  decimals: number;
  balance: bigint | null;
}

interface ChainBalances {
  chain: ChainInfoDto;
  native: bigint | null;
  tokens: TokenBalance[];
}

export const FillWalletPanel: React.FC = () => {
  const { address } = useAccount();
  const solverId = address
    ? `solver-${address.toLowerCase().replace(/^0x/, '')}`
    : undefined;

  const [fillWallet, setFillWallet] = useState<string | null>(null);
  const [balances, setBalances] = useState<ChainBalances[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!solverId) return;
    setLoading(true);
    setError(null);
    try {
      const [operator, chains] = await Promise.all([
        SolverApiService.getOperator(solverId),
        SolverApiService.getChains(),
      ]);
      const wallet = operator?.fillWalletAddress;
      if (!wallet) {
        setError('No fill-wallet on record — re-register to generate one.');
        setLoading(false);
        return;
      }
      setFillWallet(wallet);

      const results = await Promise.all(
        chains.map(async (chain): Promise<ChainBalances> => {
          const client = createPublicClient({ transport: http(chain.rpc_url) });
          const native = await client
            .getBalance({ address: wallet as `0x${string}` })
            .catch(() => null);
          const tokens = await Promise.all(
            chain.tokens.map(async (t): Promise<TokenBalance> => ({
              symbol: t.symbol,
              decimals: t.decimals,
              balance: await client
                .readContract({
                  address: t.address as `0x${string}`,
                  abi: erc20Abi,
                  functionName: 'balanceOf',
                  args: [wallet as `0x${string}`],
                })
                .catch(() => null),
            })),
          );
          return { chain, native, tokens };
        }),
      );
      setBalances(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load balances');
    } finally {
      setLoading(false);
    }
  }, [solverId]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyAddress = async () => {
    if (!fillWallet) return;
    await navigator.clipboard.writeText(fillWallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fmtNative = (v: bigint | null) =>
    v === null ? '—' : Number(formatUnits(v, 18)).toFixed(4);
  const fmtToken = (t: TokenBalance) =>
    t.balance === null ? '—' : Number(formatUnits(t.balance, t.decimals)).toFixed(2);

  return (
    <div className="space-y-8 font-sans">
      <div className="glass-panel rounded-2xl p-6 md:p-8 flex flex-col gap-6 shadow-2xl bg-[#151f37]/80 border border-[#454556]/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#424af6]/10 flex items-center justify-center text-[#bfc2ff]">
              <span className="material-symbols-outlined text-3xl">account_balance_wallet</span>
            </div>
            <h3 className="font-headline text-2xl font-bold text-white">Fund your fill-wallet</h3>
          </div>
          <button
            onClick={() => void load()}
            className="text-xs text-[#bfc2ff] bg-[#424af6]/10 border border-[#424af6]/20 px-3 py-1.5 rounded-lg hover:bg-[#424af6]/20"
          >
            Refresh
          </button>
        </div>

        <div className="bg-[#111b33]/50 border border-[#454556]/20 rounded-xl p-4 text-xs text-[#c6c5d9] leading-relaxed">
          <p>
            <b className="text-white">This wallet executes your fills.</b> The aggregator holds its
            key (encrypted) and signs settlement transactions with it on your behalf. For fills to
            succeed it needs <b className="text-white">native gas on every chain you quote</b> and{' '}
            <b className="text-white">token inventory on each destination chain</b>. Send funds to
            the address below — balances update straight from the chain.
          </p>
        </div>

        {fillWallet && (
          <div className="flex items-center gap-3 bg-[#08122a] border border-[#454556]/40 rounded-xl px-4 py-3">
            <span className="font-mono text-sm text-white break-all">{fillWallet}</span>
            <button
              onClick={() => void copyAddress()}
              className="ml-auto shrink-0 text-xs text-[#bfc2ff] bg-[#424af6]/10 border border-[#424af6]/20 px-3 py-1.5 rounded-lg hover:bg-[#424af6]/20"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-xs text-[#8f8fa2]">Reading on-chain balances…</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {balances.map(({ chain, native, tokens }) => {
              const noGas = native !== null && native === 0n;
              const noInventory =
                tokens.length > 0 && tokens.every((t) => t.balance === 0n);
              return (
                <div
                  key={chain.chain_id}
                  className="bg-[#111b33]/50 border border-[#454556]/20 rounded-xl p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-white">{chain.name}</span>
                    <span className="font-mono text-[10px] text-[#8f8fa2]">
                      eip155:{chain.chain_id}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-[#8f8fa2]">Gas (native)</span>
                    <span className={noGas ? 'text-red-300' : 'text-white'}>
                      {fmtNative(native)}
                    </span>
                  </div>
                  {tokens.map((t) => (
                    <div key={t.symbol} className="flex justify-between text-xs font-mono">
                      <span className="text-[#8f8fa2]">{t.symbol}</span>
                      <span className={t.balance === 0n ? 'text-yellow-300' : 'text-white'}>
                        {fmtToken(t)}
                      </span>
                    </div>
                  ))}
                  {noGas && (
                    <p className="text-[10px] text-red-300">
                      No gas — settlement transactions on this chain will fail.
                    </p>
                  )}
                  {noInventory && !noGas && (
                    <p className="text-[10px] text-yellow-300">
                      No token inventory — fills paying out on this chain will fail.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
