import Nav from './components/Nav';
import Hero from './components/Hero';
import Patterns from './components/Patterns';
import HowItWorks from './components/HowItWorks';
import Settlement from './components/Settlement';
import ProductTour from './components/ProductTour';
import SolverMarketplace from './components/SolverMarketplace';
import ForDevelopers from './components/ForDevelopers';
import SupportedNetworks from './components/SupportedNetworks';
import Coverage from './components/Coverage';
import FAQ from './components/FAQ';
import ClosingCTA from './components/ClosingCTA';
import Footer from './components/Footer';
import BackToTopButton from './components/BackToTopButton';

export default function App() {
  return (
    <>
      <Nav />
      <main className="overflow-hidden bg-app-bg text-app-text">
        <Hero />
        <Patterns />
        <HowItWorks />
        <Settlement />
        <ProductTour />
        <SolverMarketplace />
        <ForDevelopers />
        <SupportedNetworks />
        <Coverage />
        <FAQ />
        <ClosingCTA />
      </main>
      <Footer />
      <BackToTopButton />
    </>
  );
}
