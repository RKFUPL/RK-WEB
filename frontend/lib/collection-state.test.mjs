import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const detail = readFileSync(new URL('../components/collections/collection-detail-page.tsx', import.meta.url), 'utf8');
const products = readFileSync(new URL('../components/collections/storefront-collection-products.tsx', import.meta.url), 'utf8');
const hero = readFileSync(new URL('../components/collections/collection-hero.tsx', import.meta.url), 'utf8');
const featured = readFileSync(new URL('../components/home/featured-collection.tsx', import.meta.url), 'utf8');
const dynamicRoute = readFileSync(new URL('../app/collections/[slug]/page.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

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
