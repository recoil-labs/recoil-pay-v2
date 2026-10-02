import { chainOptions } from '../../lib/chains';
import React, { useState } from 'react';
import { SolverApiService, type ContractsByKindDto, type ContractEntry } from '../../services/solverApi';
import { useContracts } from '../../hooks/use-solver-data';

export const ContractsEditor: React.FC = () => {
  const { data: contractsData, setContracts } = useContracts();
  const contracts = contractsData || {
    inputSettler: [],
    outputSettler: [],
    oracle: [],
  };

  const [newAddress, setNewAddress] = useState('');
  const [newChain, setNewChain] = useState('OP Sepolia (11155420)');
  const [newRole, setNewRole] = useState<'Settler' | 'Oracle' | 'Input Handler' | 'Output Handler'>('Settler');
  const [forInput, setForInput] = useState(true);
  const [forOutput, setForOutput] = useState(true);
  const [filterChain, setFilterChain] = useState('All Chains');

  const handleAddContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAddress.trim()) return;

    const updated = { ...contracts };
    const entry: ContractEntry = {
      chain: newChain,
      address: newAddress.trim(),
    };

    if (newRole === 'Settler' || newRole === 'Input Handler') {
      updated.inputSettler = [entry, ...updated.inputSettler];
    }
    if (newRole === 'Settler' || newRole === 'Output Handler') {
      updated.outputSettler = [entry, ...updated.outputSettler];
    }
    if (newRole === 'Oracle') {
      updated.oracle = [entry, ...updated.oracle];
    }

    const saved = await SolverApiService.setSupportedContracts(updated);
    setContracts(saved);
    setNewAddress('');
  };

  const handleDelete = (kind: keyof ContractsByKindDto, address: string) => {
    const updated = { ...contracts };
    updated[kind] = updated[kind].filter((c) => c.address !== address);
    SolverApiService.setSupportedContracts(updated);
    setContracts(updated);
  };

  return (
    <div className="max-w-[1400px] mx-auto space-y-8 font-sans">
      {/* Header Section */}
      <div className="flex justify-between items-end flex-wrap gap-4">
        <div>
          <h3 className="font-headline text-3xl font-bold text-white mb-1">
            Contracts Management
          </h3>
          <p className="text-[#c6c5d9] text-sm max-w-2xl">
            Manage whitelisted intent-handling contracts and define trusted solver components. Ensure all addresses are verified across supported chains.
          </p>
        </div>
        <div>
          <button className="px-6 py-2.5 border border-[#bfc2ff] text-[#bfc2ff] rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-[#424af6]/10 transition-all flex items-center gap-2 font-mono">
            <span className="material-symbols-outlined text-[18px]">verified_user</span>
            Verify Component
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-8">
        {/* Left Column: Whitelist Form & Trust Score */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          {/* Whitelisting Form */}
          <section className="glass-panel rounded-2xl p-6 relative overflow-hidden bg-[#151f37]/80 border border-[#454556]/30">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-[#424af6]"></div>
            <h4 className="font-mono text-xs uppercase tracking-widest text-[#bfc2ff] mb-6 flex items-center gap-2 font-bold">
              <span className="material-symbols-outlined text-[18px]">add_moderator</span>
              Whitelisting Authority
            </h4>

            <form onSubmit={handleAddContract} className="space-y-5 font-mono">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-[#c6c5d9] uppercase tracking-wider">
                  Contract Address
                </label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full bg-[#030d25] border border-[#454556]/40 rounded-xl px-4 py-3 text-xs text-white focus:border-[#424af6] focus:outline-none transition-all placeholder-[#8f8fa2]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-[#c6c5d9] uppercase tracking-wider">
                    Chain Network
                  </label>
                  <select
                    value={newChain}
                    onChange={(e) => setNewChain(e.target.value)}
                    className="w-full bg-[#030d25] border border-[#454556]/40 rounded-xl px-3 py-3 text-xs text-white focus:border-[#424af6] focus:outline-none transition-all appearance-none"
                  >
                    {/* From the aggregator's registry, so a chain added
                        server-side shows up without a client release. */}
                    {chainOptions().map((c) => (
                      <option key={c.chainId} value={`${c.label} (${c.chainId})`}>
                        {c.label}
                      </option>
                    ))}
                    <option value="Polygon Amoy (80002)">Polygon Amoy</option>
                    <option value="Ethereum Sepolia (11155111)">Eth Sepolia</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-[#c6c5d9] uppercase tracking-wider">Role</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as any)}
                    className="w-full bg-[#030d25] border border-[#454556]/40 rounded-xl px-3 py-3 text-xs text-white focus:border-[#424af6] focus:outline-none transition-all appearance-none"
                  >
                    <option value="Settler">Settler</option>
                    <option value="Oracle">Oracle</option>
                    <option value="Input Handler">Input Handler</option>
                    <option value="Output Handler">Output Handler</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-4 py-2 text-xs">
                <label className="flex items-center gap-2 cursor-pointer group text-[#c6c5d9]">
                  <input
                    type="checkbox"
                    checked={forInput}
                    onChange={(e) => setForInput(e.target.checked)}
                    className="w-4 h-4 rounded bg-transparent border-[#454556] text-[#424af6] focus:ring-0"
                  />
                  <span className="group-hover:text-white transition-colors">Apply to forInput</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group text-[#c6c5d9]">
                  <input
                    type="checkbox"
                    checked={forOutput}
                    onChange={(e) => setForOutput(e.target.checked)}
                    className="w-4 h-4 rounded bg-transparent border-[#454556] text-[#424af6] focus:ring-0"
                  />
                  <span className="group-hover:text-white transition-colors">Apply to forOutput</span>
                </label>
              </div>

              <button
                type="submit"
                className="w-full py-3.5 text-white font-bold rounded-xl hover:brightness-110 transition-all shadow-lg shadow-[#424af6]/20 bg-[#424af6] text-xs uppercase tracking-widest"
              >
                Whitelist Contract
              </button>
            </form>
          </section>

          {/* Trusted Components */}
          <section className="glass-panel rounded-2xl p-6 bg-[#151f37]/80 border border-[#454556]/30">
            <h4 className="font-mono text-xs uppercase tracking-widest text-[#bfc2ff] mb-6 flex items-center justify-between font-bold">
              <span>Trusted Components</span>
              <span className="material-symbols-outlined text-[#bfc2ff]" style={{ fontVariationSettings: "'FILL' 1" }}>
                security
              </span>
            </h4>

            <div className="space-y-4 font-mono">
              <div className="p-4 bg-[#1f2942]/60 rounded-xl border border-[#454556]/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                    <span className="material-symbols-outlined">api</span>
                  </div>
                  <div>
                    <p className="font-bold text-xs text-white">InputSettlerEscrow</p>
                    <p className="text-[10px] text-[#8f8fa2] uppercase">Trust Score: 0.99</p>
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                  VERIFIED
                </span>
              </div>

              <div className="p-4 bg-[#1f2942]/60 rounded-xl border border-[#454556]/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#424af6]/10 flex items-center justify-center text-[#bfc2ff]">
                    <span className="material-symbols-outlined">hub</span>
                  </div>
                  <div>
                    <p className="font-bold text-xs text-white">OutputSettlerSimple</p>
                    <p className="text-[10px] text-[#8f8fa2] uppercase">Trust Score: 0.94</p>
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded bg-[#424af6]/20 text-[#bfc2ff] text-[10px] font-bold">
                  VERIFIED
                </span>
              </div>

              <div className="p-4 bg-[#1f2942]/60 rounded-xl border border-[#454556]/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400">
                    <span className="material-symbols-outlined">error_outline</span>
                  </div>
                  <div>
                    <p className="font-bold text-xs text-white">AlwaysYesOracle</p>
                    <p className="text-[10px] text-[#8f8fa2] uppercase">Trust Score: 0.88</p>
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-bold">
                  VERIFIED
                </span>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Whitelisted Infrastructure Table */}
        <div className="col-span-12 lg:col-span-8">
          <section className="glass-panel rounded-2xl overflow-hidden border border-[#454556]/30 bg-[#151f37]/80 h-full flex flex-col shadow-2xl">
            <div className="p-6 border-b border-[#454556]/30 flex justify-between items-center bg-[#111b33]">
              <h4 className="font-mono text-xs uppercase tracking-widest text-[#bfc2ff] font-bold">
                Whitelisted Infrastructure
              </h4>
              <div className="flex gap-2 font-mono">
                {['All Chains', 'OP Sepolia', 'Base Sepolia'].map((c) => (
                  <button
                    key={c}
                    onClick={() => setFilterChain(c)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      filterChain === c
                        ? 'bg-[#424af6] text-white border-[#424af6]'
                        : 'bg-[#151f37] text-[#c6c5d9] border-[#454556]/30 hover:border-[#bfc2ff]'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse font-mono">
                <thead>
                  <tr className="bg-[#1f2942]/50 border-b border-[#454556]/20">
                    <th className="px-6 py-4 text-[10px] font-bold text-[#8f8fa2] uppercase tracking-widest">
                      Address / Contract
                    </th>
                    <th className="px-6 py-4 text-[10px] font-bold text-[#8f8fa2] uppercase tracking-widest text-center">
                      Chain Network
                    </th>
                    <th className="px-6 py-4 text-[10px] font-bold text-[#8f8fa2] uppercase tracking-widest">
                      Role
                    </th>
                    <th className="px-6 py-4 text-[10px] font-bold text-[#8f8fa2] uppercase tracking-widest">
                      Permissions
                    </th>
                    <th className="px-6 py-4 text-[10px] font-bold text-[#8f8fa2] uppercase tracking-widest text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#454556]/20">
                  {/* Input Settlers */}
                  {contracts.inputSettler.map((item, idx) => (
                    <tr key={`in-${idx}`} className="hover:bg-[#424af6]/5 transition-colors group">
                      <td className="px-6 py-5">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-[#bfc2ff]">{item.address}</span>
                          <span className="text-[10px] text-[#8f8fa2]">InputSettlerEscrow</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-center">
                        <span className="text-[10px] bg-[#2a344e] px-2 py-1 rounded text-white font-bold">
                          {item.chain}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <span className="px-2 py-1 bg-[#1f2942] rounded text-[10px] font-bold border border-[#454556]/30 text-white">
                          INPUT SETTLER
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <span className="text-[10px] font-bold text-[#bfc2ff] flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#424af6]"></span> forInput
                        </span>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <button
                          onClick={() => handleDelete('inputSettler', item.address)}
                          className="text-[#8f8fa2] hover:text-[#ffb4ab] transition-colors p-1"
                        >
                          <span className="material-symbols-outlined text-lg">delete_forever</span>
                        </button>
                      </td>
                    </tr>
                  ))}

                  {/* Output Settlers */}
                  {contracts.outputSettler.map((item, idx) => (
                    <tr key={`out-${idx}`} className="hover:bg-[#424af6]/5 transition-colors group">
                      <td className="px-6 py-5">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-[#bfc2ff]">{item.address}</span>
                          <span className="text-[10px] text-[#8f8fa2]">OutputSettlerSimple</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-center">
                        <span className="text-[10px] bg-[#2a344e] px-2 py-1 rounded text-white font-bold">
                          {item.chain}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <span className="px-2 py-1 bg-[#1f2942] rounded text-[10px] font-bold border border-[#454556]/30 text-white">
                          OUTPUT SETTLER
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <span className="text-[10px] font-bold text-[#bfc2ff] flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#424af6]"></span> forOutput
                        </span>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <button
                          onClick={() => handleDelete('outputSettler', item.address)}
                          className="text-[#8f8fa2] hover:text-[#ffb4ab] transition-colors p-1"
                        >
                          <span className="material-symbols-outlined text-lg">delete_forever</span>
                        </button>
                      </td>
                    </tr>
                  ))}

                  {/* Oracles */}
                  {contracts.oracle.map((item, idx) => (
                    <tr key={`orc-${idx}`} className="hover:bg-[#424af6]/5 transition-colors group">
                      <td className="px-6 py-5">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-[#bfc2ff]">{item.address}</span>
                          <span className="text-[10px] text-[#8f8fa2]">AlwaysYesOracle</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-center">
                        <span className="text-[10px] bg-[#2a344e] px-2 py-1 rounded text-white font-bold">
                          {item.chain}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <span className="px-2 py-1 bg-[#1f2942] rounded text-[10px] font-bold border border-[#454556]/30 text-white">
                          ORACLE
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <span className="text-[10px] font-bold text-[#bfc2ff] flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#424af6]"></span> forInput / forOutput
                        </span>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <button
                          onClick={() => handleDelete('oracle', item.address)}
                          className="text-[#8f8fa2] hover:text-[#ffb4ab] transition-colors p-1"
                        >
                          <span className="material-symbols-outlined text-lg">delete_forever</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
