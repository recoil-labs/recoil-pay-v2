import { AnimatePresence, MotionConfig } from 'framer-motion';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Footer, Header } from './components/Chrome.tsx';
import { Close } from './sections/Close.tsx';
import { FanOut } from './sections/FanOut.tsx';
import { HexCollapse } from './sections/HexCollapse.tsx';
import { Hero } from './sections/Hero.tsx';
import { Preview } from './sections/Preview.tsx';

const loadWallet = () => import('./flow/WalletLayer.tsx');
const WalletLayer = lazy(loadWallet);
const ReservationDialog = lazy(() => import('./flow/ReservationDialog.tsx').then((m) => ({ default: m.ReservationDialog })));
const TagPage = lazy(() => import('./TagPage.tsx').then((m) => ({ default: m.TagPage })));

// Two routes, no router: the landing page and /@tag.
const handle = window.location.pathname.match(/^\/@([^/]+)\/?$/)?.[1];

export function App() {
  const [reserving, setReserving] = useState<string | null>(null);
  // Once opened, the wallet layer stays mounted so the card can animate out
  // and a connected wallet survives closing and reopening it.
  const [walletMounted, setWalletMounted] = useState(false);
  useEffect(() => {
    if (reserving) setWalletMounted(true);
  }, [reserving]);

  useEffect(() => {
    const warm = () => void Promise.all([loadWallet(), import('./flow/ReservationDialog.tsx')]).catch(() => {});
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(warm, { timeout: 4000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(warm, 2000);
    return () => clearTimeout(id);
  }, []);

  const dialog = (
    <AnimatePresence>
      {reserving && (
        <Suspense fallback={null}>
          <ReservationDialog key={reserving} tag={reserving} onClose={() => setReserving(null)} />
        </Suspense>
      )}
    </AnimatePresence>
  );

  return (
    <MotionConfig reducedMotion="user">
      <Header />
      {handle !== undefined ? (
        <Suspense fallback={<main className="min-h-[60vh]" />}>
          <WalletLayer>
            <main>
              <TagPage handle={decodeURIComponent(handle)} onReserve={setReserving} />
            </main>
            {dialog}
          </WalletLayer>
        </Suspense>
      ) : (
        <>
          <main>
            <Hero onReserve={setReserving} />
            <HexCollapse />
            <FanOut />
            <Preview />
            <Close onReserve={setReserving} />
          </main>
          {(reserving || walletMounted) && (
            <Suspense fallback={null}>
              <WalletLayer>{dialog}</WalletLayer>
            </Suspense>
          )}
        </>
      )}
      <Footer />
    </MotionConfig>
  );
}
