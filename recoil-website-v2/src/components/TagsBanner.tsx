import { useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TAGS_URL } from '@/lib/links';

/* ── tags launch strip ─────────────────────────────────────────────────────
   A slim line above the nav for the Tags reservation window. It sits in
   normal flow, so it scrolls away while the sticky nav stays put. It says
   "reserve", never "send": sending to a tag isn't live yet. Dismissal is
   remembered per browser; bump the key to show a new announcement. */

const DISMISS_KEY = 'recoilpay:banner:tags-launch:dismissed';

const wasDismissed = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
};

export default function TagsBanner() {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(wasDismissed);
  if (hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Storage blocked: it just comes back next visit.
    }
  };

  return (
    <div className="relative border-b border-border-subtle bg-primary-dim">
      <div className="mx-auto flex max-w-[1320px] items-center justify-center gap-3 px-12 py-2 text-center font-sans text-[13px] text-text-secondary">
        <span className="shrink-0 rounded-full border border-border-cyan px-2 py-0.5 font-mono text-[10px] uppercase text-primary">
          {t('tagsBanner.new', 'New')}
        </span>
        <span className="min-w-0">
          <span className="text-app-text">{t('tagsBanner.title', 'Your wallet can have a name.')}</span>{' '}
          <span className="hidden sm:inline">{t('tagsBanner.body', 'Reserve your @tag before someone else does.')}</span>{' '}
          <a
            href={TAGS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-primary no-underline hover:underline"
          >
            {t('tagsBanner.cta', 'Reserve yours')}
            <ArrowRight size={13} aria-hidden="true" />
          </a>
        </span>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('tagsBanner.dismiss', 'Dismiss announcement')}
        className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-hover hover:text-app-text"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
