import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';

import { Section, SectionHeading } from './SectionHeading';
import { Reveal, VIEWPORT, container, hairline, item } from './motion/Reveal';

/* ── how funds move ───────────────────────────────────────────────────────
   The page explains what intents feel like; this explains why handing one
   to a stranger is safe. Four beats of the actual settlement mechanism —
   escrow, fill, attestation, claim — on the same numbered-hairline grid as
   "how it works", so mechanism and experience read as one system. The key
   sentence is the last one: the solver is paid from escrow only after the
   fill is verified, so it carries the risk, not you. */

const BEATS = [
  {
    title: 'Funds lock in escrow',
    desc: 'Your signature moves the input into an escrow contract on the origin chain — not to a solver, not to us.',
  },
  {
    title: 'The solver delivers first',
    desc: 'The winning solver sends the output on the destination chain from its own inventory, before it has touched yours.',
  },
  {
    title: 'The fill is verified',
    desc: 'An oracle attests on the origin chain that the destination fill actually happened, amount and recipient included.',
  },
  {
    title: 'Escrow pays the solver',
    desc: 'Only that attestation unlocks the escrow. No verified fill, no payout — a failed order refunds instead.',
  },
] as const;

export default function Settlement() {
  const { t } = useTranslation();

  return (
    <Section id="settlement">
      <Reveal>
        <SectionHeading
          align="center"
          eyebrow="settlement"
          title={t('settlement.h2', 'The solver takes the risk, not you')}
          lede={t('settlement.lede', 'Escrow on the origin chain, delivery on the destination, an attested fill in between — the payout only ever follows the proof.')}
        />
      </Reveal>

      <motion.ol
        className="mx-auto mt-14 grid max-w-5xl grid-cols-1 gap-x-10 sm:grid-cols-2 lg:grid-cols-4"
        initial="hidden"
        whileInView="show"
        viewport={VIEWPORT}
        variants={container}
      >
        {BEATS.map((beat, i) => (
          <motion.li key={beat.title} variants={item} className="relative pt-5 pb-8">
            <motion.span
              aria-hidden="true"
              variants={hairline}
              className="absolute inset-x-0 top-0 h-px origin-left bg-border"
            />
            <p className="font-mono text-[11px] tabular-nums text-primary" style={{ letterSpacing: 'var(--tracking-ui)' }}>
              {String(i + 1).padStart(2, '0')}
            </p>
            <h3
              className="mt-3 font-sans text-lg text-app-text"
              style={{
                fontWeight: 'var(--font-heading-weight)' as unknown as number,
                lineHeight: 'var(--leading-display)',
                letterSpacing: 'var(--tracking-display)',
              }}
            >
              {beat.title}
            </h3>
            <p
              className="mt-2 max-w-[32ch] font-sans text-sm text-text-secondary"
              style={{ lineHeight: 'var(--leading-body)', letterSpacing: 'var(--tracking-body)' }}
            >
              {beat.desc}
            </p>
          </motion.li>
        ))}
      </motion.ol>
    </Section>
  );
}
