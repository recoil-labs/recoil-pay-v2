import Nav from './components/Nav';
import Hero from './components/Hero';
import HowItWorks from './components/HowItWorks';
import ProductTour from './components/ProductTour';
import SolverMarketplace from './components/SolverMarketplace';
import SupportedNetworks from './components/SupportedNetworks';
import Footer from './components/Footer';
import BackToTopButton from './components/BackToTopButton';

export default function App() {
  return (
    <>
      <Nav />
      <main className="overflow-hidden bg-app-bg text-app-text">
        <Hero />
        <HowItWorks />
        <ProductTour />
        <SolverMarketplace />
        <SupportedNetworks />
      </main>
      <Footer />
      <BackToTopButton />
    </>
  );
}
