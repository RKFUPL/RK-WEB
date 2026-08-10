import Link from 'next/link';
import { SiteFooter } from '../../components/site-footer';
import { SiteHeader } from '../../components/site-header';

export default function CulturePage() {
  return (
    <main>
      <div className="inner-header"><SiteHeader /></div>
      <section className="page-intro">
        <p className="eyebrow">Our culture</p>
        <h1>Craft is a collective practice.</h1>
        <p>We value thoughtful collaboration, a strong eye, clear ownership, and respect for the hands behind every piece.</p>
      </section>
      <section className="values-grid">
        <article><span>01</span><h2>Stay curious</h2><p>Ask better questions and remain open to unfamiliar ways of seeing.</p></article>
        <article><span>02</span><h2>Care for detail</h2><p>Small decisions shape the quality of the whole.</p></article>
        <article><span>03</span><h2>Work generously</h2><p>Share context, credit, and knowledge across disciplines.</p></article>
        <article><span>04</span><h2>Build to last</h2><p>Choose enduring standards over short-term noise.</p></article>
      </section>
      <section className="closing-callout"><Link href="/opportunities" className="outline-link">See opportunities <span>→</span></Link></section>
      <SiteFooter />
    </main>
  );
}
