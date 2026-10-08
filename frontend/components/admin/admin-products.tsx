'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, LayoutGrid, List } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { OperationsSection } from '@/components/staff/operations-section';
import { apiBaseUrl } from '@/lib/rbac';
import type { ManagedCollection } from '@/lib/catalog';

export function AdminProducts() {
  const router = useRouter();
  const [collections, setCollections] = useState<ManagedCollection[]>([]);
  const [view, setView] = useState<'collections' | 'products'>('collections');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const token = window.localStorage.getItem('rk_access_token') ?? '';
      const response = await fetch(`${apiBaseUrl}/api/staff/collections`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load collections.');
      setCollections(payload.collections as ManagedCollection[]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load collections.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('rk-admin-resource-created', refresh);
    return () => window.removeEventListener('rk-admin-resource-created', refresh);
  }, [load]);

  if (view === 'products') return <section className="mt-10"><div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Operations</p><h2 className="mt-2 text-2xl font-semibold">Products</h2></div><button type="button" onClick={() => setView('collections')} className="rounded-lg border border-black/10 px-4 py-2 text-xs">View collections</button></div><OperationsSection section="products" /></section>;

  return <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-5 shadow-[0_4px_20px_rgba(25,31,38,.035)] dark:border-white/[.08] dark:bg-[#191a1f] sm:p-8">
    <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Operations</p><h2 className="mt-2 text-2xl font-semibold">Products</h2><p className="mt-2 text-xs leading-6 text-[#8a9098]">Manage products by collection, or open the complete catalog.</p></div><div className="flex rounded-lg border border-black/10 p-1 dark:border-white/10"><button type="button" onClick={() => setView('collections')} className="inline-flex items-center gap-2 rounded-md bg-[#24211e] px-3 py-2 text-xs text-white"><LayoutGrid size={14} />Collections</button><button type="button" onClick={() => setView('products')} className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs text-[#6e747d]"><List size={14} />All products</button></div></div>
    {error ? <p role="alert" className="mt-5 text-sm text-red-600">{error}</p> : null}
    {loading ? <p className="mt-8 text-sm text-[#8a9098]">Loading collections…</p> : collections.length ? <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{collections.map((collection) => <button type="button" key={collection.id} onClick={() => router.push(`/admin/products/${encodeURIComponent(collection.slug)}`)} className="group overflow-hidden rounded-xl border border-black/[.08] bg-[#fffdf9] text-left transition hover:-translate-y-0.5 hover:border-[#9a7a4d]/50 hover:shadow-lg dark:border-white/[.08] dark:bg-white/[.02]"><div className="relative aspect-[16/9] overflow-hidden bg-[#eee8de] dark:bg-white/[.04]">{collection.heroImage || collection.hero?.image ? <img src={collection.heroImage || collection.hero?.image} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : <div className="grid h-full place-items-center text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Collection</div>}</div><div className="flex items-center justify-between gap-4 p-5"><div className="min-w-0"><h3 className="truncate text-lg font-medium">{collection.name}</h3><p className="mt-1 text-[10px] uppercase tracking-[.16em] text-[#8a9098]">{collection.collectionNumber || collection.slug}</p><p className="mt-3 text-xs text-[#6e747d]">{collection.productCount} {collection.productCount === 1 ? 'product' : 'products'}</p></div><ChevronRight size={18} className="shrink-0 text-[#9a7a4d] transition-transform group-hover:translate-x-1" /></div></button>)}</div> : <div className="mt-8 rounded-xl border border-dashed border-black/10 px-6 py-12 text-center text-sm text-[#8a9098]">No collections available.</div>}
  </section>;
}
