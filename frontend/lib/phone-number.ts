import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

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
