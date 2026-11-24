import test from 'node:test';
import assert from 'node:assert/strict';
import { addressCountryCode, addressPhoneParts, canonicalPhone, internationalPhoneParts, profileContactCountry, profileContactPhoneParts } from './phone-number.ts';

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

test('saved address countries resolve names and legacy ISO aliases without guessing unknown countries', () => {
  for (const [value, code] of [['India', 'IN'], ['US', 'US'], ['United States', 'US'], ['U.S.A.', 'US'], ['UK', 'GB'], ['United Kingdom', 'GB'], ['France', 'FR']]) assert.equal(addressCountryCode(value), code);
  for (const value of ['', 'unknown', 'Not a country']) assert.equal(addressCountryCode(value), undefined);
});

test('saved national phones use their own country while E.164 phones retain their actual phone country', () => {
  assert.equal(addressPhoneParts('9619888755', 'India')?.recipient, '+919619888755');
  assert.equal(addressPhoneParts('4155552671', 'United States')?.recipient, '+14155552671');
  assert.equal(addressPhoneParts('02079460018', 'UK')?.recipient, '+442079460018');
  assert.equal(addressPhoneParts('+442079460018', 'India')?.country, 'GB');
  assert.equal(addressPhoneParts('123', 'India'), null);
  assert.equal(addressPhoneParts('9619888755', 'unknown'), null);
});


test('profile contact parsing accepts explicit legacy metadata and international prefixes without guessing', () => {
  for (const [phone, country] of [['+919819887755', null], ['09819887755', 'IN'], ['09819887755', 'in'], ['919819887755', 'IN'], ['00919819887755', null]]) {
    assert.deepEqual(profileContactPhoneParts(phone, country), { recipient: '+919819887755', country: 'IN', callingCode: '91', nationalNumber: '9819887755' });
  }
  assert.equal(profileContactPhoneParts('+442079460018', 'IN')?.country, 'GB');
  for (const [phone, country] of [['09819887755', null], ['123', 'IN'], ['+919819887755 ext 2', 'IN']]) assert.equal(profileContactPhoneParts(phone, country), null);
});


test('profile region default resolves India only when stored country is missing', () => {
  for (const phone of ['+919819887755', '09819887755', '9819887755']) assert.deepEqual(profileContactPhoneParts(phone, null, 'asia-india'), { recipient: '+919819887755', country: 'IN', callingCode: '91', nationalNumber: '9819887755' });
  assert.equal(profileContactCountry('GB', 'asia-india'), 'GB');
  assert.equal(profileContactPhoneParts('02079460018', 'GB', 'asia-india')?.nationalNumber, '2079460018');
  assert.equal(profileContactPhoneParts('+442079460018', 'IN', 'asia-india')?.country, 'GB');
  assert.equal(profileContactPhoneParts('0212345678', 'IT', 'asia-india')?.nationalNumber, '0212345678');
  assert.equal(profileContactCountry(null, 'europe'), undefined);
  assert.equal(profileContactCountry('invalid', 'asia-india'), undefined);
  for (const phone of ['', '123', '009819887755', '0098198877550']) assert.equal(profileContactPhoneParts(phone, null, 'asia-india'), null);
});
