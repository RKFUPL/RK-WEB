'use client';

import { Search, SlidersHorizontal, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { CollectionProductCard } from '@/components/collections/collection-product-card';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import type { CatalogProduct } from '@/lib/catalog';
import { apiBaseUrl } from '@/lib/rbac';

type Facets = { categories: string[]; colours: string[]; sizes: string[]; fabrics: string[]; collections: [string, string, string][] };
type ShopPayload = { products: CatalogProduct[]; count: number; facets: Facets; error?: string };
const emptyFacets: Facets = { categories: [], colours: [], sizes: [], fabrics: [], collections: [] };
const filterKeys = ['category', 'colour', 'size', 'collection', 'fabric', 'fulfilment'] as const;

function ShopContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [facets, setFacets] = useState<Facets>(emptyFacets);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    value ? next.set(key, value) : next.delete(key);
    if (key !== 'page') next.delete('page');
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query !== (searchParams.get('q') || '')) updateParam('q', query.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  // The URL is the authoritative filter state; only debounce user typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`${apiBaseUrl}/api/catalog/products?${searchParams.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => { const payload = await response.json() as ShopPayload; if (!response.ok) throw new Error(payload.error || 'Unable to load the shop.'); return payload; })
      .then((payload) => { setProducts(payload.products || []); setCount(payload.count || 0); setFacets(payload.facets || emptyFacets); })
      .catch((value) => { if (value instanceof DOMException && value.name === 'AbortError') return; setError(value instanceof Error ? value.message : 'Unable to load the shop.'); setProducts([]); setCount(0); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [searchParams]);

  const activeCount = useMemo(() => filterKeys.filter((key) => searchParams.get(key)).length + Number(Boolean(searchParams.get('minPrice'))) + Number(Boolean(searchParams.get('maxPrice'))), [searchParams]);
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
  const pageSize = [12, 24, 48].includes(Number(searchParams.get('pageSize'))) ? Number(searchParams.get('pageSize')) : 24;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const clearFilters = () => { setQuery(''); router.replace(pathname, { scroll: false }); };
  const field = 'w-full border border-black/12 bg-transparent px-3 py-3 text-xs text-charcoal outline-none focus:border-gold';
  const FilterFields = () => <div className="grid gap-4">
    <select aria-label="Category" className={field} value={searchParams.get('category') || ''} onChange={(event) => updateParam('category', event.target.value)}><option value="">All categories</option>{facets.categories.map((value) => <option key={value}>{value}</option>)}</select>
    <select aria-label="Colour" className={field} value={searchParams.get('colour') || ''} onChange={(event) => updateParam('colour', event.target.value)}><option value="">All colours</option>{facets.colours.map((value) => <option key={value}>{value}</option>)}</select>
    <select aria-label="Size" className={field} value={searchParams.get('size') || ''} onChange={(event) => updateParam('size', event.target.value)}><option value="">All sizes</option>{facets.sizes.map((value) => <option key={value}>{value}</option>)}</select>
    <select aria-label="Collection" className={field} value={searchParams.get('collection') || ''} onChange={(event) => updateParam('collection', event.target.value)}><option value="">All collections</option>{facets.collections.map(([id, name, slug]) => <option key={id} value={slug}>{name}</option>)}</select>
    <select aria-label="Fabric" className={field} value={searchParams.get('fabric') || ''} onChange={(event) => updateParam('fabric', event.target.value)}><option value="">All fabrics</option>{facets.fabrics.map((value) => <option key={value}>{value}</option>)}</select>
    <select aria-label="Availability" className={field} value={searchParams.get('fulfilment') || ''} onChange={(event) => updateParam('fulfilment', event.target.value)}><option value="">All availability</option><option value="ready_to_ship">Ready to ship</option><option value="made_to_order">Made to order</option></select>
    <div className="grid grid-cols-2 gap-3"><input aria-label="Minimum price" inputMode="numeric" className={field} placeholder="Min price" value={searchParams.get('minPrice') || ''} onChange={(event) => updateParam('minPrice', event.target.value.replace(/\D/g, ''))} /><input aria-label="Maximum price" inputMode="numeric" className={field} placeholder="Max price" value={searchParams.get('maxPrice') || ''} onChange={(event) => updateParam('maxPrice', event.target.value.replace(/\D/g, ''))} /></div>
  </div>;

  return <main className="min-h-screen bg-ivory text-charcoal"><StickyHeader />
    <section className="mx-auto max-w-[100rem] px-5 pb-24 pt-32 md:px-10 lg:px-14">
      <header className="border-b border-black/10 pb-10"><p className="text-[0.62rem] uppercase tracking-[0.36em] text-gold">The Rashi Kapoor edit</p><h1 className="mt-5 font-display text-6xl leading-none md:text-8xl">Shop the house.</h1><p className="mt-5 max-w-2xl text-sm leading-7 text-charcoal/60">Explore available pieces across the house. Search and refine using only the details recorded for each product.</p></header>
      <div className="mt-8 flex flex-wrap items-center gap-3"><label className="flex min-w-[16rem] flex-1 items-center gap-3 border border-black/12 px-4 py-3"><Search size={16} /><span className="sr-only">Search products</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, style code, colour or collection" className="w-full bg-transparent text-sm outline-none" /></label><button type="button" onClick={() => setFiltersOpen((value) => !value)} className="inline-flex items-center gap-2 border border-black/12 px-4 py-3 text-xs uppercase tracking-[0.16em] lg:hidden"><SlidersHorizontal size={15} />Filters{activeCount ? ` (${activeCount})` : ''}</button><select aria-label="Sort products" className="border border-black/12 bg-transparent px-4 py-3 text-xs" value={searchParams.get('sort') || 'featured'} onChange={(event) => updateParam('sort', event.target.value)}><option value="featured">Featured</option><option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option></select><select aria-label="Products per page" className="border border-black/12 bg-transparent px-4 py-3 text-xs" value={String(pageSize)} onChange={(event) => updateParam('pageSize', event.target.value)}><option value="12">12 per page</option><option value="24">24 per page</option><option value="48">48 per page</option></select>{activeCount || searchParams.get('q') ? <button type="button" onClick={clearFilters} className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-gold"><X size={14} />Clear</button> : null}</div>
      {filtersOpen ? <div className="mt-5 border border-black/10 p-5 lg:hidden"><FilterFields /></div> : null}
      <div className="mt-10 grid gap-10 lg:grid-cols-[15rem_1fr]"><aside className="hidden lg:block"><p className="mb-5 text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/50">Refine</p><FilterFields /></aside><section aria-live="polite"><div className="mb-6 flex items-center justify-between"><p className="text-xs uppercase tracking-[0.2em] text-charcoal/50">{loading ? 'Loading pieces…' : `${count} ${count === 1 ? 'piece' : 'pieces'}`}</p></div>{loading ? <div className="grid grid-cols-2 gap-4 md:grid-cols-3"><div className="aspect-[3/4] animate-pulse bg-sand" /><div className="aspect-[3/4] animate-pulse bg-sand" /><div className="hidden aspect-[3/4] animate-pulse bg-sand md:block" /></div> : error ? <div role="alert" className="border border-red-900/20 p-10 text-center"><p className="font-display text-3xl">The shop could not be loaded.</p><p className="mt-3 text-sm text-charcoal/55">{error}</p></div> : products.length ? <div className="grid grid-cols-2 gap-x-3 gap-y-12 md:grid-cols-3 md:gap-x-6">{products.map((product) => <CollectionProductCard key={product.id} product={product} />)}</div> : <div className="border border-black/10 p-12 text-center"><p className="font-display text-3xl">No pieces match this edit.</p><p className="mt-3 text-sm text-charcoal/55">Try removing a filter or searching for another style.</p><button type="button" onClick={clearFilters} className="mt-6 border-b border-gold pb-2 text-xs uppercase tracking-[0.18em] text-gold">Clear filters</button></div>}{!loading && !error && products.length && totalPages > 1 ? <nav aria-label="Shop pages" className="mt-12 flex flex-wrap items-center justify-center gap-2 border-t border-black/10 pt-8"><button type="button" disabled={page <= 1} onClick={() => updateParam('page', String(page - 1))} className="border border-black/12 px-4 py-2 text-xs uppercase tracking-[0.15em] disabled:cursor-not-allowed disabled:opacity-35">Previous</button>{Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => <button type="button" key={pageNumber} aria-current={pageNumber === page ? 'page' : undefined} onClick={() => updateParam('page', String(pageNumber))} className={`grid h-9 min-w-9 place-items-center border px-2 text-xs ${pageNumber === page ? 'border-gold bg-gold text-ink' : 'border-black/12'}`}>{pageNumber}</button>)}<button type="button" disabled={page >= totalPages} onClick={() => updateParam('page', String(page + 1))} className="border border-black/12 px-4 py-2 text-xs uppercase tracking-[0.15em] disabled:cursor-not-allowed disabled:opacity-35">Next</button></nav> : null}</section></div>
    </section><Footer /></main>;
}

export default function ShopPage() {
  return <Suspense fallback={<main className="min-h-screen bg-ivory text-charcoal"><StickyHeader /><section className="mx-auto max-w-[100rem] px-5 pb-24 pt-32 md:px-10 lg:px-14"><div className="h-16 w-72 animate-pulse bg-sand" /><div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-3"><div className="aspect-[3/4] animate-pulse bg-sand" /><div className="aspect-[3/4] animate-pulse bg-sand" /><div className="hidden aspect-[3/4] animate-pulse bg-sand md:block" /></div></section></main>}><ShopContent /></Suspense>;
}
