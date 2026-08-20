'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, PackageCheck, X } from 'lucide-react';
import { apiBaseUrl } from '@/lib/rbac';
import { fulfillmentLabels, inr, orderDateTime, paymentLabels, titleCase, type Order } from '@/lib/orders';

const fieldClass = 'mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-xs outline-none focus:border-[#9a7a4d] dark:border-white/10 dark:bg-[#121317]';
const panelClass = 'rounded-xl border border-black/[.07] bg-[#faf8f4] p-5 dark:border-white/[.08] dark:bg-white/[.025]';
const actionLabels: Record<string, string> = { processing: 'Mark as Processed', packed: 'Mark as Packed', shipped: 'Mark as Shipped', out_for_delivery: 'Mark as Out for Delivery', delivered: 'Mark as Delivered', cancelled: 'Cancel Order', returned: 'Mark Returned', refunded: 'Mark Refunded', shipment_update: 'Update Tracking', return_accept: 'Accept Return' };

export function AdminOrderDetail({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [action, setAction] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ courier: '', trackingNumber: '', trackingUrl: '', customerNote: '', sendCustomerNotification: true, receivedBy: '', proofPhoto: '', signature: '' });
  const token = () => window.localStorage.getItem('rk_access_token') || '';

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/staff/orders/${orderId}`, { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load this order.');
      setOrder(payload.order);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load this order.'); }
    finally { setLoading(false); }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  const openAction = (next: string) => {
    if (!order) return;
    setForm({ courier: order.fulfillment.courier || '', trackingNumber: order.fulfillment.trackingNumber || '', trackingUrl: order.fulfillment.trackingUrl || '', customerNote: '', sendCustomerNotification: true, receivedBy: '', proofPhoto: '', signature: '' });
    setAction(next); setError(''); setMessage('');
  };

  const readProof = (field: 'proofPhoto' | 'signature', file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 1_800_000) { setError('Proof images must be smaller than 1.8 MB.'); return; }
    const reader = new FileReader(); reader.onload = () => setForm((current) => ({ ...current, [field]: String(reader.result || '') })); reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!order || !action) return;
    setBusy(true); setError('');
    try {
      const path = action === 'shipment_update' ? 'shipment' : action === 'return_accept' ? 'return' : 'fulfillment';
      const body = action === 'shipment_update' ? form : action === 'return_accept' ? form : { ...form, status: action, note: form.customerNote };
      const response = await fetch(`${apiBaseUrl}/api/staff/orders/${order.id}/${path}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to update this order.');
      setOrder(payload.order); setAction(null); setMessage('Order updated successfully.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update this order.'); }
    finally { setBusy(false); }
  };

  const resendConfirmation = async () => {
    if (!order) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/staff/orders/${order.id}/confirmation-email`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } });
      const payload = await response.json();
      if (payload.order) setOrder(payload.order);
      if (!response.ok) throw new Error(payload.error || payload.message || 'Email delivery failed.');
      setMessage(payload.message || 'Order confirmation sent.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Email delivery failed. The paid order is unchanged.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <section className="mt-10 h-96 animate-pulse rounded-2xl bg-white dark:bg-[#191a1f]" />;
  if (!order) return <section className="mt-10 rounded-2xl bg-white p-8 text-sm text-red-600">{error || 'Order not found.'}</section>;
  const address = order.shippingAddress || order.shipping || {};
  const actionList = order.availableActions || [];
  return <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-5 shadow-[0_4px_20px_rgba(25,31,38,.035)] dark:border-white/[.08] dark:bg-[#191a1f] sm:p-8">
    <Link href="/admin/orders" className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[.18em] text-[#9a7a4d]"><ArrowLeft size={14} /> Admin orders</Link>
    <div className="mt-6 flex flex-col justify-between gap-5 border-b border-black/[.08] pb-7 dark:border-white/[.08] md:flex-row md:items-end"><div><p className="text-[9px] uppercase tracking-[.2em] text-[#9a7a4d]">Order details</p><h1 className="mt-2 text-3xl font-semibold">#{order.orderNumber}</h1><p className="mt-2 text-xs text-[#858b94]">Created {orderDateTime(order.createdAt)}</p></div><div className="flex flex-wrap gap-2"><span className="rounded-full border border-emerald-500/30 px-3 py-1 text-[9px] uppercase tracking-[.14em] text-emerald-700">Payment: {paymentLabels[order.paymentStatus]}</span><span className="rounded-full border border-[#9a7a4d]/35 px-3 py-1 text-[9px] uppercase tracking-[.14em] text-[#9a7a4d]">{fulfillmentLabels[order.fulfillmentStatus]}</span></div></div>
    {message ? <p className="mt-5 text-sm text-emerald-700">{message}</p> : null}{error ? <p className="mt-5 text-sm text-red-600">{error}</p> : null}
    <section className={`${panelClass} mt-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center`}>
      <div><p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">Order confirmation email</p><p className="mt-2 text-xs text-[#858b94]">Status: {titleCase(order.confirmationEmail?.status || 'pending')} · Attempts: {order.confirmationEmail?.attempts || 0}</p>{order.confirmationEmail?.error ? <p className="mt-1 max-w-2xl text-xs text-red-600">{order.confirmationEmail.error}</p> : null}</div>
      {order.paymentStatus === 'paid' ? <button type="button" disabled={busy} onClick={() => void resendConfirmation()} className="rounded-lg border border-[#9a7a4d]/40 px-4 py-2.5 text-[9px] uppercase tracking-[.14em] text-[#9a7a4d] disabled:opacity-40">{order.confirmationEmail?.status === 'sent' ? 'Resend confirmation' : 'Send confirmation'}</button> : null}
    </section>
    <div className="mt-7 grid gap-4 md:grid-cols-2"><section className={panelClass}><p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">Customer</p><p className="mt-4 font-medium">{order.customerName || 'Customer'}</p><p className="mt-2 text-xs leading-6 text-[#858b94]">{order.email}<br />{order.phone || 'No phone recorded'}</p></section><section className={panelClass}><p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">Shipping address</p><p className="mt-4 text-xs leading-6 text-[#6e747d]">{address.fullName}<br />{address.line1}{address.line2 ? `, ${address.line2}` : ''}<br />{address.city}, {address.state} {address.postalCode}<br />{address.country}<br />{address.phone || order.phone || 'No phone recorded'}</p></section></div>
    <section className={`${panelClass} mt-4`}>
      <p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">Products</p>
      <div className="mt-4 divide-y divide-black/[.07] dark:divide-white/[.07]">{order.items.map((item, index) => <div key={`${item.productId || item.sku || item.name}-${index}`} className="grid gap-4 py-4 sm:grid-cols-[5rem_1fr_auto]">
        <div className="h-20 overflow-hidden bg-[#ece3d4]">{item.image ? <img src={item.image} alt={`${item.name} in ${item.colour || item.variant?.value || 'selected colour'}`} className="h-full w-full object-cover" /> : null}</div>
        <div>
          <p className="font-medium">{item.name}</p>
          <p className="mt-1 text-xs text-[#858b94]">Parent {item.productCode || item.parentSku || item.name}</p>
          <p className="mt-1 text-xs text-[#858b94]">SKU {item.sku || '—'} · {item.collection || 'Collection not recorded'} · {item.colour || item.variant?.value || 'Colour not recorded'}</p>
          <p className="mt-1 text-xs text-[#858b94]">Qty {item.quantity}{item.size ? ` · Size ${item.size}` : ''}{item.purchaseMode ? ` · ${item.purchaseMode === 'custom_size' ? 'Custom size order' : 'Standard size order'}` : ''}</p>
          {item.customSize?.measurements ? <dl className="mt-2 grid max-w-lg grid-cols-2 gap-x-5 gap-y-1 text-[11px] text-[#858b94]">{Object.entries(item.customSize.measurements).map(([key, value]) => <div key={key} className="contents"><dt>{key}</dt><dd>{value} {item.customSize?.unit || 'cm'}</dd></div>)}</dl> : null}
        </div>
        <p className="text-sm">{inr.format(item.lineTotal || (item.unitPrice || 0) * item.quantity)}</p>
      </div>)}</div>
    </section>
    <div className="mt-4 grid gap-4 md:grid-cols-2"><section className={panelClass}><p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">Payment</p><dl className="mt-4 space-y-3 text-xs"><div className="flex justify-between gap-4"><dt className="text-[#858b94]">Status</dt><dd>{paymentLabels[order.paymentStatus]}</dd></div><div className="flex justify-between gap-4"><dt className="text-[#858b94]">Amount</dt><dd>{inr.format(order.total || 0)}</dd></div><div className="flex justify-between gap-4"><dt className="text-[#858b94]">Gateway</dt><dd>{titleCase(order.payment.gateway)}</dd></div><div className="flex justify-between gap-4"><dt className="text-[#858b94]">Razorpay order</dt><dd className="max-w-[14rem] break-all text-right">{order.payment.razorpayOrderId || '—'}</dd></div><div className="flex justify-between gap-4"><dt className="text-[#858b94]">Razorpay payment</dt><dd className="max-w-[14rem] break-all text-right">{order.payment.razorpayPaymentId || '—'}</dd></div></dl></section><section className={panelClass}><div className="flex items-start justify-between gap-3"><div><p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">Fulfillment</p><p className="mt-4 font-medium">{fulfillmentLabels[order.fulfillmentStatus]}</p></div>{['shipped', 'out_for_delivery', 'delivered'].includes(order.fulfillmentStatus) ? <button onClick={() => openAction('shipment_update')} className="text-[9px] uppercase tracking-[.14em] text-[#9a7a4d]">Update Tracking</button> : null}</div><dl className="mt-4 space-y-3 text-xs"><div className="flex justify-between gap-4"><dt className="text-[#858b94]">Courier</dt><dd>{order.fulfillment.courier || 'Not assigned'}</dd></div><div className="flex justify-between gap-4"><dt className="text-[#858b94]">Tracking</dt><dd>{order.fulfillment.trackingNumber || 'Not yet available'}</dd></div><div className="flex justify-between gap-4"><dt className="text-[#858b94]">URL</dt><dd>{order.fulfillment.trackingUrl ? <a href={order.fulfillment.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#9a7a4d]">Open <ExternalLink size={11} /></a> : '—'}</dd></div>{order.fulfillment.delivery?.receivedBy ? <div className="flex justify-between gap-4"><dt className="text-[#858b94]">Received by</dt><dd>{order.fulfillment.delivery.receivedBy}</dd></div> : null}</dl></section></div>
    {order.returnRequest ? <section className={`${panelClass} mt-4`}><p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">Return status</p><p className="mt-4 text-sm">{titleCase(order.returnRequest.status)}</p><p className="mt-2 text-xs text-[#858b94]">{order.returnRequest.shipment ? `${order.returnRequest.shipment.courier} · LR ${order.returnRequest.shipment.lrNumber}` : 'Return shipment details: Awaiting customer'}</p></section> : null}
    {actionList.length ? <section className={`${panelClass} mt-4`}><p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">Valid next actions</p><div className="mt-4 flex flex-wrap gap-3">{actionList.map((next) => <button key={next} onClick={() => openAction(next)} className="rounded-lg bg-[#24211e] px-4 py-2.5 text-xs text-white hover:bg-[#9a7a4d]">{actionLabels[next] || titleCase(next)}</button>)}</div></section> : null}
    <section className={`${panelClass} mt-4`}><div className="flex items-center gap-3"><PackageCheck size={17} className="text-[#9a7a4d]" /><div><p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">Timeline</p><p className="mt-1 text-xs text-[#858b94]">Status changes and customer communication history.</p></div></div><div className="mt-5 divide-y divide-black/[.07] dark:divide-white/[.07]">{[...order.timeline].reverse().map((event) => <div key={event.id} className="grid gap-2 py-4 sm:grid-cols-[11rem_1fr_auto]"><time className="text-[10px] text-[#858b94]">{orderDateTime(event.timestamp)}</time><div><p className="text-xs font-medium">{event.label}</p>{event.note ? <p className="mt-1 text-[11px] text-[#858b94]">{event.note}</p> : null}{event.notifyCustomer ? <p className="mt-1 text-[10px] uppercase tracking-[.12em] text-emerald-700">Customer notified</p> : null}</div><span className="text-[9px] uppercase tracking-[.14em] text-[#9a7a4d]">{event.actor.name || event.actor.type}</span></div>)}</div></section>
    {action ? <div className="fixed inset-0 z-[300] grid place-items-center bg-black/65 p-4"><section className="w-full max-w-xl rounded-2xl bg-[#f8f7f4] p-6 shadow-2xl dark:bg-[#191a1f] sm:p-8"><div className="flex justify-between"><div><p className="text-[9px] uppercase tracking-[.2em] text-[#9a7a4d]">Order action</p><h2 className="mt-2 text-xl font-semibold">{actionLabels[action] || titleCase(action)}</h2></div><button onClick={() => setAction(null)}><X size={18} /></button></div>{action === 'shipment_update' || action === 'shipped' ? <div className="mt-6 grid gap-4"><label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">Courier<input value={form.courier} onChange={(event) => setForm((current) => ({ ...current, courier: event.target.value }))} className={fieldClass} /></label><label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">Tracking number<input value={form.trackingNumber} onChange={(event) => setForm((current) => ({ ...current, trackingNumber: event.target.value }))} className={fieldClass} /></label><label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">Tracking URL<input value={form.trackingUrl} onChange={(event) => setForm((current) => ({ ...current, trackingUrl: event.target.value }))} className={fieldClass} /></label></div> : null}{action !== 'return_accept' ? <div className="mt-5 grid gap-4"><label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">Customer note · optional<textarea value={form.customerNote} onChange={(event) => setForm((current) => ({ ...current, customerNote: event.target.value }))} rows={3} className={fieldClass} /></label><label className="flex items-center gap-3 text-xs"><input type="checkbox" checked={form.sendCustomerNotification} onChange={(event) => setForm((current) => ({ ...current, sendCustomerNotification: event.target.checked }))} />Send customer notification</label>{action === 'delivered' ? <><label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">Received by<input value={form.receivedBy} onChange={(event) => setForm((current) => ({ ...current, receivedBy: event.target.value }))} className={fieldClass} /></label><label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">Proof photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => readProof('proofPhoto', event.target.files?.[0])} className="mt-2 block w-full text-xs" /></label><label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">Signature<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => readProof('signature', event.target.files?.[0])} className="mt-2 block w-full text-xs" /></label></> : null}</div> : null}<div className="mt-7 flex justify-end gap-3"><button onClick={() => setAction(null)} className="rounded-lg border border-black/10 px-5 py-3 text-xs">Cancel</button><button disabled={busy} onClick={() => void submit()} className="rounded-lg bg-[#24211e] px-5 py-3 text-xs text-white disabled:opacity-50">{busy ? 'Saving…' : 'Confirm'}</button></div></section></div> : null}
  </section>;
}
