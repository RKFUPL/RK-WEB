import { expect, test, type Page } from '@playwright/test';

async function selectPhoneCountry(page: Page, code: 'US' | 'GB') {
  const country = code === 'US' ? /United States \(\+1\)$/ : /United Kingdom \(\+44\)$/;
  await page.getByRole('combobox', { name: 'Country and dialling code', exact: true }).last().fill(code);
  await page.getByRole('option', { name: country }).click();
}


const fixtureOrder = () => ({ id: 'manual-order', orderNumber: 'RK-MANUAL-1', customerName: 'Fixture Customer', email: 'fixture@example.test',
  total: 1000, payment: { gateway: 'manual', status: 'pending' }, paymentStatus: 'pending',
  fulfillment: { status: 'order_placed' }, fulfillmentStatus: 'order_placed', availableActions: ['confirmed', 'cancelled'],
  timeline: [], items: [{ name: 'Fixture couture', sku: 'RK-IVORY', size: 'M', quantity: 1, unitPrice: 1000 }],
  createdAt: '2026-11-19T06:00:00Z', paymentTransactions: [] as { id: string; amount: number; amountPaise: number; method: string; timestamp: string; recordedBy: string; event: string }[],
  paymentCollection: { total: 1000, received: 0, balanceDue: 1000, status: 'pending', instructions: 'Wait for payment instructions.' },
  whatsappUpdates: { number: '+14155552671', enabled: false },
  whatsapp: { consent: 'missing', automationEnabled: false, templates: [], activity: [] },
});

test('admin orders paginate, toggle every fulfilment card and retain search and payment filters', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rk_access_token', 'synthetic-admin-token'));
  const calls: URLSearchParams[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'synthetic-admin', role: 'admin', isActive: true, must_change_password: false } } });
    if (url.pathname === '/api/staff/orders') {
      calls.push(url.searchParams);
      const currentPage = Number(url.searchParams.get('page') || 1);
      return route.fulfill({ json: { orders: [{ ...fixtureOrder(), id: `synthetic-${currentPage}`, orderNumber: `PAGE-${currentPage}` }], page: currentPage, pageSize: 50, total: 80, totalPages: 2,
        ...(url.searchParams.get('includeCounts') !== 'false' ? { counts: { payment: { pending: 80 }, fulfillment: { processing: 20, packed: 10, returns: 6, cancelled: 10 } } } : {}) } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/admin/orders?q=SYNTHETIC&payment=pending');
  await expect(page.getByText('#PAGE-1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pending: 80', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('#PAGE-2', { exact: true })).toBeVisible();
  expect(calls.at(-1)?.get('includeCounts')).toBe('false');
  for (const label of ['Processing', 'Packed', 'Shipped', 'Out for delivery', 'Delivered', 'Returns', 'Cancelled']) {
    const card = page.getByRole('button', { name: new RegExp(`^${label}\\s+\\d+$`, 'i') });
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    const expected = label.toLowerCase().replaceAll(' ', '_');
    await expect(page.getByLabel('Fulfillment', { exact: true })).toHaveValue(expected);
    await expect.poll(() => calls.at(-1)?.get('fulfillment')).toBe(expected);
    expect(calls.at(-1)?.get('q')).toBe('SYNTHETIC');
    expect(calls.at(-1)?.get('payment')).toBe('pending');
    expect(new URL(page.url()).searchParams.get('fulfillment')).toBe(expected);
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByLabel('Fulfillment', { exact: true })).toHaveValue('all');
    await expect.poll(() => calls.at(-1)?.has('fulfillment')).toBe(false);
  }
  await page.getByRole('button', { name: /^Processing / }).click();
  await page.getByRole('button', { name: /^Packed / }).click();
  await expect(page.getByRole('button', { name: /^Processing / })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /^Packed / })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Fulfillment', { exact: true })).toHaveValue('packed');
});

test('admin orders show loading and errors while preventing obsolete filter results', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rk_access_token', 'synthetic-admin-token'));
  const requests: string[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'admin', role: 'admin', isActive: true, must_change_password: false } } });
    if (url.pathname === '/api/staff/orders') {
      const filter = url.searchParams.get('fulfillment') || 'all'; requests.push(filter);
      if (filter === 'processing') await new Promise(resolve => setTimeout(resolve, 800));
      if (filter === 'cancelled') return route.fulfill({ status: 503, json: { error: 'Synthetic list unavailable' } });
      try { return await route.fulfill({ json: { orders: [{ ...fixtureOrder(), orderNumber: filter }], total: 1, totalPages: 1, counts: { payment: { pending: 1 }, fulfillment: {} } } }); } catch { /* Aborted stale request. */ }
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/admin/orders');
  await expect(page.getByText('#all', { exact: true })).toBeVisible();
  await page.getByLabel('Fulfillment', { exact: true }).selectOption('processing');
  await expect(page.getByRole('status').filter({ hasText: 'Loading orders' })).toBeVisible();
  await expect(page.getByText('#all', { exact: true })).toBeVisible();
  await expect.poll(() => requests.includes('processing')).toBe(true);
  await page.getByLabel('Fulfillment', { exact: true }).selectOption('packed');
  await expect(page.getByText('#packed', { exact: true })).toBeVisible();
  await page.waitForTimeout(850);
  await expect(page.getByText('#processing', { exact: true })).toHaveCount(0);
  await page.getByLabel('Fulfillment', { exact: true }).selectOption('cancelled');
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic list unavailable' })).toBeVisible();
  await expect(page.getByText('#packed', { exact: true })).toBeVisible();
});

async function setup(page: Page, online = false, admin = false, mandatory = false, settingsError = false) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let order = fixtureOrder();
  await page.addInitScript(() => {
    localStorage.setItem('rk_access_token', 'fixture-token');
    localStorage.setItem('rk_shopping_bag', JSON.stringify({ currency: 'INR', items: [{ productId: 'fixture-product', variantId: 'colour:ivory', sku: 'RK-IVORY', name: 'Fixture couture', price: 1000, quantity: 1, size: 'M' }] }));
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'fixture', role: admin ? 'admin' : 'customer', email: 'fixture@example.test', isActive: true, whatsappPhone: '+14155552671', whatsappConsentValid: true } } });
    if (path === '/api/auth/addresses') return route.fulfill({ json: { addresses: [{ id: 'address1', fullName: 'Fixture Customer', phone: '+14155552671', line1: 'Fixture road', city: 'City', state: 'State', postalCode: '12345', country: 'US', isDefault: true }] } });
    if (path === '/api/storefront-settings') return route.fulfill(settingsError ? { status: 503, json: { error: 'Unavailable' } } : { json: { settings: { razorpayEnabled: online, requireWhatsappConsentForCheckout: mandatory } } });
    if (path === '/api/payments/razorpay/order') {
      calls.push({ path, body: route.request().postDataJSON() });
      return route.fulfill({ json: online ? { order, razorpay: { keyId: 'public-fixture-key', amount: 100000, currency: 'INR', orderId: 'gateway-fixture', mode: 'live' } } : { paymentMode: 'manual', order } });
    }
    if (path === '/api/staff/orders/manual-order/payments') {
      const body = route.request().postDataJSON(); calls.push({ path, body });
      const amount = body.action === 'half' ? 500 : body.action === 'remaining' ? order.paymentCollection.balanceDue : Number(body.amount);
      const received = order.paymentCollection.received + amount;
      const transaction = { id: body.transactionId, amount, amountPaise: amount * 100, method: body.method, timestamp: new Date().toISOString(), recordedBy: 'fixture-staff', event: received === 1000 ? 'payment_received' : 'part_payment_received' };
      order = { ...order, paymentTransactions: [...order.paymentTransactions, transaction], paymentStatus: received === 1000 ? 'paid' : 'partial', payment: { gateway: 'manual', status: received === 1000 ? 'paid' : 'partial' }, paymentCollection: { ...order.paymentCollection, received, balanceDue: 1000 - received, status: received === 1000 ? 'paid' : 'partial' } };
      return route.fulfill({ json: { order } });
    }
    if (path === '/api/orders/manual-order/whatsapp-consent') {
      const body = route.request().postDataJSON(); calls.push({ path, body });
      order = { ...order, whatsappUpdates: { number: String(body.whatsappRecipient), enabled: true } };
      return route.fulfill({ json: { order } });
    }
    if (path === '/api/staff/orders/manual-order' || path === '/api/payments/orders/manual-order' || path === '/api/orders/manual-order') return route.fulfill({ json: { order } });
    if (path.startsWith('/api/')) return route.fulfill({ json: {} });
    if (url.href === 'https://checkout.razorpay.com/v1/checkout.js') return route.fulfill({ contentType: 'text/javascript', body: 'window.Razorpay = class { constructor(options) { window.fixtureRazorpayOptions = options; } on() {} open() { window.fixtureRazorpayOpened = true; } }' });
    if (url.origin !== 'http://127.0.0.1:3210') return route.fulfill({ status: 204, body: '' });
    return route.continue();
  });
  return calls;
}

for (const width of [1440, 768, 390]) {
  test(`manual checkout creates an order without loading Razorpay at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const calls = await setup(page);
    await page.goto('/checkout');
    await expect(page.getByRole('button', { name: 'Place order', exact: true })).toBeVisible();
    await expect(page.getByText(/We will contact you about availability and payment/)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /Keep me updated on WhatsApp/ })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Same as contact phone', exact: true })).not.toBeChecked();
    await page.screenshot({ path: info.outputPath(`manual-checkout-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Place order', exact: true }).click();
    await expect(page).toHaveURL(/order-success\/manual-order/);
    await expect(page.getByText('Order received', { exact: true })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.whatsappTransactionalConsent).toBeUndefined();
    expect(await page.locator('script[data-razorpay-checkout]').count()).toBe(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rk_shopping_bag') || '{}').items)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`manual-success-${width}.png`), fullPage: true });
  });

  test(`staff collects half and remaining balance at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const calls = await setup(page, false, true);
    await page.goto('/admin/orders/manual-order');
    const panel = page.getByRole('region', { name: 'Payment collection' });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Record 50% payment', exact: true }).click();
    await expect(panel).toContainText('Partially paid / balance due');
    expect(calls[0].body.action).toBe('half');
    expect(calls[0].body.transactionId).toBeTruthy();
    await expect(panel).toContainText('Recorded by fixture-staff');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`payment-collection-${width}.png`), fullPage: true });
    await panel.getByRole('button', { name: 'Record remaining balance', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Record remaining balance', exact: true })).toHaveCount(0);
    expect(calls[1].body.action).toBe('remaining');
    expect(calls[1].body.transactionId).not.toBe(calls[0].body.transactionId);
  });
}

test('enabled checkout retains the Razorpay browser flow and public key', async ({ page }) => {
  await setup(page, true);
  await page.goto('/checkout');
  await page.getByRole('button', { name: /^Pay / }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { fixtureRazorpayOpened?: boolean }).fixtureRazorpayOpened))).toBe(true);
  const options = await page.evaluate(() => (window as Window & { fixtureRazorpayOptions?: { key: string; order_id: string } }).fixtureRazorpayOptions);
  expect(options?.key).toBe('public-fixture-key');
  expect(options?.order_id).toBe('gateway-fixture');
});


test('admin can load and save the Razorpay switch without credentials', async ({ page }) => {
  await setup(page, true, true);
  let saved: Record<string, unknown> = {};
  await page.route('**/api/admin/settings', route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    return route.fulfill({ json: { settings: { razorpayEnabled: true, ...saved } } });
  });
  await page.goto('/admin/settings');
  const toggle = page.getByRole('switch', { name: 'Razorpay Online Payments', exact: true });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(toggle).not.toBeChecked();
  expect(saved.razorpayEnabled).toBe(false);
  expect(JSON.stringify(saved)).not.toMatch(/keyId|KEY_SECRET|WEBHOOK_SECRET/);
});


test('customer manual timeline never implies a verified payment', async ({ page }) => {
  await setup(page);
  await page.goto('/account/orders/manual-order');
  await expect(page.getByRole('region', { name: 'Payment collection' })).toContainText('Pending');
  await expect(page.getByText('Payment Confirmed', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Order Accepted', { exact: true })).toBeVisible();
  await expect(page.getByText('Wait for payment instructions.', { exact: true })).toBeVisible();
});

test('mandatory checkout has no popup and validates missing consent inline before placing the order', async ({ page }) => {
  const calls = await setup(page, false, false, true);
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: {
    id: 'fixture', role: 'customer', email: 'fixture@example.test', isActive: true,
    whatsappPhone: '+14155552671', whatsappConsentValid: false,
  } } }));
  await page.goto('/checkout');
  const consent = page.getByRole('checkbox', { name: /Keep me updated on WhatsApp about this order/ });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(consent).toBeVisible();
  await expect(consent).not.toBeChecked();
  await expect(consent).toHaveAttribute('required', '');
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await expect(page.getByText('Keep me updated on WhatsApp about this order, including order confirmation, payment, shipping and delivery updates.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Place order/ })).toBeEnabled();
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(page.locator('#whatsapp-consent-error')).toHaveText('Please agree to receive transactional WhatsApp updates to continue placing your order.');
  await expect(consent).toBeFocused();
  expect(calls).toHaveLength(0);
  await consent.check();
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].body.whatsappTransactionalConsent).toBe(true);
  expect(calls[0].body.whatsappRecipient).toBe('+14155552671');
  expect(calls[0].body.whatsappMarketingConsent).toBeUndefined();
});

test('optional checkout allows the customer to continue without transactional consent on mobile', async ({ page }) => {
  const calls = await setup(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: {
    id: 'fixture', role: 'customer', email: 'fixture@example.test', isActive: true,
    whatsappPhone: '+14155552671', whatsappConsentValid: false,
  } } }));
  await page.goto('/checkout');
  const consent = page.getByRole('checkbox', { name: /Keep me updated on WhatsApp about this order/ });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(consent).toBeVisible();
  await expect(consent).not.toBeChecked();
  await expect(page.getByRole('button', { name: /^Place order/ })).toBeEnabled();
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(page).toHaveURL(/order-success\/manual-order/);
  expect(calls[0].body.whatsappRecipient).toBe('');
  expect(calls[0].body.whatsappTransactionalConsent).toBe(false);
});

test('a valid signup or account grant suppresses the checkout checkbox in mandatory mode', async ({ page }) => {
  const calls = await setup(page, false, false, true);
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: {
    id: 'fixture', role: 'customer', email: 'fixture@example.test', isActive: true,
    whatsappPhone: '+14155552671', whatsappConsentValid: true,
  } } }));
  await page.goto('/checkout');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /Keep me updated on WhatsApp/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Place order/ })).toBeEnabled();
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].body.whatsappTransactionalConsent).toBe(true);
  expect(calls[0].body.whatsappRecipient).toBe('+14155552671');
});

test('mandatory checkout rechecks a saved grant and asks again if it was withdrawn after page load', async ({ page }) => {
  const calls = await setup(page, false, false, true);
  let profileReads = 0;
  await page.route('**/api/auth/me', route => {
    profileReads += 1;
    return route.fulfill({ json: { user: {
      id: 'fixture', role: 'customer', email: 'fixture@example.test', isActive: true,
      whatsappPhone: '+14155552671', whatsappConsentValid: profileReads === 1,
    } } });
  });
  await page.goto('/checkout');
  await expect(page.getByRole('checkbox', { name: /Keep me updated on WhatsApp/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Place order/ }).click();
  const consent = page.getByRole('checkbox', { name: /Keep me updated on WhatsApp about this order/ });
  await expect(consent).toBeVisible();
  await expect(consent).not.toBeChecked();
  await expect(page.locator('#whatsapp-consent-error')).toBeVisible();
  expect(calls).toHaveLength(0);
  await consent.check();
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(profileReads).toBeGreaterThanOrEqual(2);
  expect(calls[0].body.whatsappTransactionalConsent).toBe(true);
});

for (const scenario of [
  { name: 'withdrawn consent', whatsappPhone: '+14155552671', deliveryPhone: '+919769115870' },
  { name: 'changed WhatsApp number', whatsappPhone: '+442079460018', deliveryPhone: '+919769115870' },
]) {
  test(`${scenario.name} requires a fresh explicit checkout choice`, async ({ page }) => {
    const calls = await setup(page, false, false, true);
    await page.route('**/api/auth/me', route => route.fulfill({ json: { user: {
      id: 'fixture', role: 'customer', email: 'fixture@example.test', isActive: true,
      whatsappPhone: scenario.whatsappPhone, whatsappConsentValid: false,
    } } }));
    await page.route('**/api/auth/addresses', route => route.fulfill({ json: { addresses: [{ id: 'address1', fullName: 'Fixture Customer', phone: scenario.deliveryPhone, line1: 'Fixture road', city: 'City', state: 'State', postalCode: '12345', country: 'IN', isDefault: true }] } }));
    await page.goto('/checkout');
    const consent = page.getByRole('checkbox', { name: /Keep me updated on WhatsApp about this order/ });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(consent).not.toBeChecked();
    await expect(page.getByRole('textbox', { name: /^Phone/ })).toHaveValue(scenario.deliveryPhone.replace(/^\+91/, ''));
    await consent.check();
    await page.getByRole('button', { name: /^Place order/ }).click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0].body.whatsappRecipient).toBe(scenario.whatsappPhone);
    expect(calls[0].body.whatsappTransactionalConsent).toBe(true);
    expect((calls[0].body.shipping as { phone: string }).phone).toBe(scenario.deliveryPhone);
  });
}

test('a missing WhatsApp number is entered separately and is never copied from the delivery phone', async ({ page }) => {
  const calls = await setup(page, false, false, true);
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: {
    id: 'fixture', role: 'customer', email: 'fixture@example.test', isActive: true,
    whatsappPhone: '', phone: '+919769115870', whatsappConsentValid: false,
  } } }));
  await page.route('**/api/auth/addresses', route => route.fulfill({ json: { addresses: [{ id: 'address1', fullName: 'Fixture Customer', phone: '+919769115870', line1: 'Fixture road', city: 'City', state: 'State', postalCode: '12345', country: 'IN', isDefault: true }] } }));
  await page.goto('/checkout');
  const consent = page.getByRole('checkbox', { name: /Keep me updated on WhatsApp about this order/ });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Mobile number')).toHaveValue('');
  await expect(page.getByRole('textbox', { name: /^Phone/ })).toHaveValue('9769115870');
  await consent.check();
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(page.getByText('Enter a valid WhatsApp number for order updates.', { exact: true })).toBeVisible();
  expect(calls).toHaveLength(0);
  await selectPhoneCountry(page, 'US');
  await page.getByLabel('Mobile number').fill('4155552671');
  await expect(consent).not.toBeChecked();
  await consent.check();
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].body.whatsappRecipient).toBe('+14155552671');
  expect(calls[0].body.whatsappCountry).toBe('US');
  expect((calls[0].body.shipping as { phone: string }).phone).toBe('+919769115870');
});

test('checkout settings failure keeps order submission unavailable without showing a consent dialog', async ({ page }) => {
  const calls = await setup(page, false, false, false, true);
  await page.goto('/checkout');
  await expect(page.getByText('Unable to load checkout settings. Refresh and try again.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Pay|Place order)/ })).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls).toHaveLength(0);
});

for (const width of [1440, 768, 390]) {
  test(`inline checkout consent stays compact and within the viewport at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page, false, false, true);
    await page.route('**/api/auth/me', route => route.fulfill({ json: { user: {
      id: 'fixture', role: 'customer', email: 'fixture@example.test', isActive: true,
      whatsappPhone: '+14155552671', whatsappConsentValid: false,
    } } }));
    await page.goto('/checkout');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(2);
    await expect(page.getByRole('checkbox', { name: /Keep me updated on WhatsApp about this order/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`inline-whatsapp-consent-${width}.png`), fullPage: true });
  });
}

test('admin warning and acknowledgement guard the mandatory checkout switch', async ({ page }) => {
  await setup(page, false, true);
  let saved: Record<string, unknown> = {};
  await page.route('**/api/admin/settings', route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    return route.fulfill({ json: { settings: { razorpayEnabled: false, requireWhatsappConsentForCheckout: false, ...saved } } });
  });
  await page.goto('/admin/settings');
  const toggle = page.getByRole('switch', { name: 'Require Transactional WhatsApp Consent at Checkout' });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText(/Requiring WhatsApp consent as a condition of purchase may conflict/)).toBeVisible();
  await expect(page.getByText(/This setting controls checkout consent requirements only/)).toBeVisible();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.getByRole('checkbox', { name: /I have obtained legal\/compliance approval/ }).check();
  await toggle.click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(toggle).toBeChecked();
  expect(saved.requireWhatsappConsentForCheckout).toBe(true);
  expect(saved.requireWhatsappConsentAcknowledged).toBe(true);
});

test('admin communication collection mode saves without activating a WhatsApp gate', async ({ page }) => {
  await setup(page, false, true);
  let saved: Record<string, unknown> | null = null;
  await page.route('**/api/admin/settings', route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    return route.fulfill({ json: { settings: { razorpayEnabled: false, requireWhatsappConsentForCheckout: false, whatsappConsentCollectionMode: 'checkout', ...saved } } });
  });
  await page.goto('/admin/settings');
  const collection = page.getByRole('combobox', { name: 'Communication preference collection', exact: true });
  await expect(collection).toHaveValue('checkout');
  await collection.selectOption('onboarding');
  await expect(page.getByRole('switch', { name: 'Require Transactional WhatsApp Consent at Checkout' })).not.toBeChecked();
  await expect(page.getByText(/Requiring WhatsApp consent as a condition of purchase may conflict/)).toBeVisible();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect.poll(() => saved).not.toBeNull();
  expect(saved).toMatchObject({ whatsappConsentCollectionMode: 'onboarding', requireWhatsappConsentForCheckout: false, razorpayEnabled: false });
  for (const key of ['WHATSAPP_ENABLED', 'WHATSAPP_ORDER_NOTIFICATIONS_ENABLED', 'WHATSAPP_MARKETING_ENABLED', 'orderNotificationsEnabled']) expect(saved).not.toHaveProperty(key);
});

test('admin owns independent routing selectors and persists every mode without changing gates', async ({ page }) => {
  await setup(page, false, true);
  let settings: Record<string, unknown> = { razorpayEnabled: false, authenticationDeliveryMode: 'email', transactionalDeliveryMode: 'both' };
  await page.route('**/api/admin/settings', route => {
    if (route.request().method() === 'PUT') settings = { ...settings, ...route.request().postDataJSON() };
    return route.fulfill({ json: { settings } });
  });
  await page.goto('/admin/settings');
  for (const mode of ['whatsapp', 'both', 'email']) {
    await page.getByRole('combobox', { name: 'Authentication / OTP delivery channel', exact: true }).selectOption(mode);
    await page.getByRole('combobox', { name: 'Transactional / Utility delivery channel', exact: true }).selectOption(mode);
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect.poll(() => settings.authenticationDeliveryMode).toBe(mode);
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Transactional / Utility delivery channel', exact: true })).toHaveValue(mode);
  }
  expect(settings).not.toHaveProperty('WHATSAPP_ENABLED');
});

test('customer can explicitly opt into future order updates after checkout', async ({ page }) => {
  const calls = await setup(page);
  await page.goto('/order-success/manual-order');
  const section = page.getByRole('region', { name: 'Transactional WhatsApp updates' });
  await expect(section).toContainText('Registered WhatsApp number: +14155552671');
  const enable = section.getByRole('button', { name: 'Enable Transactional WhatsApp Updates for This Order' });
  await expect(enable).toBeDisabled();
  await section.getByRole('checkbox', { name: /I agree to receive transactional WhatsApp/ }).check();
  await enable.click();
  await expect(section).toContainText('Transactional WhatsApp updates are enabled for this order at +14155552671');
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/api/orders/manual-order/whatsapp-consent');
  expect(calls[0].body).toMatchObject({ whatsappTransactionalConsent: true, whatsappRecipient: '+14155552671' });
  await page.goto('/account/orders/manual-order');
  await expect(page.getByRole('region', { name: 'Transactional WhatsApp updates' })).toContainText('Transactional WhatsApp updates are enabled for this order');
});

for (const width of [1440, 390]) {
  test(`staff sees independent channel outcomes and unpaid refund reconciliation at ${width}px`, async ({ page }) => {
    await setup(page, false, true);
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/api/staff/orders/manual-order', route => route.fulfill({ json: { order: {
      ...fixtureOrder(), fulfillment: { status: 'refunded' }, fulfillmentStatus: 'refunded', availableActions: [],
      paymentCollection: { total: 1000, received: 0, refunded: 0, collectibleBalance: 0, balanceDue: 1000, status: 'pending', evidenceIssue: 'refund_evidence_missing' },
      timeline: [{ id: 'rejected-event', label: 'Order Rejected', status: 'order_rejected', timestamp: '2026-11-21T11:57:01Z', actor: { type: 'staff' }, notificationOutcomes: [
        { event: 'order_rejected', channel: 'whatsapp', status: 'skipped', reason: 'template_mapping_disabled' },
        { event: 'order_rejected', channel: 'email', status: 'failed', reason: 'smtp_authentication_failed' },
      ] }],
    } } }));
    await page.goto('/admin/orders/manual-order');
    const collection = page.getByRole('region', { name: 'Payment collection' });
    await expect(collection).toContainText('Gross received');
    await expect(collection).toContainText('Verified refunded');
    await expect(collection).toContainText('Net retained');
    await expect(collection).toContainText('Unpaid contractual balance');
    await expect(collection).toContainText('Remaining collectible balance');
    await expect(collection).toContainText('Pending');
    await expect(collection.getByRole('alert')).toContainText('no valid payment/refund evidence');
    const outcomes = page.getByRole('list', { name: 'Notification outcomes' });
    await expect(outcomes).toContainText('WhatsApp: Skipped');
    await expect(outcomes).toContainText('Template mapping is disabled in this environment.');
    await expect(outcomes).toContainText('Email: Failed');
    await expect(outcomes).toContainText('SMTP authentication failed');
    await expect(page.getByText('Customer notification requested', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mark Refunded', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('SMTP provider acceptance is distinct from delivery in the staff timeline', async ({ page }) => {
  await setup(page, false, true);
  await page.route('**/api/staff/orders/manual-order', route => route.fulfill({ json: { order: {
    ...fixtureOrder(), timeline: [{ id: 'accepted-event', label: 'Order Accepted', status: 'order_accepted', timestamp: '2026-11-21T11:57:01Z', actor: { type: 'staff' }, notificationOutcomes: [
      { event: 'order_accepted', channel: 'email', status: 'accepted' },
      { event: 'order_accepted', channel: 'whatsapp', status: 'delivered' },
    ] }],
  } } }));
  await page.goto('/admin/orders/manual-order');
  const outcomes = page.getByRole('list', { name: 'Notification outcomes' });
  await expect(outcomes).toContainText('Email: Accepted by provider');
  await expect(outcomes).toContainText('WhatsApp: Delivered');
  await expect(outcomes).not.toContainText('Email: Delivered');
});

test('payment collection distinguishes gross receipts, refund evidence and net retained', async ({ page }) => {
  await setup(page, false, true);
  await page.route('**/api/staff/orders/manual-order', route => route.fulfill({ json: { order: {
    ...fixtureOrder(),
    paymentCollection: { total: 1000, received: 1000, refunded: 250, netReceived: 750, balanceDue: 0, collectibleBalance: 0, status: 'partially_refunded' },
  } } }));
  await page.goto('/admin/orders/manual-order');
  const collection = page.getByRole('region', { name: 'Payment collection' });
  for (const [label, amount] of [['Gross received', '1,000'], ['Verified refunded', '250'], ['Net retained', '750'], ['Unpaid contractual balance', '0'], ['Remaining collectible balance', '0']]) {
    await expect(collection.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) })).toContainText(amount);
  }
});

for (const width of [1440, 768, 390]) test(`staff records investigation without changing held inventory at ${width}px`, async ({ page }) => {
  await setup(page, false, true);
  await page.setViewportSize({ width, height: 1000 });
  const operation = { operationId: `inv_${'a'.repeat(64)}`, productId: 'product-test', itemIndex: 0, quantity: 1, stockDelta: -1, state: 'unresolved', productMarkerPresent: false, markerMatches: false, compensated: false };
  let order = { ...fixtureOrder(), captureFulfillmentStatus: 'held', availableActions: [], inventoryReconciliation: {
    blocked: true, markerReconciliationAvailable: false, manualInvestigationRequired: true,
    operations: { capture: [operation] }, investigations: [] as Record<string, unknown>[],
  } };
  const submissions: Record<string, unknown>[] = [];
  await page.route('**/api/staff/orders/manual-order', route => route.fulfill({ json: { order } }));
  await page.route('**/api/staff/orders/manual-order/inventory-investigations', route => {
    const body = route.request().postDataJSON(); submissions.push(body);
    order = { ...order, inventoryReconciliation: { ...order.inventoryReconciliation, investigations: [
      ...order.inventoryReconciliation.investigations, { ...body, id: 'investigation-test', actorId: 'staff-test', recordedAt: new Date().toISOString(), unresolved: true },
    ] } };
    return route.fulfill({ status: 201, json: { order } });
  });
  await page.goto('/admin/orders/manual-order');
  await page.getByLabel('Recovery reason', { exact: true }).fill('Verify warehouse operation');
  await page.getByRole('combobox', { name: 'Inventory operation', exact: true }).selectOption(operation.operationId);
  await page.getByLabel('Warehouse findings', { exact: true }).fill('Count requires supervisor review');
  await page.getByLabel('External stock count', { exact: true }).fill('0');
  await page.getByLabel('Evidence document ID', { exact: true }).fill('WAREHOUSE-TEST-01');
  await page.getByRole('button', { name: 'Record investigation only', exact: true }).click();
  await expect(page.getByText('Investigation recorded. Stock and fulfilment are unchanged; unresolved cases remain blocked.')).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({ operationId: operation.operationId, productId: 'product-test', itemIndex: 0, externalStockCount: 0 });
  await expect(page.getByRole('button', { name: 'Reconcile verified product markers', exact: true })).toHaveCount(0);
  await expect(page.getByText(/This order remains blocked and requires manual inventory investigation/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});


for (const scenario of ['accepted-cancelled', 'rejected', 'active', 'missing-reference'] as const) {
  test(`saved WhatsApp retry classifies ${scenario} from persisted evidence`, async ({ page }) => {
    const rejected = scenario === 'rejected';
    const status = scenario === 'active' ? 'confirmed' : 'cancelled';
    const order = { ...fixtureOrder(), fulfillment: { status }, fulfillmentStatus: status, availableActions: [],
      availabilityDecision: { status: rejected ? 'rejected' : 'accepted', reason: rejected ? 'requested_size_unavailable' : null },
      timeline: [{ status: 'order_placed', id: 'placed-fixture' },
        { status: rejected ? 'order_rejected' : 'order_accepted', id: 'decision-fixture' },
        ...(!rejected && scenario !== 'active' ? [{ status: 'cancelled', id: scenario === 'missing-reference' ? '' : 'cancelled-fixture' }] : [])]
        .map(entry => ({ ...entry, label: entry.status, timestamp: '2026-11-19T07:00:00Z', actor: { type: 'staff' } })) };
    const requests: Record<string, unknown>[] = [];
    await page.addInitScript(() => localStorage.setItem('rk_access_token', 'fixture-token'));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'fixture-admin', role: 'admin', isActive: true, must_change_password: false } } });
      if (url.pathname === '/api/staff/orders/manual-order/notifications/retry') {
        requests.push(route.request().postDataJSON());
        return route.fulfill({ json: { order } });
      }
      if (url.pathname === '/api/staff/orders/manual-order') return route.fulfill({ json: { order } });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
      if (url.origin !== 'http://127.0.0.1:3210') return route.fulfill({ status: 204, body: '' });
      return route.continue();
    });
    await page.goto('/admin/orders/manual-order');
    const select = page.getByLabel('Retry saved notification');
    await expect(select).toBeVisible();
    const expected = scenario === 'accepted-cancelled' ? 'cancelled' : rejected ? 'order_rejected' : null;
    await expect(select.locator('option[value="cancelled"]')).toHaveCount(expected === 'cancelled' ? 1 : 0);
    await expect(select.locator('option[value="order_rejected"]')).toHaveCount(expected === 'order_rejected' ? 1 : 0);
    expect(requests).toEqual([]);
    if (expected) {
      await select.selectOption(expected);
      expect(requests).toEqual([]); // Selection alone never triggers a retry.
      await page.getByRole('button', { name: 'Retry eligible notification', exact: true }).click();
      await expect.poll(() => requests.length).toBe(1);
      expect(requests[0]).toEqual({ event: expected, channel: 'whatsapp' });
    }
  });
}


for (const scenario of [
  { status: 'order_placed', decision: undefined, acceptedId: undefined, accepted: false },
  { status: 'awaiting_confirmation', decision: undefined, acceptedId: '', accepted: false },
  { status: 'confirmed', decision: 'accepted', acceptedId: undefined, accepted: true },
  { status: 'processing', decision: 'accepted', acceptedId: undefined, accepted: true },
  { status: 'packed', decision: 'accepted', acceptedId: undefined, accepted: true },
  { status: 'processing', decision: undefined, acceptedId: 'persisted-acceptance', accepted: true },
]) test(`cancellation action label follows persisted acceptance: ${scenario.status}, ${scenario.decision || scenario.acceptedId || 'unaccepted'}`, async ({ page }) => {
  const label = scenario.accepted ? 'Cancellation Requested' : 'Reject Order';
  const requests: Record<string, unknown>[] = [];
  let order = { ...fixtureOrder(), fulfillment: { status: scenario.status }, fulfillmentStatus: scenario.status,
    availableActions: ['cancelled'], availabilityDecision: scenario.decision ? { status: scenario.decision } : undefined,
    timeline: scenario.acceptedId !== undefined ? [{ status: 'order_accepted', id: scenario.acceptedId,
      label: 'Order Accepted', timestamp: '2026-11-19T07:00:00Z', actor: { type: 'staff' } }] : [] };
  await page.addInitScript(() => localStorage.setItem('rk_access_token', 'fixture-token'));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'fixture-admin', role: 'admin', isActive: true, must_change_password: false } } });
    if (url.pathname === '/api/staff/orders/manual-order/fulfillment') {
      const body = route.request().postDataJSON(); requests.push(body);
      const event = scenario.accepted ? 'cancelled' : 'order_rejected';
      order = { ...order, fulfillment: { status: 'cancelled' }, fulfillmentStatus: 'cancelled', availableActions: [],
        availabilityDecision: scenario.accepted ? order.availabilityDecision : { status: 'rejected' },
        timeline: [...order.timeline, { id: 'saved-transition', status: event, label: event, timestamp: '2026-11-19T08:00:00Z', actor: { type: 'staff' } }] };
      return route.fulfill({ json: { order } });
    }
    if (url.pathname === '/api/staff/orders/manual-order') return route.fulfill({ json: { order } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    if (url.origin !== 'http://127.0.0.1:3210') return route.fulfill({ status: 204, body: '' });
    return route.continue();
  });
  await page.goto('/admin/orders/manual-order');
  const action = page.getByRole('button', { name: label, exact: true });
  await expect(action).toBeVisible();
  await expect(page.getByRole('button', { name: scenario.accepted ? 'Reject Order' : 'Cancellation Requested', exact: true })).toHaveCount(0);
  await action.click();
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
  if (scenario.accepted) {
    await expect(page.getByLabel('Rejection reason')).toHaveCount(0);
    await expect(page.getByLabel(/^Explanation/)).toHaveCount(0);
  } else {
    await page.getByLabel('Rejection reason').selectOption('other');
    await expect(page.getByLabel(/^Explanation/)).toHaveAttribute('required', '');
    await page.getByLabel(/^Explanation/).fill('Synthetic availability explanation');
  }
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].status).toBe('cancelled');
  expect(requests[0].sendCustomerNotification).toBe(true);
  expect(requests[0].rejectionReason).toBe(scenario.accepted ? '' : 'other');
  await expect(page.getByText('Order updated successfully.', { exact: true })).toBeVisible();
  expect(order.timeline.at(-1)?.status).toBe(scenario.accepted ? 'cancelled' : 'order_rejected');
  if (scenario.decision === 'accepted') expect(order.availabilityDecision?.status).toBe('accepted');
});
