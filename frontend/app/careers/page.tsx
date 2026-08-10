import Link from 'next/link';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';

export default function CareersPage() {
  return (
    <main className="careers-page">
      <StickyHeader />
      <section className="careers-page-hero">
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.38em] text-gold">Careers at Rashi Kapoor</p>
          <h1 className="mt-8 max-w-3xl font-display text-[clamp(4rem,9vw,8.5rem)] leading-[0.82] tracking-[-0.06em] text-ivory">
            Shape what<br />comes next.
          </h1>
          <p className="mt-8 max-w-md text-sm leading-7 text-ivory/72">
            Join a fashion house where craft, curiosity, and quiet ambition come together.
          </p>
          <Link href="#opportunities" className="mt-9 inline-flex items-center gap-5 border-b border-gold pb-3 text-[0.65rem] uppercase tracking-[0.3em] text-ivory transition hover:text-gold">
            View opportunities <span className="text-base">→</span>
          </Link>
        </div>
        <p className="absolute bottom-10 right-8 text-[0.58rem] uppercase tracking-[0.3em] text-ivory/65">Kolkata · Mumbai · India</p>
      </section>

      <section className="careers-page-intro">
        <p className="text-[0.65rem] uppercase tracking-[0.38em] text-gold">The house in motion</p>
        <h2 className="mt-7 max-w-4xl font-display text-[clamp(3rem,6vw,6rem)] leading-[0.92] tracking-[-0.05em] text-charcoal">
          We build with patience.<br />We create with purpose.
        </h2>
        <div className="mt-12 grid max-w-4xl gap-8 text-sm leading-7 text-charcoal/68 md:grid-cols-2 md:ml-auto">
          <p>Our work moves between atelier discipline and contemporary imagination. Every role contributes to a shared standard of detail, care, and originality.</p>
          <p>We welcome thoughtful people across design, production, retail, operations, and digital storytelling.</p>
        </div>
      </section>

      <section id="opportunities" className="careers-opportunities">
        <div><span>01</span><h2>Design &amp; Atelier</h2><p>Concept, surface development, pattern, drape, and finishing.</p></div>
        <div><span>02</span><h2>Brand &amp; Digital</h2><p>Campaigns, content, e-commerce, and visual communication.</p></div>
        <div><span>03</span><h2>Retail &amp; Experience</h2><p>Private client service and considered in-store experiences.</p></div>
      </section>

      <section className="careers-page-contact">
        <p className="text-[0.65rem] uppercase tracking-[0.38em] text-gold">Find your place</p>
        <h2 className="mt-5 font-display text-5xl tracking-[-0.04em] text-charcoal md:text-7xl">Bring your point of view.</h2>
        <a href="mailto:careers@rashikapoor.com" className="mt-8 inline-flex border border-gold px-5 py-3 text-[0.65rem] uppercase tracking-[0.28em] text-charcoal transition hover:bg-gold hover:text-ink">Introduce yourself →</a>
      </section>
      <Footer />
    </main>
  );
}
