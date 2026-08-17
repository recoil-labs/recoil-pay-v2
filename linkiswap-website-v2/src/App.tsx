import Nav from './components/Nav';
import Hero from './components/Hero';
import Stats from './components/Stats';
import TrustStrip from './components/TrustStrip';
import Problem from './components/Problem';
import Solution from './components/Solution';
import HowItWorks from './components/HowItWorks';
import ProductTour from './components/ProductTour';
import SolverMarketplace from './components/SolverMarketplace';
import Features from './components/Features';
import SupportedNetworks from './components/SupportedNetworks';
import LivePrices from './components/LivePrices';
import Vision from './components/Vision';
import BlogSection from './components/BlogSection';
import Roadmap from './components/Roadmap';
import FinalCTA from './components/FinalCTA';
import Footer from './components/Footer';
import BackToTopButton from './components/BackToTopButton';

export default function App() {
  return (
    <>
      <Nav />
      <main className="overflow-hidden bg-app-bg text-app-text">
        <Hero />
        <Stats />
        <TrustStrip />
        <Problem />
        <Solution />
        <HowItWorks />
        <ProductTour />
        <SolverMarketplace />
        <Features />
        <SupportedNetworks />
        <LivePrices />
        <Vision />
        <BlogSection />
        <Roadmap />
        <FinalCTA />
      </main>
      <Footer />
      <BackToTopButton />
    </>
  );
}
