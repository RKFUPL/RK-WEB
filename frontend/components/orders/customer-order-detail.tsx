'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, PackageCheck } from 'lucide-react';
import { StickyHeader } from '@/components/home/sticky-header';
import { OrderTimeline } from '@/components/orders/order-timeline';
import { apiBaseUrl } from '@/lib/rbac';
import { fulfillmentLabels, inr, orderDate, orderDateTime, paymentLabels, titleCase, type Order } from '@/lib/orders';

const panel = 'border border-black/10 bg-white/35 p-6 dark:border-white/10 dark:bg-white/[.025] sm:p-8';

export function CustomerOrderDetail({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const token = window.localStorage.getItem('rk_access_token') || '';
      const response = await fetch(`${apiBaseUrl}/api/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Order not found.');
      setOrder(payload.order);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Order not found.'); }
    finally { setLoading(false); }
  }, [orderId]);
  useEffect(() => { void load(); }, [load]);

  const requestReturn = async () => {
    if (!returnReason.trim()) { setError('Enter a reason for the return request.'); return; }
    setBusy(true); setError('');
    try {
      const token = window.localStorage.getItem('rk_access_token') || '';
      const response = await fetch(`${apiBaseUrl}/api/orders/${orderId}/return-request`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: returnReason.trim() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to request a return.');
      setOrder(payload.order); setReturnOpen(false); setReturnReason('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to request a return.'); }
    finally { setBusy(false); }
  };

  const address = order?.shippingAddress || order?.shipping;
  return <main className="min-h-screen bg-ivory text-charcoal"><StickyHeader /><section className="mx-auto max-w-7xl px-5 pb-24 pt-36 sm:px-8 lg:px-12 lg:pt-44"><Link href="/account/orders" className="inline-flex items-center gap-3 text-[0.58rem] uppercase tracking-[0.24em] text-charcoal/55 transition hover:text-gold"><ArrowLeft size={15} /> My orders</Link>{error ? <p role="alert" className="mt-7 border border-red-300 bg-red-50 px-5 py-4 text-sm text-red-700 dark:bg-red-950/20">{error}</p> : null}{loading ? <div className="mt-10 h-[38rem] animate-pulse border border-black/10 bg-black/[.025] dark:border-white/10" /> : order ? <>
    <header className="mt-9 flex flex-col justify-between gap-7 border-b border-black/10 pb-10 dark:border-white/10 lg:flex-row lg:items-end"><div><p className="text-[0.56rem] uppercase tracking-[0.3em] text-gold">Order details</p><h1 className="mt-3 font-display text-5xl sm:text-6xl">#{order.orderNumber}</h1><p className="mt-4 text-sm text-charcoal/55">Placed on {orderDate(order.createdAt, true)}</p></div><div className="flex flex-wrap gap-3"><span className="border border-gold/35 px-4 py-2 text-[0.55rem] uppercase tracking-[0.2em]">Payment · {paymentLabels[order.paymentStatus]}</span><span className="border border-gold/35 px-4 py-2 text-[0.55rem] uppercase tracking-[0.2em]">{fulfillmentLabels[order.fulfillmentStatus]}</span></div></header>
    <div className="mt-10 grid gap-6 lg:grid-cols-[0.78fr_1.22fr]"><section className={`${panel} lg:row-span-2`}><p className="text-[0.55rem] uppercase tracking-[0.25em] text-gold">Order status</p><h2 className="mt-3 font-display text-3xl">From the house to you.</h2><div className="mt-8"><OrderTimeline order={order} /></div></section><section className={panel}><p className="text-[0.55rem] uppercase tracking-[0.25em] text-gold">Items</p><div className="mt-6 divide-y divide-black/10 dark:divide-white/10">{order.items.map((item, index) => <div key={`${item.productId || item.name}-${index}`} className="grid grid-cols-[5rem_1fr_auto] gap-4 py-5 first:pt-0"><div className="h-24 overflow-hidden rounded-[12px] bg-sand">{item.image ? <img src={item.image} alt="" className="h-full w-full object-cover" /> : null}</div><div><p className="font-display text-xl">{item.name}</p><p className="mt-1 text-[0.6rem] uppercase tracking-[0.16em] text-charcoal/45">{item.sku || 'RK piece'}</p>{item.variant ? <p className="mt-2 text-xs text-charcoal/55">{item.variant.name}: {item.variant.value}</p> : null}<p className="mt-1 text-xs text-charcoal/55">Quantity {item.quantity}</p></div><p className="text-sm">{inr.format((item.unitPrice || 0) * item.quantity)}</p></div>)}</div><div className="mt-6 flex justify-between border-t border-black/10 pt-5 font-display text-2xl dark:border-white/10"><span>Total</span><span>{inr.format(order.total || 0)}</span></div></section>
    <div className="grid gap-6 md:grid-cols-2"><section className={panel}><p className="text-[0.55rem] uppercase tracking-[0.25em] text-gold">Shipping address</p>{address ? <div className="mt-5 text-sm leading-7 text-charcoal/65"><p className="text-charcoal">{address.fullName}</p><p>{address.line1}{address.line2 ? `, ${address.line2}` : ''}<br />{address.city}, {address.state} {address.postalCode}<br />{address.country}<br />{address.phone}</p></div> : <p className="mt-5 text-sm text-charcoal/50">No shipping address recorded.</p>}</section><section className={panel}><p className="text-[0.55rem] uppercase tracking-[0.25em] text-gold">Payment</p><dl className="mt-5 space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-charcoal/50">Status</dt><dd>{paymentLabels[order.paymentStatus]}</dd></div><div className="flex justify-between gap-4"><dt className="text-charcoal/50">Method</dt><dd>{titleCase(order.payment.gateway)}</dd></div><div className="flex justify-between gap-4"><dt className="text-charcoal/50">Amount</dt><dd>{inr.format(order.total || 0)}</dd></div>{order.payment.verifiedAt ? <div className="flex justify-between gap-4"><dt className="text-charcoal/50">Confirmed</dt><dd className="text-right">{orderDateTime(order.payment.verifiedAt)}</dd></div> : null}</dl></section></div>
    <section className={`${panel} lg:col-span-2`}><div className="flex flex-col justify-between gap-6 md:flex-row md:items-start"><div><p className="text-[0.55rem] uppercase tracking-[0.25em] text-gold">Shipment</p><h2 className="mt-3 font-display text-3xl">{order.fulfillment.courier || 'Awaiting dispatch'}</h2>{order.fulfillment.trackingNumber ? <p className="mt-3 text-sm text-charcoal/60">Tracking number: <span className="text-charcoal">{order.fulfillment.trackingNumber}</span></p> : <p className="mt-3 text-sm leading-7 text-charcoal/55">Tracking information will be available once your order has been shipped.</p>}</div>{order.fulfillment.trackingUrl ? <a href={order.fulfillment.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-3 border border-charcoal px-6 py-4 text-[0.58rem] uppercase tracking-[0.22em] transition hover:border-gold hover:text-gold dark:border-white/50">Track shipment <ExternalLink size={14} /></a> : null}</div>{order.availableActions.includes('return_requested') ? <div className="mt-7 border-t border-black/10 pt-6 dark:border-white/10">{returnOpen ? <div className="flex flex-col gap-3 md:flex-row"><textarea value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="Tell us why you would like to return this order" className="min-h-24 flex-1 border border-black/15 bg-transparent p-4 text-sm outline-none focus:border-gold dark:border-white/20" /><div className="flex gap-3 md:flex-col"><button disabled={busy} onClick={() => void requestReturn()} className="bg-ink px-5 py-3 text-[0.55rem] uppercase tracking-[0.2em] text-ivory disabled:opacity-40">Submit request</button><button onClick={() => setReturnOpen(false)} className="border border-black/15 px-5 py-3 text-[0.55rem] uppercase tracking-[0.2em] dark:border-white/20">Cancel</button></div></div> : <button onClick={() => setReturnOpen(true)} className="text-[0.56rem] uppercase tracking-[0.22em] text-gold">Request a return</button>}</div> : null}</section>
    <section className={`${panel} lg:col-span-2`}><div className="flex items-center gap-3"><PackageCheck className="text-gold" strokeWidth={1.3} /><div><p className="text-[0.55rem] uppercase tracking-[0.25em] text-gold">Activity history</p><h2 className="mt-1 font-display text-3xl">Every update, recorded.</h2></div></div><div className="mt-7 divide-y divide-black/10 dark:divide-white/10">{[...order.timeline].reverse().map((event) => <div key={event.id} className="grid gap-2 py-5 sm:grid-cols-[11rem_1fr_auto]"><time className="text-xs text-charcoal/45">{orderDateTime(event.timestamp)}</time><div><p className="text-sm">{event.label}</p>{event.note ? <p className="mt-1 text-xs leading-6 text-charcoal/50">{event.note}</p> : null}</div><p className="text-[0.55rem] uppercase tracking-[0.16em] text-charcoal/40">{event.actor.name || titleCase(event.actor.type)}</p></div>)}</div></section></div>
  </> : null}</section></main>;
}
