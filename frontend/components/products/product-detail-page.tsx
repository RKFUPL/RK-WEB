'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ChevronLeft, ChevronRight, Check, Heart, Image as ImageIcon, Minus, Plus, Ruler, ShoppingBag, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import { SizeChartPopover } from '@/components/products/size-chart-popover';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { availabilityLabels, inr, type CatalogProduct, type ManagedCollection } from '@/lib/catalog';
import { apiBaseUrl } from '@/lib/rbac';
import { addStoredCartItem } from '@/lib/storefront-cart';
import { readWishlist, toggleWishlist, wishlistChangedEvent } from '@/lib/storefront-wishlist';

function textValue(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return value === undefined || value === null ? '' : String(value);
}

const defaultCustomSizeFields = [
  'Bust',
  'Waist',
  'Hip',
  'Shoulder',
  'Armhole',
  'Sleeve Length',
  'Height',
  'Blouse/Top Length',
  'Bottom Length',
  'Inseam',
];

export function ProductDetailPage({ productId }: { productId: string }) {
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [collections, setCollections] = useState<ManagedCollection[]>([]);
  const [saved, setSaved] = useState(false);
  const [selectedSize, setSelectedSize] = useState('');
  const [customSizeOpen, setCustomSizeOpen] = useState(false);
  const [customSizeError, setCustomSizeError] = useState('');
  const [customSizeUnit, setCustomSizeUnit] = useState<'cm' | 'in'>('cm');
  const [customMeasurements, setCustomMeasurements] = useState<Record<string, string>>({});
  const [activeImage, setActiveImage] = useState(0);
  const mainImageFrameRef = useRef<HTMLDivElement>(null);
  const thumbnailRailRef = useRef<HTMLDivElement>(null);
  const thumbnailRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [thumbnailViewportHeight, setThumbnailViewportHeight] = useState<number>();
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
    if (!customSizeOpen) return undefined;
    setCustomSizeError('');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [customSizeOpen]);

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

  useEffect(() => {
    const rail = thumbnailRailRef.current;
    const thumbnail = thumbnailRefs.current[activeImage];
    if (!rail || !thumbnail) return;

    const vertical = window.matchMedia('(min-width: 1024px)').matches;
    const itemStart = vertical ? thumbnail.offsetTop : thumbnail.offsetLeft;
    const itemSize = vertical ? thumbnail.offsetHeight : thumbnail.offsetWidth;
    const viewportStart = vertical ? rail.scrollTop : rail.scrollLeft;
    const viewportSize = vertical ? rail.clientHeight : rail.clientWidth;
    const itemEnd = itemStart + itemSize;
    const viewportEnd = viewportStart + viewportSize;

    if (itemStart < viewportStart || itemEnd > viewportEnd) {
      rail.scrollTo(vertical
        ? { top: itemStart, behavior: 'smooth' }
        : { left: itemStart, behavior: 'smooth' });
    }
  }, [activeImage]);

  useEffect(() => {
    const mainImageFrame = mainImageFrameRef.current;
    const rail = thumbnailRailRef.current;
    const firstThumbnail = thumbnailRefs.current[0];
    if (!mainImageFrame || !rail || !firstThumbnail || (product?.media.length ?? 0) < 2) return undefined;

    const updateViewportHeight = () => {
      if (!window.matchMedia('(min-width: 1024px)').matches) {
        setThumbnailViewportHeight(undefined);
        return;
      }

      const availableHeight = mainImageFrame.getBoundingClientRect().height;
      const thumbnailHeight = firstThumbnail.getBoundingClientRect().height;
      const styles = window.getComputedStyle(rail);
      const gap = Number.parseFloat(styles.rowGap || styles.gap) || 0;
      const thumbnailCount = product?.media.length ?? 0;
      const completeContentHeight = thumbnailCount * thumbnailHeight + Math.max(0, thumbnailCount - 1) * gap;
      const visibleCount = Math.max(1, Math.floor((availableHeight + gap) / (thumbnailHeight + gap)));
      const completeViewportHeight = visibleCount * thumbnailHeight + Math.max(0, visibleCount - 1) * gap;

      setThumbnailViewportHeight(Math.min(completeContentHeight, completeViewportHeight));
    };

    const resizeObserver = new ResizeObserver(updateViewportHeight);
    resizeObserver.observe(mainImageFrame);
    resizeObserver.observe(firstThumbnail);
    updateViewportHeight();

    return () => resizeObserver.disconnect();
  }, [product?.media.length]);

  if (notFound) return <main className="min-h-screen bg-ivory text-charcoal"><StickyHeader /><div className="mx-auto max-w-3xl px-6 pb-24 pt-40 text-center"><p className="text-[0.6rem] uppercase tracking-[0.35em] text-gold">Product unavailable</p><h1 className="mt-5 font-display text-5xl">This piece could not be found.</h1><Link href="/collections" className="mt-10 inline-flex border-b border-charcoal/40 pb-2 text-xs uppercase tracking-[0.28em]">Explore collections</Link></div><Footer /></main>;
  if (!product) return <main className="min-h-screen bg-ivory text-charcoal"><StickyHeader /><div className="mx-auto grid max-w-[100rem] animate-pulse gap-10 px-6 pb-24 pt-32 lg:grid-cols-2 lg:px-12"><div className="aspect-[4/5] rounded-[14px] bg-sand" /><div className="space-y-5 py-10"><div className="h-3 w-24 bg-sand" /><div className="h-16 w-3/4 bg-sand" /><div className="h-4 w-32 bg-sand" /></div></div></main>;

  const media = product.media ?? [];
  const sizeInventory = product.sizeInventory ?? [];
  const sizeConfigured = product.sizeInventoryConfigured === true;
  const sizes = sizeConfigured ? sizeInventory.map((item) => item.size) : [];
  const selectedSizeEntry = sizeInventory.find((item) => item.size === selectedSize);
  const hasCustomSizeConfiguration = Array.isArray(product.customSizeConfig?.fields);
  const customOrderEnabled = hasCustomSizeConfiguration
    ? Boolean(product.customSizeConfig?.fields?.length)
    : sizeConfigured || product.availability === 'custom_order';
  const customSizeFields = hasCustomSizeConfiguration
    ? product.customSizeConfig?.fields ?? []
    : customOrderEnabled ? defaultCustomSizeFields : [];
  const backCollection = collections[0];
  const route = `/products/${product.id}`;
  const currentImage = media[activeImage] || media[0];
  const quantityStockLimit = product.availability === 'in_stock' ? selectedSizeEntry?.stock ?? product.stock : undefined;
  const requireSignIn = () => {
    if (window.localStorage.getItem('rk_access_token')) return true;
    window.alert('Please sign in to use your wishlist or shopping bag.');
    return false;
  };
  const previousImage = () => setActiveImage((index) => media.length ? (index - 1 + media.length) % media.length : 0);
  const nextImage = () => setActiveImage((index) => media.length ? (index + 1) % media.length : 0);
  const saveProduct = () => {
    if (!requireSignIn()) return;
    const added = toggleWishlist({ productId: product.id, name: product.name || 'Untitled piece', price: product.price, image: media[0], category: product.category || 'Couture', availability: availabilityLabels[product.availability], stock: product.stock, sizeOptions: sizes, sizeStock: Object.fromEntries(sizeInventory.map((entry) => [entry.size, entry.stock])), route });
    setSaved(added);
    if (added) trackAnalyticsEvent('wishlist_add', { productId: product.id, productName: product.name, currency: 'INR', value: product.price });
  };
  const addToCart = () => {
    if (!requireSignIn()) return;
    if (sizeConfigured && !selectedSize && !customMeasurements._customReady) { setMessage('Please select a size.'); return; }
    const customSize = customMeasurements._customReady ? { unit: customSizeUnit, measurements: Object.fromEntries(Object.entries(customMeasurements).filter(([key]) => key !== '_customReady')) } : undefined;
    addStoredCartItem({ productId: product.id, name: product.name || 'Untitled piece', price: Number(product.price || 0), quantity, image: media[0], stock: selectedSizeEntry?.stock ?? product.stock, availability: availabilityLabels[product.availability], size: selectedSize || undefined, sizeOptions: sizes, sizeStock: Object.fromEntries(sizeInventory.map((entry) => [entry.size, entry.stock])), inventoryMode: sizeConfigured ? 'size' : 'legacy', purchaseMode: customSize ? 'custom_size' : 'standard_size', customSize, variant: selectedSize ? { id: `size:${selectedSize}`, name: 'Size', value: selectedSize } : customSize ? { id: `custom:${JSON.stringify(customSize)}`, name: 'Size', value: 'Custom' } : undefined });
    trackAnalyticsEvent('add_to_bag', { productId: product.id, productName: product.name, currency: 'INR', value: product.price, quantity });
    setMessage('Added to your shopping bag.');
  };
  const saveCustomMeasurements = () => {
    if (customSizeFields.some((field) => !customMeasurements[field]?.trim())) {
      setCustomSizeError('Complete every custom measurement.');
      return;
    }
    const invalidField = customSizeFields.find((field) => {
      const value = Number(customMeasurements[field]);
      return !Number.isFinite(value) || value <= 0 || value > 500;
    });
    if (invalidField) {
      setCustomSizeError(`Enter a valid number for ${invalidField}.`);
      return;
    }
    setCustomSizeError('');
    setSelectedSize('');
    setCustomMeasurements((current) => ({ ...current, _customReady: 'true' }));
    setCustomSizeOpen(false);
    setMessage('Custom measurements saved.');
  };
  const attributes = product.attributes || {};
  const informationSections = [
    { id: 'description', label: 'Description', value: textValue(product.description) || 'Product description coming soon.' },
    { id: 'details', label: 'Product Details', value: textValue(attributes.productDetails || attributes.details || attributes.customizationInformation) || 'Contact the RK team for additional product details.' },
    { id: 'size-fit', label: 'Size & Fit', value: textValue(attributes.sizeFit || attributes.sizing || (sizes.length ? 'Available sizes: ' + sizes.join(', ') : '')) || 'Contact the RK team for personalised sizing guidance.' },
    { id: 'care', label: 'Care Guide', value: [textValue(attributes.careGuide || attributes.care), [textValue(attributes.fabric), textValue(attributes.material)].filter(Boolean).join(' · ')].filter(Boolean).join(' · ') || 'Contact the RK team for care guidance specific to this piece.' },
    ...(textValue(attributes.deliveryInformation || attributes.deliveryReturns) ? [{ id: 'delivery', label: 'Delivery & Returns', value: textValue(attributes.deliveryInformation || attributes.deliveryReturns) }] : []),
  ];

  return <main className="bg-ivory text-charcoal"><StickyHeader />
    <section className="mx-auto max-w-[100rem] px-4 pb-20 pt-28 sm:px-8 lg:px-12 lg:pb-28 lg:pt-32">
      {backCollection ? <Link href={`/collections/${backCollection.slug}`} className="mb-7 inline-flex items-center gap-2 text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/55 transition hover:text-gold"><ArrowLeft size={14} />{backCollection.name}</Link> : null}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,35rem)_5.5rem_minmax(20rem,1fr)] lg:gap-3 xl:grid-cols-[minmax(0,35rem)_6.5rem_minmax(22rem,1fr)] xl:gap-4">
        <div className="flex justify-center lg:justify-start">
          <div ref={mainImageFrameRef} className="relative aspect-[4/5] h-auto w-full max-w-[35rem] overflow-hidden rounded-[14px] bg-sand">
            {currentImage ? <button type="button" onClick={() => setLightboxOpen(true)} className="absolute inset-0 cursor-zoom-in" aria-label="Open product image gallery"><Image src={currentImage} alt={product.name || 'Product'} fill priority className="object-contain transition-opacity duration-500" sizes="(max-width: 1024px) 100vw, 58vw" /></button> : <div className="grid h-full place-items-center text-center text-charcoal/40"><div><ImageIcon size={30} strokeWidth={1.2} className="mx-auto" /><p className="mt-4 text-[0.58rem] uppercase tracking-[0.3em]">Product image coming soon</p></div></div>}
            {media.length > 1 ? <><button type="button" onClick={previousImage} aria-label="Previous product image" className="absolute left-4 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-ivory/85 text-charcoal shadow-sm backdrop-blur-sm transition hover:text-gold"><ChevronLeft size={18} /></button><button type="button" onClick={nextImage} aria-label="Next product image" className="absolute right-4 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-ivory/85 text-charcoal shadow-sm backdrop-blur-sm transition hover:text-gold"><ChevronRight size={18} /></button></> : null}
          </div>
        </div>
        {media.length > 1 ? <div ref={thumbnailRailRef} style={thumbnailViewportHeight ? { maxHeight: `${thumbnailViewportHeight}px` } : undefined} className="rk-product-thumbnail-rail rk-gallery-scroll flex max-w-full snap-x gap-3 overflow-x-auto overflow-y-hidden pb-1 lg:w-[5.5rem] lg:snap-y lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0 xl:w-[6.5rem]">{media.map((image, index) => <button ref={(node) => { thumbnailRefs.current[index] = node; }} key={image + index} type="button" onClick={() => setActiveImage(index)} aria-label={`Show product image ${index + 1}`} aria-current={activeImage === index} className={activeImage === index ? 'relative aspect-[3/4] w-[5.5rem] shrink-0 snap-start overflow-hidden rounded-[12px] bg-sand ring-1 ring-gold ring-offset-2 ring-offset-ivory lg:w-full' : 'relative aspect-[3/4] w-[5.5rem] shrink-0 snap-start overflow-hidden rounded-[12px] bg-sand opacity-65 transition hover:opacity-100 lg:w-full'}><Image src={image} alt="" fill className="object-cover" sizes="(max-width: 1023px) 5.5rem, 6.5rem" /></button>)}</div> : null}
        <div className={media.length > 1 ? 'lg:sticky lg:top-28 lg:self-start' : 'lg:sticky lg:top-28 lg:col-start-3 lg:self-start'}>
          <p className="text-[0.58rem] uppercase tracking-[0.32em] text-gold">{product.category || 'Couture'}</p>
          <h1 className="mt-3 font-display text-5xl leading-[0.95] sm:text-6xl">{product.name}</h1>
          {product.sku ? <p className="mt-3 text-[0.62rem] uppercase tracking-[0.25em] text-charcoal/45">{product.sku}</p> : null}
          <p className="mt-5 text-lg">{product.price === undefined ? 'Price on request' : inr.format(product.price)}</p>
          <p className="mt-2 text-[0.58rem] uppercase tracking-[0.25em] text-gold">{availabilityLabels[product.availability]}</p>
          {sizeConfigured ? <fieldset className="mt-5"><legend className="sr-only">Choose a size</legend><div className="flex items-center justify-between gap-4"><span className="text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/50">Size</span><SizeChartPopover /></div><div className="mt-3 flex flex-wrap gap-2">{sizes.map((size) => { const item = sizeInventory.find((entry) => entry.size === size); const unavailable = item?.enabled === false || product.availability === 'sold_out' || (product.availability === 'in_stock' && (!item || item.stock <= 0)); return <button key={size} type="button" disabled={unavailable} onClick={() => { setSelectedSize(size); setCustomMeasurements({}); setQuantity(1); setMessage(''); }} aria-label={`${size}${unavailable ? ', unavailable' : ''}`} className={`min-w-12 border px-3 py-2.5 text-xs transition ${selectedSize === size ? 'border-gold bg-gold text-ink' : 'border-black/15 hover:border-gold dark:border-white/20'} ${unavailable ? 'cursor-not-allowed opacity-30' : ''}`}>{size}</button>; })}</div>{product.availability === 'in_stock' && selectedSizeEntry ? <p className="mt-2 text-xs text-charcoal/55">{selectedSizeEntry.stock} available in {selectedSize}.</p> : null}{customSizeFields.length ? <button type="button" onClick={() => setCustomSizeOpen(true)} className="mt-3 inline-flex items-center gap-2 border-b border-charcoal/30 pb-2 text-[0.58rem] uppercase tracking-[0.22em] text-charcoal/70 transition hover:border-gold hover:text-gold"><Ruler size={14} />Want a custom size?</button> : null}</fieldset> : customSizeFields.length ? <button type="button" onClick={() => setCustomSizeOpen(true)} className="mt-5 inline-flex items-center gap-2 border-b border-charcoal/30 pb-2 text-[0.58rem] uppercase tracking-[0.22em] text-charcoal/70 transition hover:border-gold hover:text-gold"><Ruler size={14} />Want a custom size?</button> : null}
          {customMeasurements._customReady ? <p className="mt-2 text-xs text-gold">Custom measurements added to this piece.</p> : null}
          <div className="mt-5 flex items-center justify-between border-y border-black/12 py-3 dark:border-white/15"><span className="text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/50">Quantity</span><div className="flex items-center gap-4"><button type="button" disabled={product.availability === 'sold_out' || quantity <= 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity" className="grid h-8 w-8 place-items-center border border-black/15 transition hover:border-gold disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/20"><Minus size={13} /></button><span className="min-w-5 text-center text-sm">{quantity}</span><button type="button" disabled={product.availability === 'sold_out' || (quantityStockLimit !== undefined && quantity >= quantityStockLimit)} onClick={() => setQuantity((value) => value + 1)} aria-label="Increase quantity" className="grid h-8 w-8 place-items-center border border-black/15 transition hover:border-gold disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/20"><Plus size={13} /></button></div></div>
          <div className="mt-5 grid grid-cols-[1fr_auto] gap-3"><button type="button" onClick={addToCart} disabled={product.availability === 'sold_out'} className="inline-flex items-center justify-center gap-3 bg-ink px-5 py-3.5 text-[0.62rem] uppercase tracking-[0.26em] text-ivory transition hover:bg-gold hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"><ShoppingBag size={16} />{product.availability === 'sold_out' ? 'Sold out' : 'Add to cart'}</button><button type="button" onClick={saveProduct} aria-pressed={saved} aria-label={saved ? 'Remove from wishlist' : 'Add to wishlist'} className="grid w-14 place-items-center border border-black/15 transition hover:border-gold hover:text-gold dark:border-white/20"><Heart size={18} className={saved ? 'fill-gold text-gold' : ''} /></button></div>
          {message ? <p className="mt-3 text-xs text-gold">{message}</p> : null}
          {informationSections.length ? <div className="mt-7 border-t border-black/12 dark:border-white/15">{informationSections.map((section) => <div key={section.id} className="border-b border-black/12 dark:border-white/15"><button type="button" onClick={() => setOpenSection((current) => current === section.id ? '' : section.id)} aria-expanded={openSection === section.id} className="flex w-full items-center justify-between py-4 text-left text-[0.6rem] uppercase tracking-[0.28em]"><span>{section.label}</span><Plus size={15} className={`transition-transform ${openSection === section.id ? 'rotate-45' : ''}`} /></button><AnimatePresence initial={false}>{openSection === section.id ? <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden"><p className="pb-5 text-sm leading-7 text-charcoal/65">{section.value}</p></motion.div> : null}</AnimatePresence></div>)}</div> : null}
        </div>
      </div>
    </section>
    <Footer />
    <AnimatePresence>
      {customSizeOpen ? <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[110] grid place-items-center bg-ink/65 p-4"
        onClick={() => setCustomSizeOpen(false)}
      >
        <motion.div
          initial={{ y: 18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 18, opacity: 0 }}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Enter custom measurements"
          className="max-h-[90vh] w-full max-w-lg overflow-y-auto bg-ivory p-6 text-charcoal shadow-2xl sm:p-8"
        >
          <div className="flex items-start justify-between gap-5">
            <div>
              <p className="text-[0.58rem] uppercase tracking-[0.28em] text-gold">Made for you</p>
              <h2 className="mt-3 font-display text-3xl">Custom measurements</h2>
            </div>
            <button type="button" onClick={() => setCustomSizeOpen(false)} aria-label="Close custom measurements"><X size={19} /></button>
          </div>
          <p className="mt-4 text-sm leading-6 text-charcoal/60">Enter the measurements requested for this piece. They will remain attached to your order for the RK team.</p>
          <label className="mt-6 block text-[0.58rem] uppercase tracking-[0.22em] text-charcoal/50">
            Unit
            <select value={customSizeUnit} onChange={(event) => setCustomSizeUnit(event.target.value as 'cm' | 'in')} className="mt-2 w-full border-b border-black/15 bg-transparent py-3 text-sm outline-none">
              <option value="cm">Centimetres (cm)</option>
              <option value="in">Inches (in)</option>
            </select>
          </label>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {customSizeFields.map((field) => <label key={field} className="text-[0.58rem] uppercase tracking-[0.18em] text-charcoal/50">
              {field}
              <input
                inputMode="decimal"
                value={customMeasurements[field] ?? ''}
                onChange={(event) => setCustomMeasurements((current) => ({ ...current, [field]: event.target.value, _customReady: '' }))}
                className="mt-2 w-full border-b border-black/15 bg-transparent py-3 text-sm normal-case tracking-normal outline-none"
              />
            </label>)}
          </div>
          {customSizeError ? <p role="alert" className="mt-5 text-sm text-red-700">{customSizeError}</p> : null}
          <button type="button" onClick={saveCustomMeasurements} className="mt-8 inline-flex w-full items-center justify-center gap-2 bg-ink px-5 py-4 text-[0.6rem] uppercase tracking-[0.24em] text-ivory transition hover:bg-gold hover:text-ink"><Check size={14} />Use these measurements</button>
        </motion.div>
      </motion.div> : null}
    </AnimatePresence>
    <AnimatePresence>{lightboxOpen && currentImage ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label="Product image gallery" className="fixed inset-0 z-[100] grid place-items-center bg-ink/95 p-4 sm:p-8"><button type="button" onClick={() => setLightboxOpen(false)} aria-label="Close image gallery" className="absolute right-5 top-5 z-10 grid h-11 w-11 place-items-center rounded-full border border-white/25 text-white transition hover:border-gold hover:text-gold"><X size={20} /></button><div className="relative h-[min(86vh,56rem)] w-[min(92vw,72rem)]"><Image src={currentImage} alt={product.name || 'Product'} fill className="object-contain" sizes="92vw" /></div>{media.length > 1 ? <><button type="button" onClick={previousImage} aria-label="Previous product image" className="absolute left-4 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/25 text-white transition hover:border-gold hover:text-gold sm:left-8"><ChevronLeft size={22} /></button><button type="button" onClick={nextImage} aria-label="Next product image" className="absolute right-4 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/25 text-white transition hover:border-gold hover:text-gold sm:right-8"><ChevronRight size={22} /></button></> : null}</motion.div> : null}</AnimatePresence>
  </main>;
}
