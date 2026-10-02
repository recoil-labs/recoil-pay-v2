import { useTranslation } from 'react-i18next';

import { motion } from 'framer-motion';

import { Section, SectionHeading } from './SectionHeading';
import { Reveal, VIEWPORT, container, hairline, item } from './motion/Reveal';

/* ── the grammar, documented ──────────────────────────────────────────────
   The composer takes sentences, and every sentence-taking interface raises
   the same question: what am I allowed to say? This answers it with the
   actual shapes the parser resolves, set like man-page syntax — angle
   brackets for slots, plain words for keywords.

   Kept next to the parser's own vocabulary on purpose: the examples name
   real chains from the registry, so copying one out of this section into
   the composer above always works. */

interface Pattern {
  name: string;
  syntax: Array<{ text: string; slot?: boolean }>;
  example: string;
}

const PATTERNS: Pattern[] = [
  {
    name: 'swap',
    syntax: [
      { text: 'swap ' },
      { text: '<amount>', slot: true },
      { text: ' ' },
      { text: '<token>', slot: true },
      { text: ' on ' },
      { text: '<chain>', slot: true },
      { text: ' for ' },
      { text: '<token>', slot: true },
      { text: ' on ' },
      { text: '<chain>', slot: true },
    ],
    example: 'swap 1 USDC on OP Sepolia for USDC on Polygon Amoy',
  },
  {
    name: 'send',
    syntax: [
      { text: 'send ' },
      { text: '<amount>', slot: true },
      { text: ' ' },
      { text: '<token>', slot: true },
      { text: ' on ' },
      { text: '<chain>', slot: true },
      { text: ' to ' },
      { text: '<address>', slot: true },
    ],
    example: 'send 1 USDC on Base Sepolia to 0x1234…',
  },
  {
    name: 'chain intents',
    syntax: [
      { text: '<intent>', slot: true },
      { text: ' and then ' },
      { text: '<intent>', slot: true },
    ],
    example: 'swap 1 USDC on Base Sepolia for USDC on Ethereum Sepolia and then send it onward',
  },
];

export default function Patterns() {
  const { t } = useTranslation();

  return (
    <Section id="patterns">
      <Reveal>
        <SectionHeading
        align="center"
        eyebrow="patterns"
        title={t('patterns.h2', 'What you can say')}
        lede={t('patterns.lede', 'Three sentence shapes cover everything. Dollar amounts work too — "a $50 gift" resolves against live prices.')}
        />
      </Reveal>

      <motion.div
        className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-x-10 lg:grid-cols-3"
        initial="hidden"
        whileInView="show"
        viewport={VIEWPORT}
        variants={container}
      >
        {PATTERNS.map(p => (
          <motion.div key={p.name} variants={item} className="relative pt-5 pb-8">
            <motion.span aria-hidden="true" variants={hairline} className="absolute inset-x-0 top-0 h-px origin-left bg-border" />
            <p className="font-mono text-[11px] text-primary" style={{ letterSpacing: 'var(--tracking-ui)' }}>
              {p.name}
            </p>
            {/* The syntax line is mono because it is syntax: slots read
                differently from keywords at a glance. */}
            <p className="mt-3 font-mono text-[13px] leading-[1.8] text-app-text">
              {p.syntax.map((part, i) =>
                part.slot ? (
                  <span key={i} className="rounded-sm bg-[var(--chip-bg)] px-1 py-0.5 text-primary">{part.text}</span>
                ) : (
                  <span key={i}>{part.text}</span>
                ),
              )}
            </p>
            <p className="mt-3 font-sans text-[13px] text-text-muted" style={{ lineHeight: 'var(--leading-body)' }}>
              {p.example}
            </p>
          </motion.div>
        ))}
      </motion.div>
    </Section>
  );
}
