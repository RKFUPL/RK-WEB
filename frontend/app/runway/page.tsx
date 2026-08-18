import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Footer } from '@/components/home/footer';
import { SectionShell } from '@/components/home/section-shell';
import { StickyHeader } from '@/components/home/sticky-header';
import { runwayCollections } from '@/lib/home-content';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Runway', 'Discover the Rashi Kapoor runway archive, beginning with Espiritu Libre.', '/runway');

export default function RunwayPage() {
  return (
    <main className="min-h-screen bg-ivory text-charcoal">
      <StickyHeader />
      <SectionShell className="pb-24 pt-36 lg:pb-32 lg:pt-44">
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-[0.62rem] uppercase tracking-[0.48em] text-gold">Runway</p>
          <h1 className="mt-6 font-display text-7xl leading-[0.84] md:text-9xl">Coming Soon</h1>
          <div className="mx-auto mt-8 h-px w-16 bg-gold/70" />
          <p className="mx-auto mt-8 max-w-xl text-sm leading-7 text-charcoal/58 md:text-base md:leading-8">An evolving archive of runway stories from the house of Rashi Kapoor.</p>
        </header>

        <section aria-label="Runway collections" className="mx-auto mt-20 max-w-6xl md:mt-28">
          {runwayCollections.map((collection, index) => (
            <Link key={collection.name} href={collection.editorialHref} className="group grid overflow-hidden border border-gold/25 bg-[#0b0a08] text-[#f4ede2] md:grid-cols-[1.2fr_0.8fr]">
              <div className="relative min-h-[30rem] overflow-hidden md:min-h-[42rem]">
                <img src={collection.image} alt={`${collection.name} runway collection`} className="absolute inset-0 h-full w-full object-cover transition duration-1000 ease-out group-hover:scale-[1.025]" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
              </div>
              <div className="flex min-h-[24rem] flex-col justify-between border-t border-gold/20 p-8 md:min-h-0 md:border-l md:border-t-0 md:p-12 lg:p-16">
                <div>
                  <p className="text-[0.58rem] uppercase tracking-[0.4em] text-gold/80">Runway / {String(index + 1).padStart(2, '0')}</p>
                  <h2 className="mt-7 font-display text-5xl leading-[0.88] md:text-7xl">{collection.name}</h2>
                  <p className="mt-8 max-w-sm text-sm leading-7 text-[#f4ede2]/58">{collection.description}</p>
                </div>
                <span className="mt-12 inline-flex items-center gap-4 text-[0.62rem] uppercase tracking-[0.32em] text-gold transition group-hover:text-[#f4ede2]">Enter the editorial <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-2" /></span>
              </div>
            </Link>
          ))}
        </section>
      </SectionShell>
      <Footer />
    </main>
  );
}
