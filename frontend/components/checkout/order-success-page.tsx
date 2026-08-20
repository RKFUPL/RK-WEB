'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { StickyHeader } from '@/components/home/sticky-header';
import { apiBaseUrl } from '@/lib/rbac';
import { inr, type Order } from '@/lib/orders';

export function OrderSuccessPage({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const accessToken = window.localStorage.getItem('rk_access_token') || '';
    fetch(`${apiBaseUrl}/api/payments/orders/${orderId}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Order not found.');
        setOrder(data.order);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Order not found.'));
  }, [orderId]);

  return <main className="min-h-screen bg-ivory px-6 pb-24 pt-32 text-charcoal">
    <StickyHeader />
    <div className="mx-auto max-w-2xl py-14 text-center">
      <CheckCircle2 className="mx-auto h-12 w-12 text-gold" strokeWidth={1.1} />
      <p className="mt-8 text-[0.58rem] uppercase tracking-[0.35em] text-gold">Order confirmed</p>
      <h1 className="mt-4 font-display text-5xl sm:text-6xl">Thank you.</h1>
      {error ? <p className="mt-6 text-sm text-charcoal/65">{error}</p> : !order ? <p className="mt-6 text-sm text-charcoal/60">Loading your order details…</p> : <>
        <p className="mt-6 text-sm leading-7 text-charcoal/65">Your payment has been verified and your request has reached the RK team.</p>
        <div className="mt-10 border border-black/10 p-6 text-left dark:border-white/15 sm:p-8">
          <div className="flex justify-between gap-4 border-b border-black/10 pb-5 text-sm dark:border-white/10"><span>Order</span><span>{order.orderNumber}</span></div>
          <div className="mt-5 flex justify-between gap-4 border-b border-black/10 pb-5 text-sm dark:border-white/10"><span>Payment</span><span className="capitalize">{order.paymentStatus || 'Paid'}</span></div>
          <div className="mt-5 space-y-4">{(order.items || []).map((item, index) => <div key={`${item.sku || item.name}-${index}`} className="flex justify-between gap-4 text-sm">
            <div><p>{item.name} × {item.quantity}</p><p className="mt-1 text-xs text-charcoal/55">{item.colour || item.variant?.value || 'Selected colour'} · {item.sku || 'SKU unavailable'}{item.size ? ` · Size ${item.size}` : ' · Custom size'}</p>{item.customSize?.measurements ? <p className="mt-1 text-xs leading-5 text-charcoal/50">{Object.entries(item.customSize.measurements).map(([name, value]) => `${name}: ${value} ${item.customSize?.unit || 'cm'}`).join(' · ')}</p> : null}</div>
            <span>{inr.format((item.unitPrice || 0) * item.quantity)}</span>
          </div>)}</div>
          <div className="mt-6 flex justify-between border-t border-black/10 pt-5 text-base dark:border-white/10"><span>Total</span><span>{inr.format(order.total || 0)}</span></div>
          {order.shipping ? <p className="mt-7 border-t border-black/10 pt-5 text-xs leading-6 text-charcoal/60 dark:border-white/10">Deliver to {order.shipping.fullName}, {order.shipping.line1}{order.shipping.line2 ? `, ${order.shipping.line2}` : ''}, {order.shipping.city}, {order.shipping.state} {order.shipping.postalCode}, {order.shipping.country}. Phone: {order.shipping.phone || order.phone || 'not recorded'}.</p> : null}
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-5"><Link href={`/account/orders/${orderId}`} className="border-b border-charcoal/35 pb-2 text-xs uppercase tracking-[0.24em] hover:border-gold hover:text-gold">Track this order</Link><Link href="/account/orders" className="border-b border-charcoal/35 pb-2 text-xs uppercase tracking-[0.24em] hover:border-gold hover:text-gold">My orders</Link><Link href="/collections" className="border-b border-charcoal/35 pb-2 text-xs uppercase tracking-[0.24em] hover:border-gold hover:text-gold">Continue exploring</Link></div>
      </>}
    </div>
  </main>;
}
