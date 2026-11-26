'use client';

import Link from 'next/link';
import { Heart, ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CatalogSearchProduct } from '@/lib/catalog-client';
import { productVariantHref, variantPrimaryAndHoverSources } from '@/lib/catalog';
import { cloudinaryImageUrl } from '@/lib/utils';
import { collectionDisplayName } from '@/lib/home-content';
import { readWishlist, toggleWishlist, wishlistChangedEvent } from '@/lib/storefront-wishlist';
import { SaleAmount } from '@/components/commerce/sale-amount';

export type SearchPageResult = {title: string; href: string; image?: string; description?: string};
type Tab = 'products' | 'collections' | 'lookbooks';

function SearchProduct({product, onNavigate}: {product: CatalogSearchProduct; onNavigate: () => void}) {
  const variant = product.variants?.find(v => v.id === product.matchedVariantId) || product.variants?.find(v => v.status === 'active');
  const route = productVariantHref(`/products/${encodeURIComponent(product.id)}`, variant?.id);
  const image = cloudinaryImageUrl(variantPrimaryAndHoverSources(product, variant).primary, 640);
  const sku = variant?.sku || product.sku;
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const sync = () => setSaved(readWishlist().some(item => item.productId === product.id && item.sku === sku));
    sync(); window.addEventListener(wishlistChangedEvent, sync);
    return () => window.removeEventListener(wishlistChangedEvent, sync);
  }, [product.id, sku]);
  return <article className="min-w-0" data-search-product>
    <div className="relative aspect-[3/4] bg-sand">
      <Link href={route} onClick={onNavigate} aria-label={`View ${product.name || 'RK piece'}`} className="block h-full focus-visible:outline focus-visible:outline-gold">
        {image ? <img src={image} alt={product.name || 'RK piece'} className="h-full w-full object-cover" loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} /> : <span className="flex h-full items-center justify-center text-xs text-charcoal/50">Image coming soon</span>}
      </Link>
      <button type="button" aria-label={`${saved ? 'Remove' : 'Save'} ${product.name} ${saved ? 'from' : 'to'} wishlist`} aria-pressed={saved} className="absolute right-2 top-2 p-1 text-ivory [filter:drop-shadow(0_1px_2px_rgb(0_0_0/.5))] focus-visible:outline focus-visible:outline-gold" onClick={() => {
        if (!localStorage.getItem('rk_access_token')) { window.alert('Please sign in to save pieces to your wishlist.'); return; }
        toggleWishlist({productId: product.id, variantId: variant?.id, sku, name: product.name || 'RK piece', image, route, colour: variant?.colour, price: variant?.price ?? product.price});
      }}><Heart size={22} className={saved ? 'fill-ivory' : ''}/></button>
    </div>
    <Link href={route} onClick={onNavigate} className="mt-3 block break-words font-display text-lg leading-snug hover:text-gold focus-visible:outline focus-visible:outline-gold">{product.name || 'RK piece'}</Link>
    <p className="mt-1 break-words text-[10px] leading-5 text-charcoal/55">{[variant?.colour, product.productCode || product.styleCode || sku, product.collections?.[0] && collectionDisplayName(product.collections[0])].filter(Boolean).join(' · ')}</p>
    {product.price !== undefined && <div className="mt-1 text-xs"><SaleAmount amount={variant?.price ?? product.price} sale={variant?.sale || product.sale}/></div>}
  </article>;
}

export function SearchResults({query, products, count, suggestions, collections, lookbooks, state, collectionError, onQuery, onRetry, onNavigate}: {
  query: string; products: CatalogSearchProduct[]; count: number; suggestions: string[]; collections: SearchPageResult[]; lookbooks: SearchPageResult[];
  state: 'idle' | 'loading' | 'ready' | 'error'; collectionError: boolean; onQuery: (query: string) => void; onRetry: () => void; onNavigate: () => void;
}) {
  const [tab, setTab] = useState<Tab>('products');
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => { if (state === 'ready') setTab(count ? 'products' : collections.length ? 'collections' : lookbooks.length ? 'lookbooks' : 'products'); }, [state, count, collections.length, lookbooks.length]);
  const tabs: Array<{key: Tab; label: string; count: number}> = [{key: 'products', label: 'Products', count}, {key: 'collections', label: 'Collections', count: collections.length}, {key: 'lookbooks', label: 'Lookbooks', count: lookbooks.length}];
  return <div aria-live="polite" aria-busy={state === 'loading'} className="mt-8" data-testid="search-results">
    {state === 'loading' && <p role="status" className="mb-5 text-sm text-charcoal/60">Searching pieces…</p>}
    {(state === 'error' || collectionError) && <div className="mb-5 text-sm"><p role="alert" className="text-red-700">{state === 'error' ? 'Product search could not be loaded.' : 'Collections could not be loaded.'} Please try again.</p><button type="button" onClick={onRetry} className="mt-2 border-b border-gold text-gold focus-visible:outline focus-visible:outline-gold">Retry search</button></div>}
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,3.6fr)] md:gap-10">
      <section aria-labelledby="search-suggestions-title" className="min-w-0">
        <h3 id="search-suggestions-title" className="border-b border-charcoal/15 pb-3 text-xs uppercase tracking-[.18em]">Suggestions</h3>
        <div className="mt-2 flex gap-x-5 overflow-x-auto md:block md:overflow-visible">{suggestions.map(term => <button key={term} type="button" onClick={() => onQuery(term)} className="shrink-0 border-b border-charcoal/10 py-3 text-left font-display text-lg hover:text-gold focus-visible:outline focus-visible:outline-gold md:block md:w-full md:break-words">{term}</button>)}</div>
      </section>
      <section className="min-w-0">
        <div role="tablist" aria-label="Search result types" className="flex gap-5 overflow-x-auto border-b border-charcoal/15 sm:gap-8">{tabs.map((item, index) => <button key={item.key} ref={el => { buttons.current[index] = el; }} type="button" role="tab" id={`search-tab-${item.key}`} aria-selected={tab === item.key} aria-controls={`search-panel-${item.key}`} tabIndex={tab === item.key ? 0 : -1} onClick={() => setTab(item.key)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
          if (next !== null) { event.preventDefault(); setTab(tabs[next].key); buttons.current[next]?.focus(); }
        }} className={`shrink-0 border-b pb-4 text-[10px] uppercase tracking-[.14em] transition-colors hover:text-charcoal focus-visible:outline focus-visible:outline-gold sm:text-xs ${tab === item.key ? 'border-charcoal text-charcoal' : 'border-transparent text-charcoal/50'}`}>{item.label} ({item.count})</button>)}</div>
        {tabs.map(item => <div key={item.key} role="tabpanel" id={`search-panel-${item.key}`} aria-labelledby={`search-tab-${item.key}`} hidden={tab !== item.key} tabIndex={0} className="pt-6 focus-visible:outline focus-visible:outline-gold">
          {item.key === 'products' ? <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-7 lg:grid-cols-4">{products.map(product => <SearchProduct key={product.id} product={product} onNavigate={onNavigate}/>)}</div>
            {state === 'ready' && count > products.length && <Link href={`/shop?q=${encodeURIComponent(query.trim())}`} onClick={onNavigate} className="mt-7 flex items-center justify-end gap-3 font-display text-lg text-gold focus-visible:outline focus-visible:outline-gold">View all {count} products <ArrowRight size={18}/></Link>}
          </> : <div data-testid={`search-${item.key}-grid`} className={`grid grid-cols-2 justify-start gap-5 ${item.key === 'collections' ? 'md:grid-cols-[repeat(auto-fill,minmax(0,210px))]' : 'md:grid-cols-[repeat(auto-fill,minmax(0,180px))]'}`}>{(item.key === 'collections' ? collections : lookbooks).map(result => <Link key={result.href} href={result.href} aria-label={result.title} onClick={onNavigate} data-testid={`search-${item.key}-card`} className={`min-w-0 w-full hover:text-gold focus-visible:outline focus-visible:outline-gold ${item.key === 'collections' ? 'max-w-[210px]' : 'max-w-[180px]'}`}>
            {result.image && <img src={cloudinaryImageUrl(result.image, 640)} alt={result.title} className={`w-full bg-sand object-center ${item.key === 'collections' ? 'aspect-[4/3] object-cover' : 'aspect-[3/4] object-contain'}`} loading="lazy"/>}
            <h3 className="mt-2 break-words font-display text-lg">{result.title}</h3>{result.description && <p className="mt-2 line-clamp-2 text-xs leading-5 text-charcoal/60">{result.description}</p>}
          </Link>)}</div>}
          {state === 'ready' && !collectionError && !item.count && <p className="py-6 text-sm text-charcoal/60">No matching {item.key === 'products' ? 'pieces' : item.key} found.</p>}
        </div>)}
      </section>
    </div>
  </div>;
}
