'use client';

import { ChevronDown, Heart, Image as ImageIcon, ShoppingBag } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { availabilityLabels, normalizeColour, productVariantHref, type CatalogProduct, variantPrimaryAndHoverSources } from '@/lib/catalog';
import { readWishlist, toggleWishlist, wishlistChangedEvent } from '@/lib/storefront-wishlist';
import { cloudinaryImageUrl } from '@/lib/utils';
import { PriceCurrencyRow } from '@/components/commerce/price-currency-row';
import { colourSwatchValue, useColourSwatches } from '@/lib/colour-swatches';

function productColourText(product: CatalogProduct) {
  const value = product.attributes?.colors?.length ? product.attributes.colors : product.attributes?.color;
  if (Array.isArray(value)) return value.filter(Boolean).map(normalizeColour).join(', ');
  return value ? normalizeColour(value) : '';
}

export function CollectionProductCard({ product, href, selectedColour = '' }: { product: CatalogProduct; href?: string; selectedColour?: string }) {
  const [saved, setSaved] = useState(false);
  const selectableVariants = useMemo(() => {
    const seen = new Set<string>();
    return (product.variants || []).filter((variant) => {
      const colour = normalizeColour(variant.colour);
      if (variant.status !== 'active' || !colour || seen.has(colour)) return false;
      seen.add(colour);
      return true;
    });
  }, [product.variants]);
  const defaultVariant = selectableVariants.find((variant) => variant.status === 'active') || selectableVariants[0] || product.variants?.[0];
  const [selectedVariantId, setSelectedVariantId] = useState(defaultVariant?.id || '');
  const [colourMenuOpen, setColourMenuOpen] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const colourSwatches = useColourSwatches();
  const colourSelectorRef = useRef<HTMLDivElement>(null);
  const filteredVariant = selectedColour
    ? selectableVariants.find((variant) => normalizeColour(variant.colour) === normalizeColour(selectedColour))
    : undefined;
  const selectedVariant = selectedColour ? filteredVariant : selectableVariants.find((variant) => variant.id === selectedVariantId) || defaultVariant;
  const route = productVariantHref(href || `/products/${product.id}`, selectedVariant?.id);
  const resolvedImages = variantPrimaryAndHoverSources(product, selectedVariant);
  const primaryImage = selectedColour && !filteredVariant ? undefined : resolvedImages.primary;
  const secondaryImage = selectedColour && !filteredVariant ? undefined : resolvedImages.hover;
  const primaryGridImage = cloudinaryImageUrl(primaryImage, 640);
  const secondaryGridImage = cloudinaryImageUrl(secondaryImage, 640);
  const primarySource = primaryGridImage || primaryImage;
  const secondarySource = secondaryGridImage || secondaryImage;
  const primaryFailed = Boolean(primarySource && failedImages.has(primarySource));
  const secondaryFailed = Boolean(secondarySource && failedImages.has(secondarySource));
  const sizeConfigured = product.sizeInventoryConfigured === true;
  const productColours = productColourText(product);
  const wishlistSku = selectedVariant?.sku || product.sku;

  useEffect(() => {
    if (!selectedVariantId || !selectableVariants.some((variant) => variant.id === selectedVariantId)) setSelectedVariantId(defaultVariant?.id || '');
  }, [defaultVariant?.id, product.id, selectableVariants.length, selectedVariantId]);

  useEffect(() => {
    const sync = () => setSaved(readWishlist().some((item) => item.productId === product.id && (item.sku || '') === (wishlistSku || '')));
    sync();
    window.addEventListener(wishlistChangedEvent, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(wishlistChangedEvent, sync); window.removeEventListener('storage', sync); };
  }, [product.id, wishlistSku]);

  useEffect(() => {
    if (!colourMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!colourSelectorRef.current?.contains(event.target as Node)) setColourMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setColourMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [colourMenuOpen]);

  const toggleSaved = () => {
    if (!window.localStorage.getItem('rk_access_token')) {
      window.alert('Please sign in to save pieces to your wishlist.');
      return;
    }
    const added = toggleWishlist({
      productId: product.id,
      variantId: selectedVariant?.id,
      sku: wishlistSku,
      colour: selectedVariant?.colour || productColours,
      name: product.name || 'Untitled piece',
      price: product.price,
      image: primaryImage,
      category: product.category || 'Couture',
      availability: availabilityLabels[product.availability],
      stock: product.stock,
      sizeOptions: selectedVariant?.sizes || (sizeConfigured ? product.sizeInventory?.filter((entry) => entry.enabled !== false).map((entry) => entry.size) : undefined),
      sizeStock: Object.fromEntries((selectedVariant?.sizeInventory || product.sizeInventory || []).map((entry) => [entry.size, entry.stock])),
      route,
    });
    setSaved(added);
    if (added) trackAnalyticsEvent('wishlist_add', { productId: product.id, productName: product.name, currency: 'INR', value: product.price });
  };

  const visibleSwatches = selectableVariants.slice(0, 3);
  const hiddenColourCount = Math.max(0, selectableVariants.length - visibleSwatches.length);

  return <article className="collection-product-card group min-w-0">
    <div data-testid="collection-product-image-viewport" className="collection-product-image-wrapper relative aspect-[3/4] overflow-hidden rounded-lg bg-sand" style={{ borderRadius: 8, clipPath: 'inset(0 round 8px)' }}>
      <Link href={route} aria-label={`View ${product.name || 'product'}`} className="relative block h-full w-full">
        {primarySource && !primaryFailed ? <>
          <Image key={primarySource} src={primarySource} onError={() => setFailedImages((current) => new Set(current).add(primarySource))} alt={product.name || 'Collection product'} fill sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw" className={`collection-product-image rounded-lg object-cover ${secondarySource && !secondaryFailed ? 'group-hover:opacity-0' : ''}`} style={{ borderRadius: 8, clipPath: 'inset(0 round 8px)' }} />
          {secondarySource && !secondaryFailed ? <Image key={secondarySource} src={secondarySource} onError={() => setFailedImages((current) => new Set(current).add(secondarySource))} alt="" fill sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw" className="collection-product-image rounded-lg object-cover opacity-0 group-hover:opacity-100" style={{ borderRadius: 8, clipPath: 'inset(0 round 8px)' }} /> : null}
        </> : <span className="grid h-full place-items-center text-center text-charcoal/38"><span><ImageIcon size={24} strokeWidth={1.25} className="mx-auto" /><span className="mt-3 block text-[0.54rem] uppercase tracking-[0.28em]">Image coming soon</span></span></span>}
      </Link>
      <button type="button" onClick={toggleSaved} aria-label={saved ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`} aria-pressed={saved} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-ivory/85 text-charcoal shadow-sm backdrop-blur-sm transition hover:text-gold sm:right-4 sm:top-4">
        <Heart size={17} strokeWidth={1.4} className={saved ? 'fill-gold text-gold' : ''} />
      </button>
      {product.availability === 'sold_out' ? <span className="absolute bottom-3 left-3 bg-ink/82 px-3 py-2 text-[0.52rem] uppercase tracking-[0.24em] text-white">Sold out</span> : null}
      {selectableVariants.length > 1 ? <div ref={colourSelectorRef} className="absolute bottom-3 right-3 z-20 sm:bottom-4 sm:right-4">
        <button type="button" aria-label={`Choose colour. ${normalizeColour(selectedVariant?.colour)} selected. ${selectableVariants.length} colours available.`} aria-haspopup="menu" aria-expanded={colourMenuOpen} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setColourMenuOpen((open) => !open); }} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/45 bg-ivory/95 px-3 py-2 text-[0.52rem] uppercase tracking-[0.14em] text-charcoal shadow-[0_8px_24px_rgba(18,18,18,.14)] backdrop-blur-md transition hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70">
          <span className="flex items-center -space-x-0.5" aria-hidden="true">{visibleSwatches.map((variant) => <span key={variant.id} className={`h-4 w-4 rounded-full border ${variant.id === selectedVariant?.id ? 'relative z-10 border-gold ring-1 ring-gold/70' : 'border-black/15'}`} style={{ backgroundColor: colourSwatchValue(variant.colour, colourSwatches) || '#b7aa99' }} />)}</span>
          {hiddenColourCount ? <span aria-hidden="true" className="font-medium">+{hiddenColourCount}</span> : null}
          <ChevronDown size={12} aria-hidden="true" className={`transition-transform ${colourMenuOpen ? 'rotate-180' : ''}`} />
        </button>
        {colourMenuOpen ? <div role="menu" aria-label="Available colours" className="absolute bottom-full right-0 mb-2 min-w-44 rounded-2xl border border-black/10 bg-ivory p-2 shadow-[0_18px_45px_rgba(18,18,18,.18)]">
          {selectableVariants.map((variant) => <button key={variant.id} type="button" role="menuitemradio" aria-checked={variant.id === selectedVariant?.id} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedVariantId(variant.id); setColourMenuOpen(false); }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[0.58rem] uppercase tracking-[0.14em] hover:bg-sand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70"><span className={`h-3.5 w-3.5 rounded-full border ${variant.id === selectedVariant?.id ? 'border-gold ring-2 ring-gold/25' : 'border-black/15'}`} style={{ backgroundColor: colourSwatchValue(variant.colour, colourSwatches) || '#b7aa99' }} /><span className="flex-1">{normalizeColour(variant.colour)}</span>{variant.id === selectedVariant?.id ? <span className="text-gold" aria-hidden="true">✓</span> : null}</button>)}
        </div> : null}
      </div> : null}
    </div>
    <div className="pt-4 sm:pt-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.54rem] uppercase tracking-[0.27em] text-charcoal/45">{product.category || 'Couture'}</p>
          <Link href={route} className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 leading-tight text-charcoal transition hover:text-gold"><span className="font-display text-lg sm:text-xl">{product.name || 'Untitled piece'}</span>{selectedVariant?.colour || productColours ? <span className="text-[0.52rem] uppercase tracking-[0.16em] text-charcoal/50">· {selectedVariant?.colour || productColours}</span> : null}</Link>
          {product.styleCode ? <p className="mt-1 text-[0.52rem] uppercase tracking-[0.2em] text-charcoal/45">{product.styleCode}</p> : null}
        </div>
        {product.availability === 'custom_order' ? <span className="shrink-0 text-[0.5rem] uppercase tracking-[0.18em] text-gold">Custom</span> : null}
      </div>
      <PriceCurrencyRow amount={product.price} className="mt-2 text-xs text-charcoal/70 sm:text-sm" />
      {product.availability === 'sold_out' ? <button type="button" disabled className="mt-4 inline-flex items-center gap-2 border-b border-charcoal/30 pb-2 text-[0.56rem] uppercase tracking-[0.24em] text-charcoal opacity-40"><ShoppingBag size={14} strokeWidth={1.35} />Sold out</button> : <Link href={route} className="mt-4 inline-flex items-center gap-2 border-b border-charcoal/30 pb-2 text-[0.56rem] uppercase tracking-[0.24em] text-charcoal transition hover:border-gold hover:text-gold"><ShoppingBag size={14} strokeWidth={1.35} />{sizeConfigured || product.variants?.length ? 'Choose options' : 'View product'}</Link>}
    </div>
  </article>;
}
