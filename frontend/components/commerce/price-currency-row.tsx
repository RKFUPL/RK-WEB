'use client';

import { ChevronDown } from 'lucide-react';
import { useCurrency } from '@/components/commerce/currency-provider';
import { supportedCurrencies, type DisplayCurrency } from '@/lib/currency';

export function PriceCurrencyRow({ amount, className = '' }: { amount?: number; className?: string }) {
  const { currency, setCurrency, formatPrice } = useCurrency();
  if (amount === undefined) return <p className={className}>Price on request</p>;

  return (
    <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-2 ${className}`}>
      <span>{formatPrice(amount)}</span>
      <label onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} className="relative inline-flex h-8 w-[4.35rem] shrink-0 items-center rounded-full border border-charcoal/15 text-[0.5rem] uppercase tracking-[0.12em] text-charcoal/65 transition focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
        <span className="sr-only">Display currency</span>
        <select aria-label="Display currency" value={currency} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); setCurrency(event.target.value as DisplayCurrency); }} className="h-full w-full cursor-pointer appearance-none rounded-full bg-transparent py-0 pl-2.5 pr-6 outline-none">
          {supportedCurrencies.map((item) => <option key={item.code} value={item.code}>{item.code}</option>)}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2" />
      </label>
      <span className="text-[0.5rem] uppercase tracking-[0.14em] text-charcoal/42">Incl. of all taxes</span>
    </div>
  );
}
