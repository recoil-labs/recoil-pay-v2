import { type ReactNode } from 'react';
import { motion, useReducedMotion, type Transition, type Variants } from 'framer-motion';
import { cn } from '@/lib/utils';

type RevealDirection = 'up' | 'down' | 'left' | 'right';

interface RevealSectionProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  direction?: RevealDirection;
  distance?: number;
  amount?: number;
}

const revealSpring: Transition = {
  type: 'spring',
  stiffness: 130,
  damping: 24,
  mass: 0.85,
};

function getHiddenOffset(direction: RevealDirection, distance: number) {
  switch (direction) {
    case 'down':
      return { y: -distance };
    case 'left':
      return { x: distance };
    case 'right':
      return { x: -distance };
    case 'up':
    default:
      return { y: distance };
  }
}

export default function RevealSection({
  children,
  className,
  delay = 0,
  direction = 'up',
  distance = 22,
  amount = 0.16,
}: RevealSectionProps) {
  const reduceMotion = useReducedMotion();
  const hiddenOffset = getHiddenOffset(direction, distance);

  const variants: Variants = reduceMotion
    ? {
        hidden: { opacity: 1 },
        visible: { opacity: 1 },
      }
    : {
        hidden: {
          opacity: 0,
          ...hiddenOffset,
          filter: 'blur(6px)',
        },
        visible: {
          opacity: 1,
          x: 0,
          y: 0,
          filter: 'blur(0px)',
        },
      };

  return (
    <motion.div
      className={cn('will-change-transform', className)}
      variants={variants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount, margin: '0px 0px -80px 0px' }}
      transition={reduceMotion ? { duration: 0 } : { ...revealSpring, delay: delay / 1000 }}
    >
      {children}
    </motion.div>
  );
}
