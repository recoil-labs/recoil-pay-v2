import { createBrowserRouter } from 'react-router-dom';
import { Layout, PublicLayout } from './components/Layout';
import { AuthGuard } from './guards/AuthGuard';
import { ConnectPage } from './pages/ConnectPage';
import { DashboardPage } from './pages/DashboardPage';
import { MarketPage } from './pages/MarketPage';
import { MyTradesPage } from './pages/MyTradesPage';
import { RatesPage } from './pages/RatesPage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsPage } from './pages/SettingsPage';
import { TradesPage } from './pages/TradesPage';
import { UserTradePage } from './pages/UserTradePage';

/* Two audiences, one app, because they share everything that matters: the
   same crypto, the same design system, the same wallet connection and the
   same trade view from opposite sides.

   `/` is public — a visitor browsing rates has no account and should not need
   one until they accept an offer. `/merchant/*` is the dashboard, behind the
   wallet + api-key guard.

   `/merchant/register` sits OUTSIDE the guard on purpose: registration is
   what issues the credential the guard checks for, so guarding it would send
   an unregistered merchant to /connect, which routes straight back here. */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <PublicLayout />,
    children: [
      { index: true, element: <MarketPage /> },
      { path: 'trade/:id', element: <UserTradePage /> },
      { path: 'my-trades', element: <MyTradesPage /> },
    ],
  },
  { path: '/connect', element: <ConnectPage /> },
  { path: '/merchant/register', element: <RegisterPage /> },
  {
    path: '/merchant',
    element: (
      <AuthGuard>
        <Layout />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'rates', element: <RatesPage /> },
      { path: 'trades', element: <TradesPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
