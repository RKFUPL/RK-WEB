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
const sizeChart = readFileSync(new URL('../components/products/size-chart-popover.tsx', import.meta.url), 'utf8');
const naturalSort = readFileSync(new URL('./natural-sort.ts', import.meta.url), 'utf8');
const adminProducts = readFileSync(new URL('../components/admin/admin-products.tsx', import.meta.url), 'utf8');
const adminCollectionCard = readFileSync(new URL('../components/collections/collection-management-card.tsx', import.meta.url), 'utf8');
const rbac = readFileSync(new URL('./rbac.ts', import.meta.url), 'utf8');

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

test('non-Aakaar hero image lists select static or rotating media without changing the Aakaar branch', () => {
  assert.match(hero, /const slides = hero\.type === 'image' \? \(hero\.images \|\| \[\]\)\.filter\(\(slide\) => slide\.image\)/);
  assert.match(hero, /slides\.length < 2/);
  assert.match(hero, /const fallbackImage = hero\.image \|\| hero\.poster/);
  assert.match(hero, /activeSlide\?\.mobileImage \|\| activeSlide\?\.image \|\| hero\.mobileImage \|\| fallbackImage/);
  assert.match(hero, /setInterval/);
  assert.match(hero, /visibilitychange/);
  assert.match(hero, /Previous collection image/);
  assert.match(management, /One configured image creates a static landscape hero\. Two or more create a slideshow/);
  assert.match(management, /Collection Banner \(Landscape\)/);
  assert.match(management, /Collection Image \(Portrait\)/);
  assert.match(management, /coverImage/);
  assert.match(management, /Desktop Banner Video URL/);
  assert.match(management, /Banner Video Poster URL/);
  assert.match(management, /Move up/);
  assert.match(management, /Move down/);
  assert.match(management, /hero\.images = validHeroImages/);
  assert.match(management, /const validHeroImages = heroImages\.filter/);
  assert.match(management, /setHeroImages\(nextHeroImages\.length \? nextHeroImages/);
  assert.match(management, /const addHeroImage = \(\) => setHeroImages/);
  assert.match(management, /onClick=\{addHeroImage\}/);
  assert.match(management, /Click Add image to create the first editable entry/);
  assert.match(management, /const urlPattern =/);
  assert.match(management, /Paste each image as Name - WorkDrive URL/);
  assert.match(management, /updateHeroImage\(index, changes\.image\)/);
  assert.match(management, /Landscape image configuration/);
  assert.doesNotMatch(management, /Single Desktop Banner Image URL/);
  assert.match(management, /aspect-video w-full max-w-md/);
  assert.match(management, /No landscape images configured/);
  assert.match(detail, /isAakaar \?/);
});

test('logout revokes cookie-only sessions before clearing browser state', () => {
  const logoutBody = rbac.slice(rbac.indexOf('export async function logout'));
  assert.match(logoutBody, /fetch\(`\$\{apiBaseUrl\}\/api\/auth\/logout`/);
  assert.doesNotMatch(logoutBody, /if \(token\) \{\s*await fetch/);
  assert.match(logoutBody, /credentials: 'include'/);
});

test('saved collection media overrides static fallbacks and admin supports API or WorkDrive images', () => {
  assert.match(detail, /managedCollection\.hero\?\.image \|\| ''/);
  assert.doesNotMatch(detail, /managedCollection\.hero\?\.image \|\| managedCollection\.heroImage/);
  assert.match(detail, /loading \? '' : collection\.hero\?\.poster/);
  assert.match(detail, /loading \? \[\] : collection\.hero\?\.images \|\| \[\]/);
  assert.match(catalogClient, /cache: 'no-store'/);
  assert.match(detail, /mobileImage: managedCollection \? managedCollection\.hero\?\.mobileImage \|\| configuredHeroImage/);
  assert.match(management, /collection\.heroSource\?\.image/);
  assert.match(management, /Landscape image configuration/);
  assert.match(management, /coverImageSource/);
  assert.match(management, /hero\.image = validHeroImages\[0\]\?\.image \|\| ""/);
  assert.match(management, /api\/staff\/collections\/image-preview/);
  assert.match(management, /Secure preview unavailable/);
  assert.match(management, /Advanced settings/);
  assert.match(management, /normalizeCollectionValue\(collectionForm\[source\]\) !== normalizeCollectionValue\(baseline\[source\]\)/);
  assert.match(management, /No collection changes to save/);
  assert.match(management, /Ordered references to centralized product records/);
});

test('empty or unavailable managed collection heroes render a neutral state', () => {
  assert.match(detail, /managedCollection\s*\?\s*managedCollection\.hero\?\.image \|\| ''/);
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
  assert.match(collectionsPage, /collection\.coverImage \|\| collection\.heroImage/);
  assert.doesNotMatch(shopCategories, /lookbooks\/hastakala\/cover/);
  assert.match(shopCategories, /catalogCollections\[item\.href/);
  assert.match(shopCategories, /collection\.coverImage \|\| collection\.heroImage/);
  assert.doesNotMatch(adminProducts, /lookbooks\/hastakala\/cover/);
  assert.match(adminCollectionCard, /collection\.coverImage \|\| collection\.heroImage \|\| collection\.hero\?\.image/);
});

test('homepage collection cards resolve images and links by catalog slug', () => {
  assert.match(shopCategories, /collection\.slug/);
  assert.match(shopCategories, /catalogCollections\[item\.href/);
  assert.match(shopCategories, /editorial\?\.hero\?\.image \|\| editorial\?\.image/);
  assert.doesNotMatch(shopCategories, /\?\.image \|\| item\.image/);
  assert.doesNotMatch(shopCategories, /collectionRoutes\[item\.title\.toLowerCase\(\)\]/);
});

test('size guide label and natural product sorting are shared', () => {
  assert.match(sizeChart, />\s*Size guide\s*</);
  assert.match(naturalSort, /Number\(part\)/);
  assert.match(products, /compareProductCodes/);
});

test('admin collection cards use catalog media for Aakaar instead of a lookbook cover route', () => {
  assert.doesNotMatch(adminProducts, /lookbooks\/aakaar\/cover/);
  assert.match(adminProducts, /CollectionManagementCard/);
  assert.match(adminCollectionCard, /collectionManagementCardImage/);
  assert.match(adminCollectionCard, /collection\.heroImage \|\| collection\.hero\?\.image/);
  assert.match(adminCollectionCard, /Collection image unavailable/);
});

test('storefront Aakaar prefers saved catalog media and retains editorial media as fallback', () => {
  assert.match(collectionsPage, /normalizedName === 'aakaar'/);
  assert.match(collectionsPage, /collection\.coverImage \|\| collection\.heroImage/);
  assert.match(management, /collection\.heroSource\?\.image \?\? collection\.hero\?\.image \?\?/);
  assert.doesNotMatch(management, /savedHeroPreview = collection\.hero\?\.image \|\| collection\.heroImage/);
  assert.match(management, /collectionDraftRevision/);
  assert.match(management, /Newer unsaved edits remain in the form/);
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
