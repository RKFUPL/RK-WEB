'use client';

import { useId, useState, type RefObject } from 'react';
import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js/max';

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countries = getCountries().sort((a, b) => (countryNames.of(a) || a).localeCompare(countryNames.of(b) || b));
const flag = (code: string) => String.fromCodePoint(...[...code].map(letter => 127397 + letter.charCodeAt(0)));
const phoneControl = 'w-full rounded-none border-b border-black/15 bg-transparent py-3 text-sm outline-none transition-colors duration-200 hover:border-gold/60 focus:border-gold focus-visible:ring-1 focus-visible:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-50 read-only:cursor-default read-only:text-charcoal/60 dark:border-white/20 dark:focus:border-gold motion-reduce:transition-none';

export function InternationalPhone({ value, country, onChange, label = 'WhatsApp number', disabled = false, inputRef }: {
  value: string; country: CountryCode; onChange: (value: string, country: CountryCode) => void; label?: string; disabled?: boolean; inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [search, setSearch] = useState('');
  const id = useId();
  const filtered = countries.filter(code => code === country || `${countryNames.of(code)} ${code} +${getCountryCallingCode(code)}`.toLowerCase().includes(search.toLowerCase()));
  return <fieldset disabled={disabled} className="space-y-3 text-xs normal-case tracking-normal">
    <legend className="mb-3 text-xs text-charcoal/70">{label}</legend>
    <label className="block" htmlFor={`${id}-search`}>Search telephone countries</label>
    <input id={`${id}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} className={phoneControl} />
    <label className="block" htmlFor={`${id}-country`}>Country and dialling code</label>
    <select id={`${id}-country`} value={country} onChange={event => onChange('', event.target.value as CountryCode)} className={phoneControl}>
      {filtered.map(code => <option key={code} value={code}>{flag(code)} {countryNames.of(code)} (+{getCountryCallingCode(code)})</option>)}
    </select>
    <label className="block" htmlFor={`${id}-number`}>Mobile number</label>
    <input ref={inputRef} id={`${id}-number`} type="tel" inputMode="tel" autoComplete="tel-national" value={value} onChange={event => onChange(event.target.value, country)} className={phoneControl} />
  </fieldset>;
}
