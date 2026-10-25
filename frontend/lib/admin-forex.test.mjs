import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAdminReferenceRate } from './admin-forex.ts';

test('ceil-displays reference rates to exactly three decimals', () => {
  assert.equal(formatAdminReferenceRate(0.010526), '0.011');
  assert.equal(formatAdminReferenceRate(0.125), '0.125');
});

test('very small positive rates round upward to the display minimum', () => {
  assert.equal(formatAdminReferenceRate(0.000001), '0.001');
});

test('invalid or missing rates display a safe placeholder', () => {
  assert.equal(formatAdminReferenceRate(undefined), '—');
  assert.equal(formatAdminReferenceRate(null), '—');
  assert.equal(formatAdminReferenceRate(0), '—');
  assert.equal(formatAdminReferenceRate('not-a-rate'), '—');
});
