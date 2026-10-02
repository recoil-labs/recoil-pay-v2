import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';

import { Section, SectionHeading } from './SectionHeading';
import { Reveal, VIEWPORT, container, item } from './motion/Reveal';
import { getSupportedAssets } from '../oif/client';
import { CHAIN_ALIASES } from '../intent/registry';
import type { SolverAsset } from '../oif/types';

/* ── executable right now ─────────────────────────────────────────────────
   Every registered solver declares exactly which token-on-chain pairs it
   will fill. This is that declaration, drawn as a matrix — not a roadmap,
   not "supported soon": if a cell is lit, an intent naming that pair has a
   solver ready to take it this minute. The one table on the page nobody
   could fake, because it is fetched from the same route the composer
   gates on before it lets an intent through. */

const chainName = (chainId: number): string => {
  const hit = Object.values(CHAIN_ALIASES).find(c => c.id === chainId);
  return hit?.name ?? `Chain ${chainId}`;
};

function useExecutablePairs() {
  const [assets, setAssets] = useState<SolverAsset[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getSupportedAssets()
      .then(a => { if (alive) setAssets(a); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  return { assets, failed };
}

export default function Coverage() {
  const { t } = useTranslation();
  const { assets, failed } = useExecutablePairs();

  const grid = useMemo(() => {
    if (!assets) return null;
    const symbols = [...new Set(assets.map(a => a.symbol.toUpperCase()))].sort();
    const chainIds = [...new Set(assets.map(a => a.chainId))]
      .sort((a, b) => chainName(a).localeCompare(chainName(b)));
    const filled = new Set(assets.map(a => `${a.chainId}:${a.symbol.toUpperCase()}`));
    return { symbols, chainIds, filled, pairs: assets.length };
  }, [assets]);

  // A dead aggregator gets silence, not an empty grid pretending otherwise.
  if (failed) return null;

  return (
    <Section id="coverage">
      <Reveal>
        <SectionHeading
          align="center"
          eyebrow="coverage"
          title={t('coverage.h2', 'Executable right now')}
          lede={t('coverage.lede', 'Live from solver registrations: a lit cell means a solver is ready to fill that token on that chain this minute.')}
        />
      </Reveal>

      {!grid ? (
        <div className="mx-auto mt-12 h-40 max-w-3xl animate-pulse rounded-lg bg-surface" />
      ) : (
        <motion.div
          className="mx-auto mt-12 max-w-3xl overflow-x-auto"
          initial="hidden"
          whileInView="show"
          viewport={VIEWPORT}
          variants={container}
        >
          <table className="w-full border-collapse">
            <thead>
              <motion.tr variants={item}>
                <th className="border-b border-border py-2.5 pe-4 text-left font-mono text-[11px] font-normal text-text-muted" style={{ letterSpacing: 'var(--tracking-ui)' }}>
                  chain
                </th>
                {grid.symbols.map(sym => (
                  <th key={sym} className="border-b border-border px-3 py-2.5 text-center font-mono text-[11px] font-normal text-text-muted" style={{ letterSpacing: 'var(--tracking-ui)' }}>
                    {sym}
                  </th>
                ))}
              </motion.tr>
            </thead>
            <tbody>
              {grid.chainIds.map(id => (
                <motion.tr key={id} variants={item}>
                  <td className="border-b border-border py-3 pe-4 font-sans text-[13px] text-app-text" style={{ letterSpacing: 'var(--tracking-ui)' }}>
                    {chainName(id)}
                  </td>
                  {grid.symbols.map(sym => {
                    const on = grid.filled.has(`${id}:${sym}`);
                    return (
                      <td key={sym} className="border-b border-border px-3 py-3 text-center">
                        <span
                          aria-label={on ? `${sym} executable on ${chainName(id)}` : `${sym} not offered on ${chainName(id)}`}
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: on ? 'var(--primary)' : 'var(--border)' }}
                        />
                      </td>
                    );
                  })}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      )}

      {grid && (
        <p className="mt-6 text-center font-sans text-xs text-text-muted" style={{ letterSpacing: 'var(--tracking-ui)' }}>
          {grid.pairs} executable {grid.pairs === 1 ? 'pair' : 'pairs'} · declared by active solvers · refreshes on load
        </p>
      )}
    </Section>
  );
}
