'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { apiBaseUrl } from '@/lib/rbac';
import type { ManagedCollection } from '@/lib/catalog';

function displayStatus(status: string) {
  return status === 'collection' || status === 'active' ? 'Collection' : status;
}

export function CollectionManagementList({ basePath }: { basePath: '/admin/collections' | '/staff/collections' }) {
  const router = useRouter();
  const [collections, setCollections] = useState<ManagedCollection[]>([]);
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

  return <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-5 shadow-[0_4px_20px_rgba(25,31,38,.035)] dark:border-white/[.08] dark:bg-[#191a1f] sm:p-8">
    <div><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Manage</p><h2 className="mt-2 text-2xl font-semibold">Collections</h2><p className="mt-2 text-xs leading-6 text-[#8a9098]">Select a collection to manage its centralized products and display order.</p></div>
    {error ? <p role="alert" className="mt-5 text-sm text-red-600">{error}</p> : null}
    {loading ? <p className="mt-8 text-sm text-[#8a9098]">Loading collections…</p> : collections.length ? <div className="mt-8 overflow-hidden rounded-xl border border-black/[.06] dark:border-white/[.08]"><table className="w-full table-fixed text-left text-sm"><thead className="border-b border-black/[.07] text-[9px] uppercase tracking-[.16em] text-[#8a9098]"><tr><th className="w-[44%] px-4 py-3 sm:w-[26%]">Collection</th><th className="hidden w-[28%] px-4 py-3 md:table-cell">Slug</th><th className="hidden w-[14%] px-4 py-3 sm:table-cell">Status</th><th className="hidden w-[16%] px-4 py-3 lg:table-cell">Created</th><th className="w-[20%] px-4 py-3 text-right sm:w-[11%]">Products</th><th className="w-10 px-2 py-3"><span className="sr-only">Open</span></th></tr></thead><tbody>{collections.map((collection) => <tr key={collection.id} role="link" tabIndex={0} aria-label={`Open ${collection.name} collection`} onClick={() => router.push(`${basePath}/${collection.slug}`)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); router.push(`${basePath}/${collection.slug}`); } }} className="group cursor-pointer border-b border-black/[.055] transition last:border-b-0 hover:bg-[#faf8f4] focus:bg-[#faf8f4] focus:outline-none dark:hover:bg-white/[.035] dark:focus:bg-white/[.035]"><td className="px-4 py-4 font-medium text-[#353a42] dark:text-white"><span className="block truncate">{collection.name}</span><span className="mt-1 block truncate text-[10px] font-normal text-[#8a9098] md:hidden">{collection.slug}</span></td><td className="hidden truncate px-4 py-4 text-[#6e747d] md:table-cell">{collection.slug}</td><td className="hidden px-4 py-4 capitalize text-[#6e747d] sm:table-cell">{displayStatus(collection.status)}</td><td className="hidden px-4 py-4 text-[#6e747d] lg:table-cell">{collection.createdAt ? new Date(collection.createdAt).toLocaleDateString() : '—'}</td><td className="px-4 py-4 text-right tabular-nums text-[#6e747d]">{collection.productCount}</td><td className="px-2 py-4 text-[#9a7a4d]"><ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" /></td></tr>)}</tbody></table></div> : <div className="mt-8 rounded-xl border border-dashed border-black/10 px-6 py-12 text-center text-sm text-[#8a9098]">No collections available.</div>}
  </section>;
}
