'use client';

import { Eye, EyeOff, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiBaseUrl } from '@/lib/rbac';

type Testimonial = {
  id: string;
  displayName: string;
  text: string;
  imageUrl?: string | null;
  imageMedia?: { id?: string; provider: 'zoho_workdrive'; permalink: string } | null;
  contextLabel?: string | null;
  relatedProductId?: string | null;
  relatedCollectionId?: string | null;
  status: 'draft' | 'published';
  displayOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

const emptyDraft: Omit<Testimonial, 'id'> = { displayName: '', text: '', imageUrl: '', imageMedia: null, contextLabel: '', relatedProductId: '', relatedCollectionId: '', status: 'draft', displayOrder: 0 };

function token() { return window.localStorage.getItem('rk_access_token') ?? ''; }

export function AdminTestimonials() {
  const [items, setItems] = useState<Testimonial[]>([]);
  const [draft, setDraft] = useState<Omit<Testimonial, 'id'>>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<Testimonial | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(emptyDraft);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/testimonials`, { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load testimonials.');
      setItems(payload.items ?? []);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to load testimonials.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || editingId) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, editingId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((item) => `${item.displayName} ${item.text} ${item.contextLabel ?? ''}`.toLowerCase().includes(needle)) : items;
  }, [items, query]);

  const reset = () => { setDraft(emptyDraft); setEditingId(null); setError(''); };
  const edit = (item: Testimonial) => { setEditingId(item.id); setDraft({ displayName: item.displayName, text: item.text, imageUrl: item.imageMedia ? '' : item.imageUrl ?? '', imageMedia: item.imageMedia ?? null, contextLabel: item.contextLabel ?? '', relatedProductId: item.relatedProductId ?? '', relatedCollectionId: item.relatedCollectionId ?? '', status: item.status, displayOrder: item.displayOrder }); setMessage(''); setError(''); };
  const closeEditor = () => { if ((dirty || editingId) && !window.confirm('Discard unsaved testimonial changes?')) return; reset(); };

  const save = async () => {
    if (!draft.displayName.trim() || !draft.text.trim()) { setError('Display name and testimonial text are required.'); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/testimonials${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to save testimonial.');
      await load(); reset(); setMessage(editingId ? 'Testimonial updated.' : 'Testimonial created.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save testimonial.'); }
    finally { setSaving(false); }
  };

  const setPublished = async (item: Testimonial) => {
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/testimonials/${item.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: item.status === 'published' ? 'draft' : 'published' }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to change publication status.');
      setItems((current) => current.map((entry) => entry.id === item.id ? payload.item : entry)); setMessage(payload.item.status === 'published' ? 'Testimonial published.' : 'Testimonial unpublished.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to change publication status.'); }
    finally { setSaving(false); }
  };

  const remove = async (item: Testimonial) => {
    if (!window.confirm(`Delete the testimonial from ${item.displayName}? This does not delete any underlying image asset.`)) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/testimonials/${item.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to delete testimonial.');
      await load(); if (editingId === item.id) reset(); setMessage('Testimonial deleted.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to delete testimonial.'); }
    finally { setSaving(false); }
  };

  return <section className="mx-auto mt-8 w-full max-w-6xl text-[#24211e] dark:text-[#f5f1e9] sm:mt-10">
    <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs uppercase tracking-[.22em] text-[#a1753e]">Content studio</p><h1 className="mt-2 font-serif text-4xl font-normal sm:text-5xl">Testimonials</h1><p className="mt-3 max-w-2xl text-base leading-7 text-[#7b7770]">Curate approved client words. Only published records appear on the storefront.</p></div><button type="button" onClick={() => { reset(); setEditingId(''); }} className="admin-button-primary inline-flex min-h-11 items-center gap-2 px-5 py-3 text-sm"><Plus size={16}/>Add testimonial</button></div>
    {message ? <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p> : null}{error ? <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
    <label className="mt-7 flex max-w-md items-center gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/5"><Search size={16} className="text-[#9a7a4d]"/><span className="sr-only">Search testimonials</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search testimonials" className="w-full bg-transparent text-sm outline-none"/></label>
    {editingId !== null ? <div className="mt-7 rounded-2xl border border-[#c9a97c]/35 bg-[#fffdf9] p-6 shadow-sm dark:bg-[#211f1b] sm:p-8 lg:p-10">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[.18em] text-[#a1753e]">{editingId ? 'Edit testimonial' : 'New testimonial'}</p><h2 className="mt-2 font-serif text-3xl">Client words</h2></div><button type="button" onClick={closeEditor} aria-label="Close testimonial editor" className="grid h-11 w-11 place-items-center rounded-lg hover:bg-black/5"><X size={20}/></button></div>
      <div className="mt-8 grid gap-6 md:grid-cols-2 md:gap-x-7">
        <label className="text-sm font-medium text-[#5f5a53]">Display name<input maxLength={100} value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} className="admin-field mt-2 min-h-12 text-base"/></label>
        <label className="text-sm font-medium text-[#5f5a53]">Context label (optional)<input maxLength={120} value={draft.contextLabel ?? ''} onChange={(event) => setDraft((current) => ({ ...current, contextLabel: event.target.value }))} className="admin-field mt-2 min-h-12 text-base" placeholder="Private fitting"/></label>
        <label className="md:col-span-2 text-sm font-medium text-[#5f5a53]">Testimonial<textarea maxLength={1200} value={draft.text} onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))} className="admin-field mt-2 min-h-40 resize-y text-base leading-7"/></label>
        <label className="md:col-span-2 text-sm font-medium text-[#5f5a53]">Managed WorkDrive image (optional)
          <input value={draft.imageMedia?.permalink ?? ''} onChange={(event) => setDraft((current) => ({ ...current, imageMedia: event.target.value ? { provider: 'zoho_workdrive', permalink: event.target.value } : null, imageUrl: event.target.value ? '' : current.imageUrl }))} className="admin-field mt-2 min-h-12 text-base" placeholder="https://workdrive.zoho.in/file/… or https://workdrive.zohoexternal.in/external/…"/>
          <span className="mt-1 block text-[11px] leading-5 text-[#999188]">Paste an approved WorkDrive file link here. It is stored as a managed relationship and served through the testimonial image proxy; the private link is never sent to storefront visitors.</span>
        </label>
        <label className="md:col-span-2 text-sm font-medium text-[#5f5a53]">Public image URL (optional)
          <input value={draft.imageUrl ?? ''} onChange={(event) => setDraft((current) => ({ ...current, imageUrl: event.target.value, imageMedia: event.target.value ? null : current.imageMedia }))} className="admin-field mt-2 min-h-12 text-base" placeholder="https://res.cloudinary.com/…"/>
          <span className="mt-1 block text-[11px] leading-5 text-[#999188]">Use an approved public Cloudinary HTTPS image. Private WorkDrive links belong in the managed field above.</span>
        </label>
        <label className="text-sm font-medium text-[#5f5a53]">Status<select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as Testimonial['status'] }))} className="admin-field mt-2 min-h-12 text-base"><option value="draft">Draft</option><option value="published">Published</option></select></label>
        <label className="text-sm font-medium text-[#5f5a53]">Display order<input type="number" min={0} max={10000} value={draft.displayOrder} onChange={(event) => setDraft((current) => ({ ...current, displayOrder: Number(event.target.value) }))} className="admin-field mt-2 min-h-12 text-base"/></label>
      </div>
      <div className="mt-8 flex flex-wrap justify-end gap-3"><button type="button" onClick={closeEditor} className="admin-button-secondary min-h-11 px-5 py-3 text-sm">Cancel</button><button type="button" disabled={saving} onClick={() => void save()} className="admin-button-primary inline-flex min-h-11 min-w-40 items-center justify-center gap-2 px-5 py-3 text-sm disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin"/> : null}{saving ? 'Saving…' : 'Save testimonial'}</button></div>
    </div> : null}
    <div className="mt-7 overflow-hidden rounded-2xl border border-black/[.07] bg-white dark:border-white/10 dark:bg-[#191a1f]">{loading ? <p className="p-8 text-sm text-[#8a9098]">Loading testimonials…</p> : visible.length ? <div className="divide-y divide-black/[.06] dark:divide-white/10">{visible.map((item) => <article key={item.id} className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><h2 className="font-serif text-xl">{item.displayName}</h2><span className={`rounded-full px-2.5 py-1 text-[9px] uppercase tracking-[.14em] ${item.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-[#f1ece4] text-[#8a6a42]'}`}>{item.status}</span>{item.imageUrl ? <span className="text-[10px] uppercase tracking-[.12em] text-[#9a7a4d]">Image</span> : null}</div><p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-6 text-[#716c65]">“{item.text}”</p><p className="mt-2 text-[10px] uppercase tracking-[.13em] text-[#a19b93]">{item.contextLabel || 'No context label'} · Order {item.displayOrder}{item.updatedAt ? ` · Updated ${new Date(item.updatedAt).toLocaleDateString('en-IN')}` : ''}</p></div><div className="flex items-center gap-1"><button type="button" onClick={() => setPreview(item)} aria-label={`Preview testimonial from ${item.displayName}`} className="rounded-lg p-2 text-[#756f67] hover:bg-black/5"><Eye size={16}/></button><button type="button" onClick={() => edit(item)} aria-label={`Edit testimonial from ${item.displayName}`} className="rounded-lg p-2 text-[#756f67] hover:bg-black/5"><Pencil size={16}/></button><button type="button" disabled={saving} onClick={() => void setPublished(item)} aria-label={`${item.status === 'published' ? 'Unpublish' : 'Publish'} testimonial from ${item.displayName}`} className="rounded-lg px-2 py-1.5 text-[10px] uppercase tracking-[.12em] text-[#9a7a4d] hover:bg-black/5">{item.status === 'published' ? <span className="inline-flex items-center gap-1"><EyeOff size={14}/>Unpublish</span> : 'Publish'}</button><button type="button" disabled={saving} onClick={() => void remove(item)} aria-label={`Delete testimonial from ${item.displayName}`} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 size={16}/></button></div></article>)}</div> : <div className="p-12 text-center"><p className="font-serif text-2xl">No approved words yet.</p><p className="mt-2 text-sm text-[#8a9098]">Create a draft when genuine client feedback is ready.</p></div>}</div>
    {preview ? <div className="fixed inset-0 z-[120] grid place-items-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}><section role="dialog" aria-modal="true" aria-labelledby="testimonial-preview-title" className="w-full max-w-xl overflow-hidden rounded-2xl bg-[#f8f1e7] text-[#2a2622] shadow-2xl"><div className="flex items-center justify-between border-b border-black/10 px-6 py-4"><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Storefront preview</p><button type="button" onClick={() => setPreview(null)} aria-label="Close testimonial preview" className="rounded-lg p-2 hover:bg-black/5"><X size={18}/></button></div>{preview.imageUrl ? <div className="aspect-[16/7] overflow-hidden bg-[#e8dfd2]"><img src={preview.imageUrl} alt={`Portrait of ${preview.displayName}`} className="h-full w-full object-cover"/></div> : null}<div className="p-8"><p aria-hidden="true" className="font-serif text-5xl leading-none text-[#b48750]">“</p><h2 id="testimonial-preview-title" className="mt-2 font-serif text-3xl leading-tight">{preview.text}</h2><p className="mt-7 text-[10px] uppercase tracking-[.25em]">{preview.displayName}</p>{preview.contextLabel ? <p className="mt-2 text-xs uppercase tracking-[.18em] text-[#81786e]">{preview.contextLabel}</p> : null}</div></section></div> : null}
  </section>;
}
