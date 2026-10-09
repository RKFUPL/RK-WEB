'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Save } from 'lucide-react';
import { apiBaseUrl } from '@/lib/rbac';

const names = ['Aakaar', 'Anamika', 'Espiritu Libre', 'Sandook', 'Inaara', 'Hastakala'] as const;
type LookbookMap = Record<(typeof names)[number], string>;

const defaults: LookbookMap = {
  Aakaar: 'https://workdrive.zoho.in/file/45kaa5bb2ec1299cc4455a639950850e76546',
  Anamika: 'https://lookbook.rashikapoor.co.in/catalog/anamika',
  'Espiritu Libre': 'https://lookbook.rashikapoor.co.in/catalog/espiritu-libre',
  Sandook: 'https://lookbook.rashikapoor.co.in/catalog/sandook?page=1',
  Inaara: 'https://lookbook.rashikapoor.co.in/catalog/inaara',
  Hastakala: 'https://workdrive.zoho.in/file/gl0sa74334f9a5230420a9bb10250c4055028',
};

const coverDefaults: LookbookMap = {
  Aakaar: 'https://workdrive.zoho.in/file/45kaa867c2b2ac8014d029e0d6cef5b83bf22',
  Anamika: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785861902/Anamika_ojeh19.png',
  'Espiritu Libre': 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785861902/Espi_bbvgfh.png',
  Sandook: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785861901/Sandook_h0rfqg.png',
  Inaara: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785861901/Inaara_hn30rg.png',
  Hastakala: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785862112/Hastakala_kcb6la.png',
};

function isValidUrl(value: string) {
  if (!value) return true;
  try { const url = new URL(value); return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.host); } catch { return false; }
}

export function AdminLookbooks() {
  const [form, setForm] = useState<LookbookMap>(defaults);
  const [saved, setSaved] = useState<LookbookMap>(defaults);
  const [covers, setCovers] = useState<LookbookMap>(coverDefaults);
  const [savedCovers, setSavedCovers] = useState<LookbookMap>(coverDefaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/admin/lookbooks`, { headers: { Authorization: `Bearer ${window.localStorage.getItem('rk_access_token') ?? ''}` }, cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Unable to load lookbooks.');
        return payload as { lookbooks: LookbookMap; lookbookCovers?: LookbookMap };
      })
      .then((payload) => {
        const next = { ...defaults, ...payload.lookbooks };
        const nextCovers = { ...coverDefaults, ...payload.lookbookCovers };
        setForm(next); setSaved(next); setCovers(nextCovers); setSavedCovers(nextCovers);
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Unable to load lookbooks.'))
      .finally(() => setLoading(false));
  }, []);

  const update = (name: keyof LookbookMap, value: string) => setForm((current) => ({ ...current, [name]: value }));
  const updateCover = (name: keyof LookbookMap, value: string) => setCovers((current) => ({ ...current, [name]: value }));
  const save = async () => {
    setMessage(''); setError('');
    const values = Object.values(form);
    if (names.some((name) => !isValidUrl(form[name]) || !isValidUrl(covers[name]))) { setError('Each cover and destination must be a valid HTTP or HTTPS URL, or blank.'); return; }
    if (new Set(values.filter(Boolean)).size !== values.filter(Boolean).length) { setError('Enabled lookbook destinations must be unique.'); return; }
    setSaving(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/lookbooks`, { method: 'PUT', headers: { Authorization: `Bearer ${window.localStorage.getItem('rk_access_token') ?? ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ lookbooks: form, lookbookCovers: covers }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to save lookbooks.');
      const next = { ...defaults, ...payload.lookbooks };
      const nextCovers = { ...coverDefaults, ...payload.lookbookCovers };
      setForm(next); setSaved(next); setCovers(nextCovers); setSavedCovers(nextCovers); setMessage('Lookbook destinations saved successfully.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save lookbooks.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="mt-10 text-sm text-[#8a9098]">Loading lookbook destinations…</p>;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved) || JSON.stringify(covers) !== JSON.stringify(savedCovers);
  return <div className="mt-10 space-y-5">
    <div><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Content</p><h2 className="mt-2 text-2xl font-semibold">Lookbooks</h2><p className="mt-2 text-sm text-[#8a9098]">Manage the cover and destination used by each public lookbook card.</p></div>
    {message ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}
    {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
    <div className="space-y-4">{names.map((name) => <section key={name} className="rounded-2xl border border-black/[.06] bg-white p-6 dark:border-white/[.08] dark:bg-[#191a1f]">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-base font-semibold">{name}</h3><p className="mt-1 text-xs text-[#8a9098]">Public lookbook settings</p></div>{form[name] ? <a href={form[name]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[.14em] text-[#9a7a4d]">Open link <ExternalLink size={13} /></a> : <span className="text-xs text-[#8a9098]">Disabled</span>}</div>
      <label className="mt-5 block text-xs text-[#8a9098]">Cover / public card URL<input aria-label={`${name} cover URL`} value={covers[name]} onChange={(event) => updateCover(name, event.target.value)} placeholder="https://…" className="mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-3 text-sm text-current outline-none transition focus:border-[#9a7a4d] dark:border-white/10 dark:bg-[#121317]" /></label>
      <label className="mt-4 block text-xs text-[#8a9098]">Opened / public lookbook URL<input aria-label={`${name} destination URL`} value={form[name]} onChange={(event) => update(name, event.target.value)} placeholder="https://…" className="mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-3 text-sm text-current outline-none transition focus:border-[#9a7a4d] dark:border-white/10 dark:bg-[#121317]" /></label>
    </section>)}</div>
    <div className="flex justify-end gap-3"><button type="button" disabled={!dirty || saving} onClick={() => { setForm(saved); setCovers(savedCovers); }} className="rounded-lg border border-black/10 px-5 py-3 text-xs disabled:opacity-40 dark:border-white/10">Reset</button><button type="button" disabled={!dirty || saving} onClick={() => void save()} className="flex items-center gap-2 rounded-lg bg-[#24211e] px-5 py-3 text-xs font-medium text-white disabled:opacity-40"><Save size={15} />{saving ? 'Saving…' : 'Save lookbooks'}</button></div>
  </div>;
}
