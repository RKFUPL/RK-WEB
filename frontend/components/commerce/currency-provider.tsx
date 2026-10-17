'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { currencyStorageKey, formatDisplayPrice, initialDisplayCurrency, isDisplayCurrency, type DisplayCurrency } from '@/lib/currency';
type RateStatus = 'loading' | 'live' | 'stale' | 'configured_fallback' | 'unavailable';
type CurrencyContextValue = { currency: DisplayCurrency; rates: Partial<Record<DisplayCurrency, number>>; setCurrency: (currency: DisplayCurrency) => void; formatPrice: (amount?: number) => string; conversionReady: boolean; rateStatus: RateStatus; ratesAsOf: string | null; rateSource: string | null; rateType: string | null };
const CurrencyContext = createContext<CurrencyContextValue | null>(null);
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<DisplayCurrency>('INR');
  const [rates, setRates] = useState<Partial<Record<DisplayCurrency, number>>>({ INR: 1 });
  const [rateStatus, setRateStatus] = useState<RateStatus>('loading');
  const [ratesAsOf, setRatesAsOf] = useState<string | null>(null);
  const [rateSource, setRateSource] = useState<string | null>(null);
  const [rateType, setRateType] = useState<string | null>(null);
  useEffect(() => {
    const saved = window.localStorage.getItem(currencyStorageKey);
    if (isDisplayCurrency(saved)) setCurrencyState(saved);
    const loadRates = () => fetch('/api/catalog/currency-context', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!payload) { setRateStatus('unavailable'); return; }
        if (payload.rates) setRates({ INR: 1, ...payload.rates });
        setRateStatus(payload.rateStatus || 'unavailable');
        setRatesAsOf(payload.ratesAsOf || null);
        setRateSource(payload.source || null);
        setRateType(payload.rateType || null);
        if (!saved) setCurrencyState(initialDisplayCurrency(null, payload.detectedCurrency));
      })
      .catch(() => setRateStatus('unavailable'));
    void loadRates();
    const refresh = window.setInterval(() => { void loadRates(); }, 6 * 60 * 60 * 1000);
    return () => window.clearInterval(refresh);
  }, []);
  const value = useMemo(() => ({ currency, rates, setCurrency: (next: DisplayCurrency) => { setCurrencyState(next); window.localStorage.setItem(currencyStorageKey, next); }, formatPrice: (amount?: number) => formatDisplayPrice(amount, currency, rates), conversionReady: currency === 'INR' || Boolean(rates[currency]), rateStatus, ratesAsOf, rateSource, rateType }), [currency, rates, rateStatus, ratesAsOf, rateSource, rateType]);
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}
export function useCurrency() { const value = useContext(CurrencyContext); if (!value) throw new Error('useCurrency must be used inside CurrencyProvider'); return value; }
