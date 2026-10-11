import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { legalIdentity } from './legal-identity.ts';
import { verifiedShippingPolicy } from './shipping-timeline.ts';

const source = readFileSync(new URL('./legal-content.ts', import.meta.url), 'utf8');
const legalPageSource = readFileSync(new URL('../components/site/legal-page.tsx', import.meta.url), 'utf8');
const contentsNavSource = readFileSync(new URL('../components/site/legal-contents-nav.tsx', import.meta.url), 'utf8');
const termsSource = source.slice(source.indexOf("terms: { title: 'Terms & Conditions'"), source.indexOf("shippingDelivery: {"));
const termsTitles = [...termsSource.matchAll(/^\s{4}\['([^']+)',/gm)].map((match) => match[1]);

test('Terms retain all 32 sections in their established order', () => {
  assert.deepEqual(termsTitles, [
    'About Rashi Kapoor', 'Eligibility', 'Product Information', 'Pricing', 'Price Match', 'Order Placement',
    'Ready-to-Wear & Made-to-Order Production', 'Customisation', 'Custom-Made & Bespoke Products',
    'Measurements & Fitting', 'Cancellation by Customer', 'Cancellation by Rashi Kapoor', 'Returns & Exchanges',
    'Defective, Damaged or Incorrect Products', 'Alterations', 'Payment', 'Shipping & Delivery',
    'International Orders', 'Customs & Import Requirements', 'Delivery Address', 'Split Shipments', 'Force Majeure',
    'Intellectual Property', 'Website Use', 'Third-Party Services', 'Limitation of Liability', 'Indemnity', 'Privacy',
    'Changes to Terms', 'Governing Law', 'Grievance Redressal', 'Contact',
  ]);
});

test('verified company identity and operational timelines are published consistently', () => {
  assert.equal(legalIdentity.companyName, 'Rashi Kapoor Fashion Unicus Pvt. Ltd.');
  assert.equal(legalIdentity.customerCareEmail, 'contact@rashikapoorofficial.com');
  assert.equal(legalIdentity.customerCarePhone, '+91 88795 97878');
  assert.equal(legalIdentity.gstin, '27AANCR3318J1Z2');
  assert.equal(legalIdentity.cin, 'U46419MH2024PTC418216');
  assert.equal(verifiedShippingPolicy.readyToWear.estimate, '3–4 weeks');
  assert.equal(verifiedShippingPolicy.madeToOrder.estimate, '7–8 weeks');
  assert.match(source, /not guaranteed final delivery dates/);
});

test('unverified legal fields remain tracked rather than being inferred from business locations', () => {
  assert.equal(legalIdentity.registeredOffice, '[PENDING COMPANY CONFIRMATION]');
  assert.equal(legalIdentity.governingJurisdiction, '[PENDING COMPANY CONFIRMATION]');
  assert.equal(legalIdentity.grievanceWorkingHours, '[PENDING COMPANY CONFIRMATION]');
  assert.equal(legalIdentity.businessLocations.length, 2);
});

test('public policy copy omits drafting instructions and unresolved placeholder values', () => {
  assert.doesNotMatch(source, /confirm the applicable provider before launch/i);
  assert.doesNotMatch(source, /before publication/i);
  assert.doesNotMatch(source, /Information about .* is being prepared/i);
  assert.match(source, /legalPublicationGaps/);
  assert.doesNotMatch(termsSource, /registeredOffice|governingJurisdiction|grievanceWorkingHours/);
});

test('legacy legal URLs redirect to the correct canonical policy pages', () => {
  const app = new URL('../app/', import.meta.url);
  assert.match(readFileSync(new URL('terms-and-conditions/page.tsx', app), 'utf8'), /redirect\('\/terms'\)/);
  assert.match(readFileSync(new URL('privacy/page.tsx', app), 'utf8'), /redirect\('\/privacy-policy'\)/);
  assert.match(readFileSync(new URL('shipping/page.tsx', app), 'utf8'), /redirect\('\/shipping-returns'\)/);
});

test('policy pages preserve ordered section anchors and responsive contents navigation', () => {
  assert.match(legalPageSource, /id=\{`section-\$\{index \+ 1\}`\}/);
  assert.match(legalPageSource, /<LegalContentsNav sections=\{sections\} mobile \/>/);
  assert.match(legalPageSource, /md:sticky md:top-28/);
  assert.match(legalPageSource, /scroll-mt-28/);
  assert.match(contentsNavSource, /<details className="legal-contents-mobile">/);
  assert.match(contentsNavSource, /aria-current=\{active \? 'location' : undefined\}/);
});

test('policy anchor navigation respects reduced motion and tracks active sections', () => {
  assert.match(contentsNavSource, /IntersectionObserver/);
  assert.match(contentsNavSource, /prefers-reduced-motion: reduce/);
  assert.match(contentsNavSource, /behavior: reduceMotion \? 'auto' : 'smooth'/);
  assert.match(contentsNavSource, /aria-label="Policy contents"/);
});
