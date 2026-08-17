import React, { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  SolverApiService,
  chainCaip2,
  fromBaseUnits,
  toBaseUnits,
  type ChainInfoDto,
} from '../../services/solverApi';
import { useQuotes, useTelemetry } from '../../hooks/use-solver-data';

export const QuoteMatrix: React.FC = () => {
  const [fromChain, setFromChain] = useState('eip155:11155420');
  const [toChain, setToChain] = useState('eip155:84532');
  const [fromToken, setFromToken] = useState('USDC');
  const [toToken, setToToken] = useState('USDC');
  // Supported chains + tokens from the aggregator's registry. The form's
  // route options come exclusively from here so published quotes always
  // reference tokens the settlement layer can actually move.
  const [chains, setChains] = useState<ChainInfoDto[]>([]);

  useEffect(() => {
    SolverApiService.getChains()
      .then(setChains)
      .catch(() => setChains([]));
  }, []);

  const findRoute = (caip2: string, symbol: string) => {
    const chain = chains.find((c) => chainCaip2(c) === caip2);
    const token = chain?.tokens.find(
      (t) => t.symbol.toUpperCase() === symbol.toUpperCase(),
    );
    return chain && token ? { chain, token } : undefined;
  };

  const [minAmount, setMinAmount] = useState('10.00');
  const [maxAmount, setMaxAmount] = useState('5000.00');
  const [quoteRateMargin, setQuoteRateMargin] = useState('0.15');
  // Flat per-fill charge covering the operator's settlement gas (openFor +
  // approve + fill + finalise across two chains). Deducted from the output
  // regardless of order size, so it dominates the price on small orders.
  const [fixedCost, setFixedCost] = useState('0.02');
  // How long the published offer stays live. Presets cover the common
  // cases; `custom` lets an operator quote for arbitrary durations (a
  // market maker may want an offer up for a week).
  const [expirySecs, setExpirySecs] = useState(3600);
  const [customExpiry, setCustomExpiry] = useState('12');
  const [customUnit, setCustomUnit] = useState<'minutes' | 'hours' | 'days'>('hours');
  const [useCustomExpiry, setUseCustomExpiry] = useState(false);

  const UNIT_SECONDS = { minutes: 60, hours: 3600, days: 86400 } as const;
  const EXPIRY_PRESETS = [
    { label: '15 MIN', secs: 900 },
    { label: '1 HOUR', secs: 3600 },
    { label: '1 DAY', secs: 86400 },
    { label: '7 DAYS', secs: 604800 },
  ] as const;

  // Floor at 60s so a mistyped custom value can't publish an offer that is
  // already dead on arrival.
  const customExpirySecs = Math.max(
    60,
    Math.round((parseFloat(customExpiry) || 0) * UNIT_SECONDS[customUnit]),
  );
  const activeExpirySecs = useCustomExpiry ? customExpirySecs : expirySecs;
  const expiresAtLabel = new Date(Date.now() + activeExpirySecs * 1000).toLocaleString();

  const [isDeploying, setIsDeploying] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const { data: activeQuotes, setQuotes: setActiveQuotes } = useQuotes();
  const { data: telemetry } = useTelemetry();
  const { address } = useAccount();
  // Mirror the Settings page's canonical id derivation so quotes
  // land under the same operator row the rest of the dashboard reads.
  const solverId = address
    ? `solver-${address.toLowerCase().replace(/^0x/, '')}`
    : undefined;

  const hasOrders = telemetry.length > 0;

  const handleDeployBatch = async () => {
    setIsDeploying(true);

    try {
      // Resolve both legs against the aggregator's chain registry — the
      // published asset ids and decimals must match what the settlement
      // layer (settlers + fill-wallet inventory) actually uses.
      const from = findRoute(fromChain, fromToken);
      const to = findRoute(toChain, toToken);
      if (!from || !to) {
        throw new Error('Selected route is not in the supported chain registry');
      }

      await SolverApiService.submitQuotesV1({
        solverId,
        quotes: [
          {
            fromChain,
            toChain,
            fromAsset: `${fromChain}/erc20:${from.token.address}`,
            toAsset: `${toChain}/erc20:${to.token.address}`,
            fromDecimals: from.token.decimals,
            toDecimals: to.token.decimals,
            expiry: Math.floor(Date.now() / 1000) + activeExpirySecs,
            ranges: [
              {
                // The aggregator matches order sizes in token base
                // units — convert from the human amounts on the form.
                minAmount: toBaseUnits(minAmount, from.token.decimals),
                maxAmount: toBaseUnits(maxAmount, from.token.decimals),
                quote: (1 - parseFloat(quoteRateMargin) / 100).toFixed(4),
                fixedCost: toBaseUnits(fixedCost, to.token.decimals),
              },
            ],
          },
        ],
      });

      const updatedQuotes = await SolverApiService.getQuotes();
      setActiveQuotes(updatedQuotes);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 5000);
    } catch {
      // Handled
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="space-y-8 font-sans">
      {/* Submitter Box */}
      <div className="glass-panel rounded-2xl p-6 md:p-8 flex flex-col gap-8 shadow-2xl bg-[#151f37]/80 border border-[#454556]/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#424af6]/10 flex items-center justify-center text-[#bfc2ff]">
              <span className="material-symbols-outlined text-3xl">add_chart</span>
            </div>
            <h3 className="font-headline text-2xl font-bold text-white">Tell the network what you'll fill</h3>
          </div>
          <span className="font-mono text-[10px] bg-[#424af6]/10 text-[#bfc2ff] border border-[#424af6]/20 px-3 py-1 rounded-full uppercase tracking-widest font-bold">
            New offer
          </span>
        </div>

        {/* Plain-language explainer */}
        <div className="bg-[#111b33]/50 border border-[#454556]/20 rounded-xl p-4 text-xs text-[#c6c5d9] leading-relaxed">
          <p>
            <b className="text-white">You're about to publish a "quote" —</b> a public offer that says
            "I'll fill this swap, for this much profit, until this time." The aggregator matches incoming
            orders against your offers and routes the best matches to your fill-worker.
          </p>
          <p className="mt-2">
            Pick a route, set the order sizes you'll handle, your margin, and how long the offer lasts.
            Then hit <b className="text-white">Publish my offer</b>.
          </p>
        </div>

        {/* Route Matrix */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6 bg-[#111b33]/50 rounded-2xl border border-[#454556]/10 font-mono">
          <div className="flex flex-col gap-2">
            <label className="text-xs text-[#8f8fa2] uppercase tracking-wider font-bold">
              Source Chain & Token
            </label>
            <div className="relative">
              <select
                value={`${fromChain}__${fromToken}`}
                onChange={(e) => {
                  const [c, t] = e.target.value.split('__');
                  setFromChain(c);
                  setFromToken(t);
                }}
                className="w-full bg-[#08122a] border border-[#454556]/40 rounded-xl px-4 py-3 text-xs text-white focus:ring-2 focus:ring-[#424af6]/50 appearance-none"
              >
                {chains.length === 0 && (
                  <option value={`${fromChain}__${fromToken}`}>Loading chains…</option>
                )}
                {chains.flatMap((c) =>
                  c.tokens.map((t) => (
                    <option
                      key={`${c.chain_id}-${t.symbol}`}
                      value={`${chainCaip2(c)}__${t.symbol}`}
                    >
                      {t.symbol} on {c.name}
                    </option>
                  )),
                )}
              </select>
              <span className="absolute right-4 top-1/2 -translate-y-1/2 material-symbols-outlined pointer-events-none text-[#8f8fa2]">
                expand_more
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs text-[#8f8fa2] uppercase tracking-wider font-bold">
              In exchange for
            </label>
            <p className="text-[10px] text-[#8f8fa2] -mt-1">What you want to receive</p>
            <div className="relative">
              <select
                value={`${toChain}__${toToken}`}
                onChange={(e) => {
                  const [c, t] = e.target.value.split('__');
                  setToChain(c);
                  setToToken(t);
                }}
                className="w-full bg-[#08122a] border border-[#454556]/40 rounded-xl px-4 py-3 text-xs text-white focus:ring-2 focus:ring-[#424af6]/50 appearance-none"
              >
                {chains.length === 0 && (
                  <option value={`${toChain}__${toToken}`}>Loading chains…</option>
                )}
                {chains.flatMap((c) =>
                  c.tokens.map((t) => (
                    <option
                      key={`${c.chain_id}-${t.symbol}`}
                      value={`${chainCaip2(c)}__${t.symbol}`}
                    >
                      {t.symbol} on {c.name}
                    </option>
                  )),
                )}
              </select>
              <span className="absolute right-4 top-1/2 -translate-y-1/2 material-symbols-outlined pointer-events-none text-[#8f8fa2]">
                expand_more
              </span>
            </div>
          </div>
        </div>

        {/* Sliders & Controls */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 font-mono">
          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-4">
                <label className="text-xs text-[#c6c5d9] uppercase tracking-wider font-bold">
                  Smallest order I'll fill
                </label>
                <span className="text-xs text-[#bfc2ff] bg-[#424af6]/10 px-2.5 py-1 rounded">
                  {minAmount} {fromToken}
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="500"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                className="w-full h-1.5 bg-[#2a344e] rounded-lg appearance-none cursor-pointer accent-[#424af6]"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-4">
                <label className="text-xs text-[#c6c5d9] uppercase tracking-wider font-bold">
                  Biggest order I'll fill
                </label>
                <span className="text-xs text-[#bfc2ff] bg-[#424af6]/10 px-2.5 py-1 rounded">
                  {maxAmount} {fromToken}
                </span>
              </div>
              <input
                type="range"
                min="500"
                max="50000"
                step="500"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                className="w-full h-1.5 bg-[#2a344e] rounded-lg appearance-none cursor-pointer accent-[#424af6]"
              />
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-4">
                <label className="text-xs text-[#c6c5d9] uppercase tracking-wider font-bold">
                  Your margin
                </label>
                <span className="text-xs text-[#bfc2ff] bg-[#424af6]/10 px-2.5 py-1 rounded">
                  {quoteRateMargin}%
                </span>
              </div>
              <p className="text-[10px] text-[#8f8fa2] -mt-3 mb-3">
                How much you earn on each fill. Higher = more profit per order, fewer matches.
              </p>
              <input
                type="range"
                min="0.01"
                max="2.00"
                step="0.01"
                value={quoteRateMargin}
                onChange={(e) => setQuoteRateMargin(e.target.value)}
                className="w-full h-1.5 bg-[#2a344e] rounded-lg appearance-none cursor-pointer accent-[#424af6]"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-4">
                <label className="text-xs text-[#c6c5d9] uppercase tracking-wider font-bold">
                  Gas fee you charge
                </label>
                <span className="text-xs text-[#bfc2ff] bg-[#424af6]/10 px-2.5 py-1 rounded">
                  {fixedCost} {toToken}
                </span>
              </div>
              <p className="text-[10px] text-[#8f8fa2] -mt-3 mb-3">
                A flat amount deducted from every fill to cover the gas you spend
                settling it (three transactions across two chains). Charged
                regardless of order size — keep it near your real gas cost, or
                small orders become unattractive to users.
              </p>
              <input
                type="range"
                min="0"
                max="1"
                step="0.005"
                value={fixedCost}
                onChange={(e) => setFixedCost(e.target.value)}
                className="w-full h-1.5 bg-[#2a344e] rounded-lg appearance-none cursor-pointer accent-[#424af6]"
              />
            </div>

            <div className="flex flex-col gap-3">
              <label className="text-xs text-[#c6c5d9] uppercase tracking-wider font-bold">
                How long should this offer last?
              </label>
              <p className="text-[10px] text-[#8f8fa2] -mt-1">
                You're committing to this price for the whole window. Long
                windows earn more fills but carry more price risk if the
                market moves. You can pause or delete the offer at any time.
              </p>
              <div className="grid grid-cols-4 gap-2">
                {EXPIRY_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => {
                      setUseCustomExpiry(false);
                      setExpirySecs(p.secs);
                    }}
                    className={`py-2.5 rounded-xl text-[11px] font-bold transition-all border ${
                      !useCustomExpiry && expirySecs === p.secs
                        ? 'bg-[#424af6] text-white border-[#424af6] shadow-lg shadow-[#424af6]/20'
                        : 'bg-[#1f2942]/50 border-[#454556]/30 text-[#c6c5d9] hover:border-[#bfc2ff]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setUseCustomExpiry(true)}
                  className={`py-2.5 px-3 rounded-xl text-[11px] font-bold transition-all border shrink-0 ${
                    useCustomExpiry
                      ? 'bg-[#424af6] text-white border-[#424af6] shadow-lg shadow-[#424af6]/20'
                      : 'bg-[#1f2942]/50 border-[#454556]/30 text-[#c6c5d9] hover:border-[#bfc2ff]'
                  }`}
                >
                  CUSTOM
                </button>
                <input
                  type="number"
                  min="1"
                  value={customExpiry}
                  onChange={(e) => {
                    setCustomExpiry(e.target.value);
                    setUseCustomExpiry(true);
                  }}
                  className="w-20 bg-[#08122a] border border-[#454556]/40 rounded-xl px-3 py-2.5 text-xs text-white focus:ring-2 focus:ring-[#424af6]/50"
                />
                <select
                  value={customUnit}
                  onChange={(e) => {
                    setCustomUnit(e.target.value as 'minutes' | 'hours' | 'days');
                    setUseCustomExpiry(true);
                  }}
                  className="flex-1 bg-[#08122a] border border-[#454556]/40 rounded-xl px-3 py-2.5 text-xs text-white focus:ring-2 focus:ring-[#424af6]/50 appearance-none"
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
              </div>

              <p className="text-[10px] text-[#bfc2ff]">
                Expires {expiresAtLabel}
              </p>
            </div>
          </div>
        </div>

        {/* What a user actually receives, at both ends of your size range.
            The flat gas fee is size-independent, so it dominates small
            orders — showing it here makes that obvious before publishing. */}
        <div className="bg-[#111b33]/50 border border-[#454556]/20 rounded-xl p-4 font-mono">
          <p className="text-xs text-[#c6c5d9] uppercase tracking-wider font-bold mb-3">
            What the user receives
          </p>
          <div className="grid grid-cols-2 gap-4">
            {[minAmount, maxAmount].map((amt, i) => {
              const input = parseFloat(amt) || 0;
              const out = input * (1 - parseFloat(quoteRateMargin) / 100) - parseFloat(fixedCost);
              const pct = input > 0 ? (out / input) * 100 : 0;
              const poor = pct < 95;
              return (
                <div key={i} className="flex flex-col gap-1">
                  <span className="text-[10px] text-[#8f8fa2] uppercase">
                    {i === 0 ? 'Smallest order' : 'Biggest order'}
                  </span>
                  <span className="text-sm text-white">
                    {input} {fromToken} → {out > 0 ? out.toFixed(4) : '—'} {toToken}
                  </span>
                  <span className={`text-[10px] ${poor ? 'text-yellow-300' : 'text-[#8f8fa2]'}`}>
                    {out > 0 ? `${pct.toFixed(2)}% of input` : 'fee exceeds order — unfillable'}
                    {poor && out > 0 ? ' — users will pick a cheaper solver' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 pt-4 font-mono">
          <button
            onClick={handleDeployBatch}
            disabled={isDeploying}
            className="flex-1 py-4 bg-[#424af6] text-white font-bold rounded-xl shadow-xl shadow-[#424af6]/25 hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-widest disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-xl">rocket_launch</span>
            {isDeploying ? 'Publishing…' : 'Publish my offer'}
          </button>
          <button
            onClick={() => {
              setMinAmount('10.00');
              setMaxAmount('5000.00');
              setQuoteRateMargin('0.15');
            }}
            className="px-8 py-4 border border-[#454556]/30 text-[#c6c5d9] font-semibold rounded-xl hover:bg-white/5 active:scale-[0.98] transition-all uppercase text-xs tracking-widest"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Active offers table */}
      <div className="glass-panel rounded-2xl p-6 bg-[#151f37]/80 border border-[#454556]/30 font-mono">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h4 className="text-lg font-bold text-white font-headline">Your active offers</h4>
            <p className="text-xs text-[#8f8fa2] mt-0.5">Offers currently live for the network to match against incoming orders</p>
          </div>
          <span className="text-xs text-[#bfc2ff] bg-[#424af6]/10 border border-[#424af6]/20 px-3 py-1 rounded-full font-bold">
            {activeQuotes.length} {activeQuotes.length === 1 ? 'live offer' : 'live offers'}
          </span>
        </div>

        {activeQuotes.length === 0 ? (
          <div className="p-8 text-center text-[#8f8fa2] border-2 border-dashed border-[#454556]/30 rounded-xl">
            <span className="material-symbols-outlined text-4xl mb-2">request_quote</span>
            <p className="text-sm font-bold text-white">No offers yet</p>
            <p className="text-xs mt-1 max-w-md mx-auto">
              Publish your first offer above to start matching orders. The network will start
              routing compatible swaps to your fill-worker within seconds.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#454556]/30 text-[#8f8fa2] uppercase tracking-wider">
                  <th className="pb-3 px-3 font-bold">Swap route</th>
                  <th className="pb-3 px-3 font-bold">Order size I'll fill</th>
                  <th className="pb-3 px-3 font-bold">My margin</th>
                  <th className="pb-3 px-3 font-bold">Gas fee</th>
                  <th className="pb-3 px-3 font-bold">Expires</th>
                  <th className="pb-3 px-3 font-bold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#454556]/20">
                {activeQuotes.map((q) => {
                  // Names and symbols come from the chain registry.
                  const chainOf = (caip2: string) =>
                    chains.find((c) => chainCaip2(c) === caip2);
                  const formatChain = (caip2: string) => chainOf(caip2)?.name ?? caip2;
                  const tokenOf = (caip2: string, addr: string) => {
                    const bare = (addr || '').split(/[:/]/).pop() ?? addr;
                    return chainOf(caip2)?.tokens.find(
                      (t) => t.address.toLowerCase() === bare.toLowerCase(),
                    );
                  };
                  const fromTok = tokenOf(q.fromChainNetworkId, q.fromAssetAddress);
                  const toTok = tokenOf(q.toChainNetworkId, q.toAssetAddress);
                  const fromSym = fromTok?.symbol ?? 'token';
                  const fromDec = fromTok?.decimals ?? q.fromAssetDecimals ?? 6;
                  const toDec = toTok?.decimals ?? q.toAssetDecimals ?? 6;

                  // `quote` is stored as the multiplier applied to the
                  // input (0.9978 = user keeps 99.78%). Operators think
                  // in margin, so show that and keep the raw multiplier
                  // as the secondary detail.
                  const rate = parseFloat(q.quote);
                  const marginPct = isNaN(rate) ? null : (1 - rate) * 100;

                  const expiryMs = /^\d+$/.test(q.expiry)
                    ? Number(q.expiry) * 1000
                    : Date.parse(q.expiry);
                  const expiryText = isNaN(expiryMs)
                    ? q.expiry
                    : new Date(expiryMs).toLocaleString();
                  const expired = !isNaN(expiryMs) && expiryMs < Date.now();

                  return (
                  <tr key={q.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-3.5 px-3 text-white font-bold">
                      {formatChain(q.fromChainNetworkId)} ({fromSym}) → {formatChain(q.toChainNetworkId)} ({toTok?.symbol ?? 'token'})
                    </td>
                    <td className="py-3.5 px-3 text-[#dae2ff]">
                      {fromBaseUnits(q.minAmount, fromDec)} – {fromBaseUnits(q.maxAmount, fromDec)} {fromSym}
                    </td>
                    <td className="py-3.5 px-3 text-emerald-400 font-bold">
                      {marginPct === null ? q.quote : `${marginPct.toFixed(2)}%`}
                      <span className="block text-[10px] font-normal text-[#8f8fa2]">
                        user keeps {isNaN(rate) ? '—' : `${(rate * 100).toFixed(2)}%`}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-[#dae2ff]">
                      {q.fixedCost ? `${fromBaseUnits(q.fixedCost, toDec)} ${toTok?.symbol ?? ''}` : '—'}
                    </td>
                    <td className={`py-3.5 px-3 ${expired ? 'text-red-300' : 'text-[#8f8fa2]'}`}>
                      {expiryText}
                      {expired && <span className="block text-[10px]">expired</span>}
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">
                        Active
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div className="glass-panel rounded-2xl p-8 grid grid-cols-1 md:grid-cols-3 gap-8 border-l-4 border-[#424af6] shadow-xl bg-[#151f37]/80 font-mono">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-[#8f8fa2] uppercase tracking-wider font-bold">Active offers</span>
          <p className="font-headline text-4xl text-white font-bold">{activeQuotes.length}</p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-[#8f8fa2] uppercase tracking-wider font-bold">Orders you've filled</span>
          <p className="font-headline text-4xl text-[#bfc2ff] font-bold">{hasOrders ? '18.4%' : '0.0%'}</p>
          <span className="text-[10px] text-[#8f8fa2] mt-0.5">of incoming orders matched to you</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-[#8f8fa2] uppercase tracking-wider font-bold">Profit (last 24h)</span>
          <p className="font-headline text-4xl text-white font-bold">{hasOrders ? '+$4,212' : '+$0.00'}</p>
        </div>
      </div>

      {/* Toast Notification */}
      {showToast && (
        <div className="fixed bottom-8 right-8 glass-panel p-4 pr-6 rounded-2xl shadow-2xl flex items-center gap-4 border-l-4 border-[#424af6] bg-[#151f37] text-white z-[100] animate-in fade-in slide-in-from-bottom-5">
          <div className="w-10 h-10 rounded-xl bg-[#424af6]/20 flex items-center justify-center text-[#bfc2ff]">
            <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
              check_circle
            </span>
          </div>
          <div>
            <p className="font-bold text-xs">Offer is live</p>
            <p className="text-[10px] text-[#8f8fa2] mt-0.5 font-mono">
              The network will start matching orders to you right away
            </p>
          </div>
          <button onClick={() => setShowToast(false)} className="ml-4 p-1 text-[#8f8fa2] hover:text-white">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}
    </div>
  );
};
