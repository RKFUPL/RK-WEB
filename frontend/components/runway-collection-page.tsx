'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { StorefrontCollectionProducts } from '@/components/collections/storefront-collection-products';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import { apiBaseUrl } from '@/lib/rbac';
import { runwayCollectionApiPath, runwayProductHref, type RunwayPagination, type StorefrontRunwayCollection } from '@/lib/runway';

type RunwayCollectionPageProps = {
  initialPage?: number;
  apiPath?: string;
  backHref?: string;
  backLabel?: string;
  eyebrow?: string;
  heading?: string;
  routeBase?: string;
  paginate?: boolean;
};

type StorefrontCollectionResponse = {
  collection: StorefrontRunwayCollection & { pagination?: RunwayPagination };
};

export function RunwayCollectionPage({
  initialPage = 1,
  apiPath = runwayCollectionApiPath,
  backHref = '/runway',
  backLabel = 'Back to runway',
  eyebrow = 'Runway collection',
  heading = 'Explore our exclusive Lakme runway collection.',
  routeBase = '/runway/LFW',
  paginate = true,
}: RunwayCollectionPageProps) {
  const [collection, setCollection] = useState<StorefrontRunwayCollection | null>(null);
  const [pagination, setPagination] = useState<RunwayPagination | null>(null);
  const [loading, setLoading] = useState(true);
  const page = Math.max(1, initialPage);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const requestUrl = paginate ? `${apiBaseUrl}${apiPath}?page=${page}` : `${apiBaseUrl}${apiPath}`;
    fetch(requestUrl, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load the runway collection.');
        return payload as StorefrontCollectionResponse;
      })
      .then((payload) => {
        if (!active) return;
        setCollection(payload.collection);
        setPagination(paginate ? payload.collection.pagination || null : null);
      })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiPath, page, paginate]);

  return (
    <main className="min-h-screen bg-ivory text-charcoal">
      <StickyHeader />
      <section className="border-b border-black/10 px-6 pb-14 pt-36 dark:border-white/10 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-[100rem]">
          <Link href={backHref} className="inline-flex items-center gap-2 text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/55 transition hover:text-gold"><ArrowLeft size={14} /> {backLabel}</Link>
          <p className="mt-14 text-[0.58rem] uppercase tracking-[0.38em] text-gold">{eyebrow}</p>
          <h1 className="mt-5 max-w-4xl font-display text-[clamp(3.5rem,8vw,8rem)] leading-[0.82] tracking-[-0.04em]">{heading}</h1>
          {collection?.description ? <p className="mt-7 max-w-xl text-sm leading-7 text-charcoal/60">{collection.description}</p> : null}
          {pagination ? <p className="mt-5 text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/45">{pagination.totalProducts} pieces · Page {pagination.page} of {pagination.totalPages}</p> : null}
        </div>
      </section>
      <StorefrontCollectionProducts collection={collection} loading={loading} productHref={runwayProductHref} />
      {pagination && pagination.totalPages > 1 ? <nav aria-label="Runway collection pages" className="flex items-center justify-center gap-3 border-t border-black/10 bg-ivory px-6 py-10 text-[0.6rem] uppercase tracking-[0.25em] dark:border-white/10">
        {Array.from({ length: pagination.totalPages }, (_, index) => index + 1).map((pageNumber) => <Link key={pageNumber} href={pageNumber === 1 ? routeBase : `${routeBase}?page=${pageNumber}`} aria-current={pageNumber === page ? 'page' : undefined} className={`grid h-10 w-10 place-items-center border transition ${pageNumber === page ? 'border-gold bg-gold text-ink' : 'border-black/15 hover:border-gold hover:text-gold dark:border-white/15'}`}>{pageNumber}</Link>)}
      </nav> : null}
      <Footer />
    </main>
  );
}
