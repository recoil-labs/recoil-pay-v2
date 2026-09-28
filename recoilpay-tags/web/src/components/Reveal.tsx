import { motion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';
import { REDUCED, T, useMotion } from '../lib/motion.ts';

/**
 * Section entrance: opacity and a short rise on a damped spring, children
 * staggered 70ms. Runs once. Wrap each staggered child in <Reveal.Item>.
 */
export function Reveal({ children, className, as = 'section', id }: { children: ReactNode; className?: string; as?: 'section' | 'div'; id?: string }) {
  const { reduced } = useMotion();
  const Tag = as === 'section' ? motion.section : motion.div;
  return (
    <Tag
      id={id}
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount: 0.25 }}
      variants={{ hidden: {}, shown: { transition: { staggerChildren: reduced ? 0 : 0.07 } } }}
    >
      {children}
    </Tag>
  );
}

const item = (reduced: boolean): Variants => ({
  hidden: { opacity: 0, y: reduced ? 0 : 12 },
  shown: { opacity: 1, y: 0, transition: reduced ? REDUCED : T.damped },
});

Reveal.Item = function RevealItem({ children, className }: { children: ReactNode; className?: string }) {
  const { reduced } = useMotion();
  return (
    <motion.div className={className} variants={item(reduced)}>
      {children}
    </motion.div>
  );
};

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}
