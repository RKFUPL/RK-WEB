'use client';

import { Heart, Image as ImageIcon } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { availabilityLabels, inr, type CatalogProduct } from '@/lib/catalog';
import { readWishlist, toggleWishlist, wishlistChangedEvent } from '@/lib/storefront-wishlist';

export function CollectionProductCard({ product }: { product: CatalogProduct }) {
  const [saved, setSaved] = useState(false);
  const route = `/products/${product.id}`;
  const primaryImage = product.media?.[0];
  const secondaryImage = product.media?.[1];

  useEffect(() => {
    const sync = () => setSaved(readWishlist().some((item) => item.productId === product.id));
    sync();
    window.addEventListener(wishlistChangedEvent, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(wishlistChangedEvent, sync); window.removeEventListener('storage', sync); };
  }, [product.id]);

  const toggleSaved = () => {
    if (!window.localStorage.getItem('rk_access_token')) {
      window.alert('Please sign in to save pieces to your wishlist.');
      return;
    }
    const added = toggleWishlist({
      productId: product.id,
      name: product.name || 'Untitled piece',
      price: product.price,
      image: primaryImage,
      category: product.category || 'Couture',
      availability: availabilityLabels[product.availability],
      route,
    });
    setSaved(added);
    if (added) trackAnalyticsEvent('wishlist_add', { productId: product.id, productName: product.name, currency: 'INR', value: product.price });
  };

  return <article className="group min-w-0">
    <div className="relative aspect-[3/4] overflow-hidden bg-sand">
      <Link href={route} aria-label={`View ${product.name || 'product'}`} className="block h-full w-full">
        {primaryImage ? <>
          <Image src={primaryImage} alt={product.name || 'Collection product'} fill sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw" className={`object-cover transition-opacity duration-700 ${secondaryImage ? 'group-hover:opacity-0' : ''}`} />
          {secondaryImage ? <Image src={secondaryImage} alt="" fill sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw" className="object-cover opacity-0 transition-opacity duration-700 group-hover:opacity-100" /> : null}
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
          <Link href={route} className="mt-2 block font-display text-lg leading-tight text-charcoal transition hover:text-gold sm:text-xl">{product.name || 'Untitled piece'}</Link>
        </div>
        {product.availability === 'custom_order' ? <span className="shrink-0 text-[0.5rem] uppercase tracking-[0.18em] text-gold">Custom</span> : null}
      </div>
      <p className="mt-2 text-xs text-charcoal/70 sm:text-sm">{product.price === undefined ? 'Price on request' : inr.format(product.price)}</p>
    </div>
  </article>;
}
