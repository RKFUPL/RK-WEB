import { useEffect, useState } from 'react';
import { apiBaseUrl } from './rbac';

export function productWhatsappHref(phone: string, name: string, url: string) {
  const digits = phone.replace(/[\s()+-]/g, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) return '';
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Hi! Could you help me with ${name}?\n${url}`)}`;
}

export function useProductWhatsapp() {
  const [phone, setPhone] = useState('');
  useEffect(() => {
    let active = true;
    fetch(`${apiBaseUrl}/api/storefront-settings`, { cache: 'no-store' })
      .then(async response => response.ok ? response.json() : null)
      .then(payload => { if (active) setPhone(typeof payload?.settings?.whatsappNumber === 'string' ? payload.settings.whatsappNumber : ''); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  return phone;
}
