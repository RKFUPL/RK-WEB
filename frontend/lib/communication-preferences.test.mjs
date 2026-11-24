import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requiredServiceCommunicationText, whatsappAuthenticationConsentText, whatsappConsentText, whatsappMarketingConsentText } from './whatsapp-consent.ts';

test('required service communication disclosures keep authentication, utility and marketing permissions distinct', () => {
  assert.match(requiredServiceCommunicationText, /selected available communication channel/);
  assert.match(whatsappAuthenticationConsentText, /does not enable order updates or marketing/);
  assert.match(whatsappConsentText, /order confirmations, payment updates, shipping and delivery/);
  assert.match(whatsappMarketingConsentText, /optional.*withdrawn separately/);
});

test('Terms and Privacy share required service, channel-choice and withdrawable category-specific disclosures', () => {
  const legal = readFileSync(new URL('./legal-content.ts', import.meta.url), 'utf8');
  assert.equal((legal.match(/\.\.\.serviceCommunicationSections/g) || []).length, 2);
  for (const text of ['Required Service Communications', 'Communication Channel Configuration', 'WhatsApp Permission and Withdrawal', 'Optional Marketing Communications', 'does not by itself grant WhatsApp permission', 'does not automatically replay historical order messages', 'does not guarantee successful delivery or provide SMS fallback']) assert.ok(legal.includes(text), text);
  assert.doesNotMatch(legal, /WhatsApp notifications are optional and are not a condition of checkout/);
  assert.doesNotMatch(legal, /Utility templates do not require consent|consent cannot be withdrawn|all WhatsApp messages are automatically/);
});


test('operational channel selectors are admin-only and customers retain separate permissions', () => {
  const profile = readFileSync(new URL('../app/account/profile/page.tsx', import.meta.url), 'utf8');
  const signup = readFileSync(new URL('../app/account/page.tsx', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../components/admin/admin-settings.tsx', import.meta.url), 'utf8');
  for (const source of [profile, signup]) assert.doesNotMatch(source, /aria-label="(?:OTP delivery channel|Authentication communication channel|Order communication channel)"/);
  assert.doesNotMatch(profile, /Required account and order communications/);
  assert.match(profile, /Same as contact phone/);
  for (const key of ['authenticationDeliveryMode', 'transactionalDeliveryMode']) assert.ok(admin.includes(key));
  for (const value of ['email', 'whatsapp', 'both']) assert.ok(admin.includes('value="' + value + '"'));
});
