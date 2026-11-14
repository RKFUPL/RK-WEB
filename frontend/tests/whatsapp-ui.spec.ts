import { expect, test, type Page } from '@playwright/test';

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

async function mockApi(page: Page, options: { active?: boolean; role?: string; window?: 'open' | 'closed' | 'expired'; invalidRecipient?: boolean; textError?: boolean; localRateLimit?: boolean; gate?: boolean; production?: boolean; catalogue?: boolean; mappingDisabled?: boolean; readReceiptStatus?: 'received' | 'not_received' | 'unknown'; logStatus?: string; registered?: boolean; metaApproved?: boolean; refreshFailure?: boolean } = {}) {
  const sent: Record<string, unknown>[] = [];
  const filters: string[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'fixture-admin', role: options.role ?? 'admin', isActive: true, must_change_password: false, displayName: 'Fixture Admin' } } });
    if (path === '/api/admin/integrations/whatsapp/template-status' && route.request().method() === 'POST' && options.refreshFailure) return route.fulfill({ status: 502, json: { error: 'Unable to read a complete Meta template inventory. Previous verified statuses are retained and marked stale.', status: { ...integration, configured: true, missing: [], templates: { test: { ...registeredTemplate, approved: false, observedStatus: 'APPROVED', qualityRating: 'UNKNOWN', statusStale: true, approvalCheckedAt: '2026-11-13T09:00:00Z', statusEvidence: 'found' }, new_collection_drop: { name: 'rk_new_collection_drop', language: 'en_US', category: 'MARKETING', parameters: ['first_name', 'collection_name'], enabled: false, approved: false, observedStatus: 'PENDING', statusStale: true, approvalCheckedAt: '2026-11-13T09:00:00Z', statusEvidence: 'found' } }, catalogue: {}, templateStatusSync: { lastAttemptAt: '2026-11-13T10:00:00Z', lastSuccessAt: '2026-11-13T09:00:00Z', lastError: 'meta_inventory_unavailable_or_incomplete', outcome: 'failed' }, environment: 'development', testSendEnabled: true } } });
    if (path === '/api/admin/integrations/whatsapp' || path === '/api/admin/integrations/whatsapp/template-status') return route.fulfill({ json: {
      ...integration,
      ...(options.active ? { configured: true, missing: [], templates: { test: options.registered || options.catalogue ? { ...registeredTemplate, approved: options.metaApproved !== false, eligibleForTesting: options.metaApproved !== false, observedStatus: options.metaApproved === false ? 'PENDING' : 'APPROVED' } : { ...integration.templates.test, enabled: true, approved: true, eligibleForTesting: true, testParameterFields: [], locallyMapped: true, mappingEnabled: false, approvalSource: 'meta_api_read', requiresMetaApproval: true, componentsVerified: true, observedStatus: 'APPROVED' }, ...(options.catalogue ? {
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

test('disabled setup displays configuration and blocks sends', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/admin/integrations/whatsapp');
  await expect(page.getByRole('heading', { name: 'WhatsApp Control Centre', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await openSection(page, 'Advanced Settings');
  await expect(page.getByRole('switch')).toBeDisabled();
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
  await page.getByLabel('I confirm this test recipient opted in').check();
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
  await expect(page.getByText('Meta-approved template preview · rk_order_confirmation · en_US')).toBeVisible();
  for (const [field, value] of [['Body variable 1: customer_name', 'Fixture'], ['Body variable 2: order_number', 'RK-123'], ['Body variable 3: order_date', 'Nov 14'], ['Body variable 4: order_total', 'INR 1']] as const) {
    await page.getByLabel(field).fill(value);
  }
  await page.getByLabel('Consenting test recipient').fill('+14155552671');
  await expect(page.getByText(/Final confirmation: one-off template test to \+14155552671/)).toBeVisible();
  await page.getByLabel(/I confirm this test recipient opted in/).check();
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

test('registered static template remains unavailable without Meta approval', async ({ page }) => {
  const calls = await mockApi(page, { active: true, registered: true, metaApproved: false });
  await page.goto('/admin/integrations/whatsapp');
  await openSection(page, 'Test Messages');
  await page.getByLabel('Consenting test recipient').fill('+14155552671');
  await page.getByLabel('I confirm this test recipient opted in').check();
  await expect(page.getByRole('option', { name: /3p_direct_integration_test_template/ })).toBeDisabled();
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
  await page.getByLabel('I confirm this test recipient opted in').check();
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
  await expect(page.getByRole('switch')).toBeDisabled();
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
  await page.getByLabel('I confirm this test recipient opted in').check();
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
  await expect(page.getByRole('option', { name: /rk_order_shipped/ })).toBeDisabled();
  await page.getByRole('option', { name: /rk_order_confirmation.*Approved.*test eligible/ }).click();
  await page.getByLabel('Consenting test recipient').fill('+14155552671');
  const send = page.getByRole('button', { name: 'Send approved test template', exact: true });
  await page.getByLabel('I confirm this test recipient opted in').check();
  await expect(send).toBeDisabled();
  await page.getByLabel('Body variable 1: customer_name').fill('Fixture Customer');
  await page.getByLabel('Body variable 2: order_number').fill('RK-FIXTURE');
  await page.getByLabel('Body variable 3: order_date').fill('2026-11-13');
  await page.getByLabel('Body variable 4: order_total').fill('INR 1,250.00');
  await page.getByLabel('I confirm this test recipient opted in').check();
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
  const transactionalConsent = page.getByLabel('I agree to receive account verification and transactional WhatsApp messages');
  await expect(otpConsent).not.toBeChecked();
  await expect(transactionalConsent).not.toBeChecked();
  await page.getByLabel('First name', { exact: true }).fill('Fixture');
  await page.getByLabel('Last name', { exact: true }).fill('Customer');
  await page.getByLabel('Username', { exact: true }).fill('fixture.signup');
  await page.getByLabel('Email', { exact: true }).fill('signup@example.test');
  await page.getByLabel('Phone number', { exact: true }).fill('+14155552671');
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


test('checkout keeps WhatsApp consent optional and sends the explicit choice', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('rk_access_token', 'fixture-token');
    localStorage.setItem('rk_shopping_bag', JSON.stringify({ currency: 'INR', items: [{ productId: 'fixture-product', productCode: 'RK-1', variantId: 'fixture-colour', sku: 'RK-1-RED', collection: 'Fixture', colour: 'Red', name: 'Fixture garment', price: 1250, quantity: 1, size: 'M', inventoryMode: 'variant' }] }));
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'fixture', email: 'customer@example.test', role: 'customer', isActive: true } } });
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
  const consent = page.getByLabel('I agree to receive account verification and transactional WhatsApp messages');
  const marketing = page.getByLabel('I agree to receive optional WhatsApp collection launches');
  await expect(marketing).not.toBeChecked();
  await expect(consent).not.toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Full name' })).toHaveValue('Fixture Customer');
  const pay = page.getByRole('button', { name: /^Pay / });
  await pay.click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].whatsappTransactionalConsent).toBe(false);
  expect(requests[0].whatsappMarketingConsent).toBe(false);
  await consent.check();
  await pay.click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].whatsappTransactionalConsent).toBe(true);
  await consent.uncheck();
  await marketing.check();
  await pay.click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2].whatsappTransactionalConsent).toBe(false);
  expect(requests[2].whatsappMarketingConsent).toBe(true);
});

async function mockOrderApi(page: Page, options: { shipped?: boolean; consent?: boolean } = {}) {
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
      activity: [] as Record<string, unknown>[],
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

test('one-time login keeps email available and sends the explicit WhatsApp channel choice', async ({ page }) => {
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
  await expect(page.getByLabel('OTP delivery channel')).toHaveValue('email');
  await expect(page.getByLabel('I request this verification code on WhatsApp')).not.toBeChecked();
  await page.getByLabel('Username or email').fill('fixture.customer');
  await page.getByLabel('OTP delivery channel').selectOption('whatsapp');
  await page.getByLabel('I request this verification code on WhatsApp').check();
  await page.getByRole('button', { name: 'Send sign-in code', exact: true }).click();
  await expect(page.getByLabel('One-time code')).toBeVisible();
  expect(submitted).toEqual({ identifier: 'fixture.customer', otpChannel: 'whatsapp', whatsappOtpConsent: true });
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
  await expect(page.getByRole('switch')).toBeDisabled();
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
  const user = { id: 'fixture-customer', role: 'customer', isActive: true, email: 'fixture@example.test', username: 'fixture.customer', firstName: 'Fixture', lastName: 'Customer', phone: '+14155552671', dob: '1990-01-01', gender: 'female', whatsappNotifications: true, whatsappMarketingNotifications: true, whatsappMarketingPhone: '+14155552671' };
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
  const marketing = page.getByLabel('I agree to receive optional WhatsApp collection launches');
  await expect(marketing).toBeChecked();
  await marketing.uncheck();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => submitted).not.toBeNull();
  expect(submitted!.whatsappMarketingNotifications).toBe(false);
  expect(submitted!.whatsappNotifications).toBe(true);
});
