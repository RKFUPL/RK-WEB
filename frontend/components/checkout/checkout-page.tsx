'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { addressCountryCode, addressPhoneParts, canonicalPhone, countryNames, internationalPhoneParts } from '@/lib/phone-number';
import { type CountryCode } from 'libphonenumber-js/max';
import { ArrowLeft, Check, LockKeyhole, ShoppingBag } from 'lucide-react';
import { StickyHeader } from '@/components/home/sticky-header';
import { ShippingTimeline } from '@/components/commerce/shipping-timeline';
import { emptyCart, getCartSubtotal } from '@/lib/cart';
import { apiBaseUrl } from '@/lib/rbac';
import { cartChangedEvent, readStoredCart, writeStoredCart } from '@/lib/storefront-cart';
import { useCurrency } from '@/components/commerce/currency-provider';
import type { Cart } from '@/lib/store-types';
import { cartItemShippingTimeline } from '@/lib/shipping-timeline';
import { CountrySelector, InternationalPhone } from '@/components/commerce/international-phone';

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
  paymentMode?: "manual";
  razorpay?: { keyId: string; orderId: string; amount: number; currency: string; mode: string };
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
const blankShipping: ShippingForm = { ...emptyShipping, country: '' };

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
  const { formatPrice } = useCurrency();
  const measurements = item.customSize?.measurements ? Object.entries(item.customSize.measurements) : [];
  return <div className="flex justify-between gap-4 border-b border-black/10 pb-5 text-sm dark:border-white/10">
    <div>
      <p>{item.name}</p>
      <p className="mt-1 text-xs text-charcoal/55">{item.colour || item.variant?.value || 'Default colour'}{item.sku ? ` · ${item.sku}` : ''}</p>
      {item.size ? <p className="mt-1 text-xs text-charcoal/55">Size {item.size}</p> : null}
      {item.customSize ? <div className="mt-1 text-xs leading-5 text-charcoal/55"><p>Custom size · {item.customSize.unit}</p>{measurements.map(([name, value]) => <p key={name}>{name}: {value} {item.customSize?.unit}</p>)}</div> : null}
      <p className="mt-1 text-xs text-charcoal/55">{item.quantity} × {formatPrice(item.price)}</p>
      <ShippingTimeline timeline={cartItemShippingTimeline(item)} compact />
    </div>
    <span>{formatPrice(item.price * item.quantity)}</span>
  </div>;
}

export function CheckoutPage() {
  const { currency, formatPrice } = useCurrency();
  const inr = { format: formatPrice };
  const router = useRouter();
  const [cart, setCart] = useState<Cart>({ items: [], currency: 'INR' });
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [deliveryPhoneCountry, setDeliveryPhoneCountry] = useState<CountryCode>('IN');
  const [deliveryPhoneError, setDeliveryPhoneError] = useState('');
  const [shipping, setShipping] = useState<ShippingForm>(emptyShipping);
  const [email, setEmail] = useState('');
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [testMode, setTestMode] = useState(false);
  const [razorpayEnabled, setRazorpayEnabled] = useState(true);
  const [storefrontSettingsReady, setStorefrontSettingsReady] = useState(false);
  const [requireWhatsappConsentForCheckout, setRequireWhatsappConsentForCheckout] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [collectionMode, setCollectionMode] = useState('checkout');
  const [consentRecipient, setConsentRecipient] = useState<string | null>(null);
  const [sameAsContactPhone, setSameAsContactPhone] = useState(false);
  const [primaryWhatsapp, setPrimaryWhatsapp] = useState('');
  const [primaryConsent, setPrimaryConsent] = useState(false);
  const [whatsappConsentError, setWhatsappConsentError] = useState('');
  const [whatsappPhoneError, setWhatsappPhoneError] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [whatsappCountry, setWhatsappCountry] = useState<CountryCode>('IN');
  const consentCheckboxRef = useRef<HTMLInputElement>(null);
  const whatsappPhoneInputRef = useRef<HTMLInputElement>(null);
  const canonicalDeliveryPhone = addressCountryCode(shipping.country) ? canonicalPhone(shipping.phone, deliveryPhoneCountry) : '';
  const contactWhatsapp = internationalPhoneParts(canonicalDeliveryPhone);
  const displayedWhatsappNumber = sameAsContactPhone ? contactWhatsapp?.nationalNumber || '' : whatsappNumber;
  const displayedWhatsappCountry = sameAsContactPhone ? deliveryPhoneCountry : whatsappCountry;
  // Derive linked values synchronously, so a render can never submit a stale copy.
  const selectedWhatsapp = sameAsContactPhone ? contactWhatsapp?.recipient || '' : canonicalPhone(whatsappNumber, whatsappCountry);
  const whatsappTransactionalConsent = consentRecipient !== null && consentRecipient === selectedWhatsapp;
  const savedRecipientConsent = primaryConsent && selectedWhatsapp === primaryWhatsapp;
  const checkoutConsentAvailable = savedRecipientConsent || (Boolean(selectedWhatsapp) && whatsappTransactionalConsent);
  const [checkoutAttemptId, setCheckoutAttemptId] = useState(attemptId);
  useEffect(() => { setConsentRecipient(null); setWhatsappPhoneError(''); }, [selectedWhatsapp]);
  useEffect(() => { setCheckoutAttemptId(attemptId()); }, [selectedWhatsapp, whatsappTransactionalConsent, shipping, cart]);

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/storefront-settings`, { cache: "no-store" }).then(r => {
      if (!r.ok) throw new Error('Unable to load checkout settings. Refresh and try again.');
      return r.json();
    }).then(data => { setRazorpayEnabled(data.settings?.razorpayEnabled !== false); setCollectionMode(data.settings?.whatsappConsentCollectionMode || 'checkout'); setRequireWhatsappConsentForCheckout(data.settings?.whatsappConsentCollectionMode !== 'onboarding' && data.settings?.requireWhatsappConsentForCheckout === true); setStorefrontSettingsReady(true); }).catch(() => { setMessage('Unable to load checkout settings. Refresh and try again.'); });
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
      const primary = canonicalPhone(profile.user?.whatsappPhone || '');
      setPrimaryWhatsapp(primary);
      const primaryParts = internationalPhoneParts(primary);
      setWhatsappNumber(primaryParts?.nationalNumber || '');
      setWhatsappCountry(primaryParts?.country || 'IN');
      setPrimaryConsent(profile.user?.whatsappConsentValid === true && Boolean(primary));
      if (addressResponse.ok) {
        const data = await addressResponse.json();
        const saved = (data.addresses || []) as Address[];
        setAddresses(saved);
        const defaultAddress = saved.find((address) => address.isDefault) || saved[0];
        if (defaultAddress) { setSelectedAddressId(defaultAddress.id); initialiseAddress(defaultAddress); }
      }
      setProfileReady(true);
    }).catch((error: unknown) => { setMessage(error instanceof Error ? error.message : 'Unable to load checkout.'); setSignedIn(false); });
    return () => { window.removeEventListener(cartChangedEvent, sync); window.removeEventListener('storage', sync); };
  }, []);

  const updateShipping = (key: keyof ShippingForm, value: string) => setShipping((current) => ({ ...current, [key]: value }));
  function initialiseAddress(address: ShippingForm) {
    const parsed = addressPhoneParts(address.phone, address.country);
    setShipping({ ...address, phone: parsed?.nationalNumber || address.phone });
    setDeliveryPhoneCountry(parsed?.country || addressCountryCode(address.country) || 'IN');
    setDeliveryPhoneError('');
  }
  function updateDeliveryCountry(country: CountryCode) {
    setShipping(current => ({ ...current, country: countryNames.of(country) || country }));
    setDeliveryPhoneCountry(country);
    setDeliveryPhoneError('');
  }
  function updateDeliveryPhone(value: string, country: CountryCode) {
    const parsed = internationalPhoneParts(value);
    setShipping(current => ({ ...current, phone: parsed?.nationalNumber || value }));
    setDeliveryPhoneCountry(parsed?.country || country);
    setDeliveryPhoneError('');
  }
  function selectShippingAddress(id: string) {
    setSelectedAddressId(id);
    if (id) {
      const address = addresses.find(entry => entry.id === id);
      if (address) initialiseAddress(address);
      return;
    }
    setShipping({ ...blankShipping });
    setDeliveryPhoneError('');
    setWhatsappNumber('');
    setConsentRecipient(null);
    setWhatsappConsentError('');
    setWhatsappPhoneError('');
  }
  const subtotal = getCartSubtotal(cart);
  const total = subtotal;

  function updateWhatsappNumber(value: string, country: CountryCode) {
    setSameAsContactPhone(false);
    setWhatsappNumber(value);
    setWhatsappCountry(country);
    setConsentRecipient(null);
    setWhatsappConsentError('');
    setWhatsappPhoneError('');
  }

  function toggleContactPhone(checked: boolean) {
    // Preserve an independently entered number when temporarily linking delivery.
    if (!checked && !whatsappNumber && contactWhatsapp) {
      setWhatsappNumber(contactWhatsapp.nationalNumber);
      setWhatsappCountry(contactWhatsapp.country);
    }
    setSameAsContactPhone(checked);
    setWhatsappConsentError('');
    setWhatsappPhoneError('');
  }

  async function pay() {
    if (busy) return;
    setMessage('');
    if (!storefrontSettingsReady) { setMessage('Unable to load checkout settings. Refresh and try again.'); return; }
    if (!cart.items.length) { setMessage('Your shopping bag is empty.'); return; }
    if (cart.items.some((item) => !item.variantId || !item.sku)) { setMessage('One or more older bag items need a colour selection. Remove them and re-add the exact colour before checkout.'); return; }
    if (!shipping.fullName || !shipping.phone || !shipping.line1 || !shipping.city || !shipping.state || !shipping.postalCode || !shipping.country) { setMessage('Please complete the shipping details before paying.'); return; }
    if (!addressCountryCode(shipping.country)) { setMessage('Please select a valid delivery country.'); return; }
    if (!canonicalDeliveryPhone) { setDeliveryPhoneError('Enter a valid delivery phone number for the selected calling code.'); return; }
    if (requireWhatsappConsentForCheckout && !savedRecipientConsent && !whatsappTransactionalConsent) {
      setWhatsappConsentError('Please agree to receive transactional WhatsApp updates to continue placing your order.');
      requestAnimationFrame(() => {
        consentCheckboxRef.current?.focus();
        consentCheckboxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }
    if (whatsappTransactionalConsent && !selectedWhatsapp) {
      setWhatsappPhoneError('Enter a valid WhatsApp number for order updates.');
      requestAnimationFrame(() => {
        whatsappPhoneInputRef.current?.focus();
        whatsappPhoneInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }
    if (requireWhatsappConsentForCheckout && savedRecipientConsent) {
      try {
        const response = await fetch(`${apiBaseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token()}` },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Unable to confirm current WhatsApp consent. Refresh and try again.');
        const profile = await response.json();
        const currentNumber = canonicalPhone(profile.user?.whatsappPhone || '');
        if (profile.user?.whatsappConsentValid !== true || currentNumber !== selectedWhatsapp) {
          setPrimaryWhatsapp(currentNumber);
          setPrimaryConsent(false);
          setConsentRecipient(null);
          setWhatsappConsentError('Please agree to receive transactional WhatsApp updates to continue placing your order.');
          requestAnimationFrame(() => {
            consentCheckboxRef.current?.focus();
            consentCheckboxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
          return;
        }
      } catch (error: unknown) {
        setMessage(error instanceof Error ? error.message : 'Unable to confirm current WhatsApp consent. Refresh and try again.');
        return;
      }
    }
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/payments/razorpay/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          checkoutAttemptId,
          whatsappRecipient: checkoutConsentAvailable ? selectedWhatsapp : '',
          ...(selectedWhatsapp && checkoutConsentAvailable ? { whatsappCountry: displayedWhatsappCountry } : {}),
          ...(collectionMode !== 'onboarding' && (requireWhatsappConsentForCheckout || !savedRecipientConsent) ? { whatsappTransactionalConsent: checkoutConsentAvailable } : {}),
          cart: cart.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            sku: item.sku,
            quantity: item.quantity,
            size: item.size,
            purchaseMode: item.purchaseMode,
            customSize: item.customSize,
          })),
          displayCurrency: currency,
          shipping: { ...shipping, phone: canonicalDeliveryPhone, addressId: selectedAddressId && addresses.some(address => address.id === selectedAddressId && Object.keys(emptyShipping).every(key => (address[key as keyof ShippingForm] || '') === (key === 'phone' ? canonicalDeliveryPhone : shipping[key as keyof ShippingForm] || ''))) ? selectedAddressId : undefined },
        }),
      });
      const data = await response.json() as RazorpayResponse & { error?: string };
      if (response.status === 409) setCheckoutAttemptId(attemptId());
      if (!response.ok) throw new Error(data.error === 'invalid_recipient' ? 'Enter a valid WhatsApp number with its country code.' : data.error || 'We could not start payment.');
      if (data.paymentMode === 'manual') {
        writeStoredCart(emptyCart);
        router.push(`/order-success/${data.order.id}`);
        return;
      }
      if (!data.razorpay) throw new Error('The payment response is incomplete.');
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
        prefill: { name: shipping.fullName, email, contact: canonicalDeliveryPhone },
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

  return <>
    <main className="min-h-screen bg-ivory px-4 pb-24 pt-32 text-charcoal sm:px-8 lg:px-12">
      <StickyHeader />
      <div className="mx-auto max-w-6xl">
        <Link href="/bag" className="inline-flex items-center gap-2 text-[0.6rem] uppercase tracking-[0.24em] text-charcoal/55 transition hover:text-gold">
          <ArrowLeft size={13} /> Back to bag
        </Link>
        <div className="mt-8 border-b border-black/12 pb-8 dark:border-white/15">
          <div className="flex items-center justify-between gap-5">
            <div>
              <p className="text-[0.58rem] uppercase tracking-[0.35em] text-gold">Checkout</p>
              <h1 className="mt-3 font-display text-5xl sm:text-6xl">Make it yours.</h1>
            </div>
            <LockKeyhole className="text-gold" size={24} strokeWidth={1.2} />
          </div>
          {testMode && razorpayEnabled ? <span className="mt-5 inline-flex rounded-full border border-gold/50 px-3 py-1 text-[0.55rem] uppercase tracking-[0.2em] text-gold">Test mode</span> : null}
        </div>
        {message ? <p role="alert" className="mt-6 border border-gold/35 bg-gold/5 px-4 py-3 text-sm text-charcoal/75">{message}</p> : null}

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_22rem]">
          <section className="space-y-8">
            <div className="border border-black/10 p-6 dark:border-white/15 sm:p-8">
              <div className="flex items-center gap-3">
                <ShoppingBag size={18} className="text-gold" strokeWidth={1.25} />
                <h2 className="font-display text-3xl">Contact and delivery</h2>
              </div>
              <p className="mt-2 text-sm text-charcoal/55">{email}</p>
              {addresses.length ? <label className="mt-7 block">
                <span className="text-[0.58rem] uppercase tracking-[0.24em] text-charcoal/50">Use a saved address</span>
                <select value={selectedAddressId} onChange={event => selectShippingAddress(event.target.value)} className="mt-3 w-full border-b border-black/15 bg-transparent py-3 text-sm outline-none dark:border-white/15">
                  <option value="">Enter a new address</option>
                  {addresses.map(address => <option key={address.id} value={address.id}>{address.label || address.fullName} · {address.city}</option>)}
                </select>
              </label> : null}

              <div className="mt-8 grid gap-7 sm:grid-cols-2">
                <Field label="Full name" value={shipping.fullName} onChange={value => updateShipping('fullName', value)} />
                <div><InternationalPhone label="Delivery phone · required" numberLabel="Phone · required" value={shipping.phone} country={deliveryPhoneCountry} onChange={updateDeliveryPhone} />{deliveryPhoneError ? <p role="alert" className="mt-2 text-xs text-red-800">{deliveryPhoneError}</p> : null}</div>
                <Field label="Address line 1" value={shipping.line1} onChange={value => updateShipping('line1', value)} />
                <Field label="Address line 2" value={shipping.line2 || ''} onChange={value => updateShipping('line2', value)} required={false} />
                <Field label="City" value={shipping.city} onChange={value => updateShipping('city', value)} />
                <Field label="State" value={shipping.state} onChange={value => updateShipping('state', value)} />
                <Field label="Postal code" value={shipping.postalCode} onChange={value => updateShipping('postalCode', value)} />
                <div><span className="text-[0.58rem] uppercase tracking-[0.24em] text-charcoal/50">Country · required</span><CountrySelector label="Delivery country" country={addressCountryCode(shipping.country)} onChange={updateDeliveryCountry} callingCode={false} /></div>
              </div>

              <div className="mt-7 border-t border-black/10 pt-5 dark:border-white/10">
                {collectionMode === 'onboarding' ? <div className="text-xs leading-6 text-charcoal/70"><p>{savedRecipientConsent ? 'Order updates may use your saved WhatsApp permission for this number, subject to the store-configured channels and delivery availability.' : 'Order updates use the store-configured available channels. WhatsApp requires your separate permission; changing permissions does not change delivery routing.'}</p><Link href="/account/profile#communication-preferences" className="mt-2 inline-block text-gold underline">Manage WhatsApp permissions</Link></div> : <>
                {!savedRecipientConsent ? <label className="flex items-start gap-3 text-xs leading-5 text-charcoal/70 dark:text-ivory/75">
                  <input
                    ref={consentCheckboxRef}
                    type="checkbox"
                    checked={whatsappTransactionalConsent}
                    required={requireWhatsappConsentForCheckout}
                    disabled={!profileReady || !storefrontSettingsReady}
                    aria-invalid={Boolean(whatsappConsentError)}
                    aria-describedby={whatsappConsentError ? 'whatsapp-consent-error' : undefined}
                    onChange={event => { setConsentRecipient(event.target.checked ? selectedWhatsapp : null); setWhatsappConsentError(''); if (!event.target.checked) setWhatsappPhoneError(''); }}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#b58a4c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-50"
                  />
                  <span>Keep me updated on WhatsApp about this order, including order confirmation, payment, shipping and delivery updates.</span>
                </label> : <p className="text-xs leading-5 text-charcoal/70">WhatsApp updates are enabled for your saved number.</p>}
                {whatsappConsentError ? <p id="whatsapp-consent-error" role="alert" className="mt-2 pl-7 text-xs leading-5 text-red-800 dark:text-red-200">{whatsappConsentError}</p> : null}
                <div className="mt-4 max-w-lg">
                  <label className="flex items-start gap-3 text-xs leading-5 text-charcoal/70 dark:text-ivory/75">
                    <input type="checkbox" checked={sameAsContactPhone} onChange={event => toggleContactPhone(event.target.checked)}
                      disabled={!profileReady || !storefrontSettingsReady} aria-describedby="same-contact-phone-help"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[#b58a4c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-50" />
                    <span>Same as contact phone</span>
                  </label>
                  <p id="same-contact-phone-help" className="mb-4 mt-1 pl-7 text-xs leading-5 text-charcoal/55">Use the phone number entered in your delivery details for WhatsApp updates.</p>
                  <InternationalPhone
                    value={displayedWhatsappNumber}
                    country={displayedWhatsappCountry}
                    label="WhatsApp number for this order"
                    inputRef={whatsappPhoneInputRef}
                    disabled={!profileReady || !storefrontSettingsReady}
                    onChange={updateWhatsappNumber}
                  />
                  {sameAsContactPhone && contactWhatsapp ? <p className="mt-2 text-xs leading-5 text-charcoal/60">Using delivery contact number: {contactWhatsapp.recipient}. Editing the WhatsApp number unlinks it.</p> : null}
                  {whatsappPhoneError || (sameAsContactPhone && !contactWhatsapp && whatsappTransactionalConsent) ? <p role="alert" className="mt-2 text-xs leading-5 text-red-800 dark:text-red-200">{sameAsContactPhone && !contactWhatsapp ? 'Enter a valid delivery contact phone number for its selected calling code, or enter a separate WhatsApp number.' : whatsappPhoneError}</p> : null}
                </div>
                </>}
              </div>
            </div>
          </section>

          <aside className="h-fit border border-black/10 p-6 dark:border-white/15 sm:p-8">
            <p className="text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/50">Order summary</p>
            <div className="mt-6 space-y-5">{cart.items.map(item => <CheckoutItemSummary key={`${item.productId}:${item.variantId}:${item.size || ''}`} item={item} />)}</div>
            <div className="mt-6 flex justify-between border-b border-black/10 pb-5 text-sm dark:border-white/10"><span>Subtotal</span><span>{inr.format(subtotal)}</span></div>
            <div className="mt-4 flex justify-between text-base"><span>Total</span><span>{inr.format(total)}</span></div>
            <p className="mt-5 text-xs leading-6 text-charcoal/55">{razorpayEnabled ? 'Shipping and final order details are confirmed by the RK team. Razorpay will open securely for payment.' : 'Your order will be reviewed by our team. We will contact you about availability and payment. Please wait for payment instructions.'}</p>
            <button type="button" disabled={busy || !cart.items.length || !storefrontSettingsReady || !profileReady} onClick={pay} className="mt-7 flex w-full items-center justify-center gap-3 bg-ink px-5 py-4 text-[0.6rem] uppercase tracking-[0.25em] text-ivory transition hover:bg-gold hover:text-ink disabled:cursor-not-allowed disabled:opacity-45">
              {busy ? (razorpayEnabled ? 'Opening secure payment…' : 'Placing order…') : razorpayEnabled ? <>Pay {inr.format(total)} <Check size={14} /></> : <>Place order <Check size={14} /></>}
            </button>
          </aside>
        </div>
      </div>
    </main>
  </>;
}
