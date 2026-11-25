import { expect, test, type Page } from '@playwright/test';

async function mockProfileCommunications(page: Page, completed = true, consent = false, contactPhone = '+442079460018', phoneCountry: string | null = 'GB', initial: Record<string, unknown> = {}) {
  const writes: Record<string, unknown>[] = [];
  let user = { id: 'synthetic-profile', role: 'customer', isActive: true, email: 'synthetic@example.test', username: 'synthetic.profile', firstName: 'Synthetic', lastName: 'Profile', phone: contactPhone, phoneCountry, whatsappSameAsContact: false, whatsappIndependentPhone: '+14155552671', whatsappIndependentCountry: 'US', dob: '1990-01-01', gender: 'female', whatsappPhone: '+14155552671', whatsappCountry: 'US', whatsappConsentValid: consent, whatsappMarketingConsentValid: false, whatsappOtpConsentValid: false,
    ...initial, communicationPreferences: { completed, otpChannel: 'email', utilityChannel: consent ? 'whatsapp' : 'email', effectiveOtpChannel: 'email', effectiveUtilityChannel: consent ? 'whatsapp' : 'email' } };
  await page.addInitScript(() => localStorage.setItem('rk_access_token', 'synthetic-profile-token'));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user } });
    if (path === '/api/storefront-settings') return route.fulfill({ json: { settings: { whatsappConsentCollectionMode: 'onboarding' } } });
    if (path === '/api/auth/profile') {
      const body = route.request().postDataJSON(); writes.push(body);
      user = { ...user, ...body, whatsappIndependentPhone: body.whatsappSameAsContact ? (user.whatsappSameAsContact ? user.whatsappIndependentPhone : user.whatsappPhone) : body.whatsappPhone, whatsappIndependentCountry: body.whatsappSameAsContact ? (user.whatsappSameAsContact ? user.whatsappIndependentCountry : user.whatsappCountry) : body.whatsappCountry, whatsappConsentValid: body.whatsappTransactionalConsent === true || (body.whatsappTransactionalConsent === undefined && user.whatsappConsentValid && body.whatsappNotifications === true && body.whatsappPhone === user.whatsappPhone),
        whatsappOtpConsentValid: body.whatsappOtpConsent === true || (body.whatsappOtpConsent === undefined && user.whatsappOtpConsentValid && body.whatsappPhone === user.whatsappPhone),
        communicationPreferences: { ...body.communicationPreferences, completed: true } };
      return route.fulfill({ json: { user } });
    }
    return route.fulfill({ json: { addresses: [] } });
  });
  await page.goto('/account/profile');
  await expect(page.getByRole('heading', { name: 'My profile.' })).toBeVisible();
  return writes;
}

test('profile communications link actual contact digits without granting permission and manual edits unlink', async ({ page }) => {
  const writes = await mockProfileCommunications(page);
  const same = page.getByRole('checkbox', { name: 'Same as contact phone', exact: true });
  const phone = page.getByRole('group', { name: 'Primary WhatsApp number' });
  const consent = page.getByRole('checkbox', { name: /^I agree to receive transactional WhatsApp/ });
  await expect(phone.getByLabel('Mobile number')).toHaveValue('4155552671');
  await same.check();
  await expect(phone.getByLabel('Mobile number')).toHaveValue('2079460018');
  await expect(phone.getByRole('combobox')).toHaveValue(/United Kingdom \(\+44\)/);
  await expect(consent).not.toBeChecked();
  await page.getByRole('textbox', { name: /^Phone number/ }).fill('+919619888755');
  await expect(phone.getByLabel('Mobile number')).toHaveValue('9619888755');
  await expect(phone.getByRole('combobox')).toHaveValue(/India \(\+91\)/);
  await same.uncheck();
  await expect(phone.getByLabel('Mobile number')).toHaveValue('4155552671');
  await same.check();
  await phone.getByLabel('Mobile number').fill('9619888756');
  await expect(same).not.toBeChecked();
  await expect(consent).not.toBeChecked();
  await same.check();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ whatsappPhone: '+919619888755', whatsappCountry: 'IN', whatsappSameAsContact: true, whatsappTransactionalConsent: false, whatsappMarketingNotifications: false });
});

test('profile communications preserve an existing valid grant without customer routing selectors', async ({ page }) => {
  const writes = await mockProfileCommunications(page, false, true);
  await expect(page.getByRole('combobox', { name: /Authentication communication|Order communication/ })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'First name', exact: true }).fill('Updated');
  await expect(page.getByRole('checkbox', { name: /^I agree to receive transactional WhatsApp/ })).toBeChecked();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).not.toHaveProperty('whatsappTransactionalConsent');
  await expect(page.getByRole('status').filter({ hasText: 'Complete your communication channel choices' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: /^I agree to receive transactional WhatsApp/ }).uncheck();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].whatsappTransactionalConsent).toBe(false);
  expect(writes[1].whatsappMarketingNotifications).toBe(false);
});

test('profile communications changing a linked recipient invalidates an existing grant', async ({ page }) => {
  await mockProfileCommunications(page, true, true);
  const consent = page.getByRole('checkbox', { name: /^I agree to receive transactional WhatsApp/ });
  await expect(consent).toBeChecked();
  await page.getByRole('checkbox', { name: 'Same as contact phone', exact: true }).check();
  await expect(consent).not.toBeChecked();
  const phone = page.getByRole('group', { name: 'Primary WhatsApp number' });
  await phone.getByRole('combobox').fill('US');
  await page.getByRole('option', { name: /United States \(\+1\)$/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Same as contact phone', exact: true })).not.toBeChecked();
  await expect(consent).not.toBeChecked();
});

test('profile communications authentication permission is separate and withdrawable', async ({ page }) => {
  const writes = await mockProfileCommunications(page);
  const otp = page.getByRole('checkbox', { name: /^I request authentication codes from Rashi Kapoor/ });
  await expect(otp).not.toBeChecked();
  await otp.check();
  await expect(page.getByRole('checkbox', { name: /^I agree to receive transactional WhatsApp/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].whatsappOtpConsent).toBe(true);
  expect(writes[0].whatsappTransactionalConsent).toBe(false);
  // Withdrawal switches the channel to Email and removes this category control.
  await otp.click();
  await expect(otp).not.toBeChecked();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].whatsappOtpConsent).toBe(false);
  expect(writes[1].whatsappTransactionalConsent).toBe(false);
});

for (const entry of [
  { phone: '+919819887755', country: 'IN', national: '9819887755', name: 'India', code: '91' },
  { phone: '9819887755', country: 'IN', national: '9819887755', name: 'India', code: '91' },
  { phone: '+442079460018', country: 'GB', national: '2079460018', name: 'United Kingdom', code: '44' },
]) test(`profile communications linked contact format persists: ${entry.phone}`, async ({ page }, info) => {
  const writes = await mockProfileCommunications(page, true, false, entry.phone, entry.country);
  await page.getByRole('checkbox', { name: 'Same as contact phone', exact: true }).check();
  const number = page.getByRole('group', { name: 'Primary WhatsApp number' });
  await expect(number.getByLabel('Mobile number')).toHaveValue(entry.national);
  await expect(number.getByRole('combobox')).toHaveValue(new RegExp(entry.name));
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ whatsappPhone: '+' + entry.code + entry.national, whatsappCountry: entry.country, whatsappSameAsContact: true });
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Same as contact phone', exact: true })).toBeChecked();
  await expect(number.getByLabel('Mobile number')).toHaveValue(entry.national);
  await expect(page.getByRole('alert').filter({ hasText: 'Confirm your WhatsApp number' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('linked-profile.png'), fullPage: true });
  await page.getByRole('checkbox', { name: 'Same as contact phone', exact: true }).uncheck();
  await expect(number.getByLabel('Mobile number')).toHaveValue('4155552671');
  await expect(number.getByRole('combobox')).toHaveValue(/United States/);
});

for (const entry of [
  { label: 'international without saved WhatsApp', phone: '+919819887755', country: null, national: '9819887755', code: 'IN' },
  { label: 'legacy trunk prefix', phone: '09819887755', country: 'IN', national: '9819887755', code: 'IN' },
  { label: 'legacy lowercase country', phone: '09819887755', country: 'in', national: '9819887755', code: 'IN' },
  { label: 'international dial prefix', phone: '00919819887755', country: null, national: '9819887755', code: 'IN' },
  { label: 'international overrides stale country', phone: '+442079460018', country: 'IN', national: '2079460018', code: 'GB' },
]) test(`profile communications hydrates already-linked empty independent value: ${entry.label}`, async ({ page }, info) => {
  const writes = await mockProfileCommunications(page, true, false, entry.phone, entry.country,
    { whatsappSameAsContact: true, whatsappPhone: '', whatsappCountry: 'IN', whatsappIndependentPhone: '' });
  const number = page.getByRole('group', { name: 'Primary WhatsApp number' });
  await expect(page.getByRole('checkbox', { name: 'Same as contact phone', exact: true })).toBeChecked();
  await expect(number.getByLabel('Mobile number')).toHaveValue(entry.national);
  await expect(number.getByRole('combobox')).toHaveValue(entry.code === 'IN' ? /India.*\(\+91\)/ : /United Kingdom.*\(\+44\)/);
  await expect(page.getByRole('checkbox', { name: /^I agree to receive transactional WhatsApp/ })).not.toBeChecked();
  await page.getByRole('textbox', { name: 'First name', exact: true }).fill('Updated');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ phoneCountry: entry.code, whatsappCountry: entry.code, whatsappSameAsContact: true, whatsappTransactionalConsent: false });
  expect(writes[0].phone).toBe(writes[0].whatsappPhone);
  await page.reload();
  await expect(number.getByLabel('Mobile number')).toHaveValue(entry.national);
  // Next.js keeps an empty route-announcer alert after reload; it is not a field error.
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('hydrated-linked-profile.png'), fullPage: true });
});

for (const phone of ['+919819887755', '09819887755', '9819887755']) test(`profile communications saved India region resolves exact screenshot format: ${phone}`, async ({ page }, info) => {
  const writes = await mockProfileCommunications(page, true, false, phone, null,
    { region: 'asia-india', whatsappSameAsContact: true, whatsappPhone: '', whatsappIndependentPhone: '', whatsappCountry: 'IN' });
  // Assert the JSON field values, not merely an HTTP 200 response.
  // The browser route fixture is inspected through the same fetch used by getCurrentUser.
  const me = await page.evaluate(async () => (await fetch('/api/auth/me')).json());
  expect(me.user).toMatchObject({ phone, phoneCountry: null, region: 'asia-india', whatsappSameAsContact: true, whatsappPhone: '' });
  await expect(page.getByRole('textbox', { name: /^Phone number/ })).toHaveValue('9819887755');
  await expect(page.getByRole('combobox', { name: 'Contact phone country', exact: true })).toHaveValue(/India.*\(\+91\)/);
  const number = page.getByRole('group', { name: 'Primary WhatsApp number' });
  await expect(number.getByRole('combobox')).toHaveValue(/India.*\(\+91\)/);
  await expect(number.getByLabel('Mobile number')).toHaveValue('9819887755');
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /^I agree to receive transactional WhatsApp/ })).not.toBeChecked();
  await page.getByRole('textbox', { name: 'First name', exact: true }).fill('Updated');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ phone: '+919819887755', phoneCountry: 'IN', whatsappPhone: '+919819887755', whatsappCountry: 'IN', whatsappSameAsContact: true, whatsappTransactionalConsent: false });
  await page.reload();
  await expect(number.getByLabel('Mobile number')).toHaveValue('9819887755');
  await expect(page.getByRole('textbox', { name: /^Phone number/ })).toHaveValue('9819887755');
  await page.screenshot({ path: info.outputPath('india-region-linked-profile.png'), fullPage: true });
});

test('profile communications missing contact country is explicit and recoverable without guessing', async ({ page }) => {
  const writes = await mockProfileCommunications(page, true, false, '09819887755', null,
    { region: 'anywhere-else', whatsappSameAsContact: true, whatsappPhone: '', whatsappCountry: 'IN', whatsappIndependentPhone: '' });
  const country = page.getByRole('combobox', { name: 'Contact phone country', exact: true });
  await expect(country).toHaveValue('');
  const number = page.getByRole('group', { name: 'Primary WhatsApp number' });
  await expect(number.getByLabel('Mobile number')).toHaveValue('');
  await page.getByRole('textbox', { name: 'First name', exact: true }).fill('Updated');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Contact phone country' })).toBeVisible();
  expect(writes).toHaveLength(0);
  await country.fill('India');
  await page.getByRole('option', { name: /India.*\(\+91\)/ }).click();
  await expect(number.getByLabel('Mobile number')).toHaveValue('9819887755');
  await expect(page.getByRole('alert').filter({ hasText: 'Contact phone country' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ phone: '+919819887755', phoneCountry: 'IN', whatsappPhone: '+919819887755', whatsappSameAsContact: true, whatsappTransactionalConsent: false });
});

test('profile communications invalid linked contact blocks saving without a stale recipient', async ({ page }) => {
  const writes = await mockProfileCommunications(page);
  await page.getByRole('checkbox', { name: 'Same as contact phone', exact: true }).check();
  await page.getByRole('textbox', { name: /^Phone number/ }).fill('123');
  await expect(page.getByRole('group', { name: 'Primary WhatsApp number' }).getByLabel('Mobile number')).toHaveValue('');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /valid contact phone/ })).toBeVisible();
  expect(writes).toHaveLength(0);
});

for (const width of [1440, 390]) test(`profile communications groups remain accessible and responsive at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  await mockProfileCommunications(page, false);
  await expect(page.getByRole('heading', { name: 'WhatsApp permissions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Optional communications' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^I agree to receive transactional WhatsApp/ })).toBeEnabled();
  await expect(page.getByLabel(/I would also like to receive occasional collection launches/)).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: info.outputPath(`profile-communications-${width}.png`), fullPage: true });
});

for (const channel of ['email', 'whatsapp']) test(`onboarding signup permissions stay separate without routing selectors: ${channel}`, async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ status: 401, json: {} });
    if (path === '/api/storefront-settings') return route.fulfill({ json: { settings: { whatsappConsentCollectionMode: 'onboarding' } } });
    if (path === '/api/auth/signup/request-otp') { writes.push(route.request().postDataJSON()); return route.fulfill({ status: 202, json: { delivery: { email: 'sent' } } }); }
    return route.fulfill({ json: {} });
  });
  await page.goto('/account');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'OTP delivery channel' })).toHaveCount(0);
  await page.getByLabel('First name', { exact: true }).fill('Synthetic');
  await page.getByLabel('Last name', { exact: true }).fill('Signup');
  await page.getByLabel('Username', { exact: true }).fill('synthetic.signup');
  await page.getByLabel('Email', { exact: true }).fill('synthetic.signup@example.test');
  await selectPhoneCountry(page, 'US'); await page.getByLabel('Mobile number').fill('4155552671');
  await page.getByLabel('Date of birth', { exact: true }).fill('1990-01-01');
  await page.getByRole('combobox', { name: 'Gender', exact: true }).selectOption('female');
  await page.getByRole('combobox', { name: 'Region', exact: true }).selectOption('us');
  await page.locator('input[type=password]').nth(0).fill('synthetic-password');
  await page.locator('input[type=password]').nth(1).fill('synthetic-password');
  if (channel === 'whatsapp') {
    const consent = page.getByLabel('I agree to receive transactional WhatsApp updates, including order confirmations, payment updates, shipping and delivery notifications.', { exact: true });
    await expect(consent).not.toBeChecked();
    await consent.check();
  }
  await page.getByRole('button', { name: 'Send signup code' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).not.toHaveProperty('communicationPreferences');
  expect(writes[0]).not.toHaveProperty('otpChannel');
  expect(writes[0].whatsappOtpConsent).toBe(false);
  expect(writes[0].whatsappTransactionalConsent).toBe(channel === 'whatsapp');
});

for (const choice of ['email', 'whatsapp', 'missing', 'withdrawn']) test(`onboarding checkout communications avoid duplicate opt-in: ${choice}`, async ({ page }) => {
  const requests = await mockLinkedCheckout(page, { savedConsent: choice === 'whatsapp' });
  await page.route('**/api/storefront-settings', route => route.fulfill({ json: { settings: { razorpayEnabled: false, requireWhatsappConsentForCheckout: true, whatsappConsentCollectionMode: 'onboarding' } } }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'fixture', email: 'synthetic@example.test', whatsappPhone: '+14155552671', whatsappConsentValid: choice === 'whatsapp', communicationPreferences: { completed: choice !== 'missing', otpChannel: 'email', utilityChannel: choice === 'email' ? 'email' : 'whatsapp', effectiveUtilityChannel: choice === 'whatsapp' ? 'whatsapp' : 'email' } } } }));
  await page.reload();
  await expect(page.getByRole('link', { name: 'Manage WhatsApp permissions' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Keep me updated on WhatsApp/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].whatsappRecipient).toBe(choice === 'whatsapp' ? '+14155552671' : '');
  expect(requests[0]).not.toHaveProperty('whatsappTransactionalConsent');
});

async function selectPhoneCountry(page: Page, code: 'US' | 'GB') {
  const country = code === 'US' ? /United States \(\+1\)$/ : /United Kingdom \(\+44\)$/;
  await page.getByRole('combobox', { name: 'Country and dialling code', exact: true }).last().fill(code);
  await page.getByRole('option', { name: country }).click();
}


async function mockLinkedCheckout(page: Page, options: { savedConsent?: boolean; mandatory?: boolean; profilePhone?: string } = {}) {
  const requests: Record<string, unknown>[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('rk_access_token', 'fixture-token');
    localStorage.setItem('rk_shopping_bag', JSON.stringify({ currency: 'INR', items: [{ productId: 'fixture-product', variantId: 'fixture-colour', sku: 'FIXTURE-RED', name: 'Fixture garment', price: 1250, quantity: 1, size: 'M' }] }));
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'fixture', email: 'customer@example.test', whatsappPhone: options.profilePhone ?? '+14155552671', whatsappConsentValid: options.savedConsent === true } } });
    if (url.pathname === '/api/storefront-settings') return route.fulfill({ json: { settings: { razorpayEnabled: false, requireWhatsappConsentForCheckout: options.mandatory === true } } });
    if (url.pathname === '/api/auth/addresses') return route.fulfill({ json: { addresses: [
      { id: 'us', label: 'US fixture', fullName: 'Fixture Customer', phone: '+14155552671', line1: 'Fixture Street', line2: 'Fixture Suite', city: 'Fixture', state: 'Fixture', country: 'United States', postalCode: '94105', isDefault: true },
      { id: 'gb', label: 'UK fixture', fullName: 'Fixture Customer', phone: '+442079460018', line1: 'Fixture Street', city: 'Fixture', state: 'Fixture', country: 'United Kingdom', postalCode: 'SW1A 1AA' },
    ] } });
    if (url.pathname === '/api/payments/razorpay/order') {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ status: 502, json: { error: 'Isolated checkout boundary; no order created.' } });
    }
    if (url.pathname === '/api/sales/prices' && route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ items: [{ productId: 'fixture-product', variantId: 'fixture-colour' }] });
      return route.fulfill({ json: { prices: [{ productId: 'fixture-product', variantId: 'fixture-colour', price: 1250 }] } });
    }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, body: '' });
    if (url.pathname === '/api/storefront/activity') return route.fulfill({ status: 204, body: '' });
    if (route.request().method() !== 'GET') throw new Error(`Unexpected isolated request: ${route.request().method()} ${url.pathname}`);
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    if (url.origin !== 'http://127.0.0.1:3210') return route.fulfill({ status: 204, body: '' });
    return route.continue();
  });
  await page.goto('/checkout');
  await expect(page.getByRole('textbox', { name: /^Phone/ })).toHaveValue('4155552671');
  return requests;
}

const shippingLabels = ['Full name', 'Phone', 'Address line 1', 'Address line 2', 'City', 'State', 'Postal code', 'Country'];

test('checkout delivery country drives national phone defaults and preserves explicit telephone overrides', async ({ page }) => {
  const requests = await mockLinkedCheckout(page);
  const delivery = page.getByRole('group', { name: 'Delivery phone · required', exact: true });
  const whatsapp = page.getByRole('group', { name: 'WhatsApp number for this order', exact: true });
  const addressCountry = page.getByRole('combobox', { name: 'Delivery country', exact: true });
  const consent = page.getByRole('checkbox', { name: /Keep me updated on WhatsApp/ });
  for (const [name, code] of [['India', '91'], ['United States', '1'], ['United Kingdom', '44'], ['France', '33']]) {
    await addressCountry.fill(name);
    await page.getByRole('option', { name: new RegExp(`${name}$`) }).click();
    await expect(delivery.getByRole('combobox')).toHaveValue(new RegExp(`\\(\\+${code}\\)`));
  }
  await addressCountry.fill('India');
  await page.getByRole('option', { name: /India$/ }).click();
  await delivery.getByRole('textbox', { name: /^Phone/ }).fill('9619888755');
  await page.getByRole('checkbox', { name: 'Same as contact phone', exact: true }).check();
  await expect(whatsapp.getByLabel('Mobile number', { exact: true })).toHaveValue('9619888755');
  await expect(whatsapp.getByRole('combobox')).toHaveValue(/India \(\+91\)/);
  await expect(consent).not.toBeChecked();
  await consent.check();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].shipping).toMatchObject({ phone: '+919619888755', country: 'India' });
  expect(requests[0].whatsappRecipient).toBe('+919619888755');
  await delivery.getByRole('combobox').fill('GB');
  await page.getByRole('option', { name: /United Kingdom \(\+44\)$/ }).click();
  await delivery.getByRole('textbox', { name: /^Phone/ }).fill('2079460018');
  await expect(addressCountry).toHaveValue(/India$/);
  await expect(consent).not.toBeChecked();
  await page.getByRole('textbox', { name: /^City/ }).fill('Changed city');
  await expect(delivery.getByRole('combobox')).toHaveValue(/United Kingdom \(\+44\)/);
  await expect(whatsapp.getByRole('combobox')).toHaveValue(/United Kingdom \(\+44\)/);
  await page.getByLabel('Use a saved address').selectOption('us');
  await expect(delivery.getByRole('combobox')).toHaveValue(/United States \(\+1\)/);
  await expect(delivery.getByRole('textbox', { name: /^Phone/ })).toHaveValue('4155552671');
});

test('checkout legacy national saved phone uses its saved country', async ({ page }) => {
  await mockLinkedCheckout(page);
  await page.route('**/api/auth/addresses', route => route.fulfill({ json: { addresses: [
    { id: 'legacy', fullName: 'Synthetic', phone: '9619888755', line1: 'Synthetic road', city: 'Synthetic', state: 'Synthetic', country: 'India', postalCode: '400001', isDefault: true },
  ] } }));
  await page.reload();
  const delivery = page.getByRole('group', { name: 'Delivery phone · required', exact: true });
  await expect(delivery.getByRole('combobox')).toHaveValue(/India \(\+91\)/);
  await expect(delivery.getByRole('textbox', { name: /^Phone/ })).toHaveValue('9619888755');
  await page.getByRole('checkbox', { name: 'Same as contact phone', exact: true }).check();
  await expect(page.getByLabel('Mobile number', { exact: true })).toHaveValue('9619888755');
});

for (const width of [1440, 390]) for (const linked of [false, true]) test(`checkout new address clears all fields and recipient (${width}px, ${linked ? 'linked' : 'independent'})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const requests = await mockLinkedCheckout(page, { savedConsent: true, mandatory: true });
  const field = (label: string) => label === 'Country' ? page.getByRole('combobox', { name: 'Delivery country', exact: true }) : page.getByRole('textbox', { name: new RegExp(`^${label}`) });
  const picker = page.getByLabel('Use a saved address');
  const same = page.getByRole('checkbox', { name: 'Same as contact phone', exact: true });
  const consent = page.getByRole('checkbox', { name: /Keep me updated on WhatsApp/ });
  const expectedSaved = ['Fixture Customer', '4155552671', 'Fixture Street', 'Fixture Suite', 'Fixture', 'Fixture', '94105', '🇺🇸 United States'];
  await expect(picker).toHaveValue('us');
  for (let i = 0; i < shippingLabels.length; i++) await expect(field(shippingLabels[i])).toHaveValue(expectedSaved[i]);
  if (linked) await same.check();
  else {
    await selectPhoneCountry(page, 'GB');
    await page.getByLabel('Mobile number', { exact: true }).fill('2079460018');
    await consent.check();
  }
  await picker.selectOption('');
  await expect(picker).toHaveValue('');
  for (const label of shippingLabels) await expect(field(label)).toHaveValue('');
  await expect(page.getByLabel('Mobile number', { exact: true })).toHaveValue('');
  await expect(consent).not.toBeChecked();
  await expect(same).toBeChecked({ checked: linked });
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  expect(requests).toHaveLength(0);
  const fresh = ['New Fixture Customer', '+442079460018', 'New Fixture Street', 'New Fixture Suite', 'London', 'London', 'SW1A 1AA', 'United Kingdom'];
  for (let i = 0; i < shippingLabels.length - 1; i++) await field(shippingLabels[i]).fill(fresh[i]);
  // Country is still mandatory; selecting a new address must not restore India.
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  expect(requests).toHaveLength(0);
  await field('Country').fill(fresh[7]);
  await page.getByRole('option', { name: /United Kingdom$/ }).click();
  if (linked) {
    await expect(page.getByRole('group', { name: 'WhatsApp number for this order', exact: true }).getByLabel('Country and dialling code')).toHaveValue(/United Kingdom \(\+44\)/);
    await expect(page.getByLabel('Mobile number', { exact: true })).toHaveValue('2079460018');
  } else {
    await selectPhoneCountry(page, 'GB');
    await page.getByLabel('Mobile number', { exact: true }).fill('2079460018');
  }
  await expect(consent).not.toBeChecked();
  await consent.check();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].shipping).toEqual({ fullName: fresh[0], phone: fresh[1], line1: fresh[2], line2: fresh[3], city: fresh[4], state: fresh[5], postalCode: fresh[6], country: fresh[7] });
  expect(requests[0].shipping).not.toHaveProperty('addressId');
  expect(requests[0].whatsappRecipient).toBe('+442079460018');
  expect(requests[0].whatsappTransactionalConsent).toBe(true);
  await picker.selectOption('us');
  for (let i = 0; i < shippingLabels.length; i++) await expect(field(shippingLabels[i])).toHaveValue(expectedSaved[i]);
  await field('Full name').fill('Edited saved address');
  await field('Address line 2').fill('Edited suite');
  await picker.selectOption('');
  for (const label of shippingLabels) await expect(field(label)).toHaveValue('');
  await expect(page.getByLabel('Mobile number', { exact: true })).toHaveValue('');
  await expect(consent).not.toBeChecked();
});

test('checkout new address clears recipient validation and consent errors', async ({ page }) => {
  await mockLinkedCheckout(page, { mandatory: true });
  await page.getByLabel('Mobile number', { exact: true }).fill('123');
  const consent = page.getByRole('checkbox', { name: /Keep me updated on WhatsApp/ });
  await consent.check();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page.getByText('Enter a valid WhatsApp number for order updates.', { exact: true })).toBeVisible();
  await page.getByLabel('Use a saved address').selectOption('');
  await expect(page.getByText('Enter a valid WhatsApp number for order updates.', { exact: true })).toHaveCount(0);
  await expect(consent).not.toBeChecked();
  await page.getByLabel('Use a saved address').selectOption('us');
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page.locator('#whatsapp-consent-error')).toBeVisible();
  await page.getByLabel('Use a saved address').selectOption('');
  await expect(page.locator('#whatsapp-consent-error')).toHaveCount(0);
});

for (const mobile of [false, true]) test(`checkout linked recipient copies and synchronizes contact and saved addresses (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const requests = await mockLinkedCheckout(page, { mandatory: true });
  const same = page.getByRole('checkbox', { name: 'Same as contact phone', exact: true });
  const consent = page.getByRole('checkbox', { name: /Keep me updated on WhatsApp/ });
  await expect(same).not.toBeChecked();
  await same.check();
  await expect(consent).not.toBeChecked();
  await expect(page.getByRole('group', { name: 'WhatsApp number for this order', exact: true }).getByLabel('Country and dialling code')).toHaveValue(/United States \(\+1\)/);
  await expect(page.getByLabel('Mobile number', { exact: true })).toHaveValue('4155552671');
  await expect(page.getByRole('group', { name: 'WhatsApp number for this order', exact: true }).getByLabel('Country and dialling code')).toHaveValue(/\(\+1\)/);
  await consent.check();
  await page.getByRole('textbox', { name: /^Phone/ }).fill('+91 96198 88755');
  await expect(page.getByRole('group', { name: 'WhatsApp number for this order', exact: true }).getByLabel('Country and dialling code')).toHaveValue(/India \(\+91\)/);
  await expect(page.getByLabel('Mobile number', { exact: true })).toHaveValue('9619888755');
  await expect(consent).not.toBeChecked();
  await consent.check();
  await page.getByLabel('Use a saved address').selectOption('gb');
  await expect(page.getByRole('group', { name: 'WhatsApp number for this order', exact: true }).getByLabel('Country and dialling code')).toHaveValue(/United Kingdom \(\+44\)/);
  await expect(page.getByLabel('Mobile number', { exact: true })).toHaveValue('2079460018');
  await expect(page.getByText('Using delivery contact number:', { exact: false })).toContainText('+442079460018');
  await same.locator('..').locator('..').screenshot({ path: test.info().outputPath('linked-whatsapp.png') });
  await expect(consent).not.toBeChecked();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  expect(requests).toHaveLength(0);
  await consent.check();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].whatsappRecipient).toBe('+442079460018');
  expect(requests[0].whatsappCountry).toBe('GB');
  expect(requests[0].whatsappTransactionalConsent).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('checkout unlinking preserves a separate number and manual edits unlink country and number', async ({ page }) => {
  await mockLinkedCheckout(page);
  const same = page.getByRole('checkbox', { name: 'Same as contact phone', exact: true });
  const number = page.getByLabel('Mobile number', { exact: true });
  await selectPhoneCountry(page, 'GB');
  await number.fill('2079460018');
  await same.check();
  await expect(number).toHaveValue('4155552671');
  await same.uncheck();
  await expect(number).toHaveValue('2079460018');
  await page.getByRole('textbox', { name: /^Phone/ }).fill('+919619888755');
  await expect(number).toHaveValue('2079460018');
  await same.check();
  await number.fill('9619888756');
  await expect(same).not.toBeChecked();
  await same.check();
  await selectPhoneCountry(page, 'GB');
  await expect(same).not.toBeChecked();
  await expect(number).toHaveValue('');
});

test('checkout invalid linked contacts cannot retain stale recipients and delivery validation remains required', async ({ page }) => {
  const requests = await mockLinkedCheckout(page);
  await page.getByRole('checkbox', { name: 'Same as contact phone', exact: true }).check();
  const consent = page.getByRole('checkbox', { name: /Keep me updated on WhatsApp/ });
  await consent.check();
  await page.getByRole('textbox', { name: /^Phone/ }).fill('123');
  await expect(page.getByLabel('Mobile number', { exact: true })).toHaveValue('');
  await expect(consent).not.toBeChecked();
  await consent.check();
  await expect(page.getByRole('alert').filter({ hasText: 'selected calling code' })).toBeVisible();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  expect(requests).toHaveLength(0);
  await consent.uncheck();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  expect(requests).toHaveLength(0);
  await page.getByRole('textbox', { name: /^Phone/ }).fill('4155552671');
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].whatsappRecipient).toBe('');
  expect(requests[0].whatsappTransactionalConsent).toBe(false);
});

for (const linked of [false, true]) test(`checkout saved consent applies only to the exact selected recipient (${linked ? 'linked' : 'independent'})`, async ({ page }) => {
  const requests = await mockLinkedCheckout(page, { savedConsent: true, mandatory: true });
  await expect(page.getByRole('checkbox', { name: /Keep me updated on WhatsApp/ })).toHaveCount(0);
  if (linked) {
    await page.getByRole('checkbox', { name: 'Same as contact phone', exact: true }).check();
    await page.getByLabel('Use a saved address').selectOption('gb');
  } else {
    await selectPhoneCountry(page, 'GB');
    await page.getByLabel('Mobile number', { exact: true }).fill('2079460018');
  }
  const consent = page.getByRole('checkbox', { name: /Keep me updated on WhatsApp/ });
  await expect(consent).not.toBeChecked();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  expect(requests).toHaveLength(0);
  await consent.check();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].whatsappRecipient).toBe('+442079460018');
  expect(requests[0].whatsappTransactionalConsent).toBe(true);
});

test('checkout retains the copied number after unlinking when there was no independent number', async ({ page }) => {
  await mockLinkedCheckout(page, { profilePhone: '' });
  const same = page.getByRole('checkbox', { name: 'Same as contact phone', exact: true });
  await same.check();
  await same.uncheck();
  await page.getByRole('textbox', { name: /^Phone/ }).fill('+442079460018');
  await expect(page.getByLabel('Mobile number', { exact: true })).toHaveValue('4155552671');
  await expect(page.getByRole('group', { name: 'WhatsApp number for this order', exact: true }).getByLabel('Country and dialling code')).toHaveValue(/United States \(\+1\)/);
});

test('checkout phone controls have refined keyboard focus and reduced motion styling', async ({ page }) => {
  await mockLinkedCheckout(page, { profilePhone: '' });
  for (const control of [page.getByRole('group', { name: 'WhatsApp number for this order', exact: true }).getByLabel('Country and dialling code'), page.getByLabel('Mobile number', { exact: true })]) {
    await control.focus();
    // Tailwind's outline-none retains a transparent forced-colors fallback.
    await expect(control).toHaveCSS('outline-color', 'rgba(0, 0, 0, 0)');
    await expect(control).toHaveCSS('box-shadow', /181, 138, 76/);
    await expect(control).toHaveCSS('transition-duration', '0.2s');
    await expect(control).toHaveCSS('border-bottom-color', 'rgb(181, 138, 76)');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByLabel('Mobile number', { exact: true })).toHaveCSS('transition-property', 'none');
});

for (const scenario of ['gate-off', 'eligible', 'provider-stale', 'billing-blocked', 'sip-only'] as const) test(`provider diagnostics preserve independent health details: ${scenario}`, async ({ page }) => {
  const calls = await mockApi(page);
  const gate = scenario !== 'gate-off';
  const provider = scenario === 'eligible' || scenario === 'gate-off';
  const sipOnly = scenario === 'sip-only';
  const at = new Date().toISOString();
  const explanation = 'Your display name has not been approved yet. Your message limit will increase after the display name is approved.';
  await page.route('**/api/admin/integrations/whatsapp', route => route.fulfill({ json: {
    ...integration, configured: true, missing: [], environment: 'production',
    productionTest: { enabled: gate, expiresAt: new Date(Date.now() + 60_000).toISOString(), providerEligible: provider,
      providerEvidenceExpiresAt: scenario === 'provider-stale' ? new Date(Date.now() - 1).toISOString() : new Date(Date.now() + 60_000).toISOString() },
    templates: { test: { ...registeredTemplate, eligibleForTesting: gate && provider } },
    diagnosticChecks: [
      { key: 'billing', status: sipOnly ? 'NOT VERIFIED' : 'ACTION REQUIRED', checkedAt: at, source: 'Mocked Meta health GET',
        reason: sipOnly ? 'Meta aggregate messaging health is BLOCKED, but all four messaging entities are AVAILABLE and every reported error is SIP-only. This is not a messaging restriction; SIP calling remains blocked.' : 'Phone display name is not approved; current messaging capacity is limited.',
        action: sipOnly ? 'No messaging action is indicated by SIP-only errors; review SIP calling separately if calling is needed.' : 'WhatsApp Manager > Phone numbers > select number > Profile > Display name: review the display-name approval.',
        evidence: { messagingHealth: sipOnly ? 'BLOCKED' : 'LIMITED', messagingEligibilityMode: sipOnly ? 'AVAILABLE_SIP_ONLY' : 'DISPLAY_NAME_LIMITED', billingLedgerVerified: false, displayNameLimitedCandidate: !sipOnly,
          entities: ['PHONE_NUMBER', 'WABA', 'BUSINESS', 'APP'].map(type => ({ type, idMasked: '***1234', checkedAt: at,
            scope: { sourcePhoneNumberIdMasked: '***0686', matchesConfiguredEntity: true },
            can_send_message: !sipOnly && type === 'PHONE_NUMBER' ? 'LIMITED' : 'AVAILABLE',
            can_receive_call_sip: ['PHONE_NUMBER', 'APP'].includes(type) ? 'BLOCKED' : 'UNKNOWN',
            additional_info: !sipOnly && type === 'PHONE_NUMBER' ? [explanation] : [],
            errors: (sipOnly ? ['PHONE_NUMBER', 'APP'] : ['PHONE_NUMBER']).includes(type) ? [{ code: type === 'APP' ? 138025 : 138024, channel: 'calling_sip', description: 'SIP calling not configured' }] : [] })) } },
      { key: 'sender', status: 'UNKNOWN', checkedAt: at, source: 'Mocked Meta phone and WABA GET', reason: 'Sender status is CONNECTED; OTP code status is separate.',
        evidence: { senderStatus: 'CONNECTED', codeVerificationStatus: 'NOT_VERIFIED', businessVerificationStatus: 'VERIFIED', nameStatus: 'PENDING_REVIEW',
          qualityRating: 'GREEN', qualityDisplay: 'HIGH', messagingLimitTier: 'TIER_250', messagingLimitDescription: '250 unique recipients per rolling 24 hours' } },
    ],
  } }));
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Diagnostics');
  const diagnostic = page.getByRole('region', { name: 'Messaging diagnostics' });
  await diagnostic.getByRole('button', { name: 'Expand Messaging health and billing', exact: true }).click();
  await diagnostic.getByRole('button', { name: 'Expand Sender and business status', exact: true }).click();
  if (sipOnly) {
    await expect(diagnostic.getByText('BLOCKED', { exact: true })).toBeVisible();
    await expect(diagnostic.getByText('AVAILABLE_SIP_ONLY', { exact: true })).toBeVisible();
    await expect(diagnostic).toContainText('This is not a messaging restriction');
  } else await expect(diagnostic.getByText(explanation, { exact: true })).toBeVisible();
  await expect(diagnostic.getByText('Not verified; no current debt inferred', { exact: true })).toBeVisible();
  await expect(diagnostic.getByText(/^SIP calling error 138024:/)).toBeVisible();
  await expect(diagnostic.getByText('PENDING_REVIEW', { exact: true })).toBeVisible();
  if (!sipOnly) await expect(diagnostic).toContainText('Profile > Display name');
  await expect(diagnostic).toContainText('250 unique recipients per rolling 24 hours');
  await openSection(page, 'Test Messages');
  await page.getByLabel('Consenting test recipient').fill('+14155552671');
  await page.getByLabel(/I verified that the recipient provided this number/).check();
  const send = page.getByRole('button', { name: 'Send approved test template', exact: true });
  if (scenario === 'eligible') await expect(send).toBeEnabled();
  else await expect(send).toBeDisabled();
  expect(calls.sent).toEqual([]);
});

test('all seven diagnostic refresh actions request and display fresh backend evidence', async ({ page }) => {
  const calls = await mockApi(page);
  const requested: string[] = [];
  const scopes = [
    ['configuration', 'Application configuration'], ['billing', 'Messaging health and billing'],
    ['sender', 'Sender and business status'], ['templates', 'Template eligibility'],
    ['webhook', 'App-level webhook subscription'], ['worker', 'Worker status and configuration'], ['outbox', 'Outbox status'],
  ];
  await page.route('**/api/admin/integrations/whatsapp/diagnostics/refresh', route => {
    const scope = route.request().postDataJSON().scope;
    requested.push(scope);
    const keys = scope === 'all' ? scopes.map(([key]) => key) : [scope];
    return route.fulfill({ json: { status: { ...integration, diagnosticChecks: keys.map(key => ({ key,
      status: key === 'billing' || key === 'sender' ? 'UNKNOWN' : 'VERIFIED',
      checkedAt: new Date().toISOString(), source: `Fresh mocked ${key} backend read`,
      reason: key === 'billing' ? 'Billing ledger could not be verified.' : `Fresh ${key} evidence`,
      action: `Review ${key} prerequisites`, evidence: key === 'sender' ? {
        senderStatus: 'CONNECTED', codeVerificationStatus: 'NOT_VERIFIED', businessVerificationStatus: 'VERIFIED',
        qualityRating: 'GREEN', qualityDisplay: 'HIGH', messagingLimitTier: 'TIER_250',
        messagingLimitDescription: '250 unique recipients per rolling 24 hours',
        phoneNumberId: '482608498260686', phoneMasked: '***8080',
      } : { fresh: true },
    })) } } });
  });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Diagnostics');
  const diagnostics = page.getByRole('region', { name: 'Messaging diagnostics' });
  for (const [scope, title] of scopes) {
    await diagnostics.getByRole('button', { name: `Refresh ${title}`, exact: true }).click();
    const card = diagnostics.getByRole('article', { name: `${title} diagnostic` });
    await card.getByRole('button', { name: `Expand ${title}`, exact: true }).click();
    await expect(card).toContainText(`Fresh mocked ${scope} backend read`);
    await expect(card).not.toContainText('Not checked');
    await expect(card.locator('span').first()).toHaveText(scope === 'billing' || scope === 'sender' ? 'UNKNOWN' : 'VERIFIED');
  }
  await diagnostics.getByRole('button', { name: 'Refresh All Diagnostics', exact: true }).click();
  const sender = diagnostics.getByRole('article', { name: 'Sender and business status diagnostic' });
  for (const fact of ['CONNECTED', 'NOT_VERIFIED', 'VERIFIED', 'GREEN (HIGH)', 'TIER_250', '250 unique recipients per rolling 24 hours']) {
    await expect(sender).toContainText(fact);
  }
  for (const [scope, title] of scopes) {
    const expected = scope === 'billing' || scope === 'sender' ? 'UNKNOWN' : 'VERIFIED';
    await expect(diagnostics.getByRole('article', { name: `${title} diagnostic` }).locator('span').first()).toHaveText(expected);
  }
  expect(requested).toEqual([...scopes.map(([key]) => key), 'all']);
  expect(calls.sent).toEqual([]);
});

test('failed diagnostic refresh shows an error without pretending to verify evidence', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/admin/integrations/whatsapp/diagnostics/refresh', route => route.fulfill({ status: 503, json: { error: 'Fresh evidence unavailable' } }));
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Diagnostics');
  const diagnostics = page.getByRole('region', { name: 'Messaging diagnostics' });
  await diagnostics.getByRole('button', { name: 'Refresh All Diagnostics' }).click();
  await expect(diagnostics.getByRole('alert')).toContainText('Fresh evidence unavailable');
  const cards = diagnostics.getByRole('article');
  await expect(cards).toHaveCount(7);
  for (let index = 0; index < 7; index++) await expect(cards.nth(index).locator('span').first()).toHaveText('UNKNOWN');
});

test('fresh provider evidence is required even with an open production gate and approved template', async ({ page }) => {
  const calls = await mockApi(page, { active: true, production: true, registered: true,
    productionTest: { enabled: true, expiresAt: new Date(Date.now()+60_000).toISOString(), providerEligible: false } });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Test Messages');
  await page.getByLabel('Consenting test recipient').fill('+14155552671');
  await page.getByLabel(/I verified that the recipient provided this number/).check();
  await expect(page.getByRole('button', { name: 'Send approved test template', exact: true })).toBeDisabled();
  expect(calls.sent).toEqual([]);
});

for (const mode of ['light', 'dark'] as const) test(`diagnostics remain readable and fit mobile in ${mode} mode`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: mode });
  await mockApi(page);
  await page.goto('/admin/integrations/whatsapp');
  await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), mode === 'dark');
  await openSection(page, 'Diagnostics');
  const diagnostics = page.getByRole('region', { name: 'Messaging diagnostics' });
  await expect(diagnostics).toBeVisible();
  await expect(diagnostics.getByRole('article')).toHaveCount(7);
  expect(await diagnostics.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  const colours = await diagnostics.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, text: getComputedStyle(element).color }));
  expect(colours.background).not.toEqual(colours.text);
  await diagnostics.screenshot({ path: `test-results/whatsapp-diagnostics-${mode}.png` });
});

const integration = {
  enabled: false, environmentEnabled: false, configured: false,
  missing: ['WHATSAPP_ACCESS_TOKEN'], phoneNumberId: '', businessAccountId: '', apiVersion: '',
  callbackUrl: '', environment: 'development', testSendEnabled: false,
  templates: { test: { name: 'rk_test', language: 'en_US', category: 'UTILITY', parameters: [], enabled: false, approved: false } },
};
const registeredTemplate = {
  name: '3p_direct_integration_test_template', language: 'en_US', category: 'UTILITY', parameters: [],
  enabled: true, approved: true, eligibleForTesting: true, testParameterFields: [], locallyMapped: true, mappingEnabled: true,
  approvalSource: 'meta_api_read', observedStatus: 'APPROVED', qualityRating: 'UNKNOWN', templateGroup: 'Integration Test', requiresMetaApproval: true, componentsVerified: true,
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Integration Test' },
    { type: 'BODY', text: 'Welcome! This is a test message from the WhatsApp Business Platform. You have successfully configured your WhatsApp Business account and completed onboarding. You can now start sending messages to your customers.' },
    { type: 'FOOTER', text: 'WhatsApp Business Platform' },
  ],
};

async function mockApi(page: Page, options: { active?: boolean; role?: string; window?: 'open' | 'closed' | 'expired'; invalidRecipient?: boolean; textError?: boolean; localRateLimit?: boolean; gate?: boolean; production?: boolean; catalogue?: boolean; mappingDisabled?: boolean; readReceiptStatus?: 'received' | 'not_received' | 'unknown'; logStatus?: string; registered?: boolean; metaApproved?: boolean; refreshFailure?: boolean; testTemplate?: Record<string, unknown>; productionTest?: { enabled: boolean; expiresAt: string | null; providerEligible?: boolean; providerEvidenceExpiresAt?: string }; orderGate?: boolean; orderAdmin?: boolean; diagnostics?: { code: string; severity: 'info' | 'warning'; message: string }[] } = {}) {
  const sent: Record<string, unknown>[] = [];
  const filters: string[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'fixture-admin', role: options.role ?? 'admin', isActive: true, must_change_password: false, displayName: 'Fixture Admin' } } });
    if (path === '/api/admin/integrations/whatsapp/template-status' && route.request().method() === 'POST' && options.refreshFailure) return route.fulfill({ status: 502, json: { error: 'Unable to read a complete Meta template inventory. Previous verified statuses are retained and marked stale.', status: { ...integration, configured: true, missing: [], templates: { test: { ...registeredTemplate, approved: false, observedStatus: 'APPROVED', qualityRating: 'UNKNOWN', statusStale: true, approvalCheckedAt: '2026-11-13T09:00:00Z', statusEvidence: 'found' }, new_collection_drop: { name: 'rk_new_collection_drop', language: 'en_US', category: 'MARKETING', parameters: ['first_name', 'collection_name'], enabled: false, approved: false, observedStatus: 'PENDING', statusStale: true, approvalCheckedAt: '2026-11-13T09:00:00Z', statusEvidence: 'found' } }, catalogue: {}, templateStatusSync: { lastAttemptAt: '2026-11-13T10:00:00Z', lastSuccessAt: '2026-11-13T09:00:00Z', lastError: 'meta_inventory_unavailable_or_incomplete', outcome: 'failed' }, environment: 'development', testSendEnabled: true } } });
    if (path === '/api/admin/integrations/whatsapp' || path === '/api/admin/integrations/whatsapp/template-status') return route.fulfill({ json: {
      ...integration,
      orderNotificationsEnvironmentEnabled: !!options.orderGate,
      orderNotificationsAdminEnabled: !!options.orderAdmin,
      orderNotificationsEnabled: !!options.orderGate && !!options.orderAdmin,
      ...(options.active ? { configured: true, missing: [], templates: { test: options.registered || options.catalogue ? { ...registeredTemplate, approved: options.metaApproved !== false, eligibleForTesting: options.metaApproved !== false, observedStatus: options.metaApproved === false ? 'PENDING' : 'APPROVED' } : { ...integration.templates.test, enabled: true, approved: true, eligibleForTesting: true, testParameterFields: [], locallyMapped: true, mappingEnabled: false, approvalSource: 'meta_api_read', requiresMetaApproval: true, componentsVerified: true, observedStatus: 'APPROVED' }, ...(options.testTemplate ? { test: { ...registeredTemplate, ...options.testTemplate } } : {}), ...(options.catalogue ? {
        order_confirmation: { name: 'rk_order_confirmation', language: 'en_US', category: 'UTILITY', parameters: ['customer_name', 'order_number', 'order_date', 'order_total'], parameterTypes: ['text', 'text', 'text', 'text'], approvalStatus: 'APPROVED', observedStatus: 'APPROVED', enabled: !options.mappingDisabled, approved: true, eligibleForTesting: true, eligibleForAutomation: !options.mappingDisabled, locallyMapped: true, mappingEnabled: !options.mappingDisabled, approvalSource: 'meta_api_read', requiresMetaApproval: true, componentsVerified: true, templateGroup: 'Transactional', testParameterFields: [{ key: 'body_1', label: 'Body variable 1: customer_name', component: 'body', number: 1 }, { key: 'body_2', label: 'Body variable 2: order_number', component: 'body', number: 2 }, { key: 'body_3', label: 'Body variable 3: order_date', component: 'body', number: 3 }, { key: 'body_4', label: 'Body variable 4: order_total', component: 'body', number: 4 }], components: [{ type: 'HEADER', format: 'TEXT', text: 'Order Confirmed' }, { type: 'BODY', text: 'Dear {{1}}, Order {{2}}, dated {{3}}, total {{4}}.' }], metaComponents: [{ type: 'HEADER', format: 'TEXT', text: 'Order Confirmed' }, { type: 'BODY', text: 'Dear {{1}}, Order {{2}}, dated {{3}}, total {{4}}.' }], schemaVersion: 2 },
        signup_otp: { name: 'rk_authentication_otp', language: 'en_US', category: 'AUTHENTICATION', parameters: ['code'], enabled: true, approved: true, approvalStatus: 'APPROVED' },
        shipped: { name: 'rk_order_shipped', language: 'en_US', category: 'UTILITY', parameters: ['customer_name', 'order_number', 'courier_name', 'tracking_id'], approvalStatus: 'PENDING', observedStatus: 'PENDING', enabled: false, approved: false },
      } : {}) } } : {}),
      ...(options.active && options.catalogue ? { unmappedTemplates: [{ name: 'rk_test', language: 'en', category: 'MARKETING', status: 'PENDING', qualityRating: 'UNKNOWN', evidenceState: 'found_not_locally_mapped' }], catalogue: {
        authentication: { name: 'rk_authentication_otp', language: 'en_US', category: 'AUTHENTICATION', parameters: ['code'], enabled: false, approved: false, observedStatus: 'MISSING_OR_UNKNOWN', componentsVerified: false, localDraft: true, draftExplanation: 'Meta previously denied Authentication-template creation for this WABA; not submitted.', components: [{ type: 'BODY', add_security_recommendation: true }] },
        confirmation: { name: 'rk_order_confirmation', language: 'en_US', category: 'UTILITY', parameters: ['customer_name', 'order_number', 'order_date', 'order_total'], enabled: !options.mappingDisabled, approved: true, eligibleForTesting: true, eligibleForAutomation: !options.mappingDisabled, locallyMapped: true, mappingEnabled: !options.mappingDisabled, observedStatus: 'APPROVED', approvalSource: 'meta_api_read', requiresMetaApproval: true, componentsVerified: true, testParameterFields: [{ key: 'body_1', label: 'Body variable 1: customer_name', component: 'body', number: 1 }, { key: 'body_2', label: 'Body variable 2: order_number', component: 'body', number: 2 }, { key: 'body_3', label: 'Body variable 3: order_date', component: 'body', number: 3 }, { key: 'body_4', label: 'Body variable 4: order_total', component: 'body', number: 4 }], approvalCheckedAt: '2026-11-13T10:00:00Z', components: [{ type: 'HEADER', text: 'Order Confirmed' }, { type: 'BODY', text: 'Dear {{1}}, Order {{2}}, dated {{3}}, total {{4}}.' }] },
        confirmation_v2: { name: 'rk_order_confirmation_v2', versionOf: 'rk_order_confirmation', language: 'en_US', category: 'UTILITY', parameters: ['customer_name', 'order_number', 'order_date', 'order_total'], enabled: false, approved: false, observedStatus: 'MISSING_OR_UNKNOWN', componentsVerified: false, components: [{ type: 'BUTTONS', buttons: [{ type: 'URL', text: 'View Order' }] }] },
        marketing: { name: 'rk_new_collection_drop', language: 'en_US', category: 'MARKETING', parameters: ['first_name', 'collection_name'], enabled: false, approved: false, observedStatus: 'MISSING_OR_UNKNOWN', componentsVerified: false, components: [] },
        exclusive_offer: { name: 'rk_exclusive_offer', language: 'en_US', category: 'MARKETING', parameters: ['first_name', 'offer_description', 'coupon_code', 'expiry_date'], enabled: false, approved: false, observedStatus: 'MISSING_OR_UNKNOWN', localDraft: true, draftExplanation: 'Blocked until checkout has a validated coupon system; not submitted.', components: [] },
        admin_notification: { name: 'rk_admin_notification', language: 'en_US', category: 'UTILITY', parameters: ['reference', 'status'], enabled: false, approved: false, observedStatus: 'MISSING_OR_UNKNOWN', localDraft: true, templateGroup: 'Internal only', draftExplanation: 'Internal-only; excluded from customer-facing submissions.', components: [] },
        optional_draft: { name: 'rk_payment_failure', language: 'en_US', category: 'UTILITY', parameters: ['reference', 'status'], enabled: false, approved: false, observedStatus: 'PENDING', componentsVerified: false, locallyMapped: false, localDraft: false, templateGroup: 'Optional lifecycle drafts', components: [] },
      } } : {}),
      testSendEnabled: Boolean(options.active && options.gate !== false && !options.production),
      environment: options.production ? 'production' : 'development',
      productionTest: options.productionTest ? { providerEligible: true, providerEvidenceExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), ...options.productionTest } : undefined,
      diagnostics: options.diagnostics,
      callbackUrl: options.production ? 'https://rashikapoor.co.in/api/webhooks/whatsapp' : options.active ? 'https://fixture-tunnel.example/api/webhooks/whatsapp' : '',
    } });
    if (path === '/api/admin/integrations/whatsapp/test-window') {
      const recipient = route.request().postDataJSON().recipient;
      if (options.invalidRecipient) return route.fulfill({ status: 400, json: { error: 'Enter a valid international phone number.', validRecipient: false, open: false } });
      const checked = Date.now();
      return route.fulfill({ json: {
        recipient, validRecipient: true, open: !options.window || options.window === 'open',
        checkedAt: new Date(checked).toISOString(),
        lastIncomingAt: options.window === 'closed' ? null : new Date(checked - (options.window === 'expired' ? 25 : 1) * 3600000).toISOString(),
        expiresAt: options.window === 'closed' ? null : new Date(checked + (options.window === 'expired' ? -1 : 23) * 3600000).toISOString(),
        testSendEnabled: Boolean(options.active && options.gate !== false && !options.production),
      } });
    }
    if (path === '/api/admin/integrations/whatsapp/messages') {
      filters.push(url.search);
      const delivered = options.logStatus !== 'failed';
      return route.fulfill({ json: { messages: [{ _id: 'fixture-1', recipient: '***2671', type: 'test', template: 'rk_test', status: options.logStatus ?? 'delivered', createdAt: '2026-11-12T10:00:00Z', acceptedAt: '2026-11-12T10:00:00Z', sentAt: '2026-11-12T10:00:00Z', ...(delivered ? { deliveredAt: '2026-11-12T10:00:01Z' } : { failedAt: '2026-11-12T10:00:01Z' }), readAt: options.readReceiptStatus === 'received' ? '2026-11-12T10:00:02Z' : undefined, readReceiptStatus: options.readReceiptStatus ?? (delivered ? 'not_received' : 'unknown'), deliveryReceiptStatus: delivered ? 'received' : 'unknown', providerId: 'wamid.fixture' }], page: 1, hasMore: false } });
    }
    if (path === '/api/admin/integrations/whatsapp/test-send') {
      sent.push(route.request().postDataJSON());
      return route.fulfill({ json: { status: 'accepted', providerId: 'wamid.fixture', correlationId: 'fixture-correlation' } });
    }
    if (path === '/api/admin/integrations/whatsapp/test-message') {
      sent.push(route.request().postDataJSON());
      if (options.localRateLimit) return route.fulfill({ status: 429, contentType: 'text/html', body: '<html>Rate limited</html>' });
      if (options.textError) return route.fulfill({ status: 502, json: { status: 'failed', httpStatus: 401, error: { kind: 'invalid_credentials', code: 190, subcode: 463, httpStatus: 401 } } });
      return route.fulfill({ json: { status: 'accepted', providerId: 'wamid.text.fixture', correlationId: 'text-correlation', httpStatus: 200 } });
    }
    if (path.startsWith('/api/')) return route.fulfill({ json: {} });
    // No real backend or external resources are contacted by these tests.
    if (url.origin !== 'http://127.0.0.1:3210') return route.fulfill({ status: 204, body: '' });
    return route.continue();
  });
  return { sent, filters };
}

async function openSection(page: Page, name: string) {
  await page.getByRole('tab', { name, exact: true }).click();
}

test('order automation has its own backend and admin controls while manual tests remain off', async ({ page }) => {
  await mockApi(page, { active: true, production: true, gate: false, orderGate: true, orderAdmin: true });
  await page.goto('/admin/integrations/whatsapp');
  await expect(page.getByText('Order notifications', { exact: true })).toBeVisible();
  await openSection(page, 'Advanced Settings');
  const controls = page.getByRole('region', { name: 'Order notification controls' });
  // The semantic section is a named region; only the dedicated order switch is on.
  await expect(controls.getByRole('switch', { name: 'Disable order notifications' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('switch', { name: 'Enable WhatsApp messaging', exact: true })).toBeDisabled();
  await openSection(page, 'Test Messages');
  await expect(page.getByRole('button', { name: 'Send approved test template', exact: true })).toBeDisabled();
});

test('admin cannot enable order automation while its backend gate is off', async ({ page }) => {
  await mockApi(page, { active: true, production: true, gate: false });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Advanced Settings');
  await page.getByLabel('I authorize transactional order automation').check();
  await expect(page.getByRole('switch', { name: 'Enable order notifications', exact: true })).toBeDisabled();
});

test('order automation authorization updates only its dedicated database control', async ({ page }) => {
  await mockApi(page, { active: true, production: true, gate: false, orderGate: true });
  let submitted: Record<string, unknown> | null = null;
  await page.route('**/api/admin/integrations/whatsapp', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { ...integration, configured: true, missing: [], environment: 'production', orderNotificationsEnvironmentEnabled: true, orderNotificationsAdminEnabled: true, orderNotificationsEnabled: true } });
  });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Advanced Settings');
  const toggle = page.getByRole('switch', { name: 'Enable order notifications', exact: true });
  await expect(toggle).toBeDisabled();
  await page.getByLabel('I authorize transactional order automation').check();
  await toggle.click();
  await expect.poll(() => submitted).toEqual({ orderNotificationsEnabled: true });
  await expect(page.getByRole('switch', { name: 'Disable order notifications' })).toHaveAttribute('aria-checked', 'true');
});

test('disabled setup displays configuration and blocks sends', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/admin/integrations/whatsapp');
  await expect(page.getByRole('heading', { name: 'WhatsApp Control Centre', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await openSection(page, 'Advanced Settings');
  await expect(page.getByRole('switch', { name: 'Enable WhatsApp messaging', exact: true })).toBeDisabled();
  await expect(page.getByText('WHATSAPP_ACCESS_TOKEN', { exact: false })).toBeVisible();
  await openSection(page, 'Test Messages');
  await expect(page.getByRole('button', { name: 'Send approved test template', exact: true })).toBeDisabled();
  await openSection(page, 'Message Logs');
  await expect(page.getByText('***2671')).toBeVisible();
  expect(calls.sent).toHaveLength(0);
  await page.screenshot({ path: 'test-results/whatsapp-desktop.png', fullPage: true });
});

test('registered static template displays its exact contract and sends with consent outside window', async ({ page }) => {
  const calls = await mockApi(page, { active: true, registered: true, window: 'closed' });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Test Messages');
  await expect(page.getByRole('option', { name: /3p_direct_integration_test_template/ })).toBeEnabled();
  const form = page.getByRole('heading', { name: 'Send one-off approved template test' }).locator('../..');
  await expect(form.getByText('Integration Test', { exact: true })).toBeVisible();
  await expect(form.getByText(registeredTemplate.components[1].text, { exact: true })).toBeVisible();
  await expect(form.getByText('WhatsApp Business Platform', { exact: true })).toBeVisible();
  await expect(form.getByLabel(/Template parameter/)).toHaveCount(0);
  await page.getByLabel('Consenting test recipient').fill('+14155552671');
  const send = page.getByRole('button', { name: 'Send approved test template', exact: true });
  await expect(send).toBeDisabled();
  await page.getByLabel(/I verified that the recipient provided this number/).check();
  await expect(form).toContainText('Service window: Closed');
  await expect(send).toBeEnabled();
  await send.click();
  expect(calls.sent[0].parameters).toEqual({});
  expect(calls.sent[0].event).toBe('test');
});

test('Meta-approved Utility mapping disabled for automation remains available for a one-off test', async ({ page }) => {
  const calls = await mockApi(page, { active: true, catalogue: true, mappingDisabled: true, window: 'closed' });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Template Library');
  const row = page.getByRole('region', { name: 'Template Library' }).getByRole('row').filter({ hasText: 'rk_order_confirmation' });
  await expect(row).toContainText('Mapped · disabled');
  await page.getByRole('tab', { name: 'Test Messages', exact: true }).click();
  const option = page.getByRole('option', { name: /rk_order_confirmation/ });
  await expect(option).toBeEnabled();
  await expect(option).toContainText('Automated mapping disabled');
  await option.click();
  await expect(page.getByText('Template preview · rk_order_confirmation · en_US')).toBeVisible();
  for (const [field, value] of [['Body variable 1: customer_name', 'Fixture'], ['Body variable 2: order_number', 'RK-123'], ['Body variable 3: order_date', 'Nov 14'], ['Body variable 4: order_total', 'INR 1']] as const) {
    await page.getByLabel(field).fill(value);
  }
  await page.getByLabel('Consenting test recipient').fill('+14155552671');
  await expect(page.getByText(/Final confirmation: one manually initiated test to \+14155552671/)).toBeVisible();
  await page.getByLabel(/I verified that the recipient provided this number/).check();
  const send = page.getByRole('button', { name: 'Send approved test template', exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  expect(calls.sent).toHaveLength(1);
  expect(calls.sent[0]).toMatchObject({ event: 'order_confirmation', templateName: 'rk_order_confirmation', language: 'en_US', confirmed: true });
  expect(calls.sent[0].parameters).toEqual({ body_1: 'Fixture', body_2: 'RK-123', body_3: 'Nov 14', body_4: 'INR 1' });
});

test('approved integration template stays in approved filter, test selector, and separate library group with quality pending', async ({ page }) => {
  await mockApi(page, { active: true, registered: true, catalogue: true });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Template Library');
  const library = page.getByRole('region', { name: 'Template Library' });
  await library.getByLabel('Template status filter').selectOption('APPROVED');
  await expect(library.getByRole('row').filter({ hasText: '3p_direct_integration_test_template' })).toBeVisible();
  await expect(library.getByRole('row').filter({ hasText: '3p_direct_integration_test_template' })).toContainText('APPROVED');
  await expect(library.getByRole('row').filter({ hasText: '3p_direct_integration_test_template' })).toContainText('Quality pending');
  await expect(library.getByText('Transactional', { exact: true })).toBeVisible();
  await expect(library.getByRole('row').filter({ hasText: 'rk_order_confirmation' })).toBeVisible();
  await page.getByRole('tab', { name: 'Test Messages', exact: true }).click();
  const option = page.getByRole('option', { name: /Integration Test.*3p_direct_integration_test_template/ });
  await expect(option).toBeEnabled();
  await expect(page.getByText(/Meta status: APPROVED/)).toContainText('Quality pending');
  const orderOption = page.getByRole('option', { name: /rk_order_confirmation/ });
  await expect(orderOption).toBeVisible();
  await expect(orderOption).not.toContainText('Integration Test');
});

test('unapproved static template can be selected and previewed but cannot be sent', async ({ page }) => {
  const calls = await mockApi(page, { active: true, registered: true, metaApproved: false });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Test Messages');
  const option = page.getByRole('option', { name: /3p_direct_integration_test_template/ });
  await expect(option).toBeEnabled();
  await expect(option).toHaveAttribute('aria-description', /Preview only/);
  await option.click();
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(registeredTemplate.components[1].text, { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Selected template eligibility' })).toContainText('PENDING / IN_REVIEW');
  await page.getByLabel('Consenting test recipient').fill('+14155552671');
  await page.getByLabel(/I verified that the recipient provided this number/).check();
  await expect(page.getByRole('button', { name: 'Send approved test template', exact: true })).toBeDisabled();
  expect(calls.sent).toHaveLength(0);
});

for (const scenario of [
  { name: 'missing Meta evidence', template: { observedStatus: 'MISSING_OR_UNKNOWN', componentsVerified: false, statusEvidence: 'absent_from_complete_inventory' }, evidence: 'Not present in the last complete Meta inventory.', status: 'MISSING_OR_UNKNOWN', components: 'Components unconfirmed' },
  { name: 'approved but unverified components', template: { observedStatus: 'APPROVED', componentsVerified: false, statusEvidence: 'found' }, evidence: 'Exact name and language found in Meta.', status: 'APPROVED', components: 'Components unconfirmed' },
  { name: 'approved but stale Meta evidence', template: { observedStatus: 'APPROVED', componentsVerified: true, statusStale: true, statusEvidence: 'found' }, evidence: 'Last verified status is stale', status: 'APPROVED', components: 'Components verified' },
]) {
  test(`${scenario.name} permits selection and preview but blocks all form submissions`, async ({ page }) => {
    const calls = await mockApi(page, { active: true, catalogue: true, testTemplate: { ...scenario.template, approved: false, eligibleForTesting: false } });
    await page.goto('/admin/integrations/whatsapp');
    await openSection(page, 'Test Messages');
    await page.getByRole('option', { name: /rk_order_confirmation/ }).click();
    const option = page.getByRole('option', { name: /3p_direct_integration_test_template/ });
    await option.click();
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Template preview · 3p_direct_integration_test_template · en_US')).toBeVisible();
    await expect(page.getByText(registeredTemplate.components[1].text, { exact: true })).toBeVisible();
    const eligibility = page.getByRole('region', { name: 'Selected template eligibility' });
    await expect(eligibility).toContainText('Preview only');
    await expect(eligibility).toContainText(`Meta status: ${scenario.status}`);
    await expect(eligibility).toContainText(scenario.components);
    await expect(eligibility).toContainText(scenario.evidence);
    await expect(eligibility).toContainText('Language: en_US · Category: UTILITY');
    await expect(eligibility).toContainText('Test-send gate: On');
    await page.getByLabel('Consenting test recipient').fill('+14155552671');
    await page.getByLabel(/I verified that the recipient provided this number/).check();
    await expect(page.getByRole('button', { name: 'Send approved test template', exact: true })).toBeDisabled();
    // Exercise implicit/programmatic submission as well as the disabled button.
    await option.evaluate(element => (element.closest('form') as HTMLFormElement).requestSubmit());
    expect(calls.sent).toHaveLength(0);
  });
}

test('production gate off permits approved template preview without permitting a send', async ({ page }) => {
  const calls = await mockApi(page, { active: true, catalogue: true, production: true });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Test Messages');
  await page.getByRole('option', { name: /rk_order_confirmation/ }).click();
  await page.getByRole('option', { name: /3p_direct_integration_test_template/ }).click();
  await expect(page.getByText(registeredTemplate.components[1].text, { exact: true })).toBeVisible();
  const eligibility = page.getByRole('region', { name: 'Selected template eligibility' });
  await expect(eligibility).toContainText('Meta status: APPROVED');
  await expect(eligibility).toContainText('Test-send gate: Off');
  await page.getByLabel('Consenting test recipient').fill('+14155552671');
  await page.getByLabel(/I verified that the recipient provided this number/).check();
  await expect(page.getByRole('button', { name: 'Send approved test template', exact: true })).toBeDisabled();
  expect(calls.sent).toHaveLength(0);
});

test('sending requires explicit consent and shows Meta ID; filters request logs', async ({ page }) => {
  const calls = await mockApi(page, { active: true });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Test Messages');
  const send = page.getByRole('button', { name: 'Send approved test template', exact: true });
  await page.getByLabel('Consenting test recipient').fill('+14155552671');
  await expect(send).toBeDisabled();
  await page.getByLabel(/I verified that the recipient provided this number/).check();
  await send.click();
  await expect(page.getByRole('status')).toContainText('Meta message ID: wamid.fixture');
  expect(calls.sent).toHaveLength(1);
  expect(calls.sent[0].confirmed).toBe(true);
  expect(calls.sent[0].requestId).toMatch(/^[a-f0-9-]{36}$/);
  await openSection(page, 'Message Logs');
  await page.getByRole('combobox', { name: 'Message status filter' }).selectOption('delivered');
  await expect.poll(() => calls.filters.some(value => value.includes('status=delivered'))).toBe(true);
  await page.getByRole('combobox', { name: 'Message type filter' }).selectOption('test');
  await expect.poll(() => calls.filters.some(value => value.includes('type=test'))).toBe(true);
});

test('restricted production mode allows manually entered valid E.164 recipients with consent', async ({ page }) => {
  const calls = await mockApi(page, { active: true, production: true, registered: true,
    productionTest: { enabled: true, expiresAt: '2099-01-01T00:00:00+00:00' } });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Test Messages');
  const mode = page.getByRole('region', { name: 'Restricted production test mode' });
  await expect(mode).toContainText('Enabled');
  await expect(mode).toContainText('Enter one valid E.164 recipient for each manually initiated test');
  await expect(mode).toContainText('Expires (UTC): 2099-01-01T00:00:00+00:00');
  const send = page.getByRole('button', { name: 'Send approved test template', exact: true });
  await page.getByLabel('Consenting test recipient').fill('+1 415 555 2672');
  await expect(send).toBeDisabled();
  await page.getByLabel('Consenting test recipient').fill('+14155552672');
  await expect(send).toBeDisabled();
  await page.getByLabel(/I verified that the recipient provided this number/).check();
  await expect(send).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Send Test Message', exact: true })).toBeDisabled();
  await send.click();
  await expect.poll(() => calls.sent.length).toBe(1);
  await page.getByLabel('Consenting test recipient').fill('+442079460018');
  await page.getByLabel(/I verified that the recipient provided this number/).check();
  await expect(send).toBeEnabled();
  await send.click();
  expect(calls.sent).toHaveLength(2);
  expect(calls.sent[0]).toMatchObject({ recipient: '+14155552672', templateName: registeredTemplate.name, language: 'en_US', confirmed: true, recipientConsentVerified: true });
  expect(calls.sent[1]).toMatchObject({ recipient: '+442079460018', templateName: registeredTemplate.name, language: 'en_US', confirmed: true, recipientConsentVerified: true });
});

for (const scenario of [
  { name: 'missing settings', mode: { enabled: false, expiresAt: null }, template: {} },
  { name: 'expired mode', mode: { enabled: true, expiresAt: '2020-01-01T00:00:00Z' }, template: {} },
  { name: 'missing expiry', mode: { enabled: true, expiresAt: null }, template: {} },
  { name: 'stale template', mode: { enabled: true, expiresAt: '2099-01-01T00:00:00Z' }, template: { eligibleForTesting: false, statusStale: true } },
  { name: 'unverified components', mode: { enabled: true, expiresAt: '2099-01-01T00:00:00Z' }, template: { eligibleForTesting: false, componentsVerified: false } },
]) {
  test(`restricted production ${scenario.name} blocks sending`, async ({ page }) => {
    const calls = await mockApi(page, { active: true, production: true, catalogue: true, productionTest: scenario.mode, testTemplate: scenario.template });
    await page.goto('/admin/integrations/whatsapp');
    await openSection(page, 'Test Messages');
    await expect(page.getByRole('option', { name: /rk_authentication_otp/ })).toHaveCount(0);
    await expect(page.getByRole('option', { name: /rk_new_collection_drop/ })).toHaveCount(0);
    await page.getByLabel('Consenting test recipient').fill('+14155552671');
    await page.getByLabel(/I verified that the recipient provided this number/).check();
    await expect(page.getByRole('button', { name: 'Send approved test template', exact: true })).toBeDisabled();
    expect(calls.sent).toHaveLength(0);
  });
}

test('restricted production expiry disables an already valid form while the page remains open', async ({ page }) => {
  const moment = Date.now();
  await page.clock.install({ time: moment });
  const calls = await mockApi(page, { active: true, production: true, registered: true,
    productionTest: { enabled: true, expiresAt: new Date(moment + 60_000).toISOString() } });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Test Messages');
  await page.getByLabel('Consenting test recipient').fill('+14155552671');
  await page.getByLabel(/I verified that the recipient provided this number/).check();
  const send = page.getByRole('button', { name: 'Send approved test template', exact: true });
  await expect(send).toBeEnabled();
  await page.clock.fastForward(61_000);
  await expect(send).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Restricted production test mode' })).toContainText('Off or expired');
  expect(calls.sent).toHaveLength(0);
});

test('message logs state when no read receipt has arrived yet', async ({ page }) => {
  await mockApi(page);
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Message Logs');
  const deliveredRow = page.locator('tr').filter({ hasText: 'wamid.fixture' });
  await expect(deliveredRow).toContainText('Accepted:');
  await expect(deliveredRow).toContainText('Sent:');
  await expect(deliveredRow).toContainText('Delivered:');
  await expect(deliveredRow).toContainText('No read receipt received yet');
  await expect(deliveredRow).toContainText('Failed:');
  await expect(deliveredRow).not.toContainText('Read: Not recorded');
});

test('message logs distinguish an unavailable or unknown read receipt', async ({ page }) => {
  await mockApi(page, { logStatus: 'failed', readReceiptStatus: 'unknown' });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Message Logs');
  await expect(page.locator('tr').filter({ hasText: 'wamid.fixture' })).toContainText('Read receipt unavailable/unknown');
});

test('read-only receipt confirms delivery in logs without inventing a delivered timestamp', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/admin/integrations/whatsapp/messages?*', route => route.fulfill({ json: {
    messages: [{ _id: 'read-only', recipient: '***2671', type: 'order_confirmation', orderId: 'fixture-order',
      status: 'read', providerId: 'wamid.read-only', createdAt: '2026-11-12T10:00:00Z',
      readAt: '2026-11-12T10:00:02Z', readReceiptStatus: 'received', deliveryReceiptStatus: 'confirmed_by_read_receipt' }],
    page: 1, hasMore: false,
  } }));
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Message Logs');
  const row = page.locator('tr').filter({ hasText: 'wamid.read-only' });
  await expect(row).toContainText('Read receipt received');
  await expect(row).toContainText('Confirmed by read receipt; exact delivery time unavailable');
  await expect(row).not.toContainText('No delivery receipt received yet');
});

test('mobile admin renders without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Advanced Settings');
  await expect(page.getByRole('heading', { name: 'Webhook', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/whatsapp-mobile.png', fullPage: true });
});

test('customer role is redirected from admin integration', async ({ page }) => {
  await mockApi(page, { role: 'customer' });
  await page.goto('/admin/integrations/whatsapp');
  await expect(page).toHaveURL(/\/account(?:\/orders)?$/);
  await expect(page.getByRole('button', { name: 'Send test WhatsApp' })).toHaveCount(0);
});

test('manual text includes typed content, needs backend window and consent, with automation off', async ({ page }) => {
  const calls = await mockApi(page, { active: true });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Test Messages');
  await page.getByLabel('Test message recipient (E.164)', { exact: true }).fill('+14155552671');
  await page.getByLabel('Test message', { exact: true }).fill('Fixture typed message\nSecond line.');
  const send = page.getByRole('button', { name: 'Send Test Message', exact: true });
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  await expect(send).toBeDisabled();
  await page.getByLabel('I confirm this manually entered recipient').check();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByRole('status')).toContainText('Meta message ID: wamid.text.fixture');
  await expect(page.getByRole('status')).toContainText('Meta API response status: 200');
  expect(calls.sent).toHaveLength(1);
  expect(calls.sent[0].message).toBe('Fixture typed message\nSecond line.');
  expect(calls.sent[0].confirmed).toBe(true);
  await openSection(page, 'Advanced Settings');
  await expect(page.getByRole('switch', { name: 'Enable WhatsApp messaging', exact: true })).toBeDisabled();
  await openSection(page, 'Test Messages');
  await expect(page.getByRole('heading', { name: 'Send one-off approved template test' })).toBeVisible();
});

for (const window of ['closed', 'expired'] as const) {
  test(`free text is blocked for a ${window} customer window`, async ({ page }) => {
    const calls = await mockApi(page, { active: true, window });
    await page.goto('/admin/integrations/whatsapp');
    await openSection(page, 'Test Messages');
    await page.getByLabel('Test message recipient (E.164)', { exact: true }).fill('+14155552671');
    await page.getByLabel('Test message', { exact: true }).fill('Fixture message');
    await page.getByLabel('I confirm this manually entered recipient').check();
    await expect(page.getByText('Closed', { exact: true })).toBeVisible();
    await expect(page.getByText('The recipient must first message this business', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send Test Message', exact: true })).toBeDisabled();
    expect(calls.sent).toHaveLength(0);
  });
}

test('backend-invalid phone is rejected and empty or excessive text disables sends', async ({ page }) => {
  const calls = await mockApi(page, { active: true, invalidRecipient: true });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Test Messages');
  await page.getByLabel('Test message recipient (E.164)', { exact: true }).fill('+123456789');
  await page.getByLabel('Test message', { exact: true }).fill('Fixture message');
  await page.getByLabel('I confirm this manually entered recipient').check();
  await expect(page.getByText('Enter a valid international phone number.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send Test Message', exact: true })).toBeDisabled();
  expect(calls.sent).toHaveLength(0);
});

test('message length is enforced even with an open window', async ({ page }) => {
  await mockApi(page, { active: true });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Test Messages');
  await page.getByLabel('Test message recipient (E.164)', { exact: true }).fill('+14155552671');
  await page.getByLabel('I confirm this manually entered recipient').check();
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  const send = page.getByRole('button', { name: 'Send Test Message', exact: true });
  await expect(send).toBeDisabled();
  await page.getByLabel('Test message', { exact: true }).fill('x'.repeat(4097));
  await expect(send).toBeDisabled();
  await page.getByLabel('Test message', { exact: true }).fill('Valid fixture');
  await expect(send).toBeEnabled();
});

test('local gate off blocks both tests despite an open window', async ({ page }) => {
  const calls = await mockApi(page, { active: true, gate: false });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Test Messages');
  await page.getByLabel('Test message recipient (E.164)', { exact: true }).fill('+14155552671');
  await page.getByLabel('Test message', { exact: true }).fill('Fixture');
  await page.getByLabel('I confirm this manually entered recipient').check();
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send Test Message', exact: true })).toBeDisabled();
  await page.getByLabel('Consenting test recipient').fill('+14155552671');
  await page.getByLabel(/I verified that the recipient provided this number/).check();
  await expect(page.getByRole('button', { name: 'Send approved test template', exact: true })).toBeDisabled();
  expect(calls.sent).toHaveLength(0);
});

test('failed send shows safe Meta details and callback identifies development', async ({ page }) => {
  await mockApi(page, { active: true, textError: true });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Advanced Settings');
  await expect(page.getByRole('definition').filter({ hasText: 'Local development' })).toBeVisible();
  await expect(page.getByText('https://fixture-tunnel.example/api/webhooks/whatsapp', { exact: true })).toBeVisible();
  await openSection(page, 'Test Messages');
  await page.getByLabel('Test message recipient (E.164)', { exact: true }).fill('+14155552671');
  await page.getByLabel('Test message', { exact: true }).fill('Fixture');
  await page.getByLabel('I confirm this manually entered recipient').check();
  await expect(page.getByRole('button', { name: 'Send Test Message', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send Test Message', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Meta code 190');
  await expect(page.getByRole('status')).toContainText('subcode 463');
  await expect(page.getByRole('status')).toContainText('401');
});

test('production label uses production callback and disables local testing', async ({ page }) => {
  await mockApi(page, { active: true, production: true });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Advanced Settings');
  await expect(page.getByRole('definition').filter({ hasText: 'Production' })).toBeVisible();
  await expect(page.getByText('https://rashikapoor.co.in/api/webhooks/whatsapp', { exact: true })).toBeVisible();
  await openSection(page, 'Test Messages');
  await expect(page.getByRole('button', { name: 'Send Test Message', exact: true })).toBeDisabled();
});

test('local rate-limit errors are explained without displaying an HTML response', async ({ page }) => {
  await mockApi(page, { active: true, localRateLimit: true });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Test Messages');
  await page.getByLabel('Test message recipient (E.164)', { exact: true }).fill('+14155552671');
  await page.getByLabel('Test message', { exact: true }).fill('Fixture');
  await page.getByLabel('I confirm this manually entered recipient').check();
  await expect(page.getByRole('button', { name: 'Send Test Message', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send Test Message', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Admin request limit reached. Retry later.');
  await expect(page.getByRole('status')).toContainText('No HTTP response recorded');
});


test('approved catalogue selection validates ordered fields outside the service window', async ({ page }) => {
  const calls = await mockApi(page, { active: true, catalogue: true, window: 'closed' });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Test Messages');
  await expect(page.getByRole('heading', { name: 'Send one-off approved template test' })).toBeVisible();
  await expect(page.getByRole('option', { name: /rk_authentication_otp/ })).toHaveCount(0);
  const pendingOption = page.getByRole('option', { name: /rk_order_shipped/ });
  await expect(pendingOption).toBeEnabled();
  await pendingOption.click();
  await expect(page.getByRole('region', { name: 'Selected template eligibility' })).toContainText('PENDING / IN_REVIEW');
  await expect(page.getByRole('button', { name: 'Send approved test template', exact: true })).toBeDisabled();
  await page.getByRole('option', { name: /rk_order_confirmation.*Approved.*test eligible/ }).click();
  await page.getByLabel('Consenting test recipient').fill('+14155552671');
  const send = page.getByRole('button', { name: 'Send approved test template', exact: true });
  await page.getByLabel(/I verified that the recipient provided this number/).check();
  await expect(send).toBeDisabled();
  await page.getByLabel('Body variable 1: customer_name').fill('Fixture Customer');
  await page.getByLabel('Body variable 2: order_number').fill('RK-FIXTURE');
  await page.getByLabel('Body variable 3: order_date').fill('2026-11-13');
  await page.getByLabel('Body variable 4: order_total').fill('INR 1,250.00');
  await page.getByLabel(/I verified that the recipient provided this number/).check();
  await expect(send).toBeEnabled();
  await send.click();
  expect(calls.sent).toHaveLength(1);
  expect(calls.sent[0].event).toBe('order_confirmation');
  expect(calls.sent[0].parameters).toEqual({ body_1: 'Fixture Customer', body_2: 'RK-FIXTURE', body_3: '2026-11-13', body_4: 'INR 1,250.00' });
  await expect(page.getByRole('status')).toContainText('wamid.fixture');
});

test('template status refresh does not send a message', async ({ page }) => {
  const calls = await mockApi(page, { active: true, catalogue: true });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Template Library');
  await page.getByRole('button', { name: 'Refresh Meta statuses' }).click();
  await expect(page.getByRole('status')).toContainText('Configuration refreshed');
  expect(calls.sent).toHaveLength(0);
});

test('failed Meta refresh keeps the previous status visible and marks it stale', async ({ page }) => {
  await mockApi(page, { active: true, refreshFailure: true });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Template Library');
  const library = page.getByRole('region', { name: 'Template Library' });
  await page.getByRole('button', { name: 'Refresh Meta statuses' }).click();
  await expect(library).toContainText('PENDING / IN_REVIEW');
  await expect(library).toContainText('Stale evidence');
  await expect(library.getByRole('status')).toContainText(/previously verified statuses and timestamps are preserved/i);
  const integrationRow = library.getByRole('row').filter({ hasText: '3p_direct_integration_test_template' });
  await expect(integrationRow).toContainText('APPROVED');
  await expect(integrationRow).toContainText('Quality pending');
});

test('signup requests WhatsApp OTP and transactional consent separately and optionally', async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ status: 401, json: {} });
    if (url.pathname === '/api/auth/signup/request-otp') {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 202, json: { message: 'Fixture code requested' } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    if (url.origin !== 'http://127.0.0.1:3210') return route.fulfill({ status: 204, body: '' });
    return route.continue();
  });
  await page.goto('/account');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  const otpConsent = page.getByLabel('I request this verification code on WhatsApp');
  const transactionalConsent = page.getByLabel('I agree to receive transactional WhatsApp updates, including order confirmations, payment updates, shipping and delivery notifications.');
  await expect(otpConsent).not.toBeChecked();
  await expect(transactionalConsent).not.toBeChecked();
  await page.getByLabel('First name', { exact: true }).fill('Fixture');
  await page.getByLabel('Last name', { exact: true }).fill('Customer');
  await page.getByLabel('Username', { exact: true }).fill('fixture.signup');
  await page.getByLabel('Email', { exact: true }).fill('signup@example.test');
  await selectPhoneCountry(page, 'US');
  await page.getByLabel('Mobile number', { exact: true }).fill('4155552671');
  await page.getByLabel('Date of birth', { exact: true }).fill('1990-01-01');
  await page.getByRole('combobox', { name: 'Gender', exact: true }).selectOption('female');
  await page.getByRole('combobox', { name: 'Region', exact: true }).selectOption('asia-india');
  await page.locator('input[type="password"]').nth(0).fill('fixture-password');
  await page.locator('input[type="password"]').nth(1).fill('fixture-password');
  await otpConsent.check();
  await page.getByRole('button', { name: 'Send signup code', exact: true }).click();
  await expect.poll(() => submitted).not.toBeNull();
  expect(submitted!.whatsappOtpConsent).toBe(true);
  expect(submitted!.whatsappTransactionalConsent).toBe(false);
});


test('checkout uses one inline transactional checkbox and keeps marketing preferences separate', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('rk_access_token', 'fixture-token');
    localStorage.setItem('rk_shopping_bag', JSON.stringify({ currency: 'INR', items: [{ productId: 'fixture-product', productCode: 'RK-1', variantId: 'fixture-colour', sku: 'RK-1-RED', collection: 'Fixture', colour: 'Red', name: 'Fixture garment', price: 1250, quantity: 1, size: 'M', inventoryMode: 'variant' }] }));
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'fixture', email: 'customer@example.test', role: 'customer', isActive: true, whatsappPhone: '+14155552671', whatsappConsentValid: false } } });
    if (url.pathname === '/api/auth/addresses') return route.fulfill({ json: { addresses: [{ id: 'fixture-address', fullName: 'Fixture Customer', phone: '+14155552671', line1: '1 Fixture Street', city: 'Mumbai', state: 'Maharashtra', postalCode: '400001', country: 'India', isDefault: true }] } });
    if (url.pathname === '/api/payments/razorpay/order') {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ status: 502, json: { error: 'Fixture payment provider is unavailable.' } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    if (url.origin !== 'http://127.0.0.1:3210') return route.fulfill({ status: 204, body: '' });
    return route.continue();
  });
  await page.goto('/checkout');
  const consent = page.getByRole('checkbox', { name: /Keep me updated on WhatsApp about this order/ });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(consent).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await expect(consent).not.toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Full name' })).toHaveValue('Fixture Customer');
  const pay = page.getByRole('button', { name: /^Pay / });
  await pay.click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].whatsappTransactionalConsent).toBe(false);
  expect(requests[0].whatsappRecipient).toBe('');
  await consent.check();
  await pay.click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].whatsappTransactionalConsent).toBe(true);
  expect(requests[1].whatsappRecipient).toBe('+14155552671');
  expect(requests[1].whatsappMarketingConsent).toBeUndefined();
  await expect(page.getByText(/Marketing preferences remain separate/)).toHaveCount(0);
});

async function mockOrderApi(page: Page, options: { shipped?: boolean; consent?: boolean; placedBlock?: boolean } = {}) {
  const updates: { path: string; body: Record<string, unknown> }[] = [];
  const orderId = '507f1f77bcf86cd799439011';
  let read = false;
  let order = {
    id: orderId, orderNumber: 'RK-FIXTURE', customerName: 'Fixture Customer', email: 'customer@example.test', total: 1250,
    createdAt: '2026-01-01T08:00:00Z', paymentStatus: 'paid', payment: { status: 'paid', gateway: 'razorpay' }, items: [], timeline: [],
    shipping: { fullName: 'Fixture Customer', phone: '+442079460018', line1: 'Fixture Street', city: 'London', country: 'United Kingdom' },
    fulfillmentStatus: options.shipped ? 'shipped' : 'packed', availableActions: options.shipped ? ['shipment_update'] : ['shipped'],
    fulfillment: { status: options.shipped ? 'shipped' : 'packed', courier: '', trackingNumber: '', trackingUrl: '', shippedAt: '' },
    whatsapp: {
      number: '+442079460018', consent: options.consent === false ? 'missing_or_withdrawn' : 'granted',
      eligibilityReason: options.consent === false ? 'missing_or_withdrawn_consent' : undefined, automationEnabled: false,
      templates: [{ event: 'shipped', name: 'rk_order_shipped', approved: false, enabled: false, status: 'NOT_SUBMITTED' }],
      activity: (options.placedBlock ? [{ event: 'order_placed', template: 'rk_order_placed', status: 'waiting_for_approved_template', reason: 'legacy_template_mapping_requires_migration' }] : []) as Record<string, unknown>[],
    },
  };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'fixture-admin', role: 'admin', isActive: true, must_change_password: false } } });
    if (url.pathname.startsWith(`/api/staff/orders/${orderId}`)) {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON();
        updates.push({ path: url.pathname, body });
        order = { ...order, fulfillmentStatus: 'shipped', availableActions: ['shipment_update'], fulfillment: { ...order.fulfillment, ...body, status: 'shipped' },
          whatsapp: { ...order.whatsapp, activity: [{ event: 'shipped', status: options.shipped ? 'queued' : 'waiting_for_approved_template', reason: options.shipped ? undefined : 'template_not_approved_or_enabled', updatedAt: '2026-01-01T10:00:00Z' }] } };
      } else if (read) {
        order = { ...order, whatsapp: { ...order.whatsapp, activity: [{ event: 'shipped', status: 'read', sentAt: '2026-01-01T10:00:00Z', deliveredAt: '2026-01-01T10:01:00Z', readAt: '2026-01-01T10:02:00Z', updatedAt: '2026-01-01T10:02:00Z' }] } };
      }
      return route.fulfill({ json: { order, courierOptions: [] } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    if (url.origin !== 'http://127.0.0.1:3210') return route.fulfill({ status: 204, body: '' });
    return route.continue();
  });
  return { updates, orderId, receiveRead: () => { read = true; } };
}

test('order activity identifies the actual legacy order-placed template and migration blocker', async ({ page }) => {
  await mockOrderApi(page, { placedBlock: true });
  await page.goto('/admin/orders/507f1f77bcf86cd799439011');
  await expect(page.getByText('Template: rk_order_placed', { exact: true })).toBeVisible();
  await expect(page.getByText('The superseded order-placed mapping requires an operator-reviewed migration to order_received.', { exact: true })).toBeVisible();
});

test('admin shipment saves courier AWB URL and dispatch date through the existing order endpoint', async ({ page }) => {
  const fixture = await mockOrderApi(page);
  await page.goto(`/admin/orders/${fixture.orderId}`);
  const activity = page.getByRole('region', { name: 'WhatsApp notification activity' });
  await expect(activity).toContainText('+442079460018');
  await expect(activity).toContainText('Granted for this number');
  await expect(activity).toContainText('Waiting for approved template: rk_order_shipped');
  await page.getByRole('button', { name: 'Mark as Shipped', exact: true }).click();
  await page.getByLabel('Courier', { exact: true }).fill('Fixture Courier');
  await page.getByLabel('Tracking number', { exact: true }).fill('AWB-001');
  await page.getByLabel('Tracking URL', { exact: true }).fill('https://courier.example/track/AWB-001');
  await page.getByLabel('Shipment dispatch date and time').fill('2026-01-01T10:30');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(() => fixture.updates.length).toBe(1);
  expect(fixture.updates[0].path).toBe(`/api/staff/orders/${fixture.orderId}/fulfillment`);
  expect(fixture.updates[0].body).toMatchObject({ status: 'shipped', courier: 'Fixture Courier', trackingNumber: 'AWB-001', trackingUrl: 'https://courier.example/track/AWB-001', sendCustomerNotification: true });
  expect(String(fixture.updates[0].body.shippedAt)).toMatch(/Z$/);
  await expect(page.getByRole('link', { name: 'Open', exact: true })).toHaveAttribute('href', 'https://courier.example/track/AWB-001');
  await expect(activity).toContainText('Waiting For Approved Template');
  await expect(activity).toContainText('Disabled');
});

test('admin can add tracking after shipped and refresh real notification milestones', async ({ page }) => {
  const fixture = await mockOrderApi(page, { shipped: true });
  await page.goto(`/admin/orders/${fixture.orderId}`);
  await page.getByRole('button', { name: 'Update Tracking', exact: true }).first().click();
  await page.getByLabel('Courier', { exact: true }).fill('Fixture Courier');
  await page.getByLabel('Tracking number', { exact: true }).fill('AWB-LATE');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(() => fixture.updates.length).toBe(1);
  expect(fixture.updates[0].path).toBe(`/api/staff/orders/${fixture.orderId}/shipment`);
  const activity = page.getByRole('region', { name: 'WhatsApp notification activity' });
  await expect(activity).toContainText('Queued');
  await expect(activity).toContainText('No read receipt received yet');
  fixture.receiveRead();
  await page.getByRole('button', { name: 'Refresh notification activity' }).click();
  await expect(activity).toContainText('Read receipt received:');
  await expect(activity).toContainText('Delivered:');
});

test('order details clearly display missing transactional consent', async ({ page }) => {
  const fixture = await mockOrderApi(page, { consent: false });
  await page.goto(`/admin/orders/${fixture.orderId}`);
  await expect(page.getByRole('region', { name: 'WhatsApp notification activity' })).toContainText('Not eligible (missing or withdrawn consent)');
  expect(fixture.updates).toHaveLength(0);
});

test('one-time login sends explicit WhatsApp permission without customer routing', async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ status: 401, json: {} });
    if (url.pathname === '/api/auth/request-otp') {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 202, json: { delivery: { email: 'not_requested', whatsapp: 'queued' } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    if (url.origin !== 'http://127.0.0.1:3210') return route.fulfill({ status: 204, body: '' });
    return route.continue();
  });
  await page.goto('/account');
  await expect(page.locator('input[type="password"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Sign in with one-time code', exact: true }).click();
  await expect(page.getByLabel('OTP delivery channel')).toHaveCount(0);
  await expect(page.getByLabel('I request this verification code on WhatsApp')).not.toBeChecked();
  await page.getByLabel('Username or email').fill('fixture.customer');
  await page.getByLabel('I request this verification code on WhatsApp').check();
  await page.getByRole('button', { name: 'Send sign-in code', exact: true }).click();
  await expect(page.getByLabel('One-time code')).toBeVisible();
  expect(submitted).toEqual({ identifier: 'fixture.customer', whatsappOtpConsent: true });
  await expect(page.getByText(/Requested delivery: email not_requested, WhatsApp queued/)).toBeVisible();
});

test('marketing combobox previews the pending collection draft while exclusive offer stays unavailable', async ({ page }) => {
  await mockApi(page, { active: true });
  const template = { name: 'rk_new_collection_drop', language: 'en_US', category: 'MARKETING', parameters: ['first_name', 'collection_name'], approved: false, enabled: false, observedStatus: 'PENDING', statusStale: false, componentsVerified: false, components: [{ type: 'HEADER', text: 'A New Collection Has Arrived' }, { type: 'BODY', text: 'Hello {{1}}, Discover {{2}}.' }, { type: 'FOOTER', text: 'Rashi Kapoor' }] };
  let savedDraft: Record<string, unknown> | null = null;
  await page.route('**/api/admin/integrations/whatsapp/campaigns/**', async route => {
    if (route.request().url().endsWith('/options')) return route.fulfill({ json: { collections: [{ id: 'fixture-collection', name: 'Actual Collection', slug: 'actual-collection', path: '/collections/actual-collection', productCount: 3 }], couponIntegrationAvailable: false, marketingEnabled: false, templates: { new_collection_drop: template }, unavailableTemplates: { exclusive_offer: { name: 'rk_exclusive_offer', language: 'en_US', category: 'MARKETING', reason: 'coupon_integration_unavailable' } } } });
    if (route.request().url().endsWith('/drafts')) { savedDraft = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { status: 'draft', draftId: 'fixture-draft', templateStatus: 'PENDING', destinationUrl: 'https://rashikapoor.co.in/collections/actual-collection' } }); }
    return route.fulfill({ json: { template, recipientCount: 1, excluded: { no_active_marketing_consent: 2 }, samples: [{ recipient: '***2671', body: 'Hello Fixture,\nDiscover Actual Collection.', variables: { first_name: 'Fixture', collection_name: 'Actual Collection' } }], previewDigest: 'fixture-digest', canAuthorize: false, disabledReasons: ['marketing_automation_disabled', 'template_not_approved_or_enabled'], destinationUrl: 'https://rashikapoor.co.in/collections/actual-collection', destinationReachable: true } });
  });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Marketing Campaigns');
  const campaign = page.getByRole('region', { name: 'WhatsApp marketing campaigns' });
  const templatePicker = campaign.getByRole('combobox', { name: 'Campaign template' });
  await templatePicker.focus();
  await expect(campaign.getByRole('listbox', { name: 'Campaign templates' })).toBeVisible();
  const pendingOption = campaign.getByRole('option', { name: /rk_new_collection_drop.*PREVIEW ONLY/i });
  await expect(pendingOption).toBeVisible();
  await expect(pendingOption).toHaveAttribute('aria-description', /Preview only; sending is disabled/);
  await expect(campaign.getByText(/rk_exclusive_offer: Unavailable.*Coupon integration not configured/)).toBeVisible();
  await templatePicker.press('Escape');
  await campaign.getByRole('combobox', { name: /Collection/ }).selectOption('fixture-collection');
  await campaign.getByLabel('Campaign description').fill('Collection launch fixture');
  await campaign.getByLabel('Campaign expiry').fill('2027-01-01T12:00');
  await campaign.getByRole('button', { name: 'Save campaign draft' }).click();
  await expect(campaign).toContainText('Campaign draft saved (draft).');
  await expect.poll(() => savedDraft).not.toBeNull();
  expect(savedDraft!.event).toBe('new_collection_drop');
  expect(savedDraft!.collectionId).toBe('fixture-collection');
  await campaign.getByRole('button', { name: 'Preview campaign and audience' }).click();
  await expect(campaign).toContainText('Eligible recipient count: 1');
  await expect(campaign).toContainText('Discover Actual Collection.');
  await expect(campaign).toContainText('1. first_name: Fixture');
  await expect(campaign.getByRole('link')).toHaveAttribute('href', 'https://rashikapoor.co.in/collections/actual-collection');
  await expect(campaign.getByLabel('I authorize this exact audience')).toBeDisabled();
  await expect(campaign.getByRole('button', { name: 'Authorize campaign schedule' })).toBeDisabled();
  await expect(campaign.getByText(/PENDING \/ IN_REVIEW/)).toBeVisible();
});

test('template library search, status filters, version nesting, and OTP status use the backend registry', async ({ page }) => {
  await mockApi(page, { active: true, catalogue: true });
  await page.goto('/admin/integrations/whatsapp');
  await page.getByRole('tab', { name: 'Template Library', exact: true }).click();
  const library = page.getByRole('region', { name: 'Template Library' });
  await expect(library.getByText('Integration Test', { exact: true })).toBeVisible();
  await expect(library.getByText('Transactional', { exact: true })).toBeVisible();
  await expect(library.getByText('Version: rk_order_confirmation_v2')).toBeVisible();
  await expect(library).toContainText('MISSING_OR_UNKNOWN');
  await library.getByLabel('Search templates').fill('order_date');
  await expect(library.getByText('rk_order_confirmation', { exact: true })).toBeVisible();
  await expect(library.getByText('rk_new_collection_drop', { exact: true })).toHaveCount(0);
  await library.getByLabel('Template status filter').selectOption('APPROVED');
  await expect(library.getByRole('row').filter({ hasText: 'rk_order_confirmation' })).toBeVisible();
  await page.getByRole('tab', { name: 'OTP & Authentication', exact: true }).click();
  const otp = page.getByRole('tabpanel');
  await expect(otp).toContainText('rk_authentication_otp');
  await expect(otp).toContainText('Unavailable until this exact Authentication template is approved');
  await expect(otp).toContainText('account-level restriction on creating Authentication templates');
  await expect(otp).toContainText('Email OTP');
  await page.getByRole('tab', { name: 'Advanced Settings', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Enable WhatsApp messaging', exact: true })).toBeDisabled();
});

test('three absent local records are identified as unsubmitted drafts with reasons', async ({ page }) => {
  await mockApi(page, { active: true, catalogue: true });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Template Library');
  const library = page.getByRole('region', { name: 'Template Library' });
  await library.getByLabel('Template status filter').selectOption('Local draft');
  const drafts = library.getByRole('heading', { name: 'Local drafts - not submitted' });
  await expect(drafts).toBeVisible();
  const rows = library.locator('table').last();
  await expect(rows.getByRole('row').filter({ hasText: 'rk_authentication_otp' })).toContainText('creation');
  await expect(rows.getByRole('row').filter({ hasText: 'rk_exclusive_offer' })).toContainText('coupon');
  await expect(rows.getByRole('row').filter({ hasText: 'rk_admin_notification' })).toContainText('Internal-only');
  await library.getByLabel('Template status filter').selectOption('All');
  await expect(library.getByRole('row').filter({ hasText: 'rk_test' })).toContainText('en');
  await expect(library.getByRole('row').filter({ hasText: 'rk_test' })).toContainText('MARKETING');
});

for (const width of [1440, 390]) test(`local draft dispositions and inventory counts stay consistent at ${width}px`, async ({ page }) => {
  const calls = await mockApi(page);
  const draft = (name: string, category = 'UTILITY') => ({ name, category, language: 'en_US', parameters: [],
    enabled: false, approved: false, localDraft: true, presentInMeta: false, observedStatus: 'MISSING_OR_UNKNOWN',
    draftExplanation: 'Submit the exact old contract and refresh Meta status.' });
  const confirmation = { name: 'rk_order_confirmation', category: 'UTILITY', language: 'en_US', parameters: ['customer_name'],
    enabled: true, approved: true, observedStatus: 'APPROVED', componentsVerified: true, locallyMapped: true, mappingEnabled: true, templateGroup: 'Transactional' };
  await page.route('**/api/admin/integrations/whatsapp', route => route.fulfill({ json: {
    ...integration, configured: true, missing: [], environment: 'production', marketingEnabled: false,
    templates: { order_confirmation: confirmation },
    catalogue: {
      confirmation,
      placed: draft('rk_order_placed'), status: draft('rk_order_status_update'),
      authentication: draft('rk_authentication_otp', 'AUTHENTICATION'),
      offer: draft('rk_exclusive_offer', 'MARKETING'), admin: draft('rk_admin_notification'),
      obsoleteTest: draft('rk_test'),
      replacement: { ...draft('order_received'), localDraft: false, presentInMeta: true,
        observedStatus: 'PENDING', templateGroup: 'Optional lifecycle drafts' },
    },
    unmappedTemplates: [{ name: 'rk_test', category: 'MARKETING', language: 'en', status: 'APPROVED',
      qualityRating: 'UNKNOWN', evidenceState: 'found_not_locally_mapped' }],
  } }));
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Template Library');
  const library = page.getByRole('region', { name: 'Template Library' });
  for (const count of ['2 approved', '1 in review / refresh required', '0 missing / unknown', '5 local drafts not submitted']) {
    await expect(library.getByText(count, { exact: true })).toBeVisible();
  }
  for (const [name, replacement] of [['rk_order_placed', 'order_received'], ['rk_order_status_update', 'order_and_payment_update']]) {
    const row = library.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('Superseded');
    await expect(row).toContainText(`Superseded by ${replacement}.`);
    await expect(row).toContainText('must not be submitted to Meta');
    await expect(row).not.toContainText('Submit the exact old');
  }
  await expect(library.getByRole('row').filter({ hasText: 'rk_authentication_otp' })).toContainText('Meta has denied Authentication-template creation for this WABA');
  await expect(library.getByRole('row').filter({ hasText: 'rk_exclusive_offer' })).toContainText('coupon and promotion system');
  await expect(library.getByRole('row').filter({ hasText: 'rk_admin_notification' })).toContainText('Internal-only template');
  const marketingRow = library.getByRole('row').filter({ hasText: 'rk_test' });
  await expect(marketingRow).toHaveCount(1);
  await expect(marketingRow).toContainText('MARKETING');
  await expect(marketingRow).not.toContainText('UTILITY');
  await expect(marketingRow).toContainText('Marketing gate is disabled; unavailable for sending.');
  await library.getByLabel('Template status filter').selectOption('Local draft');
  await expect(library.getByRole('row').filter({ hasText: 'rk_test' })).toHaveCount(0);
  await expect(library.getByRole('row')).toHaveCount(6); // Header plus the five retained drafts.
  await library.getByLabel('Template status filter').selectOption('In Review');
  await library.getByRole('button', { name: /Show optional templates/ }).click();
  const pending = library.getByRole('row').filter({ hasText: 'order_received' });
  await expect(pending).toContainText('PENDING / IN_REVIEW');
  await expect(pending).toContainText('Unavailable: fresh Meta approval and exact component verification are required.');
  await library.getByLabel('Template status filter').selectOption('APPROVED');
  await expect(library.getByRole('row').filter({ hasText: 'order_received' })).toHaveCount(0);
  await expect(library.getByRole('row').filter({ hasText: 'rk_order_confirmation' })).toContainText('Mapped · enabled');
  expect(calls.sent).toEqual([]);
  await library.getByLabel('Template status filter').selectOption('Local draft');
  await page.screenshot({ path: `test-results/template-library-drafts-${width}.png`, fullPage: true });
});

test('optional lifecycle submissions are collapsed and expand separately', async ({ page }) => {
  await mockApi(page, { active: true, catalogue: true });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Template Library');
  const library = page.getByRole('region', { name: 'Template Library' });
  const optional = library.getByRole('button', { name: /Show optional templates \(\d+\)/ });
  await expect(optional).toBeVisible();
  await expect(library.getByText('rk_payment_failure', { exact: true })).toHaveCount(0);
  await optional.click();
  await expect(library.getByText('rk_payment_failure', { exact: true })).toBeVisible();
  await expect(library.getByText('PENDING / IN_REVIEW', { exact: true })).toHaveCount(3);
});

test('campaign template combobox stays accessible and does not cover adjacent or mobile controls', async ({ page }) => {
  await mockApi(page, { active: true });
  await page.route('**/api/admin/integrations/whatsapp/campaigns/options', async route => route.fulfill({ json: {
    collections: [{ id: 'fixture-collection', name: 'Actual Collection', slug: 'actual-collection', path: '/collections/actual-collection', productCount: 3 }],
    templates: { new_collection_drop: { name: 'rk_new_collection_drop', category: 'MARKETING', language: 'en_US', parameters: ['first_name', 'collection_name'], enabled: false, approved: false, observedStatus: 'PENDING' } },
    unavailableTemplates: { exclusive_offer: { name: 'rk_exclusive_offer', language: 'en_US', category: 'MARKETING', reason: 'coupon_integration_unavailable' } }, marketingEnabled: false,
  } }));
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Marketing Campaigns');
  const campaign = page.getByRole('region', { name: 'WhatsApp marketing campaigns' });
  const input = campaign.getByRole('combobox', { name: 'Campaign template' });
  await input.focus();
  await input.press('ArrowDown');
  await expect(campaign.getByRole('option', { name: /rk_new_collection_drop/ })).toHaveAttribute('aria-description', /sending is disabled/);
  await input.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await input.focus();
  await input.press('ArrowDown');
  const list = campaign.getByRole('listbox', { name: 'Campaign templates' });
  const collection = campaign.getByRole('combobox', { name: 'Collection' });
  const listBox = await list.boundingBox();
  const collectionBox = await collection.boundingBox();
  expect(listBox).not.toBeNull(); expect(collectionBox).not.toBeNull();
  expect(listBox!.y + listBox!.height).toBeLessThanOrEqual(collectionBox!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('tab navigation stays within the viewport at desktop, tablet, and mobile widths', async ({ page }) => {
  await mockApi(page, { active: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin/integrations/whatsapp');
    await page.getByRole('tab', { name: 'Message Logs', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Message Logs', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('profile can withdraw marketing without withdrawing transactional preferences', async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  const user = { id: 'fixture-customer', role: 'customer', isActive: true, email: 'fixture@example.test', username: 'fixture.customer', firstName: 'Fixture', lastName: 'Customer', phone: '+14155552671', dob: '1990-01-01', gender: 'female', whatsappNotifications: true, whatsappConsentValid: true, whatsappMarketingConsentValid: true, whatsappMarketingNotifications: true, whatsappMarketingPhone: '+14155552671' };
  await page.addInitScript(() => localStorage.setItem('rk_access_token', 'fixture-token'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user } });
    if (url.pathname === '/api/auth/profile') {
      submitted = route.request().postDataJSON();
      return route.fulfill({ json: { user: { ...user, ...submitted } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { addresses: [] } });
    if (url.origin !== 'http://127.0.0.1:3210') return route.fulfill({ status: 204, body: '' });
    return route.continue();
  });
  await page.goto('/account/profile');
  const marketing = page.getByLabel(/I would also like to receive occasional collection launches/);
  await expect(marketing).toBeChecked();
  await marketing.uncheck();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => submitted).not.toBeNull();
  expect(submitted!.whatsappMarketingNotifications).toBe(false);
  expect(submitted!.whatsappNotifications).toBe(true);
});


test('valid WhatsApp consent uses the account number independently of delivery contact', async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.addInitScript(() => {
    localStorage.setItem('rk_access_token', 'fixture-token');
    localStorage.setItem('rk_shopping_bag', JSON.stringify({ currency: 'INR', items: [{ productId: 'fixture-product', variantId: 'fixture-colour', sku: 'RK-1-RED', name: 'Fixture garment', price: 1250, quantity: 1, size: 'M' }] }));
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'fixture', role: 'customer', email: 'customer@example.test', whatsappPhone: '+14155552671', whatsappConsentValid: true } } });
    if (url.pathname === '/api/auth/addresses') return route.fulfill({ json: { addresses: [{ id: 'saved-address', fullName: 'Fixture Customer', phone: '+919619888755', line1: 'Fixture Street', city: 'Mumbai', state: 'Maharashtra', country: 'India', postalCode: '400001', isDefault: true }] } });
    if (url.pathname === '/api/payments/razorpay/order') {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 502, json: { error: 'Mock payment provider unavailable.' } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    if (url.origin !== 'http://127.0.0.1:3210') return route.fulfill({ status: 204, body: '' });
    return route.continue();
  });
  await page.goto('/checkout');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /Keep me updated on WhatsApp/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Same as contact phone', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: /^Pay / }).click();
  await expect.poll(() => submitted).not.toBeNull();
  expect(submitted!.whatsappRecipient).toBe('+14155552671');
  expect(submitted!.whatsappTransactionalConsent).toBeUndefined();
  expect((submitted!.shipping as { phone: string }).phone).toBe('+919619888755');
  await expect(page.getByRole('textbox', { name: 'Full name' })).toHaveValue('Fixture Customer');
});

test('production diagnostics explain restrictions without enabling template sending', async ({ page }) => {
  const calls = await mockApi(page, { active: true, production: true,
    productionTest: { enabled: false, expiresAt: null }, diagnostics: [
      { code: 'production_test_disabled', severity: 'warning', message: 'Manual production testing is off. Configure WHATSAPP_PRODUCTION_TEST_SEND_ENABLED and a short UTC expiry in the backend.' },
      { code: 'meta_billing_issue_recorded', severity: 'warning', message: 'Recorded Meta billing restriction. A card charge does not confirm billing clearance.' },
      { code: 'meta_phone_code_status_review', severity: 'info', message: 'Meta reports code_verification_status NOT_VERIFIED, while the sender status is CONNECTED. Review both fields; do not re-register from this mismatch alone.' },
      { code: 'meta_waba_not_subscribed', severity: 'warning', message: 'Confirm the WABA app subscription and messages webhook field.' },
    ] });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Test Messages');
  await openSection(page, 'Diagnostics');
  const diagnostics = page.getByRole('region', { name: 'Messaging diagnostics' });
  await diagnostics.getByText('Existing configuration notes', { exact: true }).click();
  await expect(diagnostics).toContainText('WHATSAPP_PRODUCTION_TEST_SEND_ENABLED');
  await expect(diagnostics).toContainText('code_verification_status NOT_VERIFIED');
  await expect(diagnostics).toContainText('card charge does not confirm billing clearance');
  await expect(diagnostics).toContainText('messages webhook field');
  await openSection(page, 'Test Messages');
  await expect(page.getByLabel('Selected template eligibility diagnostics')).toContainText('application test-send gate is off or expired');
  await expect(page.getByRole('button', { name: 'Send approved test template', exact: true })).toBeDisabled();
  expect(calls.sent).toHaveLength(0);
});

test('diagnostics live only in their tab, count semantics correctly and expand each row', async ({ page }) => {
  await mockApi(page);
  const titles = ['Application configuration', 'Messaging health and billing', 'Sender and business status', 'Template eligibility', 'App-level webhook subscription', 'Worker status and configuration', 'Outbox status'];
  const keys = ['configuration', 'billing', 'sender', 'templates', 'webhook', 'worker', 'outbox'];
  const statuses = ['VERIFIED', 'ACTION REQUIRED', 'BLOCKED', 'UNKNOWN', 'NOT VERIFIED', 'STALE EVIDENCE', 'UNKNOWN'];
  await page.route('**/api/admin/integrations/whatsapp', route => route.fulfill({ json: { ...integration,
    diagnosticChecks: keys.map((key, index) => ({ key, status: statuses[index], checkedAt: '2026-11-18T10:00:00Z',
      reason: `Evidence for ${key}`, action: `Review ${key}`, source: 'Mocked scoped evidence',
      evidence: { imageParity: 'UNKNOWN (host access required)', codeVersionMatches: false, customerPhone: '+14155552671', accessToken: 'fixture-secret-must-not-render',
        authorizationHeader: 'Bearer fixture-authorization-must-not-render', customerName: 'Private Customer Name', email: 'private.customer@example.test',
        messageBody: 'private message must not render', nested: { recipient: '+14155552671', message: 'private body must not render' } } })),
  } }));
  await page.goto('/admin/integrations/whatsapp');
  await expect(page.getByRole('region', { name: 'Messaging diagnostics' })).toHaveCount(0);
  const summary = page.getByLabel('Diagnostic status summary');
  for (const label of ['1 Verified', '1 Action Required', '1 Blocked', '4 Unknown / Not Verified']) await expect(summary.getByText(label, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View Diagnostics', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Diagnostics', exact: true })).toHaveAttribute('aria-selected', 'true');
  const diagnostics = page.getByRole('region', { name: 'Messaging diagnostics' });
  await expect(diagnostics.getByRole('article')).toHaveCount(7);
  for (const title of titles) {
    const expand = diagnostics.getByRole('button', { name: `Expand ${title}`, exact: true });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expand.click();
    const collapse = diagnostics.getByRole('button', { name: `Collapse ${title}`, exact: true });
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    const row = diagnostics.getByRole('article', { name: `${title} diagnostic`, exact: true });
    const raw = row.locator('details');
    await expect(raw).not.toHaveAttribute('open', '');
    await raw.getByText('Raw diagnostic evidence', { exact: true }).click();
    await expect(raw).not.toContainText('fixture-secret-must-not-render');
    await expect(raw).not.toContainText('fixture-authorization-must-not-render');
    await expect(raw).not.toContainText('+14155552671');
    await expect(raw).not.toContainText('Private Customer Name');
    await expect(raw).not.toContainText('private.customer@example.test');
    await expect(raw).not.toContainText('private message must not render');
    await expect(raw).not.toContainText('private body must not render');
    await collapse.click();
  }
  await openSection(page, 'Test Messages');
  await expect(page.getByRole('region', { name: 'Messaging diagnostics' })).toHaveCount(0);
});

test('refresh is read-only, prevents duplicates and retains scoped timestamps and failed evidence', async ({ page }) => {
  const calls = await mockApi(page);
  const rows = ['configuration', 'billing', 'sender', 'templates', 'webhook', 'worker', 'outbox'].map(key => ({ key,
    status: 'UNKNOWN', checkedAt: '2026-11-17T10:00:00Z', reason: `Old ${key} evidence`, source: 'Scoped fixture', action: 'Review evidence' }));
  await page.route('**/api/admin/integrations/whatsapp', route => route.fulfill({ json: { ...integration, diagnosticChecks: rows } }));
  const mutations: { path: string; body: unknown }[] = [];
  page.on('request', request => { if (request.method() === 'POST' || request.method() === 'PATCH') mutations.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() }); });
  let release!: () => void;
  let count = 0;
  const waitForRelease = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/admin/integrations/whatsapp/diagnostics/refresh', async route => {
    count++;
    if (count === 1) {
      await waitForRelease;
      return route.fulfill({ json: { status: { ...integration, diagnosticChecks: rows.map(row => row.key === 'sender' ? { ...row, status: 'VERIFIED', checkedAt: '2026-11-19T10:00:00Z', reason: 'Fresh sender evidence' } : row) } } });
    }
    return route.fulfill({ status: 503, json: { error: 'Scoped refresh failed' } });
  });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Diagnostics');
  const diagnostic = page.getByRole('region', { name: 'Messaging diagnostics' });
  const oldTime = await diagnostic.getByRole('article', { name: 'Application configuration diagnostic', exact: true }).locator('time').getAttribute('dateTime');
  const refresh = diagnostic.getByRole('button', { name: 'Refresh Sender and business status', exact: true });
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(diagnostic.getByRole('button', { name: /^Refreshing/ })).toBeDisabled();
  await refresh.dispatchEvent('click');
  expect(count).toBe(1);
  release();
  await expect(refresh).toBeEnabled();
  await expect(diagnostic.getByRole('article', { name: 'Sender and business status diagnostic', exact: true })).toContainText('Fresh sender evidence');
  expect(await diagnostic.getByRole('article', { name: 'Application configuration diagnostic', exact: true }).locator('time').getAttribute('dateTime')).toBe(oldTime);
  await diagnostic.getByRole('button', { name: 'Refresh All Diagnostics', exact: true }).click();
  await expect(diagnostic.getByRole('alert')).toContainText('Scoped refresh failed');
  await expect(diagnostic.getByRole('article', { name: 'Sender and business status diagnostic', exact: true })).toContainText('Fresh sender evidence');
  expect(mutations).toEqual([
    { path: '/api/admin/integrations/whatsapp/diagnostics/refresh', body: { scope: 'sender' } },
    { path: '/api/admin/integrations/whatsapp/diagnostics/refresh', body: { scope: 'all' } },
  ]);
  expect(calls.sent).toEqual([]);
});

for (const width of [1440, 768, 390]) test(`compact diagnostic rows and expanded evidence fit ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  const calls = await mockApi(page);
  const scopes = ['configuration', 'billing', 'sender', 'templates', 'webhook', 'worker', 'outbox'];
  const states = ['VERIFIED', 'NOT VERIFIED', 'ACTION REQUIRED', 'UNKNOWN', 'VERIFIED', 'NOT VERIFIED', 'BLOCKED'];
  await page.route('**/api/admin/integrations/whatsapp', route => route.fulfill({ json: { ...integration,
    diagnosticChecks: scopes.map((key, index) => ({ key, status: states[index], checkedAt: '2026-11-19T06:00:00Z',
      reason: key === 'worker' ? 'Observed worker evidence is stale; host image parity is not verified.' : `Scoped ${key} evidence requires review.`,
      action: key === 'worker' ? 'Inspect the protected worker observation and image parity on the host.' : 'Review the scoped backend evidence.', source: 'Isolated diagnostic fixture',
      evidence: key === 'worker' ? { imageParity: 'UNKNOWN (host access required)', codeVersionMatches: false, environmentDatabaseConsistency: true, executionState: 'UNKNOWN', pendingJobs: 2, failedJobs: 1 }
        : key === 'outbox' ? { pending: 2, processing: 0, held: 1, failed: 1, unknown: 0 } : {},
    })),
  } }));
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Diagnostics');
  const diagnostic = page.getByRole('region', { name: 'Messaging diagnostics' });
  await expect(diagnostic.getByRole('article')).toHaveCount(7);
  expect(await diagnostic.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  const workerRow = diagnostic.getByRole('article', { name: 'Worker status and configuration diagnostic', exact: true });
  const header = workerRow.locator(':scope > div').first();
  const boxes = await Promise.all([header.locator('h3'), header.locator('span').first(), header.locator('p').nth(1), header.locator('p').nth(2)].map(locator => locator.boundingBox()));
  for (const [left, right] of [[boxes[0]!, boxes[1]!], [boxes[2]!, boxes[3]!]]) {
    const overlaps = Math.max(left.x, right.x) < Math.min(left.x + left.width, right.x + right.width) && Math.max(left.y, right.y) < Math.min(left.y + left.height, right.y + right.height);
    expect(overlaps).toBe(false);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`diagnostics-${width}.png`), fullPage: true });
  await diagnostic.getByRole('button', { name: 'Expand Worker status and configuration', exact: true }).click();
  await expect(diagnostic).toContainText('UNKNOWN (host access required)');
  expect(await diagnostic.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`diagnostics-expanded-${width}.png`), fullPage: true });
  expect(calls.sent).toEqual([]);
});


test('international country combobox integrates search and selection in one field', async ({ page }) => {
  await mockLinkedCheckout(page);
  const field = page.getByRole('group', { name: 'WhatsApp number for this order', exact: true }).getByRole('combobox', { name: 'Country and dialling code', exact: true });
  await expect(field).toHaveCount(1);
  await expect(page.getByLabel('Search telephone countries')).toHaveCount(0);
  await expect(page.locator('select').filter({ has: page.locator('option[value="IN"]') })).toHaveCount(0);
  for (const query of ['India', 'IN', '+91']) {
    await field.fill(query);
    await expect(field).toHaveAttribute('aria-expanded', 'true');
    const india = page.getByRole('option', { name: /India \(\+91\)$/ });
    await expect(india).toBeVisible();
    if (query === '+91') await expect(page.getByRole('listbox', { name: 'Telephone countries' }).getByRole('option')).toHaveCount(1);
    await india.click();
    await expect(field).toHaveValue(/India \(\+91\)/);
    await expect(field).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('listbox', { name: 'Telephone countries' })).toHaveCount(0);
  }
  await page.getByLabel('Mobile number', { exact: true }).fill('9619888755');
  await selectPhoneCountry(page, 'GB');
  await expect(field).toHaveValue(/United Kingdom \(\+44\)/);
  await expect(page.getByLabel('Mobile number', { exact: true })).toHaveValue('');
});

test('international country combobox supports arrows Enter Escape and Tab', async ({ page }) => {
  await mockLinkedCheckout(page);
  const field = page.getByRole('group', { name: 'WhatsApp number for this order', exact: true }).getByRole('combobox', { name: 'Country and dialling code', exact: true });
  await field.focus();
  await expect(field).toHaveAttribute('aria-expanded', 'true');
  await field.fill('India');
  await field.press('ArrowDown');
  await field.press('ArrowUp');
  await field.press('Enter');
  await expect(field).toHaveValue(/India \(\+91\)/);
  await field.press('u'); // Start a new search while the closed field still has focus.
  await expect(field).toHaveValue('u');
  await field.fill('United');
  await field.press('ArrowUp'); // Wrap to the last result, United States.
  await field.press('Enter');
  await expect(field).toHaveValue(/United States \(\+1\)/);
  await field.fill('no-such-country');
  await expect(page.getByRole('status')).toContainText('No matching countries');
  await field.press('Escape');
  await expect(field).toHaveValue(/United States \(\+1\)/);
  await field.press('ArrowDown');
  await expect(field).toHaveAttribute('aria-expanded', 'true');
  await field.press('Tab');
  await expect(field).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Mobile number', { exact: true })).toBeFocused();
});

for (const width of [1440, 390]) test(`international country combobox closes outside and escapes clipping at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await mockLinkedCheckout(page);
  const field = page.getByRole('group', { name: 'WhatsApp number for this order', exact: true }).getByRole('combobox', { name: 'Country and dialling code', exact: true });
  const original = await field.inputValue();
  await field.evaluate(element => { element.closest('fieldset')!.style.overflow = 'hidden'; });
  await field.fill('India');
  const list = page.getByRole('listbox', { name: 'Telephone countries' });
  await expect(list).toBeVisible();
  expect(await list.evaluate(element => element.parentElement === document.body)).toBe(true);
  const box = await list.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  await page.getByLabel('Mobile number', { exact: true }).click();
  await expect(list).toHaveCount(0);
  await expect(field).toHaveValue(original);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
