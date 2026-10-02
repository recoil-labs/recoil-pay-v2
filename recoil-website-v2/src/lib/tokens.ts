export interface Token {
  symbol: string;
  name: string;
  price: number;
  color: string;
}

export const TOKENS: Token[] = [
  { symbol: 'ETH',   name: 'Ethereum',       price: 3520,  color: '#627eea' },
  { symbol: 'USDC',  name: 'USD Coin',        price: 1,     color: '#2775ca' },
  { symbol: 'USDT',  name: 'Tether',          price: 1,     color: '#26a17b' },
  { symbol: 'WBTC',  name: 'Wrapped Bitcoin', price: 68000, color: '#f7931a' },
  { symbol: 'SOL',   name: 'Solana',          price: 172,   color: '#9945ff' },
  { symbol: 'ARB',   name: 'Arbitrum',        price: 0.95,  color: '#2b8ff0' },
  { symbol: 'OP',    name: 'Optimism',        price: 2.4,   color: '#ff4250' },
  { symbol: 'MATIC', name: 'Polygon',         price: 0.72,  color: '#8247e5' },
];

export const TOKEN_MAP: Record<string, Token> = Object.fromEntries(
  TOKENS.map(t => [t.symbol, t])
);

export function formatAmount(value: number, forceUsd = false): string {
  if (forceUsd) return value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}
