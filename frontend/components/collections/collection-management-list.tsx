'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ChevronRight, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { apiBaseUrl } from '@/lib/rbac';
import type { ManagedCollection } from '@/lib/catalog';
import { formatDate } from '@/lib/date-time';

function displayStatus(status: string) {
  return status === 'collection' || status === 'active' ? 'Collection' : status;
}

function slugify(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function heroLayout(value: string) { return ({ editorial: 'editorial_split', immersive: 'full_bleed', split: 'media_dominant' } as Record<string, string>)[value] || value; }

function CreateCollectionDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (collection: ManagedCollection) => void }) {
  const [form, setForm] = useState({ name: '', slug: '', description: '', status: 'draft', image: '', layout: 'editorial_split' });
  const [slugEdited, setSlugEdited] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [createdSlug, setCreatedSlug] = useState('');
  const workDrive = /(^|\.)workdrive\.zoho(?:external)?\.in$/i.test((() => { try { return new URL(form.image).hostname; } catch { return ''; } })());
  const dirty = Object.values(form).some(Boolean);
  const requestClose = () => { if (!busy && (!dirty || window.confirm('Discard this unsaved collection draft?'))) onClose(); };
  useEffect(() => { const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = previous; }; }, []);
  useEffect(() => {
    if (!form.image || !workDrive) { setPreview(form.image); return; }
    const controller = new AbortController(); let objectUrl = '';
    setPreview(''); setError('');
    void fetch(`${apiBaseUrl}/api/staff/collections/image-preview`, { method: 'POST', headers: { Authorization: `Bearer ${window.localStorage.getItem('rk_access_token') ?? ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: form.image }), signal: controller.signal })
      .then(async (response) => { if (!response.ok) { const payload = await response.json(); throw new Error(payload.error || 'Unable to preview image.'); } objectUrl = URL.createObjectURL(await response.blob()); setPreview(objectUrl); })
      .catch((value) => { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : 'Unable to preview image.'); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [form.image, workDrive]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    const slug = slugify(form.slug || form.name);
    try {
      const token = window.localStorage.getItem('rk_access_token') ?? '';
      if (!createdSlug) {
        const response = await fetch(`${apiBaseUrl}/api/staff/collections`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name, slug, description: form.description, status: form.status, hero: { type: 'image', image: form.image, layout: heroLayout(form.layout) } }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to create collection.');
        setCreatedSlug(slug);
      }
      const readBack = await fetch(`${apiBaseUrl}/api/staff/collections/${encodeURIComponent(slug)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const verified = await readBack.json();
      if (!readBack.ok || !verified.collection) throw new Error('The collection was created, but read-back is unavailable. Do not create it again; use Verify saved collection.');
      onCreated(verified.collection as ManagedCollection);
    } catch (value) { setError(value instanceof Error ? value.message : 'Unable to create collection.'); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[110] bg-black/45 backdrop-blur-[1px]" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}><aside role="dialog" aria-modal="true" aria-labelledby="create-collection-title" className="ml-auto flex h-full w-full max-w-2xl flex-col bg-[#f5f1eb] shadow-[-24px_0_80px_rgba(32,25,18,.18)]"><header className="flex items-start justify-between border-b border-black/[.07] bg-[#fffdf9] px-6 py-5"><div><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Collection management · Create</p><h2 id="create-collection-title" className="mt-2 font-serif text-3xl">{form.name || 'New collection'}</h2></div><button type="button" onClick={requestClose} aria-label="Close collection creation" className="rounded-lg p-2 hover:bg-black/5"><X size={18}/></button></header><form onSubmit={submit} className="flex-1 overflow-y-auto p-6"><div className="admin-panel grid gap-4 p-5 sm:grid-cols-2"><label className="text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Collection name<input autoFocus value={form.name} onChange={(event) => setForm((state) => ({ ...state, name: event.target.value, slug: slugEdited ? state.slug : slugify(event.target.value) }))} className="admin-field mt-1"/></label><label className="text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Slug<input value={form.slug} onChange={(event) => { setSlugEdited(true); setForm((state) => ({ ...state, slug: event.target.value })); }} className="admin-field mt-1"/></label><label className="text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Status<select value={form.status} onChange={(event) => setForm((state) => ({ ...state, status: event.target.value }))} className="admin-field mt-1"><option value="draft">Draft</option><option value="collection">Collection</option><option value="active">Active</option></select></label><label className="text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Hero layout<select value={form.layout} onChange={(event) => setForm((state) => ({ ...state, layout: event.target.value }))} className="admin-field mt-1"><option value="editorial">Editorial</option><option value="immersive">Immersive</option><option value="split">Split</option></select></label><label className="sm:col-span-2 text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Description<textarea value={form.description} onChange={(event) => setForm((state) => ({ ...state, description: event.target.value }))} rows={4} className="admin-field mt-1"/></label><label className="sm:col-span-2 text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Collection image<input value={form.image} onChange={(event) => setForm((state) => ({ ...state, image: event.target.value }))} placeholder="HTTPS image or approved WorkDrive file link" className="admin-field mt-1"/></label><div className="sm:col-span-2 aspect-[16/7] overflow-hidden rounded-xl border border-dashed border-[#9a7a4d]/35 bg-[#eee8de]">{preview ? <img src={preview} alt="Collection hero preview" className="h-full w-full object-cover"/> : <div className="grid h-full place-items-center text-xs text-[#8a9098]">Add a collection image to preview it securely.</div>}</div></div>{error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}<div className="mt-5 flex justify-end"><button disabled={busy} className="admin-button-primary px-5 py-2.5 text-xs disabled:opacity-50">{busy ? 'Saving…' : createdSlug ? 'Verify saved collection' : 'Create collection'}</button></div></form></aside></div>;
}

export function CollectionManagementList({ basePath }: { basePath: '/admin/collections' | '/staff/collections' }) {
  const router = useRouter();
  const [collections, setCollections] = useState<ManagedCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

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

  return <section className="admin-panel mt-8 p-5 sm:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--admin-gold)]">Catalog</p><h2 className="mt-2 text-3xl">Collections</h2><p className="mt-2 text-sm leading-6 text-[var(--admin-muted)]">Select a collection to manage its products, editorial presentation, and display order.</p></div><button type="button" onClick={() => setCreating(true)} className="admin-button-primary inline-flex items-center gap-2 px-4 py-2.5 text-xs"><Plus size={15}/> Add new collection</button></div>
    {error ? <p role="alert" className="mt-5 text-sm text-red-600">{error}</p> : null}
    {loading ? <p className="mt-8 text-sm text-[#8a9098]">Loading collections…</p> : collections.length ? <div className="mt-8 overflow-hidden rounded-xl border border-black/[.06] dark:border-white/[.08]"><table className="w-full table-fixed text-left text-sm"><thead className="border-b border-black/[.07] text-[9px] uppercase tracking-[.16em] text-[#8a9098]"><tr><th className="w-[44%] px-4 py-3 sm:w-[26%]">Collection</th><th className="hidden w-[28%] px-4 py-3 md:table-cell">Slug</th><th className="hidden w-[14%] px-4 py-3 sm:table-cell">Status</th><th className="hidden w-[16%] px-4 py-3 lg:table-cell">Created</th><th className="w-[20%] px-4 py-3 text-right sm:w-[11%]">Products</th><th className="w-10 px-2 py-3"><span className="sr-only">Open</span></th></tr></thead><tbody>{collections.map((collection) => <tr key={collection.id} role="link" tabIndex={0} aria-label={`Open ${collection.name} collection`} onClick={() => router.push(`${basePath}/${collection.slug}`)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); router.push(`${basePath}/${collection.slug}`); } }} className="group cursor-pointer border-b border-black/[.055] transition last:border-b-0 hover:bg-[#faf8f4] focus:bg-[#faf8f4] focus:outline-none dark:hover:bg-white/[.035] dark:focus:bg-white/[.035]"><td className="px-4 py-4 font-medium text-[#353a42] dark:text-white"><span className="block truncate">{collection.name}</span><span className="mt-1 block truncate text-[10px] font-normal text-[#8a9098] md:hidden">{collection.slug}</span></td><td className="hidden truncate px-4 py-4 text-[#6e747d] md:table-cell">{collection.slug}</td><td className="hidden px-4 py-4 capitalize text-[#6e747d] sm:table-cell">{displayStatus(collection.status)}</td><td className="hidden px-4 py-4 text-[#6e747d] lg:table-cell">{collection.createdAt ? formatDate(collection.createdAt) : '—'}</td><td className="px-4 py-4 text-right tabular-nums text-[#6e747d]">{collection.productCount}</td><td className="px-2 py-4 text-[#9a7a4d]"><ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" /></td></tr>)}</tbody></table></div> : <div className="mt-8 rounded-xl border border-dashed border-black/10 px-6 py-12 text-center text-sm text-[#8a9098]">No collections available.</div>}
    {creating ? <CreateCollectionDrawer onClose={() => setCreating(false)} onCreated={(collection) => { setCollections((items) => [collection, ...items.filter((item) => item.id !== collection.id)]); setCreating(false); }} /> : null}
  </section>;
}
