import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { adminMediaRelationshipPreview, INITIAL_MEDIA_RELATIONSHIP_COUNT, visibleMediaRelationships } from './admin-media-relationships.ts';

const detailSource = readFileSync(new URL('../components/collections/collection-management-detail.tsx', import.meta.url), 'utf8');
const listSource = readFileSync(new URL('../components/collections/collection-management-list.tsx', import.meta.url), 'utf8');
const productsSource = readFileSync(new URL('../components/admin/admin-products.tsx', import.meta.url), 'utf8');
const cardSource = readFileSync(new URL('../components/collections/collection-management-card.tsx', import.meta.url), 'utf8');

test('media relationships show three initially and all entries only when expanded', () => {
  const relationships = Array.from({ length: 7 }, (_, index) => ({ id: index + 1 }));
  assert.equal(INITIAL_MEDIA_RELATIONSHIP_COUNT, 3);
  assert.deepEqual(visibleMediaRelationships(relationships, false), relationships.slice(0, 3));
  assert.deepEqual(visibleMediaRelationships(relationships, true), relationships);
  assert.deepEqual(visibleMediaRelationships(relationships.slice(0, 2), false), relationships.slice(0, 2));
  assert.deepEqual(visibleMediaRelationships([], false), []);
});

test('relationship previews stay bound to the product and relationship identity', () => {
  const entry = { identity: '0123456789abcdef01234567', permalink: 'https://workdrive.zoho.in/file/private', label: 'Front', variantId: 'blue' };
  assert.equal(adminMediaRelationshipPreview('product/one', entry), '/api/staff/products/product%2Fone/media/0123456789abcdef01234567');
  assert.equal(adminMediaRelationshipPreview('product-two', { ...entry, identity: 'not-persisted' }), '');
});

test('product management exposes compact responsive media cards and expansion controls', () => {
  assert.match(detailSource, /visibleMediaRelationships\(mediaEntries, showAllMediaRelationships\)/);
  assert.match(detailSource, /View all \$\{mediaEntries\.length\} relationships/);
  assert.match(detailSource, /Show less/);
  assert.match(detailSource, /aria-expanded=\{showAllMediaRelationships\}/);
  assert.match(detailSource, /aspect-\[4\/3\]/);
  assert.match(detailSource, /object-cover object-center/);
  assert.match(detailSource, /No media relationships remain/);
});

test('products and collections landing pages share navigable collection cards', () => {
  assert.match(productsSource, /CollectionManagementCard/);
  assert.match(listSource, /CollectionManagementCard/);
  assert.match(listSource, /statusLabel=\{displayStatus\(collection\.status\)\}/);
  assert.match(cardSource, /collection\.coverImage \|\| collection\.heroImage \|\| collection\.hero\?\.image/);
  assert.match(cardSource, /aspect-\[16\/9\]/);
  assert.match(cardSource, /object-cover object-center/);
  assert.match(cardSource, /collection\.productCount/);
  assert.match(cardSource, /href=\{href\}/);
});
