'use client';

import { Image as ImageIcon, Minus, Plus, ShoppingBag, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StickyHeader } from '@/components/home/sticky-header';
import { cartLineKey, getCartSubtotal } from '@/lib/cart';
import { inr } from '@/lib/catalog';
import { cartChangedEvent, readStoredCart, removeStoredCartItem, updateStoredCartQuantity, updateStoredCartSize } from '@/lib/storefront-cart';
import type { Cart, CartItem } from '@/lib/store-types';

function SizeSelector({ item, lineKey }: { item: CartItem; lineKey: string }) {
  if (!item.sizeOptions?.length) return item.variant ? <p className="mt-2 text-[0.58rem] uppercase tracking-[0.2em] text-charcoal/50">{item.variant.name}: {item.variant.value}</p> : null;
  return <label className="mt-2 block text-[0.58rem] uppercase tracking-[0.2em] text-charcoal/50">Size<select value={item.size || ''} onChange={(event) => updateStoredCartSize(lineKey, event.target.value)} className="ml-2 rounded border border-black/15 bg-transparent px-2 py-1 text-xs normal-case tracking-normal text-charcoal">{item.sizeOptions.map((size) => <option key={size} value={size} disabled={item.availability?.toLowerCase().replaceAll(' ', '_') === 'in_stock' && (item.sizeStock?.[size] ?? 0) <= 0}>{size}</option>)}</select></label>;
}

export default function BagPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [cart, setCart] = useState<Cart>({ items: [], currency: 'INR' });

  useEffect(() => {
    setSignedIn(Boolean(window.localStorage.getItem('rk_access_token')));
    const sync = () => setCart(readStoredCart());
    sync();
    window.addEventListener(cartChangedEvent, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(cartChangedEvent, sync); window.removeEventListener('storage', sync); };
  }, []);

  if (signedIn === null) return null;

  return <main className="min-h-screen bg-ivory px-4 pb-24 pt-32 text-charcoal sm:px-8 lg:px-12"><StickyHeader /><div className="mx-auto max-w-6xl">
    <div className="border-b border-black/12 pb-8 text-center dark:border-white/15"><ShoppingBag className="mx-auto h-7 w-7 text-gold" strokeWidth={1.25} /><p className="mt-7 text-[0.58rem] uppercase tracking-[0.35em] text-charcoal/50">Shopping bag</p><h1 className="mt-4 font-display text-5xl sm:text-6xl">{signedIn ? `${cart.items.length} ${cart.items.length === 1 ? 'piece' : 'pieces'}` : 'Sign in to view your bag.'}</h1></div>
    {!signedIn ? <div className="py-16 text-center"><p className="text-sm text-charcoal/60">Your bag is connected to your RK account.</p><Link href="/account" className="mt-8 inline-flex bg-ink px-7 py-4 text-xs uppercase tracking-[0.28em] text-ivory transition hover:bg-gold hover:text-ink">Sign in</Link></div> : cart.items.length ? <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_20rem]"><div>{cart.items.map((item) => { const lineKey = cartLineKey(item); return <article key={lineKey} className="grid grid-cols-[6rem_1fr_auto] gap-4 border-b border-black/10 py-5 dark:border-white/10 sm:grid-cols-[8rem_1fr_auto]"><div className="grid aspect-[3/4] place-items-center overflow-hidden rounded-[14px] bg-sand">{item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-cover" /> : <ImageIcon size={20} className="text-charcoal/35" />}</div><div><p className="font-display text-xl sm:text-2xl">{item.name}</p><SizeSelector item={item} lineKey={lineKey} />{item.customSize ? <p className="mt-2 text-[0.58rem] uppercase tracking-[0.2em] text-charcoal/50">Custom size · {item.customSize.unit}</p> : null}<div className="mt-4 flex items-center gap-3"><span className="text-xs text-charcoal/65">Quantity</span><div className="flex items-center border border-black/15"><button type="button" onClick={() => updateStoredCartQuantity(item.productId, item.quantity - 1, item.variant?.id, lineKey)} aria-label={`Decrease quantity of ${item.name}`} className="grid h-8 w-8 place-items-center transition hover:text-gold"><Minus size={13} /></button><span className="min-w-8 text-center text-xs">{item.quantity}</span><button type="button" disabled={item.availability?.toLowerCase().replaceAll(' ', '_') === 'in_stock' && item.stock !== undefined && item.quantity >= item.stock} onClick={() => updateStoredCartQuantity(item.productId, item.quantity + 1, item.variant?.id, lineKey)} aria-label={`Increase quantity of ${item.name}`} className="grid h-8 w-8 place-items-center transition hover:text-gold disabled:cursor-not-allowed disabled:opacity-35"><Plus size={13} /></button></div></div><p className="mt-2 text-sm">{inr.format(item.price)}</p></div><button type="button" onClick={() => removeStoredCartItem(item.productId, item.variant?.id, lineKey)} aria-label={`Remove ${item.name}`} className="self-start p-2 text-charcoal/45 transition hover:text-gold"><X size={16} /></button></article>; })}</div><aside className="h-fit border border-black/12 p-6 dark:border-white/15"><p className="text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/50">Summary</p><div className="mt-6 flex justify-between border-b border-black/10 pb-5 text-sm dark:border-white/10"><span>Subtotal</span><span>{inr.format(getCartSubtotal(cart))}</span></div><p className="mt-5 text-xs leading-6 text-charcoal/55">Shipping and final order details are confirmed by the RK team.</p><Link href="/checkout" className="mt-7 flex w-full justify-center bg-ink px-5 py-4 text-[0.6rem] uppercase tracking-[0.25em] text-ivory transition hover:bg-gold hover:text-ink">Continue to checkout</Link></aside></div> : <div className="py-20 text-center"><p className="font-display text-3xl">Your bag is empty.</p><Link href="/collections" className="mt-8 inline-flex border-b border-charcoal/40 pb-2 text-xs uppercase tracking-[0.28em] transition hover:border-gold hover:text-gold">Explore collections</Link></div>}
  </div></main>;
}
