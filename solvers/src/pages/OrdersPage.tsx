import React, { useState, useEffect } from 'react';
import { type OrderTelemetryItem } from '../services/solverApi';
import { useTelemetry } from '../hooks/use-solver-data';
import { useSolverWebSocket } from '../hooks/use-solver-websocket';

/**
 * Normalise an aggregator `OrderResponse` envelope (camelCase, with
 * `orderId`, `inputAmounts`, `outputAmounts`, `quoteId`, `createdAt`)
 * into the `OrderTelemetryItem` shape the table expects.
 *
 * Missing fields default to safe placeholders so a malformed frame
 * from a server in flight doesn't crash the table.
 */
function orderResponseToTelemetry(order: Record<string, unknown>): OrderTelemetryItem {
  const orderId = String(
    order.orderId ?? order.id ?? `unknown-${Date.now()}`,
  );
  const inputAmounts = Array.isArray(order.inputAmounts)
    ? (order.inputAmounts as Array<Record<string, unknown>>)
    : [];
  const outputAmounts = Array.isArray(order.outputAmounts)
    ? (order.outputAmounts as Array<Record<string, unknown>>)
    : [];
  const firstInput = inputAmounts[0] ?? {};
  const firstOutput = outputAmounts[0] ?? {};
  const settlement = (order.settlement ?? {}) as Record<string, unknown>;
  const orderType = String(order.orderType ?? '');
  return {
    id: orderId,
    intentId: String(order.quoteId ?? orderId),
    userAddress: String(settlement.user ?? ''),
    fromChain: String(firstInput.chain ?? ''),
    toChain: String(firstOutput.chain ?? ''),
    fromAsset: String(firstInput.token ?? ''),
    toAsset: String(firstOutput.token ?? ''),
    fromAmount: String(firstInput.amount ?? '0'),
    toAmount: String(firstOutput.amount ?? '0'),
    // The aggregator pushes orders in `pending` state — map to the
    // `quoted` phase so the table renders them in the existing filter
    // chips. The status will be reconciled by the next REST poll.
    status: 'quoted',
    createdAt: String(order.createdAt ?? new Date().toISOString()),
    updatedAt: String(order.updatedAt ?? new Date().toISOString()),
    // Keep the raw orderType available for the detail panel; the
    // dashboard's existing payload inspectors already key off it.
    originTxHash: orderType ? `orderType=${orderType}` : undefined,
  };
}

export const OrdersPage: React.FC = () => {
  const { data: telemetryData } = useTelemetry();
  const { orderUpdates, isConnected } = useSolverWebSocket();
  const [orders, setOrders] = useState<OrderTelemetryItem[]>([]);

  // Initial population from REST polling.
  useEffect(() => {
    setOrders(telemetryData);
  }, [telemetryData]);

  // Merge in real-time frames from `/ws/orders`. We upsert by `id`
  // (the aggregator's `orderId`) so an order that arrives via WS and
  // later appears in the REST poll isn't duplicated.
  useEffect(() => {
    if (orderUpdates.length === 0) return;
    setOrders((prev) => {
      const next = [...prev];
      for (const raw of orderUpdates) {
        const item = orderResponseToTelemetry(raw as unknown as Record<string, unknown>);
        const idx = next.findIndex((o) => o.id === item.id);
        if (idx === -1) {
          next.unshift(item);
        } else {
          next[idx] = { ...next[idx], ...item };
        }
      }
      // Cap at 200 so the table stays snappy even during a busy
      // block; the REST poll will refill any pruned entries.
      return next.slice(0, 200);
    });
  }, [orderUpdates]);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedOrder, setSelectedOrder] = useState<OrderTelemetryItem | null>(null);

  // Orders can arrive with fields missing — the aggregator records an
  // order before its amounts and parties are known, so anything here may
  // legitimately be undefined. Match defensively rather than crashing the
  // whole page on one incomplete row.
  const needle = searchTerm.toLowerCase();
  const contains = (value: string | undefined | null) =>
    (value ?? '').toLowerCase().includes(needle);

  const filteredOrders = orders.filter((ord) => {
    const matchesSearch =
      needle === '' ||
      contains(ord.id) ||
      contains(ord.intentId) ||
      contains(ord.userAddress) ||
      contains(ord.fromChain) ||
      contains(ord.toChain);
    const matchesStatus =
      statusFilter === 'ALL' ||
      (ord.status ?? '').toLowerCase() === statusFilter.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="max-w-[1400px] mx-auto space-y-8 font-sans pb-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white font-headline leading-tight">
            Incoming swap orders
          </h2>
          <p className="text-[#c6c5d9] text-sm mt-1">
            Live feed of orders coming through the network — claimed, filled, or settled by your solver.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 rounded-xl bg-[#1f2942] border border-[#454556]/30 text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2 hover:bg-[#2a344e] transition-all font-mono"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]' : 'bg-[#8f8fa2]'
            }`}
          />
          {isConnected ? 'Live feed connected' : 'Reconnecting…'}
          <span className="material-symbols-outlined text-[18px]">refresh</span>
          Reload
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between font-mono">
        <div className="relative flex-1 w-full">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#8f8fa2] text-lg">
            search
          </span>
          <input
            type="text"
            placeholder="Search by order ID, user wallet, or chain…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-[#151f37] border border-[#454556]/30 rounded-xl text-xs font-medium focus:ring-2 focus:ring-[#424af6]/50 focus:outline-none text-white placeholder-[#8f8fa2]"
          />
        </div>

        <div className="flex gap-2 w-full sm:w-auto flex-wrap">
          {[
            { key: 'ALL', label: 'All' },
            { key: 'quoted', label: 'Available' },
            { key: 'claimed', label: 'Mine' },
            { key: 'settled', label: 'Filled' },
            { key: 'failed', label: 'Failed' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                statusFilter === key
                  ? 'bg-[#424af6] text-white border-[#424af6] shadow-lg shadow-[#424af6]/25'
                  : 'bg-[#151f37] text-[#c6c5d9] border-[#454556]/30 hover:border-[#bfc2ff]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Orders Table */}
      <div className="glass-panel rounded-2xl overflow-hidden bg-[#151f37]/80 border border-[#454556]/30 shadow-2xl font-mono">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#1f2942]/70 border-b border-[#454556]/30 text-[10px] text-[#8f8fa2] uppercase tracking-widest">
                <th className="px-6 py-4">Order & user</th>
                <th className="px-6 py-4">Swap</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">When</th>
                <th className="px-6 py-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#454556]/15">
              {filteredOrders.map((ord) => (
                <tr
                  key={ord.id}
                  onClick={() => setSelectedOrder(ord)}
                  className="hover:bg-[#424af6]/5 transition-colors cursor-pointer group"
                >
                  <td className="px-6 py-4">
                    <div className="font-bold text-[#bfc2ff]">{ord.intentId}</div>
                    <div className="text-[10px] text-[#8f8fa2]">{ord.userAddress}</div>
                  </td>
                  <td className="px-6 py-4 text-white">
                    <div className="font-bold">
                      {ord.fromAsset} → {ord.toAsset}
                    </div>
                    <div className="text-[10px] text-[#8f8fa2]">
                      {ord.fromChain} → {ord.toChain}
                    </div>
                  </td>
                  <td className="px-6 py-4 font-bold text-white">
                    {ord.fromAmount} {ord.fromAsset}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                        ord.status === 'claimed' || ord.status === 'settled'
                          ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/30'
                          : ord.status === 'failed'
                          ? 'bg-[#ffb4ab]/10 text-[#ffb4ab] border border-[#ffb4ab]/30'
                          : 'bg-[#424af6]/20 text-[#bfc2ff] border border-[#424af6]/30'
                      }`}
                    >
                      {ord.status === 'quoted' ? 'Available'
                        : ord.status === 'claimed' ? 'Mine'
                        : ord.status === 'settled' ? 'Filled'
                        : ord.status === 'failed' ? 'Failed'
                        : ord.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-[#8f8fa2]">{ord.createdAt}</td>
                  <td className="px-6 py-4 text-center">
                    <button className="p-1.5 rounded-lg bg-[#1f2942] hover:bg-[#424af6] hover:text-white transition-all text-[#c6c5d9]">
                      <span className="material-symbols-outlined text-[18px]">terminal</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspector Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-[#08122a]/80 backdrop-blur-md z-[100] flex items-center justify-center font-mono">
          <div className="w-[520px] glass-panel bg-[#151f37] rounded-3xl overflow-hidden shadow-2xl border border-[#424af6]/40 p-8 space-y-6 text-white">
            <div className="flex justify-between items-center border-b border-[#454556]/30 pb-4">
              <div>
                <h3 className="font-headline text-lg font-bold">Order details</h3>
                <p className="text-xs text-[#bfc2ff]">Order: {selectedOrder.intentId}</p>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="text-[#8f8fa2] hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="flex justify-between border-b border-[#454556]/20 pb-2">
                <span className="text-[#8f8fa2]">User is swapping:</span>
                <span className="font-bold">{selectedOrder.fromAmount} {selectedOrder.fromAsset} on {selectedOrder.fromChain}</span>
              </div>
              <div className="flex justify-between border-b border-[#454556]/20 pb-2">
                <span className="text-[#8f8fa2]">For:</span>
                <span className="font-bold">{selectedOrder.toAmount} {selectedOrder.toAsset} on {selectedOrder.toChain}</span>
              </div>
              <div className="flex justify-between border-b border-[#454556]/20 pb-2">
                <span className="text-[#8f8fa2]">User wallet:</span>
                <span className="font-bold text-[#bfc2ff]">{selectedOrder.userAddress || '—'}</span>
              </div>
              {selectedOrder.originTxHash && (
                <div className="flex justify-between border-b border-[#454556]/20 pb-2">
                  <span className="text-[#8f8fa2]">Reference:</span>
                  <span className="font-bold text-[#bfc2ff]">{selectedOrder.originTxHash}</span>
                </div>
              )}
            </div>

            <button
              onClick={() => setSelectedOrder(null)}
              className="w-full py-3 bg-[#424af6] text-white font-bold rounded-xl hover:brightness-110 text-xs uppercase tracking-widest"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
