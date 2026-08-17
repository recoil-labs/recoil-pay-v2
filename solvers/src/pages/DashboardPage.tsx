import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIdentities, useTelemetry, useQuotes } from '../hooks/use-solver-data';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [timeframe, setTimeframe] = useState<'1H' | '1D' | '1W'>('1D');

  const { data: identities } = useIdentities();
  const { data: telemetry } = useTelemetry();
  const { data: quotes } = useQuotes();

  const isNewSolver = identities.length === 0;
  const hasOrders = telemetry.length > 0;
  const hasQuotes = quotes.length > 0;

  const totalQuoteCapacity = quotes.reduce((acc, q) => acc + (parseFloat(q.maxAmount) || 0), 0);

  return (
    <div className="max-w-[1400px] mx-auto space-y-8 pb-8 font-sans">
      {/* Onboarding Guide Banner for New Accounts */}
      {isNewSolver && (
        <div className="bg-[#424af6]/15 border-2 border-[#424af6] rounded-2xl p-6 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 font-mono">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#424af6] flex items-center justify-center text-white shrink-0 shadow-lg shadow-[#424af6]/40">
              <span className="material-symbols-outlined text-2xl">rocket_launch</span>
            </div>
            <div>
              <div className="inline-block px-2.5 py-0.5 rounded bg-[#424af6] text-white text-[10px] font-bold uppercase tracking-wider mb-1">
                SOLVER SETUP REQUIRED
              </div>
              <h2 className="text-xl font-bold text-white font-headline">Welcome to Linkiswap! Finish Account Setup</h2>
              <p className="text-xs text-[#c6c5d9] mt-0.5 max-w-xl">
                Generate your API Key in Settings, then sign the EIP-712 registration message to pair your wallet address on Linkiswap Core.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/settings?onboarding=true')}
              className="px-6 py-3.5 bg-[#424af6] text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-xl hover:shadow-[#424af6]/40 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2 shrink-0"
            >
              <span>1. Get API Key</span>
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </button>
            <button
              onClick={() => navigate('/terminal?tab=registration')}
              className="px-6 py-3.5 bg-white/10 border border-[#454556]/40 text-white font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-white/15 transition-all flex items-center gap-2 shrink-0"
            >
              <span>2. Register Wallet</span>
              <span className="material-symbols-outlined text-base">badge</span>
            </button>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white font-headline leading-tight">
            Dashboard Overview
          </h2>
          <p className="text-[#c6c5d9] text-sm mt-1">
            Real-time performance analytics and liquidity management.
          </p>
        </div>
        <div className="flex gap-3 font-mono">
          <button
            onClick={() => navigate('/orders')}
            className="px-5 py-2.5 rounded-xl bg-[#1f2942] border border-[#454556]/30 text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2 hover:bg-[#2a344e] transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">history</span>
            Full History
          </button>
          <button
            onClick={() => navigate('/terminal?tab=submit_quotes')}
            className="px-6 py-2.5 rounded-xl bg-[#424af6] text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2 hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-[#424af6]/20"
          >
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            Submit Quote
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 font-mono">
        {/* Stat Card 1 */}
        <div className="bg-[#151f37] p-6 rounded-2xl border border-[#454556]/20 relative overflow-hidden group hover:border-[#424af6]/40 transition-all">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#424af6]/10 rounded-full -mr-8 -mt-8"></div>
          <div className="flex justify-between items-start mb-6">
            <div className="p-3 bg-[#424af6]/10 rounded-xl text-[#bfc2ff]">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                payments
              </span>
            </div>
            <span className="text-[11px] font-bold text-emerald-400 bg-emerald-400/10 px-2.5 py-0.5 rounded-full">
              {hasQuotes ? `${quotes.length} Quotes Active` : '$0.00'}
            </span>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.15em] text-[#c6c5d9] font-bold mb-1">
              {hasOrders ? 'Total Solved Volume' : 'Quote Liquidity Capacity'}
            </p>
            <h3 className="text-2xl font-bold text-white font-headline">
              {hasOrders
                ? '$4,821,092'
                : hasQuotes
                ? `$${totalQuoteCapacity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                : '$0.00'}
            </h3>
          </div>
        </div>

        {/* Stat Card 2 */}
        <div className="bg-[#151f37] p-6 rounded-2xl border border-[#454556]/20 group hover:border-[#424af6]/40 transition-all">
          <div className="flex justify-between items-start mb-6">
            <div className="p-3 bg-[#424af6]/10 rounded-xl text-[#bfc2ff]">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                request_quote
              </span>
            </div>
            <span className="text-[11px] font-bold text-[#bfc2ff] bg-[#424af6]/20 px-2.5 py-0.5 rounded-full">
              {hasQuotes ? 'Active' : 'No Quotes'}
            </span>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.15em] text-[#c6c5d9] font-bold mb-1">
              Active Quote Batches
            </p>
            <h3 className="text-2xl font-bold text-white font-headline">
              {quotes.length}
            </h3>
          </div>
        </div>

        {/* Stat Card 3 */}
        <div className="bg-[#151f37] p-6 rounded-2xl border border-[#454556]/20 group hover:border-[#424af6]/40 transition-all">
          <div className="flex justify-between items-start mb-6">
            <div className="p-3 bg-[#424af6]/10 rounded-xl text-[#bfc2ff]">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                timer
              </span>
            </div>
            <span className="text-[11px] font-bold text-emerald-400 bg-emerald-400/10 px-2.5 py-0.5 rounded-full">
              {hasOrders ? '-4ms' : '0ms'}
            </span>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.15em] text-[#c6c5d9] font-bold mb-1">
              Avg Fill Latency
            </p>
            <h3 className="text-2xl font-bold text-white font-headline">
              {hasOrders ? '142ms' : '0ms'}
            </h3>
          </div>
        </div>

        {/* Stat Card 4 */}
        <div className="bg-[#151f37] p-6 rounded-2xl border border-[#454556]/20 group hover:border-[#424af6]/40 transition-all">
          <div className="flex justify-between items-start mb-6">
            <div className="p-3 bg-[#424af6]/10 rounded-xl text-[#bfc2ff]">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                verified_user
              </span>
            </div>
            <span className="text-[11px] font-bold text-[#bfc2ff] bg-[#424af6]/20 px-2.5 py-0.5 rounded-full">
              {hasOrders ? 'Elite' : 'Active Solver'}
            </span>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.15em] text-[#c6c5d9] font-bold mb-1">
              Reputation Score
            </p>
            <h3 className="text-2xl font-bold text-white font-headline">
              100/100
            </h3>
          </div>
        </div>
      </div>

      {/* Active Quotes Overview Card */}
      {hasQuotes && (
        <div className="bg-[#151f37] p-6 rounded-2xl border border-[#454556]/20 font-mono">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h4 className="text-lg font-bold text-white font-headline">Deployed Solver Quotes</h4>
              <p className="text-xs text-[#8f8fa2] mt-0.5">Active quote matrices serving cross-chain intents</p>
            </div>
            <button
              onClick={() => navigate('/terminal?tab=submit_quotes')}
              className="text-xs text-[#bfc2ff] hover:text-white font-bold uppercase tracking-wider underline"
            >
              Manage Quotes →
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {quotes.map((q) => {
              const formatChain = (id: string) => {
                const map: Record<string, string> = {
                  'eip155:11155420': 'OP Sepolia',
                  'eip155:84532': 'Base Sepolia',
                  'eip155:11155111': 'Ethereum Sepolia',
                  'eip155:42161': 'Arbitrum One',
                  'eip155:80002': 'Polygon Amoy',
                  'solana:devnet': 'Solana Devnet'
                };
                return map[id] || id;
              };
              const formatAsset = (addr: string) => addr.startsWith('0x') || addr.length > 20 ? 'USDC' : addr;
              
              return (
              <div key={q.id} className="p-4 rounded-xl bg-[#1f2942] border border-[#454556]/30 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-white">
                    {formatChain(q.fromChainNetworkId).split(' ')[0]} → {formatChain(q.toChainNetworkId).split(' ')[0]}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">
                    ACTIVE
                  </span>
                </div>
                <div className="text-[11px] text-[#c6c5d9] flex justify-between">
                  <span>Range: {q.minAmount} - {q.maxAmount} {formatAsset(q.fromAssetAddress)}</span>
                  <span className="text-emerald-400 font-bold">Rate: {q.quote}</span>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Large Bar Chart */}
        <div className="lg:col-span-2 bg-[#151f37] p-8 rounded-2xl border border-[#454556]/20">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h4 className="text-lg font-bold text-white font-headline">Historical Order Volume</h4>
              <p className="text-xs text-[#c6c5d9] mt-0.5">Last 24 hours activity</p>
            </div>
            <div className="flex p-1 bg-[#2a344e] rounded-xl gap-1 font-mono">
              {(['1H', '1D', '1W'] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-3 py-1 text-[10px] font-bold uppercase rounded-lg transition-all ${
                    timeframe === tf
                      ? 'bg-[#424af6] text-white shadow-md'
                      : 'text-[#c6c5d9] hover:text-white'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {!hasOrders ? (
            <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-[#454556]/30 rounded-xl p-6 text-center font-mono">
              <span className="material-symbols-outlined text-4xl text-[#8f8fa2] mb-2">bar_chart</span>
              <p className="text-sm font-bold text-white">
                {hasQuotes ? `${quotes.length} Active Quote Matrix Deployed` : 'No Intent Volume Yet'}
              </p>
              <p className="text-xs text-[#8f8fa2] mt-1 max-w-sm">
                {hasQuotes
                  ? 'Your active quote liquidity is registered on Linkiswap Core. Intent fills will stream live volume here.'
                  : 'Submit quotes and process cross-chain intents to stream live performance volume here.'}
              </p>
              {!hasQuotes && (
                <button
                  onClick={() => navigate('/terminal?tab=submit_quotes')}
                  className="mt-4 px-6 py-2.5 bg-[#424af6] text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-[#424af6]/20"
                >
                  Submit First Quote →
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="h-64 flex items-end gap-2 px-2">
                {[40, 55, 30, 70, 85, 95, 60, 45, 75, 50, 65, 80].map((h, i) => (
                  <div
                    key={i}
                    className={`flex-grow transition-all cursor-pointer relative group rounded-t-lg ${
                      i === 5
                        ? 'bg-[#424af6]/40 border-t-2 border-[#424af6]'
                        : 'bg-[#424af6]/20 hover:bg-[#424af6]/40'
                    }`}
                    style={{ height: `${h}%` }}
                  >
                    <div className="absolute -top-8 left-1/2 -translate-y-1/2 bg-[#2a344e] px-2 py-1 rounded text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                      ${(h * 15).toFixed(0)}k
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-between mt-6 px-2 text-[10px] font-bold text-[#8f8fa2] uppercase tracking-widest font-mono">
                <span>08:00</span>
                <span>12:00</span>
                <span>16:00</span>
                <span>20:00</span>
                <span className="text-[#bfc2ff]">Now</span>
              </div>
            </>
          )}
        </div>

        {/* Circular Progress Card */}
        <div className="bg-[#151f37] p-8 rounded-2xl border border-[#454556]/20 flex flex-col">
          <h4 className="text-lg font-bold text-white font-headline mb-8 font-mono">Success Ratio</h4>
          <div className="flex-grow flex flex-col justify-center items-center font-mono">
            <div className="relative w-48 h-48">
              <svg className="w-full h-full transform -rotate-90">
                <circle
                  className="text-[#2a344e]"
                  cx="96"
                  cy="96"
                  fill="transparent"
                  r="80"
                  stroke="currentColor"
                  strokeWidth="12"
                />
                <circle
                  className="text-[#424af6]"
                  cx="96"
                  cy="96"
                  fill="transparent"
                  r="80"
                  stroke="currentColor"
                  strokeDasharray="502.4"
                  strokeDashoffset={!hasOrders ? '502.4' : '25.12'}
                  strokeLinecap="round"
                  strokeWidth="12"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-white font-headline leading-none">
                  {!hasOrders ? '0%' : '95%'}
                </span>
                <span className="text-[10px] font-bold text-[#bfc2ff] uppercase tracking-widest mt-2">
                  {!hasOrders ? (hasQuotes ? 'Quotes Ready' : 'No Fills Yet') : 'Success'}
                </span>
              </div>
            </div>

            <div className="w-full mt-8 space-y-3 font-mono">
              <div className="flex justify-between items-center p-3 rounded-xl bg-[#1f2942] border border-[#454556]/20">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#424af6]"></div>
                  <span className="text-xs font-semibold text-[#dae2ff]">Active Quote Batches</span>
                </div>
                <span className="text-xs font-bold text-white">{quotes.length}</span>
              </div>

              <div className="flex justify-between items-center p-3 rounded-xl bg-[#1f2942] border border-[#454556]/20">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#ffb4ab]"></div>
                  <span className="text-xs font-semibold text-[#dae2ff]">Timed Out Fills</span>
                </div>
                <span className="text-xs font-bold text-white">0</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
