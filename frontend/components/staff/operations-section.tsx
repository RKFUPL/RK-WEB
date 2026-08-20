'use client';

import { MoreHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiBaseUrl, getCurrentUser, type Role, type StaffPermission } from '@/lib/rbac';

type Item = Record<string, unknown> & { id: string };
type Section = 'products' | 'inventory' | 'quotes' | 'orders' | 'customers';
type SizeEntry = { size: string; stock: number; enabled: boolean };
type VariantStatus = 'active' | 'inactive' | 'remove';
type AdminProductVariant = { id: string; sku: string; colour: string; status: VariantStatus; images?: string[]; stock?: number; sizeInventory?: SizeEntry[] };

const permissions: Record<Section, StaffPermission> = {
  products: 'products:manage', inventory: 'inventory:manage', quotes: 'quotes:manage', orders: 'orders:manage', customers: 'customers:manage',
};
const columns: Record<Section, Array<[string, string]>> = {
  products: [['name', 'Product & colour variants'], ['sku', 'Parent SKU'], ['price', 'Base price'], ['stock', 'Tracked stock'], ['sizeInventory', 'Size inventory by SKU'], ['availability', 'Variant status']],
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
const compactInputClass = 'h-8 w-12 rounded border border-black/10 bg-white px-1 text-center text-xs tabular-nums outline-none transition focus:border-[#9a7a4d] focus:ring-1 focus:ring-[#9a7a4d]/20 dark:border-white/10 dark:bg-[#121317]';
const standardSizes = ['XS', 'S', 'M', 'L', 'XL'];

function isSizeConfigured(item: Item) {
  return item.sizeInventoryConfigured === true || item.sizeSystemEnabled === true;
}

function entriesFromValue(value: unknown): SizeEntry[] {
  const source = Array.isArray(value) ? value : [];
  return standardSizes.map((size) => {
    const entry = source.find((candidate) => candidate && typeof candidate === 'object' && String((candidate as Record<string, unknown>).size).toUpperCase() === size) as Record<string, unknown> | undefined;
    const stock = Number(entry?.stock ?? 0);
    return { size, stock: Number.isFinite(stock) && stock >= 0 ? Math.floor(stock) : 0, enabled: entry?.enabled !== false };
  });
}

function entriesFromForm(form: Record<string, string>) {
  try { return entriesFromValue(JSON.parse(form.sizeInventory || '[]')); } catch { return entriesFromValue([]); }
}

function totalStock(entries: SizeEntry[]) {
  return entries.reduce((total, entry) => total + (entry.enabled ? entry.stock : 0), 0);
}

function booleanValue(value: unknown) {
  return typeof value === 'string' ? value.toLowerCase() === 'true' : Boolean(value);
}

function currency(value: unknown) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

function variantsFromItem(item: Item): AdminProductVariant[] {
  if (!Array.isArray(item.variants)) return [];
  return item.variants.filter((variant): variant is AdminProductVariant => Boolean(
    variant && typeof variant === 'object' && typeof (variant as AdminProductVariant).id === 'string',
  ));
}

function productColourText(item: Item) {
  const variantColours = variantsFromItem(item).filter((variant) => variant.status !== 'remove').map((variant) => variant.colour).filter(Boolean);
  if (variantColours.length) return variantColours.join(', ');
  const attributes = item.attributes && typeof item.attributes === 'object' ? item.attributes as Record<string, unknown> : {};
  const value = Array.isArray(attributes.colors) && attributes.colors.length ? attributes.colors : attributes.color;
  if (Array.isArray(value)) return value.filter(Boolean).map(String).join(', ');
  return value ? String(value) : '';
}

function statusFor(item: Item) {
  const variants = variantsFromItem(item);
  if (variants.length) {
    if (variants.every((variant) => variant.status === 'remove')) return { label: 'Removed', dot: 'bg-[#858b94]' };
    if (variants.some((variant) => variant.status === 'active')) return { label: 'Active', dot: 'bg-emerald-600' };
    return { label: 'Sold out', dot: 'bg-red-500' };
  }
  const availability = String(item.availability ?? '').toLowerCase();
  if (availability === 'sold_out') return { label: 'Sold out', dot: 'bg-red-500' };
  if (availability === 'custom_order') return { label: 'Custom order', dot: 'bg-[#9a7a4d]' };
  return { label: 'In stock', dot: 'bg-emerald-600' };
}

function ProductThumbnail({ item }: { item: Item }) {
  const media = Array.isArray(item.media) ? item.media : [];
  const variantImage = variantsFromItem(item).find((variant) => variant.status !== 'remove' && variant.images?.length)?.images?.[0];
  const image = typeof variantImage === 'string' ? variantImage : typeof media[0] === 'string' ? media[0] : '';
  return <div className="h-12 w-10 shrink-0 overflow-hidden rounded-[10px] bg-[#eee8de] dark:bg-white/[.06]">{image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[9px] uppercase tracking-[.12em] text-[#9a7a4d]">RK</div>}</div>;
}

function VariantStatusControls({ item, busy, onChange }: { item: Item; busy: boolean; onChange: (variantId: string, status: VariantStatus) => void }) {
  const variants = variantsFromItem(item);
  if (!variants.length) return null;
  return <div className="mt-2 space-y-1.5 border-t border-black/[.06] pt-2 dark:border-white/[.08]">
    {variants.map((variant) => <div key={variant.id} className="flex min-w-[17rem] items-center justify-between gap-2 text-[9px]">
      <span className="min-w-0"><span className="font-medium uppercase tracking-[.1em] text-[#9a7a4d]">{variant.colour || 'Default'}</span><span className="ml-2 text-[#858b94]">{variant.sku}</span></span>
      <select aria-label={`Status for ${variant.sku}`} value={variant.status} disabled={busy} onChange={(event) => onChange(variant.id, event.target.value as VariantStatus)} className="rounded border border-black/10 bg-white px-2 py-1 text-[9px] uppercase tracking-[.08em] dark:border-white/10 dark:bg-[#121317]">
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="remove">Remove</option>
      </select>
    </div>)}
  </div>;
}

function ProductSizeCell({ entries, allocationTarget, onChange }: { entries: SizeEntry[]; allocationTarget: number; onChange: (size: string, value: string) => void }) {
  const allocated = totalStock(entries);
  return <div className="min-w-[20rem]">
    <div className="flex items-end gap-1.5">
      {entries.map((entry) => <label key={entry.size} className="text-center text-[9px] uppercase tracking-[.12em] text-[#858b94]"><span className="block pb-1">{entry.size}</span><input aria-label={`${entry.size} stock`} type="number" min={0} step={1} value={entry.stock} onChange={(event) => onChange(entry.size, event.target.value)} className={compactInputClass} /></label>)}
    </div>
    <p className={`mt-2 text-[10px] tabular-nums ${allocated === allocationTarget ? 'text-emerald-700' : 'text-[#9a7a4d]'}`}>{allocated} / {allocationTarget} allocated</p>
  </div>;
}

function VariantSizeCells({ variants, busy, onChange }: { variants: AdminProductVariant[]; busy: boolean; onChange: (variantId: string, size: string, value: string) => void }) {
  if (!variants.length) return <span className="text-xs text-[#858b94]">No colour SKUs</span>;
  return <div className="min-w-[22rem] space-y-4">
    {variants.filter((variant) => variant.status !== 'remove').map((variant) => {
      const entries = entriesFromValue(variant.sizeInventory);
      return <div key={variant.id} className="border-b border-black/[.06] pb-3 last:border-b-0 last:pb-0 dark:border-white/[.08]">
        <div className="mb-2 flex items-center gap-2 text-[9px] uppercase tracking-[.1em]">
          <span className="font-medium text-[#9a7a4d]">{variant.colour || 'Default'}</span>
          <span className="text-[#858b94]">{variant.sku}</span>
        </div>
        <ProductSizeCell entries={entries} allocationTarget={variant.stock ?? totalStock(entries)} onChange={(size, value) => onChange(variant.id, size, value)} />
      </div>;
    })}
  </div>;
}

function ProductVariantGroups({ items, busy, onStatusChange, onSizeChange, onEdit, onDelete }: {
  items: Item[];
  busy: boolean;
  onStatusChange: (productId: string, variantId: string, status: VariantStatus) => void;
  onSizeChange: (productId: string, variantId: string, size: string, value: string) => void;
  onEdit: (item: Item) => void;
  onDelete: (item: Item) => void;
}) {
  const [openAction, setOpenAction] = useState<string | null>(null);
  return <div className="mt-7 space-y-5">
    {items.map((item) => {
      const variants = variantsFromItem(item).filter((variant) => variant.status !== 'remove');
      return <article key={item.id} className="overflow-visible rounded-xl border border-black/[.08] bg-[#fffdf9] dark:border-white/[.08] dark:bg-white/[.02]">
        <header className="relative flex flex-wrap items-baseline justify-between gap-3 border-b border-black/[.07] px-5 py-4 pr-16 dark:border-white/[.08]">
          <div className="flex min-w-0 items-center gap-3">
            <ProductThumbnail item={item} />
            <div className="min-w-0"><h3 className="text-lg font-medium text-[#20242b] dark:text-white">{String(item.name ?? 'Unnamed product')}</h3><p className="mt-1 text-[10px] uppercase tracking-[.16em] text-[#858b94]">{String(item.category || 'Couture')} · Parent SKU {String(item.sku || '—')}</p></div>
          </div>
          <p className="text-sm tabular-nums text-[#6e747d]">Base price · {currency(item.price)}</p>
          <div className="absolute right-5 top-4"><button type="button" title={`Actions for ${String(item.name || 'product')}`} aria-label={`Actions for ${String(item.name || 'product')}`} onClick={() => setOpenAction((current) => current === `${item.id}:parent` ? null : `${item.id}:parent`)} className="grid h-8 w-8 place-items-center rounded-full border border-black/10 text-[#858b94] transition hover:border-[#9a7a4d] hover:text-[#9a7a4d]"><MoreHorizontal size={16} /></button>{openAction === `${item.id}:parent` ? <div className="absolute right-0 top-10 z-30 w-44 rounded-lg border border-black/10 bg-white p-1 text-xs shadow-lg dark:border-white/10 dark:bg-[#191a1f]"><button type="button" onClick={() => { setOpenAction(null); onEdit(item); }} className="block w-full rounded px-3 py-2 text-left hover:bg-[#faf8f4] dark:hover:bg-white/[.06]">Edit product</button><a href={`/products/${item.id}`} className="block w-full rounded px-3 py-2 text-left hover:bg-[#faf8f4] dark:hover:bg-white/[.06]">View product</a><button type="button" onClick={() => { setOpenAction(null); onDelete(item); }} className="block w-full rounded px-3 py-2 text-left text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30">Delete product</button></div> : null}</div>
        </header>
        <div className="hidden grid-cols-[minmax(10rem,1fr)_minmax(13rem,1.1fr)_minmax(19rem,1.5fr)_minmax(8rem,.7fr)_3rem] gap-4 px-5 py-3 text-[9px] uppercase tracking-[.16em] text-[#858b94] md:grid"><span>Colour variant</span><span>SKU</span><span>Size inventory · total</span><span>Status</span><span /></div>
        <div className="divide-y divide-black/[.06] dark:divide-white/[.08]">
          {variants.length ? variants.map((variant) => {
            const entries = entriesFromValue(variant.sizeInventory);
            const actionKey = `${item.id}:${variant.id}`;
            return <div key={variant.id} className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(10rem,1fr)_minmax(13rem,1.1fr)_minmax(19rem,1.5fr)_minmax(8rem,.7fr)_3rem] md:items-center">
              <div><p className="font-medium uppercase tracking-[.1em] text-[#9a7a4d]">{variant.colour || 'Default'}</p><p className="mt-1 text-[10px] text-[#858b94] md:hidden">{variant.sku}</p></div>
              <p className="break-words text-xs text-[#6e747d]">{variant.sku}</p>
              <div><p className="mb-2 text-[9px] uppercase tracking-[.14em] text-[#858b94] md:hidden">Size inventory · total {variant.stock ?? totalStock(entries)}</p><ProductSizeCell entries={entries} allocationTarget={variant.stock ?? totalStock(entries)} onChange={(size, value) => onSizeChange(item.id, variant.id, size, value)} /></div>
              <select aria-label={`Status for ${variant.sku}`} value={variant.status} disabled={busy} onChange={(event) => onStatusChange(item.id, variant.id, event.target.value as VariantStatus)} className="w-fit rounded border border-black/10 bg-white px-2 py-1.5 text-[9px] uppercase tracking-[.08em] dark:border-white/10 dark:bg-[#121317]"><option value="active">Active</option><option value="inactive">Inactive</option><option value="remove">Remove</option></select>
              <div className="relative justify-self-start md:justify-self-end"><button type="button" title={`Actions for ${variant.sku}`} aria-label={`Actions for ${variant.sku}`} onClick={() => setOpenAction((current) => current === actionKey ? null : actionKey)} className="grid h-8 w-8 place-items-center rounded-full border border-black/10 text-[#858b94] transition hover:border-[#9a7a4d] hover:text-[#9a7a4d]"><MoreHorizontal size={16} /></button>{openAction === actionKey ? <div className="absolute right-0 top-10 z-20 w-44 rounded-lg border border-black/10 bg-white p-1 text-xs shadow-lg dark:border-white/10 dark:bg-[#191a1f]"><button type="button" onClick={() => { setOpenAction(null); onEdit(item); }} className="block w-full rounded px-3 py-2 text-left hover:bg-[#faf8f4] dark:hover:bg-white/[.06]">Edit product</button><a href={`/products/${item.id}`} className="block rounded px-3 py-2 hover:bg-[#faf8f4] dark:hover:bg-white/[.06]">View {variant.sku}</a><button type="button" onClick={() => { setOpenAction(null); onEdit(item); }} className="block w-full rounded px-3 py-2 text-left hover:bg-[#faf8f4] dark:hover:bg-white/[.06]">Manage images</button><button type="button" onClick={() => { setOpenAction(null); onDelete(item); }} className="block w-full rounded px-3 py-2 text-left text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30">Delete product</button></div> : null}</div>
            </div>;
          }) : <p className="px-5 py-5 text-sm text-[#858b94]">No visible colour variants.</p>}
        </div>
      </article>;
    })}
  </div>;
}

function formatValue(key: string, value: unknown) {
  if (key === 'price' || key === 'total') return currency(value);
  if (key === 'assignedStaffId') return value ? 'Assigned to you' : 'Unassigned';
  if (key === 'availability') return ({ in_stock: 'In Stock', custom_order: 'Custom Order', sold_out: 'Out of Stock' } as Record<string, string>)[String(value)] ?? '—';
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function CreateForm({ section, initial, busy, onCancel, onSave }: { section: Exclude<Section, 'inventory'>; initial: Record<string, string>; busy: boolean; onCancel: () => void; onSave: (form: Record<string, string>) => Promise<void> }) {
  const [form, setForm] = useState(initial);
  const field = (name: string, label: string, type = 'text') => <label className="text-[10px] uppercase tracking-[.16em] text-[#858b94]">{label}<input required={name !== 'orderNumber' && name !== 'quoteNumber' && name !== 'description' && name !== 'notes'} type={type} min={type === 'number' ? 0 : undefined} value={form[name] ?? ''} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} className={`${inputClass} mt-2 normal-case tracking-normal`} /></label>;
  return <form onSubmit={(event: FormEvent) => { event.preventDefault(); void onSave(form); }} className="mt-6 rounded-xl border border-[#9a7a4d]/20 bg-[#faf8f4] p-5 dark:bg-white/[.03]"><div className="grid gap-4 md:grid-cols-2">{section === 'products' ? <>{field('name', 'Product name')}{field('sku', 'SKU')}{field('price', 'Price', 'number')}{field('stock', 'Opening stock', 'number')}{field('description', 'Description')}<label className="text-[10px] uppercase tracking-[.16em] text-[#858b94]">Workflow status<select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} className={`${inputClass} mt-2 normal-case tracking-normal`}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select></label><label className="text-[10px] uppercase tracking-[.16em] text-[#858b94]">Availability<select value={form.availability} onChange={(event) => setForm((current) => ({ ...current, availability: event.target.value }))} className={`${inputClass} mt-2 normal-case tracking-normal`}><option value="in_stock">In Stock</option><option value="custom_order">Custom Order</option><option value="sold_out">Out of Stock</option></select></label></> : section === 'customers' ? <>{field('displayName', 'Full name')}{field('email', 'Email', 'email')}{field('phone', 'Phone number')}</> : <>{field(section === 'quotes' ? 'quoteNumber' : 'orderNumber', `${section === 'quotes' ? 'Quote' : 'Order'} number · optional`)}{field('customerName', 'Customer name')}{field('email', 'Customer email', 'email')}{field('total', 'Total', 'number')}{section === 'quotes' ? field('notes', 'Notes') : null}</>}</div><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={onCancel} className="rounded-lg border border-black/10 px-4 py-2 text-xs">Cancel</button><button disabled={busy} className="rounded-lg bg-[#24211e] px-4 py-2 text-xs text-white disabled:opacity-40">{busy ? 'Saving…' : `Save ${section.slice(0, -1)}`}</button></div></form>;
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
  const [openActions, setOpenActions] = useState<string | null>(null);
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
      const canUse = user?.role === 'admin' || (user?.role === 'staff' && section !== 'customers' && Boolean(user?.permissions?.includes(permissions[section])));
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

  const editableFields = useMemo(() => section === 'products' ? ['name', 'sku', 'price', 'stock', 'availability', 'status', 'description'] : section === 'customers' ? ['displayName', 'email', 'phone'] : section === 'orders' ? ['customerName', 'email', 'total'] : section === 'quotes' ? ['customerName', 'email', 'total', 'notes'] : [], [section]);
  const beginEdit = (item: Item) => {
    const availability = String(item.availability ?? 'in_stock').toLowerCase();
    const values = Object.fromEntries(editableFields.map((key) => [key, String(item[key] ?? '')]));
    setEditing(item.id);
    setEditForm({ ...values, availability, stock: String(item.stock ?? '0'), legacyStock: String(item.stock ?? 0), sizeInventory: JSON.stringify(item.sizeInventory ?? []), sizeSystemEnabled: String(Boolean(item.sizeSystemEnabled)), sizeInventoryConfigured: String(Boolean(item.sizeInventoryConfigured ?? item.sizeSystemEnabled)), changeReason: '' });
  };

  const updateProductSize = (item: Item, size: string, rawValue: string) => {
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 0) { setError('Size quantities must be whole numbers greater than or equal to 0.'); return; }
    const base = editing === item.id ? editForm : {
      name: String(item.name ?? ''), sku: String(item.sku ?? ''), price: String(item.price ?? ''), stock: String(item.stock ?? 0), availability: String(item.availability ?? 'in_stock'), status: String(item.status ?? ''), description: String(item.description ?? ''), legacyStock: String(item.stock ?? 0), sizeInventory: JSON.stringify(item.sizeInventory ?? []), sizeSystemEnabled: String(Boolean(item.sizeSystemEnabled)), sizeInventoryConfigured: String(Boolean(item.sizeInventoryConfigured ?? item.sizeSystemEnabled)), changeReason: '',
    };
    const entries = editing === item.id ? entriesFromForm(base) : (isSizeConfigured(item) ? entriesFromValue(item.sizeInventory) : entriesFromValue([]));
    const next = entries.map((entry) => entry.size === size ? { ...entry, stock: value } : entry);
    const total = totalStock(next);
    setEditing(item.id);
    setEditForm({ ...base, sizeInventoryConfigured: 'true', sizeSystemEnabled: 'true', sizeInventory: JSON.stringify(next), stock: String(total) });
    setError('');
  };

  const patch = async (id: string, updates: Record<string, unknown>, success = 'Updated successfully.') => {
    const current = items.find((item) => item.id === id);
    let normalizedUpdates = { ...updates };
    if (section === 'products' && current) {
      const configured = normalizedUpdates.sizeInventoryConfigured !== undefined
        ? booleanValue(normalizedUpdates.sizeInventoryConfigured)
        : normalizedUpdates.sizeSystemEnabled !== undefined
          ? booleanValue(normalizedUpdates.sizeSystemEnabled)
          : isSizeConfigured(current);
      const entries = configured ? (typeof normalizedUpdates.sizeInventory === 'string' ? entriesFromForm(normalizedUpdates as Record<string, string>) : entriesFromValue(normalizedUpdates.sizeInventory ?? current.sizeInventory)) : [];
      const total = configured ? totalStock(entries) : Number(normalizedUpdates.stock ?? current.stock ?? 0);
      if (entries.some((entry) => entry.stock < 0)) { setError('Size quantities cannot be negative.'); return; }
      normalizedUpdates = { ...normalizedUpdates, sizeInventoryConfigured: configured, sizeSystemEnabled: configured };
      if (configured) {
        normalizedUpdates = { ...normalizedUpdates, sizeInventoryConfigured: true, sizeSystemEnabled: true, sizeInventory: entries, stock: total };
        if (!isSizeConfigured(current) && total !== Number(current.stock ?? 0)) { setError(`Allocate all ${Number(current.stock ?? 0)} existing units before saving this row.`); return; }
      }
      const changed = configured !== isSizeConfigured(current) || JSON.stringify(entries) !== JSON.stringify(entriesFromValue(current.sizeInventory)) || total !== Number(current.stock ?? 0) || normalizedUpdates.availability !== current.availability;
      if (changed && !String(normalizedUpdates.reason ?? normalizedUpdates.changeReason ?? '').trim()) {
        const reason = window.prompt('Reason for this inventory change:')?.trim() ?? '';
        if (!reason) { setError('A reason is required before saving inventory changes.'); return; }
        normalizedUpdates.reason = reason;
      }
    }
    setBusy(true); setError('');
    try {
      const requestUpdates = section === 'products' && typeof normalizedUpdates.sizeInventory === 'string' ? { ...normalizedUpdates, sizeInventory: (() => { try { return JSON.parse(String(normalizedUpdates.sizeInventory)); } catch { return []; } })() } : normalizedUpdates;
      const response = await fetch(`${apiBaseUrl}/api/staff/resources/${section}/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(requestUpdates) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to update this record.');
      setItems((currentItems) => section === 'products' && normalizedUpdates.status === 'archived' ? currentItems.filter((item) => item.id !== id) : currentItems.map((item) => item.id === id ? payload.item : item)); setEditing(null); setEditForm({}); setMessage(success);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to update this record.'); }
    finally { setBusy(false); }
  };

  const patchVariantStatus = async (productId: string, variantId: string, status: VariantStatus) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/staff/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to update the variant status.');
      setItems((current) => current.map((item) => item.id === productId ? payload.item : item));
      setMessage(`Variant set to ${status.toUpperCase()}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update the variant status.');
    } finally {
      setBusy(false);
    }
  };

  const patchVariantSize = async (productId: string, variantId: string, size: string, rawValue: string) => {
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 0) { setError('Size quantities must be whole numbers greater than or equal to 0.'); return; }
    const current = items.find((item) => item.id === productId);
    const variant = current ? variantsFromItem(current).find((entry) => entry.id === variantId) : undefined;
    if (!current || !variant) return;
    const next = entriesFromValue(variant.sizeInventory).map((entry) => entry.size === size ? { ...entry, stock: value } : entry);
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/staff/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sizeInventory: next }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to update the variant size inventory.');
      setItems((currentItems) => currentItems.map((item) => item.id === productId ? payload.item : item));
      setMessage(`${variant.sku} ${size} quantity updated.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update the variant size inventory.');
    } finally { setBusy(false); }
  };

  const deleteProduct = (item: Item) => {
    if (!window.confirm(`Delete ${String(item.name || 'this product')} and hide all of its colour variants?`)) return;
    void patch(item.id, { status: 'archived', reason: 'Product deleted from the admin dashboard.' }, 'Product deleted.');
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

  const draftFor = (item: Item) => editing === item.id ? entriesFromForm(editForm) : (isSizeConfigured(item) ? entriesFromValue(item.sizeInventory) : entriesFromValue([]));
  const totalFor = (item: Item) => editing === item.id && editForm.sizeInventoryConfigured === 'true' ? totalStock(draftFor(item)) : isSizeConfigured(item) ? totalStock(draftFor(item)) : Number(item.stock ?? 0);
  const allocationTargetFor = (item: Item) => editing === item.id && editForm.sizeInventoryConfigured === 'true' && !isSizeConfigured(item) ? Number(editForm.legacyStock ?? item.stock ?? 0) : totalFor(item);
  const title = section.replaceAll('-', ' ');

  if (loading) return <p className="mt-10 text-sm text-[#858b94]">Loading secure workspace…</p>;
  if (!supported) return <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-8"><h2 className="text-xl font-semibold">Module unavailable</h2></section>;
  if (!allowed) return <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-8"><h2 className="text-xl font-semibold capitalize">{title}</h2><p className="mt-3 text-sm text-[#858b94]">An administrator has not granted this capability.</p></section>;

  return <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-6 shadow-[0_4px_20px_rgba(25,31,38,.035)] dark:border-white/[.08] dark:bg-[#191a1f] md:p-8">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Operations</p><h2 className="mt-2 text-2xl font-semibold capitalize">{title}</h2></div><div className="flex gap-2"><form onSubmit={(event) => { event.preventDefault(); setLoading(true); load(search).catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Search failed.')).finally(() => setLoading(false)); }} className="flex"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={section === 'products' ? 'Search products, SKU…' : 'Search'} className="rounded-l-lg border border-black/10 px-3 py-2 text-xs outline-none" /><button className="rounded-r-lg border border-l-0 border-black/10 px-3 py-2 text-xs">Search</button></form>{section !== 'inventory' ? <button type="button" onClick={() => setCreating((current) => !current)} className="rounded-lg bg-[#24211e] px-4 py-2 text-xs text-white transition hover:bg-[#9a7a4d]">{creating ? 'Close' : `Create ${section.slice(0, -1)}`}</button> : null}</div></div>
    {message ? <p className="mt-4 text-sm text-emerald-700">{message}</p> : null}{error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
    {creating && section !== 'inventory' ? <CreateForm section={section as Exclude<Section, 'inventory'>} initial={{ ...emptyForms[section as Exclude<Section, 'inventory'>] }} busy={busy} onCancel={() => setCreating(false)} onSave={create} /> : null}
    {(section === 'orders' || section === 'quotes') && items.length ? <div className="mt-6 rounded-xl border border-black/[.06] bg-[#faf8f4] p-4 dark:bg-white/[.03]"><div className="flex flex-wrap items-center gap-3"><label className="text-[10px] uppercase tracking-[.16em] text-[#858b94]">Edit details<select value={editing ?? ''} onChange={(event) => { const item = items.find((entry) => entry.id === event.target.value); if (item) beginEdit(item); else setEditing(null); }} className="ml-3 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs normal-case tracking-normal"><option value="">Choose {section.slice(0, -1)}</option>{items.filter((item) => item.status !== 'converted').map((item) => <option key={item.id} value={item.id}>{String(item[section === 'orders' ? 'orderNumber' : 'quoteNumber'] ?? item.id)}</option>)}</select></label></div>{editing ? <div className="mt-4 grid gap-3 md:grid-cols-4">{editableFields.map((key) => <label key={key} className="text-[10px] uppercase tracking-[.14em] text-[#858b94]">{key.replaceAll(/([A-Z])/g, ' $1')}<input type={key === 'total' ? 'number' : 'text'} min={key === 'total' ? 0 : undefined} value={editForm[key] ?? ''} onChange={(event) => setEditForm((current) => ({ ...current, [key]: event.target.value }))} className={`${inputClass} mt-2 normal-case tracking-normal`} /></label>)}<div className="flex items-end gap-2"><button disabled={busy} onClick={() => void patch(editing, editForm)} className="rounded-lg bg-[#24211e] px-4 py-2.5 text-xs text-white disabled:opacity-40">Save details</button><button onClick={() => setEditing(null)} className="rounded-lg border border-black/10 px-4 py-2.5 text-xs">Cancel</button></div></div> : null}</div> : null}
    {items.length ? section === 'products' ? <ProductVariantGroups items={items} busy={busy} onStatusChange={patchVariantStatus} onSizeChange={patchVariantSize} onEdit={beginEdit} onDelete={deleteProduct} /> : <div className="mt-7 overflow-x-auto"><table className="min-w-[52rem] w-full text-left text-sm"><thead className="border-b border-black/10 text-[10px] uppercase tracking-[.16em] text-[#858b94]"><tr>{columns[section].map(([, label]) => <th key={label} className="pb-4 pr-4">{label}</th>)}<th className="pb-4">Actions</th></tr></thead><tbody>{items.map((item) => {
      const product: boolean = false;
      const entries = product ? draftFor(item) : [];
      const total = product ? totalFor(item) : 0;
      const status = product ? statusFor({ ...item, availability: editing === item.id ? editForm.availability : item.availability }) : null;
      const productColours = product ? productColourText(item) : '';
      return <tr key={item.id} className="border-b border-black/[.06] align-middle last:border-b-0">
        {columns[section].map(([key]) => <td key={key} className={`py-4 pr-4 text-[#6e747d] ${product && key === 'sizeInventory' ? 'align-top' : ''}`}>
          {product && key === 'name' ? <div className="flex min-w-[19rem] items-start gap-3"><ProductThumbnail item={item} /><div className="min-w-0"><p className="flex min-w-0 items-baseline gap-2"><span className="truncate font-medium text-[#20242b] dark:text-white">{String(item.name ?? 'Unnamed product')}</span>{productColours ? <span title={productColours} className="max-w-[9rem] shrink-0 truncate text-[9px] uppercase tracking-[.1em] text-[#9a7a4d]">· {productColours}</span> : null}</p><p className="mt-1 text-[10px] text-[#858b94]">{String(item.category || 'Couture')}</p><VariantStatusControls item={item} busy={busy} onChange={(variantId, variantStatus) => void patchVariantStatus(item.id, variantId, variantStatus)} /></div></div>
            : product && key === 'price' ? <span className="whitespace-nowrap tabular-nums">{currency(item.price)}</span>
            : product && key === 'stock' ? <span className="text-base font-medium tabular-nums text-[#20242b] dark:text-white">{total}</span>
            : product && key === 'sizeInventory' ? <VariantSizeCells variants={variantsFromItem(item)} busy={busy} onChange={(variantId, size, value) => void patchVariantSize(item.id, variantId, size, value)} />
            : product && key === 'availability' && status ? <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs"><span className={`h-2 w-2 rounded-full ${status.dot}`} />{status.label}</span>
            : key === 'assignedStaffId' && userRole === 'admin' ? <select value={String(item.assignedStaffId ?? '')} disabled={busy} onChange={(event) => void assignCustomer(item.id, event.target.value)} className="max-w-44 rounded border border-black/10 bg-white px-2 py-1.5 text-xs"><option value="">Unassigned</option>{staffUsers.map((staff) => <option key={staff.id} value={staff.id}>{staff.displayName || staff.email || 'Staff member'}</option>)}</select>
            : editing === item.id && editableFields.includes(key) ? <input type={key === 'price' || key === 'stock' ? 'number' : 'text'} min={key === 'price' || key === 'stock' ? 0 : undefined} value={editForm[key] ?? ''} onChange={(event) => setEditForm((current) => ({ ...current, [key]: event.target.value }))} className="w-36 border-b border-black/15 bg-transparent py-1 outline-none" />
            : formatValue(key, item[key])}
        </td>)}
        <td className="py-4"><div className="flex min-w-[8rem] flex-wrap items-center gap-2">
          {section === 'inventory' ? <><input type="number" min={0} value={adjustments[item.id] ?? ''} onChange={(event) => setAdjustments((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="+ / -" className="w-20 rounded border border-black/10 px-2 py-1.5 text-xs" /><input value={adjustmentReasons[item.id] ?? ''} onChange={(event) => setAdjustmentReasons((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Reason" aria-label="Reason for inventory change" className="w-32 rounded border border-black/10 px-2 py-1.5 text-xs" /><button disabled={busy || !adjustments[item.id] || !adjustmentReasons[item.id]?.trim()} onClick={() => void patch(item.id, { adjustment: Number(adjustments[item.id]), reason: adjustmentReasons[item.id] }, 'Inventory adjusted.')} className="text-[10px] uppercase tracking-[.12em] text-[#9a7a4d] disabled:opacity-30">Adjust</button></>
            : section === 'orders' || section === 'quotes' ? <><select value={String(item.status ?? '')} disabled={busy || item.status === 'converted'} onChange={(event) => void patch(item.id, { status: event.target.value })} className="rounded border border-black/10 bg-white px-2 py-1.5 text-xs capitalize"><option value="draft">Draft</option>{section === 'quotes' ? <><option value="sent">Sent</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="converted">Converted</option></> : <><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="processing">Processing</option><option value="fulfilled">Fulfilled</option><option value="cancelled">Cancelled</option></>}</select>{section === 'quotes' && item.status !== 'converted' ? <button disabled={busy} onClick={() => void convertQuote(item.id)} className="text-[10px] uppercase tracking-[.12em] text-[#9a7a4d]">Convert</button> : null}</>
             : <button onClick={() => beginEdit(item)} className="text-[10px] uppercase tracking-[.12em] text-[#9a7a4d]">Edit</button>}
        </div></td>
      </tr>;
    })}</tbody></table></div> : <div className="mt-8 rounded-xl border border-dashed border-black/10 p-10 text-center text-sm text-[#858b94]">No {title} found.</div>}
  </section>;
}
