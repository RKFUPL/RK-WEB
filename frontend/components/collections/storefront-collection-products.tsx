'use client';

import { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { apiBaseUrl } from '@/lib/rbac';
import { availabilityLabels, inr, type ManagedCollection } from '@/lib/catalog';

export function StorefrontCollectionProducts({ slug, fallbackName }: { slug: string; fallbackName: string }) {
  const [collection, setCollection] = useState<(ManagedCollection & { products: NonNullable<ManagedCollection['products']> }) | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch(`${apiBaseUrl}/api/catalog/collections/${encodeURIComponent(slug)}`, { cache: 'no-store' })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? 'Unable to load collection products.'); return payload; })
      .then((payload) => { if (active) setCollection(payload.collection); })
      .catch((requestError) => { if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load collection products.'); });
    return () => { active = false; };
  }, [slug]);

  if (error) return null;
  const products = collection?.products ?? [];
  return <section className="border-t border-black/10 bg-[#f5f1e9] px-6 py-16 lg:px-10 lg:py-24"><div className="mx-auto max-w-7xl"><div className="max-w-2xl"><p className="text-[0.63rem] uppercase tracking-[0.35em] text-gold">Collection pieces</p><h2 className="mt-4 font-display text-4xl md:text-5xl">{collection?.name ?? fallbackName}</h2><p className="mt-4 text-sm leading-7 text-charcoal/60">Products here are read from the same catalogue records used by the studio team.</p></div>{collection && !products.length ? <p className="mt-10 border border-black/10 bg-white px-6 py-10 text-sm text-charcoal/55">No products in this collection yet.</p> : <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{products.map((product) => <article key={product.id} className="border border-black/10 bg-white"><div className="aspect-[4/5] overflow-hidden bg-[#ebe6dc]">{product.media?.[0] ? <img src={product.media[0]} alt={product.name || 'Collection product'} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-center text-gold"><div><ImageIcon size={26} className="mx-auto" /><p className="mt-3 text-[0.58rem] uppercase tracking-[.22em]">Product image coming soon</p></div></div>}</div><div className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-[0.58rem] uppercase tracking-[.18em] text-charcoal/40">{product.sku || 'Code coming soon'}</p><h3 className="mt-2 font-display text-2xl">{product.name}</h3></div><span className="whitespace-nowrap text-[0.58rem] uppercase tracking-[.15em] text-gold">{availabilityLabels[product.availability]}</span></div><p className="mt-4 text-sm text-charcoal/70">{product.price === undefined ? 'Price on request' : inr.format(product.price)}</p></div></article>)}</div>}</div></section>;
}
