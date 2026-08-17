import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { AlertCircle, ArrowRight, Loader2, PencilLine, Route, Search, Sparkles } from 'lucide-react';
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
      const id = setTimeout(() => setHold(h => h - 1), 95);
      return () => clearTimeout(id);
    }

    if (!deleting && text.length < phrase.length) {
      const id = setTimeout(() => setText(phrase.slice(0, text.length + 1)), 90);
      return () => clearTimeout(id);
    }

    if (!deleting && text.length === phrase.length) {
      const id = setTimeout(() => setHold(18), 95);
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
    <div className="w-full max-w-[760px]">
      <div className="glass-panel overflow-hidden rounded-[22px]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3 text-left">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border-cyan bg-primary-dim text-accent-cyan">
              <Sparkles size={16} aria-hidden="true" />
            </span>
            <div>
              <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                Intent command
              </div>
              <div className="font-display text-base font-semibold text-app-text">
                Tell LinkiSwap the outcome
              </div>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-input px-3 py-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.1em] text-text-secondary">
            <span className="h-2 w-2 rounded-full bg-mint shadow-[0_0_16px_var(--mint)]" />
            Solver net live
          </div>
        </div>

        <div className="px-4 py-4 sm:px-5">
          <div
            className={cn(
              'flex min-h-[66px] items-center gap-3 rounded-2xl border bg-surface-input pl-4 pr-2 transition-[border-color,box-shadow,background] duration-200 sm:pl-5',
              focused
                ? 'border-border-cyan shadow-[0_0_0_5px_var(--focus-glow),0_24px_70px_-42px_var(--shadow-color)]'
                : 'border-border-subtle shadow-[0_18px_56px_-46px_var(--shadow-color)]'
            )}
          >
            <Search size={20} className="flex-shrink-0 text-accent-cyan" aria-hidden="true" />
            <Input
              className="h-14 flex-1 border-0 bg-transparent px-0 font-sans text-[15px] text-app-text placeholder:text-text-muted focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-base"
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
            <Button
              type="button"
              onClick={submit}
              disabled={!intent.ready || value.trim().length === 0}
              variant="default"
              className={cn(
                'h-11 rounded-full px-4 font-sans text-sm font-semibold shadow-[0_16px_34px_-22px_var(--primary)] sm:px-5',
                !intent.ready || value.trim().length === 0
                  ? 'cursor-default opacity-50'
                  : 'cursor-pointer hover:shadow-[0_0_22px_var(--primary-dim)]'
              )}
            >
              <span className="hidden sm:inline">Run</span>
              <ArrowRight size={17} aria-hidden="true" />
            </Button>
          </div>

          {intent.phase === 'idle' && !intent.assetsError && (
            <div className="mt-4 flex max-w-[720px] flex-wrap justify-center gap-2.5">
              {EXAMPLES.map(example => {
                const isPlaceholder = example.sentence.includes('wallet address');

                return (
                  <button
                    key={example.sentence}
                    type="button"
                    className="group inline-flex cursor-pointer items-center gap-2 rounded-full border border-border-subtle bg-chip-bg px-3.5 py-2 font-sans text-[12.5px] font-medium text-text-secondary transition-[background,border-color,color,transform] duration-200 hover:-translate-y-0.5 hover:border-border-cyan hover:bg-chip-hover-bg hover:text-app-text disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => runExample(example.sentence)}
                    disabled={!intent.ready}
                    title={isPlaceholder ? 'Click to fill, then replace wallet address' : undefined}
                  >
                    {example.tag && (
                      <span className="rounded-full border border-border-cyan bg-primary-dim px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-accent-cyan">
                        {example.tag}
                      </span>
                    )}
                    <span>{example.label}</span>
                    {isPlaceholder && <PencilLine size={13} className="text-text-muted group-hover:text-accent-cyan" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 border-t border-border-subtle bg-surface-glass sm:grid-cols-3">
          {['Parse intent', 'Auction route', 'Settle assets'].map((step, index) => (
            <div
              key={step}
              className="flex items-center gap-3 border-b border-border-subtle px-5 py-3 text-left last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
            >
              <span className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[11px] font-semibold',
                index === 0 ? 'border-border-cyan bg-primary-dim text-accent-cyan' : 'border-border-subtle bg-surface-input text-text-muted'
              )}>
                {index + 1}
              </span>
              <span className="font-sans text-[12px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                {step}
              </span>
            </div>
          ))}
        </div>
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
