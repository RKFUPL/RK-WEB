'use client';

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { getCountryCallingCode, type CountryCode } from 'libphonenumber-js/max';
import { countryNames, telephoneCountries as countries } from '@/lib/phone-number';

const flag = (code: string) => String.fromCodePoint(...[...code].map(letter => 127397 + letter.charCodeAt(0)));
const phoneControl = 'w-full rounded-none border-b border-black/15 bg-transparent py-3 text-sm outline-none transition-colors duration-200 hover:border-gold/60 focus:border-gold focus-visible:ring-1 focus-visible:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-50 read-only:cursor-default read-only:text-charcoal/60 dark:border-white/20 dark:focus:border-gold motion-reduce:transition-none';

export function CountrySelector({ country, onChange, label = 'Country and dialling code', disabled = false, callingCode = true }: {
  country?: CountryCode; onChange: (country: CountryCode) => void; label?: string; disabled?: boolean; callingCode?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 240 });
  const selector = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const countryLabel = (code: CountryCode) => `${flag(code)} ${countryNames.of(code)}${callingCode ? ` (+${getCountryCallingCode(code)})` : ''}`;
  const query = search.trim().toLowerCase();
  const exactMatch = (code: CountryCode) => [countryNames.of(code)?.toLowerCase(), code.toLowerCase(), `+${getCountryCallingCode(code)}`, getCountryCallingCode(code)].includes(query);
  const filtered = countries.filter(code => `${countryNames.of(code)} ${code} +${getCountryCallingCode(code)}`.toLowerCase().includes(query))
    .sort((a, b) => Number(!exactMatch(a)) - Number(!exactMatch(b)));
  const expanded = open && !disabled;
  const close = () => { setOpen(false); setSearch(''); };
  const show = () => {
    setSearch(''); setActive(country ? Math.max(0, countries.indexOf(country)) : 0); setOpen(true);
  };
  const choose = (code: CountryCode) => {
    onChange(code);
    selector.current?.focus();
    close();
  };
  useEffect(() => {
    if (!expanded) return;
    const place = () => {
      const rect = selector.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const height = Math.min(240, Math.max(below >= 160 ? below : rect.top - 12, 80));
      setPosition({ left: rect.left, top: below >= 160 ? rect.bottom + 4 : Math.max(8, rect.top - height - 4), width: rect.width, maxHeight: height });
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!selector.current?.parentElement?.contains(target) && !list.current?.contains(target)) {
        setOpen(false); setSearch('');
      }
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [expanded]);
  useEffect(() => {
    if (expanded) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, expanded, id]);
  return <>
    <div className="relative">
      <label className="sr-only" htmlFor={`${id}-country`}>{label}</label>
      <input ref={selector} id={`${id}-country`} role="combobox" type="text" autoComplete="off" spellCheck={false}
        aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? `${id}-countries` : undefined}
        aria-activedescendant={expanded && filtered[active] ? `${id}-option-${active}` : undefined}
        disabled={disabled} value={expanded ? search : country ? countryLabel(country) : ''} className={`${phoneControl} pr-8`}
        onFocus={show} onClick={() => { if (!expanded) show(); }}
        onBlur={event => { if (!list.current?.contains(event.relatedTarget as Node)) close(); }}
        onChange={event => { setSearch(event.target.value); setActive(0); setOpen(true); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); close(); }
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!expanded) { show(); return; }
            setActive(index => filtered.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length : 0);
          } else if (event.key === 'Enter' && expanded) {
            event.preventDefault(); if (filtered[active]) choose(filtered[active]);
          } else if (event.key === 'Tab') close();
          else if (!expanded && !event.ctrlKey && !event.metaKey && !event.altKey
            && (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete')) {
            event.preventDefault(); setSearch(event.key.length === 1 ? event.key : ''); setActive(0); setOpen(true);
          }
        }} />
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal/60" />
    </div>
    {expanded && createPortal(<div ref={list} id={`${id}-countries`} role="listbox" aria-label="Telephone countries"
      style={{ position: 'fixed', ...position }}
      className="z-[200] overflow-y-auto overscroll-contain border border-gold/25 bg-ivory py-1 text-sm text-charcoal shadow-lg dark:bg-[#121317] dark:text-white">
      {filtered.map((code, index) => <button key={code} type="button" role="option" tabIndex={-1}
        id={`${id}-option-${index}`} aria-selected={code === country}
        className={`block w-full px-3 py-2 text-left outline-none hover:bg-gold/10 focus-visible:ring-1 focus-visible:ring-gold ${index === active ? 'bg-gold/10' : ''}`}
        onMouseDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(code)}>
        {countryLabel(code)}
      </button>)}
      {!filtered.length && <p role="status" className="px-3 py-2 text-charcoal/70">No matching countries</p>}
    </div>, document.body)}
  </>;
}

export function InternationalPhone({ value, country, onChange, label = 'WhatsApp number', disabled = false, inputRef, numberLabel = 'Mobile number' }: {
  value: string; country: CountryCode; onChange: (value: string, country: CountryCode) => void; label?: string; disabled?: boolean; inputRef?: RefObject<HTMLInputElement | null>; numberLabel?: string;
}) {
  const id = useId();
  return <fieldset disabled={disabled} className="space-y-3 text-xs normal-case tracking-normal">
    <legend className="mb-3 text-xs text-charcoal/70">{label}</legend>
    <CountrySelector country={country} disabled={disabled} onChange={code => onChange('', code)} />
    <label className="block" htmlFor={`${id}-number`}>{numberLabel}</label>
    <input ref={inputRef} id={`${id}-number`} type="tel" inputMode="tel" autoComplete="tel-national" value={value} onChange={event => onChange(event.target.value, country)} className={phoneControl} />
  </fieldset>;
}
