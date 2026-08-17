import { useTranslation } from 'react-i18next';
import { Network, ShieldCheck } from 'lucide-react';

const CHAINS = ['Ethereum', 'Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon'];

export default function TrustStrip() {
  const { t } = useTranslation();

  return (
    <section className="border-b border-border-subtle px-5 py-5 sm:px-8 lg:px-10">
      <div className="glass-card mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-4 rounded-2xl px-4 py-4 min-[901px]:flex-row">
        <div className="flex items-center gap-3 font-sans text-[13px] font-semibold text-text-secondary">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border-cyan bg-primary-dim text-accent-cyan">
            <ShieldCheck size={16} aria-hidden="true" />
          </span>
          {t('trust.built')}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {CHAINS.map(chain => (
            <span
              key={chain}
              className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-input px-3 py-1.5 font-sans text-[12px] font-semibold text-text-muted"
            >
              <Network size={13} className="text-accent-cyan" aria-hidden="true" />
              {chain}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
