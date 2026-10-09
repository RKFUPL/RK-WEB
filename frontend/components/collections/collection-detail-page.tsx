'use client';

import { useEffect, useMemo, useState } from 'react';
import { CollectionHero } from '@/components/collections/collection-hero';
import { StorefrontCollectionProducts } from '@/components/collections/storefront-collection-products';
import { Footer } from '@/components/home/footer';
import { FeaturedCollection } from '@/components/home/featured-collection';
import { StickyHeader } from '@/components/home/sticky-header';
import type { CatalogProduct, CollectionHeroConfig, ManagedCollection } from '@/lib/catalog';
import type { CollectionPage } from '@/lib/home-content';
import { apiBaseUrl } from '@/lib/rbac';

type StorefrontCollection = ManagedCollection & { products: CatalogProduct[] };

export function CollectionDetailPage({ collection }: { collection: CollectionPage }) {
  const slug = collection.route.replace('/collections/', '');
  const isAakaar = slug === 'aakaar';
  const [managedCollection, setManagedCollection] = useState<StorefrontCollection | null>(null);
  const [lookbookUrls, setLookbookUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`${apiBaseUrl}/api/catalog/collections/${encodeURIComponent(slug)}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load collection.');
        return payload.collection as StorefrontCollection;
      })
      .then((payload) => { if (active) setManagedCollection(payload); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    let active = true;
    fetch(`${apiBaseUrl}/api/lookbooks`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load lookbook destinations.');
        return response.json() as Promise<{ lookbookAssetUrls?: Record<string, string> }>;
      })
      .then((payload) => { if (active) setLookbookUrls(payload.lookbookAssetUrls || {}); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const fallbackHero = useMemo<CollectionHeroConfig>(() => ({
    type: collection.hero?.type || 'image',
    image: collection.hero?.image || collection.image,
    video: collection.hero?.video || '',
    poster: collection.hero?.poster || collection.hero?.image || collection.image,
    mobileImage: collection.hero?.mobileImage || '',
    mobileVideo: collection.hero?.mobileVideo || '',
    layout: 'full_bleed',
    label: collection.hero?.label || 'The Collection',
    ctaLabel: collection.hero?.ctaLabel || 'Explore Collection',
    desktopObjectPosition: collection.hero?.desktopObjectPosition || 'center center',
    mobileObjectPosition: collection.hero?.mobileObjectPosition || collection.hero?.desktopObjectPosition || 'center center',
    textPosition: collection.hero?.textPosition || 'left',
    textTheme: collection.hero?.textTheme || 'light',
    titleScale: collection.hero?.titleScale || 'standard',
  }), [collection.hero, collection.image]);
  const configuredHeroImage = collection.hero?.image || managedCollection?.hero?.image || managedCollection?.heroImage || collection.image;
  const hero: CollectionHeroConfig = {
    ...fallbackHero,
    ...(managedCollection?.hero || {}),
    ...(collection.hero || {}),
    type: collection.hero?.type || managedCollection?.hero?.type || 'image',
    image: configuredHeroImage,
    video: collection.hero?.video || managedCollection?.hero?.video || '',
    poster: collection.hero?.poster || configuredHeroImage,
    mobileImage: collection.hero?.mobileImage || configuredHeroImage,
    mobileVideo: collection.hero?.mobileVideo || managedCollection?.hero?.mobileVideo || '',
    layout: 'full_bleed',
  };
  const displayCollection: StorefrontCollection = managedCollection ? {
    ...managedCollection,
    name: isAakaar ? 'Aakaar' : managedCollection.name,
  } : {
    id: slug,
    slug,
    name: collection.name,
    status: collection.status,
    description: collection.summary,
    heroImage: configuredHeroImage,
    hero: fallbackHero,
    productCount: 0,
    products: [],
  };
  const scrollToProducts = () => {
    document.getElementById('collection-products')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const lookbookName = managedCollection?.name || collection.name;
  const lookbookHref = Object.entries(lookbookUrls).find(([name]) => name.toLowerCase() === lookbookName.toLowerCase())?.[1] || '';
  return <main className="bg-ivory text-charcoal">
    <StickyHeader transparentAtTop transparentTheme={isAakaar ? 'light' : hero.textTheme || 'light'} />
    {isAakaar ? <FeaturedCollection
      title="AAKAAR"
      eyebrow="WELCOME TO OUR NEWEST COLLECTION OF"
      introAboveTitle
      ctaLabel="View more"
      onCtaClick={scrollToProducts}
      secondaryHref={lookbookHref || undefined}
    /> : <CollectionHero collection={displayCollection} hero={hero} titleStyle={{ fontFamily: 'RK Anamika, var(--font-display), serif' }} ctaHref={lookbookHref || undefined} />}
    <StorefrontCollectionProducts collection={displayCollection} loading={loading} />
    <Footer />
  </main>;
}
