import { getCountries, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

export const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const telephoneCountries = getCountries().sort((a, b) => (countryNames.of(a) || a).localeCompare(countryNames.of(b) || b));

/** Saved addresses retain names or ISO codes; unknown values never imply India. */
export function addressCountryCode(value: string): CountryCode | undefined {
  const normalized = value.trim().toLocaleLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ');
  const aliases: Record<string, CountryCode> = { uk: 'GB', 'great britain': 'GB', britain: 'GB', usa: 'US', 'united states of america': 'US' };
  return aliases[normalized] || telephoneCountries.find(code => code.toLowerCase() === normalized || countryNames.of(code)?.toLowerCase() === normalized);
}

export function addressPhoneParts(value: string, addressCountry: string) {
  const international = internationalPhoneParts(value);
  if (international) return international;
  const country = addressCountryCode(addressCountry);
  const recipient = country ? canonicalPhone(value, country) : '';
  return recipient ? internationalPhoneParts(recipient) : null;
}

export function canonicalPhone(value: string, country?: CountryCode): string {
  if (!/^\+?[0-9 ().-]{6,40}$/.test(value.trim())) return '';
  const parsed = parsePhoneNumberFromString(value.trim(), country);
  return parsed?.isValid() && !parsed.ext && (!country || parsed.country === country) ? parsed.number : '';
}

/** Contact fields must include an international prefix; never infer a country. */
export function internationalPhoneParts(value: string) {
  const recipient = canonicalPhone(value);
  const parsed = recipient ? parsePhoneNumberFromString(recipient) : undefined;
  if (!parsed?.country) return null;
  return { recipient, country: parsed.country, callingCode: parsed.countryCallingCode, nationalNumber: String(parsed.nationalNumber) };
}

/** Only unambiguous saved regions supply a default; explicit phone metadata wins. */
export function profileContactCountry(storedCountry?: string | null, savedRegion?: string | null) {
  if (storedCountry?.trim()) return addressCountryCode(storedCountry);
  return savedRegion === 'asia-india' ? 'IN' as CountryCode : savedRegion === 'us' ? 'US' as CountryCode : undefined;
}

export function profileContactPhoneParts(value: string, storedCountry?: string | null, savedRegion?: string | null) {
  const input = value.trim().replace(/^00/, '+');
  const country = profileContactCountry(storedCountry, savedRegion);
  return internationalPhoneParts(canonicalPhone(input, input.startsWith('+') ? undefined : country));
}
