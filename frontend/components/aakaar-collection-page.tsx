'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { CollectionProductCard } from '@/components/collections/collection-product-card';
import { Footer } from '@/components/home/footer';
import { SectionShell } from '@/components/home/section-shell';
import { StickyHeader } from '@/components/home/sticky-header';
import type { CatalogProduct } from '@/lib/catalog';
import { aakarBannerBackgroundUrl } from '@/lib/home-content';
import { apiBaseUrl } from '@/lib/rbac';

type AakaarCollectionResponse = {
  collection?: {
    name?: string;
    productCount?: number;
    products?: CatalogProduct[];
  };
};

const styleOptions = ['Indian', 'Cocktail'] as const;

function AakaarLightModeStart() {
  useLayoutEffect(() => {
    document.documentElement.classList.remove('dark');
    window.localStorage.setItem('rk-theme', 'light');
    window.dispatchEvent(new CustomEvent('rk-theme-change', { detail: false }));
  }, []);

  return null;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function normaliseStyle(value: string | null) {
  const match = styleOptions.find((option) => option.toLowerCase() === value?.trim().toLowerCase());
  return match || '';
}

function normaliseColour(value: string | null) {
  return value?.trim() || '';
}

export function AakaarCollectionPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const style = normaliseStyle(searchParams.get('style'));
  const colour = normaliseColour(searchParams.get('colour') || searchParams.get('color'));
  const [allProducts, setAllProducts] = useState<CatalogProduct[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [productCount, setProductCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch(`${apiBaseUrl}/api/catalog/collections/aakaar`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load the AAKAAR collection.');
        return await response.json() as AakaarCollectionResponse;
      })
      .then((payload) => {
        if (!active) return;
        const nextProducts = payload.collection?.products || [];
        setAllProducts(nextProducts);
        if (!style && !colour) {
          setProducts(nextProducts);
          setProductCount(payload.collection?.productCount ?? nextProducts.length);
        }
      })
      .catch((reason) => {
        if (active && !style && !colour) setError(reason instanceof Error ? reason.message : 'Unable to load the AAKAAR collection.');
      });
    return () => { active = false; };
  }, [colour, style]);

  useEffect(() => {
    if (!style && !colour) {
      setLoading(allProducts.length === 0);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError('');
    const query = new URLSearchParams();
    if (style) query.set('style', style.toLowerCase());
    if (colour) query.set('colour', colour);
    fetch(`${apiBaseUrl}/api/catalog/collections/aakaar?${query.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to filter the AAKAAR collection.');
        return await response.json() as AakaarCollectionResponse;
      })
      .then((payload) => {
        if (!active) return;
        const nextProducts = payload.collection?.products || [];
        setProducts(nextProducts);
        setProductCount(payload.collection?.productCount ?? nextProducts.length);
      })
      .catch((reason) => {
        if (active) {
          setProducts([]);
          setProductCount(0);
          setError(reason instanceof Error ? reason.message : 'Unable to filter the AAKAAR collection.');
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [allProducts.length, colour, style]);

  const colours = useMemo(
    () => unique(allProducts.flatMap((product) => product.attributes?.colors || (product.attributes?.color ? [String(product.attributes.color)] : []))),
    [allProducts],
  );
  const hasFilters = Boolean(style || colour);

  const updateFilter = (key: 'style' | 'colour', value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value.toLowerCase());
    else next.delete(key);
    if (key === 'colour') next.delete('color');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const clearFilters = () => router.replace(pathname, { scroll: false });

  return <main className="min-h-screen bg-ivory text-charcoal">
    <AakaarLightModeStart />
    <StickyHeader />
    <section className="relative overflow-hidden border-b border-black/10 dark:border-white/10">
      <img src={aakarBannerBackgroundUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-35 dark:opacity-15" />
      <div className="absolute inset-0 bg-ivory/70 dark:bg-[#0b0b0b]/80" />
      <SectionShell className="relative py-28 sm:py-36 lg:py-44">
        <Link href="/aakaar" className="inline-flex items-center gap-3 text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/55 transition hover:text-gold dark:text-[#f5f2ee]/55">← AAKAAR</Link>
        <p className="mt-14 text-[0.62rem] uppercase tracking-[0.4em] text-gold">The complete collection</p>
        <h1 className="mt-5 font-aakaar text-[clamp(4rem,12vw,10rem)] leading-[0.78] tracking-[0.04em]">AAKAAR</h1>
        <p className="mt-8 max-w-xl font-display text-xl italic leading-tight text-charcoal/65 dark:text-[#f5f2ee]/65 md:text-2xl">The Indian Collection, presented through twenty considered pieces.</p>
      </SectionShell>
    </section>

    <section id="aakaar-products" className="border-b border-black/10 bg-ivory px-4 pb-24 pt-14 dark:border-white/10 sm:px-8 lg:px-12 lg:pt-20">
      <div className="mx-auto max-w-[100rem]">
        <div className="flex flex-col justify-between gap-8 border-b border-black/10 pb-7 dark:border-white/15 md:flex-row md:items-end">
          <div>
            <p className="text-[0.58rem] uppercase tracking-[0.38em] text-gold">AAKAAR / Indian Collection</p>
            <h2 className="mt-3 font-display text-4xl leading-none sm:text-5xl">Collection</h2>
            <p className="mt-3 text-[0.58rem] uppercase tracking-[0.3em] text-charcoal/48 dark:text-[#f5f2ee]/48">{productCount} {productCount === 1 ? 'piece' : 'pieces'}</p>
          </div>
          <div className="flex flex-wrap items-end gap-5 sm:gap-7">
            <label className="text-[0.55rem] uppercase tracking-[0.25em] text-charcoal/50 dark:text-[#f5f2ee]/55">
              Style
              <select value={style} onChange={(event) => updateFilter('style', event.target.value)} className="mt-2 block min-w-36 border-b border-black/15 bg-transparent py-2 text-[0.68rem] normal-case tracking-normal text-charcoal outline-none focus:border-gold dark:border-white/20 dark:text-[#f5f2ee]">
                <option value="">All styles</option>
                {styleOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="text-[0.55rem] uppercase tracking-[0.25em] text-charcoal/50 dark:text-[#f5f2ee]/55">
              Colour
              <select value={colour} onChange={(event) => updateFilter('colour', event.target.value)} className="mt-2 block min-w-36 border-b border-black/15 bg-transparent py-2 text-[0.68rem] normal-case tracking-normal text-charcoal outline-none focus:border-gold dark:border-white/20 dark:text-[#f5f2ee]">
                <option value="">All colours</option>
                {colours.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            {hasFilters ? <button type="button" onClick={clearFilters} className="pb-2 text-[0.55rem] uppercase tracking-[0.25em] text-gold transition hover:text-charcoal dark:hover:text-[#f5f2ee]">Clear all</button> : null}
          </div>
        </div>

        {error ? <p role="alert" className="mt-10 border border-black/10 px-5 py-8 text-center text-sm text-charcoal/65 dark:border-white/10 dark:text-[#f5f2ee]/65">{error}</p> : loading ? <div className="mt-9 grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4 lg:gap-x-7">{Array.from({ length: 8 }, (_, index) => <div key={index} className="animate-pulse"><div className="aspect-[3/4] bg-sand" /><div className="mt-4 h-3 w-1/3 bg-sand" /><div className="mt-3 h-5 w-3/4 bg-sand" /></div>)}</div> : products.length ? <div className="mt-9 grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 md:gap-x-6 md:gap-y-14 lg:grid-cols-4 lg:gap-x-7">{products.map((product) => <CollectionProductCard key={product.id} product={product} />)}</div> : <div className="mt-10 border border-black/10 px-6 py-16 text-center dark:border-white/10"><p className="font-display text-2xl">No pieces match these filters.</p>{hasFilters ? <button type="button" onClick={clearFilters} className="mt-5 text-[0.6rem] uppercase tracking-[0.25em] text-gold">Clear all</button> : null}</div>}
      </div>
    </section>

    <section className="bg-ivory px-4 py-20 text-center text-charcoal dark:bg-[#0b0b0b] dark:text-[#f5f2ee] sm:px-8 lg:py-28">
      <p className="text-[0.58rem] uppercase tracking-[0.32em] text-charcoal/55 dark:text-[#f5f2ee]/55">For more information, contact</p>
      <a href="mailto:contact@rashikapooroffical.com" className="mt-3 inline-block font-display text-xl transition hover:text-gold md:text-2xl">contact@rashikapooroffical.com</a>
    </section>
    <Footer />
  </main>;
}
