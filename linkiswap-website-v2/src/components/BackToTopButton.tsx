import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp } from 'lucide-react';

const SHOW_AFTER_PX = 640;

export default function BackToTopButton() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const label = t('nav.backToTop', 'Back to top');

  useEffect(() => {
    const updateVisibility = () => {
      setVisible(window.scrollY > SHOW_AFTER_PX);
    };

    updateVisibility();
    window.addEventListener('scroll', updateVisibility, { passive: true });
    return () => window.removeEventListener('scroll', updateVisibility);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => setReducedMotion(mediaQuery.matches);

    updateMotionPreference();
    mediaQuery.addEventListener('change', updateMotionPreference);
    return () => mediaQuery.removeEventListener('change', updateMotionPreference);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        window.scrollTo({
          top: 0,
          behavior: reducedMotion ? 'auto' : 'smooth',
        });
      }}
      className="glass-panel fixed bottom-5 right-5 z-[70] inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-accent-cyan outline-none transition-[border-color,color,filter,transform] duration-200 hover:-translate-y-1 hover:border-border-cyan hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent-cyan/70 active:scale-[0.96] sm:bottom-6 sm:right-6 sm:h-12 sm:w-12"
    >
      <ArrowUp size={19} aria-hidden="true" />
    </button>
  );
}
