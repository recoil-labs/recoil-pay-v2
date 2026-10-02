import { useState } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useNavigate } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  GIFT_CARD_BRANDS,
  GIFT_CARD_COUNTRIES,
  UserApi,
  UserApiError,
  type RankedOffer,
} from '../api/userApi';
import { Button, Card, CardHeader, EmptyState, Field, Pill, inputClass } from '../components/ui';
import { fromMinorUnits, ratePercent, toMinorUnits, type GiftCardType } from '../types/giftcards';

/** The public market. Two directions, one form — a user selling a card and a
 *  user buying one differ only in which side of the book they match against,
 *  so the flip happens once, in the request. */
export function MarketPage() {
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();

  const [selling, setSelling] = useState(true);
  const [brand, setBrand] = useState<string>(GIFT_CARD_BRANDS[0]);
  const [country, setCountry] = useState('US');
  const [cardType, setCardType] = useState<GiftCardType>('ecode');
  const [amount, setAmount] = useState('100');

  const [offers, setOffers] = useState<RankedOffer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setBusy(true);
    setError(null);
    setOffers(null);
    try {
      const faceMinorUnits = toMinorUnits(amount, 2);
      const res = await UserApi.rank({
        userIsSelling: selling,
        brand,
        countryCode: country,
        cardType,
        faceMinorUnits,
        userAddress: address,
      });
      setOffers(res.data);
    } catch (e) {
      setError(e instanceof UserApiError || e instanceof Error ? e.message : 'could not load rates');
    } finally {
      setBusy(false);
    }
  }

  async function accept(offer: RankedOffer) {
    if (!address) return;
    setOpening(offer.quoteId);
    setError(null);
    try {
      const trade = await UserApi.openTrade({
        quoteId: offer.quoteId,
        faceMinorUnits: toMinorUnits(amount, 2),
        userAddress: address,
      });
      navigate(`/trade/${trade.id}`);
    } catch (e) {
      setError(e instanceof UserApiError || e instanceof Error ? e.message : 'could not open the trade');
    } finally {
      setOpening(null);
    }
  }

  const countryMeta = GIFT_CARD_COUNTRIES.find((c) => c.code === country);

  return (
    <div className="mx-auto flex max-w-[840px] flex-col gap-6 px-5 py-8">
      <div>
        <h1 className="text-[26px] text-ink">Gift cards, peer to peer</h1>
        <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-muted">
          Sell a card you are not going to use, or buy one below face value.
          Merchants compete on rate; the money sits in escrow until both sides
          are done.
        </p>
      </div>

      <Card>
        <div className="flex gap-2 p-5 pb-0">
          {[
            { on: true, label: 'Sell a card', detail: 'You have a card, you want paid' },
            { on: false, label: 'Buy a card', detail: 'You have crypto, you want a card' },
          ].map((t) => (
            <button
              key={String(t.on)}
              type="button"
              onClick={() => {
                setSelling(t.on);
                setOffers(null);
              }}
              className={[
                'flex-1 rounded-[8px] border px-4 py-3 text-left transition-all duration-200 ease-[var(--ease-recoil)]',
                selling === t.on
                  ? 'border-accent bg-accent/10'
                  : 'border-hairline bg-raised hover:border-accent/40',
              ].join(' ')}
            >
              <span className="block text-[14px] text-ink">{t.label}</span>
              <span className="mt-0.5 block text-[12px] text-muted">{t.detail}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Brand">
            <select className={inputClass} value={brand} onChange={(e) => setBrand(e.target.value)}>
              {GIFT_CARD_BRANDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Country" hint="A UK card will not redeem in the US">
            <select
              className={inputClass}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              {GIFT_CARD_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Type">
            <select
              className={inputClass}
              value={cardType}
              onChange={(e) => setCardType(e.target.value as GiftCardType)}
            >
              <option value="ecode">Digital code</option>
              <option value="physical">Physical card</option>
            </select>
          </Field>

          <Field label={`Face value (${countryMeta?.currency ?? 'USD'})`}>
            <input
              className={inputClass}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="100"
            />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-hairline px-5 py-4">
          <p className="text-[12px] text-muted">
            Rates are live and expire — a quote you see now may not be there in
            an hour.
          </p>
          <Button onClick={search} disabled={busy}>
            {busy ? 'Checking…' : 'See rates'}
            <ArrowRight size={14} strokeWidth={1.75} />
          </Button>
        </div>
      </Card>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      {offers && (
        <Card>
          <CardHeader
            title={selling ? 'What you would be paid' : 'What you would pay'}
            detail="Ordered by a mix of price and how reliably the merchant settles — not price alone."
          />
          {offers.length === 0 ? (
            <EmptyState
              title="No merchant is quoting this"
              detail="Nobody currently covers that brand, country and amount. Try a different amount, or check back — the book changes through the day."
            />
          ) : (
            offers.map((o, i) => (
              <div
                key={o.quoteId}
                className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline/60 px-5 py-4 last:border-0"
              >
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[18px] text-ink">
                      {fromMinorUnits(o.payoutMinorUnits, o.payoutDecimals)} {o.payoutAsset}
                    </span>
                    <Pill tone="neutral">{ratePercent(o.rate)} of face</Pill>
                    {i === 0 && <Pill tone="success">Best</Pill>}
                  </div>
                  <p className="mt-1 text-[12px] text-muted">
                    {Math.round(o.successRate * 100)}% settled ·{' '}
                    {Math.round(o.reputation * 100)} reputation
                  </p>
                </div>

                {isConnected ? (
                  <Button onClick={() => accept(o)} disabled={opening !== null}>
                    {opening === o.quoteId ? 'Opening…' : selling ? 'Sell at this rate' : 'Buy at this rate'}
                  </Button>
                ) : (
                  <ConnectButton chainStatus="none" showBalance={false} />
                )}
              </div>
            ))
          )}
        </Card>
      )}

      <Card className="px-5 py-4">
        <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-secondary">
          <ShieldCheck size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
          <span>
            {selling ? (
              <>
                The merchant funds escrow <strong className="text-ink">before</strong> you send
                anything. Your code is encrypted to their wallet key in your browser — we never
                see it. If they go quiet after you send it, the escrow releases to{' '}
                <strong className="text-ink">you</strong>.
              </>
            ) : (
              <>
                Your payment sits in escrow until you have the code. If the merchant never
                delivers, it comes back to <strong className="text-ink">you</strong>. Once you
                have it, confirm or dispute — staying silent releases it to them.
              </>
            )}
          </span>
        </p>
      </Card>
    </div>
  );
}
