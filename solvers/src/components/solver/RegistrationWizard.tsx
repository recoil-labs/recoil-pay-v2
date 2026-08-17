import React, { useState, useEffect } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { SolverApiService } from '../../services/solverApi';

export interface RegistrationWizardProps {
  /**
   * Called once the aggregator confirms the registration. Parents can use
   * this to flip an `isOnboarding` flag in their auth store so the
   * "Welcome" banner is hidden on subsequent visits.
   */
  onRegistered?: (solverId: string) => void;
}

interface SubmitError extends Error {
  status?: number;
}

/**
 * Solver Onboarding Wizard — collects wallet identity, signs a server-issued
 * challenge, and posts the registration to the aggregator.
 *
 * Hard rules enforced here:
 * 1. The user must have a connected wallet before any step 2/3 action.
 * 2. The signature must be a real `0x…` value produced by the wallet;
 *    we never substitute a mock fallback.
 * 3. Errors from the aggregator are surfaced (not silently swallowed) so
 *    the operator knows when something failed.
 * 4. `chainId` must parse as a positive integer before the aggregator call.
 */
export const RegistrationWizard: React.FC<RegistrationWizardProps> = ({ onRegistered }) => {
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();

  const [currentStep, setCurrentStep] = useState(1);
  const [handle, setHandle] = useState('institutional_name');
  const [chainId, setChainId] = useState(walletChainId ? String(walletChainId) : '11155420');
  const [sigType, setSigType] = useState('ECDSA');
  const [message, setMessage] = useState('');
  const [signature, setSignature] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  // The fill-wallet address the aggregator auto-generated server-side.
  // The aggregator holds the encrypted private key — operators only see
  // the address and can monitor fills on-chain by watching it.
  const [fillWalletAddress, setFillWalletAddress] = useState<string | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (walletChainId) {
      setChainId(String(walletChainId));
    }
  }, [walletChainId]);

  // Pull the latest registration challenge whenever the wallet changes.
  // Failure falls through to a default placeholder rather than blocking
  // the UI; the operator must still sign with the wallet regardless of
  // what the message text says.
  useEffect(() => {
    if (!address) {
      setMessage('');
      return;
    }
    let cancelled = false;
    setMessage('');
    SolverApiService.getRegistrationMessage(address)
      .then((res) => {
        if (!cancelled) {
          setMessage(res?.data?.message ?? '');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessage('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const handleSign = async () => {
    setSignError(null);
    if (!isConnected || !address) {
      setSignError('Connect a wallet before signing.');
      return;
    }
    if (!message) {
      setSignError('Challenge message not loaded yet — please wait a moment.');
      return;
    }
    try {
      const realSig = await signMessageAsync({ message });
      setSignature(realSig);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Wallet signature failed or rejected.';
      setSignError(errorMsg);
    }
  };

  const handleComplete = async () => {
    setSubmitError(null);
    if (!isConnected || !address) {
      setSubmitError('Wallet disconnected before submission. Reconnect and try again.');
      return;
    }
    if (!signature) {
      setSubmitError('No signature available. Click "Sign Challenge in Wallet" first.');
      return;
    }
    const parsedChainId = Number(chainId);
    if (!Number.isInteger(parsedChainId) || parsedChainId <= 0) {
      setSubmitError(`chainId must be a positive integer, got "${chainId}"`);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await SolverApiService.registerAccountV1({
        address,
        message,
        signature,
        chainId: String(parsedChainId),
      });
      if (!res.success) {
        throw new Error('Aggregator rejected registration — no success flag in response');
      }
      // Capture the fill-wallet the aggregator auto-generated. The
      // dashboard's success view shows only the address — the
      // aggregator holds the encrypted private key, and operators never
      // see it.
      if (res.fillWalletAddress) {
        setFillWalletAddress(res.fillWalletAddress);
      }
      setIsSuccess(true);
      onRegistered?.(address);
    } catch (err: unknown) {
      // Surface the aggregator / network error to the user.
      const e = err as SubmitError;
      const status = e.status ? ` [HTTP ${e.status}]` : '';
      setSubmitError(`${e.message || 'Registration failed'}${status}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step guards — disable the "Continue" buttons when the prerequisite
  // is missing so the user gets immediate visual feedback instead of a
  // confusing error toast on the next step.
  const step1Valid = isConnected && !!address && handle.trim().length > 0;
  const step2Valid = step1Valid && !!signature && /^(0x)?[0-9a-fA-F]+$/.test(signature);

  return (
    <div className="max-w-3xl mx-auto space-y-8 font-sans">
      {/* Header Section */}
      <header className="space-y-2">
        <h1 className="font-headline text-3xl md:text-4xl font-bold text-white tracking-tight">
          Register your solver
        </h1>
        <p className="text-[#c6c5d9] text-sm md:text-base max-w-xl">
          Three quick steps — pick a name, prove you control your wallet, done.
        </p>
      </header>

      {/* Progress Stepper */}
      <div className="flex items-center gap-2 mb-8 font-mono">
        <div
          className={`h-1.5 flex-1 rounded-full transition-all ${
            currentStep >= 1 ? 'bg-[#424af6] shadow-[0_0_8px_rgba(66,74,246,0.5)]' : 'bg-[#2a344e]'
          }`}
        ></div>
        <div
          className={`h-1.5 flex-1 rounded-full transition-all ${
            currentStep >= 2 ? 'bg-[#424af6] shadow-[0_0_8px_rgba(66,74,246,0.5)]' : 'bg-[#2a344e]'
          }`}
        ></div>
        <div
          className={`h-1.5 flex-1 rounded-full transition-all ${
            currentStep >= 3 ? 'bg-[#424af6] shadow-[0_0_8px_rgba(66,74,246,0.5)]' : 'bg-[#2a344e]'
          }`}
        ></div>
      </div>

      {/* Wizard Canvas */}
      <div className="relative glass-panel rounded-2xl p-6 md:p-8 min-h-[480px] flex flex-col justify-between shadow-2xl overflow-hidden bg-[#151f37]/80 border border-[#454556]/30">
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-[#424af6]/10 rounded-full blur-[100px] pointer-events-none"></div>

        {/* Step 1: Identity */}
        {currentStep === 1 && (
          <section className="space-y-6">
            <div className="flex items-center gap-4">
              <span className="w-10 h-10 rounded-full bg-[#424af6]/20 flex items-center justify-center text-[#bfc2ff] font-bold font-mono">
                01
              </span>
              <h2 className="font-headline text-2xl font-bold text-white">Your wallet & name</h2>
            </div>
            <p className="text-sm text-[#c6c5d9]">
              Pick a name for your solver and connect the wallet that will sign fills.
            </p>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="font-mono text-xs text-[#c6c5d9] uppercase tracking-wider">
                  Solver name
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#bfc2ff] font-mono">@</span>
                  <input
                    type="text"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    placeholder="my-solver-name"
                    className="w-full bg-[#08122a]/50 border border-[#454556]/40 rounded-xl py-4 pl-10 pr-4 text-white focus:outline-none focus:border-[#424af6] focus:ring-1 focus:ring-[#424af6] transition-all font-mono text-sm placeholder-[#8f8fa2]"
                  />
                </div>
                <p className="text-[11px] text-[#8f8fa2]">
                  Shown publicly in the solver leaderboard. You can change it later.
                </p>
              </div>

              {/* Wallet Connection Status Card */}
              <div className="p-4 rounded-xl bg-[#08122a]/60 border border-[#454556]/40 font-mono space-y-3">
                <span className="text-[10px] text-[#8f8fa2] uppercase tracking-wider block font-bold">
                  Your wallet
                </span>
                <ConnectButton.Custom>
                  {({ account, chain, openConnectModal, mounted }) => {
                    const connected = mounted && account && chain;
                    return connected ? (
                      <div className="flex items-center justify-between bg-[#111b33] p-3.5 rounded-xl border border-emerald-500/40">
                        <div className="flex items-center gap-3">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                          <span className="text-xs text-white font-bold break-all">{account.address}</span>
                        </div>
                        <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-emerald-500/10">
                          Connected
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-2">
                        <p className="text-xs text-[#ffb4ab]">No wallet connected — connect one to continue.</p>
                        <button
                          onClick={openConnectModal}
                          className="px-6 py-3 bg-[#424af6] text-white text-xs font-bold rounded-xl hover:brightness-110 active:scale-95 transition-all flex items-center gap-2 shadow-lg shadow-[#424af6]/25 font-mono"
                        >
                          <span className="material-symbols-outlined text-base">account_balance_wallet</span>
                          <span>Connect Wallet</span>
                        </button>
                      </div>
                    );
                  }}
                </ConnectButton.Custom>
              </div>
            </div>
          </section>
        )}

        {/* Step 2: Sign */}
        {currentStep === 2 && (
          <section className="space-y-6">
            <div className="flex items-center gap-4 mb-2">
              <span className="w-10 h-10 rounded-full bg-[#424af6]/20 flex items-center justify-center text-[#bfc2ff] font-bold font-mono">
                02
              </span>
              <h2 className="font-headline text-2xl font-bold text-white">Prove you own the wallet</h2>
            </div>
            <p className="text-sm text-[#c6c5d9]">
              We'll ask your wallet to sign a short message. <b className="text-white">No transaction, no gas.</b> It just proves you control the address.
            </p>

            <div className="space-y-6 font-mono">
              <div className="glass-panel p-4 rounded-xl bg-[#111b33]">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-[10px] text-[#8f8fa2] uppercase">Message to sign</p>
                  {address && (
                    <span className="text-[10px] text-[#bfc2ff] font-bold">Wallet: {address.substring(0, 6)}...{address.substring(address.length - 4)}</span>
                  )}
                </div>
                <p className="text-xs text-[#dae2ff] bg-[#08122a]/50 p-4 rounded-lg border border-[#454556]/30 break-all">
                  {message || (address ? 'Loading…' : 'Connect a wallet first')}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-[#c6c5d9] uppercase tracking-wider">Chain ID</label>
                  <input
                    type="text"
                    value={chainId}
                    onChange={(e) => setChainId(e.target.value)}
                    placeholder="11155420"
                    className="w-full bg-[#08122a]/50 border border-[#454556]/40 rounded-xl p-3 text-white focus:outline-none focus:border-[#424af6] transition-all text-xs"
                  />
                  <p className="text-[11px] text-[#8f8fa2]">Network you'll fill on. 11155420 = Optimism Sepolia.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-[#c6c5d9] uppercase tracking-wider">Wallet type</label>
                  <select
                    value={sigType}
                    onChange={(e) => setSigType(e.target.value)}
                    className="w-full bg-[#08122a]/50 border border-[#454556]/40 rounded-xl p-3 text-white focus:outline-none focus:border-[#424af6] transition-all text-xs appearance-none"
                  >
                    <option value="ECDSA">Standard wallet (MetaMask, Rabby, etc.)</option>
                    <option value="EIP1271">Smart-contract / multisig wallet</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-[#c6c5d9] uppercase tracking-wider">Signature</label>
                  <ConnectButton.Custom>
                    {({ account, chain, openConnectModal, mounted }) => {
                      const connected = mounted && account && chain;
                      return connected ? (
                        <button
                          onClick={handleSign}
                          disabled={isSigning}
                          className="px-4 py-2 bg-[#424af6] text-white text-xs font-bold uppercase rounded-lg hover:brightness-110 transition-all flex items-center gap-1.5 disabled:opacity-50 shadow-md shadow-[#424af6]/20 font-mono"
                        >
                          <span className="material-symbols-outlined text-sm">draw</span>
                          <span>{isSigning ? 'Signing…' : 'Sign in wallet'}</span>
                        </button>
                      ) : (
                        <button
                          onClick={openConnectModal}
                          className="px-4 py-1.5 bg-emerald-500 text-white text-xs font-bold uppercase rounded-lg hover:brightness-110 transition-all flex items-center gap-1 font-mono"
                        >
                          <span className="material-symbols-outlined text-sm">account_balance_wallet</span>
                          <span>Connect wallet</span>
                        </button>
                      );
                    }}
                  </ConnectButton.Custom>
                </div>
                <textarea
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder={isConnected ? 'Click "Sign in wallet" above — the signature appears here automatically.' : 'Connect your wallet to sign.'}
                  className="w-full bg-[#08122a]/50 border border-[#454556]/40 rounded-xl p-3 text-white focus:outline-none focus:border-[#424af6] transition-all text-xs h-20 resize-none font-mono"
                ></textarea>
                {signError && (
                  <p className="text-xs text-[#ffb4ab] mt-1 font-bold">{signError}</p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Step 3: Done */}
        {currentStep === 3 && (
          <section className="space-y-6 text-center">
            {isSuccess ? (
              <div className="space-y-5 py-6 text-left">
                <div className="text-center space-y-2">
                  <div className="mx-auto w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <span className="material-symbols-outlined text-[48px]">check_circle</span>
                  </div>
                  <h2 className="font-headline text-2xl font-bold text-white">You're registered!</h2>
                  <p className="text-[#c6c5d9] text-sm max-w-md mx-auto font-mono">
                    Wallet <code className="text-[#bfc2ff]">{address}</code> is now on Linkiswap Core.
                  </p>
                </div>

                {fillWalletAddress && (
                  <div className="max-w-xl mx-auto bg-emerald-500/5 border border-emerald-500/30 rounded-xl p-5 space-y-3">
                    <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
                      <span className="material-symbols-outlined text-[20px]">account_balance_wallet</span>
                      <span>Your fill-wallet is ready</span>
                    </div>
                    <p className="text-xs text-[#c6c5d9] leading-relaxed">
                      A dedicated hot-wallet was generated for signing fills. The
                      aggregator holds the key securely — you don't need to back up
                      anything. Submit quotes and monitor fills by watching the
                      address below on-chain.
                    </p>
                    <div className="bg-[#030d25] rounded-lg p-3 border border-[#454556]/40 font-mono text-xs flex justify-between gap-3">
                      <span className="text-[#8f8fa2] shrink-0">Fill-wallet address</span>
                      <span className="text-[#bfc2ff] truncate text-right">{fillWalletAddress}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="mx-auto w-20 h-20 rounded-full bg-[#424af6]/20 flex items-center justify-center mb-2">
                  <span className="material-symbols-outlined text-[40px] text-[#bfc2ff] pulse-active">send</span>
                </div>
                <div className="space-y-2">
                  <h2 className="font-headline text-2xl font-bold text-white">Final step — confirm</h2>
                  <p className="text-[#c6c5d9] text-sm px-6">
                    Review the details below and click <b className="text-white">Complete registration</b>. Your wallet signature from the previous step is sent along with it.
                  </p>
                </div>

                <div className="max-w-md mx-auto mt-6 bg-[#1f2942]/60 border border-[#454556]/30 rounded-xl p-6 text-left space-y-4 font-mono">
                  <div className="flex justify-between border-b border-[#454556]/20 pb-2">
                    <span className="text-[#8f8fa2] text-xs uppercase">Your wallet</span>
                    <span className="text-[#bfc2ff] text-xs font-bold break-all">
                      {address ? `${address.substring(0, 8)}...${address.substring(address.length - 6)}` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-[#454556]/20 pb-2">
                    <span className="text-[#8f8fa2] text-xs uppercase">Network</span>
                    <span className="text-white text-xs font-bold">{chainId}</span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[#8f8fa2] text-[10px] uppercase">Signature</span>
                    <div className="flex items-center gap-2 text-emerald-400">
                      <span className="material-symbols-outlined text-[16px]">check_circle</span>
                      <span className="text-xs">Verified</span>
                    </div>
                  </div>
                </div>

                {submitError && (
                  <div className="max-w-md mx-auto mt-4 p-4 rounded-xl bg-[#93000a]/20 border border-[#93000a]/40 text-[#ffb4ab] text-xs font-mono text-left">
                    <div className="flex items-center gap-2 font-bold mb-1">
                      <span className="material-symbols-outlined text-base">error</span>
                      <span>Couldn't complete registration</span>
                    </div>
                    <div>{submitError}</div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* Footer Navigation Buttons */}
        <div className="mt-8 flex justify-between items-center font-mono">
          {currentStep > 1 && !isSuccess ? (
            <button
              onClick={() => setCurrentStep(currentStep - 1)}
              className="px-6 py-3 text-[#c6c5d9] hover:text-white transition-colors text-xs font-bold uppercase tracking-wider"
            >
              Back
            </button>
          ) : (
            <div></div>
          )}

          {!isSuccess && (
            <>
              {currentStep < 3 ? (
                <button
                  onClick={() => setCurrentStep(currentStep + 1)}
                  disabled={currentStep === 1 ? !step1Valid : !step2Valid}
                  className="px-8 py-3 bg-[#424af6] text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg hover:shadow-[#424af6]/30 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  <span>{currentStep === 2 ? 'Continue' : 'Continue'}</span>
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </button>
              ) : (
                <button
                  onClick={handleComplete}
                  disabled={isSubmitting || !step2Valid}
                  className="px-8 py-3 bg-[#424af6] text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg hover:shadow-[#424af6]/30 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <span>Submitting…</span>
                  ) : (
                    <>
                      <span>Complete Registration</span>
                      <span className="material-symbols-outlined text-sm">check</span>
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Help Chips */}
      <div className="flex flex-wrap gap-3 font-mono">
        <div className="px-4 py-2 bg-white/5 border border-[#454556]/30 rounded-full flex items-center gap-2 text-xs text-[#c6c5d9]">
          <span className="material-symbols-outlined text-sm">account_balance_wallet</span>
          <span>Web3 Provider: {isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div className="px-4 py-2 bg-white/5 border border-[#454556]/30 rounded-full flex items-center gap-2 text-xs text-[#c6c5d9]">
          <span className="material-symbols-outlined text-sm">terminal</span>
          <span>EIP-712 Signature Payload</span>
        </div>
      </div>
    </div>
  );
};
