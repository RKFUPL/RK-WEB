'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CollectionProductCard } from '@/components/collections/collection-product-card';
import type { CatalogProduct } from '@/lib/catalog';
import { apiBaseUrl } from '@/lib/rbac';
import { runwayCollectionApiPath, runwayProductHref, type StorefrontRunwayCollection } from '@/lib/runway';

export function RunwayCollectionSection() {
  const [collection, setCollection] = useState<StorefrontRunwayCollection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`${apiBaseUrl}${runwayCollectionApiPath}?limit=3`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load the runway collection.');
        return payload.collection as StorefrontRunwayCollection;
      })
      .then((payload) => { if (active) setCollection(payload); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const featuredProducts = (collection?.products || []).filter((product) => product.media?.[0]).slice(0, 3);
  const skeletonProducts: CatalogProduct[] = Array.from({ length: 3 }, (_, index) => ({
    id: `runway-skeleton-${index}`,
    availability: 'in_stock',
    currency: 'INR',
    media: [],
    attributes: {},
  }));

  return (
    <section className="runway-collection-preview border-t border-black/10 bg-ivory text-charcoal dark:border-white/10">
      <div className="mx-auto w-full max-w-[100rem] px-6 py-16 sm:px-8 sm:py-20 lg:px-12 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[minmax(15rem,0.85fr)_minmax(0,2.7fr)_auto] lg:items-end lg:gap-8">
          <div className="max-w-md">
            <p className="text-[0.58rem] uppercase tracking-[0.38em] text-gold">Our exclusive runway collection</p>
            <h2 className="mt-5 font-display text-[clamp(2.8rem,5vw,5.6rem)] leading-[0.88] tracking-[-0.035em]">
              Explore our exclusive<br />Lakme runway collection.
            </h2>
            {collection?.description ? <p className="mt-6 max-w-sm text-sm leading-7 text-charcoal/60">{collection.description}</p> : null}
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {(loading ? skeletonProducts : featuredProducts).map((product) => (
              <div key={product.id} className={loading ? 'animate-pulse' : undefined}>
                {loading ? (
                  <div className="aspect-[3/4] rounded-[14px] bg-sand" aria-hidden="true" />
                ) : (
                  <CollectionProductCard product={product} href={runwayProductHref(product)} />
                )}
              </div>
            ))}
          </div>

          <Link href="/collections/lakme" className="inline-flex items-center gap-3 justify-self-start border-b border-charcoal/35 pb-2 text-[0.6rem] uppercase tracking-[0.28em] transition hover:border-gold hover:text-gold lg:justify-self-end">
            View all <ArrowRight size={15} strokeWidth={1.4} />
          </Link>
        </div>
      </div>
    </section>
  );
}
