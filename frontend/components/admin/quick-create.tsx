'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ChevronDown, FolderPlus, Megaphone, PackagePlus, ReceiptText, Sparkles, UserPlus, X } from 'lucide-react';
import { apiBaseUrl, type Role } from '@/lib/rbac';

type Kind = 'product' | 'order' | 'customer' | 'collection' | 'campaign';
type Action = { kind: Kind; label: string; description: string; icon: typeof PackagePlus };

const actions: Action[] = [
  { kind: 'product', label: 'Add product', description: 'Create a catalogue and inventory record', icon: PackagePlus },
  { kind: 'order', label: 'Create order', description: 'Record a new manual order', icon: ReceiptText },
  { kind: 'customer', label: 'Add customer', description: 'Create a customer record for future orders', icon: UserPlus },
  { kind: 'collection', label: 'New collection', description: 'Create a collection workspace', icon: FolderPlus },
  { kind: 'campaign', label: 'New campaign', description: 'Create a marketing campaign', icon: Megaphone },
];

const eligiblePaths = new Set(['/admin/products', '/admin/orders', '/admin/inventory', '/admin/collections', '/admin/customers', '/admin/marketing']);
const emptyForms: Record<Kind, Record<string, string>> = {
  product: { name: '', sku: '', price: '', stock: '', status: 'draft' },
  order: { orderNumber: '', customerName: '', email: '', total: '', status: 'pending' },
  customer: { fullName: '', email: '', phone: '' },
  collection: { name: '', slug: '', status: 'draft' },
  campaign: { name: '', channel: 'email', status: 'draft' },
};

function Field({ label, name, value, onChange, type = 'text', required = true, placeholder }: { label: string; name: string; value: string; onChange: (name: string, value: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return <label className="block text-[10px] uppercase tracking-[.18em] text-[#8a9098]">{label}<input name={name} type={type} required={required} min={type === 'number' ? 0 : undefined} step={name === 'price' || name === 'total' ? '0.01' : undefined} value={value} placeholder={placeholder} onChange={(event) => onChange(name, event.target.value)} className="mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-3 text-sm normal-case tracking-normal text-[#20242b] outline-none transition focus:border-[#9a7a4d] dark:border-white/10 dark:bg-[#121317] dark:text-white" /></label>;
}

function SelectField({ label, name, value, values, onChange }: { label: string; name: string; value: string; values: string[]; onChange: (name: string, value: string) => void }) {
  return <label className="block text-[10px] uppercase tracking-[.18em] text-[#8a9098]">{label}<select name={name} value={value} onChange={(event) => onChange(name, event.target.value)} className="mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-3 text-sm capitalize text-[#20242b] outline-none transition focus:border-[#9a7a4d] dark:border-white/10 dark:bg-[#121317] dark:text-white">{values.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function CreateFields({ kind, form, change }: { kind: Kind; form: Record<string, string>; change: (name: string, value: string) => void }) {
  if (kind === 'product') return <div className="grid gap-4 sm:grid-cols-2"><Field label="Product name" name="name" value={form.name} onChange={change} /><Field label="SKU" name="sku" value={form.sku} onChange={change} /><Field label="Price" name="price" type="number" value={form.price} onChange={change} /><Field label="Opening stock" name="stock" type="number" value={form.stock} onChange={change} /><SelectField label="Status" name="status" value={form.status} values={['draft', 'active', 'archived']} onChange={change} /></div>;
  if (kind === 'order') return <div className="grid gap-4 sm:grid-cols-2"><Field label="Order number · optional" name="orderNumber" value={form.orderNumber} required={false} placeholder="Generated automatically" onChange={change} /><Field label="Customer name" name="customerName" value={form.customerName} onChange={change} /><Field label="Customer email" name="email" type="email" value={form.email} onChange={change} /><Field label="Order total" name="total" type="number" value={form.total} onChange={change} /><SelectField label="Status" name="status" value={form.status} values={['pending', 'confirmed', 'processing', 'fulfilled']} onChange={change} /></div>;
  if (kind === 'customer') return <div className="grid gap-4 sm:grid-cols-2"><Field label="Full name" name="fullName" value={form.fullName} onChange={change} /><Field label="Email" name="email" type="email" value={form.email} onChange={change} /><Field label="Phone number" name="phone" value={form.phone} placeholder="+91 00000 00000" onChange={change} /></div>;
  if (kind === 'collection') return <div className="grid gap-4 sm:grid-cols-2"><Field label="Collection name" name="name" value={form.name} onChange={change} /><Field label="Slug · optional" name="slug" value={form.slug} required={false} placeholder="Generated from name" onChange={change} /><SelectField label="Status" name="status" value={form.status} values={['draft', 'active', 'archived']} onChange={change} /></div>;
  return <div className="grid gap-4 sm:grid-cols-2"><Field label="Campaign name" name="name" value={form.name} onChange={change} /><SelectField label="Channel" name="channel" value={form.channel} values={['email', 'social', 'sms', 'whatsapp']} onChange={change} /><SelectField label="Status" name="status" value={form.status} values={['draft', 'scheduled', 'active', 'completed']} onChange={change} /></div>;
}

export function QuickCreate({ pathname, role }: { pathname: string; role: Role }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); setKind(null); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

  if (role !== 'admin' || !eligiblePaths.has(pathname)) return null;

  const choose = (nextKind: Kind) => {
    setKind(nextKind);
    setForm({ ...emptyForms[nextKind] });
    setError('');
    setMenuOpen(false);
    if ('vibrate' in navigator) navigator.vibrate(8);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!kind) return;
    setSaving(true); setError('');
    try {
      const token = window.localStorage.getItem('rk_access_token') ?? '';
      const response = await fetch(`${apiBaseUrl}/api/admin/quick-create/${kind}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to create this record.');
      window.dispatchEvent(new CustomEvent('rk-admin-resource-created', { detail: payload }));
      if ('vibrate' in navigator) navigator.vibrate([10, 30, 10]);
      setSuccess(`${selected?.label ?? 'Record'} created successfully.`);
      window.setTimeout(() => setSuccess(''), 3500);
      setKind(null);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to create this record.'); }
    finally { setSaving(false); }
  };

  const selected = actions.find((action) => action.kind === kind);
  return <>
    {success ? <div role="status" className="fixed right-5 top-24 z-[90] rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 shadow-lg">{success}</div> : null}
    <div className="relative"><button type="button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-haspopup="menu" className="flex items-center gap-2 rounded-lg bg-[#24211e] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#9a7a4d] active:scale-[.98]"><Sparkles size={16} />Quick create <ChevronDown size={14} className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`} /></button>{menuOpen ? <><button type="button" aria-label="Close quick create menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setMenuOpen(false)} /><div role="menu" className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-black/10 bg-white p-2 text-[#20242b] shadow-2xl dark:border-white/10 dark:bg-[#191a1f] dark:text-white">{actions.map(({ kind: actionKind, label, description, icon: Icon }) => <button key={actionKind} type="button" role="menuitem" onClick={() => choose(actionKind)} className="group flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition hover:bg-[#f4efe7] active:scale-[.99] dark:hover:bg-white/[.06]"><Icon size={17} className="mt-0.5 text-[#9a7a4d] transition-transform group-hover:scale-110" /><span><span className="block text-sm font-medium">{label}</span><span className="mt-0.5 block text-[11px] text-[#8a9098]">{description}</span></span></button>)}</div></> : null}</div>
    {kind && selected ? <div className="fixed inset-0 z-[80] grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setKind(null); }}><section role="dialog" aria-modal="true" aria-labelledby="quick-create-title" className="w-full max-w-2xl rounded-2xl border border-black/10 bg-[#f8f7f4] p-6 text-[#20242b] shadow-2xl dark:border-white/10 dark:bg-[#191a1f] dark:text-white md:p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] uppercase tracking-[.22em] text-[#9a7a4d]">Quick create</p><h2 id="quick-create-title" className="mt-2 text-2xl font-semibold">{selected.label}</h2><p className="mt-1 text-xs text-[#8a9098]">{selected.description}</p></div><button type="button" onClick={() => setKind(null)} aria-label="Close" className="rounded-lg p-2 transition hover:bg-black/5 active:scale-95 dark:hover:bg-white/10"><X size={18} /></button></div><form onSubmit={submit} className="mt-7"><CreateFields kind={kind} form={form} change={(name, value) => setForm((current) => ({ ...current, [name]: value }))} />{error ? <p role="alert" className="mt-4 text-sm text-red-600">{error}</p> : null}<div className="mt-7 flex justify-end gap-3"><button type="button" onClick={() => setKind(null)} className="rounded-lg border border-black/10 px-5 py-3 text-xs transition hover:border-black/30 active:scale-[.98] dark:border-white/10">Cancel</button><button type="submit" disabled={saving} className="rounded-lg bg-[#24211e] px-5 py-3 text-xs font-medium text-white transition hover:bg-[#9a7a4d] active:scale-[.98] disabled:opacity-50">{saving ? 'Creating…' : selected.label}</button></div></form></section></div> : null}
  </>;
}
