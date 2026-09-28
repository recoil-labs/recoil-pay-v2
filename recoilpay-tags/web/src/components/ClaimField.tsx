import { AnimatePresence, motion, useInView } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { TAG_RULE } from '../../../shared/tag.ts';
import { useAvailability, type AvailabilityState } from '../hooks/useAvailability.ts';
import { useIdleDemo } from '../hooks/useIdleDemo.ts';
import { T, useMotion } from '../lib/motion.ts';
import { Check } from './Check.tsx';

interface Props {
  /** Pre-fill (the public page for an unreserved tag). */
  initial?: string;
  /** Focus on load — desktop only, never on touch devices. */
  autoFocus?: boolean;
  /** Run the idle typing demo while the field is untouched. */
  demo?: boolean;
  onReserve: (tag: string) => void;
  id?: string;
}

const isDesktop = () => window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 768px)').matches;

export function ClaimField({ initial = '', autoFocus, demo, onReserve, id = 'claim' }: Props) {
  const { reduced, t } = useMotion();
  const wrapRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const programmaticFocus = useRef(false);
  const inView = useInView(wrapRef, { amount: 0.4 });

  const [value, setValue] = useState(initial);
  const [engaged, setEngaged] = useState(Boolean(initial));
  const [immediate, setImmediate] = useState(Boolean(initial));

  const demoOn = Boolean(demo) && !engaged && value === '' && !reduced && inView;
  const demoState = useIdleDemo(demoOn);
  const live = useAvailability(demoOn ? '' : value, { immediate });
  const state: AvailabilityState = demoOn ? demoState.result : live;

  useEffect(() => {
    if (!autoFocus || !isDesktop()) return;
    programmaticFocus.current = true;
    inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  // Any sign of a person stops the demo on the spot.
  const engage = () => setEngaged(true);

  const canReserve = !demoOn && state.status === 'available' && state.tag === value;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canReserve) onReserve(value);
  };

  const pick = (tag: string) => {
    engage();
    setImmediate(true);
    setValue(tag);
    inputRef.current?.focus();
  };

  return (
    <form ref={wrapRef} onSubmit={submit} className="w-full" noValidate>
      <label htmlFor={id} className="sr-only">
        Choose your tag
      </label>
      <div className="relative">
        <div className="flex min-h-[64px] items-center rounded-lg border border-hairline bg-surface transition-colors duration-200 focus-within:border-accent/50">
          <span className="mono select-none pl-5 text-[18px] text-muted" aria-hidden="true">
            @
          </span>
          <div className="relative min-w-0 flex-1">
            <input
              ref={inputRef}
              id={id}
              value={value}
              onChange={(e) => {
                engage();
                setImmediate(false);
                // Lowercase silently — never scold for a capital letter.
                setValue(e.target.value.replace(/^@+/, '').toLowerCase());
              }}
              onKeyDown={engage}
              onPointerDown={engage}
              onPaste={engage}
              onFocus={() => {
                if (programmaticFocus.current) programmaticFocus.current = false;
                else engage();
              }}
              placeholder={demoOn ? '' : 'yourname'}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={32}
              aria-describedby={`${id}-status`}
              className="mono w-full bg-transparent py-4 pl-0.5 pr-3 text-[18px] text-ink outline-none placeholder:text-muted/50"
              style={demoOn ? { caretColor: 'transparent' } : undefined}
            />
            {demoOn && (
              <div aria-hidden="true" className="mono pointer-events-none absolute inset-y-0 left-0.5 flex items-center text-[18px] text-ink">
                {demoState.text}
                <span
                  className={`ml-px inline-block h-[22px] w-[2px] bg-accent ${demoState.phase === 'holding' ? 'caret-blink' : ''}`}
                />
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={!canReserve}
            className="m-2 h-12 shrink-0 rounded-md bg-accent px-5 text-[15px] font-[500] text-ground transition-opacity duration-200 disabled:cursor-not-allowed disabled:opacity-35"
          >
            Reserve
          </button>
        </div>

        {/* Baseline under the field: the checking sweep, and the available draw. */}
        <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px overflow-hidden" aria-hidden="true">
          {state.status === 'checking' && !reduced && (
            <motion.div
              className="h-px w-1/3 bg-accent"
              initial={{ x: '-100%' }}
              animate={{ x: '300%' }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
            />
          )}
          {state.status === 'available' && (
            <motion.div
              key={state.tag}
              className="h-px origin-left bg-success"
              initial={{ scaleX: reduced ? 1 : 0, opacity: reduced ? 0 : 1 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={t(T.damped)}
            />
          )}
        </div>
      </div>

      <AvailabilityLine id={`${id}-status`} state={state} onPick={demoOn ? undefined : pick} />
    </form>
  );
}

function AvailabilityLine({ id, state, onPick }: { id: string; state: AvailabilityState; onPick?: (tag: string) => void }) {
  const { reduced, t } = useMotion();
  const key = state.status === 'idle' ? 'idle' : `${state.status}:${state.tag}`;

  return (
    // Height reserved from first paint: two lines on narrow screens, where
    // suggestions wrap, one on wide ones. Nothing below ever moves.
    <div id={id} role="status" aria-live="polite" className="relative mt-3 min-h-[52px] text-[14px] sm:min-h-[28px]">
      <AnimatePresence initial={false}>
        <motion.div
          key={key}
          className="absolute inset-x-0 top-0 flex flex-wrap items-center gap-x-2 gap-y-1.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={t(T.swap)}
        >
          {state.status === 'idle' && <span className="text-muted">Free — a signature, not a transaction.</span>}
          {state.status === 'checking' && <span className="text-muted">checking…</span>}
          {state.status === 'available' && (
            <span className="inline-flex items-center gap-1.5 text-success">
              <Check size={14} />
              <span>
                <span className="mono">@{state.tag}</span> is available
              </span>
            </span>
          )}
          {state.status === 'taken' && (
            <>
              <span className="text-warning">
                <span className="mono">@{state.tag}</span> {state.reserved ? 'is held by RecoilPay' : 'is taken'}
                {state.suggestions.length > 0 && ' — try'}
              </span>
              {state.suggestions.map((s, i) => (
                <motion.button
                  key={s}
                  type="button"
                  tabIndex={onPick ? 0 : -1}
                  onClick={() => onPick?.(s)}
                  className="mono rounded-sm border border-hairline px-1.5 py-0.5 text-[13px] text-secondary transition-colors hover:border-accent hover:text-ink"
                  initial={{ opacity: 0, y: reduced ? 0 : 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={reduced ? t(T.swap) : { ...T.swap, delay: 0.06 * (i + 1) }}
                >
                  @{s}
                </motion.button>
              ))}
            </>
          )}
          {state.status === 'invalid' && <span className="text-muted">{TAG_RULE}</span>}
          {state.status === 'error' && <span className="text-danger">{state.message}</span>}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
