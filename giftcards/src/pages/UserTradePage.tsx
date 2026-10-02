import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Clock, ShieldCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useAccount, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { UserApi, UserApiError, tradeAuthMessage, userAction, waitingOn } from '../api/userApi';
import { Button, Card, CardHeader, Field, Pill, inputClass } from '../components/ui';
import { commitToCode, sealCode } from '../crypto/sealedCode';
import { useEncryptionKey } from '../crypto/useEncryptionKey';
import { RevealCode } from '../components/RevealCode';
import { fromMinorUnits, ratePercent } from '../types/giftcards';
import { STATE_COPY, isTerminal, minutesLeft, type Trade } from '../types/trades';

/** Every mutating call needs the user's signature over the trade id — that is
 *  how the server knows it is them. Centralised so no caller invents its own
 *  message and finds the server recovering a different address. */
function useTradeSignature(tradeId: string) {
  const { signMessageAsync } = useSignMessage();
  return useCallback(
    () => signMessageAsync({ message: tradeAuthMessage(tradeId) }),
    [signMessageAsync, tradeId],
  );
}

function Countdown({ trade }: { trade: Trade }) {
  const left = minutesLeft(trade);
  if (left === null || !trade.awaiting) return null;

  const againstUs = trade.awaiting === 'user';
  return (
    <p
      className={`flex items-center gap-1.5 text-[13px] ${
        left <= 0 ? 'text-danger' : againstUs ? 'text-warning' : 'text-secondary'
      }`}
    >
      <Clock size={13} strokeWidth={1.75} />
      {left <= 0 ? 'Deadline passed' : `${left} minutes left`}
      <span className="text-muted">
        {/* Saying which way it resolves is the whole point of showing it. */}
        {againstUs
          ? '— if you do nothing, the escrow goes to the merchant'
          : '— if they do nothing, the escrow comes to you'}
      </span>
    </p>
  );
}

function FundEscrow({ trade, onDone }: { trade: Trade; onDone: () => void }) {
  const sign = useTradeSignature(trade.id);
  const { discloseFor } = useEncryptionKey();
  const [txHash, setTxHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // Not the wallet key: a separate encryption key derived from a wallet
      // signature, because no wallet hands a page its private key and a code
      // sealed to one could never be opened. `discloseFor` also signs the
      // proof the server checks.
      const { publicKey, signature: keySignature } = await discloseFor(trade.id);

      await UserApi.markEscrowFunded(trade.id, {
        txHash: txHash.trim(),
        recipientPubkey: publicKey,
        keySignature,
        signature: await sign(),
      });
      onDone();
    } catch (e) {
      const msg = e instanceof UserApiError || e instanceof Error ? e.message : 'could not confirm';
      setError(
        e instanceof UserApiError && e.status === 202
          ? 'That transaction has not been mined yet — try again in a moment.'
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-relaxed text-secondary">
        Lock {fromMinorUnits(trade.payoutMinorUnits, 6)} {trade.payoutAsset} into the escrow
        contract, then paste the transaction hash. We check on-chain that it is really
        there before anything else happens.
      </p>
      <Field label="Escrow transaction hash" error={error ?? undefined}>
        <input
          className={inputClass}
          value={txHash}
          onChange={(e) => setTxHash(e.target.value)}
          placeholder="0x…"
          spellCheck={false}
        />
      </Field>
      <Button onClick={submit} disabled={busy || txHash.trim() === ''}>
        {busy ? 'Verifying…' : 'Confirm escrow'}
      </Button>
    </div>
  );
}

function SendCode({ trade, onDone }: { trade: Trade; onDone: () => void }) {
  const sign = useTradeSignature(trade.id);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (!trade.recipientPubkey) {
        throw new Error('the merchant has not published their encryption key yet');
      }
      // Sealed in this browser. The plaintext never goes over the wire and is
      // cleared from state the moment the call succeeds.
      const sealed = sealCode(code, trade.recipientPubkey);
      const commitment = commitToCode(code);
      await UserApi.deliverCode(trade.id, { commitment, sealed, signature: await sign() });
      setCode('');
      onDone();
    } catch (e) {
      setError(e instanceof UserApiError || e instanceof Error ? e.message : 'could not send');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Your gift card code"
        hint="Encrypted in your browser before it leaves. Nobody but the merchant can read it — not even us."
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
      <Button onClick={submit} disabled={busy || code.trim() === ''}>
        {busy ? 'Sealing…' : 'Send code'}
      </Button>
    </div>
  );
}

function ConfirmCard({ trade, onDone }: { trade: Trade; onDone: () => void }) {
  const sign = useTradeSignature(trade.id);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function attest(valid: boolean) {
    setBusy(true);
    setError(null);
    try {
      await UserApi.attest(trade.id, {
        valid,
        reason: valid ? undefined : reason,
        signature: await sign(),
      });
      onDone();
    } catch (e) {
      setError(e instanceof UserApiError || e instanceof Error ? e.message : 'could not submit');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-relaxed text-secondary">
        Redeem the code, then tell us how it went. If you say nothing before the
        deadline, the escrow releases to the merchant.
      </p>
      <RevealCode trade={trade} />
      {rejecting ? (
        <>
          <Field
            label="What was wrong?"
            hint="This opens a dispute for review — it does not refund you straight away."
            error={error ?? undefined}
          >
            <input
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Code was already redeemed"
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
              {busy ? 'Confirming…' : 'It worked — release payment'}
            </Button>
            <Button variant="secondary" onClick={() => setRejecting(true)} disabled={busy}>
              It did not work
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function UserTradePage() {
  const { id = '' } = useParams();
  const { isConnected } = useAccount();
  const [trade, setTrade] = useState<Trade | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTrade(await UserApi.getTrade(id));
      setError(null);
    } catch (e) {
      setError(e instanceof UserApiError || e instanceof Error ? e.message : 'could not load');
    }
  }, [id]);

  useEffect(() => {
    void load();
    // The other side may act, or a deadline may fire, at any moment.
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (error) {
    return <p className="mx-auto max-w-[640px] px-5 py-10 text-[13px] text-danger">{error}</p>;
  }
  if (!trade) {
    return <p className="mx-auto max-w-[640px] px-5 py-10 text-[13px] text-muted">Loading…</p>;
  }

  const action = userAction(trade);
  const waiting = waitingOn(trade);
  const settled = trade.state === 'settled_to_card_sender';
  const paidUs = settled ? trade.cardSender === 'user' : trade.funder === 'user';

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-5 px-5 py-8">
      <Card>
        <CardHeader
          title={`${trade.brand} ${fromMinorUnits(trade.faceMinorUnits, 2)} ${trade.currency}`}
          detail={`${trade.countryCode} · ${trade.cardType === 'ecode' ? 'digital code' : 'physical card'} · ${ratePercent(trade.rate)} of face`}
          action={
            <Pill
              tone={
                trade.state === 'disputed'
                  ? 'danger'
                  : isTerminal(trade.state)
                    ? 'success'
                    : 'neutral'
              }
            >
              {STATE_COPY[trade.state]}
            </Pill>
          }
        />
        <div className="px-5 py-4">
          <p className="text-[13px] text-secondary">
            {trade.cardSender === 'user' ? 'You send the code' : 'You receive the code'} ·{' '}
            {trade.funder === 'user'
              ? `You pay ${fromMinorUnits(trade.payoutMinorUnits, 6)} ${trade.payoutAsset}`
              : `You receive ${fromMinorUnits(trade.payoutMinorUnits, 6)} ${trade.payoutAsset}`}
          </p>
          <div className="mt-2">
            <Countdown trade={trade} />
          </div>
        </div>
      </Card>

      {isTerminal(trade.state) ? (
        <Card className="px-5 py-5">
          <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-secondary">
            <ShieldCheck size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-success" />
            <span>
              {trade.state === 'failed'
                ? 'This trade ended without either side committing anything.'
                : paidUs
                  ? 'Settled in your favour. The escrow has been released to your address.'
                  : 'Settled. The escrow went to the other party.'}
              {trade.resolutionNote && (
                <span className="mt-1 block text-muted">{trade.resolutionNote}</span>
              )}
              {trade.releaseTxHash && (
                <span className="mt-1 block font-mono text-[11px] text-muted">
                  {trade.releaseTxHash}
                </span>
              )}
            </span>
          </p>
        </Card>
      ) : trade.state === 'disputed' ? (
        <Card className="border-danger/40 px-5 py-5">
          <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-danger">
            <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            <span>
              This trade is under review. The clock is stopped — nothing resolves
              automatically while a person is looking at it.
              {trade.resolutionNote && (
                <span className="mt-1 block text-muted">{trade.resolutionNote}</span>
              )}
            </span>
          </p>
        </Card>
      ) : action ? (
        <Card>
          <CardHeader
            title={
              action === 'fund'
                ? 'Fund escrow'
                : action === 'deliver'
                  ? 'Send your code'
                  : 'Check your card'
            }
          />
          <div className="px-5 py-5">
            {!isConnected ? (
              <ConnectButton chainStatus="none" showBalance={false} />
            ) : action === 'fund' ? (
              <FundEscrow trade={trade} onDone={() => void load()} />
            ) : action === 'deliver' ? (
              <SendCode trade={trade} onDone={() => void load()} />
            ) : (
              <ConfirmCard trade={trade} onDone={() => void load()} />
            )}
          </div>
        </Card>
      ) : waiting ? (
        <Card className="px-5 py-5">
          <p className="text-[13px] text-secondary">Waiting on {waiting}.</p>
        </Card>
      ) : null}

    </div>
  );
}
