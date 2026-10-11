import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shop = readFileSync(new URL('../app/shop/page.tsx', import.meta.url), 'utf8');
const header = readFileSync(new URL('../components/home/sticky-header.tsx', import.meta.url), 'utf8');

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
});

test('shop is reachable from desktop and mobile navigation', () => {
  assert.match(header, /label: 'Shop', href: '\/shop'/);
  assert.match(header, /href="\/shop"/);
});
