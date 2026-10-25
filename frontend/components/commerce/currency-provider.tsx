'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { currencyStorageKey, formatDisplayPrice, initialDisplayCurrency, isDisplayCurrency, type DisplayCurrency } from '@/lib/currency';
type CurrencyContextValue = { currency: DisplayCurrency; rates: Partial<Record<DisplayCurrency, number>>; setCurrency: (currency: DisplayCurrency) => void; formatPrice: (amount?: number) => string; conversionReady: boolean };
const CurrencyContext = createContext<CurrencyContextValue | null>(null);
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<DisplayCurrency>('INR');
  const [rates, setRates] = useState<Partial<Record<DisplayCurrency, number>>>({ INR: 1 });
  useEffect(() => {
    const saved = window.localStorage.getItem(currencyStorageKey);
    if (isDisplayCurrency(saved)) setCurrencyState(saved);
    const loadRates = () => fetch('/api/catalog/currency-context', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!payload) return;
        if (payload.rates) setRates({ INR: 1, ...payload.rates });
        if (!saved) setCurrencyState(initialDisplayCurrency(null, payload.detectedCurrency));
      })
      .catch(() => undefined);
    void loadRates();
    const refresh = window.setInterval(() => { void loadRates(); }, 6 * 60 * 60 * 1000);
    return () => window.clearInterval(refresh);
  }, []);
  const value = useMemo(() => ({ currency, rates, setCurrency: (next: DisplayCurrency) => { setCurrencyState(next); window.localStorage.setItem(currencyStorageKey, next); }, formatPrice: (amount?: number) => formatDisplayPrice(amount, currency, rates), conversionReady: currency === 'INR' || Boolean(rates[currency]) }), [currency, rates]);
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}
export function useCurrency() { const value = useContext(CurrencyContext); if (!value) throw new Error('useCurrency must be used inside CurrencyProvider'); return value; }
