import type { IntentPhase, IntentPreview, IntentSession, IntentState, IntentWallet, OrderStatus } from '@recoilpay/intent-core';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Alert, ArrowRight, Check, Cross, External, Route, Spinner } from './icons';
import { useRecoilIntent } from './useRecoilIntent';

export interface RecoilTheme {
  /** Default `dark`. */
  mode?: 'dark' | 'light';
  /** Buttons, focus ring and highlights. Default RecoilPay violet. */
  accent?: string;
  /** Text colour on accent-filled buttons. */
  accentText?: string;
  /** Corner radius of cards and the composer, in px. Default 12. */
  radius?: number;
  /** Default: inherit the host page's font. */
  fontFamily?: string;
}

export interface IntentExample {
  label: string;
  sentence: string;
}

export interface RecoilIntentProps {
  /** Aggregator base URL. Defaults to production. */
  apiUrl?: string;
  /** Share a session with other components, or inject one in tests. */
  session?: IntentSession;
  /** The connected wallet, or null. With wagmi, use `useWagmiIntentWallet()`. */
  wallet?: IntentWallet | null;
  /** Open your app's wallet connect flow. Shown when a wallet is needed. */
  onConnectWallet?: () => void;
  /** Suggestions under the field. `false` hides them. */
  examples?: IntentExample[] | false;
  placeholder?: string;
  /** Pre-fill the field (it isn't submitted until the user runs it). */
  defaultValue?: string;
  theme?: RecoilTheme;
  className?: string;
  onOrderSubmitted?: (orderId: string) => void;
  /** Every intent in the sentence reached a final status. */
  onComplete?: (state: IntentState) => void;
  onError?: (message: string) => void;
}

const DEFAULT_EXAMPLES: IntentExample[] = [
  { label: 'Swap 1 USDC from OP Sepolia to Base Sepolia', sentence: 'swap 1 USDC on op sepolia for USDC on base sepolia' },
  { label: 'Swap 5 USDC from Base Sepolia to OP Sepolia', sentence: 'swap 5 USDC on base sepolia for USDC on op sepolia' },
];

const BUSY: IntentPhase[] = ['switchingChain', 'approving', 'signing', 'submitting'];
const CARD_PHASES: IntentPhase[] = ['quoted', 'needsWallet', ...BUSY];

function themeVars(theme: RecoilTheme = {}): CSSProperties {
  const vars: Record<string, string> = {};
  if (theme.accent) vars['--rp-accent'] = theme.accent;
  if (theme.accentText) vars['--rp-accent-text'] = theme.accentText;
  if (theme.radius !== undefined) vars['--rp-radius'] = `${theme.radius}px`;
  if (theme.fontFamily) vars['--rp-font'] = theme.fontFamily;
  return vars as CSSProperties;
}

/**
 * RecoilPay intents in one component: the user types what they want, sees
 * the best solver quote, confirms in their wallet, and watches it settle.
 * Import `@recoilpay/intent-react/styles.css` once.
 */
export function RecoilIntent(props: RecoilIntentProps) {
  const intent = useRecoilIntent({ apiUrl: props.apiUrl, session: props.session, wallet: props.wallet });
  const [value, setValue] = useState(props.defaultValue ?? '');
  const examples = props.examples === false ? [] : (props.examples ?? DEFAULT_EXAMPLES);
  useLifecycleCallbacks(intent, props);

  const submit = (sentence = value) => {
    const text = sentence.trim();
    if (text && intent.ready) void intent.run(text);
  };
  const startOver = () => {
    intent.reset();
    setValue('');
  };

  const connect = () => props.onConnectWallet?.();
  const showCard = intent.preview && (CARD_PHASES.includes(intent.phase) || (intent.phase === 'error' && intent.route));

  return (
    <div className={['rp-root', props.className].filter(Boolean).join(' ')} data-mode={props.theme?.mode ?? 'dark'} style={themeVars(props.theme)}>
      <div className="rp-composer">
        <div className="rp-composer-head">
          <span className="rp-eyebrow">
            <span aria-hidden="true">/</span>intent
          </span>
          <span className="rp-powered">RecoilPay</span>
        </div>
        <form
          className="rp-composer-row"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            className="rp-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={props.placeholder ?? 'swap 1 USDC on OP Sepolia for USDC on Base Sepolia'}
            aria-label="Describe a swap or send"
            autoComplete="off"
            spellCheck={false}
            maxLength={500}
          />
          <button type="submit" className="rp-run" aria-label="Run intent" disabled={!intent.ready || !value.trim()}>
            <ArrowRight />
          </button>
        </form>
        {intent.phase === 'idle' && examples.length > 0 && (
          <div className="rp-examples">
            <span className="rp-examples-label">try</span>
            <div className="rp-example-list">
              {examples.map((ex) => (
                <button
                  key={ex.sentence}
                  type="button"
                  className="rp-example"
                  disabled={!intent.ready}
                  onClick={() => {
                    setValue(ex.sentence);
                    submit(ex.sentence);
                  }}
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rp-results" aria-live="polite">
        {intent.assetsError && intent.phase === 'idle' && (
          <Note icon={<Alert />}>
            Could not reach the solver network.{' '}
            <button type="button" className="rp-link" onClick={() => void intent.session.refreshAssets()}>
              Retry
            </button>
          </Note>
        )}
        {intent.phase === 'parsing' && <Note icon={<Spinner />}>Reading your intent…</Note>}
        {intent.phase === 'offTemplate' && intent.hint && <Note icon={<Alert />}>{intent.hint}</Note>}
        {intent.phase === 'invalid' && (
          <ul className="rp-issues">
            {intent.issues.map((issue, i) => (
              <li key={`${issue.field}-${i}`}>
                <Alert />
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        )}
        {intent.phase === 'quoting' && (
          <Note icon={<Route />} tone="accent">
            {intent.queueTotal > 1
              ? `Intent ${intent.queueIndex + 1} of ${intent.queueTotal}: asking solvers for a quote…`
              : 'Asking solvers for a quote…'}
          </Note>
        )}
        {intent.phase === 'needsWallet' && !intent.preview && (
          <div className="rp-connect">
            <p>Connect a wallet to get a quote.</p>
            {props.onConnectWallet && (
              <button type="button" className="rp-button" onClick={connect}>
                Connect wallet
              </button>
            )}
          </div>
        )}
        {intent.queueTotal > 1 && !['idle', 'parsing', 'offTemplate', 'invalid'].includes(intent.phase) && (
          <div className="rp-queue">
            <span>
              Intent {intent.queueIndex + 1} of {intent.queueTotal}
            </span>
            <div className="rp-queue-track">
              <div style={{ width: `${((intent.queueIndex + (intent.phase === 'done' ? 1 : 0)) / intent.queueTotal) * 100}%` }} />
            </div>
          </div>
        )}
        {showCard && intent.preview && (
          <ConfirmCard
            preview={intent.preview}
            phase={intent.phase}
            needsApproval={intent.needsApproval}
            isConnected={intent.isConnected}
            direct={intent.route === 'direct'}
            error={intent.phase === 'error' ? intent.error : null}
            onConfirm={() => void intent.confirm()}
            onConnect={props.onConnectWallet ? connect : undefined}
            onCancel={startOver}
          />
        )}
        {(intent.phase === 'tracking' || intent.phase === 'done') && intent.orderId && (
          <OrderProgress status={intent.status} direct={intent.route === 'direct'} explorerUrl={intent.explorerUrl} onNew={startOver} />
        )}
        {intent.phase === 'error' && !intent.route && (
          <div className="rp-error">
            <p>{intent.error}</p>
            <button type="button" className="rp-button rp-button-quiet" onClick={startOver}>
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Fires the host's callbacks on phase transitions, once each. */
function useLifecycleCallbacks(intent: IntentState, props: RecoilIntentProps) {
  const prev = useRef<IntentState>(intent);
  const cbs = useRef(props);
  cbs.current = props;
  useEffect(() => {
    const before = prev.current;
    prev.current = intent;
    if (intent.orderId && intent.orderId !== before.orderId) cbs.current.onOrderSubmitted?.(intent.orderId);
    if (intent.phase === 'done' && before.phase !== 'done') cbs.current.onComplete?.(intent);
    if (intent.phase === 'error' && before.phase !== 'error' && intent.error) cbs.current.onError?.(intent.error);
  }, [intent]);
}

function Note({ icon, tone = 'muted', children }: { icon: ReactNode; tone?: 'muted' | 'accent'; children: ReactNode }) {
  return (
    <p className="rp-note" data-tone={tone}>
      <span className="rp-note-icon">{icon}</span>
      <span>{children}</span>
    </p>
  );
}

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function actionLabel(phase: IntentPhase, isConnected: boolean, needsApproval: boolean, symbol: string, direct: boolean): string {
  if (!isConnected || phase === 'needsWallet') return 'Connect wallet';
  switch (phase) {
    case 'switchingChain':
      return 'Switching network…';
    case 'approving':
      return `Approving ${symbol}…`;
    case 'signing':
      return 'Confirm in your wallet…';
    case 'submitting':
      return 'Submitting…';
    case 'error':
      return 'Try again';
    default:
      if (direct) return `Send ${symbol}`;
      return needsApproval ? `Approve ${symbol} and swap` : 'Confirm and sign';
  }
}

function ConfirmCard(p: {
  preview: IntentPreview;
  phase: IntentPhase;
  needsApproval: boolean;
  isConnected: boolean;
  direct: boolean;
  error: string | null;
  onConfirm: () => void;
  onConnect?: () => void;
  onCancel: () => void;
}) {
  const busy = BUSY.includes(p.phase);
  const send = p.preview.action === 'send';
  const wantsWallet = !p.isConnected || p.phase === 'needsWallet';
  const { solverCount, solversQueried } = p.preview;

  return (
    <div className="rp-card">
      <div className="rp-card-head">
        <div>
          <div className="rp-overline">Review</div>
          <div className="rp-card-title">{p.direct ? 'Direct transfer' : 'Best solver route'}</div>
        </div>
        <span className="rp-badge">
          <Check /> Quoted
        </span>
      </div>

      <div className="rp-route">
        <Amount label={send ? 'You send' : 'You pay'} amount={p.preview.payAmount} symbol={p.preview.paySymbol} chain={p.preview.srcChainName} />
        <span className="rp-route-arrow">
          <ArrowRight />
        </span>
        <Amount
          align="end"
          label={send ? 'They receive' : 'You receive'}
          amount={p.direct ? p.preview.receiveAmount : `~${p.preview.receiveAmount}`}
          symbol={p.preview.receiveSymbol}
          chain={p.preview.dstChainName}
        />
      </div>

      <dl className="rp-meta">
        <div>
          <dt>Settles in</dt>
          <dd>{p.preview.etaSeconds ? `~${p.preview.etaSeconds}s` : 'Fast'}</dd>
        </div>
        <div>
          <dt>{p.direct ? 'Route' : 'Solvers'}</dt>
          <dd data-accent>
            {p.direct
              ? 'Your wallet'
              : solversQueried && solversQueried > solverCount
                ? `${solverCount} of ${solversQueried} quoted`
                : `${solverCount} quoted`}
          </dd>
        </div>
        {send && p.preview.recipient && (
          <div>
            <dt>Recipient</dt>
            <dd className="rp-mono">{shortAddr(p.preview.recipient)}</dd>
          </div>
        )}
      </dl>

      {p.needsApproval && !busy && !wantsWallet && (
        <p className="rp-fineprint">First time with {p.preview.paySymbol}: your wallet will ask for a one-time approval, then a signature.</p>
      )}
      {p.error && <p className="rp-card-error">{p.error}</p>}

      <div className="rp-card-actions">
        <button
          type="button"
          className="rp-button"
          disabled={busy || (wantsWallet && !p.onConnect)}
          onClick={wantsWallet ? p.onConnect : p.onConfirm}
        >
          {busy && <Spinner />}
          {actionLabel(p.phase, p.isConnected, p.needsApproval, p.preview.paySymbol, p.direct)}
        </button>
        {!busy && (
          <button type="button" className="rp-link" onClick={p.onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function Amount({ label, amount, symbol, chain, align = 'start' }: { label: string; amount: string; symbol: string; chain: string; align?: 'start' | 'end' }) {
  return (
    <div className="rp-amount" data-align={align}>
      <div className="rp-overline">{label}</div>
      <div className="rp-amount-value">
        {amount} {symbol}
      </div>
      <div className="rp-amount-chain">on {chain}</div>
    </div>
  );
}

const STEPS = ['Submitted', 'Filling', 'Filled', 'Settling', 'Done'] as const;

function stepOf(status: OrderStatus | null): number {
  switch (status) {
    case 'executing':
      return 1;
    case 'executed':
      return 2;
    case 'settled':
    case 'settling':
      return 3;
    case 'finalized':
      return 4;
    default:
      return 0;
  }
}

function OrderProgress({ status, direct, explorerUrl, onNew }: { status: OrderStatus | null; direct: boolean; explorerUrl: string | null; onNew: () => void }) {
  const failed = !!status && typeof status === 'object' && 'failed' in status;
  const refunded = status === 'refunded';
  const finished = status === 'finalized';
  const active = stepOf(status);
  const title = failed ? 'Order failed' : refunded ? 'Refunded' : finished ? (direct ? 'Sent' : 'Settled') : 'Settling…';

  return (
    <div className="rp-card" data-state={failed || refunded ? 'bad' : finished ? 'good' : 'pending'}>
      <div className="rp-card-head">
        <div className="rp-card-title">{title}</div>
        {explorerUrl && (
          <a className="rp-link" href={explorerUrl} target="_blank" rel="noopener noreferrer">
            View on explorer <External />
          </a>
        )}
      </div>
      {!direct && (
        <ol className="rp-steps">
          {STEPS.map((label, i) => {
            const state = failed || refunded ? 'bad' : i < active || finished ? 'done' : i === active ? 'current' : 'todo';
            return (
              <li key={label} data-state={state}>
                <span className="rp-step-dot">{state === 'bad' ? <Cross /> : state === 'done' ? <Check /> : state === 'current' ? <Spinner /> : null}</span>
                <span className="rp-step-label">{label}</span>
              </li>
            );
          })}
        </ol>
      )}
      {failed && (
        <p className="rp-card-error">
          {status.failed[0]}: {status.failed[1]}
        </p>
      )}
      {(finished || failed || refunded) && (
        <div className="rp-card-actions">
          <button type="button" className="rp-button rp-button-quiet" onClick={onNew}>
            New intent
          </button>
        </div>
      )}
    </div>
  );
}
