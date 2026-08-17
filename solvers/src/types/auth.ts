import type { Permission, Role } from './permissions';

export interface User {
    id: string;
    username: string;
    email: string;
    role: Role;
    mfa_enabled: boolean;
    created_at: string;
    updated_at: string;
    is_deactivated: boolean;
}

export type AuthLevel = 'normal' | 'elevated';

export interface UserIdentity {
    user_id: string;
    username: string;
    email: string;
    roles: Role[];
    permissions: Permission[];
    auth_level: AuthLevel;
    session_id: string;
    mfa_enabled: boolean;
}

export interface LoginResponse {
    token?: string;
    expires_at?: string;
    session_id?: string;
    mfa_required: boolean;
}

export interface ElevateResponse {
    token: string;
    expires_at: string;
    auth_level: 'elevated';
}
