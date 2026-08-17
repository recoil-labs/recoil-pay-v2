import React, { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { authzApi } from '../api/authz';
import { useAuthStore } from '../stores/auth-store';
import type { Permission } from '../types/permissions';
import { Shield, Clock, AlertTriangle } from 'lucide-react';
import { ElevationContext } from '../hooks/use-elevation';

export const ElevationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [passcode, setPasscode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<{ permission: Permission, action: () => void } | null>(null);
    const [timeRemaining, setTimeRemaining] = useState<string | null>(null);

    const { isElevated, setElevated, elevatedUntil, clearElevation } = useAuthStore();

    useEffect(() => {
        if (!elevatedUntil) return;

        const interval = setInterval(() => {
            const now = new Date();
            const expiry = new Date(elevatedUntil);
            const diff = expiry.getTime() - now.getTime();

            if (diff <= 0) {
                clearElevation();
                setTimeRemaining(null);
                clearInterval(interval);
            } else {
                const minutes = Math.floor(diff / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                setTimeRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [elevatedUntil, clearElevation]);

    const elevateMutation = useMutation({
        mutationFn: authzApi.elevate,
        onSuccess: (data) => {
            setElevated(data.expires_at);
            setIsOpen(false);
            setPasscode('');
            if (pendingAction) {
                pendingAction.action();
                setPendingAction(null);
            }
        },
        onError: (err: { error?: string }) => {
            setError(err.error || 'Invalid passcode');
        },
    });

    const requireElevation = (permission: Permission, action: () => void) => {
        if (isElevated()) {
            action();
            return;
        }
        setPendingAction({ permission, action });
        setError(null);
        setIsOpen(true);
    };

    const handleElevate = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        elevateMutation.mutate(passcode);
    };

    return (
        <ElevationContext.Provider value={{ requireElevation }}>
            {children}

            {/* Elevation Status Bar */}
            {timeRemaining && (
                <div className="fixed bottom-6 right-6 z-40 animate-in slide-in-from-bottom-4 group">
                    <div className="bg-gray-900 border border-primary/30 px-4 py-2 rounded-full flex items-center gap-3 shadow-2xl transition-all hover:pr-2">
                        <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                        <span className="text-xs font-bold text-white uppercase tracking-wider">Elevated Session</span>
                        <div className="flex items-center gap-1.5 pl-3 border-l border-white/10 text-primary">
                            <Clock size={14} />
                            <span className="text-sm font-mono font-bold leading-none">{timeRemaining}</span>
                        </div>
                        <button
                            onClick={() => {
                                authzApi.deElevate().finally(() => clearElevation());
                            }}
                            className="hidden group-hover:flex items-center justify-center w-7 h-7 bg-red-400/20 text-red-400 rounded-full hover:bg-red-400 hover:text-white transition-all ml-1"
                            title="De-elevate session"
                        >
                            <AlertTriangle size={14} />
                        </button>
                    </div>
                </div>
            )}

            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm transition-all">
                    <div className="w-full max-w-md p-8 bg-white border border-gray-100 rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex flex-col items-center text-center mb-6">
                            <div className="w-16 h-16 bg-primary/5 text-primary rounded-2xl flex items-center justify-center mb-4 border border-primary/10">
                                <Shield size={32} />
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900">Privilege Elevation</h2>
                            <p className="text-gray-500 mt-2">
                                You are accessing a sensitive resource. Please confirm your identity with your 6-digit MFA passcode.
                            </p>
                        </div>

                        <form onSubmit={handleElevate}>
                            <div className="relative group mb-6">
                                <input
                                    type="text"
                                    placeholder="000 | 000"
                                    className="w-full text-center text-4xl tracking-widest p-6 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:border-primary/50 focus:bg-white transition-all font-mono font-black text-primary placeholder:text-gray-300"
                                    value={passcode}
                                    onChange={(e) => setPasscode(e.target.value.replace(/[^0-9]/g, ''))}
                                    maxLength={6}
                                    autoFocus
                                />
                            </div>

                            {error && (
                                <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm mb-6">
                                    <AlertTriangle size={18} />
                                    <span className="font-bold">{error}</span>
                                </div>
                            )}

                            <div className="flex gap-4">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsOpen(false);
                                        setPendingAction(null);
                                        setPasscode('');
                                    }}
                                    className="flex-1 p-4 rounded-xl border border-gray-200 text-gray-600 font-bold hover:bg-gray-50 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={elevateMutation.isPending || passcode.length < 6}
                                    className="flex-2 p-4 rounded-xl bg-primary text-white font-black hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:active:scale-100 transition-all shadow-[0_10px_30px_rgba(var(--color-primary),0.2)]"
                                >
                                    {elevateMutation.isPending ? 'Verifying...' : 'Unlock Action'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </ElevationContext.Provider>
    );
};
