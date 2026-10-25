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
const displayFractionDigits: Partial<Record<DisplayCurrency, number>> = { INR: 0, USD: 0, EUR: 0, AED: 0, GBP: 0 };
export function fractionDigitsForDisplay(currency: string) {
  return displayFractionDigits[currency as DisplayCurrency] ?? 2;
}
export function effectivePricingRate(rate: number) {
  return Math.ceil(rate * 1000) / 1000;
}
export function isDisplayCurrency(value: unknown): value is DisplayCurrency {
  return supportedCurrencyCodes.includes(value as DisplayCurrency);
}
export function initialDisplayCurrency(saved: unknown, detected: unknown): DisplayCurrency {
  if (isDisplayCurrency(saved)) return saved;
  return isDisplayCurrency(detected) ? detected : 'INR';
}
export function formatDisplayPrice(amountInr: number | undefined, currency: DisplayCurrency, rates: Partial<Record<DisplayCurrency, number>>) {
  if (amountInr === undefined) return 'Price on request';
  const value = currency === 'INR' ? amountInr : amountInr * effectivePricingRate(rates[currency] || 0) * 1.1;
  if (!Number.isFinite(value) || value <= 0) return `₹${Math.round(amountInr).toLocaleString('en-IN')}`;
  const locale = currency === 'INR' ? 'en-IN' : currency === 'EUR' ? 'en-IE' : currency === 'AED' ? 'en-AE' : currency === 'GBP' ? 'en-GB' : 'en-US';
  const fractionDigits = fractionDigitsForDisplay(currency);
  const displayedValue = fractionDigits === 0 ? Math.round(value) : value;
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(displayedValue);
}
