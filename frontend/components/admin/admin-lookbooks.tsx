'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Save } from 'lucide-react';
import { apiBaseUrl } from '@/lib/rbac';

const names = ['Anamika', 'Espiritu Libre', 'Sandook', 'Inaara', 'Hastakala'] as const;
type LookbookMap = Record<(typeof names)[number], string>;
const defaults: LookbookMap = {
  Anamika: 'https://lookbook.rashikapoor.co.in/catalog/anamika',
  'Espiritu Libre': 'https://lookbook.rashikapoor.co.in/catalog/espiritu-libre',
  Sandook: 'https://lookbook.rashikapoor.co.in/catalog/sandook?page=1',
  Inaara: 'https://lookbook.rashikapoor.co.in/catalog/inaara',
  Hastakala: 'https://lookbook.rashikapoor.co.in/catalog/hastakala',
};

function isValidUrl(value: string) {
  if (!value) return true;
  try { const url = new URL(value); return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.host); } catch { return false; }
}

export function AdminLookbooks() {
  const [form, setForm] = useState<LookbookMap>(defaults);
  const [saved, setSaved] = useState<LookbookMap>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { fetch(`${apiBaseUrl}/api/admin/lookbooks`, { headers: { Authorization: `Bearer ${window.localStorage.getItem('rk_access_token') ?? ''}` }, cache: 'no-store' }).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? 'Unable to load lookbooks.'); return payload.lookbooks as LookbookMap; }).then((lookbooks) => { setForm({ ...defaults, ...lookbooks }); setSaved({ ...defaults, ...lookbooks }); }).catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Unable to load lookbooks.')).finally(() => setLoading(false)); }, []);

  const update = (name: keyof LookbookMap, value: string) => setForm((current) => ({ ...current, [name]: value }));
  const save = async () => {
    setMessage(''); setError('');
    const values = Object.values(form);
    if (names.some((name) => !isValidUrl(form[name]))) { setError('Each destination must be a valid HTTP or HTTPS URL, or blank.'); return; }
    if (new Set(values.filter(Boolean)).size !== values.filter(Boolean).length) { setError('Enabled lookbook destinations must be unique.'); return; }
    setSaving(true);
    try { const response = await fetch(`${apiBaseUrl}/api/admin/lookbooks`, { method: 'PUT', headers: { Authorization: `Bearer ${window.localStorage.getItem('rk_access_token') ?? ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ lookbooks: form }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? 'Unable to save lookbooks.'); const next = { ...defaults, ...payload.lookbooks }; setForm(next); setSaved(next); setMessage('Lookbook destinations saved successfully.'); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save lookbooks.'); } finally { setSaving(false); }
  };

  if (loading) return <p className="mt-10 text-sm text-[#8a9098]">Loading lookbook destinations…</p>;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  return <div className="mt-10 space-y-5"><div><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Content</p><h2 className="mt-2 text-2xl font-semibold">Lookbooks</h2><p className="mt-2 text-sm text-[#8a9098]">Manage the destinations used by the public lookbook cards and links.</p></div>{message ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}{error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}<div className="space-y-4">{names.map((name) => <section key={name} className="rounded-2xl border border-black/[.06] bg-white p-6 dark:border-white/[.08] dark:bg-[#191a1f]"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-base font-semibold">{name}</h3><p className="mt-1 text-xs text-[#8a9098]">Public destination URL</p></div>{form[name] ? <a href={form[name]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[.14em] text-[#9a7a4d]">Open link <ExternalLink size={13} /></a> : <span className="text-xs text-[#8a9098]">Disabled</span>}</div><input aria-label={`${name} destination URL`} value={form[name]} onChange={(event) => update(name, event.target.value)} placeholder="https://…" className="mt-5 w-full rounded-lg border border-black/10 bg-white px-3 py-3 text-sm outline-none transition focus:border-[#9a7a4d] dark:border-white/10 dark:bg-[#121317]" /></section>)}</div><div className="flex justify-end gap-3"><button type="button" disabled={!dirty || saving} onClick={() => setForm(saved)} className="rounded-lg border border-black/10 px-5 py-3 text-xs disabled:opacity-40 dark:border-white/10">Reset</button><button type="button" disabled={!dirty || saving} onClick={() => void save()} className="flex items-center gap-2 rounded-lg bg-[#24211e] px-5 py-3 text-xs font-medium text-white disabled:opacity-40"><Save size={15} />{saving ? 'Saving…' : 'Save lookbooks'}</button></div></div>;
}
