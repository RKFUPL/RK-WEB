import test from 'node:test';
import assert from 'node:assert/strict';
import { effectivePricingRate, formatDisplayPrice, fractionDigitsForDisplay, initialDisplayCurrency } from './currency.ts';

test('INR remains authoritative and receives no foreign uplift', () => {
  assert.equal(formatDisplayPrice(1000, 'INR', { INR: 1 }), '₹1,000');
});

test('foreign display applies the configured rate and uplift once', () => {
  assert.equal(formatDisplayPrice(1000, 'USD', { USD: 0.01 }), '$11');
});

test('storefront pricing uses the upward-rounded three-decimal forex rate', () => {
  const effectiveRate = effectivePricingRate(0.010526);
  assert.equal(effectiveRate, 0.011);
  assert.equal(262884 * effectiveRate * 1.1, 3180.8964);
  assert.equal(formatDisplayPrice(262884, 'USD', { USD: 0.010526 }), '$3,181');
});

test('whole-unit storefront currencies round the final converted value', () => {
  assert.equal(formatDisplayPrice(1000, 'USD', { USD: 2.767 }), '$3,044');
  assert.equal(formatDisplayPrice(1000, 'USD', { USD: 2.7672 }), '$3,045');
  assert.equal(formatDisplayPrice(1000, 'USD', { USD: 2.768 }), '$3,045');
});

test('fractional display currencies retain minor units when configured', () => {
  assert.equal(fractionDigitsForDisplay('INR'), 0);
  assert.equal(fractionDigitsForDisplay('TEST_FRACTIONAL'), 2);
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

test('INR bypasses forex rate and markup while supported currencies use the same rule', () => {
  assert.equal(formatDisplayPrice(262884, 'INR', { INR: 999 }), '₹2,62,884');
  assert.equal(formatDisplayPrice(1000, 'EUR', { EUR: 0.010526 }), '€12');
  assert.equal(formatDisplayPrice(1000, 'GBP', { GBP: 0.010526 }), '£12');
});
