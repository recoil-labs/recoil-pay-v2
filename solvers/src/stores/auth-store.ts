import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserIdentity } from '../types/auth';
import type { Permission } from '../types/permissions';

interface AuthState {
    token: string | null;
    user: UserIdentity | null;
    isAuthenticated: boolean;
    elevatedUntil: string | null;
    /**
     * Per-solver onboarding completion flag. Persisted so the "Welcome"
     * banner only shows on the user's first visit. Reset by `logout()`.
     */
    isOnboardingComplete: boolean;

    setAuth: (token: string, user: UserIdentity) => void;
    updateToken: (token: string) => void;
    logout: () => void;
    markOnboardingComplete: () => void;
    resetOnboarding: () => void;

    setElevated: (expiresAt: string) => void;
    clearElevation: () => void;
    hasPermission: (permission: Permission) => boolean;
    isElevated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            token: null,
            user: null,
            isAuthenticated: false,
            elevatedUntil: null,
            isOnboardingComplete: false,

            setAuth: (token, user) => {
                localStorage.setItem('auth_token', token);
                set({ token, user, isAuthenticated: true });
            },

            updateToken: (token) => {
                localStorage.setItem('auth_token', token);
                set({ token });
            },

            logout: () => {
                localStorage.removeItem('auth_token');
                set({
                    token: null,
                    user: null,
                    isAuthenticated: false,
                    elevatedUntil: null,
                    isOnboardingComplete: false,
                });
            },

            markOnboardingComplete: () => set({ isOnboardingComplete: true }),
            resetOnboarding: () => set({ isOnboardingComplete: false }),

            setElevated: (expiresAt) => {
                set({ elevatedUntil: expiresAt });
            },

            clearElevation: () => {
                set({ elevatedUntil: null });
            },

            hasPermission: (permission) => {
                const { user } = get();
                if (!user) return false;
                // Super Admin has all permissions
                if (user.roles.includes('super_admin')) return true;
                return user.permissions.includes(permission);
            },

            isElevated: () => {
                const { elevatedUntil } = get();
                if (!elevatedUntil) return false;
                return new Date(elevatedUntil) > new Date();
            },
        }),
        {
            name: 'auth-storage',
            partialize: (state) => ({
                token: state.token,
                user: state.user,
                isAuthenticated: state.isAuthenticated,
                elevatedUntil: state.elevatedUntil,
                isOnboardingComplete: state.isOnboardingComplete,
            }),
        }
    )
);
