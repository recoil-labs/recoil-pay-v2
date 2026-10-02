import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { ApiError, MerchantApi, getSolverId } from '../api/merchantApi';
import { Button, Card, CardHeader, EmptyState, Field, Pill, inputClass } from '../components/ui';
import { commitToCode, sealCode } from '../crypto/sealedCode';
import { useEncryptionKey } from '../crypto/useEncryptionKey';
import { RevealCode } from '../components/RevealCode';
import { LockEscrow } from '../components/LockEscrow';
import { fromMinorUnits, ratePercent } from '../types/giftcards';
import {
  STATE_COPY,
  merchantAction,
  minutesLeft,
  type Trade,
} from '../types/trades';

/** The deadline, shown as time remaining and as *who loses* if it expires.
 *
 *  Showing the countdown without saying which way it resolves is the most
 *  expensive omission this page could make: a merchant who does not know the
 *  clock is against them has no reason to hurry. */
function Deadline({ trade }: { trade: Trade }) {
  const left = minutesLeft(trade);
  if (left === null || !trade.awaiting) return <span className="text-muted">—</span>;

  const againstUs = trade.awaiting === 'merchant';
  const overdue = left <= 0;

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${
        overdue ? 'text-danger' : againstUs && left < 10 ? 'text-warning' : 'text-secondary'
      }`}
    >
      <Clock size={13} strokeWidth={1.75} />
      {overdue ? 'overdue' : `${left}m`}
      <span className="text-muted">
        {againstUs ? '· you lose it' : '· they lose it'}
      </span>
    </span>
  );
}

function CodeDelivery({ trade, onDone }: { trade: Trade; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      if (!trade.recipientPubkey) {
        throw new Error('the buyer has not published their encryption key yet');
      }
      // Sealed here, in this browser. The plaintext is never sent anywhere
      // and is dropped from state the moment the request succeeds.
      const sealed = sealCode(code, trade.recipientPubkey);
      const commitment = commitToCode(code);
      await MerchantApi.deliverCode(trade.id, { commitment, sealed });
      setCode('');
      onDone();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'could not send the code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Gift card code"
        hint="Encrypted in this browser before it leaves. We never see it."
        error={error ?? undefined}
      >
        <input
          className={inputClass}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Button onClick={send} disabled={busy || code.trim() === ''}>
        {busy ? 'Sealing…' : 'Send code'}
      </Button>
    </div>
  );
}

function Attestation({ trade, onDone }: { trade: Trade; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);

  async function attest(valid: boolean) {
    setBusy(true);
    setError(null);
    try {
      await MerchantApi.attest(trade.id, { valid, reason: valid ? undefined : reason });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'could not attest');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-secondary">
        Redeem the code into your account, then say what happened.
      </p>
      <RevealCode trade={trade} />
      {rejecting ? (
        <>
          <Field
            label="What was wrong with it?"
            hint="This opens a dispute — it does not refund you directly."
            error={error ?? undefined}
          >
            <input
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Already redeemed"
            />
          </Field>
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => attest(false)} disabled={busy || !reason.trim()}>
              Open dispute
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={() => attest(true)} disabled={busy}>
              {busy ? 'Settling…' : 'Card is good — release payment'}
            </Button>
            <Button variant="secondary" onClick={() => setRejecting(true)} disabled={busy}>
              Card is bad
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function EscrowFunding({ trade, onDone }: { trade: Trade; onDone: () => void }) {
  const { discloseFor } = useEncryptionKey();
  const [error, setError] = useState<string | null>(null);

  async function submit(txHash: string) {
    setError(null);
    try {
      // Publishing the encryption key is what lets the seller seal their
      // code to you. Done after the lock lands, so abandoning the
      // transaction leaves nothing half-committed.
      const { publicKey, signature } = await discloseFor(trade.id);
      await MerchantApi.markEscrowFunded(trade.id, {
        txHash,
        recipientPubkey: publicKey,
        keySignature: signature,
      });
      onDone();
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error ? e.message : 'could not confirm escrow',
      );
      throw e;
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <LockEscrow trade={trade} onFunded={submit} />
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

function TradeRow({ trade, onChange }: { trade: Trade; onChange: () => void }) {
  const action = merchantAction(trade);

  const tone =
    trade.state === 'disputed'
      ? 'danger'
      : trade.state === 'settled_to_card_sender'
        ? 'success'
        : trade.state === 'refunded_to_funder' || trade.state === 'failed'
          ? 'warning'
          : 'neutral';

  return (
    <div className="border-b border-hairline/60 px-5 py-4 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] text-ink">{trade.brand}</span>
          <span className="text-[13px] text-muted">
            {fromMinorUnits(trade.faceMinorUnits, 2)} {trade.currency} ·{' '}
            {ratePercent(trade.rate)} · {trade.countryCode}
          </span>
          <Pill tone={trade.side === 'buy' ? 'success' : 'accent'}>
            {trade.side === 'buy' ? 'You buy' : 'You sell'}
          </Pill>
        </div>
        <div className="flex items-center gap-4">
          <Deadline trade={trade} />
          <Pill tone={tone}>{STATE_COPY[trade.state]}</Pill>
        </div>
      </div>

      {trade.state === 'disputed' && (
        <p className="mt-3 flex items-start gap-2 text-[12px] text-danger">
          <AlertTriangle size={13} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          {trade.resolutionNote ?? 'Awaiting review.'}
        </p>
      )}

      {action && (
        <div className="mt-4 rounded-[8px] border border-hairline bg-raised px-4 py-4">
          {action === 'fund' && <EscrowFunding trade={trade} onDone={onChange} />}
          {action === 'deliver' && <CodeDelivery trade={trade} onDone={onChange} />}
          {action === 'attest' && <Attestation trade={trade} onDone={onChange} />}
        </div>
      )}
    </div>
  );
}

export function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTrades(await MerchantApi.listTrades(getSolverId()));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'could not load trades');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Deadlines run in tens of minutes, so a slow poll keeps the countdowns
    // honest without hammering the aggregator.
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const { needsYou, rest } = useMemo(() => {
    const needsYou = trades.filter((t) => merchantAction(t) !== null);
    const ids = new Set(needsYou.map((t) => t.id));
    return { needsYou, rest: trades.filter((t) => !ids.has(t.id)) };
  }, [trades]);

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-[13px] text-danger">{error}</p>}

      <Card>
        <CardHeader
          title="Needs you"
          detail="Every one of these has a clock running against you."
        />
        {loading ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">Loading…</p>
        ) : needsYou.length === 0 ? (
          <EmptyState title="Nothing waiting on you" detail="Trades needing an action appear here." />
        ) : (
          needsYou.map((t) => <TradeRow key={t.id} trade={t} onChange={() => void load()} />)
        )}
      </Card>

      <Card>
        <CardHeader title="All trades" detail="Matched against your rates." />
        {rest.length === 0 ? (
          <EmptyState
            title="No other trades"
            detail="Publish rates to start receiving matched orders."
          />
        ) : (
          rest.map((t) => <TradeRow key={t.id} trade={t} onChange={() => void load()} />)
        )}
      </Card>
    </div>
  );
}
