'use client';

import { useEffect, useMemo, useState } from 'react';

type AdminUser = { id: string; email?: string; username?: string; displayName?: string; role: 'customer' | 'staff' | 'admin'; isActive: boolean };
type RoleFilter = 'all' | AdminUser['role'];
const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

export default function AdminSection({ params }: { params: Promise<{ section: string }> }) {
  const [section, setSection] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    params.then(({ section: currentSection }) => {
      if (!active) return;
      setSection(currentSection);
      if (currentSection !== 'users') { setLoading(false); return; }
      const token = window.localStorage.getItem('rk_access_token');
      fetch(`${apiBaseUrl}/api/admin/users`, { headers: { Authorization: `Bearer ${token ?? ''}` }, cache: 'no-store' })
        .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Unable to load users.'); return data.users as AdminUser[]; })
        .then((data) => { if (active) setUsers(data); })
        .catch((requestError) => { if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load users.'); })
        .finally(() => { if (active) setLoading(false); });
    });
    return () => { active = false; };
  }, [params]);

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
      setUsers((current) => current.map((entry) => entry.id === user.id ? data.user : entry));
      setMessage('Role updated successfully.');
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
      setPasswords((current) => ({ ...current, [user.id]: '' }));
      setMessage(`${user.displayName || 'User'}'s password was updated.`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to update password.'); }
    finally { setSaving(null); }
  };

  return <section className="mt-12 border border-black/10 bg-white p-8">
    <div className="flex flex-wrap items-end justify-between gap-5"><h2 className="font-display text-4xl capitalize">{title}</h2>{section === 'users' ? <label className="text-[10px] uppercase tracking-[0.2em] text-charcoal/50">Filter by role<select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)} className="ml-3 border border-black/15 bg-white px-3 py-2 text-xs normal-case tracking-normal text-charcoal outline-none focus:border-gold"><option value="all">All roles</option><option value="admin">Admin</option><option value="staff">Staff</option><option value="customer">Customer</option></select></label> : null}</div>
    {section === 'users' ? loading ? <p className="mt-8 text-sm text-charcoal/55">Loading users...</p> : error && !users.length ? <p className="mt-8 text-sm text-red-600">{error}</p> : visibleUsers.length === 0 ? <p className="mt-8 text-sm text-charcoal/55">No entries found.</p> : <div className="mt-8 overflow-x-auto"><table className="w-full min-w-[58rem] text-left text-sm"><thead className="border-b border-black/10 text-[10px] uppercase tracking-[0.2em] text-charcoal/45"><tr><th className="pb-4 pr-4">Name</th><th className="pb-4 pr-4">Email</th><th className="pb-4 pr-4">Username</th><th className="pb-4 pr-4">Role</th><th className="pb-4">Password</th></tr></thead><tbody>{visibleUsers.map((user) => <tr key={user.id} className="border-b border-black/5"><td className="py-4 pr-4">{user.displayName || 'Unnamed user'}</td><td className="py-4 pr-4 text-charcoal/65">{user.email || '—'}</td><td className="py-4 pr-4 text-charcoal/65">{user.username ? `@${user.username}` : '—'}</td><td className="py-4 pr-4"><select value={user.role} disabled={saving === user.id} onChange={(event) => updateRole(user, event.target.value as AdminUser['role'])} className="border border-black/15 bg-white px-2 py-1 text-xs capitalize text-gold outline-none focus:border-gold"><option value="admin">Admin</option><option value="staff">Staff</option><option value="customer">Customer</option></select></td><td className="py-4"><div className="flex gap-2">{user.role !== 'customer' ? <><input type="password" minLength={8} value={passwords[user.id] ?? ''} onChange={(event) => setPasswords((current) => ({ ...current, [user.id]: event.target.value }))} placeholder="New password" className="w-36 border-b border-black/15 px-1 py-1 text-xs outline-none focus:border-gold" /><button type="button" disabled={saving === user.id} onClick={() => updatePassword(user)} className="text-[10px] uppercase tracking-[0.12em] text-gold disabled:opacity-40">Update</button></> : <span className="text-xs text-charcoal/40">Admin/staff only</span>}</div></td></tr>)}</tbody></table></div> : <p className="mt-8 text-sm text-charcoal/55">No entries found.</p>}
    {message ? <p className="mt-5 text-sm text-green-700">{message}</p> : null}{error && users.length ? <p className="mt-5 text-sm text-red-600">{error}</p> : null}
  </section>;
}
