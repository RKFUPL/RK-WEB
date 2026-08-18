'use client';

import { useEffect, useMemo, useState } from 'react';
import { AdminSettings } from '@/components/admin/admin-settings';
import { CollectionManagementList } from '@/components/collections/collection-management-list';
import { OperationsSection } from '@/components/staff/operations-section';
import { OrderManagement } from '@/components/orders/order-management';
import { apiBaseUrl, type StaffPermission } from '@/lib/rbac';
import { formatDate } from '@/lib/date-time';

type AdminUser = { id: string; email?: string; username?: string; displayName?: string; role: 'customer' | 'staff' | 'admin'; isActive: boolean; permissions?: StaffPermission[] };
type ResourceItem = Record<string, unknown> & { id: string };
type RoleFilter = 'all' | 'staff' | 'admin';

const operationalSections = new Set(['products', 'orders', 'inventory', 'quotes', 'customers']);
const simpleSections = new Set(['marketing']);
const columns: Record<string, Array<[string, string]>> = {
  marketing: [['name', 'Campaign'], ['channel', 'Channel'], ['status', 'Status'], ['createdAt', 'Created']],
};
const permissionOptions: Array<[StaffPermission, string]> = [['products:manage', 'Products'], ['inventory:manage', 'Inventory'], ['quotes:manage', 'Quotes'], ['orders:manage', 'Orders'], ['customers:manage', 'Customers']];

function formatValue(key: string, value: unknown) {
  if (key === 'createdAt' && typeof value === 'string') return formatDate(value);
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
  const token = () => window.localStorage.getItem('rk_access_token') ?? '';

  useEffect(() => {
    let active = true;
    params.then(async ({ section: currentSection }) => {
      if (!active) return;
      setSection(currentSection); setLoading(true); setError('');
      if (currentSection === 'collections') { setLoading(false); return; }
      const endpoint = currentSection === 'users' ? '/api/admin/users' : simpleSections.has(currentSection) ? `/api/admin/resources/${currentSection}` : '';
      if (!endpoint) { setLoading(false); return; }
      try {
        const response = await fetch(`${apiBaseUrl}${endpoint}`, { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store' });
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
      if (detail.resource === section) {
        setItems((current) => [detail.item, ...current]);
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
  if (section === 'collections') return <CollectionManagementList basePath="/admin/collections" />;
  if (section === 'orders') return <OrderManagement />;
  if (operationalSections.has(section)) return <OperationsSection section={section} />;

  const title = section.replaceAll('-', ' ');
  return <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-6 shadow-[0_4px_20px_rgba(25,31,38,.035)] dark:border-white/[.08] dark:bg-[#191a1f] md:p-8">
    <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Manage</p><h2 className="mt-2 text-2xl font-semibold capitalize">{section === 'users' ? 'Staff & access' : title}</h2></div>{section === 'users' ? <label className="text-[10px] uppercase tracking-[.18em] text-[#8a9098]">Role<select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)} className="ml-3 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs normal-case tracking-normal"><option value="all">All</option><option value="admin">Admin</option><option value="staff">Staff</option></select></label> : null}</div>
    {message ? <p className="mt-5 text-sm text-emerald-700">{message}</p> : null}{error ? <p className="mt-5 text-sm text-red-600">{error}</p> : null}
    {loading ? <p className="mt-8 text-sm text-[#8a9098]">Loading…</p> : section === 'users' ? visibleUsers.length ? <div className="mt-8 overflow-x-auto"><table className="w-full min-w-[76rem] text-left text-sm"><thead className="border-b border-black/10 text-[10px] uppercase tracking-[.18em] text-[#8a9098]"><tr><th className="pb-4 pr-4">Name</th><th className="pb-4 pr-4">Email</th><th className="pb-4 pr-4">Username</th><th className="pb-4 pr-4">Role</th><th className="pb-4 pr-4">Operational access</th><th className="pb-4">Password</th></tr></thead><tbody>{visibleUsers.map((user) => <tr key={user.id} className="border-b border-black/5 align-top"><td className="py-4 pr-4">{user.displayName || 'Unnamed user'}</td><td className="py-4 pr-4 text-[#7d838d]">{user.email || '—'}</td><td className="py-4 pr-4 text-[#7d838d]">{user.username ? `@${user.username}` : '—'}</td><td className="py-4 pr-4"><select value={user.role} disabled={saving === user.id} onChange={(event) => void updateRole(user, event.target.value as AdminUser['role'])} className="rounded border border-black/10 bg-white px-2 py-1 text-xs capitalize text-[#9a7a4d]"><option value="admin">Admin</option><option value="staff">Staff</option><option value="customer">Customer</option></select></td><td className="py-4 pr-4">{user.role === 'staff' ? <div className="grid grid-cols-2 gap-x-3 gap-y-2">{permissionOptions.map(([permission, label]) => <label key={permission} className="flex items-center gap-2 text-xs text-[#6e747d]"><input type="checkbox" checked={user.permissions?.includes(permission) ?? false} disabled={saving === user.id} onChange={(event) => void updatePermissions(user, permission, event.target.checked)} />{label}</label>)}</div> : <span className="text-xs text-[#9aa0a8]">{user.role === 'admin' ? 'Full access' : 'Not applicable'}</span>}</td><td className="py-4">{user.role !== 'customer' ? <div className="flex gap-2"><input type="password" minLength={8} value={passwords[user.id] ?? ''} onChange={(event) => setPasswords((current) => ({ ...current, [user.id]: event.target.value }))} placeholder="New password" className="w-36 border-b border-black/15 bg-transparent px-1 py-1 text-xs outline-none" /><button disabled={saving === user.id} onClick={() => void updatePassword(user)} className="text-[10px] uppercase tracking-[.12em] text-[#9a7a4d] disabled:opacity-40">Update</button></div> : <span className="text-xs text-[#9aa0a8]">Admin/staff only</span>}</td></tr>)}</tbody></table></div> : <p className="mt-8 text-sm text-[#8a9098]">No users found.</p> : simpleSections.has(section) ? items.length ? <div className="mt-8 overflow-x-auto"><table className="w-full min-w-[44rem] text-left text-sm"><thead className="border-b border-black/10 text-[10px] uppercase tracking-[.18em] text-[#8a9098]"><tr>{columns[section].map(([, label]) => <th key={label} className="pb-4 pr-5">{label}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b border-black/[.06]">{columns[section].map(([key]) => <td key={key} className="py-4 pr-5 text-[#6e747d]">{formatValue(key, item[key])}</td>)}</tr>)}</tbody></table></div> : <p className="mt-8 text-sm text-[#8a9098]">No {title} yet.</p> : <p className="mt-8 text-sm text-[#8a9098]">This module is unavailable.</p>}
  </section>;
}
