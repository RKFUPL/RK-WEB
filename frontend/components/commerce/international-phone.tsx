'use client';

import { useId, useState } from 'react';
import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js/max';

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countries = getCountries().sort((a, b) => (countryNames.of(a) || a).localeCompare(countryNames.of(b) || b));
const flag = (code: string) => String.fromCodePoint(...[...code].map(letter => 127397 + letter.charCodeAt(0)));

export function InternationalPhone({ value, country, onChange, label = 'WhatsApp number', disabled = false }: {
  value: string; country: CountryCode; onChange: (value: string, country: CountryCode) => void; label?: string; disabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  const id = useId();
  const filtered = countries.filter(code => code === country || `${countryNames.of(code)} ${code} +${getCountryCallingCode(code)}`.toLowerCase().includes(search.toLowerCase()));
  return <fieldset disabled={disabled} className="space-y-3 text-xs normal-case tracking-normal">
    <legend className="mb-3 text-xs text-charcoal/70">{label}</legend>
    <label className="block" htmlFor={`${id}-search`}>Search telephone countries</label>
    <input id={`${id}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} className="w-full border-b border-black/15 bg-transparent py-2 text-sm" />
    <label className="block" htmlFor={`${id}-country`}>Country and dialling code</label>
    <select id={`${id}-country`} value={country} onChange={event => onChange('', event.target.value as CountryCode)} className="w-full border-b border-black/15 bg-transparent py-3 text-sm">
      {filtered.map(code => <option key={code} value={code}>{flag(code)} {countryNames.of(code)} (+{getCountryCallingCode(code)})</option>)}
    </select>
    <label className="block" htmlFor={`${id}-number`}>Mobile number</label>
    <input id={`${id}-number`} type="tel" inputMode="tel" autoComplete="tel-national" value={value} onChange={event => onChange(event.target.value, country)} className="w-full border-b border-black/15 bg-transparent py-3 text-sm" />
  </fieldset>;
}
