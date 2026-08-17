export type MarketCoin = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  price_change_percentage_24h: number | null;
  price_change_percentage_1h_in_currency: number | null;
  total_volume: number;
};

const ENDPOINT = 'https://api.coingecko.com/api/v3/coins/markets';

export async function fetchTopMarkets(limit = 100): Promise<MarketCoin[]> {
  const params = new URLSearchParams({
    vs_currency: 'usd',
    order: 'market_cap_desc',
    per_page: String(limit),
    page: '1',
    sparkline: 'false',
    price_change_percentage: '1h,24h',
  });
  const res = await fetch(`${ENDPOINT}?${params}`);
  if (!res.ok) throw new Error(`CoinGecko returned ${res.status}`);
  return (await res.json()) as MarketCoin[];
}

export function coinPageUrl(coinId: string): string {
  return `https://www.coingecko.com/en/coins/${coinId}`;
}

export function formatUsdPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (value >= 1)    return `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  if (value >= 0.01) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 8 })}`;
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}
