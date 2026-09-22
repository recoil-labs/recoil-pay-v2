import React, { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  SolverApiService,
  type OperatorDto,
} from '../../services/solverApi';
import { useAuthStore } from '../../stores/auth-store';

/**
 * FillWorkerPanel — shows the operator's fill-worker status and lets them
 * mint a fresh hot-wallet from the dashboard.
 *
 * Identity-handoff flow (new, fully automated):
 *   1. Operator clicks "Generate Key".
 *   2. Dashboard mints a fresh secp256k1 keypair via the aggregator.
 *   3. Dashboard queues the private key with the aggregator
 *      (`POST .../identity-queue`).
 *   4. The worker's next-boot poll (`GET .../identity-pull`) consumes
 *      it. No manual paste, no need to know the worker's URL.
 *
 * The dashboard no longer asks the operator to type a fill-worker URL —
 * the worker registers itself with the aggregator on boot (it knows
 * its own address via the `FILL_WORKER_URL` env var), so the URL field
 * is gone. The panel now shows the worker's self-reported URL as a
 * read-only diagnostic so operators can confirm the registration
 * reached the aggregator.
 */
export const FillWorkerPanel: React.FC = () => {
  // The aggregator's primary identity is the operator's wallet —
  // canonicalised to `solver-<hex-no-0x>`. The dashboard's auth-store
  // `username` is a separate dashboard-side identity and must not be
  // used for /solver-api/operators/{id}/* calls (it would silently
  // write to the wrong operator row).
  const { address } = useAccount();
  const solverId = address
    ? `solver-${address.toLowerCase().replace(/^0x/, '')}`
    : '';
  // Keep the auth-store import for parity with other panels even
  // though we no longer key off it.
  useAuthStore((s) => s.user);

  const [operator, setOperator] = useState<OperatorDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!solverId) return;
    setIsLoading(true);
    SolverApiService.getOperator(solverId)
      .then((op) => setOperator(op))
      .finally(() => setIsLoading(false));
  }, [solverId]);

  const handleHeartbeat = async () => {
    if (!solverId) return;
    const ok = await SolverApiService.sendHeartbeat(solverId);
    setMessage(
      ok
        ? { kind: 'ok', text: 'Heartbeat sent. Operator is live.' }
        : { kind: 'err', text: 'Heartbeat failed.' },
    );
  };

  if (isLoading) {
    return (
      <div className="glass-panel rounded-2xl p-8 bg-[#151f37]/80 border border-[#454556]/30 shadow-2xl">
        <p className="text-xs text-[#8f8fa2] uppercase tracking-widest font-mono">
          Loading fill-worker status…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans">
      <div className="glass-panel rounded-2xl p-8 bg-[#151f37]/80 border border-[#454556]/30 shadow-2xl">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-xl bg-[#424af6]/10 flex items-center justify-center text-[#bfc2ff]">
            <span className="material-symbols-outlined text-2xl">cloud_done</span>
          </div>
          <div>
            <h3 className="font-headline text-xl font-bold text-white">Fill-Worker Status</h3>
            <p className="text-xs text-[#c6c5d9] mt-0.5">
              Hosted by RecoilPay. Nothing to configure, nothing to deploy.
            </p>
          </div>
        </div>

        <div className="space-y-4 font-mono">
          <div className="space-y-2">
            <p className="text-xs text-[#c6c5d9] leading-relaxed">
              Every fill your quotes win is signed and broadcast by RecoilPay's
              hosted fill-worker. The aggregator holds your encrypted fill-wallet
              key and signs each transaction on your behalf. There is no worker
              binary for you to download, no env vars to set, no machine to keep
              online.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleHeartbeat}
              className="px-6 py-3 border border-[#454556]/40 text-white rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-white/5 active:scale-95 transition-all"
            >
              Send Heartbeat
            </button>
          </div>

          {message && (
            <div
              className={`p-3 rounded-xl text-xs font-bold border ${
                message.kind === 'ok'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-[#93000a]/20 text-[#ffb4ab] border-[#93000a]/40'
              }`}
            >
              {message.text}
            </div>
          )}
        </div>
      </div>

      {operator && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 font-mono">
          <Stat label="Reputation" value={operator.reputationScore.toFixed(2)} />
          <Stat label="Fills" value={`${operator.fillsSucceeded} / ${operator.fillsTotal}`} />
          <Stat label="Avg Latency" value={`${operator.avgLatencyMs}ms`} />
          <Stat
            label="Status"
            value={
              operator.lastActiveAt
                ? `Active ${new Date(operator.lastActiveAt).toLocaleTimeString()}`
                : 'Idle'
            }
          />
        </div>
      )}

      <FillWalletCard
        solverId={solverId}
        // The hot-wallet that signs fills — distinct from the operator's
        // registered wallet. The aggregator populated this on registration
        // and holds the encrypted private key server-side.
        currentAddress={operator?.fillWalletAddress ?? ''}
        onKeyGenerated={(updated) => setOperator(updated)}
      />

      <div className="glass-panel rounded-2xl p-6 bg-[#151f37]/60 border border-[#454556]/30 shadow-xl">
        <h4 className="text-sm font-bold text-white font-headline mb-3">How fills are signed</h4>
        <p className="text-xs text-[#c6c5d9] leading-relaxed">
          Every fill your quotes win is signed and broadcast by RecoilPay's
          hosted fill-worker. The aggregator holds your encrypted fill-wallet
          key and signs each transaction on your behalf. There is no worker
          binary for you to download, no env vars to set, no machine to keep
          online.
        </p>
      </div>
    </div>
  );
};

// ─── FillWalletCard ──────────────────────────────────────────────────────────

interface FillWalletCardProps {
  solverId: string;
  currentAddress: string;
  onKeyGenerated: (op: OperatorDto) => void;
}

/**
 * Displays the operator's fill-wallet address. The aggregator generated
 * the keypair at registration time and now holds the encrypted private
 * key server-side — the operator never sees it, never has to back it up,
 * never has to paste it into anything. They can monitor fills on-chain
 * by watching this address.
 *
 * Rotation ("Rotate Key" button) regenerates the keypair server-side
 * and re-encrypts the new private key in place. The old address becomes
 * inert (no more fills signed by it).
 */
const FillWalletCard: React.FC<FillWalletCardProps> = ({
  solverId,
  currentAddress,
  onKeyGenerated,
}) => {
  const [isRotating, setIsRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleRotate = async () => {
    if (!solverId) return;
    setIsRotating(true);
    setError(null);
    const result = await SolverApiService.generateOperatorKey(solverId);
    setIsRotating(false);
    if (!result) {
      setError('Could not rotate the fill-wallet — aggregator may be offline.');
      return;
    }
    // Refresh operator so the displayed address reflects the new one.
    const refreshed = await SolverApiService.getOperator(solverId);
    if (refreshed) onKeyGenerated(refreshed);
  };

  const handleCopy = async () => {
    if (!currentAddress) return;
    try {
      await navigator.clipboard.writeText(currentAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-8 bg-[#151f37]/80 border border-[#454556]/30 shadow-2xl">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-300">
          <span className="material-symbols-outlined text-2xl">account_balance_wallet</span>
        </div>
        <div>
          <h3 className="font-headline text-xl font-bold text-white">Your fill-wallet</h3>
          <p className="text-xs text-[#c6c5d9] mt-0.5">
            A wallet we generate and hold securely to sign your fills on-chain.
          </p>
        </div>
      </div>

      <div className="space-y-4 font-mono">
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-[#8f8fa2] uppercase tracking-widest block">
            Fill-wallet address
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={currentAddress || '(no wallet yet — registering will create one)'}
              className="flex-1 bg-[#030d25] border border-[#454556]/40 rounded-xl px-4 py-3 text-xs text-white"
            />
            <button
              onClick={handleCopy}
              disabled={!currentAddress}
              className="px-4 py-3 border border-[#454556]/40 text-white rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-white/5 active:scale-95 transition-all disabled:opacity-40"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[10px] text-[#8f8fa2]">
            Watch this address on Etherscan (or your preferred explorer) to see
            every fill your quotes win in real time. The private key stays on
            the aggregator — there's nothing for you to back up.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleRotate}
            disabled={isRotating || !solverId}
            className="px-6 py-3 bg-amber-500/90 text-black rounded-xl font-bold text-xs uppercase tracking-wider hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
          >
            {isRotating ? 'Rotating…' : 'Rotate key'}
          </button>
          <span className="text-[10px] text-[#8f8fa2]">
            Rotating generates a fresh fill-wallet and retires the old one.
            The aggregator stores the new key automatically.
          </span>
        </div>

        {error && (
          <div className="p-3 rounded-xl text-xs font-bold border bg-[#93000a]/20 text-[#ffb4ab] border-[#93000a]/40">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-[#151f37]/60 border border-[#454556]/30 rounded-xl p-4">
    <p className="text-[10px] uppercase tracking-widest text-[#8f8fa2] font-bold mb-1">
      {label}
    </p>
    <p className="text-lg font-bold text-white">{value}</p>
  </div>
);
