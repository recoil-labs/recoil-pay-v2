import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Field, Pill, inputClass } from './ui';
import {
  SIDE_COPY,
  toMinorUnits,
  type GiftCardQuoteSubmit,
  type GiftCardSide,
  type GiftCardType,
} from '../types/giftcards';

/* Publishing form. One asset (brand + country + card type), one direction,
   and as many face-value bands as the merchant wants to price separately.

   Two things here are deliberate rather than incidental:

   1. Merchants type MAJOR units ("25") and rates as PERCENTAGES ("88"). The
      wire wants minor units and a multiplier. Converting at the boundary
      means the number a merchant reads back is the number they typed — and
      the server rejects a rate >= 2.0 precisely to catch the case where a
      percentage reaches it unconverted.
   2. The band rows are validated on submit and reported per row, matching
      the server's partial-success behaviour, so one bad row cannot silently
      drop the others. */

interface BandDraft {
  key: number;
  minFace: string;
  maxFace: string;
  ratePercent: string;
}

const CHAINS = [
  { caip2: 'eip155:8453', label: 'Base' },
  { caip2: 'eip155:84532', label: 'Base Sepolia' },
  { caip2: 'eip155:10', label: 'Optimism' },
  { caip2: 'eip155:11155420', label: 'OP Sepolia' },
];

/** Default validity. Long enough that a merchant is not republishing all
 *  day, short enough that a stale rate falls off the book on its own — the
 *  ranker drops expired quotes, so expiry is the safety net for a merchant
 *  who walks away. */
const DEFAULT_VALID_HOURS = 24;

let nextKey = 1;

function emptyBand(): BandDraft {
  return { key: nextKey++, minFace: '', maxFace: '', ratePercent: '' };
}

export function RateForm({
  onSubmit,
  busy,
}: {
  onSubmit: (quote: GiftCardQuoteSubmit) => Promise<void>;
  busy: boolean;
}) {
  const [side, setSide] = useState<GiftCardSide>('buy');
  const [brand, setBrand] = useState('');
  const [countryCode, setCountryCode] = useState('US');
  const [currency, setCurrency] = useState('USD');
  const [cardType, setCardType] = useState<GiftCardType>('ecode');
  const [payoutChain, setPayoutChain] = useState(CHAINS[0].caip2);
  const [payoutAsset, setPayoutAsset] = useState('USDC');
  const [validHours, setValidHours] = useState(String(DEFAULT_VALID_HOURS));
  const [bands, setBands] = useState<BandDraft[]>([emptyBand()]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const faceDecimals = 2;

  function patchBand(key: number, patch: Partial<BandDraft>) {
    setBands((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  }

  /** Live preview of what one band pays on a round number, so the merchant
   *  sees the consequence of the rate before publishing it. */
  const preview = useMemo(() => {
    const first = bands[0];
    const pct = Number(first?.ratePercent);
    if (!Number.isFinite(pct) || pct <= 0) return null;
    const face = 100;
    const value = (face * pct) / 100;
    return side === 'buy'
      ? `A $${face} card pays the seller $${value.toFixed(2)}.`
      : `A $${face} card costs the buyer $${value.toFixed(2)}.`;
  }, [bands, side]);

  function validate(): GiftCardQuoteSubmit | null {
    const next: Record<string, string> = {};

    if (!brand.trim()) next.brand = 'required';
    if (!/^[A-Za-z]{2}$/.test(countryCode.trim())) {
      next.countryCode = 'two-letter country code, e.g. US';
    }
    if (!payoutAsset.trim()) next.payoutAsset = 'required';

    const hours = Number(validHours);
    if (!Number.isFinite(hours) || hours <= 0) next.validHours = 'must be a positive number';

    const ranges = [];
    for (const band of bands) {
      const prefix = `band-${band.key}`;
      try {
        const minFace = toMinorUnits(band.minFace, faceDecimals);
        const maxFace = toMinorUnits(band.maxFace, faceDecimals);
        if (BigInt(minFace) > BigInt(maxFace)) {
          next[prefix] = 'minimum is above the maximum';
          continue;
        }
        if (BigInt(maxFace) === 0n) {
          next[prefix] = 'maximum must be above zero';
          continue;
        }

        const pct = Number(band.ratePercent);
        if (!Number.isFinite(pct) || pct <= 0) {
          next[prefix] = 'rate must be a positive percentage';
          continue;
        }
        if (pct >= 200) {
          next[prefix] = 'rate is a percentage of face value — 88 means 88%';
          continue;
        }

        // Percentage → multiplier. Fixed to six places: the server parses
        // this as an f64 and a repeating decimal from e.g. 88.33% would
        // otherwise serialise with full float noise.
        ranges.push({
          minFace,
          maxFace,
          quote: (pct / 100).toFixed(6),
        });
      } catch (e) {
        next[prefix] = e instanceof Error ? e.message : 'invalid band';
      }
    }

    if (ranges.length === 0 && !Object.keys(next).some((k) => k.startsWith('band-'))) {
      next.bands = 'add at least one band';
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return null;

    return {
      side,
      brand: brand.trim(),
      countryCode: countryCode.trim().toUpperCase(),
      currency: currency.trim().toUpperCase(),
      cardType,
      faceDecimals,
      expiry: Math.floor(Date.now() / 1000) + Math.round(hours * 3600),
      payoutChain,
      payoutAsset: payoutAsset.trim(),
      payoutDecimals: 6,
      ranges,
    };
  }

  async function handleSubmit() {
    const quote = validate();
    if (!quote) return;
    await onSubmit(quote);
    setBands([emptyBand()]);
  }

  return (
    <div className="px-5 py-5">
      {/* Direction first: it decides the settlement path, so it should not
          be one field among twelve. */}
      <div className="flex gap-2">
        {(['buy', 'sell'] as GiftCardSide[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={[
              'flex-1 rounded-[8px] border px-3.5 py-3 text-left transition-all duration-200 ease-[var(--ease-recoil)]',
              side === s
                ? 'border-accent bg-accent/10'
                : 'border-hairline bg-raised hover:border-accent/40',
            ].join(' ')}
          >
            <span className="block text-[13px] text-ink">{SIDE_COPY[s].label}</span>
            <span className="mt-1 block text-[12px] leading-snug text-muted">
              {SIDE_COPY[s].detail}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Brand" error={errors.brand} hint="e.g. Amazon, Steam, iTunes">
          <input
            className={inputClass}
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Amazon"
          />
        </Field>

        <Field
          label="Country"
          error={errors.countryCode}
          hint="A UK code will not redeem on a US account"
        >
          <input
            className={inputClass}
            value={countryCode}
            maxLength={2}
            onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
            placeholder="US"
          />
        </Field>

        <Field label="Card currency">
          <input
            className={inputClass}
            value={currency}
            maxLength={3}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </Field>

        <Field label="Card type" hint="Physical cards need photos and a receipt">
          <select
            className={inputClass}
            value={cardType}
            onChange={(e) => setCardType(e.target.value as GiftCardType)}
          >
            <option value="ecode">Digital code</option>
            <option value="physical">Physical card</option>
          </select>
        </Field>

        <Field label="Settle on" hint="Where the escrowed payout moves">
          <select
            className={inputClass}
            value={payoutChain}
            onChange={(e) => setPayoutChain(e.target.value)}
          >
            {CHAINS.map((c) => (
              <option key={c.caip2} value={c.caip2}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Settle in" error={errors.payoutAsset}>
          <input
            className={inputClass}
            value={payoutAsset}
            onChange={(e) => setPayoutAsset(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-6 border-t border-hairline pt-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[13px] text-ink">Face-value bands</h3>
            <p className="mt-0.5 text-[12px] text-muted">
              Price each band separately. Amounts in {currency || 'USD'}, rate as a
              percentage of face value.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setBands((p) => [...p, emptyBand()])}>
            <Plus size={13} strokeWidth={2} />
            Add band
          </Button>
        </div>

        {errors.bands && <p className="mt-3 text-[12px] text-danger">{errors.bands}</p>}

        <div className="mt-4 flex flex-col gap-3">
          {bands.map((band) => (
            <div key={band.key}>
              <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                <Field label="From">
                  <input
                    className={inputClass}
                    value={band.minFace}
                    onChange={(e) => patchBand(band.key, { minFace: e.target.value })}
                    placeholder="25"
                    inputMode="decimal"
                  />
                </Field>
                <Field label="To">
                  <input
                    className={inputClass}
                    value={band.maxFace}
                    onChange={(e) => patchBand(band.key, { maxFace: e.target.value })}
                    placeholder="500"
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Rate %">
                  <input
                    className={inputClass}
                    value={band.ratePercent}
                    onChange={(e) => patchBand(band.key, { ratePercent: e.target.value })}
                    placeholder="88"
                    inputMode="decimal"
                  />
                </Field>
                <Button
                  variant="danger"
                  aria-label="Remove band"
                  disabled={bands.length === 1}
                  onClick={() =>
                    setBands((p) => (p.length === 1 ? p : p.filter((b) => b.key !== band.key)))
                  }
                >
                  <Trash2 size={14} strokeWidth={1.75} />
                </Button>
              </div>
              {errors[`band-${band.key}`] && (
                <p className="mt-1.5 text-[12px] text-danger">{errors[`band-${band.key}`]}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-hairline pt-5">
        <div className="w-[160px]">
          <Field
            label="Valid for (hours)"
            error={errors.validHours}
            hint="Expired quotes leave the book"
          >
            <input
              className={inputClass}
              value={validHours}
              onChange={(e) => setValidHours(e.target.value)}
              inputMode="numeric"
            />
          </Field>
        </div>

        <div className="flex items-center gap-4">
          {preview && <Pill tone="accent">{preview}</Pill>}
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      </div>
    </div>
  );
}
