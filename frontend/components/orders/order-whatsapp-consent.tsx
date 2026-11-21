'use client';

import { useState } from 'react';
import { type CountryCode } from 'libphonenumber-js/max';
import { InternationalPhone } from '@/components/commerce/international-phone';
import { canonicalPhone } from '@/lib/phone-number';
import { whatsappConsentText } from '@/lib/whatsapp-consent';
import { apiBaseUrl } from '@/lib/rbac';
import type { Order } from '@/lib/orders';

export function OrderWhatsAppConsent({ order, onUpdated }: { order: Order; onUpdated: (order: Order) => void }) {
  const [alternate, setAlternate] = useState(!order.whatsappUpdates?.number);
  const [number, setNumber] = useState('');
  const [country, setCountry] = useState<CountryCode>('IN');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = alternate ? canonicalPhone(number, country) : order.whatsappUpdates?.number;

  return <section className="mt-8 border border-black/10 p-6 text-left dark:border-white/15 sm:p-8" aria-label="Transactional WhatsApp updates">
    <h2 className="font-display text-2xl">Transactional WhatsApp updates</h2>
    {order.whatsappUpdates?.enabled ? <p className="mt-3 text-sm text-charcoal/65">Transactional WhatsApp updates are enabled for this order at {order.whatsappUpdates.number}. You can withdraw consent in your account preferences.</p> : <>
      <p className="mt-3 text-sm leading-6 text-charcoal/65">Enable transactional WhatsApp updates for future events on this order. Earlier messages will not be replayed.</p>
      {order.whatsappUpdates?.number && <p className="mt-4 text-sm">Registered WhatsApp number: {order.whatsappUpdates.number}</p>}
      {order.whatsappUpdates?.number && <label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={alternate} onChange={event => { setAlternate(event.target.checked); setAgreed(false); }} />Use another WhatsApp number for this order</label>}
      {alternate && <div className="mt-5"><InternationalPhone value={number} country={country} onChange={(value, code) => { setNumber(value); setCountry(code); setAgreed(false); }} /></div>}
      <label className="mt-5 flex items-start gap-3 text-sm leading-6"><input type="checkbox" required checked={agreed} onChange={event => setAgreed(event.target.checked)} className="mt-1" />{whatsappConsentText}</label>
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <button type="button" disabled={busy || !agreed} className="mt-5 border border-charcoal px-5 py-3 text-xs uppercase tracking-[0.15em] transition hover:border-gold hover:text-gold disabled:opacity-45" onClick={async () => {
        if (!selected) { setError('Enter a valid WhatsApp number with its country code.'); return; }
        setBusy(true); setError('');
        try {
          const token = window.localStorage.getItem('rk_access_token') || '';
          const response = await fetch(`${apiBaseUrl}/api/orders/${order.id}/whatsapp-consent`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ whatsappTransactionalConsent: true, whatsappRecipient: selected }) });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || 'Unable to enable WhatsApp updates.');
          onUpdated(payload.order as Order);
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to enable WhatsApp updates.'); }
        finally { setBusy(false); }
      }}>{busy ? 'Saving...' : 'Enable Transactional WhatsApp Updates for This Order'}</button>
    </>}
  </section>;
}
