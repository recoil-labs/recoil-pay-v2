import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ChevronsUpDown } from 'lucide-react';
import { springConfig } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/Dialog';

export interface TokenInputBlockProps {
  label: string;
  amount: string;
  onAmountChange: (value: string) => void;
  tokenSymbol: string;
  tokenIconUrl?: string;
  onTokenSelect: () => void;
  placeholder?: string;
}

export const TokenInputBlock: React.FC<TokenInputBlockProps> = ({
  label,
  amount,
  onAmountChange,
  tokenSymbol,
  tokenIconUrl,
  onTokenSelect,
  placeholder = '0.0',
}) => {
  const { t } = useTranslation();

  return (
    <motion.div
      layout
      className="media-shell rounded-2xl p-4"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1, transition: springConfig }}
      exit={{ opacity: 0, scale: 0.96, transition: springConfig }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <label className="font-sans text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">
          {label}
        </label>
        <span className="font-mono text-[11px] text-text-muted">Balance --</span>
      </div>

      <div className="flex items-center gap-3">
        <Input
          className="h-12 flex-1 border-0 bg-transparent px-0 font-display text-[28px] font-semibold text-app-text placeholder:text-text-muted focus-visible:ring-0 focus-visible:ring-offset-0"
          type="text"
          value={amount}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => onAmountChange(event.target.value)}
          placeholder={placeholder}
          aria-label={t('tokenInput.amount', { token: tokenSymbol })}
        />
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              onClick={onTokenSelect}
              aria-label={t('tokenInput.selectToken')}
              className="h-11 shrink-0 rounded-full border-border-subtle bg-surface-glass px-3 text-sm font-semibold hover:border-border-cyan hover:bg-surface-hover"
            >
              {tokenIconUrl ? (
                <img src={tokenIconUrl} alt="" className="h-5 w-5 rounded-full" />
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-dim font-mono text-[10px] text-accent-cyan">
                  {tokenSymbol.slice(0, 1)}
                </span>
              )}
              <span>{tokenSymbol}</span>
              <ChevronsUpDown size={14} className="text-text-muted" aria-hidden="true" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('tokenInput.chooseToken')}</DialogTitle>
              <DialogDescription>{t('tokenInput.chooseTokenDesc')}</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>
    </motion.div>
  );
};
