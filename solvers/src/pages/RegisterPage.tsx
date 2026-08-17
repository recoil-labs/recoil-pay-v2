import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { RegistrationWizard } from '../components/solver/RegistrationWizard';
import { SolverApiService } from '../services/solverApi';

/**
 * Onboarding for an operator who does not have an API key yet.
 *
 * This route is deliberately OUTSIDE `AuthGuard`. Registration is how an
 * operator obtains their API key, so requiring one to reach this page is
 * circular: the guard would bounce them to `/connect`, which sends them
 * back here, and the two would ping-pong until the browser throttled the
 * navigation.
 *
 * A wallet is still required — the wizard's second step signs an EIP-191
 * message proving control of the address — so an unconnected visitor is
 * sent to `/connect` to pick a wallet first.
 */
export const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { isConnected } = useAccount();

  const alreadyRegistered = !!SolverApiService.getApiKey();

  useEffect(() => {
    if (!isConnected) {
      navigate('/connect', { replace: true });
    } else if (alreadyRegistered) {
      // Already holds a key — no reason to re-run onboarding.
      navigate('/', { replace: true });
    }
  }, [isConnected, alreadyRegistered, navigate]);

  if (!isConnected || alreadyRegistered) return null;

  return (
    <div className="min-h-screen bg-[#08122a] text-[#dae2ff] font-sans py-10 px-4">
      <div className="max-w-[1000px] mx-auto">
        <RegistrationWizard
          onRegistered={() => {
            // The wizard stores the freshly issued API key, so the guard
            // will now let us through to the dashboard.
            navigate('/', { replace: true });
          }}
        />
      </div>
    </div>
  );
};
