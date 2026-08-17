'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Boxes, FileText, Package, ShoppingBag, Truck } from 'lucide-react';
import { apiBaseUrl } from '@/lib/rbac';

type StaffCounts = Record<string, number | Record<string, number>>;
const modules = [
  ['products', 'Products', Package, 'products:manage', 'products'],
  ['orders', 'Active orders', ShoppingBag, 'orders:manage', 'orders'],
  ['inventory', 'Low stock', Boxes, 'inventory:manage', 'lowStock'],
  ['quotes', 'Open quotes', FileText, 'quotes:manage', 'quotes'],
] as const;

export default function StaffDashboard() {
  const [data, setData] = useState<{ permissions: string[]; counts: StaffCounts } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const token = window.localStorage.getItem('rk_access_token') ?? '';
    fetch(`${apiBaseUrl}/api/staff/dashboard`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? 'Unable to load operations.'); setData(payload); })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Unable to load operations.'));
  }, []);
  if (error) return <p className="mt-10 text-sm text-red-600">{error}</p>;
  const fulfillment = (data?.counts.fulfillment || {}) as Record<string, number>;
  return <>
    <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-5">{modules.map(([key, label, Icon, permission, countKey]) => {
      if (!data?.permissions.includes(permission)) return null;
      const count = data.counts[countKey];
      return <Link href={`/staff/${key}`} key={key} className="rounded-2xl border border-black/[.06] bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-lg dark:border-white/[.08] dark:bg-[#191a1f]"><Icon size={18} className="text-[#9a7a4d]" /><p className="mt-4 text-xs text-[#858b94]">{label}</p><p className="mt-1 text-2xl font-semibold">{typeof count === 'number' ? count : 0}</p></Link>;
    })}</div>
    {data?.permissions.includes('orders:manage') ? <section className="mt-5 rounded-2xl border border-black/[.06] bg-white p-5 dark:border-white/[.08] dark:bg-[#191a1f]"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Fulfillment queue</h2><p className="mt-1 text-xs text-[#858b94]">Only order-management staff can see and action this workload.</p></div><Truck size={18} className="text-[#9a7a4d]" /></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{([['confirmed', 'Orders to process'], ['processing', 'Ready to pack'], ['packed', 'Ready to ship'], ['shipped', 'Shipment updates']] as const).map(([status, label]) => <Link key={status} href={`/staff/orders?fulfillment=${status}`} className="rounded-xl border border-black/[.06] p-4 transition hover:border-[#9a7a4d]/50 dark:border-white/[.08]"><p className="text-[9px] uppercase tracking-[.14em] text-[#858b94]">{label}</p><p className="mt-2 text-xl font-semibold">{fulfillment[status] || 0}</p></Link>)}</div></section> : null}
  </>;
}
