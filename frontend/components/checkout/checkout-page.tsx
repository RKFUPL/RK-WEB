'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, LockKeyhole, ShoppingBag } from 'lucide-react';
import { StickyHeader } from '@/components/home/sticky-header';
import { emptyCart, getCartSubtotal } from '@/lib/cart';
import { apiBaseUrl } from '@/lib/rbac';
import { cartChangedEvent, readStoredCart, writeStoredCart } from '@/lib/storefront-cart';
import { inr } from '@/lib/catalog';
import type { Cart } from '@/lib/store-types';

type Address = {
  id: string;
  label?: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault?: boolean;
};

type ShippingForm = Omit<Address, 'id' | 'isDefault' | 'label'> & { label?: string };

type RazorpayResponse = {
  order: { id: string; orderNumber?: string; total?: number };
  razorpay: { keyId: string; orderId: string; amount: number; currency: string; mode: string };
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; email: string; contact: string };
  notes: Record<string, string>;
  theme: { color: string };
  handler: (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void;
  modal: { ondismiss: () => void };
};

type RazorpayInstance = { open: () => void; on: (event: string, callback: (response?: { error?: { description?: string } }) => void) => void };

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const emptyShipping: ShippingForm = { fullName: '', phone: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: 'India' };

function token() {
  return typeof window === 'undefined' ? '' : window.localStorage.getItem('rk_access_token') || '';
}

function attemptId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `rk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadRazorpay() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Payment is only available in a browser.'));
  if (window.Razorpay) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay-checkout]');
  if (existing) return new Promise<void>((resolve, reject) => { existing.addEventListener('load', () => resolve(), { once: true }); existing.addEventListener('error', () => reject(new Error('Razorpay Checkout could not be loaded.')), { once: true }); });
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.razorpayCheckout = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Razorpay Checkout could not be loaded.'));
    document.body.appendChild(script);
  });
}

function Field({ label, value, onChange, required = true, placeholder }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; placeholder?: string }) {
  return <label className="block"><span className="text-[0.58rem] uppercase tracking-[0.24em] text-charcoal/50">{label}{required ? ' · Required' : ''}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} className="mt-3 w-full border-b border-black/15 bg-transparent px-0 pb-3 text-sm outline-none transition placeholder:text-charcoal/30 focus:border-gold dark:border-white/15" /></label>;
}

function CheckoutItemSummary({ item }: { item: Cart['items'][number] }) {
  const measurements = item.customSize?.measurements ? Object.entries(item.customSize.measurements) : [];
  return <div className="flex justify-between gap-4 border-b border-black/10 pb-5 text-sm dark:border-white/10">
    <div>
      <p>{item.name}</p>
      <p className="mt-1 text-xs text-charcoal/55">{item.colour || item.variant?.value || 'Default colour'}{item.sku ? ` · ${item.sku}` : ''}</p>
      {item.size ? <p className="mt-1 text-xs text-charcoal/55">Size {item.size}</p> : null}
      {item.customSize ? <div className="mt-1 text-xs leading-5 text-charcoal/55"><p>Custom size · {item.customSize.unit}</p>{measurements.map(([name, value]) => <p key={name}>{name}: {value} {item.customSize?.unit}</p>)}</div> : null}
      <p className="mt-1 text-xs text-charcoal/55">{item.quantity} × {inr.format(item.price)}</p>
    </div>
    <span>{inr.format(item.price * item.quantity)}</span>
  </div>;
}

export function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<Cart>({ items: [], currency: 'INR' });
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [shipping, setShipping] = useState<ShippingForm>(emptyShipping);
  const [email, setEmail] = useState('');
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [testMode, setTestMode] = useState(false);
  const checkoutAttemptId = useMemo(attemptId, []);

  useEffect(() => {
    const currentToken = token();
    if (!currentToken) { setSignedIn(false); return; }
    setSignedIn(true);
    setCart(readStoredCart());
    const sync = () => setCart(readStoredCart());
    window.addEventListener(cartChangedEvent, sync);
    window.addEventListener('storage', sync);
    Promise.all([
      fetch(`${apiBaseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${currentToken}` }, cache: 'no-store' }),
      fetch(`${apiBaseUrl}/api/auth/addresses`, { headers: { Authorization: `Bearer ${currentToken}` }, cache: 'no-store' }),
    ]).then(async ([profileResponse, addressResponse]) => {
      if (!profileResponse.ok) throw new Error('Please sign in again to continue.');
      const profile = await profileResponse.json();
      setEmail(profile.user?.email || '');
      if (addressResponse.ok) {
        const data = await addressResponse.json();
        const saved = (data.addresses || []) as Address[];
        setAddresses(saved);
        const defaultAddress = saved.find((address) => address.isDefault) || saved[0];
        if (defaultAddress) { setSelectedAddressId(defaultAddress.id); setShipping({ ...defaultAddress }); }
      }
    }).catch((error: unknown) => { setMessage(error instanceof Error ? error.message : 'Unable to load checkout.'); setSignedIn(false); });
    return () => { window.removeEventListener(cartChangedEvent, sync); window.removeEventListener('storage', sync); };
  }, []);

  const updateShipping = (key: keyof ShippingForm, value: string) => setShipping((current) => ({ ...current, [key]: value }));
  const subtotal = getCartSubtotal(cart);
  const total = subtotal;

  async function pay() {
    if (busy) return;
    setMessage('');
    if (!cart.items.length) { setMessage('Your shopping bag is empty.'); return; }
    if (cart.items.some((item) => !item.variantId || !item.sku)) { setMessage('One or more older bag items need a colour selection. Remove them and re-add the exact colour before checkout.'); return; }
    if (!shipping.fullName || !shipping.phone || !shipping.line1 || !shipping.city || !shipping.state || !shipping.postalCode || !shipping.country) { setMessage('Please complete the shipping details before paying.'); return; }
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/payments/razorpay/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          checkoutAttemptId,
          cart: cart.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            sku: item.sku,
            quantity: item.quantity,
            size: item.size,
            purchaseMode: item.purchaseMode,
            customSize: item.customSize,
          })),
          shipping: { ...shipping, addressId: selectedAddressId || undefined },
        }),
      });
      const data = await response.json() as RazorpayResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || 'We could not start payment.');
      setTestMode(data.razorpay.mode === 'test' && process.env.NODE_ENV !== 'production');
      await loadRazorpay();
      if (!window.Razorpay) throw new Error('Razorpay Checkout is unavailable.');
      const checkout = new window.Razorpay({
        key: data.razorpay.keyId,
        amount: data.razorpay.amount,
        currency: data.razorpay.currency,
        name: 'Rashi Kapoor',
        description: `RK order ${data.order.orderNumber || ''}`,
        order_id: data.razorpay.orderId,
        prefill: { name: shipping.fullName, email, contact: shipping.phone },
        notes: { orderNumber: data.order.orderNumber || '' },
        theme: { color: '#b58a4c' },
        handler: async (payment) => {
          try {
            const verification = await fetch(`${apiBaseUrl}/api/payments/razorpay/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify(payment) });
            const result = await verification.json() as { order?: { id: string }; error?: string };
            if (!verification.ok || !result.order?.id) throw new Error(result.error || 'Payment verification failed.');
            writeStoredCart(emptyCart);
            router.push(`/order-success/${result.order.id}`);
          } catch (error: unknown) {
            setBusy(false);
            setMessage(error instanceof Error ? error.message : 'Payment verification failed. Your bag is unchanged.');
          }
        },
        modal: { ondismiss: () => { setBusy(false); setMessage('Payment cancelled. Your items are still in your bag.'); void fetch(`${apiBaseUrl}/api/payments/razorpay/state`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify({ orderId: data.order.id, state: 'cancelled', reason: 'Customer dismissed Razorpay Checkout.' }) }); } },
      });
      checkout.on('payment.failed', (failure) => { setBusy(false); setMessage(failure?.error?.description || 'Payment failed. Your bag is unchanged.'); void fetch(`${apiBaseUrl}/api/payments/razorpay/state`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify({ orderId: data.order.id, state: 'failed', reason: failure?.error?.description || 'Razorpay reported a failed payment.' }) }); });
      checkout.open();
    } catch (error: unknown) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : 'Payment could not be started.');
    }
  }

  if (signedIn === null) return null;
  if (!signedIn) return <main className="min-h-screen bg-ivory px-6 pb-24 pt-32 text-charcoal"><StickyHeader /><div className="mx-auto max-w-xl py-20 text-center"><h1 className="font-display text-5xl">Sign in to check out.</h1><p className="mt-5 text-sm text-charcoal/60">Your shipping details and payment are connected to your RK account.</p><Link href="/account" className="mt-9 inline-flex bg-ink px-8 py-4 text-xs uppercase tracking-[0.25em] text-ivory">Sign in</Link></div></main>;

  return <main className="min-h-screen bg-ivory px-4 pb-24 pt-32 text-charcoal sm:px-8 lg:px-12"><StickyHeader /><div className="mx-auto max-w-6xl"><Link href="/bag" className="inline-flex items-center gap-2 text-[0.6rem] uppercase tracking-[0.24em] text-charcoal/55 transition hover:text-gold"><ArrowLeft size={13} /> Back to bag</Link><div className="mt-8 border-b border-black/12 pb-8 dark:border-white/15"><div className="flex items-center justify-between gap-5"><div><p className="text-[0.58rem] uppercase tracking-[0.35em] text-gold">Checkout</p><h1 className="mt-3 font-display text-5xl sm:text-6xl">Make it yours.</h1></div><LockKeyhole className="text-gold" size={24} strokeWidth={1.2} /></div>{testMode ? <span className="mt-5 inline-flex rounded-full border border-gold/50 px-3 py-1 text-[0.55rem] uppercase tracking-[0.2em] text-gold">Test mode</span> : null}</div>{message ? <p className="mt-6 border border-gold/35 bg-gold/5 px-4 py-3 text-sm text-charcoal/75">{message}</p> : null}<div className="mt-10 grid gap-10 lg:grid-cols-[1fr_22rem]"><section className="space-y-8"><div className="border border-black/10 p-6 dark:border-white/15 sm:p-8"><div className="flex items-center gap-3"><ShoppingBag size={18} className="text-gold" strokeWidth={1.25} /><h2 className="font-display text-3xl">Contact and delivery</h2></div><p className="mt-2 text-sm text-charcoal/55">{email}</p>{addresses.length ? <label className="mt-7 block"><span className="text-[0.58rem] uppercase tracking-[0.24em] text-charcoal/50">Use a saved address</span><select value={selectedAddressId} onChange={(event) => { const address = addresses.find((entry) => entry.id === event.target.value); setSelectedAddressId(event.target.value); if (address) setShipping({ ...address }); }} className="mt-3 w-full border-b border-black/15 bg-transparent py-3 text-sm outline-none dark:border-white/15"><option value="">Enter a new address</option>{addresses.map((address) => <option key={address.id} value={address.id}>{address.label || address.fullName} · {address.city}</option>)}</select></label> : null}<div className="mt-8 grid gap-7 sm:grid-cols-2"><Field label="Full name" value={shipping.fullName} onChange={(value) => updateShipping('fullName', value)} /><Field label="Phone" value={shipping.phone} onChange={(value) => updateShipping('phone', value)} placeholder="+91 00000 00000" /><Field label="Address line 1" value={shipping.line1} onChange={(value) => updateShipping('line1', value)} /><Field label="Address line 2" value={shipping.line2 || ''} onChange={(value) => updateShipping('line2', value)} required={false} /><Field label="City" value={shipping.city} onChange={(value) => updateShipping('city', value)} /><Field label="State" value={shipping.state} onChange={(value) => updateShipping('state', value)} /><Field label="Postal code" value={shipping.postalCode} onChange={(value) => updateShipping('postalCode', value)} /><Field label="Country" value={shipping.country} onChange={(value) => updateShipping('country', value)} /></div></div></section><aside className="h-fit border border-black/10 p-6 dark:border-white/15 sm:p-8"><p className="text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/50">Order summary</p><div className="mt-6 space-y-5">{cart.items.map((item) => <CheckoutItemSummary key={`${item.productId}:${item.variantId}:${item.size || ''}`} item={item} />)}</div><div className="mt-6 flex justify-between border-b border-black/10 pb-5 text-sm dark:border-white/10"><span>Subtotal</span><span>{inr.format(subtotal)}</span></div><div className="mt-4 flex justify-between text-base"><span>Total</span><span>{inr.format(total)}</span></div><p className="mt-5 text-xs leading-6 text-charcoal/55">Shipping and final order details are confirmed by the RK team. Razorpay will open securely in Test Mode.</p><button type="button" disabled={busy || !cart.items.length} onClick={pay} className="mt-7 flex w-full items-center justify-center gap-3 bg-ink px-5 py-4 text-[0.6rem] uppercase tracking-[0.25em] text-ivory transition hover:bg-gold hover:text-ink disabled:cursor-not-allowed disabled:opacity-45">{busy ? 'Opening secure payment…' : <>Pay {inr.format(total)} <Check size={14} /></>}</button></aside></div></div></main>;
}
