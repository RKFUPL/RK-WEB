'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Search } from 'lucide-react';
import { apiBaseUrl } from '@/lib/rbac';
import { orderStatusLabel, fulfillmentLabels, inr, orderDate, paymentLabels, type FulfillmentStatus, type Order } from '@/lib/orders';

type Counts = { payment: Record<string, number>; fulfillment: Record<string, number> };
const statuses: Array<[string, string]> = [['processing', 'Processing'], ['packed', 'Packed'], ['shipped', 'Shipped'], ['out_for_delivery', 'Out for delivery'], ['delivered', 'Delivered'], ['returns', 'Returns'], ['cancelled', 'Cancelled']];
const fieldClass = 'admin-field text-xs';

function Pill({ value, type }: { value: string; type: 'payment' | 'fulfillment' }) {
  const good = value === 'paid' || value === 'delivered'; const bad = ['failed', 'cancelled', 'refunded'].includes(value);
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-[.14em] ${good ? 'border-emerald-500/30 text-emerald-700' : bad ? 'border-red-500/30 text-red-700' : 'border-[#9a7a4d]/35 text-[#9a7a4d]'}`}>{type === 'payment' ? paymentLabels[value as keyof typeof paymentLabels] || value : fulfillmentLabels[value as FulfillmentStatus] || value}</span>;
}

export function OrderManagement() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [counts, setCounts] = useState<Counts>({ payment: {}, fulfillment: {} });
  const [query, setQuery] = useState('');
  const [payment, setPayment] = useState('all');
  const [fulfillment, setFulfillment] = useState('all');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const countsAt = useRef(0);
  const token = () => window.localStorage.getItem('rk_access_token') || '';
  const load = useCallback(async (params: URLSearchParams) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const includeCounts = Date.now() - countsAt.current >= 5000;
    const requestParams = new URLSearchParams(params);
    requestParams.set('pageSize', '50');
    requestParams.set('includeCounts', String(includeCounts));
    setLoading(true); setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/staff/orders?${requestParams}`, { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store', signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load orders.');
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setOrders(payload.orders || []);
      setPagination({ total: payload.total ?? (payload.orders || []).length, totalPages: payload.totalPages ?? 1 });
      if (payload.counts) { setCounts(payload.counts); countsAt.current = Date.now(); }
    } catch (reason) {
      if (!controller.signal.aborted && requestRef.current === controller) setError(reason instanceof Error ? reason.message : 'Unable to load orders.');
    } finally {
      if (!controller.signal.aborted && requestRef.current === controller) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const sync = () => {
      const initial = new URLSearchParams(window.location.search);
      setQuery(initial.get('q') || ''); setPayment(initial.get('payment') || 'all'); setFulfillment(initial.get('fulfillment') || 'all');
      setPage(Math.max(1, Number(initial.get('page')) || 1));
      void load(initial);
    };
    sync(); window.addEventListener('popstate', sync);
    return () => { requestRef.current?.abort(); window.removeEventListener('popstate', sync); };
  }, [load]);
  const navigate = (nextPage = 1, nextPayment = payment, nextFulfillment = fulfillment) => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of [['q', query.trim()], ['payment', nextPayment === 'all' ? '' : nextPayment], ['fulfillment', nextFulfillment === 'all' ? '' : nextFulfillment], ['page', nextPage === 1 ? '' : String(nextPage)]]) {
      if (value) params.set(key, value); else params.delete(key);
    }
    setPage(nextPage);
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
    void load(params);
  };
  const submit = (event: FormEvent) => { event.preventDefault(); navigate(); };
  const choosePayment = (value: string) => { setPayment(value); navigate(1, value); };
  const chooseFulfillment = (value: string) => { setFulfillment(value); navigate(1, payment, value); };
  const chooseStatus = (status: string) => chooseFulfillment(fulfillment === status ? 'all' : status);
  return <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-5 shadow-[0_4px_20px_rgba(25,31,38,.035)] dark:border-white/[.08] dark:bg-[#191a1f] sm:p-8"><div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Fulfillment</p><h2 className="mt-2 text-2xl font-semibold">Orders & shipments</h2><p className="mt-2 text-xs leading-6 text-[#858b94]">Open an order to manage its payment, fulfillment, shipment, delivery, and return history.</p></div><form onSubmit={submit} className="flex w-full max-w-md gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Order, customer, email, tracking" className={`${fieldClass} min-w-0 flex-1`} /><button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-[#24211e] px-4 py-2.5 text-xs text-white"><Search size={14} /> Search</button></form></div><div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">{statuses.map(([status, label]) => <button type="button" key={status} onClick={() => chooseStatus(status)} aria-pressed={fulfillment === status} className={`rounded-xl border p-4 text-left transition hover:border-[#9a7a4d]/50 ${fulfillment === status ? 'border-[#9a7a4d] bg-[#9a7a4d]/5' : 'border-black/[.06] dark:border-white/[.08]'}`}><span className="text-[9px] uppercase tracking-[.15em] text-[#858b94]">{label}</span><span className="mt-2 block text-xl font-semibold">{counts.fulfillment[status] || 0}</span></button>)}</div><div className="mt-5 flex flex-wrap gap-3 text-xs">{["pending", "partial", "overdue"].map(status => <button key={status} type="button" onClick={() => choosePayment(status)} className="rounded border border-black/10 px-3 py-2">{paymentLabels[status as keyof typeof paymentLabels]}: {counts.payment[status] || 0}</button>)}</div><div className="mt-6 flex flex-wrap gap-3"><label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">Payment<select aria-label="Payment" value={payment} onChange={(event) => choosePayment(event.target.value)} className={`${fieldClass} ml-3 normal-case tracking-normal`}><option value="all">All</option>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">Fulfillment<select aria-label="Fulfillment" value={fulfillment} onChange={(event) => chooseFulfillment(event.target.value)} className={`${fieldClass} ml-3 normal-case tracking-normal`}><option value="all">All</option><option value="returns">Returns (requested, returned, refunded)</option>{Object.entries(fulfillmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>{error ? <p role="alert" className="mt-5 text-sm text-red-600">{error}</p> : null}{loading ? <p role="status" className="mt-6 text-sm text-[#858b94]">Loading orders...</p> : null}{orders.length ? <div className="mt-7 overflow-x-auto"><table className="w-full min-w-[65rem] text-left text-sm"><thead className="border-b border-black/10 text-[9px] uppercase tracking-[.16em] text-[#858b94]"><tr><th className="pb-4 pr-4">Order</th><th className="pb-4 pr-4">Customer</th><th className="pb-4 pr-4">Date</th><th className="pb-4 pr-4">Payment</th><th className="pb-4 pr-4">Fulfillment</th><th className="pb-4 pr-4">Total</th><th className="pb-4">Action</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id} className="border-b border-black/[.06] dark:border-white/[.07]"><td className="py-4 pr-4 font-medium">#{order.orderNumber}</td><td className="py-4 pr-4"><span className="block">{order.customerName || 'Customer'}</span><span className="mt-1 block text-[10px] text-[#858b94]">{order.email}</span></td><td className="py-4 pr-4 text-[#6e747d]">{orderDate(order.createdAt)}</td><td className="py-4 pr-4"><Pill value={order.paymentStatus} type="payment" /></td><td className="py-4 pr-4"><span className="text-xs">{orderStatusLabel(order)}</span></td><td className="py-4 pr-4 text-[#6e747d]">{inr.format(order.total || 0)}</td><td className="py-4"><Link href={`/admin/orders/${order.id}`} className="inline-flex items-center gap-2 text-[9px] uppercase tracking-[.15em] text-[#9a7a4d]">View details <ArrowRight size={13} /></Link></td></tr>)}</tbody></table></div> : !loading && !error ? <div className="mt-8 rounded-xl border border-dashed border-black/10 p-12 text-center text-sm text-[#858b94]">No orders match these filters.</div> : null}<nav aria-label="Order pages" className="mt-6 flex items-center justify-between gap-4 text-xs"><button type="button" disabled={loading || page <= 1} onClick={() => navigate(page - 1)} className="admin-button-secondary px-3 py-2 disabled:opacity-40">Previous</button><span>Page {page} of {Math.max(1, pagination.totalPages)} / {pagination.total} orders</span><button type="button" disabled={loading || page >= pagination.totalPages} onClick={() => navigate(page + 1)} className="admin-button-secondary px-3 py-2 disabled:opacity-40">Next</button></nav></section>;
}
