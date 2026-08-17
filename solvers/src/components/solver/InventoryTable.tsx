import React, { useState } from 'react';
import { SolverApiService, type OrderTelemetryItem } from '../../services/solverApi';
import { useQuotes, useTelemetry } from '../../hooks/use-solver-data';

export const InventoryTable: React.FC = () => {
  const { data: quotes, setQuotes } = useQuotes();
  const [activeTab, setActiveTab] = useState<'inventory' | 'telemetry'>('inventory');
  const [selectedOrder, setSelectedOrder] = useState<OrderTelemetryItem | null>(null);

  const handleTogglePause = async (id: string) => {
    await SolverApiService.togglePauseQuote(id);
    const updated = await SolverApiService.getQuotes();
    setQuotes(updated);
  };

  const handleDeleteQuote = async (id: string) => {
    await SolverApiService.deleteQuote(id);
    const updated = await SolverApiService.getQuotes();
    setQuotes(updated);
  };

  const { data: telemetryData, messages, isConnected } = useTelemetry();

  const formatChain = (id: string) => {
    const map: Record<string, string> = {
      'eip155:11155420': 'OP Sepolia',
      'eip155:84532': 'Base Sepolia',
      'eip155:11155111': 'Ethereum Sepolia',
      'eip155:42161': 'Arbitrum One',
      'eip155:80002': 'Polygon Amoy',
      'solana:devnet': 'Solana Devnet'
    };
    return map[id] || id;
  };
  const formatAsset = (addr: string) => addr.startsWith('0x') || addr.length > 20 ? 'USDC' : addr;

  return (
    <div className="space-y-8 font-sans">
      {/* Module Navigation Tabs */}
      <div className="flex items-center gap-4 border-b border-[#454556]/30 pb-4 font-mono">
        <button
          onClick={() => setActiveTab('inventory')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all ${
            activeTab === 'inventory'
              ? 'bg-[#424af6] text-white shadow-lg shadow-[#424af6]/25'
              : 'bg-[#1f2942] text-[#c6c5d9] hover:text-white'
          }`}
        >
          <span className="material-symbols-outlined text-base">list_alt</span>
          Active Inventory ({quotes.length})
        </button>

        <button
          onClick={() => setActiveTab('telemetry')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all ${
            activeTab === 'telemetry'
              ? 'bg-[#424af6] text-white shadow-lg shadow-[#424af6]/25'
              : 'bg-[#1f2942] text-[#c6c5d9] hover:text-white'
          }`}
        >
          <span className="material-symbols-outlined text-base">terminal</span>
          Live Order Telemetry
        </button>
      </div>

      {activeTab === 'inventory' ? (
        /* Active Inventory View */
        <div className="glass-panel rounded-2xl flex flex-col overflow-hidden shadow-2xl bg-[#151f37]/80 border border-[#454556]/30 font-mono">
          <div className="p-6 border-b border-[#454556]/20 flex justify-between items-center bg-[#111b33]">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#424af6]/10 flex items-center justify-center text-[#bfc2ff]">
                <span className="material-symbols-outlined text-2xl">list_alt</span>
              </div>
              <h3 className="font-headline text-xl font-bold text-white">Active Quote Inventory</h3>
            </div>
            <div className="flex gap-2">
              <button className="p-2.5 rounded-xl border border-[#454556]/30 text-[#8f8fa2] hover:text-[#bfc2ff] hover:border-[#bfc2ff]/50 transition-all">
                <span className="material-symbols-outlined text-lg">filter_list</span>
              </button>
              <button className="p-2.5 rounded-xl border border-[#454556]/30 text-[#8f8fa2] hover:text-[#bfc2ff] hover:border-[#bfc2ff]/50 transition-all">
                <span className="material-symbols-outlined text-lg">download</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full border-collapse text-left">
              <thead className="bg-[#1f2942]/90 backdrop-blur-md sticky top-0 z-10 border-b border-[#454556]/30">
                <tr className="text-[10px] text-[#8f8fa2] uppercase tracking-widest">
                  <th className="px-8 py-4">Route</th>
                  <th className="px-4 py-4">Rate</th>
                  <th className="px-4 py-4">Amount Range</th>
                  <th className="px-4 py-4">Status / Expiry</th>
                  <th className="px-8 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#454556]/15 text-xs">
                {quotes.map((q) => (
                  <tr
                    key={q.id}
                    className={`hover:bg-[#424af6]/5 transition-colors group ${
                      q.paused ? 'opacity-50 bg-[#93000a]/5' : ''
                    }`}
                  >
                    <td className="px-8 py-5">
                      <div className="flex flex-col">
                        <span className="font-bold text-white group-hover:text-[#bfc2ff] transition-colors">
                          {formatChain(q.fromChainNetworkId).split(' ')[0]} → {formatChain(q.toChainNetworkId).split(' ')[0]}
                        </span>
                        <span className="text-[10px] text-[#8f8fa2] uppercase mt-0.5">
                          {formatAsset(q.fromAssetAddress)} → {formatAsset(q.toAssetAddress)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-5">
                      <span className={`font-bold ${q.paused ? 'text-[#ffb4ab]' : 'text-[#bfc2ff]'}`}>
                        {q.paused ? 'Paused' : q.quote}
                      </span>
                    </td>
                    <td className="px-4 py-5 text-[#c6c5d9]">
                      {q.minAmount} - {q.maxAmount}
                    </td>
                    <td className="px-4 py-5">
                      <div className="flex items-center gap-2 text-[#c6c5d9]">
                        <span className="material-symbols-outlined text-sm text-[#bfc2ff]">schedule</span>
                        <span>{new Date(q.expiry).toLocaleTimeString()}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5 text-right">
                      <div className="flex items-center justify-end gap-4">
                        {/* Toggle Pause Switch */}
                        <div
                          onClick={() => handleTogglePause(q.id)}
                          className={`relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full p-1 transition-colors ${
                            q.paused ? 'bg-[#454556]' : 'bg-[#424af6]/30'
                          }`}
                        >
                          <span
                            className={`pointer-events-none block h-4 w-4 rounded-full shadow-md transition-transform duration-200 ${
                              q.paused ? 'translate-x-0 bg-[#8f8fa2]' : 'translate-x-5 bg-[#424af6]'
                            }`}
                          ></span>
                        </div>

                        {/* Delete Button */}
                        <button
                          onClick={() => handleDeleteQuote(q.id)}
                          className="text-[#8f8fa2] hover:text-[#ffb4ab] transition-colors p-1 hover:bg-[#ffb4ab]/10 rounded"
                        >
                          <span className="material-symbols-outlined text-lg">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-6 bg-[#1f2942]/50 flex justify-between items-center text-[10px] font-bold text-[#8f8fa2] uppercase tracking-widest border-t border-[#454556]/20">
            <span>Showing {quotes.length} Active Quotes</span>
            <div className="flex gap-4">
              <button disabled className="hover:text-[#bfc2ff] disabled:opacity-30 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">chevron_left</span> PREV
              </button>
              <button className="hover:text-[#bfc2ff] flex items-center gap-1">
                NEXT <span className="material-symbols-outlined text-sm">chevron_right</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Telemetry Stream View */
        <div className="grid grid-cols-12 gap-8 font-mono">
          {/* Live Intent Stream */}
          <div className="col-span-12 lg:col-span-8 flex flex-col glass-panel rounded-2xl overflow-hidden border border-[#454556]/30 bg-[#151f37]/80 shadow-2xl">
            <div className="px-6 py-4 bg-[#1f2942]/80 flex justify-between items-center border-b border-[#454556]/40">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[#bfc2ff] font-bold">query_stats</span>
                <h3 className="font-headline text-xs font-bold uppercase tracking-widest text-white">
                  Live Intent Stream
                </h3>
              </div>
              <span className={`text-[10px] px-2.5 py-1 rounded border font-bold uppercase ${isConnected ? 'bg-[#424af6]/20 text-[#bfc2ff] border-[#424af6]/30' : 'bg-[#93000a]/20 text-[#ffb4ab] border-[#93000a]/30'}`}>
                {isConnected ? 'WebSocket Live' : 'Disconnected'}
              </span>
            </div>

            <div className="flex-1 overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#454556]/30 bg-[#2a344e]/60 text-[10px] text-[#8f8fa2] uppercase tracking-widest">
                    <th className="px-6 py-4">Intent ID</th>
                    <th className="px-6 py-4">Route</th>
                    <th className="px-6 py-4">Volume</th>
                    <th className="px-6 py-4">Status Pipeline</th>
                    <th className="px-6 py-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#454556]/20">
                  {telemetryData.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedOrder(item)}
                      className="hover:bg-[#424af6]/5 transition-colors cursor-pointer group"
                    >
                      <td className="px-6 py-4 text-[#bfc2ff] font-bold">{item.intentId}</td>
                      <td className="px-6 py-4 text-white">
                        {formatAsset(item.fromAsset)} → {formatAsset(item.toAsset)}
                        <div className="text-[10px] text-[#8f8fa2]">{formatChain(item.fromChain)} → {formatChain(item.toChain)}</div>
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-white">
                        {item.fromAmount} {formatAsset(item.fromAsset)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                            item.status === 'claimed' || item.status === 'settled'
                              ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/30'
                              : item.status === 'failed'
                              ? 'bg-[#ffb4ab]/10 text-[#ffb4ab] border border-[#ffb4ab]/30'
                              : 'bg-[#424af6]/20 text-[#bfc2ff] border border-[#424af6]/30'
                          }`}
                        >
                          {item.status.replace('_', ' ')}
                        </span>
                      </td>
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

          {/* Telemetry Logs Panel */}
          <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
            <div className="glass-panel rounded-2xl flex flex-col overflow-hidden border border-[#454556]/30 bg-[#030d25] p-5 shadow-2xl h-80">
              <div className="flex items-center justify-between pb-3 border-b border-[#454556]/30">
                <span className="text-xs font-bold uppercase text-[#bfc2ff] flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">code</span>
                  Telemetry Stream
                </span>
                <span className="w-2 h-2 rounded-full bg-[#bfc2ff] pulse-active"></span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar text-[11px] text-[#c6c5d9] space-y-3 pt-3">
                {messages.length === 0 && (
                  <div>
                    <span className="text-[#8f8fa2] font-bold">[WAITING]</span> No events received yet...<br />
                  </div>
                )}
                {messages.map((msg, i) => (
                  <div key={i}>
                    {msg.type === 'order_update' ? (
                      <>
                        <span className="text-emerald-400 font-bold">[INTENT]</span> Received intent: {msg.payload.intentId}<br />
                        <span className="text-[#8f8fa2] ml-3">&gt; Status: {msg.payload.status}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-[#bfc2ff] font-bold">[LOG]</span> {JSON.stringify(msg.payload)}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order Inspector Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-[#08122a]/80 backdrop-blur-md z-[100] flex items-center justify-center font-mono">
          <div className="w-[520px] glass-panel bg-[#151f37] rounded-3xl overflow-hidden shadow-2xl border border-[#424af6]/40 p-8 space-y-6 text-white">
            <div className="flex justify-between items-center border-b border-[#454556]/30 pb-4">
              <div>
                <h3 className="font-headline text-lg font-bold">Intent Payload Inspector</h3>
                <p className="text-xs text-[#bfc2ff]">ID: {selectedOrder.intentId}</p>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="text-[#8f8fa2] hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="flex justify-between border-b border-[#454556]/20 pb-2">
                <span className="text-[#8f8fa2]">Route:</span>
                <span className="font-bold">{selectedOrder.fromChain} → {selectedOrder.toChain}</span>
              </div>
              <div className="flex justify-between border-b border-[#454556]/20 pb-2">
                <span className="text-[#8f8fa2]">Swap Amount:</span>
                <span className="font-bold">{selectedOrder.fromAmount} {selectedOrder.fromAsset} → {selectedOrder.toAmount} {selectedOrder.toAsset}</span>
              </div>
              <div className="flex justify-between border-b border-[#454556]/20 pb-2">
                <span className="text-[#8f8fa2]">User Address:</span>
                <span className="font-bold">{selectedOrder.userAddress}</span>
              </div>
              <div className="space-y-2">
                <span className="text-[#8f8fa2]">Raw StandardOrder Witness:</span>
                <div className="bg-[#030d25] p-4 rounded-xl text-[10px] text-[#bfc2ff] border border-[#454556]/40 overflow-x-auto whitespace-pre">
{JSON.stringify(
  {
    intentId: selectedOrder.intentId,
    user: selectedOrder.userAddress,
    originChain: selectedOrder.fromChain,
    destinationChain: selectedOrder.toChain,
    inputToken: selectedOrder.fromAsset,
    outputToken: selectedOrder.toAsset,
    status: selectedOrder.status,
  },
  null,
  2
)}
                </div>
              </div>
            </div>

            <button
              onClick={() => setSelectedOrder(null)}
              className="w-full py-3 bg-[#424af6] text-white font-bold rounded-xl hover:brightness-110 text-xs uppercase tracking-widest"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
