import { create } from 'zustand';
import { clearSession, getApiKey, getSolverId, setApiKey, setSolverId } from '../api/merchantApi';

/* Session state. The api_key is the credential; the connected wallet is
   only the thing that obtained it. Both have to be present to use the
   dashboard — a connected wallet with no key means "registered elsewhere or
   not yet registered", and the guard sends that case to /register rather
   than letting authenticated calls 401 one by one. */

interface AuthState {
  apiKey: string;
  solverId: string;
  isRegistered: boolean;
  adopt: (input: { apiKey?: string; solverId?: string }) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  apiKey: getApiKey(),
  solverId: getSolverId(),
  isRegistered: Boolean(getApiKey() && getSolverId()),

  adopt: ({ apiKey, solverId }) =>
    set(() => {
      if (apiKey) setApiKey(apiKey);
      if (solverId) setSolverId(solverId);
      const nextKey = apiKey ?? getApiKey();
      const nextId = solverId ?? getSolverId();
      return {
        apiKey: nextKey,
        solverId: nextId,
        isRegistered: Boolean(nextKey && nextId),
      };
    }),

  signOut: () => {
    clearSession();
    set({ apiKey: '', solverId: '', isRegistered: false });
  },
}));
