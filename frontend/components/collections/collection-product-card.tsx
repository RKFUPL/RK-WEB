'use client';

import { Heart, Image as ImageIcon, ShoppingBag } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { availabilityLabels, inr, type CatalogProduct } from '@/lib/catalog';
import { readWishlist, toggleWishlist, wishlistChangedEvent } from '@/lib/storefront-wishlist';
import { cloudinaryImageUrl } from '@/lib/utils';

function productColourText(product: CatalogProduct) {
  const value = product.attributes?.colors?.length ? product.attributes.colors : product.attributes?.color;
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return value ? String(value) : '';
}

export function CollectionProductCard({ product }: { product: CatalogProduct }) {
  const [saved, setSaved] = useState(false);
  const route = `/products/${product.id}`;
  const primaryImage = product.media?.[0];
  const secondaryImage = product.media?.[1];
  const primaryGridImage = cloudinaryImageUrl(primaryImage, 640);
  const secondaryGridImage = cloudinaryImageUrl(secondaryImage, 640);
  const sizeConfigured = product.sizeInventoryConfigured === true;
  const productColours = productColourText(product);
  const defaultVariant = product.variants?.find((variant) => variant.status !== 'remove') || product.variants?.[0];
  const wishlistSku = defaultVariant?.sku || product.sku;

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
      variantId: defaultVariant?.id,
      sku: wishlistSku,
      colour: defaultVariant?.colour || productColours,
      name: product.name || 'Untitled piece',
      price: product.price,
      image: defaultVariant?.images?.[0] || primaryImage,
      category: product.category || 'Couture',
      availability: availabilityLabels[product.availability],
      stock: product.stock,
      sizeOptions: defaultVariant?.sizes || (sizeConfigured ? product.sizeInventory?.filter((entry) => entry.enabled !== false).map((entry) => entry.size) : undefined),
      sizeStock: Object.fromEntries((defaultVariant?.sizeInventory || product.sizeInventory || []).map((entry) => [entry.size, entry.stock])),
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
    </div>
    <div className="pt-4 sm:pt-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.54rem] uppercase tracking-[0.27em] text-charcoal/45">{product.category || 'Couture'}</p>
          <Link href={route} className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 leading-tight text-charcoal transition hover:text-gold"><span className="font-display text-lg sm:text-xl">{product.name || 'Untitled piece'}</span>{productColours ? <span className="text-[0.52rem] uppercase tracking-[0.16em] text-charcoal/50">· {productColours}</span> : null}</Link>
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
