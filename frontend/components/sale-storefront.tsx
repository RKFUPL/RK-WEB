'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StickyHeader } from '@/components/home/sticky-header';
import { Footer } from '@/components/home/footer';
import { CollectionProductCard } from '@/components/collections/collection-product-card';
import type { CatalogProduct } from '@/lib/catalog';
import { apiBaseUrl } from '@/lib/rbac';
import { SaleBannerMedia } from '@/components/sale-banner-media';
import { SaleHeroContent } from '@/components/sale-hero-content';

export type SalePayload = { available: boolean; serverTime: string; campaigns: Array<{id:string; title:string; slug:string; description:string; endsAt:string; timezone?:string; bannerUrl?:string; bannerMediaType?:'image'|'video'; bannerPosterUrl?:string|null; bannerHeading?:string; bannerSubtitle?:string; ctaLabel?:string; ctaDestination?:string}>; products: Array<CatalogProduct & {collections?:Array<{id:string; name:string; slug:string}>}> };

export function SaleStorefront({ initial, slug }: { initial: SalePayload; slug?: string }) {
  const router = useRouter();
  const [data,setData]=useState(initial);
  const [filters,setFilters]=useState<Record<string,string>>({});
  const [open,setOpen]=useState(false);
  const [sort,setSort]=useState('featured');
  const [error,setError]=useState('');
  useEffect(()=>{ let active=true; async function refresh(){try{const r=await fetch(`${apiBaseUrl}/api/sales/public${slug?`?campaign=${encodeURIComponent(slug)}`:''}`,{cache:'no-store'}); if(r.status===404){router.refresh();setData({...initial,available:false,products:[],campaigns:[]});return;} if(!r.ok)throw new Error('Unable to refresh sale.');const value=await r.json();if(active){setData(value);setError('');}}catch(e){if(active)setError(String(e));}} const interval=window.setInterval(()=>void refresh(),30000); const end=Math.min(...data.campaigns.map(c=>Date.parse(c.endsAt)))-Date.parse(data.serverTime); const expiry=window.setTimeout(()=>{setData(d=>({...d,products:[]}));void refresh();},Math.max(0,Math.min(end,2147483647)));return()=>{active=false;window.clearInterval(interval);window.clearTimeout(expiry);};},[data.serverTime,slug,router]);
  const facets=useMemo(()=>({collection:[...new Set(data.products.flatMap(p=>p.collections?.map(c=>c.name)||[]))],category:[...new Set(data.products.map(p=>p.category||'').filter(Boolean))],size:[...new Set(data.products.flatMap(p=>p.variants?.flatMap(v=>v.sizes||[])||[]))],colour:[...new Set(data.products.flatMap(p=>p.variants?.map(v=>v.colour)||[]))],availability:['in_stock','custom_order','sold_out']}),[data]);
  const selectedPrice=(p:SalePayload['products'][number]) => (filters.colour ? p.variants?.find(v=>v.colour===filters.colour)?.price : undefined) ?? p.price ?? 0;
  const products=useMemo(()=>data.products.filter(p=>(!filters.collection||p.collections?.some(c=>c.name===filters.collection))&&(!filters.category||p.category===filters.category)&&(!filters.size||p.variants?.some(v=>v.sizes?.includes(filters.size)))&&(!filters.colour||p.variants?.some(v=>v.colour===filters.colour))&&(!filters.availability||p.availability===filters.availability)&&(!filters.min||selectedPrice(p)>=Number(filters.min))&&(!filters.max||selectedPrice(p)<=Number(filters.max))).sort((a,b)=>sort==='low'?selectedPrice(a)-selectedPrice(b):sort==='high'?selectedPrice(b)-selectedPrice(a):sort==='name'?(a.name || '').localeCompare(b.name || ''):0),[data,filters,sort]);
  return (
    <main className="min-h-screen bg-ivory text-charcoal">
      <StickyHeader />
      <section className="w-full pb-24 pt-32">
        <div className="mx-auto max-w-[100rem] px-5 md:px-10 lg:px-14">
          <p className="text-xs uppercase tracking-[.25em] text-red-700">Sale</p>
        </div>
        <div className="mt-6 space-y-6">
          {data.campaigns.map(c => (
            <section key={c.id}>
              <div data-testid="sale-live-banner" className={`relative w-full ${c.bannerUrl ? '' : 'min-h-64 bg-charcoal'}`}>
                {c.bannerUrl && <SaleBannerMedia url={c.bannerUrl} type={c.bannerMediaType} posterUrl={c.bannerPosterUrl} alt={c.title} imageClassName="block h-auto w-full object-contain" videoClassName="block h-auto w-full object-contain" testId="sale-banner-media" />}
                <SaleHeroContent title={c.title} subtitle={c.bannerSubtitle || c.description} date={c.endsAt} timezone={c.timezone} ctaLabel={c.ctaLabel} ctaDestination={c.ctaDestination} />
                {data.campaigns.length > 1 && <Link className="absolute right-4 top-4 text-xs text-ivory underline" href={`/sale/${c.slug}`}>View campaign</Link>}
              </div>
            </section>
          ))}
        </div>
        <div className="mx-auto max-w-[100rem] px-5 md:px-10 lg:px-14">
          {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
          <div id="sale-products" className="mt-10 grid gap-8 lg:grid-cols-[14rem_1fr]">
            <button className="border border-charcoal/15 p-3 text-sm lg:hidden" onClick={() => setOpen(!open)}>Filters</button>
            <aside aria-label="Sale filters" className={`${open ? 'block' : 'hidden'} space-y-5 lg:block`}>
              {Object.entries(facets).map(([key, values]) => (
                <label key={key} className="block text-xs capitalize">{key}
                  <select aria-label={key[0].toUpperCase() + key.slice(1)} className="mt-2 w-full border-b border-charcoal/20 bg-transparent py-3" value={filters[key] || ''} onChange={e => setFilters({ ...filters, [key]: e.target.value })}>
                    <option value="">All</option>{values.map(v => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}
                  </select>
                </label>
              ))}
              {['min', 'max'].map(k => <label key={k} className="block text-xs">{k === 'min' ? 'Minimum' : 'Maximum'} price (INR)
                <input type="number" min="0" className="mt-2 w-full border-b border-charcoal/20 bg-transparent py-2" value={filters[k] || ''} onChange={e => setFilters({ ...filters, [k]: e.target.value })} />
              </label>)}
              <button className="text-xs underline" onClick={() => setFilters({})}>Clear filters</button>
            </aside>
            <section>
              <div className="mb-6 flex items-center justify-between gap-3 border-b border-charcoal/15 pb-4">
                <p className="text-sm">{products.length} pieces</p>
                <label className="text-xs">Sort by <select className="bg-transparent" value={sort} onChange={e => setSort(e.target.value)}>
                  <option value="featured">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="name">Name</option>
                </select></label>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-10 xl:grid-cols-3">{products.map(p => <CollectionProductCard key={p.id} product={p} selectedColour={filters.colour || ''} />)}</div>
              {!products.length && <p className="py-12 text-center text-sm text-charcoal/60">No sale pieces match these filters.</p>}
            </section>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
