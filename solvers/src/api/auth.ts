import { SolverAuthService } from '../services/solverAuth';
import type { LoginResponse } from '../types/auth';

export const authApi = {
  login: async (username: string, password: string): Promise<LoginResponse> => {
    const res = await SolverAuthService.login(username, password);
    return {
      token: res.token,
      mfa_required: false,
    };
  },

  verifyMFA: async (username: string, password: string): Promise<LoginResponse> => {
    const res = await SolverAuthService.login(username, password);
    return {
      token: res.token,
      mfa_required: false,
    };
  },

  logout: async (): Promise<void> => {
    SolverAuthService.logout();
  },

  /**
   * Invite a user — creates a solver registration invite token.
   * Real implementation would call an invite endpoint; for now generates
   * a nonce tied to the email that expires server-side.
   */
  invite: async (email: string, _role?: string): Promise<{ token: string }> => {
    // Fetch a registration nonce from the aggregator for the invited address
    try {
      const res = await fetch('/api/v1/solver/register/message', {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const { data } = await res.json() as { data: { message: string } };
        // Encode email + nonce as the invite token
        const token = btoa(`${email}:${data.message}`);
        return { token };
      }
    } catch {
      // fall through
    }
    throw new Error('Cannot reach aggregator to generate invite token');
  },

  register: async (_token: string, username: string, password: string): Promise<void> => {
    await SolverAuthService.register(username, password);
  },

  requestPasswordReset: async (_email: string): Promise<{ message: string }> => {
    // Password reset not yet implemented in aggregator — solver auth is wallet-signature based
    return { message: 'Solver registration uses wallet signatures. Connect your wallet to authenticate.' };
  },
};
