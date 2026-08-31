import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { AlertCircle, ArrowRight, Loader2, PencilLine, Route } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useIntent } from '../hooks/useIntent';
import IntentConfirmCard from './IntentConfirmCard';
import OrderStatus from './OrderStatus';
import SwapCompleteModal from './SwapCompleteModal';

interface ExampleIntent {
  label: string;
  sentence: string;
  tag?: string;
}

const EXAMPLES: ExampleIntent[] = [
  {
    label: 'Swap 1 USDC from OP Sepolia to Polygon Amoy',
    sentence: 'swap 1 USDC on op sepolia for USDC on polygon amoy',
  },
  {
    label: 'Send 1 USDC from Base Sepolia to a wallet',
    sentence: 'send 1 USDC on base sepolia to polygon amoy to wallet address',
    tag: 'Edit',
  },
  {
    label: 'Run a two-step cross-chain intent',
    sentence: 'swap 1 USDC on base sepolia for USDC on ethereum sepolia and then send 10 USDC on op sepolia to wallet address',
    tag: 'Multi',
  },
];

function usePlaceholder(phrases: string[], paused: boolean): string {
  const [text, setText] = useState('');
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [hold, setHold] = useState(0);

  useEffect(() => {
    setText('');
    setPhraseIdx(0);
    setDeleting(false);
    setHold(0);
  }, [phrases]);

  useEffect(() => {
    if (paused || phrases.length === 0) return;

    const phrase = phrases[phraseIdx] ?? '';
    if (hold > 0) {
      const id = setTimeout(() => setHold(h => h - 1), 110);
      return () => clearTimeout(id);
    }

    if (!deleting && text.length < phrase.length) {
      const id = setTimeout(() => setText(phrase.slice(0, text.length + 1)), 140);
      return () => clearTimeout(id);
    }

    if (!deleting && text.length === phrase.length) {
      const id = setTimeout(() => setHold(26), 95);
      return () => clearTimeout(id);
    }

    if (deleting && text.length > 0) {
      const id = setTimeout(() => setText(text.slice(0, -1)), 55);
      return () => clearTimeout(id);
    }

    if (deleting && text.length === 0) {
      setDeleting(false);
      setPhraseIdx(i => (i + 1) % phrases.length);
    }
  }, [text, deleting, hold, phraseIdx, phrases, paused]);

  useEffect(() => {
    if (!paused && hold === 0 && phrases[phraseIdx] && text === phrases[phraseIdx]) {
      setDeleting(true);
    }
  }, [hold, text, phraseIdx, phrases, paused]);

  return text;
}

export default function IntentBar() {
  const { t } = useTranslation();
  const translatedPhrases = t('intentBar.phrases', { returnObjects: true }) as unknown;
  const phraseKey = Array.isArray(translatedPhrases) ? translatedPhrases.join('|') : '';
  const phrases = useMemo(
    () => Array.isArray(translatedPhrases) && translatedPhrases.length > 0
      ? translatedPhrases
      : EXAMPLES.map(example => example.label),
    [phraseKey],
  );
  const { openConnectModal } = useConnectModal();
  const intent = useIntent();

  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);

  const animated = usePlaceholder(phrases, focused || value.length > 0);
  const placeholder = focused ? 'swap 1 USDC on OP Sepolia for USDC on Base Sepolia' : animated;

  const submit = () => {
    const sentence = value.trim();
    if (!sentence || !intent.ready) return;
    intent.run(sentence);
  };

  const runExample = (sentence: string) => {
    setValue(sentence);
    if (!sentence.includes('wallet address') && intent.ready) {
      intent.run(sentence);
    }
  };

  const showResults = intent.phase !== 'idle' || intent.assetsError;

  return (
    <div className="w-full max-w-[720px] text-left">
      {/*
        A prompt composer, not a widget. One surface, one field, one control.
        The header badge ("Intent command"), the search icon, the three-step
        strip and the tag pills on the examples are gone: the steps now live
        in the How-it-works section where they can be read, and everything
        else was chrome telling the reader what the field already shows.
      */}
      <div
        className={cn(
          'rounded-lg border bg-surface transition-[border-color] duration-150',
          focused ? 'border-primary' : 'border-border',
        )}
      >
        <div className="flex items-end gap-2 p-2">
          <Input
            className="min-h-[56px] flex-1 border-0 bg-transparent px-3 font-sans text-[15px] text-app-text placeholder:text-text-muted focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-base"
            type="text"
            value={value}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setValue(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') submit();
            }}
            placeholder={placeholder}
            aria-label="Type an intent"
          />
          {/* Square icon control pinned to the field's corner. Enter also
              submits, so the button is the pointer affordance, not the only
              path — hence no "Run" label competing with the placeholder. */}
          <Button
            type="button"
            onClick={submit}
            disabled={!intent.ready || value.trim().length === 0}
            variant="default"
            aria-label="Run intent"
            className={cn(
              'h-10 w-10 shrink-0 rounded-md p-0',
              !intent.ready || value.trim().length === 0 ? 'cursor-default opacity-40' : 'cursor-pointer',
            )}
          >
            <ArrowRight size={18} aria-hidden="true" />
          </Button>
        </div>

        {intent.phase === 'idle' && !intent.assetsError && (
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 border-t border-border px-4 py-3">
            <span className="font-mono text-[11px] text-text-muted" style={{ letterSpacing: 'var(--tracking-ui)' }}>
              try
            </span>
            {EXAMPLES.map(example => {
              const isPlaceholder = example.sentence.includes('wallet address');
              return (
                <button
                  key={example.sentence}
                  type="button"
                  className="font-sans text-[13px] text-text-secondary underline-offset-4 transition-colors duration-150 hover:text-app-text hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => runExample(example.sentence)}
                  disabled={!intent.ready}
                  title={isPlaceholder ? 'Fills the field — replace the wallet address before running' : undefined}
                >
                  {example.label}
                  {isPlaceholder && <span aria-hidden="true" className="ms-1 text-text-muted">…</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {showResults && (
        <div className="mt-4 flex flex-col items-center gap-3 text-left">
          {intent.assetsError && intent.phase === 'idle' && (
            <StatusNote tone="muted" icon={<AlertCircle size={15} />}>
              Could not reach the solver network. Retry in a moment.
            </StatusNote>
          )}

          {intent.phase === 'offTemplate' && intent.hint && (
            <StatusNote tone="muted" icon={<PencilLine size={15} />}>{intent.hint}</StatusNote>
          )}

          {intent.phase === 'invalid' && (
            <ul className="m-0 flex w-full max-w-[520px] list-none flex-col gap-1.5 rounded-2xl bg-surface-glass p-4 shadow-[0_18px_70px_-62px_var(--shadow-color)]">
              {intent.issues.map((issue, index) => (
                <li key={`${issue.field}-${index}`} className="flex items-start gap-2">
                  <AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-red" aria-hidden="true" />
                  <span className="font-sans text-[13px] leading-[1.45] text-text-secondary">
                    {issue.message}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {intent.phase === 'parsing' && (
            <StatusNote tone="muted" icon={<Loader2 size={15} className="animate-spin" />}>
              AI is interpreting your intent...
            </StatusNote>
          )}

          {intent.phase === 'quoting' && (
            <StatusNote tone="accent" icon={<Route size={15} />}>
              {intent.queueTotal > 1
                ? `Executing intent ${intent.queueIndex + 1} of ${intent.queueTotal}: asking solvers for a quote...`
                : 'Asking solvers for a quote...'}
            </StatusNote>
          )}

          {intent.queueTotal > 1 && intent.phase !== 'idle' && intent.phase !== 'parsing' && intent.phase !== 'offTemplate' && intent.phase !== 'invalid' && (
            <div className="flex w-full max-w-[520px] items-center gap-3 rounded-full bg-surface-glass px-3 py-2 shadow-[0_14px_54px_-48px_var(--shadow-color)]">
              <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-cyan">
                Intent {intent.queueIndex + 1} of {intent.queueTotal}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-alt">
                <div
                  className="h-full rounded-full bg-[image:var(--gradient-cta)] transition-[width] duration-300"
                  style={{
                    width: `${((intent.queueIndex + (intent.phase === 'done' ? 1 : 0)) / intent.queueTotal) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {intent.preview && (
            (intent.phase === 'quoted' ||
              intent.phase === 'needsWallet' ||
              intent.phase === 'switchingChain' ||
              intent.phase === 'approving' ||
              intent.phase === 'signing' ||
              intent.phase === 'submitting' ||
              (intent.phase === 'error' && !!intent.quote)) && (
              <IntentConfirmCard
                preview={intent.preview}
                phase={intent.phase}
                needsApproval={intent.needsApproval}
                isConnected={intent.isConnected}
                error={intent.phase === 'error' ? intent.error : null}
                onConfirm={intent.confirm}
                onConnect={() => openConnectModal?.()}
                onCancel={intent.reset}
              />
            )
          )}

          {intent.phase === 'needsWallet' && !intent.preview && (
            <button
              type="button"
              onClick={() => openConnectModal?.()}
              className="self-start rounded-xl border border-primary bg-primary px-[18px] py-2.5 font-sans text-sm font-semibold text-btn-primary-text transition-[box-shadow,filter,transform] duration-200 hover:-translate-y-0.5 hover:brightness-[1.08] hover:shadow-[0_0_24px_var(--primary-dim)] focus-visible:ring-2 focus-visible:ring-accent-cyan/70"
            >
              Connect Wallet
            </button>
          )}

          {(intent.phase === 'tracking' || intent.phase === 'done') && intent.orderId && (
            <>
              <OrderStatus orderId={intent.orderId} status={intent.status} />
              <button
                type="button"
                onClick={() => {
                  intent.reset();
                  setValue('');
                }}
                className="self-center border-none bg-transparent p-0 font-sans text-[12.5px] text-text-muted transition-colors duration-200 hover:text-accent-cyan"
              >
                New intent
              </button>
            </>
          )}

          {intent.phase === 'error' && !intent.quote && (
            <div className="flex w-full max-w-[520px] flex-col gap-2 rounded-2xl bg-red-soft p-4">
              <p className={resultNoteClass('text-red')}>{intent.error}</p>
              <button
                type="button"
                onClick={intent.reset}
                className="self-start rounded-xl border border-border-subtle bg-surface px-3.5 py-2 font-sans text-[13px] font-semibold text-app-text transition-colors duration-200 hover:border-border-cyan hover:bg-surface-hover hover:text-accent-cyan focus-visible:ring-2 focus-visible:ring-accent-cyan/70"
              >
                Dismiss
              </button>
            </div>
          )}

          {typeof intent.status === 'string' &&
            ['settled', 'settling', 'finalized'].includes(intent.status) &&
            intent.phase === 'done' &&
            intent.preview && (
              <SwapCompleteModal
                action={intent.preview.action}
                receiveAmount={intent.preview.receiveAmount}
                receiveSymbol={intent.preview.receiveSymbol}
                dstChainName={intent.preview.dstChainName}
                explorerUrl={intent.explorerUrl}
                queueTotal={intent.queueTotal}
                onClose={() => {
                  intent.reset();
                  setValue('');
                }}
              />
            )}
        </div>
      )}
    </div>
  );
}

function resultNoteClass(colorClass: string): string {
  return `m-0 px-0.5 font-sans text-[13px] leading-[1.5] ${colorClass}`;
}

function StatusNote({
  children,
  icon,
  tone,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  tone: 'accent' | 'muted';
}) {
  return (
    <p className={cn(
      'm-0 inline-flex max-w-[520px] items-center gap-2 rounded-full border bg-surface-glass px-3.5 py-2 font-sans text-[13px] leading-[1.5] backdrop-blur-xl',
      tone === 'accent' ? 'border-border-cyan text-accent-cyan' : 'border-border-subtle text-text-muted'
    )}>
      <span className="flex-shrink-0">{icon}</span>
      <span>{children}</span>
    </p>
  );
}
