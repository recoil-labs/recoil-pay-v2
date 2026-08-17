import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import RevealSection from './RevealSection';
import { cn } from '@/lib/utils';
import {
  coinPageUrl,
  fetchTopMarkets,
  formatPercent,
  formatUsdPrice,
  type MarketCoin,
} from '../lib/coingecko';

const PAGE_SIZE = 5;
const TOTAL_COINS = 100;
const TOTAL_PAGES = Math.ceil(TOTAL_COINS / PAGE_SIZE);

export default function LivePrices() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['coingecko-top-markets', TOTAL_COINS],
    queryFn: () => fetchTopMarkets(TOTAL_COINS),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const start = (page - 1) * PAGE_SIZE;
  const rows = data?.slice(start, start + PAGE_SIZE) ?? [];

  return (
    <section id="prices" className="section-shell px-5 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-[1120px]">
        <RevealSection>
          <div className="mx-auto mb-10 max-w-[720px] text-center">
            <span className="section-eyebrow">{t('prices.label', 'Market data')}</span>
            <h2 className="section-heading mt-4 text-[clamp(30px,3.4vw,46px)]">
              {t('prices.h2')}
            </h2>
          </div>
        </RevealSection>

        <div className="glass-panel overflow-hidden rounded-[24px]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse font-sans text-app-text">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-input/55">
                  <Th align="left"  hideBelow={520}>#</Th>
                  <Th align="left">{t('prices.headers.coin')}</Th>
                  <Th align="right">{t('prices.headers.price')}</Th>
                  <Th align="right" hideBelow={780}>{t('prices.headers.change1h')}</Th>
                  <Th align="right">{t('prices.headers.change24h')}</Th>
                </tr>
              </thead>
              <tbody>
                {isError ? (
                  <StatusRow message={t('prices.error')} />
                ) : isLoading || !data ? (
                  Array.from({ length: PAGE_SIZE }).map((_, i) => <SkeletonRow key={i} />)
                ) : (
                  rows.map((coin, i) => <CoinRow key={coin.id} coin={coin} rank={start + i + 1} />)
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-center gap-5 border-t border-border-subtle bg-surface-input/70 px-5 py-4">
            <PagerButton
              disabled={page === 1 || isLoading || isError}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              ariaLabel={t('prices.prev')}
            >
              <ChevronLeft size={19} aria-hidden="true" />
            </PagerButton>
            <span className="font-mono text-[13px] text-text-muted">
              {t('prices.pageOf', { current: page, total: TOTAL_PAGES })}
            </span>
            <PagerButton
              disabled={page === TOTAL_PAGES || isLoading || isError}
              onClick={() => setPage(p => Math.min(TOTAL_PAGES, p + 1))}
              ariaLabel={t('prices.next')}
            >
              <ChevronRight size={19} aria-hidden="true" />
            </PagerButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function Th({
  children, align, hideBelow,
}: { children: ReactNode; align: 'left' | 'right'; hideBelow?: number }) {
  return (
    <th
      className={cn(
        'px-[18px] py-3.5 font-sans text-[12.5px] font-semibold uppercase tracking-[0.06em] text-text-muted',
        align === 'right' ? 'text-right' : 'text-left',
        hideBelow ? `hide-below-${hideBelow}` : undefined
      )}
    >
      {children}
    </th>
  );
}

function CoinRow({ coin, rank }: { coin: MarketCoin; rank: number }) {
  const change1h = coin.price_change_percentage_1h_in_currency;
  const change24h = coin.price_change_percentage_24h;

  return (
    <tr
      onClick={() => window.open(coinPageUrl(coin.id), '_blank', 'noopener,noreferrer')}
      className="cursor-pointer border-b border-border-subtle transition-colors duration-150 hover:bg-surface-hover"
    >
      <Td align="left" hideBelow={520}>
        <span className="font-mono text-[13px] text-text-muted">{rank}</span>
      </Td>
      <Td align="left">
        <div className="flex items-center gap-3">
          <img
            src={coin.image}
            alt={coin.name}
            loading="lazy"
            decoding="async"
            width={28}
            height={28}
            className="h-7 w-7 flex-shrink-0 rounded-full"
          />
          <div className="min-w-0">
            <div className="truncate font-sans text-sm font-semibold text-app-text">{coin.name}</div>
            <div className="font-mono text-[11.5px] uppercase tracking-[0.04em] text-text-muted">
              {coin.symbol}
            </div>
          </div>
        </div>
      </Td>
      <Td align="right">
        <span className="font-mono text-sm font-semibold tabular-nums text-app-text">
          {formatUsdPrice(coin.current_price)}
        </span>
      </Td>
      <Td align="right" hideBelow={780}>
        <PercentCell value={change1h} />
      </Td>
      <Td align="right">
        <PercentCell value={change24h} />
      </Td>
    </tr>
  );
}

function Td({
  children, align, hideBelow,
}: { children: ReactNode; align: 'left' | 'right'; hideBelow?: number }) {
  return (
    <td
      className={cn(
        'px-[18px] py-3.5 align-middle',
        align === 'right' ? 'text-right' : 'text-left',
        hideBelow ? `hide-below-${hideBelow}` : undefined
      )}
    >
      {children}
    </td>
  );
}

function PercentCell({ value }: { value: number | null }) {
  const isPositive = (value ?? 0) >= 0;
  const colorClass = value === null || !Number.isFinite(value)
    ? 'text-text-muted'
    : isPositive ? 'text-green' : 'text-red';
  return (
    <span className={cn('font-mono text-sm font-semibold tabular-nums', colorClass)}>
      {formatPercent(value)}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border-subtle">
      <Td align="left" hideBelow={520}>
        <div className="skeleton-shimmer h-3 w-6 rounded" />
      </Td>
      <Td align="left">
        <div className="flex items-center gap-3">
          <div className="skeleton-shimmer h-7 w-7 rounded-full" />
          <div>
            <div className="skeleton-shimmer h-3 w-[76px] rounded" />
            <div className="skeleton-shimmer mt-1.5 h-2.5 w-10 rounded" />
          </div>
        </div>
      </Td>
      <Td align="right"><div className="skeleton-shimmer ml-auto h-3 w-[72px] rounded" /></Td>
      <Td align="right" hideBelow={780}><div className="skeleton-shimmer ml-auto h-3 w-12 rounded" /></Td>
      <Td align="right"><div className="skeleton-shimmer ml-auto h-3 w-12 rounded" /></Td>
    </tr>
  );
}

function StatusRow({ message }: { message: string }) {
  return (
    <tr>
      <td colSpan={5} className="px-5 py-8 text-center font-sans text-sm text-text-muted">
        {message}
      </td>
    </tr>
  );
}

function PagerButton({
  children, onClick, disabled, ariaLabel,
}: { children: ReactNode; onClick: () => void; disabled: boolean; ariaLabel: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-border-subtle bg-surface text-text-muted transition-[background,border-color,color,opacity,transform] duration-150 hover:-translate-y-px hover:border-border-cyan hover:bg-surface-hover hover:text-accent-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/70 disabled:cursor-default disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-border-subtle disabled:hover:bg-surface disabled:hover:text-text-muted"
    >
      {children}
    </button>
  );
}
