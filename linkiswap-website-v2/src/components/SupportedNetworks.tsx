import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CHAIN_ALIASES, type CanonicalChain } from '../intent/registry';
import { Section, SectionHeading } from './SectionHeading';
import { Reveal } from './motion/Reveal';

/* ── supported networks ───────────────────────────────────────────────────
   Was a marquee of thirteen chains including Bitcoin, TON, Tron and Sui —
   none of which the intent parser can resolve. The list is now derived from
   the parser's own registry, deduplicated by chain id, so it can only ever
   show a chain the input on this page will actually accept. It grows when
   the registry grows and not before.

   Logos come from Simple Icons where an entry exists; anything that fails
   falls back to a tinted monogram rather than a hole — the old list had an
   empty circle where Base should have been because its CDN had died. */

interface Brand { color: string; logo?: string }

/** Keyed on canonical chain name. Testnets share their mainnet's brand. */
const BRAND: Record<string, Brand> = {
  Ethereum:  { color: '#627EEA', logo: 'https://cdn.simpleicons.org/ethereum/627EEA' },
  Base:      { color: '#0052FF', logo: 'https://cdn.simpleicons.org/coinbase/0052FF' },
  Arbitrum:  { color: '#12AAFF', logo: 'https://cryptologos.cc/logos/arbitrum-arb-logo.svg' },
  Optimism:  { color: '#FF0420', logo: 'https://cdn.simpleicons.org/optimism/FF0420' },
  Polygon:   { color: '#8247E5', logo: 'https://cdn.simpleicons.org/polygon/8247E5' },
  Solana:    { color: '#14F195', logo: 'https://cdn.simpleicons.org/solana/14F195' },
};

function brandFor(name: string): Brand {
  // "Base Sepolia" → Base, "Solana Devnet" → Solana, "Polygon Amoy" → Polygon.
  const key = Object.keys(BRAND).find(k => name.startsWith(k));
  return key ? BRAND[key] : { color: '#9184d9' };
}

function ChainChip({ chain }: { chain: CanonicalChain }) {
  const [broken, setBroken] = useState(false);
  const brand = brandFor(chain.name);
  const showLogo = brand.logo && !broken;
  const testnet = /sepolia|devnet|amoy|testnet/i.test(chain.name);

  return (
    <li className="flex shrink-0 items-center gap-2.5 rounded-md border border-border bg-surface py-2 pe-3.5 ps-2.5">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ backgroundColor: `${brand.color}1f` }}>
        {showLogo ? (
          <img src={brand.logo} alt="" width={14} height={14} loading="lazy" decoding="async" className="h-3.5 w-3.5" onError={() => setBroken(true)} />
        ) : (
          <span aria-hidden="true" className="text-[10px] font-medium leading-none" style={{ color: brand.color }}>
            {chain.name.charAt(0)}
          </span>
        )}
      </span>
      <span className="whitespace-nowrap font-sans text-[13px] text-app-text" style={{ letterSpacing: 'var(--tracking-ui)' }}>
        {chain.name}
      </span>
      {/* Say so when it is a testnet, rather than letting a reader assume
          mainnet liquidity behind a familiar brand mark. */}
      {testnet && (
        <span className="font-mono text-[10px] text-text-muted">testnet</span>
      )}
    </li>
  );
}

export default function SupportedNetworks() {
  const { t } = useTranslation();

  const chains = useMemo(() => {
    const byId = new Map<number, CanonicalChain>();
    for (const c of Object.values(CHAIN_ALIASES)) if (!byId.has(c.id)) byId.set(c.id, c);
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  return (
    <Section id="networks" divide={false}>
      <Reveal>
        <SectionHeading
          align="center"
          eyebrow="networks"
          title={t('networks.h2', 'Networks the parser understands')}
          lede={t('networks.subtitle', 'Name any of these in an intent and the aggregator will route across it.')}
        />
      </Reveal>

      {/* A slow marquee, li.fi-style: the row drifts, pauses on hover, and
          holds still under reduced motion. The list renders twice so the
          loop point is invisible; the duplicate is aria-hidden. */}
      <div className="group relative mt-12 overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)]">
        <div className="networks-marquee flex w-max gap-3 pe-3 group-hover:[animation-play-state:paused]">
          <ul className="flex shrink-0 gap-3">
            {chains.map(c => <ChainChip key={c.id} chain={c} />)}
          </ul>
          <ul className="flex shrink-0 gap-3" aria-hidden="true">
            {chains.map(c => <ChainChip key={`dup-${c.id}`} chain={c} />)}
          </ul>
        </div>
      </div>

      <p className="mt-6 text-center font-sans text-xs text-text-muted" style={{ letterSpacing: 'var(--tracking-ui)' }}>
        {chains.length} {chains.length === 1 ? 'network' : 'networks'} · derived from the intent registry
      </p>
    </Section>
  );
}
