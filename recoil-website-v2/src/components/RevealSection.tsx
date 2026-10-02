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

// Critically damped: the element arrives and stops. The previous under-
// damped spring overshot and settled, which on a scroll-triggered reveal
// reads as wobble rather than as arrival — bounce belongs on gestures that
// carried momentum, not on content that appeared because you scrolled.
const revealSpring: Transition = {
  type: 'spring',
  duration: 0.55,
  bounce: 0,
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
  distance = 12,
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
