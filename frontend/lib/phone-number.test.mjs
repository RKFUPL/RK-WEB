import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPhone } from './phone-number.ts';

test('country-aware phone input preserves canonical recipients without double prefixes', () => {
  assert.equal(canonicalPhone('9619888755', 'IN'), '+919619888755');
  assert.equal(canonicalPhone('+919619888755', 'IN'), '+919619888755');
  assert.equal(canonicalPhone('020 7946 0018', 'GB'), '+442079460018');
  assert.equal(canonicalPhone('4155552671', 'US'), '+14155552671');
});

test('legacy local phones require a selected country and malformed phones are rejected', () => {
  for (const value of ['9619888755', 'call +919619888755', '+919619888755 ext 2', '123']) assert.equal(canonicalPhone(value), '');
  assert.equal(canonicalPhone('+14155552671', 'IN'), '');
});
