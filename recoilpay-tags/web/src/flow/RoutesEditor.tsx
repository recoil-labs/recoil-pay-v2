import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { isAddress } from 'viem';
import { ROUTES, truncateAddress } from '../../../shared/tag.ts';
import { T, useMotion } from '../lib/motion.ts';

interface Props {
  /** The owner's wallet — the default for every token. */
  defaultAddress: string;
  initialRoutes?: Record<string, string>;
  initialShowAddresses?: boolean;
  saveLabel: string;
  onSave: (v: { routes: Record<string, string>; showAddresses: boolean }) => Promise<void>;
}

/**
 * One address is already a complete tag: every token falls back to it.
 * Each row can take its own address; rows open with height + opacity.
 */
export function RoutesEditor({ defaultAddress, initialRoutes = {}, initialShowAddresses = false, saveLabel, onSave }: Props) {
  const { t } = useMotion();
  const [overrides, setOverrides] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initialRoutes).filter(([k, v]) => k !== '*' && v.toLowerCase() !== defaultAddress.toLowerCase())),
  );
  const [showAddresses, setShowAddresses] = useState(initialShowAddresses);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = Object.entries(overrides);
  const invalid = entries.filter(([, v]) => !isAddress(v, { strict: false }));
  const addresses = new Set([defaultAddress.toLowerCase(), ...entries.filter(([, v]) => isAddress(v, { strict: false })).map(([, v]) => v.toLowerCase())]);

  const save = async () => {
    if (invalid.length) return setError('Fix the highlighted address first');
    setSaving(true);
    setError(null);
    try {
      await onSave({ routes: { '*': defaultAddress, ...overrides }, showAddresses });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="mono text-[12px] text-muted">
        {ROUTES.length} of {ROUTES.length} tokens routed · {addresses.size} address{addresses.size === 1 ? '' : 'es'} · add more any time
      </p>

      <ul className="flex flex-col rounded-md border border-hairline">
        {ROUTES.map((r, i) => {
          const override = overrides[r.key];
          const open = override !== undefined;
          const bad = open && override !== '' && !isAddress(override, { strict: false });
          return (
            <li key={r.key} className={i > 0 ? 'border-t border-hairline' : ''}>
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="text-[14px] text-ink">
                  {r.token} <span className="text-muted">on {r.chain}</span>
                </span>
                {open ? (
                  <button
                    type="button"
                    onClick={() => setOverrides(({ [r.key]: _, ...rest }) => rest)}
                    className="mono text-[12px] text-muted transition-colors hover:text-ink"
                  >
                    use default
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOverrides((o) => ({ ...o, [r.key]: '' }))}
                    className="mono text-[12px] text-secondary transition-colors hover:text-ink"
                    aria-label={`Use a different address for ${r.token} on ${r.chain}`}
                  >
                    → {truncateAddress(defaultAddress)}
                  </button>
                )}
              </div>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    className="overflow-hidden"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={t(T.row)}
                  >
                    <div className="px-3 pb-3">
                      <input
                        autoFocus
                        value={override}
                        onChange={(e) => setOverrides((o) => ({ ...o, [r.key]: e.target.value.trim() }))}
                        placeholder="0x…"
                        spellCheck={false}
                        autoComplete="off"
                        aria-label={`Address for ${r.token} on ${r.chain}`}
                        aria-invalid={bad}
                        className={`mono w-full rounded-sm border bg-ground px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-muted/50 ${
                          bad ? 'border-danger/70' : 'border-hairline focus:border-accent/50'
                        }`}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>

      <label className="flex cursor-pointer items-start gap-2.5 text-[14px] text-secondary">
        <input
          type="checkbox"
          checked={showAddresses}
          onChange={(e) => setShowAddresses(e.target.checked)}
          className="mt-[3px] size-4 shrink-0 accent-[#9184d9]"
        />
        <span>
          Show these addresses on my public page <span className="text-muted">— off by default</span>
        </span>
      </label>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="h-11 rounded-md bg-accent text-[15px] font-[500] text-ground transition-opacity disabled:opacity-50"
      >
        {saving ? 'Saving…' : saveLabel}
      </button>
    </div>
  );
}
