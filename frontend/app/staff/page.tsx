'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Boxes, FileText, Package, ShoppingBag, Users } from 'lucide-react';
import { apiBaseUrl } from '@/lib/rbac';

const modules = [
  ['products', 'Products', Package, 'products:manage', 'products'], ['orders', 'Orders', ShoppingBag, 'orders:manage', 'orders'], ['inventory', 'Low stock', Boxes, 'inventory:manage', 'lowStock'], ['quotes', 'Open quotes', FileText, 'quotes:manage', 'quotes'], ['customers', 'Assigned customers', Users, 'customers:manage', 'customers'],
] as const;

export default function StaffDashboard() {
  const [data, setData] = useState<{ permissions: string[]; counts: Record<string, number> } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const token = window.localStorage.getItem('rk_access_token') ?? '';
    fetch(`${apiBaseUrl}/api/staff/dashboard`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? 'Unable to load operations.'); setData(payload); }).catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Unable to load operations.'));
  }, []);
  if (error) return <p className="mt-10 text-sm text-red-600">{error}</p>;
  return <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-5">{modules.map(([key, label, Icon, permission, countKey]) => { if (!data?.permissions.includes(permission)) return null; return <Link href={`/staff/${key}`} key={key} className="rounded-2xl border border-black/[.06] bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-lg dark:border-white/[.08] dark:bg-[#191a1f]"><Icon size={18} className="text-[#9a7a4d]" /><p className="mt-4 text-xs text-[#858b94]">{label}</p><p className="mt-1 text-2xl font-semibold">{data ? data.counts[countKey] ?? 0 : '…'}</p></Link>; })}</div>;
}
