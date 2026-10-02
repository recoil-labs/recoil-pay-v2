export function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(' ');
}

export const springConfig = { type: "spring", stiffness: 500, damping: 30 } as const;

export const customSpringConfig = { type: "spring", stiffness: 600, damping: 25 } as const;
