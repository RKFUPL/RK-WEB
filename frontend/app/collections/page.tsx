'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import { SectionShell } from '@/components/home/section-shell';
import { collectionGalleryPages } from '@/lib/home-content';

function collectionTitleStyle() {
  return {
    fontFamily: 'RK Anamika, var(--font-display), serif',
  };
}

function CampaignImage({ collection }: { collection: (typeof collectionGalleryPages)[number] }) {
  const cardClassName = collection.name === 'Naqab' ? 'collections-gallery-card--after-hastakala' : '';
  const content = (
      <motion.article
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.12 }}
        transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="collections-campaign-image relative aspect-[3/4] overflow-hidden rounded-[14px] bg-sand">
          <img
            src={collection.image}
            alt={`${collection.name} collection campaign`}
            draggable={false}
            className={`collection-card-image block h-full w-full object-cover ${collection.comingSoon ? 'object-[center_32%]' : ''}`}
          />
          <div className="collections-campaign-shade absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-90 transition-opacity duration-300 group-hover:opacity-100" />
          {collection.comingSoon ? <div className="absolute inset-0 grid place-items-center bg-black/10"><span className="px-5 py-3 text-[0.58rem] uppercase tracking-[0.42em] text-white/90 drop-shadow-[0_1px_12px_rgba(0,0,0,.65)] backdrop-blur-[1px]">Coming soon</span></div> : null}
          <div className="collections-campaign-overlay absolute inset-x-0 bottom-0 w-full box-border p-5 text-white md:p-7">
            <p className="text-[0.58rem] uppercase tracking-[0.32em] text-white/75">Collection</p>
            <div className="mt-2 flex min-w-0 flex-wrap items-end justify-between gap-x-5 gap-y-2">
              <h2
                style={collectionTitleStyle()}
                className="collections-landing-card-title min-w-0 max-w-[85%] break-words text-4xl leading-[0.86] tracking-[0.025em] transition-colors duration-300 group-hover:text-white md:text-5xl"
              >
                {collection.name}
              </h2>
              <span className="collections-landing-card-cta flex min-w-0 max-w-full shrink items-center gap-2 break-words pb-1 text-[0.58rem] uppercase tracking-[0.24em] text-white/85">
                {collection.comingSoon ? 'Coming soon' : <>View collection <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-2" /></>}
              </span>
            </div>
          </div>
        </div>
      </motion.article>
  );
  return collection.comingSoon
    ? <div id="aakaar-coming-soon" className={`collections-gallery-card group block ${cardClassName}`}>{content}</div>
    : <Link href={collection.route} className={`collections-gallery-card group block ${cardClassName}`}>{content}</Link>;
}

export default function CollectionsPage() {
  const leftColumn = collectionGalleryPages.filter((_, index) => index % 2 === 0);
  const rightColumn = collectionGalleryPages.filter((_, index) => index % 2 === 1);

  return (
    <main className="collections-page bg-ivory text-charcoal">
      <StickyHeader />

      <section className="collections-gallery-scene">
        <img
          src="https://res.cloudinary.com/fm1bwbrd/image/upload/v1785921051/7438eb66-a217-4bdd-9227-92112a02fc5c_hds45c.png"
          alt=""
          aria-hidden="true"
          className="collections-gallery-backdrop collections-gallery-backdrop-light"
        />
        <img
          src="https://res.cloudinary.com/fm1bwbrd/image/upload/v1785920821/download_trvdb5.png"
          alt=""
          aria-hidden="true"
          className="collections-gallery-backdrop collections-gallery-backdrop-dark"
        />

        <div className="relative z-10">
          <SectionShell className="collections-landing-shell pb-20 pt-20 lg:pb-28 lg:pt-24">
            <div className="grid gap-12 lg:grid-cols-[0.32fr_0.68fr] lg:gap-16">
          <header className="space-y-6 lg:sticky lg:top-28 lg:self-start">
            <p className="text-[0.65rem] uppercase tracking-[0.3em] text-charcoal/60">All collections</p>
            <h1 className="max-w-sm font-display text-6xl leading-[0.88] md:text-8xl">
              Drape yourself in the luxury of the house.
            </h1>
            <span className="block h-px w-14 bg-gold" />
            <p className="max-w-sm text-sm leading-7 text-charcoal/65 md:text-base md:leading-8">
              A curated expression of our design philosophy. Each collection is a story woven in fabric, texture and craftsmanship, with its own palette, proportion, and distinct editorial point of view.
            </p>
          </header>

          <section aria-label="All collections" className="min-w-0">
            <div className="collections-gallery-grid hidden items-start md:grid md:grid-cols-2">
              <div className="collections-gallery-column collections-gallery-column--left">
                {leftColumn.map((collection) => (
                  <CampaignImage key={collection.name} collection={collection} />
                ))}
              </div>
              <div className="collections-gallery-column collections-gallery-column--staggered">
                {rightColumn.map((collection) => (
                  <CampaignImage key={collection.name} collection={collection} />
                ))}
              </div>
            </div>

            <div className="collections-gallery-column md:hidden">
              {collectionGalleryPages.map((collection) => (
                <CampaignImage key={collection.name} collection={collection} />
              ))}
            </div>
          </section>
            </div>
          </SectionShell>
        </div>
      </section>

      <Footer />
    </main>
  );
}
