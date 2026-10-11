import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const detail = readFileSync(new URL('../components/products/product-detail-page.tsx', import.meta.url), 'utf8');

test('product detail renders optional information only from persisted attributes', () => {
  assert.match(detail, /Fabric & Contents/);
  assert.match(detail, /Fit & Measurements/);
  assert.match(detail, /Made to Order & Assistance/);
  assert.match(detail, /attributes\[key\]/);
  assert.match(detail, /fabric \|\| setContents/);
  assert.match(detail, /fit \|\| garmentMeasurements/);
});

test('product detail retains pricing and colour-gallery contracts', () => {
  assert.match(detail, /selectedVariant\?\.price \?\? product\.price/);
  assert.match(detail, /variantMediaSources\(product, selectedVariant\)/);
  assert.match(detail, /setActiveImage\(0\)/);
  assert.match(detail, /SizeChartPopover/);
});
