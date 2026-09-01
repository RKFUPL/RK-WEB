'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useState } from 'react';
import { FeaturedCollection } from '@/components/home/featured-collection';
import { Footer } from '@/components/home/footer';
import { SectionShell } from '@/components/home/section-shell';
import { StickyHeader } from '@/components/home/sticky-header';
import { featuredCollectionFrames } from '@/lib/home-content';
import { apiBaseUrl } from '@/lib/rbac';

function AakaarLightModeStart() {
  useLayoutEffect(() => {
    document.documentElement.classList.remove('dark');
    window.localStorage.setItem('rk-theme', 'light');
    window.dispatchEvent(new CustomEvent('rk-theme-change', { detail: false }));
  }, []);

  return null;
}

type AakaarPreviewProduct = {
  name: string;
  styleCode: string;
  image: string;
};

const previewProducts: AakaarPreviewProduct[] = [
  { name: 'Aarohi', styleCode: 'IND-01', image: featuredCollectionFrames[0] },
  { name: 'Ananya', styleCode: 'IND-02', image: featuredCollectionFrames[1] },
  { name: 'Avani', styleCode: 'IND-03', image: featuredCollectionFrames[2] },
];

type AakaarApiProduct = {
  name?: string;
  styleCode?: string;
  media?: string[];
};

export function AakaarPage() {
  const [featuredProducts, setFeaturedProducts] = useState([...previewProducts]);

  useEffect(() => {
    let active = true;
    fetch(`${apiBaseUrl}/api/catalog/collections/aakaar`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load AAKAAR products.');
        const payload = await response.json() as { collection?: { products?: AakaarApiProduct[] } };
        return payload.collection?.products || [];
      })
      .then((products) => {
        if (!active || products.length < previewProducts.length) return;
        setFeaturedProducts(previewProducts.map((fallback, index) => ({
          name: products[index]?.name || fallback.name,
          styleCode: products[index]?.styleCode || fallback.styleCode,
          image: products[index]?.media?.[0] || fallback.image,
        })));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <main className="aakaar-page min-h-screen bg-ivory text-charcoal">
      <AakaarLightModeStart />
      <StickyHeader transparentAtTop />
      <FeaturedCollection />

      <section aria-labelledby="aakaar-coming-soon" className="bg-ivory text-charcoal dark:bg-[#0b0b0b] dark:text-[#f5f2ee]">
        <SectionShell className="pb-24 pt-20 lg:pb-32 lg:pt-28">
          <header className="mx-auto max-w-2xl text-center">
            <p className="text-[0.62rem] uppercase tracking-[0.38em] text-gold">Newest collection</p>
            <h1 id="aakaar-coming-soon" className="mt-5 font-display text-[clamp(3.6rem,9vw,7.5rem)] leading-[0.82] tracking-[-0.04em]">
              Coming soon.
            </h1>
            <p className="mt-7 font-display text-xl italic leading-tight text-charcoal/65 dark:text-[#f5f2ee]/65 md:text-2xl">
              A preview of what&apos;s next.
            </p>
          </header>

          <div className="mt-16 grid gap-6 md:grid-cols-3 lg:mt-20 lg:gap-8">
            {featuredProducts.map((product, index) => (
              <article key={product.styleCode} className="group min-w-0">
                <div className="aspect-[3/4] overflow-hidden rounded-[14px] bg-sand dark:bg-[#181513]">
                  <img
                    src={product.image}
                    alt={`${product.name} Aakaar campaign preview`}
                    draggable={false}
                    loading={index === 0 ? 'eager' : 'lazy'}
                    decoding="async"
                    className="block h-full w-full rounded-[14px] object-cover object-center"
                  />
                </div>
                <div className="flex items-center justify-between gap-4 pt-4 sm:pt-5">
                  <div>
                    <p className="text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/65 dark:text-[#f5f2ee]/65">Aakaar / {product.styleCode}</p>
                    <h2 className="mt-2 font-display text-2xl leading-none">{product.name}</h2>
                  </div>
                  <p className="shrink-0 text-[0.52rem] uppercase tracking-[0.25em] text-gold">Coming soon</p>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-12 text-center lg:mt-16">
            <Link href="/aakaar/collection" className="inline-flex items-center gap-3 border-b border-charcoal/35 pb-2 text-[0.6rem] uppercase tracking-[0.28em] text-charcoal transition hover:border-gold hover:text-gold dark:border-white/35 dark:text-[#f5f2ee]">
              View more <span aria-hidden="true" className="text-base leading-none">→</span>
            </Link>
          </div>

          <div className="mt-12 border-t border-black/10 pt-10 text-center dark:border-white/10 lg:mt-16">
            <p className="text-[0.58rem] uppercase tracking-[0.32em] text-charcoal/55 dark:text-[#f5f2ee]/55">For more information, contact</p>
            <a href="mailto:contact@rashikapooroffical.com" className="mt-3 inline-block font-display text-xl text-charcoal transition hover:text-gold dark:text-[#f5f2ee] md:text-2xl">
              contact@rashikapooroffical.com
            </a>
          </div>
        </SectionShell>
      </section>

      <Footer />
    </main>
  );
}
