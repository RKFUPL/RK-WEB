'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import { SectionShell } from '@/components/home/section-shell';
import { collectionPages } from '@/lib/home-content';

function collectionTitleStyle(name: string, fontFamily: string) {
  return {
    fontFamily: `${fontFamily}, var(--font-display), serif`,
    fontSize: name === 'Hastakala' ? 'clamp(1.65rem, 4vw, 3rem)' : undefined,
  };
}

function CampaignImage({ collection, index }: { collection: (typeof collectionPages)[number]; index: number }) {
  return (
    <Link href={collection.route} className={`group block ${index % 2 === 1 ? 'md:mt-24' : ''}`}>
      <motion.article
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.12 }}
        transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="relative overflow-hidden rounded-[3px] bg-sand">
          <img
            src={collection.image}
            alt={`${collection.name} collection campaign`}
            draggable={false}
            className="block h-auto w-full object-cover transition duration-700 ease-out group-hover:scale-[1.03]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent opacity-75 transition duration-500 group-hover:opacity-90" />
          <div className="absolute inset-x-0 bottom-0 p-5 text-white md:p-7">
            <p className="text-[0.58rem] uppercase tracking-[0.36em] text-white/65">Collection</p>
            <div className="mt-3 flex items-end justify-between gap-5">
              <h2
                style={collectionTitleStyle(collection.name, collection.fontFamily)}
                className="text-4xl leading-[0.86] tracking-[0.025em] transition-colors duration-300 group-hover:text-white md:text-5xl"
              >
                {collection.name}
              </h2>
              <span className="flex shrink-0 items-center gap-2 pb-1 text-[0.58rem] uppercase tracking-[0.28em] text-white/80 transition-transform duration-300 group-hover:translate-x-2">
                View collection <ArrowRight className="h-4 w-4" />
              </span>
            </div>
          </div>
        </div>
      </motion.article>
    </Link>
  );
}

export default function CollectionsPage() {
  const leftColumn = collectionPages.filter((_, index) => index % 2 === 0);
  const rightColumn = collectionPages.filter((_, index) => index % 2 === 1);

  return (
    <main className="bg-ivory text-charcoal">
      <StickyHeader />

      <SectionShell className="pb-24 pt-28 lg:pb-36 lg:pt-36">
        <div className="grid gap-14 lg:grid-cols-[0.34fr_0.66fr] lg:gap-16">
          <header className="space-y-7 lg:sticky lg:top-28 lg:self-start">
            <p className="text-xs uppercase tracking-[0.38em] text-charcoal/45">All Collections</p>
            <h1 className="max-w-md font-display text-6xl leading-[0.88] md:text-8xl">
              Drape yourself in the luxury of the house.
            </h1>
            <p className="max-w-sm text-sm leading-7 text-charcoal/60 md:text-base md:leading-8">
              A visual catalogue of campaign stories, considered silhouettes, and the evolving world of Rashi Kapoor.
            </p>
          </header>

          <section aria-label="All collections" className="min-w-0">
            <div className="mb-10 flex items-end justify-between border-b border-black/12 pb-5">
              <div>
                <p className="text-[0.62rem] uppercase tracking-[0.38em] text-charcoal/45">The campaign wall</p>
                <h2 className="mt-3 font-display text-4xl leading-none md:text-6xl">The collections.</h2>
              </div>
              <p className="hidden text-[0.6rem] uppercase tracking-[0.35em] text-charcoal/40 sm:block">
                {collectionPages.length} stories
              </p>
            </div>

            <div className="hidden items-start gap-6 md:grid md:grid-cols-2 lg:gap-8">
              <div className="flex min-w-0 flex-col gap-6 lg:gap-8">
                {leftColumn.map((collection, index) => <CampaignImage key={collection.name} collection={collection} index={index * 2} />)}
              </div>
              <div className="flex min-w-0 flex-col gap-6 lg:gap-8">
                {rightColumn.map((collection, index) => <CampaignImage key={collection.name} collection={collection} index={index * 2 + 1} />)}
              </div>
            </div>

            <div className="flex flex-col gap-6 md:hidden">
              {collectionPages.map((collection, index) => <CampaignImage key={collection.name} collection={collection} index={index} />)}
            </div>
          </section>
        </div>
      </SectionShell>

      <Footer />
    </main>
  );
}
