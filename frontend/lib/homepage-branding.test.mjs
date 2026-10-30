import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const featuredCollection = readFileSync(new URL('../components/home/featured-collection.tsx', import.meta.url), 'utf8');
const stickyHeader = readFileSync(new URL('../components/home/sticky-header.tsx', import.meta.url), 'utf8');

test('homepage hero branding is rendered once and remains outside transparent-header backdrop blur', () => {
  assert.equal((featuredCollection.match(/Rashi Kapoor \/ 2026/g) || []).length, 1);
  assert.match(stickyHeader, /!isTransparent && 'backdrop-blur-\[2px\]'/);
  assert.doesNotMatch(stickyHeader, /z-\[200\] border-b backdrop-blur-\[2px\]/);
});
