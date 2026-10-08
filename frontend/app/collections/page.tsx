'use client';

import Link from 'next/link';
import { ArrowRight, Image as ImageIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Footer } from '@/components/home/footer';
import { ExclusiveRunway } from '@/components/home/exclusive-runway';
import { StickyHeader } from '@/components/home/sticky-header';
import { SectionShell } from '@/components/home/section-shell';
import type { ManagedCollection } from '@/lib/catalog';
import { collectionGalleryPages } from '@/lib/home-content';
import { apiBaseUrl } from '@/lib/rbac';
import { cloudinaryImageUrl } from '@/lib/utils';

type CollectionIndexResponse = { collections: ManagedCollection[]; count: number };
type CollectionCard = ManagedCollection & { image: string; summary?: string; fontFamily?: string };

function editorialFor(collection: ManagedCollection) {
  return collectionGalleryPages.find((item) => {
    const editorialSlug = item.route.replace(/^\/collections\//, '');
    return editorialSlug === collection.slug || item.name.toLowerCase() === collection.name.toLowerCase();
  });
}

function CollectionCampaignCard({ collection }: { collection: CollectionCard }) {
  return <Link href={`/collections/${collection.slug}`} className="collections-gallery-card group block">
    <motion.article initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.12 }} transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}>
      <div className="collections-campaign-image relative aspect-[3/4] overflow-hidden rounded-[14px] bg-sand">
        {collection.image ? <img src={cloudinaryImageUrl(collection.image, 1000) || collection.image} alt={`${collection.name} collection campaign`} draggable={false} className="collection-card-image block h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-charcoal/35"><span className="text-center"><ImageIcon className="mx-auto h-7 w-7" strokeWidth={1.2} /><span className="mt-3 block text-[0.56rem] uppercase tracking-[0.28em]">Campaign image coming soon</span></span></div>}
        <div className="collections-campaign-shade absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-90 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="collections-campaign-overlay absolute inset-x-0 bottom-0 w-full box-border p-5 text-white md:p-7">
          <p className="text-[0.58rem] uppercase tracking-[0.32em] text-white/75">{collection.productCount} {collection.productCount === 1 ? 'piece' : 'pieces'}</p>
          <div className="mt-2 flex min-w-0 flex-wrap items-end justify-between gap-x-5 gap-y-2">
            <h2 style={{ fontFamily: collection.fontFamily ? `${collection.fontFamily}, var(--font-display), serif` : undefined }} className="collections-landing-card-title min-w-0 max-w-[85%] break-words font-display text-4xl leading-[0.86] tracking-[0.025em] transition-colors duration-300 group-hover:text-white md:text-5xl">{collection.name}</h2>
            <span className="collections-landing-card-cta flex min-w-0 max-w-full shrink items-center gap-2 break-words pb-1 text-[0.58rem] uppercase tracking-[0.24em] text-white/85">View collection <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-2" /></span>
          </div>
          {collection.summary ? <p className="mt-3 line-clamp-2 max-w-xl text-xs leading-5 text-white/72">{collection.summary}</p> : null}
        </div>
      </div>
    </motion.article>
  </Link>;
}

export default function CollectionsPage() {
  const [collections, setCollections] = useState<ManagedCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch(`${apiBaseUrl}/api/catalog/collections`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load collections.');
        return payload as CollectionIndexResponse;
      })
      .then((payload) => { if (active) setCollections(payload.collections || []); })
      .catch((value) => { if (active) setError(value instanceof Error ? value.message : 'Unable to load collections.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const cards = useMemo<CollectionCard[]>(() => collections.map((collection) => {
    const editorial = editorialFor(collection);
    return {
      ...collection,
      image: collection.hero?.image || collection.heroImage || editorial?.hero?.image || editorial?.image || '',
      summary: collection.description || editorial?.summary,
      fontFamily: editorial?.fontFamily,
    };
  }), [collections]);
  const leftColumn = cards.filter((_, index) => index % 2 === 0);
  const rightColumn = cards.filter((_, index) => index % 2 === 1);

  return <main className="collections-page bg-ivory text-charcoal">
    <StickyHeader />
    <section className="collections-gallery-scene">
      <img src="https://res.cloudinary.com/fm1bwbrd/image/upload/v1785921051/7438eb66-a217-4bdd-9227-92112a02fc5c_hds45c.png" alt="" aria-hidden="true" className="collections-gallery-backdrop collections-gallery-backdrop-light" />
      <img src="https://res.cloudinary.com/fm1bwbrd/image/upload/v1785920821/download_trvdb5.png" alt="" aria-hidden="true" className="collections-gallery-backdrop collections-gallery-backdrop-dark" />
      <div className="relative z-10">
        <SectionShell className="collections-landing-shell pb-20 pt-20 lg:pb-28 lg:pt-24">
          <div className="grid gap-12 lg:grid-cols-[0.32fr_0.68fr] lg:gap-16">
            <header className="space-y-6 lg:sticky lg:top-28 lg:self-start">
              <p className="text-[0.65rem] uppercase tracking-[0.3em] text-charcoal/60">Shop by collection</p>
              <h1 className="max-w-sm font-display text-6xl leading-[0.88] md:text-8xl">Drape yourself in the luxury of the <span className="whitespace-nowrap">house.</span></h1>
              <span className="block h-px w-14 bg-gold" />
              <p className="max-w-sm text-sm leading-7 text-charcoal/65 md:text-base md:leading-8">A curated expression of our design philosophy. Each collection is a story woven in fabric, texture and craftsmanship, with its own palette, proportion, and distinct editorial point of view.</p>
              <ExclusiveRunway />
            </header>
            <section aria-label="Available collections" className="min-w-0">
              {loading ? <div className="grid gap-6 md:grid-cols-2"><div className="aspect-[3/4] animate-pulse rounded-[14px] bg-sand" /><div className="aspect-[3/4] animate-pulse rounded-[14px] bg-sand md:mt-20" /></div> : error ? <div className="border border-black/10 p-10 text-center"><p className="font-display text-3xl">Collections are temporarily unavailable.</p><p className="mt-3 text-sm text-charcoal/60">{error}</p></div> : cards.length ? <>
                <div className="collections-gallery-grid hidden items-start md:grid md:grid-cols-2"><div className="collections-gallery-column collections-gallery-column--left">{leftColumn.map((collection) => <CollectionCampaignCard key={collection.id} collection={collection} />)}</div><div className="collections-gallery-column collections-gallery-column--staggered">{rightColumn.map((collection) => <CollectionCampaignCard key={collection.id} collection={collection} />)}</div></div>
                <div className="collections-gallery-column md:hidden">{cards.map((collection) => <CollectionCampaignCard key={collection.id} collection={collection} />)}</div>
              </> : <div className="border border-black/10 p-10 text-center"><p className="font-display text-3xl">No collections are available yet.</p></div>}
            </section>
          </div>
        </SectionShell>
      </div>
    </section>
    <Footer />
  </main>;
}
