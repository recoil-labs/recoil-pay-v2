import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from './use-auth';
import { authzApi } from '../api/authz';
import type { Permission, Role } from '../types/permissions';

export const usePermissions = () => {
    const { data: user } = useCurrentUser();

    const hasPermission = (permission: string): boolean => {
        if (!user || !user.permissions) return false;
        // Super Admin exception
        if (user.roles?.includes('super_admin')) return true;
        return user.permissions.includes(permission as Permission);
    };

    const hasRole = (role: string): boolean => {
        if (!user || !user.roles) return false;
        return user.roles.includes(role as Role);
    };

    const hasAnyPermission = (permissions: string[]): boolean => {
        return permissions.some(p => hasPermission(p));
    };

    const hasAllPermissions = (permissions: string[]): boolean => {
        return permissions.every(p => hasPermission(p));
    };

    return {
        hasPermission,
        hasRole,
        hasAnyPermission,
        hasAllPermissions,
        permissions: user?.permissions || [],
        roles: user?.roles || [],
    };
};

export const useDecisions = (permissions: Permission[]) => {
    const { data: user } = useCurrentUser();

    return useQuery({
        queryKey: ['decisions', permissions],
        queryFn: () => authzApi.checkPermissions(permissions),
        enabled: !!user && permissions.length > 0,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
};
