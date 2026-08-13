'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import { StorefrontCollectionProducts } from '@/components/collections/storefront-collection-products';
import type { CollectionPage } from '@/lib/home-content';
import { apiBaseUrl } from '@/lib/rbac';
import type { ManagedCollection } from '@/lib/catalog';

type CollectionDetailPageProps = {
  collection: CollectionPage;
};

const collectionEditorial: Record<string, { summary: string; next: string }> = {
  Aakaar: {
    summary: 'Aakaar establishes the house language through sculpted drape, controlled volume, and couture surfaces that move with the wearer. Its campaign balances precision with ease, allowing texture, proportion, and hand-finished detail to remain visible in every silhouette.',
    next: 'The collection story will continue with campaign chapters, construction details, and a closer view of its signature silhouettes. Each addition will preserve the collection’s original editorial rhythm.',
  },
  Anamika: {
    summary: 'Anamika explores anonymity and presence through deep tones, architectural lines, and silhouettes that reveal themselves through movement. The collection uses contrast and measured construction to create an atmosphere that feels cinematic while remaining grounded in modern occasion dressing.',
    next: 'Discover the collection alongside its dedicated editorial lookbook, where each frame expands its atmospheric visual language. New studies will connect that atmosphere to individual garments.',
  },
  Hastakala: {
    summary: 'Hastakala centres the hand of the maker, pairing refined wedding silhouettes with patient surface work and heirloom-inspired detail. Every element is considered as part of a complete composition, from the fall of the fabric to the rhythm and placement of its ornamentation.',
    next: 'The next chapter will document its embroidery, finishing, and artisan processes through close campaign studies. These details will reveal the patience behind every finished piece.',
  },
  Inaara: {
    summary: 'Inaara is a luminous occasion edit shaped by floral colour, fluid proportion, and pieces that feel celebratory without losing ease. Its visual language is bright yet composed, bringing expressive surfaces and graceful movement together for contemporary festive wardrobes.',
    next: 'Explore its campaign and lookbook as the collection grows into a fuller archive of festive dressing and movement. Future chapters will follow its colour, craft, and fluidity.',
  },
  Naqab: {
    summary: 'Naqab builds drama through veiled layers, evening depth, and a measured interplay between concealment, texture, and presence. Shadow, transparency, and structured detail shape a collection that reveals its character gradually rather than presenting every element at once.',
    next: 'Future additions will trace the collection from shadowed campaign imagery to individual studies of its layered construction. The archive will make those concealed details easier to discover.',
  },
  Sandook: {
    summary: 'Sandook draws on the idea of a treasured archive, bringing soft heirloom colour and considered craft into modern occasion dressing. The collection translates memory into wearable form through gentle palettes, balanced embellishment, and silhouettes intended to feel relevant beyond a single season.',
    next: 'Continue into the Sandook lookbook for a visual story of keepsakes, intimate celebration, and enduring silhouettes. Later chapters will deepen its conversation between memory and modernity.',
  },
};

export function CollectionDetailPage({ collection }: CollectionDetailPageProps) {
  const [managedCollection, setManagedCollection] = useState<ManagedCollection | null>(null);
  const slug = collection.route.replace('/collections/', '');
  useEffect(() => {
    if (collection.name === 'Aakaar') return;
    let active = true;
    fetch(`${apiBaseUrl}/api/catalog/collections/${encodeURIComponent(slug)}`, { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload) => { if (active && payload?.collection) setManagedCollection(payload.collection); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [collection.name, slug]);
  const editorial = collectionEditorial[collection.name] ?? {
    summary: collection.summary,
    next: `Explore more of ${collection.name} through future campaign stories and editorial details from the house.`,
  };
  const collectionFontFace = collection.fontUrl
    ? `@font-face { font-family: "${collection.fontFamily}"; src: url("${collection.fontUrl}"); font-display: swap; }`
    : '';
  const displayName = managedCollection?.name || collection.name;
  const displayStatus = managedCollection?.status === 'collection' ? 'Collection' : managedCollection?.status || collection.status;
  const displaySummary = managedCollection?.description || collection.summary;
  const displayImage = managedCollection?.heroImage || collection.image;

  return (
    <main className="bg-ivory text-charcoal">
      {collectionFontFace ? <style dangerouslySetInnerHTML={{ __html: collectionFontFace }} /> : null}
      <StickyHeader />

      <section className="mx-auto max-w-7xl px-6 pb-16 pt-28 lg:px-10 lg:pb-24 lg:pt-32">
        <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-start lg:gap-16">
          <div className="space-y-6 lg:sticky lg:top-32 lg:self-start">
            <p className="text-xs uppercase tracking-[0.38em] text-charcoal/45">{displayStatus}</p>
            <h1
              className="max-w-xl text-[clamp(3.2rem,8vw,6.6rem)] leading-[0.9] tracking-[0.05em]"
              style={{ fontFamily: `${collection.fontFamily}, var(--font-display), serif` }}
            >
              {displayName}
            </h1>
            <p className="max-w-xl text-base leading-8 text-charcoal/70 md:text-lg">
              {displaySummary}
            </p>
            <div className="flex flex-wrap gap-3 text-[0.68rem] uppercase tracking-[0.28em] text-charcoal/50">
              <span className="rounded-full border border-black/10 px-4 py-2">Editorial Preview</span>
              <span className="rounded-full border border-black/10 px-4 py-2">Luxury Womenswear</span>
            </div>
          </div>

          <div className="space-y-6">
            <div className="overflow-hidden border border-black/10 bg-white">
              <img
                src={displayImage}
                alt={displayName}
                className="h-full w-full object-cover"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="border border-black/10 bg-white px-6 py-6">
                <p className="text-[0.63rem] uppercase tracking-[0.35em] text-charcoal/40">Summary</p>
                <p className="mt-3 text-sm leading-7 text-charcoal/70">
                  {editorial.summary}
                </p>
              </div>
              <div className="border border-black/10 bg-white px-6 py-6">
                <p className="text-[0.63rem] uppercase tracking-[0.35em] text-charcoal/40">Next Step</p>
                <p className="mt-3 text-sm leading-7 text-charcoal/70">
                  {editorial.next}
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <Link
                href="/collections"
                className="inline-flex items-center gap-2 border border-black/10 px-5 py-3 text-xs uppercase tracking-[0.28em] transition hover:border-gold hover:text-gold"
              >
                Back to Collections
              </Link>
            </div>
          </div>
        </div>
      </section>

      {collection.name !== 'Aakaar' ? <StorefrontCollectionProducts slug={slug} fallbackName={displayName} /> : null}

      <Footer />
    </main>
  );
}
