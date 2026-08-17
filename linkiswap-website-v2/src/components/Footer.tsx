import { useTranslation } from 'react-i18next';
import { BookOpen, Code2, ExternalLink, Radio, Send, Sparkles, type LucideIcon } from 'lucide-react';
import Logo from './Logo';

interface FooterLink {
  key: string;
  href: string;
  external: boolean;
  icon: LucideIcon;
}

const LINKS: FooterLink[] = [
  { key: 'app', href: '#', external: false, icon: Sparkles },
  { key: 'docs', href: 'https://docs.linkiswap.com/', external: true, icon: BookOpen },
  { key: 'solvers', href: '#marketplace', external: false, icon: Radio },
  { key: 'twitter', href: 'https://x.com/LinkiSwap', external: true, icon: Send },
  { key: 'github', href: '#', external: false, icon: Code2 },
];

export default function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-border-subtle bg-footer-bg px-5 py-10 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-8 py-2 min-[901px]:grid-cols-[1fr_auto] min-[901px]:items-center">
        <div className="flex flex-col gap-4">
          <div className="inline-flex w-fit rounded-2xl bg-surface-input px-5 py-4 shadow-[0_18px_60px_-54px_var(--shadow-color)]">
            <Logo height={25} />
          </div>
          <div>
            <p className="m-0 font-display text-xl font-semibold text-app-text">
              {t('footer.tagline')}
            </p>
            <p className="mt-2 max-w-[460px] font-sans text-[13px] leading-[1.6] text-text-secondary">
              {t('footer.desc', 'Cross-chain execution, solver routing, and wallet actions in one intent layer.')}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-5 min-[901px]:items-end">
          <div className="flex flex-wrap items-center gap-2">
            {LINKS.map(({ key, href, external, icon: Icon }) => (
              <a
                key={key}
                href={href}
                {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-input px-3.5 py-2 font-sans text-[13px] font-semibold text-text-secondary no-underline transition-[border-color,color,transform] duration-200 hover:-translate-y-0.5 hover:border-border-cyan hover:text-accent-cyan"
              >
                <Icon size={14} aria-hidden="true" />
                {t(`footer.links.${key}`)}
                {external && <ExternalLink size={12} aria-hidden="true" />}
              </a>
            ))}
          </div>

          <span className="font-sans text-[13px] text-text-muted">
            {t('footer.copyright')}
          </span>
        </div>
      </div>
    </footer>
  );
}
