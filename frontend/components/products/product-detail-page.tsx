'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ChevronLeft, ChevronRight, Check, Heart, Image as ImageIcon, Mail, Minus, Plus, Ruler, ShoppingBag, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import { CollectionProductCard } from '@/components/collections/collection-product-card';
import { SizeChartPopover } from '@/components/products/size-chart-popover';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { availabilityLabels, inr, type CatalogProduct, type ManagedCollection } from '@/lib/catalog';
import { apiBaseUrl } from '@/lib/rbac';
import { addStoredCartItem } from '@/lib/storefront-cart';
import { readWishlist, toggleWishlist, wishlistChangedEvent } from '@/lib/storefront-wishlist';
import { cloudinaryImageUrl } from '@/lib/utils';

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

const standardSizes = ['XS', 'S', 'M', 'L', 'XL'];

function belongsToCollection(collection: ManagedCollection, collectionName: string) {
  const matcher = new RegExp(`(^|[\\s_-])${collectionName.toLowerCase()}($|[\\s_-])`);
  return [collection.collectionType, collection.name, collection.slug, collection.status].some((value) => matcher.test(String(value || '').trim().toLowerCase()));
}

export function ProductDetailPage({ productId }: { productId: string }) {
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [collections, setCollections] = useState<ManagedCollection[]>([]);
  const [relatedProducts, setRelatedProducts] = useState<CatalogProduct[]>([]);
  const [relatedProductsLoading, setRelatedProductsLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  const [customSizeOpen, setCustomSizeOpen] = useState(false);
  const [customSizeError, setCustomSizeError] = useState('');
  const [customOrderOpen, setCustomOrderOpen] = useState(false);
  const [customOrderName, setCustomOrderName] = useState('');
  const [customOrderEmail, setCustomOrderEmail] = useState('');
  const [customOrderPhone, setCustomOrderPhone] = useState('');
  const [customOrderSize, setCustomOrderSize] = useState('');
  const [customOrderMessage, setCustomOrderMessage] = useState('');
  const [customOrderError, setCustomOrderError] = useState('');
  const [customOrderBusy, setCustomOrderBusy] = useState(false);
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
  const variantOptions = product?.variants ?? [];
  const selectedVariant = variantOptions.find((variant) => variant.id === selectedVariantId)
    ?? variantOptions.find((variant) => variant.status === 'active')
    ?? variantOptions[0];
  // A colour variant owns its gallery. Do not leak one colour's legacy media
  // into another colour that has not been photographed yet.
  const galleryMedia = selectedVariant
    ? selectedVariant.images ?? []
    : variantOptions.length
      ? []
      : product?.media ?? [];

  useEffect(() => {
    setProduct(null);
    setCollections([]);
    setRelatedProducts([]);
    setRelatedProductsLoading(false);
    setNotFound(false);
    setSelectedVariantId('');
    setSelectedSize('');
    setCustomMeasurements({});
    setActiveImage(0);
    setQuantity(1);
    fetch(`${apiBaseUrl}/api/catalog/products/${encodeURIComponent(productId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Product not found.');
        return payload;
      })
      .then((payload) => {
        const nextProduct = payload.product as CatalogProduct;
        const initialVariant = nextProduct.variants?.find((variant) => variant.status === 'active') ?? nextProduct.variants?.[0];
        setProduct(nextProduct);
        setSelectedVariantId(initialVariant?.id ?? '');
        setCollections(payload.collections || []);
        trackAnalyticsEvent('product_view', { productId, productName: nextProduct.name, currency: 'INR', value: initialVariant?.price ?? nextProduct.price });
      })
      .catch(() => setNotFound(true));
  }, [productId]);

  useEffect(() => {
    const collectionSlug = collections[0]?.slug;
    if (!collectionSlug) {
      setRelatedProducts([]);
      setRelatedProductsLoading(false);
      return undefined;
    }

    let active = true;
    setRelatedProductsLoading(true);
    fetch(`${apiBaseUrl}/api/catalog/collections/${encodeURIComponent(collectionSlug)}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load related products.');
        return payload.collection as ManagedCollection & { products?: CatalogProduct[] };
      })
      .then((collection) => {
        if (!active) return;
        setRelatedProducts((collection.products || []).filter((item) => item.id !== productId).slice(0, 4));
      })
      .catch(() => {
        if (active) setRelatedProducts([]);
      })
      .finally(() => {
        if (active) setRelatedProductsLoading(false);
      });

    return () => { active = false; };
  }, [collections, productId]);

  useEffect(() => {
    if (!customSizeOpen && !customOrderOpen) return undefined;
    setCustomSizeError('');
    setCustomOrderError('');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [customOrderOpen, customSizeOpen]);

  useEffect(() => {
    const sync = () => setSaved(readWishlist().some((item) => item.productId === productId));
    sync();
    window.addEventListener(wishlistChangedEvent, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(wishlistChangedEvent, sync); window.removeEventListener('storage', sync); };
  }, [productId]);

  useEffect(() => {
    if (!lightboxOpen || !galleryMedia.length) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxOpen(false);
      if (event.key === 'ArrowLeft') setActiveImage((index) => (index - 1 + galleryMedia.length) % galleryMedia.length);
      if (event.key === 'ArrowRight') setActiveImage((index) => (index + 1) % galleryMedia.length);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKeyDown); };
  }, [galleryMedia, lightboxOpen]);

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
    if (!mainImageFrame || !rail || !firstThumbnail || galleryMedia.length < 2) return undefined;

    const updateViewportHeight = () => {
      if (!window.matchMedia('(min-width: 1024px)').matches) {
        setThumbnailViewportHeight(undefined);
        return;
      }

      const availableHeight = mainImageFrame.getBoundingClientRect().height;
      const thumbnailHeight = firstThumbnail.getBoundingClientRect().height;
      const styles = window.getComputedStyle(rail);
      const gap = Number.parseFloat(styles.rowGap || styles.gap) || 0;
      const thumbnailCount = galleryMedia.length;
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
  }, [galleryMedia.length]);

  if (notFound) return <main className="min-h-screen bg-ivory text-charcoal"><StickyHeader /><div className="mx-auto max-w-3xl px-6 pb-24 pt-40 text-center"><p className="text-[0.6rem] uppercase tracking-[0.35em] text-gold">Product unavailable</p><h1 className="mt-5 font-display text-5xl">This piece could not be found.</h1><Link href="/collections" className="mt-10 inline-flex border-b border-charcoal/40 pb-2 text-xs uppercase tracking-[0.28em]">Explore collections</Link></div><Footer /></main>;
  if (!product) return <main className="min-h-screen bg-ivory text-charcoal"><StickyHeader /><div className="mx-auto grid max-w-[100rem] animate-pulse gap-10 px-6 pb-24 pt-32 lg:grid-cols-2 lg:px-12"><div className="aspect-[4/5] rounded-[14px] bg-sand" /><div className="space-y-5 py-10"><div className="h-3 w-24 bg-sand" /><div className="h-16 w-3/4 bg-sand" /><div className="h-4 w-32 bg-sand" /></div></div></main>;

  const media = galleryMedia;
  const sizeInventory = selectedVariant?.sizeInventory ?? product.sizeInventory ?? [];
  const sizeConfigured = Boolean(selectedVariant) || product.sizeInventoryConfigured === true;
  const isAnamikaProduct = collections.some((collection) => belongsToCollection(collection, 'anamika'));
  const isRunwayProduct = collections.some((collection) => belongsToCollection(collection, 'runway'));
  const attributeSizes = Array.isArray(product.attributes?.sizes) ? product.attributes.sizes.map((size) => String(size).trim().toUpperCase()).filter(Boolean) : [];
  const sizes = selectedVariant?.sizes?.length
    ? selectedVariant.sizes
    : isAnamikaProduct
      ? standardSizes
      : sizeConfigured
        ? sizeInventory.map((item) => item.size)
        : attributeSizes;
  const showSizeSelector = sizes.length > 0;
  const selectedSizeEntry = sizeInventory.find((item) => item.size === selectedSize);
  const configuredCustomSizeFields = Array.isArray(product.customSizeConfig?.fields) ? product.customSizeConfig.fields : [];
  const customSizeExplicitlyEnabled = typeof product.customSizeConfig?.enabled === 'boolean' ? product.customSizeConfig.enabled : undefined;
  const selectedAvailability = selectedVariant
    ? selectedVariant.status === 'active' ? 'in_stock' : 'sold_out'
    : product.availability;
  const selectedPrice = selectedVariant?.price ?? product.price;
  const selectedSku = selectedVariant?.sku || product.sku || '';
  const selectedColour = selectedVariant?.colour || textValue(product.attributes?.colors || product.attributes?.color);
  const customSizeEnabled = customSizeExplicitlyEnabled ?? (configuredCustomSizeFields.length > 0 || sizeConfigured || isAnamikaProduct || selectedAvailability === 'custom_order');
  const customSizeFields = customSizeEnabled ? (configuredCustomSizeFields.length ? configuredCustomSizeFields : defaultCustomSizeFields) : [];
  const backCollection = collections[0];
  const route = `/products/${product.id}`;
  const currentImage = media[activeImage] || media[0];
  const currentMainImage = cloudinaryImageUrl(currentImage, 1600);
  const soldOut = selectedAvailability === 'sold_out';
  const runwayCustomOrder = isRunwayProduct && selectedAvailability !== 'in_stock';
  const taxInclusive = product.taxInclusive === true || product.mrpIncludesGst === true || collections.some((collection) => collection.taxInclusive) || isAnamikaProduct;
  const requireSignIn = () => {
    if (window.localStorage.getItem('rk_access_token')) return true;
    window.alert('Please sign in to use your wishlist or shopping bag.');
    return false;
  };
  const previousImage = () => setActiveImage((index) => media.length ? (index - 1 + media.length) % media.length : 0);
  const nextImage = () => setActiveImage((index) => media.length ? (index + 1) % media.length : 0);
  const requestCustomOrder = () => {
    setCustomOrderError('');
    setCustomOrderOpen(true);
  };
  const chooseVariant = (variantId: string) => {
    setSelectedVariantId(variantId);
    setActiveImage(0);
    setSelectedSize('');
    setCustomMeasurements({});
    setQuantity(1);
    setMessage('');
    setLightboxOpen(false);
    thumbnailRefs.current = [];
  };
  const saveProduct = () => {
    if (!requireSignIn()) return;
    const added = toggleWishlist({ productId: product.id, variantId: selectedVariant?.id, sku: selectedSku, colour: selectedColour, name: product.name || 'Untitled piece', price: selectedPrice, image: selectedVariant?.images?.[0] || media[0], category: product.category || 'Couture', availability: availabilityLabels[selectedAvailability], stock: selectedVariant?.stock ?? product.stock, sizeOptions: sizes, sizeStock: Object.fromEntries(sizeInventory.map((entry) => [entry.size, entry.stock])), route });
    setSaved(added);
    if (added) trackAnalyticsEvent('wishlist_add', { productId: product.id, productName: product.name, currency: 'INR', value: selectedPrice });
  };
  const addToCart = () => {
    if (!requireSignIn()) return;
    if (!selectedVariant || selectedVariant.status !== 'active') { setMessage('Please choose an available colour.'); return; }
    if (selectedPrice === undefined) { setMessage('This colour does not have a valid price yet.'); return; }
    if (showSizeSelector && !selectedSize && !customMeasurements._customReady) { setMessage('Please select a size.'); return; }
    const customSize = customMeasurements._customReady ? { unit: customSizeUnit, measurements: Object.fromEntries(Object.entries(customMeasurements).filter(([key]) => key !== '_customReady')) } : undefined;
    addStoredCartItem({
      productId: product.id,
      productCode: product.productCode || product.parentSku || product.name || '',
      variantId: selectedVariant.id,
      sku: selectedVariant.sku,
      collection: backCollection?.name || '',
      colour: selectedVariant.colour,
      name: product.name || 'Untitled piece',
      price: Number(selectedPrice),
      quantity,
      image: media[0],
      availability: availabilityLabels[selectedAvailability],
      size: selectedSize || undefined,
      sizeOptions: sizes,
      sizeStock: Object.fromEntries(sizeInventory.map((entry) => [entry.size, entry.stock])),
      inventoryMode: 'variant',
      purchaseMode: customSize ? 'custom_size' : 'standard_size',
      customSize,
      variant: { id: selectedVariant.id, sku: selectedVariant.sku, colour: selectedVariant.colour, name: 'Colour', value: selectedVariant.colour || 'Default', status: selectedVariant.status },
    });
    trackAnalyticsEvent('add_to_bag', { productId: product.id, productName: product.name, currency: 'INR', value: selectedPrice, quantity });
    setMessage('Added to your shopping bag.');
  };
  const submitCustomOrder = async () => {
    if (!customOrderName.trim()) {
      setCustomOrderError('Enter your name.');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customOrderEmail.trim())) {
      setCustomOrderError('Enter a valid email address.');
      return;
    }

    setCustomOrderBusy(true);
    setCustomOrderError('');
    const measurements = Object.fromEntries(
      Object.entries(customMeasurements).filter(([key, value]) => key !== '_customReady' && value.trim()),
    );
    try {
      const response = await fetch(`${apiBaseUrl}/api/catalog/custom-order-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          variantId: selectedVariant?.id,
          name: customOrderName,
          email: customOrderEmail,
          phone: customOrderPhone,
          requestedSize: customOrderSize,
          measurements,
          message: customOrderMessage,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'The request could not be sent.');
      setCustomOrderOpen(false);
      setCustomOrderName('');
      setCustomOrderEmail('');
      setCustomOrderPhone('');
      setCustomOrderSize('');
      setCustomOrderMessage('');
      setCustomMeasurements({});
      setMessage(payload.message || 'Request received. The RK team will get back to you by email.');
    } catch (error) {
      setCustomOrderError(error instanceof Error ? error.message : 'The request could not be sent.');
    } finally {
      setCustomOrderBusy(false);
    }
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
  const productDescription = textValue(product.description);
  const summaryDescription = productDescription || 'Product description coming soon.';
  const detailedDescription = textValue(attributes.detailedDescription || attributes.descriptionDetails || attributes.longDescription);
  const informationSections = [
    {
      id: 'details',
      label: 'Product Details',
      content: <div className="space-y-4 text-sm leading-7 text-charcoal/65"><p>{productDescription || detailedDescription || textValue(attributes.productDetails || attributes.details || attributes.customizationInformation) || 'Contact the RK team for additional product details.'}</p>{selectedColour ? <p><span className="mr-2 text-[0.62rem] uppercase tracking-[0.2em] text-charcoal/45">Colour</span>{selectedColour}</p> : null}</div>,
    },
    {
      id: 'shipping',
      label: 'Shipping, Packaging & Returns',
      content: <ul className="space-y-2 text-sm leading-7 text-charcoal/65"><li>Complimentary shipping within India.</li><li>For international deliveries, shipping calculated at the checkout.</li><li>Package Dimensions: 55 cm x 39 cm x 24 cm</li></ul>,
    },
    {
      id: 'disclaimer',
      label: 'Disclaimer',
      content: <div className="space-y-3 text-sm leading-7 text-charcoal/65"><p>Please note, subtle variations in product colours may occur due to lighting and screen settings.</p><p>For bespoke customizations or assistance, kindly reach us at:</p><a href="mailto:orders@rashikapoorofficial.com" className="inline-block border-b border-charcoal/35 pb-0.5 text-charcoal transition hover:border-gold hover:text-gold">orders@rashikapoorofficial.com</a></div>,
    },
  ];

  return <main className="bg-ivory text-charcoal"><StickyHeader />
    <section className="mx-auto max-w-[100rem] px-4 pb-20 pt-28 sm:px-8 lg:px-12 lg:pb-28 lg:pt-32">
      {backCollection ? <Link href={`/collections/${backCollection.slug}`} className="mb-7 inline-flex items-center gap-2 text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/55 transition hover:text-gold"><ArrowLeft size={14} />{backCollection.name}</Link> : null}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,35rem)_5.5rem_minmax(20rem,1fr)] lg:gap-x-3 xl:grid-cols-[minmax(0,35rem)_6.5rem_minmax(22rem,1fr)] xl:gap-x-4">
        <div className="flex justify-center lg:justify-start">
          <div ref={mainImageFrameRef} className="relative aspect-[4/5] h-auto w-full max-w-[35rem] overflow-hidden rounded-[14px] bg-sand">
            {currentMainImage ? <button type="button" onClick={() => setLightboxOpen(true)} className="absolute inset-0 cursor-zoom-in" aria-label="Open product image gallery"><Image src={currentMainImage} alt={product.name || 'Product'} fill priority className="object-contain transition-opacity duration-500" sizes="(max-width: 1024px) 100vw, 58vw" /></button> : <div className="grid h-full place-items-center text-center text-charcoal/40"><div><ImageIcon size={30} strokeWidth={1.2} className="mx-auto" /><p className="mt-4 text-[0.58rem] uppercase tracking-[0.3em]">Product image coming soon</p></div></div>}
            {media.length > 1 ? <><button type="button" onClick={previousImage} aria-label="Previous product image" className="absolute left-4 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-ivory/85 text-charcoal shadow-sm backdrop-blur-sm transition hover:text-gold"><ChevronLeft size={18} /></button><button type="button" onClick={nextImage} aria-label="Next product image" className="absolute right-4 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-ivory/85 text-charcoal shadow-sm backdrop-blur-sm transition hover:text-gold"><ChevronRight size={18} /></button></> : null}
          </div>
        </div>
        {media.length > 1 ? <div ref={thumbnailRailRef} style={thumbnailViewportHeight ? { maxHeight: `${thumbnailViewportHeight}px` } : undefined} className="rk-product-thumbnail-rail rk-gallery-scroll flex max-w-full snap-x gap-3 overflow-x-auto overflow-y-hidden pb-1 lg:w-[5.5rem] lg:snap-y lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0 xl:w-[6.5rem]">{media.map((image, index) => <button ref={(node) => { thumbnailRefs.current[index] = node; }} key={image + index} type="button" onClick={() => setActiveImage(index)} aria-label={`Show product image ${index + 1}`} aria-current={activeImage === index} className={activeImage === index ? 'relative aspect-[3/4] w-[5.5rem] shrink-0 snap-start overflow-hidden rounded-[12px] bg-sand ring-1 ring-gold ring-offset-2 ring-offset-ivory lg:w-full' : 'relative aspect-[3/4] w-[5.5rem] shrink-0 snap-start overflow-hidden rounded-[12px] bg-sand opacity-65 transition hover:opacity-100 lg:w-full'}><Image src={cloudinaryImageUrl(image, 240) || image} alt="" fill className="object-cover" sizes="(max-width: 1023px) 5.5rem, 6.5rem" /></button>)}</div> : null}
        <div className={media.length > 1 ? 'lg:sticky lg:top-28 lg:self-start lg:pl-[clamp(4rem,5vw,6.25rem)] lg:pt-2' : 'lg:sticky lg:top-28 lg:col-start-3 lg:self-start lg:pl-[clamp(4rem,5vw,6.25rem)] lg:pt-2'}>
          <p className="text-xs font-normal uppercase tracking-[0.28em] text-gold">{product.category || 'Couture'}</p>
          {backCollection ? <p className="mt-4 font-display text-[clamp(1.75rem,2.2vw,2.125rem)] leading-none text-charcoal/85">{backCollection.name}</p> : null}
          <h1 className="mt-4 font-display text-[clamp(2.625rem,4vw,3.25rem)] leading-[0.95]">{product.name || 'Untitled piece'}</h1>
          {selectedSku ? <p className="mt-4 text-xs uppercase tracking-[0.24em] text-charcoal/45">SKU: {selectedSku}</p> : null}
          {variantOptions.length > 1 ? <label className="mt-5 block max-w-xs text-[0.58rem] uppercase tracking-[0.24em] text-charcoal/50">Colour<select value={selectedVariant?.id ?? ''} onChange={(event) => chooseVariant(event.target.value)} className="mt-2 w-full border border-black/15 bg-transparent px-3 py-3 text-sm normal-case tracking-normal text-charcoal outline-none transition focus:border-gold dark:border-white/20">{variantOptions.map((variant) => <option key={variant.id} value={variant.id}>{variant.colour || 'Default'}{variant.status === 'inactive' ? ' — Sold out' : ''}</option>)}</select></label> : selectedColour ? <p className="mt-2 text-xs uppercase tracking-[0.2em] text-charcoal/55"><span className="text-charcoal/40">Colour:</span> {selectedColour}</p> : null}
          <p className="mt-7 max-w-[34rem] text-[0.95rem] leading-7 text-charcoal/68">{summaryDescription}</p>
          <div className="mt-7 border-t border-black/12 pt-5 dark:border-white/15">
            <p className="text-lg">{selectedPrice === undefined ? 'Price on request' : inr.format(selectedPrice)}</p>
            {selectedPrice !== undefined && taxInclusive ? <p className="mt-2 text-[0.56rem] uppercase tracking-[0.2em] text-charcoal/45">MRP · Inclusive of GST</p> : null}
            <p className="mt-3 text-[0.58rem] uppercase tracking-[0.25em] text-gold">{availabilityLabels[selectedAvailability]}</p>
          </div>
          {runwayCustomOrder ? <div className="mt-6 border border-gold/35 bg-gold/[.06] p-4"><p className="text-[0.58rem] uppercase tracking-[0.25em] text-gold">Custom orders considered</p><p className="mt-3 text-sm leading-6 text-charcoal/65">This Runway piece is made available by request. The RK team will review your custom order and get back to you by email.</p></div> : null}
          {showSizeSelector ? <fieldset className="mt-6"><legend className="sr-only">Choose a size</legend><div className="flex items-center justify-between gap-4"><span className="text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/50">Size</span><SizeChartPopover /></div><div className="mt-3 flex flex-wrap gap-2">{sizes.map((size) => { const unavailable = soldOut; return <button key={size} type="button" disabled={unavailable} onClick={() => { setSelectedSize(size); setCustomMeasurements({}); setQuantity(1); setMessage(''); }} aria-label={`${size}${unavailable ? ', unavailable' : ''}`} className={`min-w-12 border px-3 py-2.5 text-xs transition ${selectedSize === size ? 'border-gold bg-gold text-ink' : 'border-black/15 hover:border-gold dark:border-white/20'} ${unavailable ? 'cursor-not-allowed opacity-30' : ''}`}>{size}</button>; })}</div>{customSizeFields.length && !soldOut ? <button type="button" onClick={() => setCustomSizeOpen(true)} className="mt-3 inline-flex items-center gap-2 border-b border-charcoal/30 pb-2 text-[0.58rem] uppercase tracking-[0.22em] text-charcoal/70 transition hover:border-gold hover:text-gold"><Ruler size={14} />Want a custom size?</button> : null}</fieldset> : customSizeFields.length && !soldOut ? <button type="button" onClick={() => setCustomSizeOpen(true)} className="mt-6 inline-flex items-center gap-2 border-b border-charcoal/30 pb-2 text-[0.58rem] uppercase tracking-[0.22em] text-charcoal/70 transition hover:border-gold hover:text-gold"><Ruler size={14} />Want a custom size?</button> : null}
          {customMeasurements._customReady ? <p className="mt-2 text-xs text-gold">Custom measurements added to this piece.</p> : null}
          {!soldOut && !runwayCustomOrder ? <div className="mt-6 flex items-center justify-between border-y border-black/12 py-3 dark:border-white/15"><span className="text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/50">Quantity</span><div className="flex items-center gap-4"><button type="button" disabled={quantity <= 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity" className="grid h-8 w-8 place-items-center border border-black/15 transition hover:border-gold disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/20"><Minus size={13} /></button><span className="min-w-5 text-center text-sm">{quantity}</span><button type="button" disabled={quantity >= 50} onClick={() => setQuantity((value) => Math.min(50, value + 1))} aria-label="Increase quantity" className="grid h-8 w-8 place-items-center border border-black/15 transition hover:border-gold disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/20"><Plus size={13} /></button></div></div> : null}
          <div className="mt-6 grid grid-cols-[1fr_auto] gap-3"><button type="button" disabled={soldOut && !runwayCustomOrder} onClick={runwayCustomOrder ? requestCustomOrder : addToCart} className="inline-flex items-center justify-center gap-3 bg-ink px-5 py-3.5 text-[0.62rem] uppercase tracking-[0.26em] text-ivory transition hover:bg-gold hover:text-ink disabled:cursor-not-allowed disabled:opacity-45">{runwayCustomOrder ? <Mail size={16} /> : <ShoppingBag size={16} />}{runwayCustomOrder ? 'Request custom order' : soldOut ? 'Sold out' : 'Add to cart'}</button><button type="button" onClick={saveProduct} aria-pressed={saved} aria-label={saved ? 'Remove from wishlist' : 'Add to wishlist'} className="grid w-14 place-items-center border border-black/15 transition hover:border-gold hover:text-gold dark:border-white/20"><Heart size={18} className={saved ? 'fill-gold text-gold' : ''} /></button></div>
          {message ? <p className="mt-4 text-xs text-gold">{message}</p> : null}
          {informationSections.length ? <div className="mt-8 border-t border-black/12 dark:border-white/15">{informationSections.map((section) => <div key={section.id} className="border-b border-black/12 dark:border-white/15"><button type="button" onClick={() => setOpenSection((current) => current === section.id ? '' : section.id)} aria-expanded={openSection === section.id} className="flex w-full items-center justify-between py-4 text-left text-[0.6rem] uppercase tracking-[0.28em]"><span>{section.label}</span><Plus size={15} className={`transition-transform ${openSection === section.id ? 'rotate-45' : ''}`} /></button><AnimatePresence initial={false}>{openSection === section.id ? <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden"><div className="pb-5">{section.content}</div></motion.div> : null}</AnimatePresence></div>)}</div> : null}
        </div>
      </div>
    </section>
    {relatedProductsLoading || relatedProducts.length ? <section className="border-t border-black/10 bg-ivory px-4 pb-20 pt-16 text-charcoal dark:border-white/10 sm:px-8 sm:pb-24 lg:px-12 lg:pt-20">
      <div className="mx-auto max-w-[100rem]">
        <p className="text-xs uppercase tracking-[0.3em] text-gold">From the collection</p>
        <h2 className="mt-4 font-display text-4xl uppercase leading-none tracking-[0.03em] sm:text-5xl">YOU MAY ALSO LIKE</h2>
        {relatedProductsLoading ? <div className="mt-10 grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4 lg:gap-x-7">{Array.from({ length: 4 }, (_, index) => <div key={index} className="animate-pulse"><div className="aspect-[3/4] bg-sand" /><div className="mt-4 h-3 w-1/3 bg-sand" /><div className="mt-3 h-5 w-3/4 bg-sand" /></div>)}</div> : <div className="mt-10 grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 md:gap-x-6 md:gap-y-14 lg:grid-cols-4 lg:gap-x-7">{relatedProducts.map((relatedProduct) => <CollectionProductCard key={relatedProduct.id} product={relatedProduct} />)}</div>}
      </div>
    </section> : null}
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
    <AnimatePresence>
      {customOrderOpen ? <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[110] grid place-items-center bg-ink/65 p-4"
        onClick={() => setCustomOrderOpen(false)}
      >
        <motion.div
          initial={{ y: 18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 18, opacity: 0 }}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Request a custom order"
          className="max-h-[92vh] w-full max-w-xl overflow-y-auto bg-ivory p-6 text-charcoal shadow-2xl sm:p-8"
        >
          <div className="flex items-start justify-between gap-5">
            <div>
              <p className="text-[0.58rem] uppercase tracking-[0.28em] text-gold">Made on request</p>
              <h2 className="mt-3 font-display text-3xl">Request a custom order</h2>
            </div>
            <button type="button" onClick={() => setCustomOrderOpen(false)} aria-label="Close custom order request"><X size={19} /></button>
          </div>
          <p className="mt-4 text-sm leading-6 text-charcoal/60">Tell us how you would like this piece made. The RK team will review your request and get back to you by email.</p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <label className="text-[0.58rem] uppercase tracking-[0.18em] text-charcoal/50">Name<input value={customOrderName} onChange={(event) => setCustomOrderName(event.target.value)} className="mt-2 w-full border-b border-black/15 bg-transparent py-3 text-sm normal-case tracking-normal outline-none" autoComplete="name" /></label>
            <label className="text-[0.58rem] uppercase tracking-[0.18em] text-charcoal/50">Email<input type="email" value={customOrderEmail} onChange={(event) => setCustomOrderEmail(event.target.value)} className="mt-2 w-full border-b border-black/15 bg-transparent py-3 text-sm normal-case tracking-normal outline-none" autoComplete="email" /></label>
            <label className="text-[0.58rem] uppercase tracking-[0.18em] text-charcoal/50">Phone <span className="normal-case tracking-normal text-charcoal/35">(optional)</span><input value={customOrderPhone} onChange={(event) => setCustomOrderPhone(event.target.value)} className="mt-2 w-full border-b border-black/15 bg-transparent py-3 text-sm normal-case tracking-normal outline-none" autoComplete="tel" /></label>
            <label className="text-[0.58rem] uppercase tracking-[0.18em] text-charcoal/50">Preferred size <span className="normal-case tracking-normal text-charcoal/35">(optional)</span><select value={customOrderSize} onChange={(event) => setCustomOrderSize(event.target.value)} className="mt-2 w-full border-b border-black/15 bg-transparent py-3 text-sm normal-case tracking-normal outline-none"><option value="">Tell us in the request</option>{sizes.map((size) => <option key={size} value={size}>{size}</option>)}<option value="Custom measurements">Custom measurements</option></select></label>
          </div>
          {customSizeFields.length ? <div className="mt-6"><p className="text-[0.58rem] uppercase tracking-[0.2em] text-charcoal/50">Measurements <span className="normal-case tracking-normal text-charcoal/35">(optional)</span></p><div className="mt-3 grid gap-5 sm:grid-cols-2">{customSizeFields.map((field) => <label key={field} className="text-[0.58rem] uppercase tracking-[0.18em] text-charcoal/50">{field}<input inputMode="decimal" value={customMeasurements[field] ?? ''} onChange={(event) => setCustomMeasurements((current) => ({ ...current, [field]: event.target.value, _customReady: '' }))} className="mt-2 w-full border-b border-black/15 bg-transparent py-3 text-sm normal-case tracking-normal outline-none" /></label>)}</div></div> : null}
          <label className="mt-6 block text-[0.58rem] uppercase tracking-[0.18em] text-charcoal/50">Request details <span className="normal-case tracking-normal text-charcoal/35">(optional)</span><textarea value={customOrderMessage} onChange={(event) => setCustomOrderMessage(event.target.value)} rows={4} placeholder="Share your preferred fit, occasion, or any details for the RK team." className="mt-2 w-full resize-none border border-black/15 bg-transparent p-3 text-sm normal-case tracking-normal outline-none placeholder:text-charcoal/35" /></label>
          {customOrderError ? <p role="alert" className="mt-5 text-sm text-red-700">{customOrderError}</p> : null}
          <button type="button" onClick={submitCustomOrder} disabled={customOrderBusy} className="mt-8 inline-flex w-full items-center justify-center gap-2 bg-ink px-5 py-4 text-[0.6rem] uppercase tracking-[0.24em] text-ivory transition hover:bg-gold hover:text-ink disabled:cursor-wait disabled:opacity-50"><Mail size={14} />{customOrderBusy ? 'Sending request...' : 'Send custom order request'}</button>
        </motion.div>
      </motion.div> : null}
    </AnimatePresence>
    <AnimatePresence>{lightboxOpen && currentMainImage ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label="Product image gallery" className="fixed inset-0 z-[100] grid place-items-center bg-ink/95 p-4 sm:p-8"><button type="button" onClick={() => setLightboxOpen(false)} aria-label="Close image gallery" className="absolute right-5 top-5 z-10 grid h-11 w-11 place-items-center rounded-full border border-white/25 text-white transition hover:border-gold hover:text-gold"><X size={20} /></button><div className="relative h-[min(86vh,56rem)] w-[min(92vw,72rem)]"><Image src={currentMainImage} alt={product.name || 'Product'} fill className="object-contain" sizes="92vw" /></div>{media.length > 1 ? <><button type="button" onClick={previousImage} aria-label="Previous product image" className="absolute left-4 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/25 text-white transition hover:border-gold hover:text-gold sm:left-8"><ChevronLeft size={22} /></button><button type="button" onClick={nextImage} aria-label="Next product image" className="absolute right-4 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/25 text-white transition hover:border-gold hover:text-gold sm:right-8"><ChevronRight size={22} /></button></> : null}</motion.div> : null}</AnimatePresence>
  </main>;
}
