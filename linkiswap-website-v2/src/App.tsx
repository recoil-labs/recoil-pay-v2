import Nav from './components/Nav';
import Hero from './components/Hero';
import Patterns from './components/Patterns';
import HowItWorks from './components/HowItWorks';
import ProductTour from './components/ProductTour';
import SolverMarketplace from './components/SolverMarketplace';
import ForDevelopers from './components/ForDevelopers';
import SupportedNetworks from './components/SupportedNetworks';
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
        <ProductTour />
        <SolverMarketplace />
        <ForDevelopers />
        <SupportedNetworks />
      </main>
      <Footer />
      <BackToTopButton />
    </>
  );
}
