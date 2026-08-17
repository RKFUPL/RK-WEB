'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiBaseUrl, getCurrentUser, type Role, type StaffPermission } from '@/lib/rbac';

type Item = Record<string, unknown> & { id: string };
type Section = 'products' | 'inventory' | 'quotes' | 'orders' | 'customers';

const permissions: Record<Section, StaffPermission> = {
  products: 'products:manage', inventory: 'inventory:manage', quotes: 'quotes:manage', orders: 'orders:manage', customers: 'customers:manage',
};
const columns: Record<Section, Array<[string, string]>> = {
  products: [['name', 'Product'], ['sku', 'SKU'], ['price', 'Price'], ['stock', 'Stock']],
  inventory: [['name', 'Product'], ['sku', 'SKU'], ['stock', 'Available'], ['availability', 'Availability']],
  quotes: [['quoteNumber', 'Quote'], ['customerName', 'Customer'], ['email', 'Email'], ['total', 'Total'], ['status', 'Status']],
  orders: [['orderNumber', 'Order'], ['customerName', 'Customer'], ['email', 'Email'], ['total', 'Total'], ['status', 'Status']],
  customers: [['displayName', 'Customer'], ['email', 'Email'], ['phone', 'Phone'], ['assignedStaffId', 'Assignment']],
};
const emptyForms: Record<Exclude<Section, 'inventory'>, Record<string, string>> = {
  products: { name: '', sku: '', price: '', stock: '0', status: 'draft', availability: 'in_stock', description: '' },
  quotes: { quoteNumber: '', customerName: '', email: '', total: '', status: 'draft', notes: '' },
  orders: { orderNumber: '', customerName: '', email: '', total: '', status: 'pending' },
  customers: { displayName: '', email: '', phone: '' },
};

const inputClass = 'w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#9a7a4d] dark:border-white/10 dark:bg-[#121317]';

function formatValue(key: string, value: unknown) {
  if (key === 'price' || key === 'total') return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value ?? 0));
  if (key === 'assignedStaffId') return value ? 'Assigned to you' : 'Unassigned';
  if (key === 'availability') return ({ in_stock: 'In Stock', custom_order: 'Custom Order', sold_out: 'Sold Out' } as Record<string, string>)[String(value)] ?? '—';
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function CreateForm({ section, initial, busy, onCancel, onSave }: { section: Exclude<Section, 'inventory'>; initial: Record<string, string>; busy: boolean; onCancel: () => void; onSave: (form: Record<string, string>) => Promise<void> }) {
  const [form, setForm] = useState(initial);
  const field = (name: string, label: string, type = 'text') => <label className="text-[10px] uppercase tracking-[.16em] text-[#858b94]">{label}<input required={name !== 'orderNumber' && name !== 'quoteNumber' && name !== 'description' && name !== 'notes'} type={type} min={type === 'number' ? 0 : undefined} value={form[name] ?? ''} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} className={`${inputClass} mt-2 normal-case tracking-normal text-[#20242b] dark:text-white`} /></label>;
  return <form onSubmit={(event: FormEvent) => { event.preventDefault(); void onSave(form); }} className="mt-6 rounded-xl border border-[#9a7a4d]/20 bg-[#faf8f4] p-5 dark:bg-white/[.03]"><div className="grid gap-4 md:grid-cols-2">{section === 'products' ? <>{field('name', 'Product name')}{field('sku', 'SKU')}{field('price', 'Price', 'number')}{field('stock', 'Opening stock', 'number')}{field('description', 'Description')}<label className="text-[10px] uppercase tracking-[.16em] text-[#858b94]">Workflow status<select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} className={`${inputClass} mt-2 normal-case tracking-normal`}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select></label><label className="text-[10px] uppercase tracking-[.16em] text-[#858b94]">Availability<select value={form.availability} onChange={(event) => setForm((current) => ({ ...current, availability: event.target.value }))} className={`${inputClass} mt-2 normal-case tracking-normal`}><option value="in_stock">In Stock</option><option value="custom_order">Custom Order</option><option value="sold_out">Sold Out</option></select></label></> : section === 'customers' ? <>{field('displayName', 'Full name')}{field('email', 'Email', 'email')}{field('phone', 'Phone number')}</> : <>{field(section === 'quotes' ? 'quoteNumber' : 'orderNumber', `${section === 'quotes' ? 'Quote' : 'Order'} number · optional`)}{field('customerName', 'Customer name')}{field('email', 'Customer email', 'email')}{field('total', 'Total', 'number')}{section === 'quotes' ? field('notes', 'Notes') : null}</>}</div><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={onCancel} className="rounded-lg border border-black/10 px-4 py-2 text-xs">Cancel</button><button disabled={busy} className="rounded-lg bg-[#24211e] px-4 py-2 text-xs text-white disabled:opacity-40">{busy ? 'Saving…' : `Save ${section.slice(0, -1)}`}</button></div></form>;
}

export function OperationsSection({ section: rawSection }: { section: string }) {
  const section = rawSection as Section;
  const supported = section in permissions;
  const [items, setItems] = useState<Item[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [userRole, setUserRole] = useState<Role>('staff');
  const [staffUsers, setStaffUsers] = useState<Array<{ id: string; displayName?: string; email?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [adjustments, setAdjustments] = useState<Record<string, string>>({});
  const [adjustmentReasons, setAdjustmentReasons] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const token = () => window.localStorage.getItem('rk_access_token') ?? '';

  const load = async (query = '') => {
    const response = await fetch(`${apiBaseUrl}/api/staff/resources/${section}${query ? `?q=${encodeURIComponent(query)}` : ''}`, { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'Unable to load this workspace.');
    setItems(payload.items as Item[]);
  };

  useEffect(() => {
    if (!supported) { setLoading(false); return; }
    getCurrentUser().then(async (user) => {
      if (user) setUserRole(user.role);
      const canUse = user?.role === 'admin' || Boolean(user?.permissions?.includes(permissions[section]));
      setAllowed(canUse);
      if (canUse) try {
        await load();
        if (user?.role === 'admin' && section === 'customers') {
          const response = await fetch(`${apiBaseUrl}/api/admin/users`, { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store' });
          const payload = await response.json();
          if (response.ok) setStaffUsers((payload.users as Array<{ id: string; role: Role; isActive: boolean; displayName?: string; email?: string }>).filter((entry) => entry.role === 'staff' && entry.isActive));
        }
      } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to load this workspace.'); }
      setLoading(false);
    });
  }, [section, supported]);

  const create = async (form: Record<string, string>) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/staff/resources/${section}`, { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to create this record.');
      setItems((current) => [payload.item, ...current]); setCreating(false); setMessage('Created successfully.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to create this record.'); }
    finally { setBusy(false); }
  };

  const patch = async (id: string, updates: Record<string, unknown>, success = 'Updated successfully.') => {
    const normalizedUpdates = section === 'products' && ['custom_order', 'sold_out'].includes(String(updates.availability ?? '').toLowerCase())
      ? { ...updates, stock: 0 }
      : updates;
    if (section === 'products') {
      const current = items.find((item) => item.id === id);
      const availability = String(normalizedUpdates.availability ?? current?.availability ?? '').toLowerCase();
      const rawStock = normalizedUpdates.stock;
      const stock = rawStock === undefined || rawStock === '' ? Number(current?.stock ?? 0) : Number(rawStock);
      if (availability === 'in_stock' && stock <= 0) { setError('In Stock products must have a quantity greater than zero.'); return; }
      if ((availability === 'custom_order' || availability === 'sold_out') && stock !== 0) { setError('Custom Order and Sold Out products must have quantity zero.'); return; }
    }
    setBusy(true); setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/staff/resources/${section}/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(normalizedUpdates) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to update this record.');
      setItems((current) => current.map((item) => item.id === id ? payload.item : item)); setEditing(null); setMessage(success);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to update this record.'); }
    finally { setBusy(false); }
  };

  const convertQuote = async (id: string) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/staff/quotes/${id}/convert`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to convert this quote.');
      setItems((current) => current.map((item) => item.id === id ? { ...item, status: 'converted', orderId: payload.item.id } : item)); setMessage(`Quote converted to order ${payload.item.orderNumber}.`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to convert this quote.'); }
    finally { setBusy(false); }
  };

  const assignCustomer = async (id: string, staffId: string) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/customers/${id}/assignment`, { method: 'PATCH', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: staffId || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to update assignment.');
      setItems((current) => current.map((item) => item.id === id ? { ...item, assignedStaffId: payload.user.assignedStaffId } : item)); setMessage('Customer assignment updated.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to update assignment.'); }
    finally { setBusy(false); }
  };

  const title = section.replaceAll('-', ' ');
  const editableFields = useMemo(() => section === 'products' ? ['name', 'sku', 'price', 'stock', 'availability', 'status', 'description'] : section === 'customers' ? ['displayName', 'email', 'phone'] : section === 'orders' ? ['customerName', 'email', 'total'] : section === 'quotes' ? ['customerName', 'email', 'total', 'notes'] : [], [section]);
  const beginEdit = (item: Item) => {
    const availability = String(item.availability ?? 'in_stock').toLowerCase();
    const values = Object.fromEntries(editableFields.map((key) => [key, String(item[key] ?? '')]));
    setEditing(item.id);
    setEditForm({ ...values, availability, stock: String(item.stock ?? '0'), changeReason: '' });
  };

  if (loading) return <p className="mt-10 text-sm text-[#858b94]">Loading secure workspace…</p>;
  if (!supported) return <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-8"><h2 className="text-xl font-semibold">Module unavailable</h2></section>;
  if (!allowed) return <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-8"><h2 className="text-xl font-semibold capitalize">{title}</h2><p className="mt-3 text-sm text-[#858b94]">An administrator has not granted this capability.</p></section>;

  return <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-6 shadow-[0_4px_20px_rgba(25,31,38,.035)] dark:border-white/[.08] dark:bg-[#191a1f] md:p-8">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Operations</p><h2 className="mt-2 text-2xl font-semibold capitalize">{title}</h2></div><div className="flex gap-2"><form onSubmit={(event) => { event.preventDefault(); setLoading(true); load(search).catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Search failed.')).finally(() => setLoading(false)); }} className="flex"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" className="rounded-l-lg border border-black/10 px-3 py-2 text-xs outline-none" /><button className="rounded-r-lg border border-l-0 border-black/10 px-3 py-2 text-xs">Search</button></form>{section !== 'inventory' ? <button type="button" onClick={() => setCreating((current) => !current)} className="rounded-lg bg-[#24211e] px-4 py-2 text-xs text-white transition hover:bg-[#9a7a4d]">{creating ? 'Close' : `Create ${section.slice(0, -1)}`}</button> : null}</div></div>
    {message ? <p className="mt-4 text-sm text-emerald-700">{message}</p> : null}{error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
    {creating && section !== 'inventory' ? <CreateForm section={section as Exclude<Section, 'inventory'>} initial={{ ...emptyForms[section as Exclude<Section, 'inventory'>] }} busy={busy} onCancel={() => setCreating(false)} onSave={create} /> : null}
    {(section === 'orders' || section === 'quotes') && items.length ? <div className="mt-6 rounded-xl border border-black/[.06] bg-[#faf8f4] p-4 dark:bg-white/[.03]"><div className="flex flex-wrap items-center gap-3"><label className="text-[10px] uppercase tracking-[.16em] text-[#858b94]">Edit details<select value={editing ?? ''} onChange={(event) => { const item = items.find((entry) => entry.id === event.target.value); if (item) beginEdit(item); else setEditing(null); }} className="ml-3 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs normal-case tracking-normal"><option value="">Choose {section.slice(0, -1)}</option>{items.filter((item) => item.status !== 'converted').map((item) => <option key={item.id} value={item.id}>{String(item[section === 'orders' ? 'orderNumber' : 'quoteNumber'] ?? item.id)}</option>)}</select></label></div>{editing ? <div className="mt-4 grid gap-3 md:grid-cols-4">{editableFields.map((key) => <label key={key} className="text-[10px] uppercase tracking-[.14em] text-[#858b94]">{key.replaceAll(/([A-Z])/g, ' $1')}<input type={key === 'total' ? 'number' : 'text'} min={key === 'total' ? 0 : undefined} value={editForm[key] ?? ''} onChange={(event) => setEditForm((current) => ({ ...current, [key]: event.target.value }))} className={`${inputClass} mt-2 normal-case tracking-normal`} /></label>)}<div className="flex items-end gap-2"><button disabled={busy} onClick={() => void patch(editing, editForm)} className="rounded-lg bg-[#24211e] px-4 py-2.5 text-xs text-white disabled:opacity-40">Save details</button><button onClick={() => setEditing(null)} className="rounded-lg border border-black/10 px-4 py-2.5 text-xs">Cancel</button></div></div> : null}</div> : null}
    {items.length ? <div className="mt-7 overflow-x-auto"><table className="w-full min-w-[52rem] text-left text-sm"><thead className="border-b border-black/10 text-[10px] uppercase tracking-[.16em] text-[#858b94]"><tr>{columns[section].map(([, label]) => <th key={label} className="pb-4 pr-4">{label}</th>)}<th className="pb-4">Actions</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b border-black/[.06] align-top">{columns[section].map(([key]) => <td key={key} className="py-4 pr-4 text-[#6e747d]">{key === 'assignedStaffId' && userRole === 'admin' ? <select value={String(item.assignedStaffId ?? '')} disabled={busy} onChange={(event) => void assignCustomer(item.id, event.target.value)} className="max-w-44 rounded border border-black/10 bg-white px-2 py-1.5 text-xs"><option value="">Unassigned</option>{staffUsers.map((staff) => <option key={staff.id} value={staff.id}>{staff.displayName || staff.email || 'Staff member'}</option>)}</select> : editing === item.id && editableFields.includes(key) ? <input type={key === 'price' || key === 'stock' ? 'number' : 'text'} min={key === 'price' || key === 'stock' ? 0 : undefined} value={editForm[key] ?? ''} onChange={(event) => setEditForm((current) => ({ ...current, [key]: event.target.value }))} className="w-36 border-b border-black/15 bg-transparent py-1 outline-none" /> : formatValue(key, item[key])}</td>)}<td className="py-3"><div className="flex min-w-[13rem] flex-wrap items-center gap-2">{section === 'inventory' ? <><input type="number" value={adjustments[item.id] ?? ''} onChange={(event) => setAdjustments((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="+ / -" className="w-20 rounded border border-black/10 px-2 py-1.5 text-xs" /><input value={adjustmentReasons[item.id] ?? ''} onChange={(event) => setAdjustmentReasons((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Reason" aria-label="Reason for inventory change" className="w-32 rounded border border-black/10 px-2 py-1.5 text-xs" /><button disabled={busy || !adjustments[item.id] || !adjustmentReasons[item.id]?.trim()} onClick={() => void patch(item.id, { adjustment: Number(adjustments[item.id]), reason: adjustmentReasons[item.id] }, 'Inventory adjusted.')} className="text-[10px] uppercase tracking-[.12em] text-[#9a7a4d] disabled:opacity-30">Adjust</button></> : section === 'orders' || section === 'quotes' ? <><select value={String(item.status ?? '')} disabled={busy || item.status === 'converted'} onChange={(event) => void patch(item.id, { status: event.target.value })} className="rounded border border-black/10 bg-white px-2 py-1.5 text-xs capitalize"><option value="draft">Draft</option>{section === 'quotes' ? <><option value="sent">Sent</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="converted">Converted</option></> : <><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="processing">Processing</option><option value="fulfilled">Fulfilled</option><option value="cancelled">Cancelled</option></>}</select>{section === 'quotes' && item.status !== 'converted' ? <button disabled={busy} onClick={() => void convertQuote(item.id)} className="text-[10px] uppercase tracking-[.12em] text-[#9a7a4d]">Convert to order</button> : null}</> : editing === item.id ? <><select value={editForm.availability ?? ''} onChange={(event) => setEditForm((current) => ({ ...current, availability: event.target.value }))} aria-label="Availability for product" className="rounded border border-black/10 bg-white px-2 py-1.5 text-xs dark:bg-[#121317]"><option value="in_stock">In Stock</option><option value="custom_order">Custom Order</option><option value="sold_out">Sold Out</option></select><input value={editForm.changeReason ?? ''} onChange={(event) => setEditForm((current) => ({ ...current, changeReason: event.target.value }))} placeholder="Reason for change" aria-label="Reason for product change" className="w-40 rounded border border-black/10 px-2 py-1.5 text-xs" /><button disabled={busy} onClick={() => void patch(item.id, { ...editForm, reason: editForm.changeReason }, 'Product updated.')} className="text-[10px] uppercase tracking-[.12em] text-emerald-700">Save</button><button onClick={() => setEditing(null)} className="text-[10px] uppercase tracking-[.12em] text-[#858b94]">Cancel</button></> : <button onClick={() => beginEdit(item)} className="text-[10px] uppercase tracking-[.12em] text-[#9a7a4d]">Edit</button>}</div></td></tr>)}</tbody></table></div> : <div className="mt-8 rounded-xl border border-dashed border-black/10 p-10 text-center text-sm text-[#858b94]">No {title} found.</div>}
  </section>;
}
