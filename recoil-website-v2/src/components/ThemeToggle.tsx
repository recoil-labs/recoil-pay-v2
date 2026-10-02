import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useTheme } from './ThemeProvider';

type Variant = 'desktop' | 'mobile';

export default function ThemeToggle({ variant = 'desktop' }: { variant?: Variant }) {
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const Icon = isDark ? Sun : Moon;
  const label = isDark ? t('nav.lightMode', 'Light mode') : t('nav.darkMode', 'Dark mode');

  if (variant === 'mobile') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={label}
        className="mt-2 flex w-full cursor-pointer items-center justify-between rounded-xl border border-border-subtle bg-surface-input px-3.5 py-3 font-sans text-sm font-semibold text-text-secondary transition-[border-color,color,background,transform] duration-200 hover:-translate-y-px hover:border-border-cyan hover:bg-surface-hover hover:text-accent-cyan focus-visible:ring-2 focus-visible:ring-accent-cyan/70 active:scale-[0.98]"
      >
        <span className="flex items-center gap-2">
          <Icon size={16} aria-hidden="true" />
          <span>{label}</span>
        </span>
        <span className="text-xs uppercase text-text-muted">{theme}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-border-subtle bg-surface-glass text-text-muted shadow-[0_14px_34px_-28px_var(--shadow-color)] backdrop-blur-xl transition-[border-color,color,background,transform] duration-200 hover:-translate-y-px hover:border-border-cyan hover:bg-surface-hover hover:text-accent-cyan active:scale-[0.98]',
      )}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}
