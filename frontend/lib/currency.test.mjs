import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDisplayPrice, initialDisplayCurrency } from './currency.ts';

test('INR remains authoritative and receives no foreign uplift', () => {
  assert.equal(formatDisplayPrice(1000, 'INR', { INR: 1 }), '₹1,000');
});

test('foreign display applies the configured rate and uplift once', () => {
  assert.equal(formatDisplayPrice(1000, 'USD', { USD: 0.01 }), '$11');
});

test('missing rates safely fall back to INR', () => {
  assert.equal(formatDisplayPrice(1000, 'EUR', {}), '₹1,000');
});

test('manual currency persists over detected country currency', () => {
  assert.equal(initialDisplayCurrency('GBP', 'USD'), 'GBP');
  assert.equal(initialDisplayCurrency(null, 'AED'), 'AED');
  assert.equal(initialDisplayCurrency('invalid', 'invalid'), 'INR');
});

test('rate refresh recalculates from the original INR base without compounding', () => {
  assert.equal(formatDisplayPrice(1000, 'USD', { USD: 0.01 }), '$11');
  assert.equal(formatDisplayPrice(1000, 'USD', { USD: 0.02 }), '$22');
});
