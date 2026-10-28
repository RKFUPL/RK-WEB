import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const detail = fs.readFileSync(new URL('../components/products/product-detail-page.tsx', import.meta.url), 'utf8');
const card = fs.readFileSync(new URL('../components/collections/collection-product-card.tsx', import.meta.url), 'utf8');

test('product image viewports and layers share rounded clipping', () => {
  assert.match(detail, /data-testid="product-image-viewport"[^]*className="isolate relative aspect-\[3\/4\][^]*bg-sand"/);
  assert.match(detail, /data-testid="product-image-layer"[^]*className=\{`h-full w-full rounded-lg object-contain/);
  assert.doesNotMatch(detail, /mainImageAspectRatio|setMainImageAspectRatio/);
  assert.match(detail, /className="object-contain object-center"/);
  assert.match(detail, /variantPrimaryAndHoverSources\(product, selectedVariant\)\.primary/);
  assert.match(detail, /setActiveImage\(primaryIndex >= 0 \? primaryIndex : 0\)/);
  assert.doesNotMatch(detail, /data-testid="product-image-viewport"[^]*border:/);
  assert.match(card, /data-testid="collection-product-image-viewport"[^]*rounded-lg/);
  assert.match(card, /clipPath: 'inset\(0 round 8px\)'/);
});
