export const PERMISSIONS = {
    BRIDGE_PAUSE: 'bridge.pause',
    BRIDGE_RESUME: 'bridge.resume',
    TX_REPLAY_DRY_RUN: 'tx.replay.dry-run',
    TX_REPLAY_EXEC: 'tx.replay.exec',
    AUDIT_READ: 'audit.read',
    AUDIT_EXPORT: 'audit.export',
    APPROVE_PROPOSAL: 'approve.proposal',
    USER_INVITE: 'user.invite',
    USER_REGISTER: 'user.register',
    TX_QUERY_READ: 'tx.query.read',
    CONFIG_WRITE: 'config.write',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export const ROLES = {
    SUPER_ADMIN: 'super_admin',
    ADMIN: 'admin',
    OPERATOR: 'operator',
    AUDITOR: 'auditor',
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

export const SENSITIVE_PERMISSIONS: Permission[] = [
    PERMISSIONS.BRIDGE_PAUSE,
    PERMISSIONS.BRIDGE_RESUME,
    PERMISSIONS.TX_REPLAY_EXEC,
];
