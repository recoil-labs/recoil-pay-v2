import { motion } from 'framer-motion';
import { EASE_OUT, useMotion } from '../lib/motion.ts';

/** A check mark that draws itself (pathLength 0→1). Static under reduced motion. */
export function Check({ size = 16, delay = 0, className = '' }: { size?: number; delay?: number; className?: string }) {
  const { reduced } = useMotion();
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <motion.path
        d="M3 8.5l3.2 3.2L13 4.8"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: reduced ? 1 : 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: reduced ? 0 : 0.36, delay: reduced ? 0 : delay, ease: EASE_OUT }}
      />
    </svg>
  );
}
