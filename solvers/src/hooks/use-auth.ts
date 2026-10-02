import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/auth';
import { authzApi } from '../api/authz';
import { useAuthStore } from '../stores/auth-store';

export const useCurrentUser = () => {
    const { isAuthenticated, setAuth } = useAuthStore();

    return useQuery({
        queryKey: ['self'],
        queryFn: async () => {
            const user = await authzApi.getSelf();
            const token = localStorage.getItem('auth_token');
            if (token) setAuth(token, user);
            return user;
        },
        enabled: isAuthenticated || !!localStorage.getItem('auth_token'),
        retry: false,
    });
};

export const useLogin = () => {
    const queryClient = useQueryClient();
    // setAuth removed as unused

    return useMutation({
        mutationFn: ({ username, password }: Record<string, string>) => authApi.login(username, password),
        onSuccess: (data) => {
            if (!data.mfa_required && data.token) {
                // This is handled in the UI if MFA is required
                queryClient.invalidateQueries({ queryKey: ['self'] });
            }
        },
    });
};

export const useLogout = () => {
    const queryClient = useQueryClient();
    const logoutStore = useAuthStore((state) => state.logout);

    return useMutation({
        mutationFn: authApi.logout,
        onSettled: () => {
            logoutStore();
            // The dashboard's only credential is the operator's
            // wallet + api_key. Clearing the api_key from localStorage
            // is what actually invalidates the session — the auth
            // store's `isAuthenticated` flag is just a UI hint.
            // Without this, refreshing the page would still pass the
            // AuthGuard with a stale token.
            try {
                localStorage.removeItem('recoilpay_solver_api_key');
                localStorage.removeItem('auth_token');
            } catch {
                // localStorage can throw in private-browsing contexts;
                // failing to clear is recoverable (the user is still
                // routed to /connect and the stale key gets re-validated
                // there).
            }
            queryClient.clear();
            window.location.href = '/connect';
        },
    });
};

export const useElevate = () => {
    const setElevated = useAuthStore((state) => state.setElevated);
    return useMutation({
        mutationFn: (passcode: string) => authzApi.elevate(passcode),
        onSuccess: (data) => {
            setElevated(data.expires_at);
        },
    });
};

export const useDeElevate = () => {
    const clearElevation = useAuthStore((state) => state.clearElevation);
    return useMutation({
        mutationFn: authzApi.deElevate,
        onSuccess: () => {
            clearElevation();
        },
    });
};

export const useInviteUser = () => {
    return useMutation({
        mutationFn: ({ email, role }: { email: string; role: string }) =>
            authApi.invite(email, role),
    });
};

export const useAuth = () => {
    const user = useCurrentUser();
    const logout = useLogout();
    const isElevated = useAuthStore((state) => state.isElevated());
    const elevatedUntil = useAuthStore((state) => state.elevatedUntil);

    return {
        user: user.data,
        isLoading: user.isLoading,
        logout,
        isElevated,
        elevatedUntil,
    };
};
