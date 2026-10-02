import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useAuthStore } from '../stores/auth-store';

/** The wallet gate. There is no email/password anywhere in this app — the
 *  only credential is a wallet signature and the api_key it earns. */
export function ConnectPage() {
  const { isConnected } = useAccount();
  const isRegistered = useAuthStore((s) => s.isRegistered);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  useEffect(() => {
    if (!isConnected) return;
    // A connected wallet with no key has not registered on this aggregator
    // yet, so send it on to registration rather than to a dashboard whose
    // every request would 401.
    navigate(isRegistered ? (from ?? '/merchant') : '/merchant/register', { replace: true });
  }, [isConnected, isRegistered, from, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="w-full max-w-[400px] rounded-[14px] border border-hairline bg-surface p-7">
        <span className="mb-5 block h-7 w-7 rounded-[7px] bg-accent" aria-hidden />
        <h1 className="text-[20px] text-ink">Merchant sign-in</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Connect the wallet you registered with. Your wallet is your identity
          here — there is no password to lose.
        </p>
        <div className="mt-6">
          <ConnectButton chainStatus="none" showBalance={false} />
        </div>
      </div>
    </div>
  );
}
