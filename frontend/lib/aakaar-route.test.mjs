import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = new URL('../app/', import.meta.url);
const components = new URL('../components/', import.meta.url);
const aakaarRouteSource = readFileSync(new URL('aakaar/page.tsx', app), 'utf8');
const legacyRouteSource = readFileSync(new URL('aakaar/collection/page.tsx', app), 'utf8');
const sitemapSource = readFileSync(new URL('sitemap.ts', app), 'utf8');
const productDetailSource = readFileSync(new URL('products/product-detail-page.tsx', components), 'utf8');
const collectionDetailSource = readFileSync(new URL('collections/collection-detail-page.tsx', components), 'utf8');

test('/aakaar redirects to the catalog-backed collection route', () => {
  assert.match(aakaarRouteSource, /redirect\('\/collections\/aakaar'\)/);
  assert.match(collectionDetailSource, /isAakaar \? <FeaturedCollection/);
  assert.match(collectionDetailSource, /<StorefrontCollectionProducts/);
});

test('the collection route remains canonical while the legacy product route stays available', () => {
  assert.match(sitemapSource, /'\/collections\/aakaar'/);
  assert.doesNotMatch(sitemapSource, /'\/aakaar',/);
  assert.match(legacyRouteSource, /AakaarCollectionPage/);
  assert.match(productDetailSource, /\? "\/collections\/aakaar"/);
});
