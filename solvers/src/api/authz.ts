import { SolverAuthService } from '../services/solverAuth';
import type { UserIdentity, ElevateResponse, User } from '../types/auth';
import type { Permission } from '../types/permissions';
import { ROLES, PERMISSIONS } from '../types/permissions';

export interface PermissionDecision {
    permission: string;
    allowed: boolean;
    reason?: string;
}

export const authzApi = {
    getSelf: async (): Promise<UserIdentity> => {
        const op = SolverAuthService.getCurrentUser();
        return {
            user_id: op?.id || 'op_101',
            username: op?.username || 'solver_admin',
            email: op?.email || 'operator@recoilpay.io',
            roles: [ROLES.ADMIN],
            permissions: [PERMISSIONS.CONFIG_WRITE, PERMISSIONS.AUDIT_READ],
            auth_level: 'normal',
            session_id: 'sess_1',
            mfa_enabled: false,
        };
    },

    getPermissions: async (): Promise<string[]> => {
        return [PERMISSIONS.CONFIG_WRITE, PERMISSIONS.AUDIT_READ];
    },

    elevate: async (_passcode: string): Promise<ElevateResponse> => {
        return {
            token: 'elevated_token',
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            auth_level: 'elevated',
        };
    },

    deElevate: async (): Promise<ElevateResponse> => {
        return {
            token: '',
            expires_at: new Date().toISOString(),
            auth_level: 'elevated',
        };
    },

    checkPermissions: async (permissions: Permission[]): Promise<PermissionDecision[]> => {
        return permissions.map((p) => ({ permission: p, allowed: true }));
    },

    mfaSetup: async (): Promise<{ secret: string; qr_code_base64: string }> => {
        return { secret: 'SOLVEROPERATORSECRET', qr_code_base64: '' };
    },

    mfaEnable: async (_passcode: string, _secret: string): Promise<void> => {},

    getUsers: async (): Promise<User[]> => {
        const op = SolverAuthService.getCurrentUser();
        return [
            {
                id: op?.id || 'op_101',
                email: op?.email || 'operator@recoilpay.io',
                username: op?.username || 'solver_admin',
                role: ROLES.ADMIN,
                mfa_enabled: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                is_deactivated: false,
            },
        ];
    },
};
