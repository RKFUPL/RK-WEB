import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const detail = fs.readFileSync(new URL('../components/products/product-detail-page.tsx', import.meta.url), 'utf8');

test('product image viewport owns and clips the single zoom control', () => {
  assert.match(detail, /data-testid="product-image-viewport"[^>]*className="isolate relative[^\"]*overflow-hidden rounded-lg/s);
  assert.match(detail, /data-testid="product-image-zoom-control"/);
  assert.doesNotMatch(detail, /product-image-zoom-control[^>]*fixed/s);
  assert.match(detail, /data-testid="product-image-zoom-control"[^]*className="[^"]*z-\[1\]/);
  assert.match(detail, /inlineZoomed \? <><ZoomOut[^]*Back to image<\/> : <><ZoomIn[^]*Zoom<\/>/);
});

test('zoom resets when the gallery leaves view and on interaction boundaries', () => {
  assert.match(detail, /new IntersectionObserver/);
  assert.match(detail, /if \(!entry\.isIntersecting\) setInlineZoomed\(false\)/);
  assert.match(detail, /event\.key === "Escape"/);
  assert.match(detail, /setInlineZoomed\(false\);[\s\S]*setZoomOrigin\("50% 50%"\)/);
});
