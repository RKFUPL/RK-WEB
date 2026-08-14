'use client';

import { ArrowLeft, Heart, Image as ImageIcon, ShoppingBag } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { availabilityLabels, inr, type CatalogProduct, type ManagedCollection } from '@/lib/catalog';
import { apiBaseUrl } from '@/lib/rbac';
import { addStoredCartItem } from '@/lib/storefront-cart';
import { readWishlist, toggleWishlist, wishlistChangedEvent } from '@/lib/storefront-wishlist';

export function ProductDetailPage({ productId }: { productId: string }) {
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [collections, setCollections] = useState<ManagedCollection[]>([]);
  const [saved, setSaved] = useState(false);
  const [selectedSize, setSelectedSize] = useState('');
  const [message, setMessage] = useState('');
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/catalog/products/${encodeURIComponent(productId)}`, { cache: 'no-store' })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Product not found.'); return payload; })
      .then((payload) => {
        setProduct(payload.product);
        setCollections(payload.collections || []);
        trackAnalyticsEvent('product_view', { productId, productName: payload.product.name, currency: 'INR', value: payload.product.price });
      })
      .catch(() => setNotFound(true));
  }, [productId]);

  useEffect(() => {
    const sync = () => setSaved(readWishlist().some((item) => item.productId === productId));
    sync(); window.addEventListener(wishlistChangedEvent, sync); window.addEventListener('storage', sync);
    return () => { window.removeEventListener(wishlistChangedEvent, sync); window.removeEventListener('storage', sync); };
  }, [productId]);

  if (notFound) return <main className="min-h-screen bg-ivory text-charcoal"><StickyHeader /><div className="mx-auto max-w-3xl px-6 pb-24 pt-40 text-center"><p className="text-[0.6rem] uppercase tracking-[0.35em] text-gold">Product unavailable</p><h1 className="mt-5 font-display text-5xl">This piece could not be found.</h1><Link href="/collections" className="mt-10 inline-flex border-b border-charcoal/40 pb-2 text-xs uppercase tracking-[0.28em]">Explore collections</Link></div><Footer /></main>;
  if (!product) return <main className="min-h-screen bg-ivory text-charcoal"><StickyHeader /><div className="mx-auto grid max-w-[100rem] animate-pulse gap-10 px-6 pb-24 pt-32 lg:grid-cols-2 lg:px-12"><div className="aspect-[3/4] bg-sand" /><div className="space-y-5 py-10"><div className="h-3 w-24 bg-sand" /><div className="h-16 w-3/4 bg-sand" /><div className="h-4 w-32 bg-sand" /></div></div></main>;

  const sizes = product.attributes?.sizes ?? [];
  const backCollection = collections[0];
  const route = `/products/${product.id}`;
  const primaryImage = product.media?.[0];
  const requireSignIn = () => {
    if (window.localStorage.getItem('rk_access_token')) return true;
    window.alert('Please sign in to use your wishlist or shopping bag.');
    return false;
  };
  const saveProduct = () => {
    if (!requireSignIn()) return;
    const added = toggleWishlist({ productId: product.id, name: product.name || 'Untitled piece', price: product.price, image: primaryImage, category: product.category || 'Couture', availability: availabilityLabels[product.availability], route });
    setSaved(added);
    if (added) trackAnalyticsEvent('wishlist_add', { productId: product.id, productName: product.name, currency: 'INR', value: product.price });
  };
  const addToBag = () => {
    if (!requireSignIn()) return;
    if (sizes.length && !selectedSize) { setMessage('Please select a size.'); return; }
    addStoredCartItem({ productId: product.id, name: product.name || 'Untitled piece', price: Number(product.price || 0), quantity: 1, image: primaryImage, variant: selectedSize ? { id: `size:${selectedSize}`, name: 'Size', value: selectedSize } : undefined });
    trackAnalyticsEvent('add_to_bag', { productId: product.id, productName: product.name, currency: 'INR', value: product.price, quantity: 1 });
    setMessage('Added to your shopping bag.');
  };

  return <main className="bg-ivory text-charcoal"><StickyHeader />
    <section className="mx-auto max-w-[100rem] px-4 pb-20 pt-28 sm:px-8 lg:px-12 lg:pb-28 lg:pt-32">
      {backCollection ? <Link href={`/collections/${backCollection.slug}`} className="mb-7 inline-flex items-center gap-2 text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/55 transition hover:text-gold"><ArrowLeft size={14} />{backCollection.name}</Link> : null}
      <div className="grid gap-10 lg:grid-cols-[1.16fr_0.84fr] lg:gap-16 xl:gap-24">
        <div className={`grid gap-3 ${product.media.length > 1 ? 'sm:grid-cols-2' : ''}`}>
          {product.media.length ? product.media.map((image, index) => <div key={`${image}-${index}`} className="relative aspect-[3/4] overflow-hidden bg-sand"><Image src={image} alt={index === 0 ? product.name || 'Product' : `${product.name || 'Product'} view ${index + 1}`} fill priority={index === 0} sizes="(max-width: 1024px) 100vw, 55vw" className="object-cover" /></div>) : <div className="grid aspect-[3/4] place-items-center bg-sand text-center text-charcoal/40"><div><ImageIcon size={30} strokeWidth={1.2} className="mx-auto" /><p className="mt-4 text-[0.58rem] uppercase tracking-[0.3em]">Product image coming soon</p></div></div>}
        </div>
        <div className="lg:sticky lg:top-32 lg:self-start">
          <p className="text-[0.58rem] uppercase tracking-[0.32em] text-gold">{product.category || 'Couture'}</p>
          <h1 className="mt-5 font-display text-5xl leading-[0.95] sm:text-6xl">{product.name}</h1>
          <p className="mt-4 text-[0.62rem] uppercase tracking-[0.25em] text-charcoal/45">{product.sku}</p>
          <p className="mt-8 text-lg">{product.price === undefined ? 'Price on request' : inr.format(product.price)}</p>
          <p className="mt-3 text-[0.58rem] uppercase tracking-[0.25em] text-gold">{availabilityLabels[product.availability]}</p>
          {product.description ? <p className="mt-8 border-t border-black/12 pt-7 text-sm leading-7 text-charcoal/65 dark:border-white/15">{product.description}</p> : null}
          {sizes.length ? <fieldset className="mt-8"><legend className="text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/50">Select size</legend><div className="mt-4 flex flex-wrap gap-2">{sizes.map((size) => <button key={size} type="button" onClick={() => { setSelectedSize(size); setMessage(''); }} className={`min-w-12 border px-4 py-3 text-xs transition ${selectedSize === size ? 'border-gold bg-gold text-ink' : 'border-black/15 hover:border-gold dark:border-white/20'}`}>{size}</button>)}</div></fieldset> : null}
          <div className="mt-9 grid grid-cols-[1fr_auto] gap-3"><button type="button" onClick={addToBag} disabled={product.availability === 'sold_out'} className="inline-flex items-center justify-center gap-3 bg-ink px-6 py-4 text-[0.62rem] uppercase tracking-[0.26em] text-ivory transition hover:bg-gold hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"><ShoppingBag size={16} />{product.availability === 'sold_out' ? 'Sold Out' : 'Add to Bag'}</button><button type="button" onClick={saveProduct} aria-pressed={saved} aria-label={saved ? 'Remove from wishlist' : 'Add to wishlist'} className="grid w-14 place-items-center border border-black/15 transition hover:border-gold hover:text-gold dark:border-white/20"><Heart size={18} className={saved ? 'fill-gold text-gold' : ''} /></button></div>
          {message ? <p className="mt-4 text-xs text-gold">{message}</p> : null}
          <dl className="mt-10 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-black/12 pt-7 text-xs dark:border-white/15">{[['Material', product.attributes?.material], ['Fabric', product.attributes?.fabric], ['Color', product.attributes?.colors?.join(', ') || product.attributes?.color], ['Customization', product.attributes?.customizationInformation]].filter((item) => item[1]).map(([label, value]) => <div key={String(label)}><dt className="text-[0.52rem] uppercase tracking-[0.25em] text-charcoal/42">{label}</dt><dd className="mt-1.5 text-charcoal/70">{String(value)}</dd></div>)}</dl>
        </div>
      </div>
    </section><Footer />
  </main>;
}
