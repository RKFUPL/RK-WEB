'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, PackageSearch, Search } from 'lucide-react';
import { StickyHeader } from '@/components/home/sticky-header';
import { apiBaseUrl } from '@/lib/rbac';
import { fulfillmentLabels, inr, orderDate, paymentLabels, type Order } from '@/lib/orders';

type Scope = 'all' | 'active' | 'past';
type Counts = { all: number; active: number; past: number };

function statusClass(status: string) {
  if (['paid', 'delivered'].includes(status)) return 'border-emerald-700/25 text-emerald-700 dark:text-emerald-400';
  if (['failed', 'cancelled', 'refunded'].includes(status)) return 'border-red-700/25 text-red-700 dark:text-red-400';
  return 'border-gold/35 text-gold';
}

export function CustomerOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [counts, setCounts] = useState<Counts>({ all: 0, active: 0, past: 0 });
  const [scope, setScope] = useState<Scope>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (selectedScope: Scope, query: string) => {
    setLoading(true); setError('');
    try {
      const token = window.localStorage.getItem('rk_access_token') || '';
      const params = new URLSearchParams({ scope: selectedScope });
      if (query.trim()) params.set('q', query.trim());
      const response = await fetch(`${apiBaseUrl}/api/orders?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load your orders.');
      setOrders(payload.orders); setCounts(payload.counts);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load your orders.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(scope, ''); }, [load, scope]);

  const chooseScope = (next: Scope) => { setScope(next); setSearch(''); };
  return <main className="min-h-screen bg-ivory text-charcoal">
    <StickyHeader />
    <section className="mx-auto max-w-7xl px-5 pb-24 pt-36 sm:px-8 lg:px-12 lg:pt-44">
      <div className="flex flex-col justify-between gap-8 border-b border-black/10 pb-10 dark:border-white/10 lg:flex-row lg:items-end"><div><p className="text-[0.58rem] uppercase tracking-[0.35em] text-gold">Your private account</p><h1 className="mt-4 font-display text-6xl leading-none sm:text-7xl">My orders.</h1><p className="mt-5 max-w-xl text-sm leading-7 text-charcoal/60">Follow every piece from payment confirmation to delivery.</p></div><form onSubmit={(event) => { event.preventDefault(); void load(scope, search); }} className="flex w-full max-w-sm border-b border-black/20 dark:border-white/20"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order number" className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" /><button aria-label="Search orders" className="px-3 text-gold"><Search size={17} /></button></form></div>
      <div className="mt-8 grid gap-3 sm:grid-cols-3">{([['all', 'All orders'], ['active', 'Active orders'], ['past', 'Past orders']] as Array<[Scope, string]>).map(([key, label]) => <button key={key} onClick={() => chooseScope(key)} className={`border px-5 py-5 text-left transition ${scope === key ? 'border-gold bg-gold/5' : 'border-black/10 hover:border-gold/50 dark:border-white/10'}`}><span className="text-[0.56rem] uppercase tracking-[0.24em] text-charcoal/50">{label}</span><span className="mt-2 block font-display text-3xl">{counts[key]}</span></button>)}</div>
      {error ? <p role="alert" className="mt-8 border border-red-300 bg-red-50 px-5 py-4 text-sm text-red-700 dark:bg-red-950/20">{error}</p> : null}
      {loading ? <div className="mt-10 grid gap-5 lg:grid-cols-2">{[0, 1].map((value) => <div key={value} className="h-72 animate-pulse border border-black/8 bg-black/[.025] dark:border-white/10" />)}</div> : orders.length ? <div className="mt-10 grid gap-5 lg:grid-cols-2">{orders.map((order) => <article key={order.id} className="group border border-black/10 bg-white/40 p-6 transition hover:border-gold/50 dark:border-white/10 dark:bg-white/[.025] sm:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[0.55rem] uppercase tracking-[0.25em] text-gold">Order</p><h2 className="mt-2 font-display text-2xl">#{order.orderNumber}</h2><time className="mt-2 block text-xs text-charcoal/45">{orderDate(order.createdAt, true)}</time></div><div className="flex flex-wrap gap-2"><span className={`border px-3 py-1.5 text-[0.52rem] uppercase tracking-[0.18em] ${statusClass(order.paymentStatus)}`}>Payment · {paymentLabels[order.paymentStatus]}</span><span className={`border px-3 py-1.5 text-[0.52rem] uppercase tracking-[0.18em] ${statusClass(order.fulfillmentStatus)}`}>{fulfillmentLabels[order.fulfillmentStatus]}</span></div></div><div className="mt-7 flex gap-3">{order.items.slice(0, 3).map((item, index) => <div key={`${item.productId || item.name}-${index}`} className="h-24 w-20 overflow-hidden rounded-[12px] bg-sand">{item.image ? <img src={item.image} alt="" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" /> : null}</div>)}{order.items.length > 3 ? <div className="grid h-24 w-20 place-items-center bg-sand text-xs text-charcoal/55">+{order.items.length - 3}</div> : null}</div><div className="mt-7 flex items-end justify-between gap-4 border-t border-black/10 pt-5 dark:border-white/10"><div><p className="text-xs text-charcoal/50">{order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} {order.items.length === 1 ? 'item' : 'items'}</p><p className="mt-1 font-display text-2xl">{inr.format(order.total || 0)}</p></div><Link href={`/account/orders/${order.id}`} className="inline-flex items-center gap-3 border-b border-charcoal/30 pb-2 text-[0.56rem] uppercase tracking-[0.23em] transition group-hover:border-gold group-hover:text-gold">{['delivered', 'cancelled', 'returned', 'refunded'].includes(order.fulfillmentStatus) ? 'View order' : 'Track order'} <ArrowRight size={14} /></Link></div></article>)}</div> : <div className="mt-12 border border-black/10 px-6 py-20 text-center dark:border-white/10"><PackageSearch className="mx-auto text-gold" strokeWidth={1.2} /><h2 className="mt-6 font-display text-4xl">No orders here yet.</h2><p className="mx-auto mt-3 max-w-md text-sm leading-7 text-charcoal/55">Once an order is placed, its payment and delivery progress will appear here.</p><Link href="/collections" className="mt-7 inline-block border-b border-charcoal/30 pb-2 text-[0.58rem] uppercase tracking-[0.24em] hover:border-gold hover:text-gold">Explore collections</Link></div>}
    </section>
  </main>;
}
