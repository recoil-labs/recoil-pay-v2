import { useState } from 'react';

export interface Alert {
    id: string;
    type: 'critical' | 'info' | 'warning';
    message: string;
    timestamp: Date;
}

/**
 * Minimal alert holder used by the layout's notification bell.
 *
 * The previous implementation tried to subscribe to a `/transactions/watch`
 * SSE endpoint that no longer exists, plus parsed a `Transaction` shape tied
 * to the deleted transactions pages. Today the dashboard surfaces only
 * push-quote telemetry via WebSocket (`useSolverWebSocket`), so this hook
 * is intentionally a no-op for now — orders surfaced by the WS layer can
 * be promoted to alerts here when we wire that up in a follow-up.
 */
export const useTransactionWatch = () => {
    const [alerts] = useState<Alert[]>([]);
    return { alerts };
};
