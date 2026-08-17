'use client';

import { Heart, Image as ImageIcon, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StickyHeader } from '@/components/home/sticky-header';
import { inr } from '@/lib/catalog';
import { readWishlist, removeFromWishlist, wishlistChangedEvent, type StorefrontWishlistItem } from '@/lib/storefront-wishlist';

export default function WishlistPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [items, setItems] = useState<StorefrontWishlistItem[]>([]);

  useEffect(() => {
    setSignedIn(Boolean(window.localStorage.getItem('rk_access_token')));
    const sync = () => setItems(readWishlist());
    sync(); window.addEventListener(wishlistChangedEvent, sync); window.addEventListener('storage', sync);
    return () => { window.removeEventListener(wishlistChangedEvent, sync); window.removeEventListener('storage', sync); };
  }, []);

  if (signedIn === null) return null;

  return <main className="min-h-screen bg-ivory px-4 pb-24 pt-32 text-charcoal sm:px-8 lg:px-12"><StickyHeader />
    <div className="mx-auto max-w-[100rem]">
      <div className="border-b border-black/12 pb-8 text-center dark:border-white/15"><Heart className="mx-auto h-7 w-7 text-gold" strokeWidth={1.25} /><p className="mt-7 text-[0.58rem] uppercase tracking-[0.35em] text-charcoal/50">Your wishlist</p><h1 className="mt-4 font-display text-5xl sm:text-6xl">{signedIn ? `${items.length} saved ${items.length === 1 ? 'piece' : 'pieces'}` : 'Sign in to view your wishlist.'}</h1></div>
      {!signedIn ? <div className="py-16 text-center"><p className="text-sm text-charcoal/60">Your saved pieces are connected to your RK account.</p><Link href="/account" className="mt-8 inline-flex bg-ink px-7 py-4 text-xs uppercase tracking-[0.28em] text-ivory transition hover:bg-gold hover:text-ink">Sign in</Link></div> : items.length ? <div className="mt-10 grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 md:gap-x-6 xl:grid-cols-4">{items.map((item) => <article key={item.productId} className="group relative"><Link href={item.route} className="block aspect-[3/4] overflow-hidden bg-sand">{item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-charcoal/40"><ImageIcon size={24} /></span>}</Link><button type="button" onClick={() => removeFromWishlist(item.productId)} aria-label={`Remove ${item.name}`} className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-ivory/90 text-charcoal shadow-sm"><X size={14} /></button><p className="mt-4 text-[0.54rem] uppercase tracking-[0.25em] text-charcoal/45">{item.category || 'Couture'}</p><Link href={item.route} className="mt-2 block font-display text-xl transition hover:text-gold">{item.name}</Link><p className="mt-2 text-xs text-charcoal/70">{item.price === undefined ? 'Price on request' : inr.format(item.price)}</p></article>)}</div> : <div className="py-20 text-center"><p className="font-display text-3xl">Nothing saved yet.</p><p className="mx-auto mt-4 max-w-md text-sm leading-7 text-charcoal/60">Pieces you save from a collection will appear here.</p><Link href="/collections" className="mt-8 inline-flex border-b border-charcoal/40 pb-2 text-xs uppercase tracking-[0.28em] transition hover:border-gold hover:text-gold">Explore collections</Link></div>}
    </div>
  </main>;
}
