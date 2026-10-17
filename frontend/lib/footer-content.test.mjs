import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { legalIdentity } from './legal-identity.ts';
import { storefrontSocialLinks } from './storefront-social.ts';

const footer = readFileSync(new URL('../components/home/footer.tsx', import.meta.url), 'utf8');

test('footer preserves the house signature and verified contact identity', () => {
  assert.match(footer, /Fashion is not just what you wear,/);
  assert.match(footer, /it&apos;s a legacy you carry\./);
  assert.match(footer, /sm:whitespace-nowrap/);
  assert.match(footer, /legalIdentity\.customerCareEmail/);
  assert.match(footer, /legalIdentity\.customerCarePhone/);
  assert.equal(legalIdentity.companyName, 'Rashi Kapoor Fashion Unicus Pvt. Ltd.');
  assert.match(footer, /© 2026 \{legalIdentity\.companyName\}/);
  assert.equal((footer.match(/href="\/privacy-policy"/g) || []).length, 1);
  assert.equal((footer.match(/href="\/legal"/g) || []).length, 1);
  assert.equal((footer.match(/href="\/shipping-returns"/g) || []).length, 1);
  assert.equal((footer.match(/className="font-semibold text-gold transition hover:text-ivory"/g) || []).length, 3);
  assert.equal((footer.match(/aria-hidden="true" className="mx-4 text-gold\/45 sm:mx-5">\|<\/span>/g) || []).length, 2);
  assert.match(footer, /className="flex flex-wrap items-center gap-y-2"/);
  assert.doesNotMatch(footer, /title: 'Information'/);
});

test('footer navigation contains only implemented destinations', () => {
  for (const route of ['/shop', '/collections', '/rk-lookbooks', '/runway', '/about', '/sustainability']) {
    assert.match(footer, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.match(footer, /label: 'Made-to-Measure', href: `mailto:\$\{legalIdentity\.customerCareEmail\}\?subject=Made-to-Measure%20Enquiry`/);
  assert.doesNotMatch(footer, /label: 'Made-to-Measure', href: '\/(?:legal|customisation-and-bespoke)'/);
  assert.doesNotMatch(footer, /Book an Appointment/);
  assert.doesNotMatch(footer, /Sizing Assistance/);
  assert.doesNotMatch(footer, /Cookie Preferences/);
});

test('footer uses the approved customer-facing Mumbai location name', () => {
  assert.match(footer, /Mumbai Factory \/ Exhibit/);
  assert.doesNotMatch(footer, /Mumbai Factory and Showroom/);
});

test('footer exposes only the approved social profiles with accessible labels', () => {
  assert.deepEqual(Object.keys(storefrontSocialLinks).sort(), ['instagram', 'linkedin']);
  assert.match(footer, /aria-label="Rashi Kapoor on Instagram"/);
  assert.match(footer, /aria-label="Rashi Kapoor on LinkedIn"/);
});
