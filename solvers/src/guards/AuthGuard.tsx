import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { SolverApiService } from '../services/solverApi';

/**
 * AuthGuard — wallet-first, no email/password.
 *
 * The dashboard's only credential is the operator's wallet. The
 * previous guard relied on a `localStorage.auth_token` set by the
 * (now-removed) `LoginPage`'s fake email/password flow. That token
 * was synthetic (`tok_${solverId}_${Date.now()}`) and unrelated to
 * the aggregator's actual auth (`x-api-key`), so the guard could
 * pass without the user being authenticated in any meaningful sense.
 *
 * The new rule: pass if and only if the operator's per-row
 * `linkiswap_solver_api_key` is present in localStorage. The
 * `ConnectPage` (mounted at `/connect`) is where the wallet actually
 * signs in. We do **not** verify the key here — the user might
 * briefly land on a guarded route before `ConnectPage` finishes
 * its lookup; failing fast on stale keys is `ConnectPage`'s job.
 */
interface AuthGuardProps {
	children: React.ReactNode;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
	const location = useLocation();
	const apiKey = SolverApiService.getApiKey();

	if (!apiKey) {
		return <Navigate to="/connect" state={{ from: location }} replace />;
	}

	return <>{children}</>;
};