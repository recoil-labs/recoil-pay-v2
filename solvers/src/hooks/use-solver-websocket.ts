import { useEffect, useState, useRef } from 'react';
import type { OrderTelemetryItem } from '../services/solverApi';
import { SolverApiService } from '../services/solverApi';

export interface SolverWebSocketMessage {
  type: 'order_update' | 'event_log';
  payload: any;
}

export function useSolverWebSocket() {
  const [messages, setMessages] = useState<SolverWebSocketMessage[]>([]);
  const [orderUpdates, setOrderUpdates] = useState<OrderTelemetryItem[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      // Use env var (VITE_SOLVER_API_BASE_URL) or fall through to Vite proxy.
      // Replace http(s) with ws(s) for WebSocket protocol.
      const baseUrl = import.meta.env.VITE_SOLVER_API_BASE_URL || '';
      const wsBase = baseUrl
        ? baseUrl.replace(/^http/, 'ws')
        : `ws://${window.location.host}`;
      // Browser WebSockets can't attach custom headers, so the API key
      // is passed as a query parameter. The aggregator validates it
      // against the same `ApiKeyAuthenticator` used by the REST
      // surface. `solver_id` is informational — the broadcaster pushes
      // every order to every subscriber, and the dashboard filters
      // locally.
      const apiKey = SolverApiService.getApiKey();
      const params = new URLSearchParams();
      if (apiKey) {
        // The aggregator's `WsOrdersQuery` is `#[serde(rename_all = "camelCase")]`,
        // so the URL params must be camelCase: `apiKey`, not `api_key`.
        // Sending `api_key` made serde silently drop the field, which
        // is why the dashboard's WS handshake kept 401'ing.
        params.set('apiKey', apiKey);
        params.set('solverId', 'dashboard');
      }
      const qs = params.toString();
      const wsUrl = `${wsBase}/ws/orders${qs ? `?${qs}` : ''}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          // The aggregator wraps each frame as `{ "status": "order",
          // "order": <OrderResponse> }`. Normalise into the legacy
          // `SolverWebSocketMessage` shape the components already
          // consume.
          const raw = JSON.parse(event.data) as {
            status?: string;
            order?: OrderTelemetryItem;
          };
          if (raw.status === 'order' && raw.order) {
            const orderPayload = raw.order;
            setMessages((prev) =>
              [...prev, { type: 'order_update', payload: orderPayload } as SolverWebSocketMessage].slice(-100),
            );
            setOrderUpdates((prev) => {
              const exists = prev.find((o) => o.id === (orderPayload as { orderId?: string }).orderId);
              if (exists) {
                return prev.map((o) =>
                  o.id === (orderPayload as { orderId?: string }).orderId ? orderPayload : o,
                );
              } else {
                return [orderPayload, ...prev];
              }
            });
          } else if (raw.status === 'connected') {
            // Hello frame — log it and continue.
            setMessages((prev) =>
              [...prev, { type: 'event_log', payload: raw } as SolverWebSocketMessage].slice(-100),
            );
          } else if (raw.status === 'lagged') {
            console.warn('[ws_orders] subscriber lagged', raw);
          } else {
            setMessages((prev) =>
              [...prev, { type: 'event_log', payload: raw } as SolverWebSocketMessage].slice(-100),
            );
          }
        } catch (err) {
          console.error('WebSocket parse error:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Reconnect after 3 seconds
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        ws.close();
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return {
    messages,
    orderUpdates,
    isConnected,
  };
}
