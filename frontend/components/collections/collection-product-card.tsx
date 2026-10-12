'use client';

import { ChevronDown, Heart, Image as ImageIcon, ShoppingBag } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { availabilityLabels, inr, normalizeColour, productVariantHref, type CatalogProduct, variantPrimaryAndHoverSources } from '@/lib/catalog';
import { readWishlist, toggleWishlist, wishlistChangedEvent } from '@/lib/storefront-wishlist';
import { cloudinaryImageUrl } from '@/lib/utils';

function productColourText(product: CatalogProduct) {
  const value = product.attributes?.colors?.length ? product.attributes.colors : product.attributes?.color;
  if (Array.isArray(value)) return value.filter(Boolean).map(normalizeColour).join(', ');
  return value ? normalizeColour(value) : '';
}

function colourSwatchValue(value?: string) {
  const colours: Record<string, string> = {
    ivory: '#fffff0', red: '#b4232f', blue: '#235a9f', navy: '#172a46', black: '#171717', white: '#ffffff',
    beige: '#d8c5a5', brown: '#714b35', gold: '#b69252', green: '#37624a', pink: '#d98ca3', 'hot pink': '#d93384',
    maroon: '#6e2639', grey: '#858585', gray: '#858585',
  };
  return colours[String(value || '').trim().toLowerCase()];
}

export function CollectionProductCard({ product, href }: { product: CatalogProduct; href?: string }) {
  const [saved, setSaved] = useState(false);
  const selectableVariants = (product.variants || []).filter((variant) => variant.status !== 'remove' && Boolean(variant.colour));
  const defaultVariant = selectableVariants.find((variant) => variant.status === 'active') || selectableVariants[0] || product.variants?.[0];
  const [selectedVariantId, setSelectedVariantId] = useState(defaultVariant?.id || '');
  const [colourMenuOpen, setColourMenuOpen] = useState(false);
  const selectedVariant = selectableVariants.find((variant) => variant.id === selectedVariantId) || defaultVariant;
  const route = productVariantHref(href || `/products/${product.id}`, selectedVariant?.id);
  const { primary: primaryImage, hover: secondaryImage } = variantPrimaryAndHoverSources(product, selectedVariant);
  const selectedSwatch = colourSwatchValue(selectedVariant?.colour);
  const primaryGridImage = cloudinaryImageUrl(primaryImage, 640);
  const secondaryGridImage = cloudinaryImageUrl(secondaryImage, 640);
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

  const addToCart = () => {
    window.location.assign(route);
  };

  return <article className="collection-product-card group min-w-0">
    <div className="collection-product-image-wrapper relative aspect-[3/4] overflow-hidden rounded-[14px] bg-sand">
      <Link href={route} aria-label={`View ${product.name || 'product'}`} className="relative block h-full w-full">
        {primaryImage ? <>
          <Image src={primaryGridImage || primaryImage} alt={product.name || 'Collection product'} fill sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw" className={`collection-product-image object-cover ${secondaryImage ? 'group-hover:opacity-0' : ''}`} />
          {secondaryImage ? <Image src={secondaryGridImage || secondaryImage} alt="" fill sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw" className="collection-product-image object-cover opacity-0 group-hover:opacity-100" /> : null}
        </> : <span className="grid h-full place-items-center text-center text-charcoal/38"><span><ImageIcon size={24} strokeWidth={1.25} className="mx-auto" /><span className="mt-3 block text-[0.54rem] uppercase tracking-[0.28em]">Image coming soon</span></span></span>}
      </Link>
      <button type="button" onClick={toggleSaved} aria-label={saved ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`} aria-pressed={saved} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-ivory/85 text-charcoal shadow-sm backdrop-blur-sm transition hover:text-gold sm:right-4 sm:top-4">
        <Heart size={17} strokeWidth={1.4} className={saved ? 'fill-gold text-gold' : ''} />
      </button>
      {product.availability === 'sold_out' ? <span className="absolute bottom-3 left-3 bg-ink/82 px-3 py-2 text-[0.52rem] uppercase tracking-[0.24em] text-white">Sold out</span> : null}
      {selectableVariants.length ? <div className="absolute bottom-3 right-3 z-20 sm:bottom-4 sm:right-4">
        <button type="button" aria-haspopup="menu" aria-expanded={colourMenuOpen} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setColourMenuOpen((open) => !open); }} className="inline-flex items-center gap-2 rounded-full border border-white/35 bg-ivory/92 px-3 py-2 text-[0.52rem] uppercase tracking-[0.14em] text-charcoal shadow-sm backdrop-blur-md transition hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70">
          {selectedSwatch ? <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-black/15" style={{ backgroundColor: selectedSwatch }} /> : null}<span>{normalizeColour(selectedVariant?.colour) || 'COLOUR'}</span><ChevronDown size={12} aria-hidden="true" />
        </button>
        {colourMenuOpen && selectableVariants.length > 1 ? <div role="menu" className="absolute bottom-full right-0 mb-2 min-w-36 rounded-xl border border-black/10 bg-ivory p-1.5 shadow-xl">
          {selectableVariants.map((variant) => <button key={variant.id} type="button" role="menuitem" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedVariantId(variant.id); setColourMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[0.55rem] uppercase tracking-[0.12em] hover:bg-sand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70"><span className="h-2.5 w-2.5 rounded-full border border-black/15" style={{ backgroundColor: colourSwatchValue(variant.colour) || '#b69263' }} />{normalizeColour(variant.colour)}</button>)}
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
      <p className="mt-2 text-xs text-charcoal/70 sm:text-sm">{product.price === undefined ? 'Price on request' : inr.format(product.price)}</p>
      {product.price !== undefined && (product.taxInclusive || product.mrpIncludesGst) ? <p className="mt-1.5 text-[0.5rem] uppercase tracking-[0.18em] text-charcoal/42">MRP · Inclusive of GST</p> : null}
      <button type="button" onClick={addToCart} disabled={product.availability === 'sold_out'} className="mt-4 inline-flex items-center gap-2 border-b border-charcoal/30 pb-2 text-[0.56rem] uppercase tracking-[0.24em] text-charcoal transition hover:border-gold hover:text-gold disabled:cursor-not-allowed disabled:opacity-40">
        <ShoppingBag size={14} strokeWidth={1.35} />{product.availability === 'sold_out' ? 'Sold out' : sizeConfigured || product.variants?.length ? 'Choose options' : 'View product'}
      </button>
    </div>
  </article>;
}
