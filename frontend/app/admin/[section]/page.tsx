'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Package } from 'lucide-react';
import { AdminSettings } from '@/components/admin/admin-settings';
import { OperationsSection } from '@/components/staff/operations-section';
import { collectionPages } from '@/lib/home-content';
import { apiBaseUrl, type StaffPermission } from '@/lib/rbac';

type AdminUser = { id: string; email?: string; username?: string; displayName?: string; role: 'customer' | 'staff' | 'admin'; isActive: boolean; permissions?: StaffPermission[] };
type ResourceItem = Record<string, unknown> & { id: string };
type RoleFilter = 'all' | 'staff' | 'admin';

const operationalSections = new Set(['products', 'orders', 'inventory', 'quotes', 'customers']);
const simpleSections = new Set(['collections', 'marketing']);
const columns: Record<string, Array<[string, string]>> = {
  collections: [['name', 'Collection'], ['slug', 'Slug'], ['status', 'Status'], ['createdAt', 'Created']],
  marketing: [['name', 'Campaign'], ['channel', 'Channel'], ['status', 'Status'], ['createdAt', 'Created']],
};
const permissionOptions: Array<[StaffPermission, string]> = [['products:manage', 'Products'], ['inventory:manage', 'Inventory'], ['quotes:manage', 'Quotes'], ['orders:manage', 'Orders'], ['customers:manage', 'Customers']];
const storefrontCollections: ResourceItem[] = collectionPages.filter((collection) => collection.name !== 'Aakaar').map((collection) => ({
  id: `storefront:${collection.route}`,
  name: collection.name,
  slug: collection.route.split('/').filter(Boolean).at(-1) ?? '',
  status: collection.status,
}));

function mergeCollections(items: ResourceItem[]) {
  const visibleItems = items.filter((item) => {
    const name = String(item.name ?? '').trim().toLowerCase();
    const slug = String(item.slug ?? '').trim().toLowerCase();
    return name !== 'aakaar' && slug !== 'aakaar' && slug !== 'aakaar-insights';
  });
  const storedByName = new Map(visibleItems.map((item) => [String(item.name ?? '').trim().toLowerCase(), item]));
  const storefrontNames = new Set(storefrontCollections.map((item) => String(item.name).toLowerCase()));
  return [
    ...storefrontCollections.map((collection) => ({ ...collection, ...storedByName.get(String(collection.name).toLowerCase()) })),
    ...visibleItems.filter((item) => !storefrontNames.has(String(item.name ?? '').trim().toLowerCase())),
  ];
}

function normalized(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function collectionReferences(product: ResourceItem) {
  const reference = product.collection;
  const nested = reference && typeof reference === 'object' && !Array.isArray(reference) ? reference as Record<string, unknown> : {};
  return [product.collectionId, product.collectionName, product.collectionSlug, reference, nested.id, nested.name, nested.slug]
    .map(normalized)
    .filter(Boolean);
}

function belongsToCollection(product: ResourceItem, collection: ResourceItem) {
  const keys = new Set([
    normalized(collection.id).replace(/^storefront:/, ''),
    normalized(collection.name),
    normalized(collection.slug),
  ]);
  return collectionReferences(product).some((reference) => keys.has(reference.replace(/^storefront:/, '')));
}

function productSizes(product: ResourceItem) {
  const attributes = product.attributes && typeof product.attributes === 'object' && !Array.isArray(product.attributes)
    ? product.attributes as Record<string, unknown>
    : {};
  const value = product.sizes ?? product.size ?? attributes.sizes ?? attributes.size;
  return Array.isArray(value) ? value.join(', ') : formatValue('sizes', value);
}

function productPrice(product: ResourceItem) {
  const value = Number(product.price);
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: String(product.currency || 'INR'), maximumFractionDigits: 0 }).format(value);
}

function CollectionsTable({ collections, products }: { collections: ResourceItem[]; products: ResourceItem[] }) {
  const [openCollection, setOpenCollection] = useState<string | null>(null);
  const [openProduct, setOpenProduct] = useState<string | null>(null);

  const toggleCollection = (id: string) => {
    setOpenCollection((current) => current === id ? null : id);
    setOpenProduct(null);
  };

  return <div className="mt-8 overflow-x-auto">
    <table className="w-full min-w-[48rem] text-left text-sm">
      <thead className="border-b border-black/10 text-[10px] uppercase tracking-[.18em] text-[#8a9098]"><tr><th className="pb-4 pr-5">Collection</th><th className="pb-4 pr-5">Slug</th><th className="pb-4 pr-5">Status</th><th className="pb-4">Products</th></tr></thead>
      <tbody>{collections.map((collection) => {
        const collectionId = String(collection.id);
        const collectionProducts = products.filter((product) => belongsToCollection(product, collection));
        const expanded = openCollection === collectionId;
        return <Fragment key={collectionId}>
          <tr className={`cursor-pointer border-b border-black/[.06] transition hover:bg-[#faf8f4] dark:hover:bg-white/[.03] ${expanded ? 'bg-[#faf8f4] dark:bg-white/[.03]' : ''}`} onClick={() => toggleCollection(collectionId)}>
            <td className="py-4 pr-5"><button type="button" aria-expanded={expanded} className="flex items-center gap-3 text-left font-medium text-[#353a42] dark:text-white" onClick={(event) => { event.stopPropagation(); toggleCollection(collectionId); }}>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<span>{formatValue('name', collection.name)}</span></button></td>
            <td className="py-4 pr-5 text-[#6e747d]">{formatValue('slug', collection.slug)}</td>
            <td className="py-4 pr-5 text-[#6e747d]">{formatValue('status', collection.status)}</td>
            <td className="py-4 text-[#6e747d]">{collectionProducts.length}</td>
          </tr>
          {expanded ? <tr className="border-b border-black/[.06]"><td colSpan={4} className="bg-[#fbfaf8] px-5 py-5 dark:bg-black/10">
            <div className="mb-4 flex items-center justify-between gap-4"><div><p className="text-[10px] uppercase tracking-[.18em] text-[#9a7a4d]">Collection products</p><h3 className="mt-1 text-base font-medium">{formatValue('name', collection.name)}</h3></div><span className="text-xs text-[#8a9098]">{collectionProducts.length} {collectionProducts.length === 1 ? 'product' : 'products'}</span></div>
            {collectionProducts.length ? <div className="overflow-x-auto rounded-xl border border-black/[.07] bg-white dark:border-white/[.08] dark:bg-[#191a1f]"><table className="w-full min-w-[42rem] text-left text-xs"><thead className="border-b border-black/[.07] text-[9px] uppercase tracking-[.16em] text-[#8a9098]"><tr><th className="px-4 py-3">Product</th><th className="px-4 py-3">Code</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Quantity</th></tr></thead><tbody>{collectionProducts.map((product) => {
              const productId = String(product.id);
              const productExpanded = openProduct === productId;
              return <Fragment key={productId}><tr className="cursor-pointer border-b border-black/[.05] transition hover:bg-[#faf8f4] dark:hover:bg-white/[.03]" onClick={() => setOpenProduct((current) => current === productId ? null : productId)}><td className="px-4 py-3"><button type="button" aria-expanded={productExpanded} className="flex items-center gap-2 text-left font-medium" onClick={(event) => { event.stopPropagation(); setOpenProduct((current) => current === productId ? null : productId); }}>{productExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{formatValue('name', product.name)}</button></td><td className="px-4 py-3 text-[#6e747d]">{formatValue('sku', product.sku ?? product.code ?? product.productCode)}</td><td className="px-4 py-3 capitalize text-[#6e747d]">{formatValue('status', product.status)}</td><td className="px-4 py-3 text-[#6e747d]">{formatValue('stock', product.stock ?? product.quantity)}</td></tr>{productExpanded ? <tr><td colSpan={4} className="bg-[#f7f4ee] p-5 dark:bg-black/20"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[
                ['Code / SKU', product.sku ?? product.code ?? product.productCode],
                ['Sizes', productSizes(product)],
                ['Price', productPrice(product)],
                ['Quantity', product.stock ?? product.quantity],
                ['Status', product.status],
                ['Colour', product.color ?? (product.attributes as Record<string, unknown> | undefined)?.color],
                ['Collection', collection.name],
                ['Description', product.description],
              ].map(([label, value]) => <div key={String(label)}><p className="text-[9px] uppercase tracking-[.16em] text-[#9a7a4d]">{String(label)}</p><p className="mt-1.5 text-xs leading-5 text-[#50565f] dark:text-[#d4d6da]">{formatValue(String(label), value)}</p></div>)}</div></td></tr> : null}</Fragment>;
            })}</tbody></table></div> : <div className="rounded-xl border border-dashed border-black/10 bg-white px-6 py-10 text-center dark:border-white/10 dark:bg-[#191a1f]"><Package size={22} className="mx-auto text-[#b28a51]" /><p className="mt-3 text-sm font-medium">No products in this collection yet.</p><p className="mt-1 text-xs text-[#8a9098]">Assigned products will appear here as clickable line items.</p></div>}
          </td></tr> : null}
        </Fragment>;
      })}</tbody>
    </table>
  </div>;
}

function formatValue(key: string, value: unknown) {
  if (key === 'createdAt' && typeof value === 'string') return new Date(value).toLocaleDateString();
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

export default function AdminSection({ params }: { params: Promise<{ section: string }> }) {
  const [section, setSection] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [collectionProducts, setCollectionProducts] = useState<ResourceItem[]>([]);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const token = () => window.localStorage.getItem('rk_access_token') ?? '';

  useEffect(() => {
    let active = true;
    params.then(async ({ section: currentSection }) => {
      if (!active) return;
      setSection(currentSection); setLoading(true); setError('');
      const endpoint = currentSection === 'users' ? '/api/admin/users' : simpleSections.has(currentSection) ? `/api/admin/resources/${currentSection}` : '';
      if (!endpoint) { setLoading(false); return; }
      try {
        const headers = { Authorization: `Bearer ${token()}` };
        const [response, productsResponse] = await Promise.all([
          fetch(`${apiBaseUrl}${endpoint}`, { headers, cache: 'no-store' }),
          currentSection === 'collections' ? fetch(`${apiBaseUrl}/api/admin/resources/products`, { headers, cache: 'no-store' }) : Promise.resolve(null),
        ]);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Unable to load this section.');
        const productsPayload = productsResponse ? await productsResponse.json() : null;
        if (productsResponse && !productsResponse.ok) throw new Error(productsPayload.error ?? 'Unable to load collection products.');
        if (!active) return;
        if (currentSection === 'users') setUsers(payload.users as AdminUser[]);
        else {
          const resourceItems = payload.items as ResourceItem[];
          setItems(currentSection === 'collections' ? mergeCollections(resourceItems) : resourceItems);
          if (currentSection === 'collections') setCollectionProducts(productsPayload.items as ResourceItem[]);
        }
      } catch (requestError) { if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load this section.'); }
      finally { if (active) setLoading(false); }
    });
    return () => { active = false; };
  }, [params]);

  useEffect(() => {
    const created = (event: Event) => {
      const detail = (event as CustomEvent<{ resource: string; item: ResourceItem }>).detail;
      if (detail.resource === section) {
        setItems((current) => section === 'collections'
          ? mergeCollections([detail.item, ...current.filter((item) => !String(item.id).startsWith('storefront:'))])
          : [detail.item, ...current]);
        setMessage('Created successfully.');
      }
    };
    window.addEventListener('rk-admin-resource-created', created);
    return () => window.removeEventListener('rk-admin-resource-created', created);
  }, [section]);

  const visibleUsers = useMemo(() => {
    const staffUsers = users.filter((user) => user.role === 'staff' || user.role === 'admin');
    return roleFilter === 'all' ? staffUsers : staffUsers.filter((user) => user.role === roleFilter);
  }, [roleFilter, users]);

  const updateRole = async (user: AdminUser, role: AdminUser['role']) => {
    if (role === user.role) return;
    setSaving(user.id); setError(''); setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/users/${user.id}/role`, { method: 'PATCH', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to update role.');
      setUsers((current) => current.map((entry) => entry.id === user.id ? payload.user : entry)); setMessage('Role updated successfully.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to update role.'); }
    finally { setSaving(null); }
  };

  const updatePassword = async (user: AdminUser) => {
    const password = passwords[user.id] ?? '';
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setSaving(user.id); setError(''); setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/users/${user.id}/password`, { method: 'PATCH', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to update password.');
      setPasswords((current) => ({ ...current, [user.id]: '' })); setMessage('Password updated successfully.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to update password.'); }
    finally { setSaving(null); }
  };

  const updatePermissions = async (user: AdminUser, permission: StaffPermission, checked: boolean) => {
    const next = checked ? [...new Set([...(user.permissions ?? []), permission])] : (user.permissions ?? []).filter((entry) => entry !== permission);
    setSaving(user.id); setError(''); setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/users/${user.id}/permissions`, { method: 'PATCH', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ permissions: next }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to update permissions.');
      setUsers((current) => current.map((entry) => entry.id === user.id ? payload.user : entry)); setMessage('Staff permissions updated.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to update permissions.'); }
    finally { setSaving(null); }
  };

  if (section === 'settings') return <AdminSettings />;
  if (section === 'reports') return <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-8 dark:border-white/[.08] dark:bg-[#191a1f]"><h2 className="text-xl font-semibold">Reports & analytics</h2><p className="mt-3 max-w-2xl text-sm leading-7 text-[#8a9098]">Use the Control room period selector for live revenue, orders, traffic sources, product performance, customers, and activity.</p></section>;
  if (operationalSections.has(section)) return <OperationsSection section={section} />;

  const title = section.replaceAll('-', ' ');
  return <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-6 shadow-[0_4px_20px_rgba(25,31,38,.035)] dark:border-white/[.08] dark:bg-[#191a1f] md:p-8">
    <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Manage</p><h2 className="mt-2 text-2xl font-semibold capitalize">{section === 'users' ? 'Staff & access' : title}</h2></div>{section === 'users' ? <label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Role<select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)} className="ml-3 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs normal-case tracking-normal"><option value="all">All</option><option value="admin">Admin</option><option value="staff">Staff</option></select></label> : null}</div>
    {message ? <p className="mt-5 text-sm text-emerald-700">{message}</p> : null}{error ? <p className="mt-5 text-sm text-red-600">{error}</p> : null}
    {loading ? <p className="mt-8 text-sm text-[#8a9098]">Loading…</p> : section === 'users' ? visibleUsers.length ? <div className="mt-8 overflow-x-auto"><table className="w-full min-w-[76rem] text-left text-sm"><thead className="border-b border-black/10 text-[10px] uppercase tracking-[.18em] text-[#8a9098]"><tr><th className="pb-4 pr-4">Name</th><th className="pb-4 pr-4">Email</th><th className="pb-4 pr-4">Username</th><th className="pb-4 pr-4">Role</th><th className="pb-4 pr-4">Operational access</th><th className="pb-4">Password</th></tr></thead><tbody>{visibleUsers.map((user) => <tr key={user.id} className="border-b border-black/5 align-top"><td className="py-4 pr-4">{user.displayName || 'Unnamed user'}</td><td className="py-4 pr-4 text-[#7d838d]">{user.email || '—'}</td><td className="py-4 pr-4 text-[#7d838d]">{user.username ? `@${user.username}` : '—'}</td><td className="py-4 pr-4"><select value={user.role} disabled={saving === user.id} onChange={(event) => void updateRole(user, event.target.value as AdminUser['role'])} className="rounded border border-black/10 bg-white px-2 py-1 text-xs capitalize text-[#9a7a4d]"><option value="admin">Admin</option><option value="staff">Staff</option><option value="customer">Customer</option></select></td><td className="py-4 pr-4">{user.role === 'staff' ? <div className="grid grid-cols-2 gap-x-3 gap-y-2">{permissionOptions.map(([permission, label]) => <label key={permission} className="flex items-center gap-2 text-xs text-[#6e747d]"><input type="checkbox" checked={user.permissions?.includes(permission) ?? false} disabled={saving === user.id} onChange={(event) => void updatePermissions(user, permission, event.target.checked)} />{label}</label>)}</div> : <span className="text-xs text-[#9aa0a8]">{user.role === 'admin' ? 'Full access' : 'Not applicable'}</span>}</td><td className="py-4">{user.role !== 'customer' ? <div className="flex gap-2"><input type="password" minLength={8} value={passwords[user.id] ?? ''} onChange={(event) => setPasswords((current) => ({ ...current, [user.id]: event.target.value }))} placeholder="New password" className="w-36 border-b border-black/15 bg-transparent px-1 py-1 text-xs outline-none" /><button disabled={saving === user.id} onClick={() => void updatePassword(user)} className="text-[10px] uppercase tracking-[.12em] text-[#9a7a4d] disabled:opacity-40">Update</button></div> : <span className="text-xs text-[#9aa0a8]">Admin/staff only</span>}</td></tr>)}</tbody></table></div> : <p className="mt-8 text-sm text-[#8a9098]">No users found.</p> : section === 'collections' ? items.length ? <CollectionsTable collections={items} products={collectionProducts} /> : <p className="mt-8 text-sm text-[#8a9098]">No collections yet.</p> : simpleSections.has(section) ? items.length ? <div className="mt-8 overflow-x-auto"><table className="w-full min-w-[44rem] text-left text-sm"><thead className="border-b border-black/10 text-[10px] uppercase tracking-[.18em] text-[#8a9098]"><tr>{columns[section].map(([, label]) => <th key={label} className="pb-4 pr-5">{label}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b border-black/[.06]">{columns[section].map(([key]) => <td key={key} className="py-4 pr-5 text-[#6e747d]">{formatValue(key, item[key])}</td>)}</tr>)}</tbody></table></div> : <p className="mt-8 text-sm text-[#8a9098]">No {title} yet.</p> : <p className="mt-8 text-sm text-[#8a9098]">This module is unavailable.</p>}
  </section>;
}
