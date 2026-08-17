import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { SolverApiService } from '../services/solverApi';
import { useAuthStore } from '../stores/auth-store';
import { useAccount } from 'wagmi';

/**
 * SettingsPage — manages the operator's:
 *   - Secret API key (server-rotated via `POST /solver-api/operators/{id}/api-key`)
 *   - Settlement contracts per chain
 *
 * Onboarding behaviour:
 *   - The purple banner shows only when `?onboarding=true` AND the auth
 *     store hasn't yet marked onboarding complete.
 *   - The RegistrationWizard calls `markOnboardingComplete()` when it
 *     successfully submits the operator registration, so the banner
 *     disappears on the next visit.
 */
export const SettingsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isOnboardingComplete, markOnboardingComplete } = useAuthStore();
  const { address } = useAccount();
  // The server-side `solver_id` is `"solver-" + address.toLowerCase().replace("0x", "")`
  // — that's the canonical key the registration handler persists to both the
  // `solvers` and `operators` tables. The dashboard must mirror that exact form
  // so `GET/PUT/DELETE /solver-api/operators/{id}/...` resolves to a row.
  const solverId = address
    ? `solver-${address.toLowerCase().replace(/^0x/, '')}`
    : '';

  // Show banner only when explicitly requested AND not yet completed.
  const isOnboarding = searchParams.get('onboarding') === 'true' && !isOnboardingComplete;

  // ── API key state ──────────────────────────────────────────────────
  const [apiKey, setApiKey] = useState(SolverApiService.getApiKey());
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);

  // ── Settlement contracts state ─────────────────────────────────────
  const [contracts, setContracts] = useState<Record<number, string>>({});
  const [contractsLoading, setContractsLoading] = useState(false);
  const [contractsError, setContractsError] = useState<string | null>(null);
  const [newChainId, setNewChainId] = useState('11155420');
  const [newAddress, setNewAddress] = useState('');
  const [addingContract, setAddingContract] = useState(false);

  // ── Registration state — does an operator row already exist? ───────
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null); // null = loading

  useEffect(() => {
    if (!solverId) {
      setIsRegistered(false);
      return;
    }
    let cancelled = false;
    setIsRegistered(null);
    SolverApiService.getOperator(solverId)
      .then((op) => {
        if (!cancelled) setIsRegistered(op !== null);
      })
      .catch(() => {
        if (!cancelled) setIsRegistered(false);
      });
    return () => {
      cancelled = true;
    };
  }, [solverId]);

  // Refresh contracts whenever the user lands here with a known solver.
  useEffect(() => {
    if (!solverId) {
      setContracts({});
      return;
    }
    let cancelled = false;
    setContractsLoading(true);
    setContractsError(null);
    SolverApiService.getSettlementContracts(solverId)
      .then((map) => {
        if (!cancelled) setContracts(map);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setContractsError(
            e instanceof Error ? e.message : 'Failed to load settlement contracts',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setContractsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [solverId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRotateKey = async () => {
    if (!solverId) {
      setRotateError('Connect a wallet before rotating the API key.');
      return;
    }
    setRotating(true);
    setRotateError(null);
    const result = await SolverApiService.rotateApiKey(solverId);
    setRotating(false);
    if (!result) {
      setRotateError(
        'Aggregator rejected the rotation. It may be offline or the operator row is missing.',
      );
      return;
    }
    setApiKey(result.apiKey);
    SolverApiService.setApiKey(result.apiKey);
    setShowKey(true); // surface the new key so the operator can copy it
  };

  const handleAddContract = async () => {
    if (!solverId) return;
    const parsedChainId = Number(newChainId);
    if (!Number.isInteger(parsedChainId) || parsedChainId <= 0) {
      setContractsError(`chainId must be a positive integer, got "${newChainId}"`);
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(newAddress.trim())) {
      setContractsError(`address must be 0x-prefixed 20-byte hex, got "${newAddress}"`);
      return;
    }
    setAddingContract(true);
    setContractsError(null);
    try {
      const updated = await SolverApiService.setSettlementContract(
        solverId,
        parsedChainId,
        newAddress.trim(),
      );
      if (updated) {
        // Refresh the full map to keep the UI in sync with what the
        // aggregator persisted (handles race conditions when the
        // operator row is created on first call).
        const fresh = await SolverApiService.getSettlementContracts(solverId);
        if (fresh) setContracts(fresh);
        setNewAddress('');
      } else {
        setContractsError('Aggregator rejected the contract update.');
      }
    } catch (e: unknown) {
      setContractsError(e instanceof Error ? e.message : 'Failed to add contract');
    } finally {
      setAddingContract(false);
    }
  };

  const handleRemoveContract = async (chainId: number) => {
    if (!solverId) {
      setContractsError('No solver selected.');
      return;
    }
    const prev = contracts;
    // Optimistic UI — drop the row immediately so the user sees
    // responsive feedback. If the server call fails we restore the
    // previous map and surface the error.
    setContracts((curr) => {
      const next = { ...curr };
      delete next[chainId];
      return next;
    });
    setContractsError(null);
    try {
      const res = await SolverApiService.deleteSettlementContract(solverId, chainId);
      if (res === null) {
        // Network error / unknown failure — restore the row.
        setContracts(prev);
        setContractsError('Network error while deleting contract. Try again.');
        return;
      }
      // `res.removed` is 1 when an entry existed, 0 when it didn't. Either
      // is a successful outcome — the row is gone either way, so we
      // don't restore. Just refresh from the server to stay in sync.
      const fresh = await SolverApiService.getSettlementContracts(solverId);
      if (fresh) setContracts(fresh);
    } catch (e: unknown) {
      setContracts(prev);
      setContractsError(e instanceof Error ? e.message : 'Failed to delete contract');
    }
  };

  return (
    <div className="max-w-[800px] mx-auto space-y-8 font-sans pb-12">
      {/* Onboarding stepper — three plain-language steps. */}
      {isOnboarding && (
        <div className="bg-[#424af6]/10 border border-[#424af6]/40 rounded-2xl p-6 shadow-lg">
          <p className="text-[10px] uppercase tracking-widest font-bold text-[#bfc2ff] mb-2">
            Welcome — let's get you set up
          </p>
          <h2 className="text-xl font-bold text-white mb-4 font-headline">
            Three quick steps to start filling orders
          </h2>
          <ol className="space-y-2 text-sm text-[#c6c5d9]">
            <li className="flex items-start gap-3">
              <span className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-[#424af6] text-white text-xs font-bold flex items-center justify-center">1</span>
              <span><b className="text-white">Connect your wallet</b> — the wallet that will sign orders.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-[#424af6] text-white text-xs font-bold flex items-center justify-center">2</span>
              <span><b className="text-white">Register your solver</b> — proves you control the wallet.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-[#424af6] text-white text-xs font-bold flex items-center justify-center">3</span>
              <span><b className="text-white">Tell us where to send your fills</b> — one contract address per chain.</span>
            </li>
          </ol>
        </div>
      )}

      {/* Header */}
      <header className="flex justify-between items-end">
        <div>
          <h1 className="font-headline text-3xl font-bold text-white">Your solver account</h1>
          <p className="text-[#c6c5d9] text-sm mt-1">
            Manage your dashboard password and the contracts you'll receive fills on.
          </p>
        </div>
      </header>

      {/* ─── Step 1 — Wallet ───────────────────────────────────────────── */}
      <section className="glass-panel p-6 rounded-2xl bg-[#151f37]/80 border border-[#454556]/30 shadow-2xl space-y-4">
        <header className="flex justify-between items-start">
          <div>
            <h2 className="text-lg font-bold font-headline text-white mb-1">
              1 · Your wallet
            </h2>
            <p className="text-[#c6c5d9] text-xs">
              {solverId
                ? `Connected as ${address?.slice(0, 6)}…${address?.slice(-4)}. This wallet signs every order you fill.`
                : 'Connect the wallet that will sign the orders you fill.'}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#424af6]/10 flex items-center justify-center text-[#bfc2ff]">
            <span className="material-symbols-outlined text-2xl">account_balance_wallet</span>
          </div>
        </header>
        {address && (
          <p className="text-xs text-emerald-400 font-mono break-all bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2">
            ✓ {address}
          </p>
        )}
      </section>

      {/* ─── Step 2 — Register ─────────────────────────────────────────── */}
      <section className="glass-panel p-6 rounded-2xl bg-[#151f37]/80 border border-[#454556]/30 shadow-2xl space-y-4">
        <header className="flex justify-between items-start">
          <div>
            <h2 className="text-lg font-bold font-headline text-white mb-1">
              2 · Register your solver
            </h2>
            <p className="text-[#c6c5d9] text-xs">
              Tell the network about your wallet. You'll sign one short message —
              no gas, no transaction.
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#424af6]/10 flex items-center justify-center text-[#bfc2ff]">
            <span className="material-symbols-outlined text-2xl">how_to_reg</span>
          </div>
        </header>
        {isRegistered === null ? (
          <p className="text-[#c6c5d9] text-xs">Checking registration…</p>
        ) : isRegistered ? (
          <div className="flex items-center gap-3 px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
            <span className="material-symbols-outlined text-2xl text-emerald-400">check_circle</span>
            <div>
              <p className="text-sm font-bold text-white">Already registered</p>
              <p className="text-[11px] text-emerald-200/80">
                Your wallet is in the network. Move on to step 3 below.
              </p>
            </div>
          </div>
        ) : (
          <>
            <button
              onClick={() => navigate('/terminal?tab=registration')}
              className="w-full px-6 py-4 bg-[#424af6] text-white font-bold text-sm uppercase tracking-wider rounded-xl shadow-lg shadow-[#424af6]/25 hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <span>Register my wallet</span>
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </button>
            <p className="text-[11px] text-[#8f8fa2] text-center">
              After registration you'll come back here to finish setup.
            </p>
          </>
        )}
      </section>

      {/* ─── Step 3 — Dashboard password (API key) ─────────────────────── */}
      <section className="glass-panel p-6 rounded-2xl bg-[#151f37]/80 border border-[#454556]/30 shadow-2xl space-y-4">
        <header className="flex justify-between items-start">
          <div>
            <h2 className="text-lg font-bold font-headline text-white mb-1">
              3 · Your dashboard password
            </h2>
            <p className="text-[#c6c5d9] text-xs">
              We generated this automatically — it lets this dashboard talk to
              the network on your behalf. You can reset it any time.
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#424af6]/10 flex items-center justify-center text-[#bfc2ff]">
            <span className="material-symbols-outlined text-2xl">vpn_key</span>
          </div>
        </header>

        <div className="space-y-3 font-mono">
          <div className="flex items-center gap-3 bg-[#030d25] rounded-xl border border-[#454556]/40 p-4 shadow-inner">
            <input
              type={showKey ? 'text' : 'password'}
              readOnly
              value={apiKey}
              className="bg-transparent border-none focus:ring-0 text-[#bfc2ff] flex-1 text-xs font-bold font-mono outline-none tracking-wider"
            />
            <button
              onClick={handleCopy}
              disabled={!apiKey}
              className="p-2 hover:bg-[#424af6]/20 rounded-lg text-[#c6c5d9] hover:text-white transition-colors disabled:opacity-40"
              title="Copy password"
            >
              <span className="material-symbols-outlined text-lg">
                {copied ? 'check' : 'content_copy'}
              </span>
            </button>
            <button
              onClick={() => setShowKey(!showKey)}
              className="p-2 hover:bg-[#424af6]/20 rounded-lg text-[#c6c5d9] hover:text-white transition-colors"
              title={showKey ? 'Hide password' : 'Show password'}
            >
              <span className="material-symbols-outlined text-lg">
                {showKey ? 'visibility_off' : 'visibility'}
              </span>
            </button>
          </div>
          {copied && (
            <p className="text-[11px] text-emerald-400 font-bold flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">check_circle</span>
              <span>Copied to clipboard</span>
            </p>
          )}

          {rotateError && (
            <div className="p-3 rounded-xl text-xs font-bold border bg-[#93000a]/20 text-[#ffb4ab] border-[#93000a]/40">
              {rotateError}
            </div>
          )}

          <div className="flex flex-wrap gap-3 pt-1">
            <button
              onClick={handleCopy}
              disabled={!apiKey}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#424af6] text-white rounded-xl font-bold hover:brightness-110 active:scale-95 transition-all text-xs uppercase tracking-wider shadow-md shadow-[#424af6]/25 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-base">content_copy</span>
              <span>Copy password</span>
            </button>
            <button
              onClick={handleRotateKey}
              disabled={rotating || !solverId}
              className="flex items-center gap-2 px-4 py-2.5 border border-[#454556]/40 text-white rounded-xl font-bold hover:bg-white/5 active:scale-95 transition-all text-xs uppercase tracking-wider disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-base">
                {rotating ? 'progress_activity' : 'refresh'}
              </span>
              <span>{rotating ? 'Resetting…' : 'Reset password'}</span>
            </button>
          </div>
        </div>
      </section>

      {/* ─── Step 4 — Where to send fills ───────────────────────────────── */}
      <section className="glass-panel p-6 rounded-2xl bg-[#151f37]/80 border border-[#454556]/30 shadow-2xl space-y-4">
        <header className="flex justify-between items-start">
          <div>
            <h2 className="text-lg font-bold font-headline text-white mb-1">
              4 · Where to send your fills
            </h2>
            <p className="text-[#c6c5d9] text-xs">
              For each chain you want to fill on, tell us which contract should
              receive your fill transactions. You can use the default below or
              paste your own.
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#424af6]/10 flex items-center justify-center text-[#bfc2ff]">
            <span className="material-symbols-outlined text-2xl">send</span>
          </div>
        </header>

        {contractsError && (
          <div className="p-3 rounded-xl text-xs font-bold border bg-[#93000a]/20 text-[#ffb4ab] border-[#93000a]/40">
            {contractsError}
          </div>
        )}

        {/* Existing contracts */}
        <div className="space-y-2 font-mono">
          {contractsLoading ? (
            <p className="text-[#c6c5d9] text-xs">Loading…</p>
          ) : Object.keys(contracts).length === 0 ? (
            <div className="text-xs text-[#c6c5d9] space-y-3">
              <p>
                You haven't added a contract yet. Without one, your fill-worker
                won't be able to broadcast fills on that chain.
              </p>
              <p>
                <b className="text-white">Quick start:</b> pick a chain below and
                we'll add the standard testnet contract for you. You can change
                it later.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[#454556]/30 border border-[#454556]/30 rounded-xl overflow-hidden">
              {Object.entries(contracts)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([chainId, address]) => (
                  <li
                    key={chainId}
                    className="flex items-center justify-between gap-4 px-4 py-3 bg-[#030d25]/40"
                  >
                    <div className="min-w-0">
                      <p className="text-[10px] text-[#8f8fa2] uppercase tracking-widest">
                        Chain {chainId}
                      </p>
                      <p className="text-xs text-white font-mono break-all">{address}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveContract(Number(chainId))}
                      className="shrink-0 px-3 py-1.5 text-[10px] uppercase tracking-wider text-[#ffb4ab] hover:bg-[#93000a]/20 rounded-lg transition-colors"
                    >
                      Remove
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>

        {/* Quick-add canonical OIF settlers (one-click) */}
        <div className="space-y-2">
          <p className="text-[10px] text-[#8f8fa2] uppercase tracking-widest font-bold">
            Or pick a default testnet contract:
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { chainId: 11155420, label: 'Optimism Sepolia', addr: '0x1CC9260E285C2C8AC8D2E7102F3978056Ec1d0a8' },
              { chainId: 84532,    label: 'Base Sepolia',     addr: '0x52602D7cc3D833F5d28ee6D01C7F82C9b2322e10' },
            ].map(({ chainId, label, addr }) => (
              <button
                key={chainId}
                onClick={async () => {
                  if (!solverId || addingContract) return;
                  // Pass values directly — going through `setNewAddress(addr)`
                  // followed by `handleAddContract()` reads stale state because
                  // React batches the setter and the call in the same tick.
                  setAddingContract(true);
                  setContractsError(null);
                  try {
                    const updated = await SolverApiService.setSettlementContract(
                      solverId, chainId, addr,
                    );
                    if (updated) {
                      const fresh = await SolverApiService.getSettlementContracts(solverId);
                      if (fresh) setContracts(fresh);
                    } else {
                      setContractsError('Aggregator rejected the contract update.');
                    }
                  } catch (e: unknown) {
                    setContractsError(e instanceof Error ? e.message : 'Failed to add contract');
                  } finally {
                    setAddingContract(false);
                  }
                }}
                disabled={!solverId || addingContract}
                className="px-4 py-2.5 border border-[#454556]/40 rounded-xl text-xs font-bold text-[#bfc2ff] hover:text-white hover:border-[#424af6] hover:bg-[#424af6]/10 transition-all disabled:opacity-40 flex items-center gap-2"
                title={`Add ${label} settlement contract`}
              >
                <span className="material-symbols-outlined text-sm">add_circle</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Manual add */}
        <details className="font-mono pt-3 border-t border-[#454556]/30">
          <summary className="text-xs text-[#8f8fa2] cursor-pointer hover:text-[#bfc2ff] transition-colors">
            Add a custom contract (advanced)
          </summary>
          <div className="grid grid-cols-1 md:grid-cols-[160px_1fr_auto] gap-3 pt-3">
            <input
              type="text"
              value={newChainId}
              onChange={(e) => setNewChainId(e.target.value)}
              placeholder="Chain ID"
              className="bg-[#030d25] border border-[#454556]/40 rounded-xl px-4 py-3 text-xs text-white focus:border-[#424af6] focus:outline-none"
            />
            <input
              type="text"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="0x… contract address"
              className="bg-[#030d25] border border-[#454556]/40 rounded-xl px-4 py-3 text-xs text-white font-mono focus:border-[#424af6] focus:outline-none"
            />
            <button
              onClick={handleAddContract}
              disabled={addingContract || !solverId}
              className="px-5 py-3 bg-[#424af6] text-white rounded-xl font-bold text-xs uppercase tracking-wider hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 flex items-center gap-2 justify-center"
            >
              <span className="material-symbols-outlined text-base">
                {addingContract ? 'progress_activity' : 'add'}
              </span>
              <span>{addingContract ? 'Saving…' : 'Add'}</span>
            </button>
          </div>
        </details>

        {!solverId && (
          <p className="text-[11px] text-[#8f8fa2] font-mono">
            Connect a wallet first — the network needs to know which solver owns each contract.
          </p>
        )}
      </section>

      {/* Mark onboarding complete — only visible when banner is showing */}
      {isOnboarding && (
        <div className="flex justify-center">
          <button
            onClick={() => {
              markOnboardingComplete();
              navigate('/terminal?tab=contracts', { replace: true });
            }}
            className="px-6 py-2.5 bg-white/5 border border-[#454556]/40 text-white rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-white/10 transition-all flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">task_alt</span>
            <span>I'll finish this later — skip for now</span>
          </button>
        </div>
      )}
    </div>
  );
};
