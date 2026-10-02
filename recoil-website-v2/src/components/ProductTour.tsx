import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import LiteYouTubeEmbed from 'react-lite-youtube-embed';
import 'react-lite-youtube-embed/dist/LiteYouTubeEmbed.css';
import RevealSection from './RevealSection';
import { cn } from '@/lib/utils';

type Track = {
  key: 'send' | 'swap' | 'buy' | 'sell';
  youtubeId?: string;
  poster: string;
  sources: { src: string; type: string }[];
};

const TRACKS: Track[] = [
  {
    key: 'send',
    youtubeId: 'Bjo_z97FBR4',
    poster: '/assets/how/send.webp',
    sources: [
      { src: '/assets/how/send.webm', type: 'video/webm' },
      { src: '/assets/how/send.mp4', type: 'video/mp4' },
    ],
  },
  {
    key: 'swap',
    youtubeId: 'lqc0C5KkC48',
    poster: '/assets/how/swap.webp',
    sources: [
      { src: '/assets/how/swap.webm', type: 'video/webm' },
      { src: '/assets/how/swap.mp4', type: 'video/mp4' },
    ],
  },
  {
    key: 'buy',
    poster: '/assets/how/send.webp',
    sources: [
      { src: '/assets/how/send.webm', type: 'video/webm' },
      { src: '/assets/how/send.mp4', type: 'video/mp4' },
    ],
  },
  {
    key: 'sell',
    poster: '/assets/how/send.webp',
    sources: [
      { src: '/assets/how/send.webm', type: 'video/webm' },
      { src: '/assets/how/send.mp4', type: 'video/mp4' },
    ],
  },
];

export default function ProductTour() {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(0);
  const active = TRACKS[activeIndex];

  return (
    <section id="tour" className="section-shell">
      <div className="mx-auto max-w-[1500px]">
        <RevealSection>
          <div className="glass-panel rounded-[22px] p-6 sm:p-8 lg:p-11">
            <div className="mx-auto mb-8 max-w-[620px] text-center">
              <span className="section-eyebrow">{t('tour.label')}</span>
              <h2 className="section-heading mt-3 mb-3 text-[clamp(1.875rem,3.4vw,2.75rem)]">
                {t('tour.h2')}
              </h2>
              <p className="font-sans text-[0.96875rem] leading-relaxed text-text-secondary">
                {t('tour.subtitle')}
              </p>
            </div>

            <div className="mx-auto mb-6 grid max-w-[720px] grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              {TRACKS.map((tr, i) => {
                const isActive = i === activeIndex;
                return (
                  <button
                    key={tr.key}
                    type="button"
                    onClick={() => setActiveIndex(i)}
                    aria-pressed={isActive}
                    className={cn(
                      'min-h-11 rounded-xl border px-2 py-2.5 font-sans text-sm font-semibold transition-[background,color,border-color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/70',
                      isActive
                        ? 'border-primary bg-primary text-primary-foreground shadow-[0_8px_24px_-12px_var(--primary)]'
                        : 'border-border-subtle bg-surface-input text-app-text hover:-translate-y-px hover:border-border-cyan hover:bg-surface-hover'
                    )}
                  >
                    {t(`tour.tabs.${tr.key}.title`)}
                  </button>
                );
              })}
            </div>

            <div className="mx-auto grid max-w-[1080px] items-stretch gap-5 lg:grid-cols-2">
              <div className="media-shell overflow-hidden rounded-2xl p-2">
                {active.youtubeId ? (
                  <LiteYouTubeEmbed
                    id={active.youtubeId}
                    title={`RecoilPay ${t(`tour.tabs.${active.key}.title`)} demo`}
                    poster="maxresdefault"
                    params="rel=0"
                  />
                ) : (
                  <LazyVideo sources={active.sources} poster={active.poster} />
                )}
              </div>

              <div className="flex flex-col gap-4">
                <div className="glass-card rounded-2xl p-6 sm:p-7">
                  <div className="font-sans text-[0.6875rem] font-bold tracking-[0.14em] text-accent-cyan uppercase">
                    {t('tour.overviewLabel')}
                  </div>
                  <p className="mt-3 font-sans text-base leading-relaxed text-app-text">
                    {t(`tour.tabs.${active.key}.desc`)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </RevealSection>
      </div>
    </section>
  );
}

function LazyVideo({ sources, poster }: { sources: { src: string; type: string }[]; poster: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setLoaded(false);

    video.innerHTML = '';
    for (const { src, type } of sources) {
      const source = document.createElement('source');
      source.src = src;
      source.type = type;
      video.appendChild(source);
    }

    const onLoadedData = () => setLoaded(true);
    video.addEventListener('loadeddata', onLoadedData);

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            video.load();
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: '400px' }
    );
    observer.observe(video);

    return () => {
      video.removeEventListener('loadeddata', onLoadedData);
      observer.disconnect();
    };
  }, [sources]);

  return (
    <video
      ref={videoRef}
      poster={poster}
      controls
      muted
      playsInline
      preload="none"
      className={cn(
        'block max-h-[480px] w-full rounded-xl object-cover transition-opacity duration-700',
        loaded ? 'opacity-100' : 'opacity-0'
      )}
    />
  );
}
