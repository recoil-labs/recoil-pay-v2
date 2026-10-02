import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { UserApi, UserApiError, userAction, waitingOn } from '../api/userApi';
import { Card, CardHeader, EmptyState, Pill } from '../components/ui';
import { fromMinorUnits } from '../types/giftcards';
import { STATE_COPY, isTerminal, minutesLeft, type Trade } from '../types/trades';

const ACTION_COPY = {
  fund: 'Fund escrow',
  deliver: 'Send your code',
  confirm: 'Check your card',
} as const;

export function MyTradesPage() {
  const { address, isConnected } = useAccount();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!address) return;
    try {
      setTrades(await UserApi.listMyTrades(address));
      setError(null);
    } catch (e) {
      setError(e instanceof UserApiError || e instanceof Error ? e.message : 'could not load');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-[640px] px-5 py-14 text-center">
        <p className="text-[14px] text-secondary">Connect the wallet you traded with.</p>
        <div className="mt-5 flex justify-center">
          <ConnectButton chainStatus="none" showBalance={false} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[840px] px-5 py-8">
      {error && <p className="mb-4 text-[13px] text-danger">{error}</p>}
      <Card>
        <CardHeader title="Your trades" detail="Anything needing you is listed first." />
        {loading ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">Loading…</p>
        ) : trades.length === 0 ? (
          <EmptyState
            title="No trades yet"
            detail="Sell a card or buy one, and it will show up here."
          />
        ) : (
          [...trades]
            // Anything awaiting the user comes first; a deadline they do not
            // see is a deadline they lose.
            .sort((a, b) => Number(userAction(b) !== null) - Number(userAction(a) !== null))
            .map((t) => {
              const action = userAction(t);
              const left = minutesLeft(t);
              return (
                <Link
                  key={t.id}
                  to={`/trade/${t.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline/60 px-5 py-4 transition-colors duration-200 last:border-0 hover:bg-raised"
                >
                  <div>
                    <span className="text-[13px] text-ink">{t.brand}</span>
                    <span className="ml-2 text-[13px] text-muted">
                      {fromMinorUnits(t.faceMinorUnits, 2)} {t.currency} ·{' '}
                      {t.cardSender === 'user' ? 'selling' : 'buying'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {action ? (
                      <Pill tone="warning">
                        {ACTION_COPY[action]}
                        {left !== null && left > 0 ? ` · ${left}m` : ''}
                      </Pill>
                    ) : (
                      <span className="text-[12px] text-muted">{waitingOn(t) ?? ''}</span>
                    )}
                    <Pill tone={isTerminal(t.state) ? 'success' : 'neutral'}>
                      {STATE_COPY[t.state]}
                    </Pill>
                  </div>
                </Link>
              );
            })
        )}
      </Card>
    </div>
  );
}
