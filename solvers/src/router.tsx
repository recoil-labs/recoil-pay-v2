import { createBrowserRouter } from 'react-router-dom';
import { ConnectPage } from './pages/ConnectPage';
import { RegisterPage } from './pages/RegisterPage';
import { DocsPage } from './pages/DocsPage';
import { DashboardPage } from './pages/DashboardPage';
import { SettingsPage } from './pages/SettingsPage';
import { OrdersPage } from './pages/OrdersPage';
import { SolverTerminalPage } from './pages/SolverTerminalPage';
import { Layout } from './components/Layout';
import { AuthGuard } from './guards/AuthGuard';

/**
 * Route map. Notable changes from the prior version:
 *
 * - `/login` is gone. Email/password authentication never worked;
 *   the only valid credential is the operator's wallet + api_key.
 * - `/connect` is the new gate. It shows RainbowKit's wallet-picker
 *   and (if the wallet is already connected + an api_key exists)
 *   bounces the user to their original destination.
 * - `/register` hosts the registration wizard and sits OUTSIDE
 *   `AuthGuard`. Registration is how an operator obtains the api_key
 *   the guard checks for, so guarding it would be circular — the guard
 *   would bounce to `/connect`, which routes back to `/register`.
 */
export const router = createBrowserRouter([
	{
		path: '/connect',
		element: <ConnectPage />,
	},
	{
		path: '/register',
		element: <RegisterPage />,
	},
	{
		// Public: most of the handbook needs reading before you register,
		// and registration is what issues the key the guard checks for.
		path: '/docs',
		element: <DocsPage />,
	},
	{
		path: '/',
		element: (
			<AuthGuard>
				<Layout />
			</AuthGuard>
		),
		children: [
			{
				index: true,
				element: <DashboardPage />,
			},
			{
				path: 'terminal',
				element: <SolverTerminalPage />,
			},
			{
				path: 'orders',
				element: <OrdersPage />,
			},
			{
				path: 'settings',
				element: <SettingsPage />,
			},
		],
	},
]);