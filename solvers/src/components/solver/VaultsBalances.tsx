import React, { useMemo, useState } from 'react';
import { useVaults, useIdentities } from '../../hooks/use-solver-data';
import { SolverApiService } from '../../services/solverApi';
import type { VaultAsset, SolverIdentityDto } from '../../services/solverApi';

/**
 * VaultsBalances — operator inventory across every chain they fill on.
 *
 * The page shows two things the operator actually cares about:
 *
 *   1. **Live token balances** held in the operator's settlement
 *      contracts, broken down by chain. Pulled from
 *      `GET /solver-api/vaults`. Until that backend endpoint exists
 *      the table renders a clear "backend not connected" empty
 *      state instead of fake data.
 *
 *   2. **Registered solver identities** — pulled from
 *      `GET /solver-api/solver/identities` and displayed alongside
 *      their reputation score (when available).
 *
 * Hero numbers (total equity / locked escrow) are derived from the
 * `vaults` array on the fly. They are 0 — not faked — when the API
 * returns no data. The previously hardcoded `$1,284,502.42` is
 * gone.
 *
 * Deposit / Withdraw controls are shown but disabled with a
 * "Coming soon" tooltip until the vault contract is deployed.
 * Surfacing buttons that fire on dead routes just produces silent
 * failures.
 */

// Map a CAIP-2 chain identifier (`eip155:<id>`) or human name to a
// short display label. Lookup is permissive so a backend response
// with a slightly different shape still renders sensibly.
function chainLabel(chain: string): string {
  if (!chain) return 'Unknown';
  const m = chain.match(/^eip155:(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    switch (id) {
      case 1: return 'Ethereum';
      case 10: return 'Optimism';
      case 8453: return 'Base';
      case 42161: return 'Arbitrum';
      case 137: return 'Polygon';
      case 84532: return 'Base Sepolia';
      case 11155420: return 'OP Sepolia';
      case 421614: return 'Arb Sepolia';
      case 11155111: return 'Eth Sepolia';
      default: return `Chain ${id}`;
    }
  }
  return chain;
}

// Aggregator responses use `eip155:84532`; the dashboard's chain
// filter chips use human names. Normalize one to the other so the
// filter actually filters.
function chainMatchesFilter(chain: string, filter: string): boolean {
  if (filter === 'All Chains') return true;
  return chainLabel(chain) === filter;
}

interface HeroTotals {
  totalUsd: number;
  lockedUsd: number;
  availableUsd: number;
  assetCount: number;
  chainCount: number;
}

/**
 * Sum `usdValue` across all vault rows, treating unparseable strings
 * as 0 rather than NaN. Missing USD pricing is expected until we
 * wire a price oracle — the totals fall back to zero instead of
 * `NaN`.
 */
function computeTotals(vaults: VaultAsset[]): HeroTotals {
  let totalUsd = 0;
  let lockedUsd = 0;
  const chains = new Set<string>();
  for (const v of vaults) {
    const total = Number(v.usdValue ?? v.total ?? 0);
    const locked = Number(v.locked ?? 0);
    if (Number.isFinite(total)) totalUsd += total;
    if (Number.isFinite(locked)) lockedUsd += locked;
    if (v.chain) chains.add(v.chain);
  }
  return {
    totalUsd,
    lockedUsd,
    availableUsd: totalUsd - lockedUsd,
    assetCount: vaults.length,
    chainCount: chains.size,
  };
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0.00';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

export const VaultsBalances: React.FC = () => {
  const [refreshTick, setRefreshTick] = useState(0);
  const { data: vaults } = useVaults(refreshTick);
  const { data: identities } = useIdentities();

  const [chainFilter, setChainFilter] = useState('All Chains');

  // Derive the chain list from actual data, not a hardcoded array.
  // The operator only sees chains they actually have vaults on.
  const availableChains = useMemo(() => {
    const set = new Set<string>();
    for (const v of vaults) set.add(chainLabel(v.chain));
    return Array.from(set).sort();
  }, [vaults]);

  const filteredVaults = useMemo(
    () => vaults.filter((v) => chainMatchesFilter(v.chain, chainFilter)),
    [vaults, chainFilter],
  );

  const totals = useMemo(() => computeTotals(vaults), [vaults]);

  const hasData = vaults.length > 0;

  return (
    <div className="space-y-8 font-sans max-w-[1400px] mx-auto">
      {/* ── Hero stats ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono">
        <HeroCard
          label="Total Managed Equity"
          value={formatUsd(totals.totalUsd)}
          accent="primary"
          subline={
            hasData
              ? `${totals.assetCount} asset${totals.assetCount === 1 ? '' : 's'} on ${totals.chainCount} chain${totals.chainCount === 1 ? '' : 's'}`
              : 'No vault data yet'
          }
        />
        <HeroCard
          label="Locked in Escrow"
          value={formatUsd(totals.lockedUsd)}
          accent="warning"
          subline={
            totals.lockedUsd > 0
              ? 'Committed to active solves'
              : 'No funds currently locked'
          }
        />
        <HeroCard
          label="Available to Fill"
          value={formatUsd(totals.availableUsd)}
          accent="success"
          subline={
            totals.availableUsd > 0
              ? 'Free across all chains'
              : 'Deposit to start filling'
          }
        />
      </div>

      {/* ── Asset table + identities ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <section className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between font-mono flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[#bfc2ff]">
                account_balance_wallet
              </span>
              <h2 className="font-headline text-xl font-bold text-white">
                Asset Holdings
              </h2>
            </div>
            <div className="flex gap-2 flex-wrap">
              <ChainFilterPill
                active={chainFilter === 'All Chains'}
                onClick={() => setChainFilter('All Chains')}
                label="All Chains"
                count={vaults.length}
              />
              {availableChains.map((c) => (
                <ChainFilterPill
                  key={c}
                  active={chainFilter === c}
                  onClick={() => setChainFilter(c)}
                  label={c}
                  count={vaults.filter((v) => chainLabel(v.chain) === c).length}
                />
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-2xl overflow-hidden bg-[#151f37]/80 border border-[#454556]/30 shadow-2xl font-mono">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#454556]/20 bg-[#1f2942]/50 text-[10px] text-[#8f8fa2] uppercase tracking-widest">
                    <th className="p-4">Asset</th>
                    <th className="p-4">Chain</th>
                    <th className="p-4 text-right">Available</th>
                    <th className="p-4 text-right">Locked</th>
                    <th className="p-4 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#454556]/15 text-xs">
                  {filteredVaults.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-12 text-center">
                        {hasData ? (
                          <>
                            <span className="material-symbols-outlined text-[#8f8fa2] text-3xl block mb-2">
                              filter_alt_off
                            </span>
                            <p className="text-[#8f8fa2] font-bold">
                              No assets on {chainFilter}
                            </p>
                            <p className="text-[10px] text-[#8f8fa2] mt-1">
                              Try a different chain or clear the filter.
                            </p>
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-[#8f8fa2] text-3xl block mb-2">
                              inbox
                            </span>
                            <p className="text-[#8f8fa2] font-bold">
                              Backend not connected
                            </p>
                            <p className="text-[10px] text-[#8f8fa2] mt-1">
                              The aggregator's <code className="font-mono">/solver-api/vaults</code> endpoint
                              is not yet implemented. Asset holdings will appear
                              here once the vault tracking backend lands.
                            </p>
                          </>
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredVaults.map((v, i) => (
                      <tr key={`${v.chain}-${v.symbol}-${i}`} className="hover:bg-white/5 transition-colors">
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#1f2942] flex items-center justify-center border border-[#454556]/30">
                              <span
                                className="material-symbols-outlined text-[#bfc2ff] text-sm"
                                style={{ fontVariationSettings: "'FILL' 1" }}
                              >
                                monetization_on
                              </span>
                            </div>
                            <div>
                              <p className="font-bold text-white">{v.symbol}</p>
                              {v.name && (
                                <p className="text-[10px] text-[#8f8fa2]">{v.name}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className="px-2.5 py-1 rounded bg-[#424af6]/10 text-[#bfc2ff] text-[10px] font-bold border border-[#424af6]/20">
                            {chainLabel(v.chain)}
                          </span>
                        </td>
                        <td className="p-4 text-right text-white font-mono">
                          {v.available || '0'}
                        </td>
                        <td className="p-4 text-right text-[#8f8fa2] font-mono">
                          {v.locked || '0'}
                        </td>
                        <td className="p-4 text-right font-bold text-[#bfc2ff] font-mono">
                          {v.total || '0'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Identities panel ─────────────────────────────────── */}
        <section className="lg:col-span-4 space-y-4 font-mono">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[#bfc2ff]">security</span>
            <h2 className="font-headline text-xl font-bold text-white">Identities</h2>
          </div>

          <div className="glass-panel rounded-2xl flex flex-col bg-[#151f37]/80 border border-[#454556]/30 shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[#454556]/20 bg-[#111b33]">
              <p className="text-xs text-[#8f8fa2]">
                Registered solver accounts for reputation tracking
              </p>
            </div>

            <div className="divide-y divide-[#454556]/20 overflow-y-auto max-h-[420px] custom-scrollbar">
              {identities.length === 0 ? (
                <EmptyIdentities />
              ) : (
                identities.map((id) => <IdentityRow key={id.id} id={id} />)
              )}
            </div>
          </div>
        </section>
      </div>

      {/* ── Escrow notice ──────────────────────────────────────── */}
      <div className="p-4 bg-[#b33b00]/10 border border-[#b33b00]/30 rounded-2xl flex items-start gap-4 font-mono">
        <span className="material-symbols-outlined text-[#ffb59b] mt-0.5">info</span>
        <div>
          <h5 className="font-bold text-[#ffb59b] text-xs uppercase tracking-wider">
            Escrow Notice
          </h5>
          <p className="text-xs text-[#c6c5d9] leading-relaxed mt-0.5">
            Funds locked in escrow are committed to active solving
            sessions. Unlocking typically takes 30–60 minutes after
            intent finalization depending on target chain finality.
            Deposit and withdraw controls will become active once the
            vault contract is deployed.
          </p>
        </div>
      </div>

      {/* ── Report balance (operator-attested until vault contract) ─ */}
      <ReportBalanceForm onSubmitted={() => setRefreshTick((t) => t + 1)} />
    </div>
  );
};

// ── Sub-components ──────────────────────────────────────────────────

interface HeroCardProps {
  label: string;
  value: string;
  accent: 'primary' | 'warning' | 'success';
  subline: string;
}

const HeroCard: React.FC<HeroCardProps> = ({ label, value, accent, subline }) => {
  const accentClass = {
    primary: 'bg-[#424af6]/10 group-hover:bg-[#424af6]/20',
    warning: 'bg-[#ffb59b]/10 group-hover:bg-[#ffb59b]/20',
    success: 'bg-emerald-500/10 group-hover:bg-emerald-500/20',
  }[accent];

  return (
    <div className="glass-panel p-6 rounded-2xl relative overflow-hidden bg-[#151f37]/80 border border-[#454556]/30 group shadow-xl">
      <div
        className={`absolute -right-4 -top-4 w-24 h-24 rounded-full blur-3xl transition-all ${accentClass}`}
      />
      <p className="text-xs text-[#8f8fa2] uppercase tracking-wider mb-2 font-bold">
        {label}
      </p>
      <h3 className="font-headline text-3xl font-bold text-white font-mono">
        {value}
      </h3>
      <p className="mt-2 text-xs text-[#8f8fa2]">{subline}</p>
    </div>
  );
};

interface ChainFilterPillProps {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}

const ChainFilterPill: React.FC<ChainFilterPillProps> = ({
  active,
  onClick,
  label,
  count,
}) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
      active
        ? 'bg-[#424af6] text-white'
        : 'bg-[#151f37] text-[#c6c5d9] hover:bg-white/5 border border-[#454556]/30'
    }`}
  >
    {label}
    <span className="ml-1.5 opacity-60 font-mono">{count}</span>
  </button>
);

const EmptyIdentities: React.FC = () => (
  <div className="p-8 text-center">
    <span className="material-symbols-outlined text-[#8f8fa2] text-3xl block mb-2">
      badge
    </span>
    <p className="text-[#8f8fa2] font-bold text-xs">No identities registered yet</p>
    <p className="text-[10px] text-[#8f8fa2] mt-1">
      Register a solver to see identities here.
    </p>
  </div>
);

const IdentityRow: React.FC<{ id: SolverIdentityDto }> = ({ id }) => {
  // `status` is `'active' | 'pending'` on the DTO. Render it directly
  // instead of fabricating values from a non-existent reputation
  // score. We keep the three-state color palette so a future
  // `'limited'` value slots in without a UI change.
  const status = id.status;
  const statusStyle =
    status === 'active'
      ? 'bg-emerald-500/20 text-emerald-400'
      : 'bg-[#2a344e] text-[#8f8fa2]';

  return (
    <div className="p-4 hover:bg-white/5 transition-all group">
      <div className="flex justify-between items-start mb-2">
        <span
          className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${statusStyle}`}
        >
          {status}
        </span>
        <span className="text-[10px] text-[#8f8fa2] font-mono">
          #{id.solverId}
        </span>
      </div>
      <p className="text-xs font-bold text-white mb-1 group-hover:text-[#bfc2ff] transition-colors">
        {id.chain || 'Main Solver Node'}
      </p>
      <p className="text-[11px] text-[#8f8fa2] truncate font-mono">
        {id.address}
      </p>
      <p className="text-[9px] text-[#8f8fa2] mt-1 font-mono">
        {id.type} · added {new Date(id.createdAt).toLocaleDateString()}
      </p>
    </div>
  );
};

interface DisabledActionButtonProps {
  label: string;
  icon: string;
}

const DisabledActionButton: React.FC<DisabledActionButtonProps> = ({ label, icon }) => (
  <button
    disabled
    title="Vault contract not yet deployed"
    className="flex items-center justify-center gap-2 px-5 py-3 border border-[#454556]/40 text-[#8f8fa2] rounded-xl font-bold text-xs uppercase tracking-wider opacity-60 cursor-not-allowed"
  >
    <span className="material-symbols-outlined text-lg">{icon}</span>
    {label}
  </button>
);

/**
 * ReportBalanceForm — manual balance entry.
 *
 * Until the on-chain vault contract lands, balances are
 * operator-attested: the operator reads their wallet UI, types
 * the number here, and we POST it to /solver-api/vaults/snapshot.
 * The form is intentionally minimal — chain, asset address,
 * symbol, amount. No name field on the form; it's optional and
 * defaults to the symbol.
 *
 * Submitting bumps `refreshTick` via the `onSubmitted` callback so
 * `useVaults` re-fetches the table.
 */
const ReportBalanceForm: React.FC<{ onSubmitted: () => void }> = ({ onSubmitted }) => {
  const [chain, setChain] = useState('eip155:84532');
  const [symbol, setSymbol] = useState('USDC');
  const [assetAddress, setAssetAddress] = useState('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  const [available, setAvailable] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!available.trim()) {
      setFeedback({ ok: false, message: 'Amount is required.' });
      return;
    }
    setSubmitting(true);
    const res = await SolverApiService.postVaultSnapshot({
      chain: chain.trim(),
      assetAddress: assetAddress.trim(),
      symbol: symbol.trim(),
      available: available.trim(),
    });
    setSubmitting(false);
    if (res.success) {
      setFeedback({ ok: true, message: 'Balance saved.' });
      setAvailable('');
      onSubmitted();
    } else {
      setFeedback({ ok: false, message: res.error ?? 'Failed to save balance.' });
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-panel rounded-2xl border-[#424af6]/40 bg-[#151f37]/80 p-6 shadow-xl font-mono space-y-4"
    >
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-bold text-[#bfc2ff] uppercase tracking-wider mb-1">
            Inventory Management
          </p>
          <h4 className="text-white font-bold text-sm">
            Report Balance
          </h4>
          <p className="text-[11px] text-[#8f8fa2] mt-1">
            Until the on-chain vault contract is deployed, balances
            are operator-attested. Read your wallet UI, type the
            amount here, submit.
          </p>
        </div>
        <div className="flex gap-3">
          <DisabledActionButton label="Deposit" icon="south_west" />
          <DisabledActionButton label="Withdraw" icon="north_east" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <label className="block">
          <span className="block text-[10px] text-[#8f8fa2] uppercase font-bold mb-1">
            Chain
          </span>
          <select
            value={chain}
            onChange={(e) => setChain(e.target.value)}
            className="w-full bg-[#030d25] border border-[#454556]/40 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#424af6]"
          >
            <option value="eip155:1">Ethereum</option>
            <option value="eip155:10">Optimism</option>
            <option value="eip155:8453">Base</option>
            <option value="eip155:84532">Base Sepolia</option>
            <option value="eip155:11155420">OP Sepolia</option>
            <option value="eip155:42161">Arbitrum</option>
            <option value="eip155:421614">Arb Sepolia</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] text-[#8f8fa2] uppercase font-bold mb-1">
            Symbol
          </span>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="USDC"
            className="w-full bg-[#030d25] border border-[#454556]/40 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-[#424af6]"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] text-[#8f8fa2] uppercase font-bold mb-1">
            Asset address
          </span>
          <input
            type="text"
            value={assetAddress}
            onChange={(e) => setAssetAddress(e.target.value)}
            placeholder="0x... or 'native'"
            className="w-full bg-[#030d25] border border-[#454556]/40 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-[#424af6]"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] text-[#8f8fa2] uppercase font-bold mb-1">
            Amount
          </span>
          <input
            type="text"
            value={available}
            onChange={(e) => setAvailable(e.target.value)}
            placeholder="0.00"
            className="w-full bg-[#030d25] border border-[#454556]/40 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-[#424af6]"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="submit"
          disabled={submitting}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-[#424af6] text-white rounded-xl font-bold text-xs uppercase tracking-wider hover:brightness-110 active:scale-95 transition-all disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-lg">publish</span>
          {submitting ? 'Saving…' : 'Save Balance'}
        </button>
        {feedback && (
          <p
            className={`text-xs ${
              feedback.ok ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {feedback.message}
          </p>
        )}
      </div>
    </form>
  );
};