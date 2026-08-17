import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogin } from '../hooks/use-auth';
import { useAuthStore } from '../stores/auth-store';
import { useQueryClient } from '@tanstack/react-query';
import type { UserIdentity } from '../types/auth';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loginMutation = useLogin();
  const { setAuth } = useAuthStore();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    loginMutation.mutate(
      { username: email, password },
      {
        onSuccess: (data) => {
          if (data.token) {
            setAuth(data.token, { username: email, email } as UserIdentity);
            queryClient.invalidateQueries({ queryKey: ['self'] }).then(() => {
              navigate('/', { replace: true });
            });
          }
        },
        onError: (err: unknown) => {
          const errorData = err as { error?: string };
          setError(errorData.error || 'Invalid solver credentials');
        },
      }
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 md:p-0 overflow-hidden bg-[#08122a] text-[#dae2ff] font-sans relative">
      {/* Ambient Background Element */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] bg-[#424af6]/10 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[600px] h-[600px] bg-[#b33b00]/5 rounded-full blur-[120px]"></div>
      </div>

      {/* Login Container */}
      <main className="relative z-10 w-full max-w-[440px] px-4 font-mono">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <span
              className="material-symbols-outlined text-[#424af6] text-[36px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              account_balance_wallet
            </span>
            <h1 className="font-headline text-3xl text-white font-extrabold tracking-tight">
              Linkiswap
            </h1>
          </div>
          <p className="text-[#c6c5d9] text-sm">Solver Portal Access</p>
        </div>

        {/* Auth Card */}
        <section className="glass-panel rounded-2xl p-8 shadow-2xl bg-[#151f37]/80 border border-[#454556]/30">
          <form onSubmit={handleLogin} className="space-y-6">
            {/* Email Field */}
            <div className="space-y-2">
              <label className="text-xs text-[#c6c5d9] font-bold block" htmlFor="email">
                Email address
              </label>
              <div className="relative flex items-center bg-[#030d25] border border-[#454556]/40 rounded-xl overflow-hidden focus-within:border-[#424af6] transition-colors">
                <span className="material-symbols-outlined absolute left-4 text-[#8f8fa2] text-lg">
                  mail
                </span>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="solver@linkiswap.com"
                  className="w-full bg-transparent border-none py-3.5 pl-12 pr-4 text-white text-xs font-bold focus:outline-none placeholder-[#8f8fa2]/50"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs text-[#c6c5d9] font-bold" htmlFor="password">
                  Password
                </label>
                <a href="#" className="text-xs text-[#424af6] hover:underline font-bold">
                  Forgot Password?
                </a>
              </div>
              <div className="relative flex items-center bg-[#030d25] border border-[#454556]/40 rounded-xl overflow-hidden focus-within:border-[#424af6] transition-colors">
                <span className="material-symbols-outlined absolute left-4 text-[#8f8fa2] text-lg">
                  lock
                </span>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-transparent border-none py-3.5 pl-12 pr-12 text-white text-xs font-bold focus:outline-none placeholder-[#8f8fa2]/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 text-[#8f8fa2] hover:text-white transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-[#93000a]/20 border border-[#93000a]/40 text-[#ffb4ab] rounded-xl text-xs font-bold">
                {error}
              </div>
            )}

            {/* Primary Action */}
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full bg-[#424af6] text-white font-headline text-sm font-bold py-4 rounded-xl shadow-lg shadow-[#424af6]/25 hover:brightness-110 active:scale-[0.98] transition-all uppercase tracking-wider disabled:opacity-50"
            >
              {loginMutation.isPending ? 'Logging In...' : 'Log In'}
            </button>
          </form>

          {/* Social Divider */}
          <div className="relative my-8 flex items-center">
            <div className="flex-grow border-t border-[#454556]/30"></div>
            <span className="px-4 text-[10px] text-[#8f8fa2] uppercase tracking-widest font-bold">
              Authorized Node
            </span>
            <div className="flex-grow border-t border-[#454556]/30"></div>
          </div>

          {/* Web3 Connector */}
          <button
            type="button"
            onClick={() => {
              setAuth('web3_demo_token', { username: 'solver_hardware.eth', email: 'hardware@linkiswap.com' } as UserIdentity);
              queryClient.invalidateQueries({ queryKey: ['self'] }).then(() => {
                navigate('/', { replace: true });
              });
            }}
            className="w-full bg-[#1f2942] border border-[#454556]/40 text-white text-xs font-bold py-3.5 rounded-xl flex items-center justify-center gap-3 hover:bg-[#2a344e] transition-all active:scale-[0.98]"
          >
            <span
              className="material-symbols-outlined text-[#bfc2ff] text-[20px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              account_balance_wallet
            </span>
            Connect Hardware Wallet
          </button>
        </section>

        {/* Footer Actions */}
        <div className="mt-8 text-center">
          <p className="text-xs text-[#c6c5d9]">
            Don't have an account?{' '}
            <button
              onClick={() => navigate('/register')}
              className="text-[#bfc2ff] font-bold hover:underline ml-1"
            >
              Sign Up
            </button>
          </p>
        </div>

        {/* Compliance / Legal Links */}
        <div className="mt-12 flex justify-center gap-6 text-[10px] text-[#8f8fa2] uppercase tracking-wider font-bold">
          <a href="#" className="hover:text-white transition-colors">
            Terms
          </a>
          <a href="#" className="hover:text-white transition-colors">
            Privacy
          </a>
          <a href="#" className="hover:text-white transition-colors">
            Docs
          </a>
        </div>
      </main>
    </div>
  );
};
