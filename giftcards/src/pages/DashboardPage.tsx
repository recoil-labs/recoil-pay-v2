import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MerchantApi, getSolverId, type OperatorSummary } from '../api/merchantApi';
import { Button, Card, CardHeader, Pill } from '../components/ui';
import type { GiftCardQuote } from '../types/giftcards';

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[12px] text-muted">{label}</p>
      <p className={`mt-1 text-[22px] ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}>
        {value}
      </p>
    </div>
  );
}

export function DashboardPage() {
  const [operator, setOperator] = useState<OperatorSummary | null>(null);
  const [quotes, setQuotes] = useState<GiftCardQuote[]>([]);

  useEffect(() => {
    const solverId = getSolverId();
    // Both are best-effort: an operator record that has not synced yet
    // should not blank the page, it should just leave the reputation cell
    // empty.
    void MerchantApi.getOperator(solverId).then(setOperator).catch(() => setOperator(null));
    void MerchantApi.listQuotes(solverId).then(setQuotes).catch(() => setQuotes([]));
  }, []);

  const live = quotes.filter((q) => {
    const t = Date.parse(q.expiry);
    return !q.paused && !Number.isNaN(t) && t > Date.now();
  });
  const buySide = live.filter((q) => q.side === 'buy').length;
  const sellSide = live.filter((q) => q.side === 'sell').length;

  const successRate =
    operator && operator.fillsTotal > 0
      ? `${Math.round((operator.fillsSucceeded / operator.fillsTotal) * 100)}%`
      : '—';

  return (
    <div className="flex flex-col gap-6">
      {operator?.circuitBreakerOpen && (
        <Card className="border-danger/40 bg-danger/5 px-5 py-4">
          <p className="text-[13px] text-danger">
            Your circuit breaker is open — the ranker is skipping your quotes.
            Clear the failures behind it and it closes on its own.
          </p>
        </Card>
      )}

      <Card>
        <CardHeader title="Your book" detail="Live rates are the ones the ranker can match." />
        <div className="grid grid-cols-2 divide-x divide-hairline sm:grid-cols-4">
          <Stat label="Live rates" value={String(live.length)} />
          <Stat label="Buying" value={String(buySide)} />
          <Stat label="Selling" value={String(sellSide)} />
          <Stat
            label="Reputation"
            value={operator ? String(Math.round(operator.reputationScore)) : '—'}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Settlement record" detail="Carried over from your operator record." />
        <div className="grid grid-cols-2 divide-x divide-hairline sm:grid-cols-3">
          <Stat label="Trades settled" value={operator ? String(operator.fillsTotal) : '—'} />
          <Stat label="Success rate" value={successRate} />
          <Stat
            label="Avg latency"
            value={operator ? `${Math.round(operator.avgLatencyMs)}ms` : '—'}
          />
        </div>
      </Card>

      {live.length === 0 && (
        <Card className="px-5 py-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[14px] text-ink">You have nothing on the book</p>
              <p className="mt-1 text-[13px] text-muted">
                Until you publish a rate, no intent can be matched to you.
              </p>
            </div>
            <Link to="/merchant/rates">
              <Button>Publish rates</Button>
            </Link>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="How settlement works"
          detail="The direction of a trade decides who funds escrow and which way a timeout resolves."
        />
        <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-2">
          <div className="bg-surface px-5 py-4">
            <Pill tone="success">You buy</Pill>
            <p className="mt-2.5 text-[13px] leading-relaxed text-secondary">
              You fund escrow first, because you hold the asset anyone can
              verify. The seller sends the code encrypted to your wallet key;
              you redeem it and attest. If you go silent, escrow releases to
              the seller.
            </p>
          </div>
          <div className="bg-surface px-5 py-4">
            <Pill tone="accent">You sell</Pill>
            <p className="mt-2.5 text-[13px] leading-relaxed text-secondary">
              The buyer funds escrow, then you deliver the code encrypted to
              their wallet key. Once they hold it they hold the unverifiable
              asset, so if they go silent escrow releases to you.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
