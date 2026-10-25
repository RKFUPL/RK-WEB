import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('product cards and product detail use the requested tax wording', () => {
  const row = read('../components/commerce/price-currency-row.tsx');
  assert.match(row, /Incl\. of all taxes/);
  assert.match(read('../components/collections/collection-product-card.tsx'), /<PriceCurrencyRow/);
  assert.match(read('../components/products/product-detail-page.tsx'), /<PriceCurrencyRow/);
});

test('product gallery zoom stays restrained and inline with outside and Escape dismissal', () => {
  const source = read('../components/products/product-detail-page.tsx');
  assert.match(source, /Zoom product image inline/);
  assert.match(source, /Back to image/);
  assert.match(source, /scale-\[1\.7\]/);
  assert.match(source, /document\.addEventListener\(["']pointerdown["'], dismissOutside\)/);
  assert.match(source, /document\.addEventListener\(["']keydown["'], dismissOnEscape\)/);
  assert.doesNotMatch(source, /scale-\[(?:1\.15|2\.25)\]/);
  assert.doesNotMatch(source, /aria-modal="true"[\s\S]{0,500}Product image gallery/);
});

test('header has no currency selector and price surfaces share the compact control', () => {
  const source = read('../components/home/sticky-header.tsx');
  assert.doesNotMatch(source, /CurrencySelector|Display currency/);
  const row = read('../components/commerce/price-currency-row.tsx');
  assert.match(row, /useCurrency\(\)/);
  assert.match(row, /event\.stopPropagation\(\)/);
  assert.match(row, /h-full w-full cursor-pointer/);
  assert.match(row, /pointer-events-none/);
});

test('raw forex details are admin-only while storefront conversion remains available', () => {
  const header = read('../components/home/sticky-header.tsx');
  const provider = read('../components/commerce/currency-provider.tsx');
  const admin = read('../components/admin/admin-settings.tsx');
  assert.doesNotMatch(header, /ForexTicker|1 INR|rateSource|ratesAsOf/);
  assert.match(provider, /api\/catalog\/currency-context/);
  assert.match(provider, /formatDisplayPrice/);
  assert.doesNotMatch(provider, /rateSource|rateType|ratesAsOf/);
  assert.match(admin, /api\/admin\/forex/);
  assert.match(admin, /1 INR =/);
  assert.match(admin, /Last successful update/);
  assert.match(admin, /Active provider/);
});

test('product photography containers do not add decorative frames', () => {
  const detail = read('../components/products/product-detail-page.tsx');
  const card = read('../components/collections/collection-product-card.tsx');
  assert.match(detail, /max-w-\[35rem\] overflow-hidden rounded-lg/);
  assert.match(card, /aspect-\[3\/4\] overflow-hidden rounded-lg/);
  assert.doesNotMatch(detail, /max-w-\[35rem\][^\n]*shadow/);
  assert.doesNotMatch(card, /aspect-\[3\/4\][^\n]*shadow/);
});

test('product detail exposes one compact zoom toggle and touch panning capture', () => {
  const source = read('../components/products/product-detail-page.tsx');
  assert.equal((source.match(/Zoom in on product image/g) || []).length, 1);
  assert.match(source, /Back to normal product image/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /releasePointerCapture/);
  assert.match(source, /bg-ink\/70/);
});
