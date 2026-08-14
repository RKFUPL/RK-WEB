'use client';

import { useEffect, useMemo, useState } from 'react';
import { CollectionHero } from '@/components/collections/collection-hero';
import { StorefrontCollectionProducts } from '@/components/collections/storefront-collection-products';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import type { CatalogProduct, CollectionHeroConfig, ManagedCollection } from '@/lib/catalog';
import type { CollectionPage } from '@/lib/home-content';
import { apiBaseUrl } from '@/lib/rbac';

type StorefrontCollection = ManagedCollection & { products: CatalogProduct[] };

export function CollectionDetailPage({ collection }: { collection: CollectionPage }) {
  const slug = collection.route.replace('/collections/', '');
  const [managedCollection, setManagedCollection] = useState<StorefrontCollection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`${apiBaseUrl}/api/catalog/collections/${encodeURIComponent(slug)}`, { cache: 'no-store' })
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
  const configuredHeroImage = collection.hero?.image || collection.image;
  const hero: CollectionHeroConfig = {
    ...fallbackHero,
    ...(managedCollection?.hero || {}),
    ...(collection.hero || {}),
    type: collection.hero?.type || managedCollection?.hero?.type || 'image',
    image: configuredHeroImage,
    video: collection.hero?.video || '',
    poster: collection.hero?.poster || configuredHeroImage,
    mobileImage: collection.hero?.mobileImage || '',
    mobileVideo: collection.hero?.mobileVideo || '',
    layout: 'full_bleed',
  };
  const displayCollection: StorefrontCollection = managedCollection || {
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
  return <main className="bg-ivory text-charcoal">
    <StickyHeader transparentAtTop transparentTheme={hero.textTheme || 'light'} />
    <CollectionHero collection={displayCollection} hero={hero} titleStyle={{ fontFamily: `${collection.fontFamily}, var(--font-display), serif` }} />
    <StorefrontCollectionProducts collection={displayCollection} loading={loading} />
    <Footer />
  </main>;
}
