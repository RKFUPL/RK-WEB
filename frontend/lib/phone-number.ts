import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

export function canonicalPhone(value: string, country?: CountryCode): string {
  if (!/^\+?[0-9 ().-]{6,40}$/.test(value.trim())) return '';
  const parsed = parsePhoneNumberFromString(value.trim(), country);
  return parsed?.isValid() && !parsed.ext && (!country || parsed.country === country) ? parsed.number : '';
}
