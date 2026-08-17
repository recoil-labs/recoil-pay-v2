import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import RevealSection from './RevealSection';
import { useSubscribe } from '../hooks/useSubscribe';
import {
  fetchLatestPosts,
  formatRelativeDate,
  isGhostConfigured,
  pickDisplayTag,
  type GhostPost,
} from '../lib/ghost';

const BLOG_HOME = (import.meta.env.VITE_GHOST_API_URL as string | undefined) ?? 'https://blog.linkiswap.com';

const cardContainerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.12, delayChildren: 0.08 } },
};
const cardItemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

export default function BlogSection() {
  const { t } = useTranslation();

  const { data: posts, isLoading, isError } = useQuery({
    queryKey: ['ghost-latest-posts', 3],
    queryFn: () => fetchLatestPosts(3),
    staleTime: 5 * 60_000,
    enabled: isGhostConfigured(),
  });

  if (!isGhostConfigured()) return null;

  return (
    <section id="blog" className="section-shell">
      <div className="mx-auto max-w-[1200px]">
        <RevealSection>
          <div className="mb-10 text-center sm:mb-12">
            <span className="section-eyebrow">{t('blog.label')}</span>
            <h2 className="section-heading mx-auto mt-4 max-w-[680px] text-[clamp(30px,3.4vw,46px)]">
              {t('blog.h2')}
            </h2>
            <p className="mx-auto mt-3 max-w-[560px] font-sans text-base leading-relaxed text-text-secondary">
              {t('blog.subtitle')}
            </p>
          </div>
        </RevealSection>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[0, 1, 2].map(i => <BlogCardSkeleton key={i} />)}
          </div>
        ) : isError || !posts || posts.length === 0 ? (
          <ComingSoonCard />
        ) : (
          <motion.div
            variants={cardContainerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            className="grid grid-cols-1 gap-4 md:grid-cols-3"
          >
            {posts.map(post => (
              <motion.div key={post.id} variants={cardItemVariants}>
                <BlogCard post={post} />
              </motion.div>
            ))}
          </motion.div>
        )}

        <div className="mt-10 flex justify-center">
          <a
            href={BLOG_HOME}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-lg border border-primary/70 bg-primary-dim px-5 py-2.5 font-sans text-sm font-semibold text-app-text no-underline transition duration-200 hover:-translate-y-0.5 hover:border-accent-cyan hover:bg-surface-input hover:text-accent-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {t('blog.viewMore')}
          </a>
        </div>

        <NewsletterBlock />
      </div>
    </section>
  );
}

function BlogCard({ post }: { post: GhostPost }) {
  const { t } = useTranslation();
  const excerpt = (post.custom_excerpt ?? post.excerpt ?? '').replace(/\s+/g, ' ').trim();
  const tag = pickDisplayTag(post.tags) ?? 'Insights';
  const author = post.authors?.[0]?.name ?? 'Linkiswap Team';

  return (
    <motion.a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      whileHover={{
        y: -12,
        scale: 1.02,
        boxShadow: '0 28px 100px -70px var(--primary), 0 0 34px var(--accent-cyan-soft)',
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className="glass-card group flex h-full flex-col overflow-hidden rounded-2xl text-inherit no-underline transition-colors duration-300 hover:border-accent-cyan/55"
    >
      <div className="media-shell h-[180px] overflow-hidden border-x-0 border-t-0 bg-surface-alt">
        {post.feature_image && (
          <img
            src={post.feature_image}
            alt={post.feature_image_alt ?? post.title}
            loading="lazy"
            decoding="async"
            className="block size-full object-cover transition duration-500 group-hover:scale-[1.04]"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3.5 p-5 sm:p-[22px]">
        <div className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
          {formatRelativeDate(post.published_at)}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full border border-border-cyan/70 bg-primary-dim px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-accent-cyan">
            {t('blog.byAuthor', { author, defaultValue: 'By {{author}}' })}
          </span>
          <span className="inline-flex items-center rounded-full border border-border-subtle bg-surface-input px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{tag}</span>
        </div>
        <h3 className="line-clamp-2 m-0 font-display text-[19px] font-semibold leading-[1.35] text-app-text transition-colors duration-200 group-hover:text-accent-cyan">
          {post.title}
        </h3>
        <p className="line-clamp-3 m-0 min-h-[72px] font-sans text-[13.5px] leading-relaxed text-text-secondary">
          {excerpt || t('blog.fallbackExcerpt', 'Explore the full article for details on this update.')}
        </p>
        <span className="mt-auto font-sans text-sm font-semibold text-primary-soft transition-colors duration-200 group-hover:text-accent-cyan">
          {t('blog.readMore', 'Read More ->')}
        </span>
      </div>
    </motion.a>
  );
}

function BlogCardSkeleton() {
  return (
    <div className="glass-card flex flex-col overflow-hidden rounded-2xl opacity-65">
      <div className="skeleton-shimmer h-[180px]" />
      <div className="flex flex-col gap-3 p-5 sm:p-[22px]">
        <div className="skeleton-shimmer h-3 w-[35%] rounded" />
        <div className="skeleton-shimmer h-5 w-[90%] rounded" />
        <div className="skeleton-shimmer h-3 w-[95%] rounded" />
        <div className="skeleton-shimmer h-3 w-[70%] rounded" />
      </div>
    </div>
  );
}

function ComingSoonCard() {
  const { t } = useTranslation();
  return (
    <article className="glass-card flex flex-col gap-3.5 rounded-2xl p-6 sm:p-8">
      <h3 className="m-0 font-display text-2xl font-semibold text-app-text">
        {t('blog.comingSoonH3')}
      </h3>
      <p className="m-0 max-w-2xl font-sans text-[15px] leading-relaxed text-text-secondary">
        {t('blog.comingSoonDesc')}
      </p>
    </article>
  );
}

function NewsletterBlock() {
  const { t } = useTranslation();
  const { email, message, messageType, loading, handleChange, handleSubscribe } = useSubscribe();

  return (
    <div className="glass-panel mt-14 grid items-center gap-6 rounded-2xl bg-primary-dim p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:gap-7">
      <p className="m-0 max-w-[540px] font-display text-[clamp(18px,2vw,22px)] font-semibold leading-[1.3] text-app-text">
        {t('blog.newsletterHeading')}
      </p>

      <div className="flex min-w-0 flex-col gap-2 lg:min-w-[320px]">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            value={email}
            onChange={e => handleChange(e.target.value)}
            placeholder={t('blog.newsletterPlaceholder')}
            disabled={loading}
            className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface-input px-3.5 py-2.5 font-sans text-sm text-app-text outline-none placeholder:text-text-muted focus:border-accent-cyan focus:ring-2 focus:ring-accent-cyan/20 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleSubscribe}
            disabled={loading}
            className="rounded-lg border border-primary bg-primary px-[18px] py-2.5 font-sans text-sm font-semibold whitespace-nowrap text-primary-foreground transition duration-200 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-default disabled:border-text-muted disabled:bg-text-muted disabled:text-background disabled:hover:brightness-100"
          >
            {loading ? t('blog.newsletterSubmitting') : t('blog.newsletterCta')}
          </button>
        </div>
        {message && (
          <div className={`font-mono text-[11px] font-semibold ${messageType === 'success' ? 'text-accent-cyan' : 'text-red'}`}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
