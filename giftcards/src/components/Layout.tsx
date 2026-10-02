import { ConnectButton } from '@rainbow-me/rainbowkit';
import { BookOpen, LayoutDashboard, Settings, Store, Tag } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';

function Brand({ to }: { to: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5">
      <span className="h-6 w-6 rounded-[6px] bg-accent" aria-hidden />
      <span className="text-[14px] text-ink">RecoilPay Gift Cards</span>
    </Link>
  );
}

function Tabs({ items }: { items: { to: string; label: string; icon: typeof Tag; end?: boolean }[] }) {
  return (
    <nav className="mx-auto flex max-w-[1200px] gap-1 px-5">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            [
              'flex items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] transition-colors duration-200 ease-[var(--ease-recoil)]',
              isActive
                ? 'border-accent text-ink'
                : 'border-transparent text-muted hover:text-secondary',
            ].join(' ')
          }
        >
          <Icon size={14} strokeWidth={1.75} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

/** The public shell — a visitor browsing or mid-trade. The merchant entrance
 *  is a link rather than a tab: most visitors are not merchants, and showing
 *  them a dashboard tab that bounces to a sign-in reads as broken. */
export function PublicLayout() {
  return (
    <div className="min-h-screen bg-ground">
      <header className="sticky top-0 z-10 border-b border-hairline bg-ground/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-6 px-5 py-3">
          <Brand to="/" />
          <div className="flex items-center gap-4">
            <Link
              to="/merchant"
              className="flex items-center gap-1.5 text-[13px] text-muted transition-colors duration-200 hover:text-secondary"
            >
              <Store size={14} strokeWidth={1.75} />
              For merchants
            </Link>
            <ConnectButton chainStatus="none" showBalance={false} />
          </div>
        </div>
        <Tabs
          items={[
            { to: '/', label: 'Market', icon: Tag, end: true },
            { to: '/my-trades', label: 'My trades', icon: BookOpen },
          ]}
        />
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

/** The merchant shell. */
export function Layout() {
  return (
    <div className="min-h-screen bg-ground">
      <header className="sticky top-0 z-10 border-b border-hairline bg-ground/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-6 px-5 py-3">
          <Brand to="/merchant" />
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="text-[13px] text-muted transition-colors duration-200 hover:text-secondary"
            >
              Market
            </Link>
            <ConnectButton chainStatus="none" showBalance={false} />
          </div>
        </div>
        <Tabs
          items={[
            { to: '/merchant', label: 'Overview', icon: LayoutDashboard, end: true },
            { to: '/merchant/rates', label: 'Rates', icon: Tag },
            { to: '/merchant/trades', label: 'Trades', icon: BookOpen },
            { to: '/merchant/settings', label: 'Settings', icon: Settings },
          ]}
        />
      </header>
      <main className="mx-auto max-w-[1200px] px-5 py-7">
        <Outlet />
      </main>
    </div>
  );
}
