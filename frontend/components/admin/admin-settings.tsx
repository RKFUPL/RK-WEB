'use client';

import { useEffect, useState } from 'react';
import { BellRing, Database, Save, Store } from 'lucide-react';
import { apiBaseUrl } from '@/lib/rbac';

type SettingsForm = {
  storeName: string;
  supportEmail: string;
  currency: string;
  timezone: string;
  orderPrefix: string;
  lowStockThreshold: number;
  analyticsRetentionDays: number;
  emailNotifications: boolean;
  orderNotifications: boolean;
  lowStockNotifications: boolean;
};

const defaults: SettingsForm = { storeName: 'Rashi Kapoor', supportEmail: '', currency: 'INR', timezone: 'Asia/Kolkata', orderPrefix: 'RK', lowStockThreshold: 5, analyticsRetentionDays: 365, emailNotifications: true, orderNotifications: true, lowStockNotifications: true };
const inputClass = 'mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-3 text-sm normal-case tracking-normal outline-none transition focus:border-[#9a7a4d] dark:border-white/10 dark:bg-[#121317]';

function Toggle({ label, copy, checked, onChange }: { label: string; copy: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex cursor-pointer items-center justify-between gap-5 border-b border-black/[.06] py-4 dark:border-white/[.07]"><span><span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-xs text-[#8a9098]">{copy}</span></span><button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-6 w-11 shrink-0 rounded-full transition active:scale-95 ${checked ? 'bg-[#9a7a4d]' : 'bg-black/15 dark:bg-white/15'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} /></button></label>;
}

export function AdminSettings() {
  const [form, setForm] = useState<SettingsForm>(defaults);
  const [saved, setSaved] = useState<SettingsForm>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = window.localStorage.getItem('rk_access_token') ?? '';
    fetch(`${apiBaseUrl}/api/admin/settings`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? 'Unable to load settings.'); return payload.settings as SettingsForm; })
      .then((settings) => { setForm(settings); setSaved(settings); })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Unable to load settings.'))
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const save = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const token = window.localStorage.getItem('rk_access_token') ?? '';
      const response = await fetch(`${apiBaseUrl}/api/admin/settings`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to save settings.');
      setForm(payload.settings); setSaved(payload.settings); setMessage('Settings saved successfully.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save settings.'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="mt-10 animate-pulse space-y-5"><div className="h-40 rounded-2xl bg-black/5" /><div className="h-40 rounded-2xl bg-black/5" /></div>;

  return <div className="mt-10 space-y-5">
    {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}{message ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}
    <section className="rounded-2xl border border-black/[.06] bg-white p-6 dark:border-white/[.08] dark:bg-[#191a1f]"><div className="flex items-center gap-3"><Store size={19} className="text-[#9a7a4d]" /><div><h2 className="text-base font-semibold">Store details</h2><p className="mt-1 text-xs text-[#8a9098]">Identity and operational defaults used across admin tools.</p></div></div><div className="mt-7 grid gap-5 md:grid-cols-2"><label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Store name<input required value={form.storeName} onChange={(event) => update('storeName', event.target.value)} className={inputClass} /></label><label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Support email<input type="email" value={form.supportEmail} onChange={(event) => update('supportEmail', event.target.value)} placeholder="support@example.com" className={inputClass} /></label><label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Currency<select value={form.currency} onChange={(event) => update('currency', event.target.value)} className={inputClass}><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select></label><label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Timezone<select value={form.timezone} onChange={(event) => update('timezone', event.target.value)} className={inputClass}><option value="Asia/Kolkata">Asia/Kolkata</option><option value="UTC">UTC</option><option value="Europe/London">Europe/London</option><option value="America/New_York">America/New_York</option></select></label><label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Order prefix<input value={form.orderPrefix} maxLength={8} onChange={(event) => update('orderPrefix', event.target.value.toUpperCase())} className={inputClass} /></label><label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Low-stock threshold<input type="number" min={0} value={form.lowStockThreshold} onChange={(event) => update('lowStockThreshold', Number(event.target.value))} className={inputClass} /></label></div></section>
    <div className="grid gap-5 xl:grid-cols-2"><section className="rounded-2xl border border-black/[.06] bg-white p-6 dark:border-white/[.08] dark:bg-[#191a1f]"><div className="flex items-center gap-3"><BellRing size={19} className="text-[#9a7a4d]" /><div><h2 className="text-base font-semibold">Notifications</h2><p className="mt-1 text-xs text-[#8a9098]">Choose which operational alerts admins receive.</p></div></div><div className="mt-4"><Toggle label="Admin email notifications" copy="Allow operational emails to administrators." checked={form.emailNotifications} onChange={(value) => update('emailNotifications', value)} /><Toggle label="New order alerts" copy="Notify admins when a new order is received." checked={form.orderNotifications} onChange={(value) => update('orderNotifications', value)} /><Toggle label="Low-stock alerts" copy="Notify admins when inventory reaches its threshold." checked={form.lowStockNotifications} onChange={(value) => update('lowStockNotifications', value)} /></div></section><section className="rounded-2xl border border-black/[.06] bg-white p-6 dark:border-white/[.08] dark:bg-[#191a1f]"><div className="flex items-center gap-3"><Database size={19} className="text-[#9a7a4d]" /><div><h2 className="text-base font-semibold">Analytics retention</h2><p className="mt-1 text-xs text-[#8a9098]">Control how long anonymous traffic events are retained.</p></div></div><label className="mt-7 block text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Retention period<select value={form.analyticsRetentionDays} onChange={(event) => update('analyticsRetentionDays', Number(event.target.value))} className={inputClass}><option value={30}>30 days</option><option value={90}>90 days</option><option value={180}>180 days</option><option value={365}>1 year</option><option value={730}>2 years</option></select></label><p className="mt-5 text-xs leading-6 text-[#8a9098]">Traffic records contain anonymous visitor/session identifiers, page paths, source categories, and timestamps. Raw IP addresses are not stored.</p></section></div>
    <div className="flex justify-end gap-3"><button type="button" disabled={!dirty || saving} onClick={() => setForm(saved)} className="rounded-lg border border-black/10 px-5 py-3 text-xs transition hover:border-black/30 active:scale-[.98] disabled:opacity-40 dark:border-white/10">Reset</button><button type="button" disabled={!dirty || saving} onClick={save} className="flex items-center gap-2 rounded-lg bg-[#24211e] px-5 py-3 text-xs font-medium text-white transition hover:bg-[#9a7a4d] active:scale-[.98] disabled:opacity-40"><Save size={15} />{saving ? 'Saving…' : 'Save settings'}</button></div>
  </div>;
}
