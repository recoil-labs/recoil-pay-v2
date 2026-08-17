import { useTranslation } from 'react-i18next';
import { ArrowRight, BookOpen, Rocket } from 'lucide-react';
import RevealSection from './RevealSection';

export default function FinalCTA() {
  const { t } = useTranslation();

  return (
    <section className="section-shell relative overflow-hidden px-5 sm:px-8 lg:px-10">
      <div className="pointer-events-none absolute inset-0 [background:radial-gradient(ellipse_at_50%_60%,var(--primary-dim)_0%,transparent_65%)]" />
      <RevealSection className="relative">
        <div className="glass-panel mx-auto max-w-[960px] overflow-hidden rounded-[30px] px-5 py-12 text-center sm:px-10 sm:py-16">
          <span className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border-cyan bg-primary-dim px-3.5 py-2 font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-cyan">
            <Rocket size={14} aria-hidden="true" />
            {t('cta.eyebrow', 'Intent-powered finance')}
          </span>
          <h2 className="section-heading text-[clamp(38px,5.4vw,72px)] leading-[1.02] tracking-normal">
            {t('cta.h2Line1')}
            <span className="mt-2 block bg-[image:var(--gradient-text)] bg-clip-text text-transparent [-webkit-text-fill-color:transparent]">
              {t('cta.h2Line2')}
            </span>
          </h2>
          <p className="mx-auto mt-7 max-w-[560px] text-[17px] leading-[1.7] text-text-secondary">
            {t('cta.desc')}
          </p>

          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <a
              href="#"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-btn-primary-bg bg-btn-primary-bg px-6 py-3.5 font-sans text-[15px] font-semibold text-btn-primary-text no-underline outline-none transition-[filter,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:brightness-[1.08] hover:shadow-[0_0_28px_var(--primary-dim)] focus-visible:ring-2 focus-visible:ring-accent-cyan/70"
            >
              {t('cta.launchApp')}
              <ArrowRight size={17} aria-hidden="true" />
            </a>
            <a
              href="https://docs.linkiswap.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border-subtle bg-surface-input px-6 py-3.5 font-sans text-[15px] font-semibold text-app-text no-underline outline-none transition-[border-color,color,transform] duration-200 hover:-translate-y-0.5 hover:border-border-cyan hover:text-accent-cyan focus-visible:ring-2 focus-visible:ring-accent-cyan/70"
            >
              <BookOpen size={17} aria-hidden="true" />
              {t('cta.docs')}
            </a>
          </div>
        </div>
      </RevealSection>
    </section>
  );
}
