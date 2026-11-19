import { expect, test, type Page } from '@playwright/test';

const fixtureOrder = () => ({ id: 'manual-order', orderNumber: 'RK-MANUAL-1', customerName: 'Fixture Customer', email: 'fixture@example.test',
  total: 1000, payment: { gateway: 'manual', status: 'pending' }, paymentStatus: 'pending',
  fulfillment: { status: 'order_placed' }, fulfillmentStatus: 'order_placed', availableActions: ['confirmed', 'cancelled'],
  timeline: [], items: [{ name: 'Fixture couture', sku: 'RK-IVORY', size: 'M', quantity: 1, unitPrice: 1000 }],
  createdAt: '2026-11-19T06:00:00Z', paymentTransactions: [] as { id: string; amount: number; amountPaise: number; method: string; timestamp: string; recordedBy: string; event: string }[],
  paymentCollection: { total: 1000, received: 0, balanceDue: 1000, status: 'pending', instructions: 'Wait for payment instructions.' },
  whatsapp: { consent: 'missing', automationEnabled: false, templates: [], activity: [] },
});

async function setup(page: Page, online = false, admin = false) {
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
    if (path === '/api/storefront-settings') return route.fulfill({ json: { settings: { razorpayEnabled: online } } });
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
    // Profile consent never replaces the explicit manual checkout consent.
    await expect(page.getByRole('checkbox', { name: /I agree to receive transactional WhatsApp/ })).not.toBeChecked();
    await page.screenshot({ path: info.outputPath(`manual-checkout-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Place order', exact: true }).click();
    await expect(page).toHaveURL(/order-success\/manual-order/);
    await expect(page.getByText('Order received', { exact: true })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.whatsappTransactionalConsent).toBe(false);
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
