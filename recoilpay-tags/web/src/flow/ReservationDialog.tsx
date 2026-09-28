import { useConnectModal } from '@rainbow-me/rainbowkit';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { MAX_TAGS_PER_WALLET, reservationMessage, truncateAddress } from '../../../shared/tag.ts';
import { Check } from '../components/Check.tsx';
import { ShareRow } from '../components/ShareRow.tsx';
import { api, ApiError } from '../lib/api.ts';
import { EASE_OUT, T, useMotion } from '../lib/motion.ts';
import { RoutesEditor } from './RoutesEditor.tsx';
import { isUserRejection, useSignTag } from './useSignTag.ts';

type Step = 'choose' | 'connect' | 'sign' | 'routes' | 'done';
const STEPS: Step[] = ['choose', 'connect', 'sign', 'routes'];
const STEP_LABEL: Record<Step, string> = { choose: 'choose', connect: 'connect', sign: 'sign', routes: 'addresses', done: 'done' };

/**
 * One card, four steps, no navigation. The card's height follows its
 * content on a damped spring; content cross-fades between steps.
 */
export function ReservationDialog({ tag, onClose }: { tag: string; onClose: () => void }) {
  const { reduced, t } = useMotion();
  const [step, setStep] = useState<Step>('choose');
  const [busy, setBusy] = useState(false);
  const [editToken, setEditToken] = useState<string | null>(null);
  const { address } = useAccount();
  const cardRef = useRef<HTMLDivElement>(null);

  // Escape closes — except mid-signature, where closing would orphan the wallet prompt.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cardRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);

  const content: Record<Step, ReactNode> = {
    choose: <ChooseStep tag={tag} onNext={() => setStep('connect')} onClose={onClose} />,
    connect: <ConnectStep tag={tag} onNext={() => setStep('sign')} />,
    sign: (
      <SignStep
        tag={tag}
        setBusy={setBusy}
        onBack={onClose}
        onSigned={(token) => {
          setEditToken(token);
          setStep('routes');
        }}
      />
    ),
    routes: address ? (
      <div className="flex flex-col gap-5">
        <StepHeading title={<>Where should <span className="mono">@{tag}</span> send?</>}>
          Your wallet is the default for every token, so the tag is already complete. Point any token somewhere else now, or later.
        </StepHeading>
        <RoutesEditor
          defaultAddress={address}
          saveLabel="Finish"
          onSave={async (v) => {
            const changed = Object.keys(v.routes).length > 1 || v.showAddresses;
            if (changed && editToken) await api.setRoutes(tag, editToken, v);
            setStep('done');
          }}
        />
      </div>
    ) : null,
    done: <DoneStep tag={tag} onClose={onClose} />,
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ground/85 p-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={t(T.fade)}
      onMouseDown={(e: React.MouseEvent) => e.target === e.currentTarget && !busy && onClose()}
    >
      <motion.div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Reserve @${tag}`}
        tabIndex={-1}
        className="relative w-full max-w-[460px] overflow-hidden rounded-lg border border-hairline bg-surface outline-none"
        initial={{ opacity: 0, y: reduced ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: reduced ? 0 : 8 }}
        transition={t(T.card)}
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <StepIndicator step={step} />
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="-mr-1.5 grid size-8 place-items-center rounded-sm text-muted transition-colors hover:text-ink disabled:opacity-30"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <AutoHeight>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={step}
              className="p-5 sm:p-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={t(T.fade)}
            >
              {content[step]}
            </motion.div>
          </AnimatePresence>
        </AutoHeight>
      </motion.div>
    </motion.div>
  );
}

/** Animates its height to whatever its content measures. */
function AutoHeight({ children }: { children: ReactNode }) {
  const { t } = useMotion();
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <motion.div className="relative overflow-hidden" animate={{ height }} transition={t(T.card)} initial={false}>
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const current = step === 'done' ? STEPS.length : STEPS.indexOf(step);
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1" aria-hidden="true">
        {STEPS.map((s, i) => (
          <span key={s} className={`h-px w-5 transition-colors duration-300 ${i <= current ? 'bg-accent' : 'bg-hairline'}`} />
        ))}
      </div>
      <span className="mono text-[12px] text-muted">
        {step === 'done' ? 'reserved' : `${current + 1}/${STEPS.length} · ${STEP_LABEL[step]}`}
      </span>
    </div>
  );
}

function StepHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <h2 className="heading text-[24px]">{title}</h2>
      {children && <p className="mt-2 text-[14px] text-secondary">{children}</p>}
    </div>
  );
}

function Primary({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className="h-11 w-full rounded-md bg-accent px-5 text-[15px] font-[500] text-ground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Quiet({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className="h-10 w-full rounded-md text-[14px] text-secondary transition-colors hover:text-ink disabled:opacity-40">
      {children}
    </button>
  );
}

function ChooseStep({ tag, onNext, onClose }: { tag: string; onNext: () => void; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mono text-[clamp(28px,8vw,36px)] leading-none text-ink">@{tag}</p>
        <p className="mt-3 inline-flex items-center gap-1.5 text-[14px] text-success">
          <Check size={14} /> available
        </p>
      </div>
      <p className="text-[14px] text-secondary">It’s yours once you connect a wallet and sign. That’s the whole process — free, and about a minute.</p>
      <div className="flex flex-col gap-1">
        <Primary onClick={onNext} autoFocus>
          Continue
        </Primary>
        <Quiet onClick={onClose}>Pick a different tag</Quiet>
      </div>
    </div>
  );
}

function ConnectStep({ tag, onNext }: { tag: string; onNext: () => void }) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const asked = useRef(false);

  // Move on by itself once the wallet the person just chose is connected.
  useEffect(() => {
    if (asked.current && isConnected) onNext();
  }, [isConnected, onNext]);

  const connect = () => {
    asked.current = true;
    openConnectModal?.();
  };

  return (
    <div className="flex flex-col gap-6">
      <StepHeading title="Connect the wallet that will own it">
        This proves <span className="mono text-ink">@{tag}</span> is yours, and becomes the address it points to.
      </StepHeading>
      {isConnected && address ? (
        <div className="flex flex-col gap-1">
          <div className="mb-3 flex items-center justify-between rounded-md border border-hairline bg-ground px-3 py-2.5">
            <span className="text-[13px] text-muted">connected</span>
            <span className="mono text-[13px] text-ink">{truncateAddress(address)}</span>
          </div>
          <Primary onClick={onNext} autoFocus>
            Continue with this wallet
          </Primary>
          <Quiet
            onClick={() => {
              disconnect();
              connect();
            }}
          >
            Use a different wallet
          </Quiet>
        </div>
      ) : (
        <Primary onClick={connect} autoFocus>
          Connect wallet
        </Primary>
      )}
    </div>
  );
}

function SignStep({
  tag,
  setBusy,
  onSigned,
  onBack,
}: {
  tag: string;
  setBusy: (b: boolean) => void;
  onSigned: (editToken: string) => void;
  onBack: () => void;
}) {
  const { address, chainId } = useAccount();
  const sign = useSignTag('reserve');
  const [state, setState] = useState<'idle' | 'signing' | 'saving'>('idle');
  const [error, setError] = useState<{ message: string; fatal: boolean } | null>(null);
  const [showMessage, setShowMessage] = useState(false);
  const { t } = useMotion();

  const go = async () => {
    setError(null);
    setBusy(true);
    setState('signing');
    try {
      const req = await sign(tag);
      setState('saving');
      const res = await api.reserve(req);
      onSigned(res.editToken);
    } catch (err) {
      setState('idle');
      if (isUserRejection(err)) setError({ message: 'Signature cancelled — nothing was reserved.', fatal: false });
      else if (err instanceof ApiError && (err.code === 'taken' || err.code === 'reserved'))
        setError({ message: `${err.message}. Pick another — it only takes a second.`, fatal: true });
      else setError({ message: err instanceof Error ? err.message : 'Something went wrong', fatal: false });
    } finally {
      setBusy(false);
    }
  };

  const preview = address
    ? reservationMessage({ tag, address, chainId: chainId ?? 1, issuedAt: '(time of signing)', origin: window.location.origin })
    : '';

  return (
    <div className="flex flex-col gap-6">
      <StepHeading title={<>Sign to reserve <span className="mono">@{tag}</span></>} />

      {/* The single biggest hesitation, answered before the button. */}
      <ul className="flex flex-col gap-2.5 text-[14px]">
        <li className="flex items-center gap-2.5 text-ink">
          <span className="text-success">
            <Check size={15} />
          </span>
          Free — a signature, not a transaction.
        </li>
        <li className="flex items-center gap-2.5 text-ink">
          <span className="text-success">
            <Check size={15} delay={0.08} />
          </span>
          No gas, nothing leaves your wallet.
        </li>
        <li className="flex items-center gap-2.5 text-ink">
          <span className="text-success">
            <Check size={15} delay={0.16} />
          </span>
          Reservations don’t expire.
        </li>
      </ul>

      <div>
        <button
          type="button"
          onClick={() => setShowMessage((s) => !s)}
          aria-expanded={showMessage}
          className="mono text-[12px] text-muted transition-colors hover:text-secondary"
        >
          {showMessage ? '− hide' : '+ show'} what you’ll sign
        </button>
        <AnimatePresence initial={false}>
          {showMessage && (
            <motion.pre
              className="mono mt-2 overflow-hidden whitespace-pre-wrap break-all rounded-md border border-hairline bg-ground px-3 text-[11.5px] leading-[1.55] text-secondary"
              initial={{ height: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }}
              animate={{ height: 'auto', opacity: 1, paddingTop: 10, paddingBottom: 10 }}
              exit={{ height: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }}
              transition={t(T.row)}
            >
              {preview}
            </motion.pre>
          )}
        </AnimatePresence>
      </div>

      {error && (
        <p role="alert" className={`text-[13px] ${error.fatal ? 'text-warning' : 'text-danger'}`}>
          {error.message}
        </p>
      )}

      <div className="flex flex-col gap-1">
        {error?.fatal ? (
          <Primary onClick={onBack}>Pick another tag</Primary>
        ) : (
          <Primary onClick={go} disabled={state !== 'idle'} autoFocus>
            {state === 'signing' ? 'Check your wallet…' : state === 'saving' ? 'Reserving…' : 'Sign and reserve'}
          </Primary>
        )}
        <p className="pt-2 text-center text-[12px] text-muted">Up to {MAX_TAGS_PER_WALLET} tags per wallet.</p>
      </div>
    </div>
  );
}

function DoneStep({ tag, onClose }: { tag: string; onClose: () => void }) {
  const { reduced, t } = useMotion();
  return (
    <div className="flex flex-col gap-7">
      <div className="relative flex min-h-[168px] flex-col items-center justify-center text-center">
        {/* A single hairline ring, expanding once. */}
        {!reduced && (
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 size-[140px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent"
            initial={{ scale: 0.4, opacity: 0.9 }}
            animate={{ scale: 2.4, opacity: 0 }}
            transition={{ duration: 1.1, ease: EASE_OUT, delay: 0.15 }}
          />
        )}
        <motion.p
          className="mono text-[clamp(32px,10vw,46px)] leading-none text-ink"
          initial={{ scale: reduced ? 1 : 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={t(T.reveal)}
        >
          @{tag}
        </motion.p>
        <motion.p
          className="mt-4 inline-flex items-center gap-1.5 text-[14px] text-success"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduced ? t(T.swap) : { ...T.swap, delay: 0.35 }}
        >
          <Check size={14} delay={0.4} /> reserved — it’s yours
        </motion.p>
      </div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={reduced ? t(T.swap) : { ...T.fade, delay: 0.6 }}>
        <ShareRow tag={tag} />
      </motion.div>
      <div className="flex flex-col gap-1">
        <a
          href={`/@${tag}`}
          className="grid h-11 place-items-center rounded-md border border-hairline text-[15px] text-ink transition-colors hover:border-accent/60"
        >
          View your page
        </a>
        <Quiet onClick={onClose}>Done</Quiet>
      </div>
    </div>
  );
}
