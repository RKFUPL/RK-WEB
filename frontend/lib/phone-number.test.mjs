import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPhone, internationalPhoneParts } from './phone-number.ts';

test('country-aware phone input preserves canonical recipients without double prefixes', () => {
  assert.equal(canonicalPhone('9619888755', 'IN'), '+919619888755');
  assert.equal(canonicalPhone('+919619888755', 'IN'), '+919619888755');
  assert.equal(canonicalPhone('020 7946 0018', 'GB'), '+442079460018');
  assert.equal(canonicalPhone('4155552671', 'US'), '+14155552671');
});

test('delivery contact parsing extracts a validated country, calling code and national number', () => {
  for (const [value, recipient, country, callingCode, nationalNumber] of [
    ['+1 (415) 555-2671', '+14155552671', 'US', '1', '4155552671'],
    ['+44 20 7946 0018', '+442079460018', 'GB', '44', '2079460018'],
    ['+91 96198 88755', '+919619888755', 'IN', '91', '9619888755'],
  ]) assert.deepEqual(internationalPhoneParts(value), { recipient, country, callingCode, nationalNumber });
});

test('delivery contacts never infer a country or preserve an invalid previous recipient', () => {
  for (const value of ['', '123', '4155552671', '02079460018', 'call +14155552671', '+14155552671 ext 2', '+80012345678']) {
    assert.equal(internationalPhoneParts(value), null);
  }
});

test('legacy local phones require a selected country and malformed phones are rejected', () => {
  for (const value of ['9619888755', 'call +919619888755', '+919619888755 ext 2', '123']) assert.equal(canonicalPhone(value), '');
  assert.equal(canonicalPhone('+14155552671', 'IN'), '');
});
