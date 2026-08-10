import Link from 'next/link';
import { SiteFooter } from '../components/site-footer';
import { SiteHeader } from '../components/site-header';

export default function CareersHome() {
  return (
    <main>
      <section className="hero">
        <SiteHeader />
        <div className="hero-copy">
          <p className="eyebrow">Careers at Rashi Kapoor</p>
          <h1>Shape what<br />comes next.</h1>
          <p className="hero-intro">Join a fashion house where craft, curiosity, and quiet ambition come together.</p>
          <Link href="/opportunities" className="text-link">View opportunities <span>→</span></Link>
        </div>
        <p className="hero-note">Kolkata · Mumbai · India</p>
      </section>

      <section className="manifesto">
        <p className="eyebrow">The house in motion</p>
        <h2>We build with patience.<br />We create with purpose.</h2>
        <div className="manifesto-grid">
          <p>Our work moves between atelier discipline and contemporary imagination. Every role contributes to a shared standard of detail, care, and originality.</p>
          <p>We welcome thoughtful people across design, production, retail, operations, and digital storytelling—people who want to grow while building something enduring.</p>
        </div>
      </section>

      <section className="pathways">
        <article><span>01</span><h3>Design &amp; Atelier</h3><p>Concept, surface development, pattern, drape, and finishing.</p></article>
        <article><span>02</span><h3>Brand &amp; Digital</h3><p>Campaigns, content, e-commerce, and visual communication.</p></article>
        <article><span>03</span><h3>Retail &amp; Experience</h3><p>Private client service and considered in-store experiences.</p></article>
      </section>

      <section className="closing-callout">
        <p className="eyebrow">Find your place</p>
        <h2>Bring your point of view.</h2>
        <Link href="/opportunities" className="outline-link">Explore open roles <span>→</span></Link>
      </section>
      <SiteFooter />
    </main>
  );
}
