import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shop = readFileSync(new URL('../app/shop/page.tsx', import.meta.url), 'utf8');
const header = readFileSync(new URL('../components/home/sticky-header.tsx', import.meta.url), 'utf8');
const contactComponents = [
  readFileSync(new URL('../components/aakaar-page.tsx', import.meta.url), 'utf8'),
  readFileSync(new URL('../components/aakaar-collection-page.tsx', import.meta.url), 'utf8'),
].join('\n');

test('shop uses the paginated public catalogue and debounces product search', () => {
  assert.match(shop, /api\/catalog\/products/);
  assert.match(shop, /setTimeout/);
  assert.match(shop, /350/);
  assert.match(shop, /cache: 'no-store'/);
});

test('shop exposes supported filters, deterministic sorts, and distinct states', () => {
  for (const value of ['category', 'colour', 'size', 'collection', 'fabric', 'fulfilment', 'minPrice', 'maxPrice']) assert.match(shop, new RegExp(value));
  for (const value of ['featured', 'newest', 'price_asc', 'price_desc']) assert.match(shop, new RegExp(value));
  assert.match(shop, /The shop could not be loaded/);
  assert.match(shop, /No pieces match this edit/);
  assert.match(shop, /Clear filters/);
  assert.match(shop, /aria-label="Shop pages"/);
  assert.match(shop, /Previous/);
  assert.match(shop, /Next/);
  assert.match(shop, /totalPages/);
  assert.match(shop, /Products per page/);
  assert.match(shop, /pageSize/);
  assert.match(shop, /next\.delete\('page'\)/);
});

test('shop is reachable from desktop and mobile navigation', () => {
  assert.match(header, /label: 'Shop', href: '\/shop'/);
  assert.match(header, /href="\/shop"/);
});

test('application contact links use mailto destinations, not Cloudflare protection paths', () => {
  assert.doesNotMatch(contactComponents, /cdn-cgi|email-protection/);
  assert.match(contactComponents, /mailto:contact@rashikapoorofficial\.com/);
});
