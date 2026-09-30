import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Globe2, Menu, X } from 'lucide-react';
import Logo from './Logo';
import ThemeToggle from './ThemeToggle';
import WalletButton from './WalletButton';
import { LANGUAGES } from '../i18n';
import { cn, springConfig } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { TAGS_URL } from '@/lib/links';

export default function Nav() {
  const { t, i18n } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const languageMenuRef = useRef<HTMLDivElement>(null);

  const currentLang = LANGUAGES.find(l => l.code === i18n.language) ?? LANGUAGES[0];
  const selectLanguageLabel = t('nav.selectLanguage', 'Select language');
  const chooseLanguageLabel = t('nav.chooseLanguage', 'Choose language');
  const openMenuLabel = t('nav.openMenu', 'Open menu');
  const closeMenuLabel = t('nav.closeMenu', 'Close menu');

  useEffect(() => {
    if (!langOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!languageMenuRef.current?.contains(event.target as Node)) {
        setLangOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLangOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [langOpen]);

  // Only sections that still exist, plus the one external destination that
  // is real: the solver operator portal. Blog and docs pointed at hosts that
  // died with the old brand's Render workspace.
  const navLinks: { label: string; href: string; external?: boolean; badge?: string }[] = [
    { label: t('nav.how'), href: '#how' },
    { label: t('nav.marketplace', 'Solvers'), href: '#marketplace' },
    { label: t('nav.networks', 'Networks'), href: '#networks' },
    { label: t('nav.developers', 'Developers'), href: '#developers' },
    { label: t('nav.solverPortal', 'Run a solver'), href: 'https://solver.recoilpay.com', external: true },
    { label: t('nav.tags', 'Tags'), href: TAGS_URL, external: true, badge: t('nav.new', 'new') },
  ];

  const badgeEl = (badge?: string) =>
    badge ? (
      <span className="ms-1.5 rounded-full bg-primary-dim px-1.5 py-px align-middle font-mono text-[9px] font-semibold uppercase text-primary">
        {badge}
      </span>
    ) : null;

  return (
    <nav className="sticky top-0 z-50 border-b border-header-border bg-header-bg backdrop-blur-xl [backdrop-filter:blur(20px)_saturate(180%)] transition-colors duration-200">
      <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-5 px-5 py-3.5 sm:px-8 lg:px-10">
        <a href="#" className="group flex items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/70">
          <Logo height={23} />
        </a>

        <div className="hidden items-center rounded-full border border-border-subtle bg-surface-glass px-1.5 py-1 shadow-[0_18px_56px_-34px_var(--shadow-color)] backdrop-blur-xl min-[901px]:flex">
          {navLinks.map(({ label, href, external, badge }) => (
            <a
              key={href}
              href={href}
              {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="rounded-full px-4 py-2 font-sans text-[13px] font-semibold text-text-secondary no-underline transition-[background,color,transform] duration-200 hover:-translate-y-px hover:bg-surface-hover hover:text-app-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/70"
            >
              {label}
              {badgeEl(badge)}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-2.5 min-[901px]:flex">
          <div ref={languageMenuRef} className="relative">
            <Button
              type="button"
              variant="outline"
              aria-haspopup="listbox"
              aria-expanded={langOpen}
              aria-label={selectLanguageLabel}
              onClick={() => setLangOpen(open => !open)}
              className={cn(
                'flex h-10 items-center gap-2 rounded-full border bg-surface-glass px-3.5 font-sans text-[13px] font-semibold text-text-secondary shadow-[0_14px_34px_-28px_var(--shadow-color)] backdrop-blur-xl hover:border-border-cyan hover:bg-surface-hover hover:text-accent-cyan',
                langOpen ? 'border-border-cyan text-accent-cyan' : 'border-border-subtle'
              )}
            >
              <Globe2 size={15} aria-hidden="true" />
              <span>{currentLang.code.toUpperCase()}</span>
              <ChevronDown
                size={14}
                className={cn('transition-transform duration-200', langOpen && 'rotate-180')}
                aria-hidden="true"
              />
            </Button>

            <AnimatePresence>
              {langOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={springConfig}
                  className="glass-panel absolute right-0 top-[calc(100%+12px)] z-50 w-64 overflow-hidden rounded-2xl p-1.5"
                  role="listbox"
                  aria-label={chooseLanguageLabel}
                >
                  <div className="px-3 py-2 font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    {selectLanguageLabel}
                  </div>
                  <div className="max-h-[320px] overflow-y-auto pr-1">
                    {LANGUAGES.map(lang => {
                      const selected = lang.code === i18n.language;

                      return (
                        <button
                          key={lang.code}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            i18n.changeLanguage(lang.code);
                            setLangOpen(false);
                          }}
                          className={cn(
                            'flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-left font-sans text-sm transition-[background,color,transform] duration-200 hover:-translate-y-px hover:bg-surface-hover hover:text-app-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/70',
                            selected ? 'bg-primary-dim text-accent-cyan' : 'text-text-muted'
                          )}
                        >
                          <span className="text-[17px]">{lang.flag}</span>
                          <span className="min-w-0 flex-1 truncate">{lang.label}</span>
                          {selected && <Check size={15} className="text-accent-cyan" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <ThemeToggle variant="desktop" />
          <WalletButton variant="desktop" />
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-border-subtle bg-surface-glass text-app-text shadow-[0_14px_34px_-28px_var(--shadow-color)] backdrop-blur-xl transition-colors duration-200 hover:border-border-cyan hover:text-accent-cyan min-[901px]:hidden"
          aria-label={menuOpen ? closeMenuLabel : openMenuLabel}
          onClick={() => setMenuOpen(open => !open)}
        >
          {menuOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={springConfig}
            className="border-t border-border-subtle bg-surface-glass-strong px-5 pb-5 pt-2 shadow-[0_24px_70px_-44px_var(--shadow-color)] backdrop-blur-2xl min-[901px]:hidden"
          >
            <div className="mx-auto flex max-w-[1320px] flex-col gap-2">
              {navLinks.map(({ label, href, external, badge }) => (
                <a
                  key={href}
                  href={href}
                  {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl border border-transparent px-3 py-3 font-sans text-base font-semibold text-app-text no-underline transition-colors duration-200 hover:border-border-cyan hover:bg-surface-hover"
                >
                  {label}
                  {badgeEl(badge)}
                </a>
              ))}

              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border-subtle pt-4">
                {LANGUAGES.map(lang => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => {
                      i18n.changeLanguage(lang.code);
                      setMenuOpen(false);
                    }}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 font-sans text-[13px] transition-colors duration-200',
                      lang.code === i18n.language
                        ? 'border-border-cyan bg-primary-dim text-accent-cyan'
                        : 'border-border-subtle bg-surface-input text-text-muted'
                    )}
                  >
                    <span>{lang.flag}</span>
                    <span>{lang.code.toUpperCase()}</span>
                  </button>
                ))}
              </div>

              <ThemeToggle variant="mobile" />

              <WalletButton variant="mobile" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
