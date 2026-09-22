import React, { useState, useRef, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useAuth } from '../hooks/use-auth';
import { useTransactionWatch, type Alert } from '../hooks/use-transaction-watch';
import { useIdentities } from '../hooks/use-solver-data';

export const Layout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const { address } = useAccount();
  const { alerts } = useTransactionWatch();

  const [showAlerts, setShowAlerts] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const bellRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleLogout = () => {
    logout.mutate();
  };

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        bellRef.current && !bellRef.current.contains(e.target as Node)
      ) {
        setShowAlerts(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { data: identities } = useIdentities();
  const isRegistered = identities.length > 0 && identities.some((id) => id.status === 'active');

  const allNavItems = [
    // No "Contracts" entry: that editor writes into the same column the
    // settlement engine reads as the operator's payout wallet, so using it
    // misdirects escrow proceeds. It needs a separate field before it
    // comes back.
    { label: 'Dashboard', path: '/', icon: 'dashboard' },
    { label: 'Registration', path: '/terminal?tab=registration', icon: 'auto_fix_high', hideWhenRegistered: true },
    { label: 'Quotes', path: '/terminal?tab=submit_quotes', icon: 'request_quote' },
    { label: 'Orders', path: '/orders', icon: 'receipt_long' },
    { label: 'Fill Wallet', path: '/terminal?tab=fill_worker', icon: 'account_balance_wallet', hideWhenRegistered: false },
    { label: 'Settings', path: '/settings', icon: 'settings' },
  ];

  const navItems = allNavItems.filter((item) => !(item.hideWhenRegistered && isRegistered));

  return (
    <div className="flex h-screen bg-[#08122a] text-[#dae2ff] font-sans overflow-hidden selection:bg-[#424af6] selection:text-white">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside className={`
        fixed left-0 top-0 h-full flex flex-col w-64 border-r border-[#454556]/30 bg-[#111b33]/95 backdrop-blur-xl shadow-2xl z-[60]
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0
      `}>
        {/* Brand Header */}
        <div className="p-6 md:p-8 flex items-center justify-between">
          <div className="flex flex-col gap-1.5">
            <img src="/logo.png" alt="RecoilPay" className="h-7 w-7 rounded-md" />
            <p className="text-[9px] uppercase tracking-[0.25em] text-[#bfc2ff] font-semibold font-mono opacity-80 pl-0.5">
              Intent Portal
            </p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 text-gray-400 hover:text-white rounded-lg md:hidden"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => {
            const isActive = location.pathname + location.search === item.path ||
              (item.path === '/' && location.pathname === '/');
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`
                  flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all group font-mono text-xs
                  ${isActive
                    ? 'bg-[#424af6] text-white font-semibold shadow-lg shadow-[#424af6]/25'
                    : 'text-[#c6c5d9] hover:bg-white/5 hover:text-white'}
                `}
              >
                <span className={`material-symbols-outlined text-xl ${isActive ? 'text-white' : 'group-hover:text-[#bfc2ff] group-hover:scale-110'} transition-all`}>
                  {item.icon}
                </span>
                <span className="tracking-wide">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="mt-auto p-4 space-y-3 border-t border-[#454556]/20 bg-[#08122a]/40">
          <ConnectButton.Custom>
            {({ account, chain, openAccountModal, openConnectModal, mounted }) => {
              const connected = mounted && account && chain;
              return (
                <button
                  onClick={connected ? openAccountModal : openConnectModal}
                  className={`w-full py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.98] transition-all shadow-lg font-mono ${
                    connected
                      ? 'bg-[#424af6] text-white shadow-[#424af6]/25'
                      : 'bg-emerald-500 text-white shadow-emerald-500/25'
                  }`}
                >
                  <span className="material-symbols-outlined text-lg">account_balance_wallet</span>
                  <span>{connected ? account.displayName : 'Connect Wallet'}</span>
                </button>
              );
            }}
          </ConnectButton.Custom>

          <div className="flex flex-col pt-2 border-t border-[#454556]/20 gap-1">
            <NavLink
              to="/docs"
              className="flex items-center gap-3 px-3 py-1.5 text-[#c6c5d9] hover:text-[#bfc2ff] transition-colors font-mono text-[10px] uppercase tracking-widest"
            >
              <span className="material-symbols-outlined text-[18px]">description</span>
              <span>Docs</span>
            </NavLink>
            <button
              onClick={() => navigate('/settings')}
              className="flex items-center gap-3 px-3 py-1.5 text-[#c6c5d9] hover:text-[#bfc2ff] transition-colors font-mono text-[10px] uppercase tracking-widest text-left"
            >
              <span className="material-symbols-outlined text-[18px]">help_outline</span>
              <span>Support</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top App Bar */}
        <header className="h-20 flex justify-between items-center px-4 md:px-8 z-50 bg-[#08122a]/80 backdrop-blur-xl border-b border-[#454556]/20 sticky top-0">
          <div className="flex items-center gap-4 md:gap-8">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 text-gray-400 hover:text-white rounded-lg md:hidden"
            >
              <span className="material-symbols-outlined">menu</span>
            </button>

            <div>
              <h2 className="font-headline text-lg md:text-xl font-bold text-white tracking-tight">
                RecoilPay Solver Portal
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-3 md:gap-4">
            {/* Notifications */}
            <div className="relative">
              <button
                ref={bellRef}
                onClick={() => setShowAlerts(!showAlerts)}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#1f2942] hover:bg-[#2a344e] transition-colors text-[#c6c5d9] relative"
              >
                <span className="material-symbols-outlined">notifications</span>
                {alerts.length > 0 && (
                  <span className="absolute top-2 right-2 w-2 h-2 bg-[#ffb4ab] rounded-full animate-ping"></span>
                )}
              </button>

              {showAlerts && (
                <div
                  ref={dropdownRef}
                  className="absolute right-0 top-12 w-80 bg-[#151f37] border border-[#454556]/40 rounded-2xl shadow-2xl z-50 overflow-hidden glass-panel"
                >
                  <div className="px-4 py-3 border-b border-[#454556]/30 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#8f8fa2] font-mono">
                      System Notifications
                    </span>
                    <button onClick={() => setShowAlerts(false)} className="text-[#8f8fa2] hover:text-white">
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto custom-scrollbar">
                    {alerts.length === 0 ? (
                      <div className="px-4 py-8 text-center text-[#8f8fa2]">
                        <span className="material-symbols-outlined text-3xl mb-2 opacity-40">notifications_off</span>
                        <p className="text-xs font-semibold">No active alerts</p>
                      </div>
                    ) : (
                      alerts.map((alert: Alert) => (
                        <div
                          key={alert.id}
                          className="px-4 py-3 border-b border-[#454556]/10 flex items-start gap-3 hover:bg-white/5 transition-colors"
                        >
                          <span className="material-symbols-outlined text-sm text-[#bfc2ff] mt-0.5">info</span>
                          <p className="text-xs text-[#dae2ff] flex-1 font-medium">{alert.message}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Profile Avatar Pill */}
            <div className="flex items-center gap-3 pl-2">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold text-white font-headline leading-none font-mono">
                  {address
                    ? `${address.slice(0, 6)}…${address.slice(-4)}`
                    : 'Not connected'}
                </p>
                <p
                  className={`text-[10px] font-bold uppercase tracking-widest mt-1 font-mono ${
                    isRegistered ? 'text-emerald-400' : 'text-[#8f8fa2]'
                  }`}
                >
                  {isRegistered ? 'Registered operator' : 'Not registered'}
                </p>
              </div>
              <button
                onClick={handleLogout}
                title="Logout"
                className="w-10 h-10 rounded-xl overflow-hidden border-2 border-[#424af6] p-0.5 bg-[#08122a] shrink-0 hover:border-[#ffb4ab] transition-colors"
              >
                <img
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuCU8uYWUKEdmXNrZFYwNGWUnxWxfF6ahSZm_TnIZ36tY0NBJw8wIgdowyhZYKqF-sZiSIUsjEV-PXpwj4Gh4x1_OP1WGJ8u7vxc-yjFY8ZFCQu6r1WYVFHP0NB7BB7rysSjb5YZBl3l5zK7nmyKeJnOwa4xpPOeXKBKSJseTBPjUK_JsLevsvdVGcKreAKGWx7mRnV7aknw9-L8anXT6s9c_Ukv9Bx0Sw6HGWkWLFi0N1gUJIWGh2If5g"
                  alt="Profile"
                  className="w-full h-full object-cover rounded-lg"
                />
              </button>
            </div>
          </div>
        </header>

        {/* Page Canvas */}
        <main className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-8 bg-[#08122a]">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
