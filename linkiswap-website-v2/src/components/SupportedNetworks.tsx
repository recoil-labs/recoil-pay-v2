import { useTranslation } from 'react-i18next';
import RevealSection from './RevealSection';

type Chain = { name: string; logo: string };

const CHAINS: Chain[] = [
  { name: 'Ethereum',  logo: 'https://cdn.simpleicons.org/ethereum/627EEA' },
  { name: 'Bitcoin',   logo: 'https://cdn.simpleicons.org/bitcoin/F7931A' },
  { name: 'Solana',    logo: 'https://cdn.simpleicons.org/solana/14F195' },
  { name: 'Arbitrum',  logo: 'https://cryptologos.cc/logos/arbitrum-arb-logo.svg' },
  { name: 'Optimism',  logo: 'https://cryptologos.cc/logos/optimism-ethereum-op-logo.svg' },
  { name: 'Polygon',   logo: 'https://cdn.simpleicons.org/polygon/8247E5' },
  { name: 'Avalanche', logo: 'https://cryptologos.cc/logos/avalanche-avax-logo.svg' },
  { name: 'BNB Chain', logo: 'https://cdn.simpleicons.org/binance/F3BA2F' },
  { name: 'Base',      logo: 'https://dl.svgcdn.com/svg/logos/base.svg' },
  { name: 'TON',       logo: 'https://cryptologos.cc/logos/toncoin-ton-logo.svg' },
  { name: 'Tron',      logo: 'https://cryptologos.cc/logos/tron-trx-logo.svg' },
  { name: 'Fantom',    logo: 'https://cdn.simpleicons.org/fantom/1969FF' },
  { name: 'Sui',       logo: 'https://cdn.simpleicons.org/sui/4CA9E8' },
];

// The marquee needs enough repeats so the -33.333% translate leaves a full
// second copy visible on wide screens. Three copies cover viewports up to
// ~2 × (chains × item width) which is plenty.
const REPEATS = 3;

export default function SupportedNetworks() {
  const { t } = useTranslation();

  return (
    <section id="networks" className="section-shell overflow-hidden">
      <RevealSection>
        <div className="mx-auto mb-12 max-w-[560px] text-center">
          <h2 className="section-heading mb-3 text-[clamp(1.75rem,3.2vw,2.625rem)]">
            {t('networks.h2')}
          </h2>
          <p className="font-sans text-[0.96875rem] leading-relaxed text-text-secondary">
            {t('networks.subtitle')}
          </p>
        </div>
      </RevealSection>

      <div
        aria-label="Supported blockchain networks"
        className="relative overflow-hidden"
      >
        {/* Edge fade masks so items dissolve at the section edges */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(to_right,var(--app-bg),transparent_8%,transparent_92%,var(--app-bg))]"
        />

        <div className="marquee-track">
          {Array.from({ length: REPEATS }).map((_, groupIndex) => (
            <div
              key={groupIndex}
              aria-hidden={groupIndex > 0 ? 'true' : undefined}
              className="flex shrink-0"
            >
              {CHAINS.map(chain => (
                <ChainBadge key={`${groupIndex}-${chain.name}`} chain={chain} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ChainBadge({ chain }: { chain: Chain }) {
  return (
    <div className="flex w-[168px] shrink-0 flex-col items-center justify-center gap-3">
      <div className="media-shell flex size-[84px] items-center justify-center overflow-hidden rounded-full p-[18px]">
        <img
          src={chain.logo}
          alt={chain.name}
          loading="lazy"
          decoding="async"
          onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
          className="block size-full object-contain"
        />
      </div>
      <span className="font-mono text-xs font-medium tracking-[0.02em] whitespace-nowrap text-text-secondary">
        {chain.name}
      </span>
    </div>
  );
}
