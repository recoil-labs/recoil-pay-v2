import React, { useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { SolverApiService } from '../services/solverApi';

/**
 * ConnectPage — wallet-first login.
 *
 * The dashboard's only credential is the operator's wallet. There is
 * no email/password flow anywhere; the previously-existing
 * `LoginPage` collected a fake email/password, ran a fake registration
 * on every login, and stored a `sk_…` string that the aggregator had
 * never seen. This page replaces it.
 *
 * Three states:
 *
 * 1. **No wallet connected** → render RainbowKit's `ConnectButton` so
 *    the user can pick a wallet.
 *
 * 2. **Wallet connected, no api_key in localStorage** → redirect to
 *    `/register` to run the registration wizard. The
 *    wizard's `onRegistered` callback writes the api_key.
 *
 * 3. **Wallet connected + api_key present** → ping the aggregator's
 *    `/solver-api/operators/{id}` to confirm the api_key is still
 *    valid, then redirect to the original destination (or `/`).
 */
export const ConnectPage: React.FC = () => {
	const navigate = useNavigate();
	const location = useLocation();
	const { address, isConnected } = useAccount();

	const destination =
		(location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';

	useEffect(() => {
		if (!isConnected || !address) return;

		const apiKey = SolverApiService.getApiKey();
		if (!apiKey) {
			// No api_key yet → registration, which is where one is issued.
			// This must be a route outside AuthGuard, or the guard bounces
			// straight back here and the two loop.
			navigate('/register', { replace: true });
			return;
		}

		// Wallet + api_key → verify the key still resolves to a real
		// operator, then route to the requested destination. The
		// derived solver_id is `solver-${address.lowercase}` with
		// the leading `0x` stripped — same derivation the
		// registration handler uses.
		const solverId = `solver-${address.toLowerCase().replace(/^0x/, '')}`;
		let cancelled = false;
		(async () => {
			const res = await fetch(
				`${SolverApiService.getBaseUrl()}/solver-api/operators/${solverId}`,
				{ headers: { 'x-api-key': apiKey } },
			);
			if (cancelled) return;
			if (res.ok) {
				navigate(destination, { replace: true });
			} else if (res.status === 401 || res.status === 404) {
				// Stale key — clear it so the wizard runs fresh.
				SolverApiService.clearApiKey();
				navigate('/register', { replace: true });
			} else {
				// Transient backend issue — stay on the connect screen
				// and let the user retry. No silent bounce.
				console.warn(
					`[ConnectPage] operator lookup returned ${res.status}; staying on connect`,
				);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [isConnected, address, navigate, destination]);

	return (
		<div className="min-h-screen flex items-center justify-center p-4 overflow-hidden bg-[#08122a] text-[#dae2ff] font-sans relative">
			{/* Ambient background — same palette as the rest of the app */}
			<div className="fixed inset-0 pointer-events-none z-0">
				<div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] bg-[#424af6]/10 rounded-full blur-[120px]" />
				<div className="absolute bottom[-10%] left-[-10%] w-[600px] h-[600px] bg-[#b33b00]/5 rounded-full blur-[120px]" />
			</div>

			<main className="relative z-10 w-full max-w-[440px] px-4 font-mono">
				<div className="text-center mb-8">
					<div className="inline-flex items-center gap-2 mb-2">
						<span
							className="material-symbols-outlined text-[#424af6] text-[36px]"
							style={{ fontVariationSettings: "'FILL' 1" }}
						>
							account_balance_wallet
						</span>
						<h1 className="font-headline text-2xl font-bold text-white">
							RecoilPay Solver
						</h1>
					</div>
					<p className="text-sm text-[#c6c5d9]">
						Connect the wallet that controls your solver.
					</p>
				</div>

				<div className="glass-panel p-8 rounded-2xl bg-[#151f37]/80 border border-[#454556]/30 shadow-2xl space-y-6">
					<div className="text-center space-y-3">
						<p className="text-xs uppercase tracking-widest font-bold text-[#8f8fa2]">
							Step 1 of 3
						</p>
						<h2 className="text-xl font-bold text-white">
							Connect your wallet
						</h2>
						<p className="text-sm text-[#c6c5d9] leading-relaxed">
							Your wallet is your identity. We never ask for
							email, password, or private keys. Once connected
							we'll sign a single message to log you in — no
							further auth for the rest of the session.
						</p>
					</div>

					{/* RainbowKit's ConnectButton renders a styled
					    wallet-picker modal. We use the page-level variant
					    so it stays in-flow with our layout. */}
					<div className="flex justify-center">
						<ConnectButton
							accountStatus="address"
							chainStatus="icon"
							showBalance={false}
						/>
					</div>

					<div className="pt-4 border-t border-[#454556]/20 text-center">
						<p className="text-[11px] text-[#8f8fa2] leading-relaxed">
							New here? Connecting a wallet will route you to
							onboarding where you'll register your solver and
							sign one EIP-191 message. Returning? You're logged
							in automatically.
						</p>
						<p className="text-center mt-4">
							<Link
								to="/docs"
								className="text-[11px] font-mono uppercase tracking-widest text-[#bfc2ff] hover:text-white transition-colors"
							>
								Read the operator handbook first →
							</Link>
						</p>
					</div>
				</div>
			</main>
		</div>
	);
};