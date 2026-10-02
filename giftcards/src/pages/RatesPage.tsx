import { useCallback, useEffect, useState } from 'react';
import { Pause, Play, Trash2 } from 'lucide-react';
import { ApiError, MerchantApi, getSolverId } from '../api/merchantApi';
import { RateForm } from '../components/RateForm';
import { Button, Card, CardHeader, EmptyState, Pill } from '../components/ui';
import {
  fromMinorUnits,
  ratePercent,
  type GiftCardQuote,
  type GiftCardQuoteSubmit,
} from '../types/giftcards';

export function RatesPage() {
  const [quotes, setQuotes] = useState<GiftCardQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setQuotes(await MerchantApi.listQuotes(getSolverId()));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'could not load rates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function publish(quote: GiftCardQuoteSubmit) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await MerchantApi.submitQuotes([quote]);

      // The server persists what it can and rejects the rest. Reporting
      // only `quotesAdded` would leave a merchant believing a band is live
      // when the book has never seen it, so the rejections are surfaced
      // verbatim — they name the field and the reason.
      if (res.rejected && res.rejected.length > 0) {
        setError(
          `${res.quotesAdded} band(s) published. Rejected: ${res.rejected
            .map((r) => r.reason)
            .join('; ')}`,
        );
      } else {
        setNotice(`${res.quotesAdded} band(s) published.`);
      }
      await load();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'publish failed');
    } finally {
      setBusy(false);
    }
  }

  async function togglePause(id: string) {
    // Optimistic: pausing is cheap, reversible and the row shows its own
    // state, so a round-trip spinner on each row would be worse than a
    // rare flicker on failure.
    setQuotes((prev) => prev.map((q) => (q.id === id ? { ...q, paused: !q.paused } : q)));
    try {
      await MerchantApi.togglePause(id);
    } catch {
      await load();
    }
  }

  async function withdraw(id: string) {
    try {
      await MerchantApi.deleteQuote(id);
      setQuotes((prev) => prev.filter((q) => q.id !== id));
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'withdraw failed');
    }
  }

  const expired = (q: GiftCardQuote) => {
    const t = Date.parse(q.expiry);
    return Number.isNaN(t) || t <= Date.now();
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Publish rates"
          detail="Your standing terms. The ranker matches user intents against these."
        />
        <RateForm onSubmit={publish} busy={busy} />
      </Card>

      {(error || notice) && (
        <p className={`text-[13px] ${error ? 'text-danger' : 'text-success'}`}>
          {error ?? notice}
        </p>
      )}

      <Card>
        <CardHeader
          title="Your book"
          detail="Paused rates keep their terms but stop matching. Expired rates drop off on their own."
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Refresh
            </Button>
          }
        />

        {loading ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">Loading…</p>
        ) : quotes.length === 0 ? (
          <EmptyState
            title="Nothing published yet"
            detail="Publish a buy rate to start receiving cards from sellers, or a sell rate to list cards for buyers."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-[12px] text-muted">
                  <th className="px-5 py-2.5 font-normal">Asset</th>
                  <th className="px-3 py-2.5 font-normal">Side</th>
                  <th className="px-3 py-2.5 font-normal">Band</th>
                  <th className="px-3 py-2.5 font-normal">Rate</th>
                  <th className="px-3 py-2.5 font-normal">Settles</th>
                  <th className="px-3 py-2.5 font-normal">State</th>
                  <th className="px-5 py-2.5 font-normal" />
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id} className="border-b border-hairline/60 last:border-0">
                    <td className="px-5 py-3">
                      <span className="text-ink">{q.brand}</span>
                      <span className="ml-2 text-muted">
                        {q.countryCode} · {q.cardType === 'ecode' ? 'digital' : 'physical'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <Pill tone={q.side === 'buy' ? 'success' : 'accent'}>
                        {q.side === 'buy' ? 'You buy' : 'You sell'}
                      </Pill>
                    </td>
                    <td className="px-3 py-3 text-secondary">
                      {fromMinorUnits(q.minFace, q.faceDecimals)} –{' '}
                      {fromMinorUnits(q.maxFace, q.faceDecimals)} {q.currency}
                    </td>
                    <td className="px-3 py-3 text-ink">{ratePercent(q.quote)}</td>
                    <td className="px-3 py-3 text-secondary">{q.payoutAsset}</td>
                    <td className="px-3 py-3">
                      {expired(q) ? (
                        <Pill tone="warning">Expired</Pill>
                      ) : q.paused ? (
                        <Pill tone="neutral">Paused</Pill>
                      ) : (
                        <Pill tone="success">Live</Pill>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          aria-label={q.paused ? 'Resume' : 'Pause'}
                          onClick={() => void togglePause(q.id)}
                        >
                          {q.paused ? (
                            <Play size={14} strokeWidth={1.75} />
                          ) : (
                            <Pause size={14} strokeWidth={1.75} />
                          )}
                        </Button>
                        <Button
                          variant="danger"
                          aria-label="Withdraw"
                          onClick={() => void withdraw(q.id)}
                        >
                          <Trash2 size={14} strokeWidth={1.75} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
