import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';

import { Section, SectionHeading } from './SectionHeading';
import { Reveal, VIEWPORT, container, item } from './motion/Reveal';

/* ── faq ──────────────────────────────────────────────────────────────────
   Native <details> elements — the browser handles open/close, keyboards and
   screen readers work for free, and there is no accordion state to manage.
   The answers stick to what the stack actually does today, testnet caveats
   included; a FAQ that oversells is just a slower way to lose someone. */

const QA = [
  {
    q: 'What exactly is an intent?',
    a: 'A sentence describing an outcome — "swap 25 USDC on Base Sepolia for USDC on Polygon Amoy" — instead of a transaction describing steps. You sign the outcome once; a solver works out and executes the route.',
  },
  {
    q: 'Who actually moves my funds?',
    a: 'Independent solvers registered with the aggregator. Your funds lock in an escrow contract on the origin chain, the winning solver delivers on the destination chain, and only a verified fill lets it claim the locked amount. The solvers listed on this page are the real, live set.',
  },
  {
    q: 'Does RecoilPay hold my assets?',
    a: 'No. Custody stays between your wallet and the settlement contracts — nothing passes through us. That is the "0 custody" in the numbers above.',
  },
  {
    q: 'Why do I see testnets everywhere?',
    a: 'The network is live on test chains — Sepolia variants, Polygon Amoy, Solana devnet — while the settlement stack hardens. Everything on this page runs against those chains for real; nothing here is a mock.',
  },
  {
    q: 'What does it cost?',
    a: "Solvers compete on price, and the quote you confirm is the price you get — competition is the fee model. You pay origin-chain gas for the signature; the solver carries destination-chain gas.",
  },
  {
    q: 'What happens if a fill fails?',
    a: 'Escrowed funds never transfer without a verified fill. Depending on the quote, a failed order refunds automatically or exposes a claim — the confirm card shows which before you sign.',
  },
] as const;

export default function FAQ() {
  const { t } = useTranslation();

  return (
    <Section id="faq">
      <Reveal>
        <SectionHeading
          align="center"
          eyebrow="faq"
          title={t('faq.h2', 'Fair questions')}
          lede={t('faq.lede', 'Short answers about how this actually works — caveats included.')}
        />
      </Reveal>

      <motion.div
        className="mx-auto mt-12 max-w-2xl"
        initial="hidden"
        whileInView="show"
        viewport={VIEWPORT}
        variants={container}
      >
        {QA.map(({ q, a }) => (
          <motion.div key={q} variants={item}>
            <details className="group border-t border-border">
              <summary className="flex cursor-pointer list-none items-baseline justify-between gap-6 py-5 [&::-webkit-details-marker]:hidden">
                <span
                  className="font-sans text-[15px] text-app-text"
                  style={{ fontWeight: 'var(--font-heading-weight)' as unknown as number, letterSpacing: 'var(--tracking-display)' }}
                >
                  {q}
                </span>
                {/* + rotates to × via the group's open state — one glyph, no icon set. */}
                <span
                  aria-hidden="true"
                  className="shrink-0 font-mono text-sm text-text-muted transition-transform duration-200 group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p
                className="max-w-[60ch] pb-6 font-sans text-sm text-text-secondary"
                style={{ lineHeight: 'var(--leading-body)', letterSpacing: 'var(--tracking-body)' }}
              >
                {a}
              </p>
            </details>
          </motion.div>
        ))}
        <div className="border-t border-border" />
      </motion.div>
    </Section>
  );
}
