'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ChevronLeft, ChevronRight, Heart, Image as ImageIcon, Minus, Plus, ShoppingBag, X } from 'lucide-react';
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

function textValue(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return value === undefined || value === null ? '' : String(value);
}

export function ProductDetailPage({ productId }: { productId: string }) {
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [collections, setCollections] = useState<ManagedCollection[]>([]);
  const [saved, setSaved] = useState(false);
  const [selectedSize, setSelectedSize] = useState('');
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [openSection, setOpenSection] = useState('');
  const [message, setMessage] = useState('');
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setProduct(null);
    setNotFound(false);
    setActiveImage(0);
    setQuantity(1);
    fetch(`${apiBaseUrl}/api/catalog/products/${encodeURIComponent(productId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Product not found.');
        return payload;
      })
      .then((payload) => {
        setProduct(payload.product);
        setCollections(payload.collections || []);
        trackAnalyticsEvent('product_view', { productId, productName: payload.product.name, currency: 'INR', value: payload.product.price });
      })
      .catch(() => setNotFound(true));
  }, [productId]);

  useEffect(() => {
    const sync = () => setSaved(readWishlist().some((item) => item.productId === productId));
    sync();
    window.addEventListener(wishlistChangedEvent, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(wishlistChangedEvent, sync); window.removeEventListener('storage', sync); };
  }, [productId]);

  useEffect(() => {
    if (!lightboxOpen || !product?.media.length) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxOpen(false);
      if (event.key === 'ArrowLeft') setActiveImage((index) => (index - 1 + product.media.length) % product.media.length);
      if (event.key === 'ArrowRight') setActiveImage((index) => (index + 1) % product.media.length);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKeyDown); };
  }, [lightboxOpen, product]);

  if (notFound) return <main className="min-h-screen bg-ivory text-charcoal"><StickyHeader /><div className="mx-auto max-w-3xl px-6 pb-24 pt-40 text-center"><p className="text-[0.6rem] uppercase tracking-[0.35em] text-gold">Product unavailable</p><h1 className="mt-5 font-display text-5xl">This piece could not be found.</h1><Link href="/collections" className="mt-10 inline-flex border-b border-charcoal/40 pb-2 text-xs uppercase tracking-[0.28em]">Explore collections</Link></div><Footer /></main>;
  if (!product) return <main className="min-h-screen bg-ivory text-charcoal"><StickyHeader /><div className="mx-auto grid max-w-[100rem] animate-pulse gap-10 px-6 pb-24 pt-32 lg:grid-cols-2 lg:px-12"><div className="aspect-[4/5] bg-sand" /><div className="space-y-5 py-10"><div className="h-3 w-24 bg-sand" /><div className="h-16 w-3/4 bg-sand" /><div className="h-4 w-32 bg-sand" /></div></div></main>;

  const media = product.media ?? [];
  const sizes = product.attributes?.sizes ?? [];
  const backCollection = collections[0];
  const route = `/products/${product.id}`;
  const currentImage = media[activeImage] || media[0];
  const requireSignIn = () => {
    if (window.localStorage.getItem('rk_access_token')) return true;
    window.alert('Please sign in to use your wishlist or shopping bag.');
    return false;
  };
  const previousImage = () => setActiveImage((index) => media.length ? (index - 1 + media.length) % media.length : 0);
  const nextImage = () => setActiveImage((index) => media.length ? (index + 1) % media.length : 0);
  const saveProduct = () => {
    if (!requireSignIn()) return;
    const added = toggleWishlist({ productId: product.id, name: product.name || 'Untitled piece', price: product.price, image: media[0], category: product.category || 'Couture', availability: availabilityLabels[product.availability], route });
    setSaved(added);
    if (added) trackAnalyticsEvent('wishlist_add', { productId: product.id, productName: product.name, currency: 'INR', value: product.price });
  };
  const addToCart = () => {
    if (!requireSignIn()) return;
    if (sizes.length && !selectedSize) { setMessage('Please select a size.'); return; }
    addStoredCartItem({ productId: product.id, name: product.name || 'Untitled piece', price: Number(product.price || 0), quantity, image: media[0], variant: selectedSize ? { id: `size:${selectedSize}`, name: 'Size', value: selectedSize } : undefined });
    trackAnalyticsEvent('add_to_bag', { productId: product.id, productName: product.name, currency: 'INR', value: product.price, quantity });
    setMessage('Added to your shopping bag.');
  };
  const attributes = product.attributes || {};
  const informationSections = [
    { id: 'details', label: 'Details', value: textValue(product.description) },
    { id: 'fabric', label: 'Fabric & Care', value: [textValue(attributes.fabric), textValue(attributes.material)].filter(Boolean).join(' · ') },
    { id: 'delivery', label: 'Delivery & Returns', value: textValue(attributes.deliveryInformation || attributes.deliveryReturns) },
  ].filter((section) => section.value);

  return <main className="bg-ivory text-charcoal"><StickyHeader />
    <section className="mx-auto max-w-[100rem] px-4 pb-20 pt-28 sm:px-8 lg:px-12 lg:pb-28 lg:pt-32">
      {backCollection ? <Link href={`/collections/${backCollection.slug}`} className="mb-7 inline-flex items-center gap-2 text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/55 transition hover:text-gold"><ArrowLeft size={14} />{backCollection.name}</Link> : null}
      <div className="grid gap-10 lg:grid-cols-[1.16fr_0.84fr] lg:gap-16 xl:gap-24">
        <div>
          <div className="relative aspect-[4/5] overflow-hidden bg-sand">
            {currentImage ? <button type="button" onClick={() => setLightboxOpen(true)} className="absolute inset-0 cursor-zoom-in" aria-label="Open product image gallery"><Image src={currentImage} alt={product.name || 'Product'} fill priority className="object-contain transition-opacity duration-500" sizes="(max-width: 1024px) 100vw, 58vw" /></button> : <div className="grid h-full place-items-center text-center text-charcoal/40"><div><ImageIcon size={30} strokeWidth={1.2} className="mx-auto" /><p className="mt-4 text-[0.58rem] uppercase tracking-[0.3em]">Product image coming soon</p></div></div>}
            {media.length > 1 ? <><button type="button" onClick={previousImage} aria-label="Previous product image" className="absolute left-4 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-ivory/85 text-charcoal shadow-sm backdrop-blur-sm transition hover:text-gold"><ChevronLeft size={18} /></button><button type="button" onClick={nextImage} aria-label="Next product image" className="absolute right-4 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-ivory/85 text-charcoal shadow-sm backdrop-blur-sm transition hover:text-gold"><ChevronRight size={18} /></button></> : null}
          </div>
          {media.length > 1 ? <div className="mt-4 flex gap-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-5 lg:overflow-visible">{media.map((image, index) => <button key={`${image}-${index}`} type="button" onClick={() => setActiveImage(index)} aria-label={`Show product image ${index + 1}`} aria-current={activeImage === index} className={`relative aspect-[3/4] min-w-20 overflow-hidden bg-sand transition sm:min-w-24 lg:min-w-0 ${activeImage === index ? 'ring-1 ring-gold' : 'opacity-65 hover:opacity-100'}`}><Image src={image} alt="" fill className="object-contain" sizes="(max-width: 1024px) 6rem, 12vw" /></button>)}</div> : null}
        </div>
        <div className="lg:sticky lg:top-32 lg:self-start">
          <p className="text-[0.58rem] uppercase tracking-[0.32em] text-gold">{product.category || 'Couture'}</p>
          <h1 className="mt-5 font-display text-5xl leading-[0.95] sm:text-6xl">{product.name}</h1>
          {product.sku ? <p className="mt-4 text-[0.62rem] uppercase tracking-[0.25em] text-charcoal/45">{product.sku}</p> : null}
          <p className="mt-8 text-lg">{product.price === undefined ? 'Price on request' : inr.format(product.price)}</p>
          <p className="mt-3 text-[0.58rem] uppercase tracking-[0.25em] text-gold">{availabilityLabels[product.availability]}</p>
          {sizes.length ? <fieldset className="mt-8"><legend className="text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/50">Select size</legend><div className="mt-4 flex flex-wrap gap-2">{sizes.map((size) => <button key={size} type="button" onClick={() => { setSelectedSize(size); setMessage(''); }} className={`min-w-12 border px-4 py-3 text-xs transition ${selectedSize === size ? 'border-gold bg-gold text-ink' : 'border-black/15 hover:border-gold dark:border-white/20'}`}>{size}</button>)}</div></fieldset> : null}
          <div className="mt-8 flex items-center justify-between border-y border-black/12 py-4 dark:border-white/15"><span className="text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/50">Quantity</span><div className="flex items-center gap-4"><button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity" className="grid h-8 w-8 place-items-center border border-black/15 transition hover:border-gold dark:border-white/20"><Minus size={13} /></button><span className="min-w-5 text-center text-sm">{quantity}</span><button type="button" onClick={() => setQuantity((value) => value + 1)} aria-label="Increase quantity" className="grid h-8 w-8 place-items-center border border-black/15 transition hover:border-gold dark:border-white/20"><Plus size={13} /></button></div></div>
          <div className="mt-7 grid grid-cols-[1fr_auto] gap-3"><button type="button" onClick={addToCart} disabled={product.availability === 'sold_out'} className="inline-flex items-center justify-center gap-3 bg-ink px-6 py-4 text-[0.62rem] uppercase tracking-[0.26em] text-ivory transition hover:bg-gold hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"><ShoppingBag size={16} />{product.availability === 'sold_out' ? 'Sold out' : 'Add to cart'}</button><button type="button" onClick={saveProduct} aria-pressed={saved} aria-label={saved ? 'Remove from wishlist' : 'Add to wishlist'} className="grid w-14 place-items-center border border-black/15 transition hover:border-gold hover:text-gold dark:border-white/20"><Heart size={18} className={saved ? 'fill-gold text-gold' : ''} /></button></div>
          {message ? <p className="mt-4 text-xs text-gold">{message}</p> : null}
          {informationSections.length ? <div className="mt-10 border-t border-black/12 dark:border-white/15">{informationSections.map((section) => <div key={section.id} className="border-b border-black/12 dark:border-white/15"><button type="button" onClick={() => setOpenSection((current) => current === section.id ? '' : section.id)} aria-expanded={openSection === section.id} className="flex w-full items-center justify-between py-5 text-left text-[0.6rem] uppercase tracking-[0.28em]"><span>{section.label}</span><Plus size={15} className={`transition-transform ${openSection === section.id ? 'rotate-45' : ''}`} /></button><AnimatePresence initial={false}>{openSection === section.id ? <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden"><p className="pb-5 text-sm leading-7 text-charcoal/65">{section.value}</p></motion.div> : null}</AnimatePresence></div>)}</div> : null}
        </div>
      </div>
    </section>
    <Footer />
    <AnimatePresence>{lightboxOpen && currentImage ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label="Product image gallery" className="fixed inset-0 z-[100] grid place-items-center bg-ink/95 p-4 sm:p-8"><button type="button" onClick={() => setLightboxOpen(false)} aria-label="Close image gallery" className="absolute right-5 top-5 z-10 grid h-11 w-11 place-items-center rounded-full border border-white/25 text-white transition hover:border-gold hover:text-gold"><X size={20} /></button><div className="relative h-[min(86vh,56rem)] w-[min(92vw,72rem)]"><Image src={currentImage} alt={product.name || 'Product'} fill className="object-contain" sizes="92vw" /></div>{media.length > 1 ? <><button type="button" onClick={previousImage} aria-label="Previous product image" className="absolute left-4 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/25 text-white transition hover:border-gold hover:text-gold sm:left-8"><ChevronLeft size={22} /></button><button type="button" onClick={nextImage} aria-label="Next product image" className="absolute right-4 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/25 text-white transition hover:border-gold hover:text-gold sm:right-8"><ChevronRight size={22} /></button></> : null}</motion.div> : null}</AnimatePresence>
  </main>;
}
