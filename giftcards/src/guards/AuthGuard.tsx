import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useAuthStore } from '../stores/auth-store';

/* Two separate gates, because they fail for different reasons and want
   different destinations:

   - no wallet connected  → /connect
   - wallet but no api_key → /register (registration is what issues the key)

   Collapsing them would bounce an unregistered merchant to a connect screen
   that immediately sends them back, which reads as a broken loop. */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  const isRegistered = useAuthStore((s) => s.isRegistered);
  const location = useLocation();

  if (!isConnected) {
    return <Navigate to="/connect" replace state={{ from: location.pathname }} />;
  }

  if (!isRegistered) {
    return <Navigate to="/register" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
