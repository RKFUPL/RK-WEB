import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const detail = readFileSync(new URL('../components/collections/collection-detail-page.tsx', import.meta.url), 'utf8');
const products = readFileSync(new URL('../components/collections/storefront-collection-products.tsx', import.meta.url), 'utf8');
const hero = readFileSync(new URL('../components/collections/collection-hero.tsx', import.meta.url), 'utf8');
const featured = readFileSync(new URL('../components/home/featured-collection.tsx', import.meta.url), 'utf8');
const dynamicRoute = readFileSync(new URL('../app/collections/[slug]/page.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const management = readFileSync(new URL('../components/collections/collection-management-detail.tsx', import.meta.url), 'utf8');
const catalogClient = readFileSync(new URL('./catalog-client.ts', import.meta.url), 'utf8');
const collectionsPage = readFileSync(new URL('../app/collections/page.tsx', import.meta.url), 'utf8');
const shopCategories = readFileSync(new URL('../components/home/shop-categories.tsx', import.meta.url), 'utf8');
const adminProducts = readFileSync(new URL('../components/admin/admin-products.tsx', import.meta.url), 'utf8');

test('collection request failures remain distinct from genuine empty collections', () => {
  assert.match(detail, /setCollectionError/);
  assert.match(products, /This collection could not be loaded/);
  assert.match(products, /No products in this collection yet/);
  assert.match(products, /role="alert"/);
});

test('every dynamic collection hero can scroll to the shared results section', () => {
  assert.match(dynamicRoute, /CollectionDetailPage/);
  assert.match(detail, /onProductsClick=\{scrollToProducts\}/);
  assert.match(detail, /ctaLabel="VIEW PRODUCTS"/);
  assert.match(detail, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
  assert.match(products, /id="collection-products"/);
  assert.match(products, /scroll-mt-28/);
});

test('collection heroes use consistent accessible lookbook and products actions', () => {
  assert.match(hero, /collection-campaign-button--primary/);
  assert.match(hero, /VIEW PRODUCTS/);
  assert.match(styles, /\.collection-campaign-button:focus-visible/);
  assert.match(featured, /collection-featured-button--primary/);
  assert.match(featured, /ArrowUpRight/);
});

test('saved collection media overrides static fallbacks and admin supports API or WorkDrive images', () => {
  assert.match(detail, /managedCollection\.hero\?\.image \|\| managedCollection\.heroImage \|\| ''/);
  assert.match(detail, /mobileImage: managedCollection \? managedCollection\.hero\?\.mobileImage \|\| configuredHeroImage/);
  assert.match(management, /collection\.heroSource\?\.image/);
  assert.match(management, /approved Zoho WorkDrive file\/share link/);
  assert.match(management, /aspect-video/);
  assert.match(management, /api\/staff\/collections\/image-preview/);
  assert.match(management, /Loading secure WorkDrive preview/);
  assert.match(management, /Advanced settings/);
  assert.match(management, /normalizeCollectionValue\(collectionForm\[source\]\) !== normalizeCollectionValue\(baseline\[source\]\)/);
  assert.match(management, /No collection changes to save/);
  assert.match(management, /Ordered references to centralized product records/);
});

test('empty or unavailable managed collection heroes render a neutral state', () => {
  assert.match(detail, /managedCollection\s*\?\s*managedCollection\.hero\?\.image \|\| managedCollection\.heroImage \|\| ''/);
  assert.match(detail, /loading\s*\?\s*''/);
  assert.match(hero, /onError=\{\(\) => setMediaFailed\(true\)\}/);
  assert.match(hero, /Collection image not configured/);
});

test('collection navigation deduplicates short-lived public detail requests', () => {
  assert.match(detail, /fetchCatalogCollection\(slug\)/);
  assert.match(catalogClient, /collectionDetailRequests = new Map/);
  assert.match(catalogClient, /COLLECTION_DETAIL_TTL_MS = 30_000/);
  assert.match(catalogClient, /collectionDetailRequests\.delete\(key\)/);
});

test('Hastakala cards use collection media instead of a missing lookbook cover route', () => {
  assert.doesNotMatch(collectionsPage, /lookbooks\/hastakala\/cover/);
  assert.match(collectionsPage, /collection\.hero\?\.image \|\| collection\.heroImage/);
  assert.doesNotMatch(shopCategories, /lookbooks\/hastakala\/cover/);
  assert.match(shopCategories, /image=\{item\.image\}/);
  assert.doesNotMatch(adminProducts, /lookbooks\/hastakala\/cover/);
  assert.match(adminProducts, /collection\.heroImage \|\| collection\.hero\?\.image/);
});

test('admin collection cards use catalog media for Aakaar instead of a lookbook cover route', () => {
  assert.doesNotMatch(adminProducts, /lookbooks\/aakaar\/cover/);
  assert.match(adminProducts, /const collectionCardImage = \(collection: ManagedCollection\) =>/);
  assert.match(adminProducts, /collection\.heroImage \|\| collection\.hero\?\.image/);
  assert.match(adminProducts, /Campaign|Collection/);
});

test('storefront Aakaar prefers saved catalog media and retains editorial media as fallback', () => {
  assert.match(collectionsPage, /normalizedName === 'aakaar'/);
  assert.match(collectionsPage, /collection\.hero\?\.image \|\| collection\.heroImage \|\| editorial\?\.image/);
  assert.match(management, /collection\.heroSource\?\.image \?\? collection\.hero\?\.image \?\? collection\.heroImage/);
  assert.match(management, /savedHeroPreview = collection\.hero\?\.image \|\| collection\.heroImage/);
});

test('successful collection deletion does not replace detail state with the delete receipt', () => {
  const mutationHelper = management.slice(
    management.indexOf('const relationRequest'),
    management.indexOf('const saveCollection'),
  );
  assert.match(mutationHelper, /typeof payload === "object" && "collection" in payload/);
  assert.match(management, /method: "DELETE"/);
  assert.match(management, /window\.location\.assign\(basePath\)/);
});
