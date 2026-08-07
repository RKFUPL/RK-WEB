'use client';

import { useEffect, useMemo, useState } from 'react';
import { AdminSettings } from '@/components/admin/admin-settings';
import { apiBaseUrl } from '@/lib/rbac';

type AdminUser = { id: string; email?: string; username?: string; displayName?: string; role: 'customer' | 'staff' | 'admin'; isActive: boolean };
type RoleFilter = 'all' | AdminUser['role'];
type ResourceItem = Record<string, unknown> & { id: string };

const resourceSections = new Set(['products', 'orders', 'inventory', 'collections', 'customers', 'marketing']);
const columns: Record<string, Array<[string, string]>> = {
  products: [['name', 'Product'], ['sku', 'SKU'], ['price', 'Price'], ['stock', 'Stock'], ['status', 'Status']],
  inventory: [['name', 'Product'], ['sku', 'SKU'], ['stock', 'Available'], ['lowStockThreshold', 'Alert at'], ['status', 'Status']],
  orders: [['orderNumber', 'Order'], ['customerName', 'Customer'], ['email', 'Email'], ['total', 'Total'], ['status', 'Status']],
  collections: [['name', 'Collection'], ['slug', 'Slug'], ['status', 'Status'], ['createdAt', 'Created']],
  customers: [['displayName', 'Customer'], ['email', 'Email'], ['phone', 'Phone'], ['emailVerified', 'Verified'], ['isActive', 'Status']],
  marketing: [['name', 'Campaign'], ['channel', 'Channel'], ['status', 'Status'], ['createdAt', 'Created']],
};

function formatValue(key: string, value: unknown) {
  if (key === 'price' || key === 'total') return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value ?? 0));
  if (key === 'createdAt' && typeof value === 'string') return new Date(value).toLocaleDateString();
  if (key === 'emailVerified') return value ? 'Verified' : 'Pending';
  if (key === 'isActive') return value === false ? 'Inactive' : 'Active';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

export default function AdminSection({ params }: { params: Promise<{ section: string }> }) {
  const [section, setSection] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    params.then(async ({ section: currentSection }) => {
      if (!active) return;
      setSection(currentSection); setLoading(true); setError('');
      if (currentSection === 'settings' || currentSection === 'reports') { setLoading(false); return; }
      const token = window.localStorage.getItem('rk_access_token') ?? '';
      const endpoint = currentSection === 'users' ? '/api/admin/users' : resourceSections.has(currentSection) ? `/api/admin/resources/${currentSection}` : '';
      if (!endpoint) { setLoading(false); return; }
      try {
        const response = await fetch(`${apiBaseUrl}${endpoint}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Unable to load this section.');
        if (!active) return;
        if (currentSection === 'users') setUsers(payload.users as AdminUser[]);
        else setItems(payload.items as ResourceItem[]);
      } catch (requestError) { if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load this section.'); }
      finally { if (active) setLoading(false); }
    });
    return () => { active = false; };
  }, [params]);

  useEffect(() => {
    const created = (event: Event) => {
      const detail = (event as CustomEvent<{ resource: string; item: ResourceItem }>).detail;
      const matches = detail.resource === section || (section === 'inventory' && detail.resource === 'products');
      if (matches) { setItems((current) => [detail.item, ...current]); setMessage('Created successfully.'); }
    };
    window.addEventListener('rk-admin-resource-created', created);
    return () => window.removeEventListener('rk-admin-resource-created', created);
  }, [section]);

  const visibleUsers = useMemo(() => roleFilter === 'all' ? users : users.filter((user) => user.role === roleFilter), [roleFilter, users]);
  const title = section.replaceAll('-', ' ');
  const token = () => window.localStorage.getItem('rk_access_token') ?? '';

  const updateRole = async (user: AdminUser, role: AdminUser['role']) => {
    if (role === user.role) return;
    setSaving(user.id); setError(''); setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/users/${user.id}/role`, { method: 'PATCH', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to update role.');
      setUsers((current) => current.map((entry) => entry.id === user.id ? data.user : entry)); setMessage('Role updated successfully.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to update role.'); }
    finally { setSaving(null); }
  };

  const updatePassword = async (user: AdminUser) => {
    const password = passwords[user.id] ?? '';
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setSaving(user.id); setError(''); setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/users/${user.id}/password`, { method: 'PATCH', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to update password.');
      setPasswords((current) => ({ ...current, [user.id]: '' })); setMessage(`${user.displayName || 'User'}'s password was updated.`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to update password.'); }
    finally { setSaving(null); }
  };

  if (section === 'settings') return <AdminSettings />;
  if (section === 'reports') return <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-8 dark:border-white/[.08] dark:bg-[#191a1f]"><h2 className="text-xl font-semibold">Reports & analytics</h2><p className="mt-3 max-w-2xl text-sm leading-7 text-[#8a9098]">Use the Control room period selector for live revenue, orders, traffic sources, product performance, customers, and activity. Exportable reports can be added once order volume requires them.</p></section>;

  return <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-6 shadow-[0_4px_20px_rgba(25,31,38,.035)] dark:border-white/[.08] dark:bg-[#191a1f] md:p-8">
    <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Manage</p><h2 className="mt-2 text-2xl font-semibold capitalize">{title}</h2></div>{section === 'users' ? <label className="text-[10px] uppercase tracking-[0.2em] text-[#8a9098]">Filter by role<select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)} className="ml-3 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs normal-case tracking-normal outline-none dark:border-white/10 dark:bg-[#121317]"><option value="all">All roles</option><option value="admin">Admin</option><option value="staff">Staff</option><option value="customer">Customer</option></select></label> : null}</div>
    {message ? <p className="mt-5 text-sm text-emerald-700">{message}</p> : null}{error ? <p className="mt-5 text-sm text-red-600">{error}</p> : null}
    {loading ? <p className="mt-8 text-sm text-[#8a9098]">Loading…</p> : section === 'users' ? visibleUsers.length ? <div className="mt-8 overflow-x-auto"><table className="w-full min-w-[58rem] text-left text-sm"><thead className="border-b border-black/10 text-[10px] uppercase tracking-[0.2em] text-[#8a9098]"><tr><th className="pb-4 pr-4">Name</th><th className="pb-4 pr-4">Email</th><th className="pb-4 pr-4">Username</th><th className="pb-4 pr-4">Role</th><th className="pb-4">Password</th></tr></thead><tbody>{visibleUsers.map((user) => <tr key={user.id} className="border-b border-black/5"><td className="py-4 pr-4">{user.displayName || 'Unnamed user'}</td><td className="py-4 pr-4 text-[#7d838d]">{user.email || '—'}</td><td className="py-4 pr-4 text-[#7d838d]">{user.username ? `@${user.username}` : '—'}</td><td className="py-4 pr-4"><select value={user.role} disabled={saving === user.id} onChange={(event) => updateRole(user, event.target.value as AdminUser['role'])} className="rounded border border-black/10 bg-white px-2 py-1 text-xs capitalize text-[#9a7a4d] dark:border-white/10 dark:bg-[#121317]"><option value="admin">Admin</option><option value="staff">Staff</option><option value="customer">Customer</option></select></td><td className="py-4"><div className="flex gap-2">{user.role !== 'customer' ? <><input type="password" minLength={8} value={passwords[user.id] ?? ''} onChange={(event) => setPasswords((current) => ({ ...current, [user.id]: event.target.value }))} placeholder="New password" className="w-36 border-b border-black/15 bg-transparent px-1 py-1 text-xs outline-none" /><button type="button" disabled={saving === user.id} onClick={() => updatePassword(user)} className="text-[10px] uppercase tracking-[0.12em] text-[#9a7a4d] disabled:opacity-40">Update</button></> : <span className="text-xs text-[#9aa0a8]">Admin/staff only</span>}</div></td></tr>)}</tbody></table></div> : <p className="mt-8 text-sm text-[#8a9098]">No users found.</p> : resourceSections.has(section) ? items.length ? <div className="mt-8 overflow-x-auto"><table className="w-full min-w-[44rem] text-left text-sm"><thead className="border-b border-black/10 text-[10px] uppercase tracking-[.18em] text-[#8a9098]"><tr>{columns[section].map(([, label]) => <th key={label} className="pb-4 pr-5">{label}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b border-black/[.06] transition hover:bg-black/[.015] dark:hover:bg-white/[.02]">{columns[section].map(([key]) => <td key={key} className={`py-4 pr-5 ${key === 'status' || key === 'channel' ? 'capitalize text-[#9a7a4d]' : 'text-[#6e747d] dark:text-[#c9cbd0]'}`}>{formatValue(key, item[key])}</td>)}</tr>)}</tbody></table></div> : <div className="mt-10 rounded-xl border border-dashed border-black/10 px-6 py-12 text-center dark:border-white/10"><p className="text-sm font-medium">No {title} yet.</p><p className="mt-2 text-xs text-[#8a9098]">Use Quick create above to add the first record.</p></div> : <p className="mt-8 text-sm text-[#8a9098]">This module is ready for configuration.</p>}
  </section>;
}
