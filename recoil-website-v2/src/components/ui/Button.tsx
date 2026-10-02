import * as React from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'default' | 'outline' | 'ghost' | 'link' | 'icon';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const buttonVariants: Record<ButtonVariant, string> = {
  default: 'bg-btn-primary-bg text-btn-primary-text shadow-[0_16px_34px_-24px_var(--primary)] hover:brightness-[1.08] hover:shadow-[0_0_24px_var(--primary-dim)]',
  outline: 'border border-border-subtle bg-surface-input text-app-text hover:border-border-cyan hover:bg-surface-hover hover:text-accent-cyan',
  ghost: 'bg-transparent text-app-text hover:bg-surface-hover hover:text-accent-cyan',
  link: 'text-accent-cyan underline-offset-4 hover:underline',
  icon: 'rounded-full bg-surface-input text-app-text hover:bg-surface-hover hover:text-accent-cyan',
};

const buttonSize: Record<ButtonSize, string> = {
  default: 'h-10 px-4 py-2',
  sm: 'h-8 px-3 text-sm',
  lg: 'h-12 px-6 text-lg',
  icon: 'h-10 w-10',
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        className={cn(
          'inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl font-sans font-semibold outline-none transition-[background,border-color,color,box-shadow,filter,transform] duration-200 focus-visible:ring-2 focus-visible:ring-accent-cyan/70 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]',
          buttonVariants[variant],
          buttonSize[size],
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button };
