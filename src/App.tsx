import Background from './components/Background';
import CursorGlow from './components/CursorGlow';
import DataStream from './components/DataStream';
import Navbar from './components/Navbar';
import Ticker, { MiniStats } from './components/Ticker';
import Hero from './components/Hero';
import About from './components/About';
import CrewDatabase from './components/CrewDatabase';
import Tokenomics from './components/Tokenomics';
import CyberpsychoMeter from './components/CyberpsychoMeter';
import Roadmap from './components/Roadmap';
import HowToBuy from './components/HowToBuy';
import FAQ from './components/FAQ';
import Footer from './components/Footer';
import { useScrollReveal } from './lib/useScrollReveal';
import { useSmoothScroll } from './lib/useSmoothScroll';
import { HeroTimelineProvider } from './lib/heroTimeline';

export default function App() {
  useScrollReveal();
  useSmoothScroll();

  return (
    <HeroTimelineProvider>
    <div className="relative min-h-screen">
      <Background />
      <CursorGlow />
      <Navbar />
      {/*
        Opaque <main> sits in normal flow above the sticky footer (which uses
        z-index: -1). As the user scrolls to the end of the FAQ section, main's
        opaque background slides up and the footer is revealed from underneath —
        driven purely by natural scroll, no JavaScript.
      */}
      <main className="relative z-0 bg-cyber-darker">
        <Hero />
        <Ticker />
        <div className="mx-auto max-w-6xl px-5 py-8">
          <MiniStats />
        </div>
        <About />
        <CrewDatabase />
        <Tokenomics />
        <CyberpsychoMeter />
        <Roadmap />
        <HowToBuy />
        <FAQ />
      </main>
      <Footer />
    </div>
    </HeroTimelineProvider>
  );
}
