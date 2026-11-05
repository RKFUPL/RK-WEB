'use client';

import { useEffect, useState } from 'react';
import { BarChart3, Database, Image, Save, ShieldCheck, Sparkles, Timer } from 'lucide-react';
import { apiBaseUrl } from '@/lib/rbac';

type AiConfig = {
  enabled: boolean;
  allowGuests: boolean;
  allowLoggedIn: boolean;
  model: string;
  instructions: string;
  maxGenerationsPerCustomerPerDay: number;
  maxGenerationsPerIpPerDay: number;
  maxUploadBytes: number;
  maxImageDimension: number;
  generationTimeoutSeconds: number;
  maxConcurrentRequests: number;
  retentionDays: number;
  apiKeyConfigured: boolean;
  credentialSource: 'backend_environment' | string;
};

type Usage = {
  total: number;
  successful: number;
  failed: number;
  month: string;
  byModel: Array<{ model: string; status: string; count: number }>;
};

const defaults: AiConfig = {
  enabled: false,
  allowGuests: false,
  allowLoggedIn: true,
  model: 'gemini-nano-banana-2.1',
  instructions: '',
  maxGenerationsPerCustomerPerDay: 3,
  maxGenerationsPerIpPerDay: 10,
  maxUploadBytes: 10485760,
  maxImageDimension: 4096,
  generationTimeoutSeconds: 90,
  maxConcurrentRequests: 2,
  retentionDays: 7,
  apiKeyConfigured: false,
  credentialSource: 'backend_environment',
};

const inputClass = 'admin-field mt-2 text-sm normal-case tracking-normal';

function Toggle({ label, copy, checked, onChange }: { label: string; copy: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex cursor-pointer items-center justify-between gap-5 border-b border-black/[.06] py-4 dark:border-white/[.07]"><span><span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-xs text-[#8a9098]">{copy}</span></span><button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-6 w-11 shrink-0 rounded-full transition active:scale-95 ${checked ? 'bg-[#9a7a4d]' : 'bg-black/15 dark:bg-white/15'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} /></button></label>;
}

function Panel({ icon: Icon, title, copy, children }: { icon: typeof Sparkles; title: string; copy: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-black/[.06] bg-white p-6 dark:border-white/[.08] dark:bg-[#191a1f]"><div className="flex items-start gap-3"><Icon size={19} className="mt-0.5 shrink-0 text-[#9a7a4d]" /><div className="min-w-0"><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-[#8a9098]">{copy}</p></div></div><div className="mt-6">{children}</div></section>;
}

export function AdminAiTryon() {
  const [form, setForm] = useState<AiConfig>(defaults);
  const [models, setModels] = useState<Record<string, string>>({});
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const token = () => window.localStorage.getItem('rk_access_token') ?? '';

  const load = async () => {
    setLoading(true); setError('');
    try {
      const headers = { Authorization: `Bearer ${token()}` };
      const [configResponse, usageResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/admin/ai-tryon/config`, { headers, cache: 'no-store' }),
        fetch(`${apiBaseUrl}/api/admin/ai-tryon/usage`, { headers, cache: 'no-store' }),
      ]);
      const configPayload = await configResponse.json();
      if (!configResponse.ok) throw new Error(configPayload.error || 'Unable to load AI Try-On settings.');
      setForm({ ...defaults, ...configPayload.config }); setModels(configPayload.models || {});
      if (usageResponse.ok) {
        const usagePayload = await usageResponse.json();
        setUsage(usagePayload.usage || null);
      }
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to load AI Try-On settings.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const update = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true); setMessage(''); setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/ai-tryon/config`, { method: 'PUT', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to save AI Try-On settings.');
      setForm({ ...form, ...payload.config }); setMessage('AI Try-On configuration saved.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save AI Try-On settings.'); }
    finally { setSaving(false); }
  };

  const testConnection = async () => {
    setTesting(true); setMessage(''); setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/ai-tryon/test-connection`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Connection test failed.');
      setMessage(`Gemini connection succeeded for ${payload.model}.`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Connection test failed.'); }
    finally { setTesting(false); }
  };

  if (loading) return <div className="mt-8 animate-pulse space-y-5"><div className="h-56 rounded-2xl bg-black/5" /><div className="h-56 rounded-2xl bg-black/5" /></div>;

  return <div className="mt-8 space-y-5">
    {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
    {message ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}

    <Panel icon={Sparkles} title="Service configuration" copy="Control the customer-facing service. Gemini credentials are read only from the backend environment.">
      <div className="grid gap-5 md:grid-cols-2"><Toggle label="Enable AI Try-On" copy="The deployment environment kill switch must also be true." checked={form.enabled} onChange={(value) => update('enabled', value)} /><Toggle label="Allow guests" copy="Guest results use a private browser-bound cookie." checked={form.allowGuests} onChange={(value) => update('allowGuests', value)} /><Toggle label="Allow logged-in customers" copy="Permit authenticated customer accounts." checked={form.allowLoggedIn} onChange={(value) => update('allowLoggedIn', value)} /><label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Gemini model<select value={form.model} onChange={(event) => update('model', event.target.value)} className={inputClass}>{Object.entries(models).map(([id, label]) => <option key={id} value={id}>{label} ({id})</option>)}</select></label><div className="rounded-xl border border-black/[.06] bg-[#faf8f4] p-4 text-xs leading-6 text-[#6e747d]"><p className="font-medium text-[#24211e]">Gemini API credential</p><p className={`mt-1 font-medium ${form.apiKeyConfigured ? 'text-emerald-700' : 'text-red-700'}`}>{form.apiKeyConfigured ? 'Configured' : 'Missing'}</p><p className="mt-1">Source: {form.credentialSource === 'backend_environment' ? 'Backend environment' : form.credentialSource} (`GEMINI_API_KEY`)</p><p className="mt-2">Change the key in local backend environment files or deployment secrets. It cannot be entered or saved from this dashboard.</p></div></div>
      <div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={() => void testConnection()} disabled={testing} className="admin-button-secondary px-4 py-3 text-xs">{testing ? 'Testing...' : 'Test connection'}</button><button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#24211e] px-5 py-3 text-xs font-medium text-white hover:bg-[#9a7a4d] disabled:opacity-50"><Save size={15} />{saving ? 'Saving...' : 'Save configuration'}</button></div>
    </Panel>

    <Panel icon={Timer} title="Generation controls" copy="Set bounded limits for image uploads, generation frequency, and backend concurrency.">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"><label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Generations / customer / day<input type="number" min={1} max={100} value={form.maxGenerationsPerCustomerPerDay} onChange={(event) => update('maxGenerationsPerCustomerPerDay', Number(event.target.value))} className={inputClass} /></label><label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Generations / IP / day<input type="number" min={1} max={500} value={form.maxGenerationsPerIpPerDay} onChange={(event) => update('maxGenerationsPerIpPerDay', Number(event.target.value))} className={inputClass} /></label><label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Maximum upload size (bytes)<input type="number" min={1048576} value={form.maxUploadBytes} onChange={(event) => update('maxUploadBytes', Number(event.target.value))} className={inputClass} /></label><label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Maximum image dimension<input type="number" min={512} value={form.maxImageDimension} onChange={(event) => update('maxImageDimension', Number(event.target.value))} className={inputClass} /></label><label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Maximum concurrent requests<input type="number" min={1} max={10} value={form.maxConcurrentRequests} onChange={(event) => update('maxConcurrentRequests', Number(event.target.value))} className={inputClass} /></label><label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Generation timeout (seconds)<input type="number" min={10} max={180} value={form.generationTimeoutSeconds} onChange={(event) => update('generationTimeoutSeconds', Number(event.target.value))} className={inputClass} /></label></div>
    </Panel>

    <Panel icon={ShieldCheck} title="Image privacy & retention" copy="Customer uploads are sent from the backend, generated previews are owner-scoped, and stored files are intended for configured retention only.">
      <div className="grid gap-5 md:grid-cols-2"><label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Retention period (days)<input type="number" min={1} max={90} value={form.retentionDays} onChange={(event) => update('retentionDays', Number(event.target.value))} className={inputClass} /></label><div className="rounded-xl border border-black/[.06] bg-[#faf8f4] p-4 text-xs leading-6 text-[#6e747d]"><p className="font-medium text-[#24211e]">Cleanup status</p><p className="mt-1">The backend cleanup hook uses this retention value. A scheduler status is not exposed by the current API, so verify the maintenance job separately before enabling customer use.</p><p className="mt-2">Customer photographs are not permanently stored by the generation flow; generated previews remain private and can be deleted through the customer history API.</p></div></div>
    </Panel>

    <Panel icon={Image} title="Generation instructions" copy="Optional approved brand direction appended to the existing controlled prompt. Keep instructions specific and privacy-safe.">
      <label className="block text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Approved generation instructions<textarea rows={5} value={form.instructions} onChange={(event) => update('instructions', event.target.value)} className={inputClass} placeholder="Optional brand-safe direction for Gemini" /></label><p className="mt-4 text-xs leading-5 text-[#8a9098]">The backend preserves its default identity, garment-fidelity, lighting, and fit-disclaimer instructions.</p>
    </Panel>

    <Panel icon={BarChart3} title="Usage & monitoring" copy="Read-only statistics returned by the existing admin usage endpoint. Cost estimates are intentionally omitted because pricing data is not configured here.">
      {usage ? <><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-black/[.06] p-4"><p className="text-[10px] uppercase tracking-[.16em] text-[#8a9098]">Total generations</p><p className="mt-2 text-2xl font-semibold">{usage.total}</p></div><div className="rounded-xl border border-black/[.06] p-4"><p className="text-[10px] uppercase tracking-[.16em] text-[#8a9098]">Successful</p><p className="mt-2 text-2xl font-semibold text-emerald-700">{usage.successful}</p></div><div className="rounded-xl border border-black/[.06] p-4"><p className="text-[10px] uppercase tracking-[.16em] text-[#8a9098]">Failed</p><p className="mt-2 text-2xl font-semibold text-red-700">{usage.failed}</p></div></div><p className="mt-4 text-xs text-[#8a9098]">Usage month: {usage.month}. Recent error details and reliable cost estimates are not currently exposed by the backend.</p><div className="mt-5 space-y-2">{usage.byModel.map((row) => <div key={`${row.model}-${row.status}`} className="flex items-center justify-between rounded-lg bg-[#faf8f4] px-3 py-2 text-xs"><span>{row.model}</span><span className="text-[#8a9098]">{row.status} · {row.count}</span></div>)}</div></> : <p className="text-sm text-[#8a9098]">Usage data is unavailable.</p>}
    </Panel>
  </div>;
}
