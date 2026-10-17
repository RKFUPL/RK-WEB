export const supportedCurrencies = [
  { code: 'INR', symbol: '₹', label: 'INR · Indian Rupee' },
  { code: 'USD', symbol: '$', label: 'USD · US Dollar' },
  { code: 'EUR', symbol: '€', label: 'EUR · Euro' },
  { code: 'AED', symbol: 'د.إ', label: 'AED · UAE Dirham' },
  { code: 'GBP', symbol: '£', label: 'GBP · British Pound' },
] as const;
export type DisplayCurrency = typeof supportedCurrencies[number]['code'];
export const currencyStorageKey = 'rk_display_currency';
export const supportedCurrencyCodes = supportedCurrencies.map(({ code }) => code);
export function isDisplayCurrency(value: unknown): value is DisplayCurrency {
  return supportedCurrencyCodes.includes(value as DisplayCurrency);
}
export function initialDisplayCurrency(saved: unknown, detected: unknown): DisplayCurrency {
  if (isDisplayCurrency(saved)) return saved;
  return isDisplayCurrency(detected) ? detected : 'INR';
}
export function formatDisplayPrice(amountInr: number | undefined, currency: DisplayCurrency, rates: Partial<Record<DisplayCurrency, number>>) {
  if (amountInr === undefined) return 'Price on request';
  const value = currency === 'INR' ? amountInr : amountInr * (rates[currency] || 0) * 1.1;
  if (!Number.isFinite(value) || value <= 0) return `₹${Math.round(amountInr).toLocaleString('en-IN')}`;
  const locale = currency === 'INR' ? 'en-IN' : currency === 'EUR' ? 'en-IE' : currency === 'AED' ? 'en-AE' : currency === 'GBP' ? 'en-GB' : 'en-US';
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}
