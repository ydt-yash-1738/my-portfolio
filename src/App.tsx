import HeroSection from './components/HeroSection';
import BioSection from './components/BioSection';
import ContactButton from './components/ContactButton';
import Loader from './components/Loader';
import { Analytics } from '@vercel/analytics/react';
import './App.css';

export function App() {
  return (
    <>
      <Loader />
      <main id="top" className="portfolio-root">
        <HeroSection />
        <BioSection />
        <ContactButton />
      </main>
      <Analytics />
    </>
  );
}

export default App;
