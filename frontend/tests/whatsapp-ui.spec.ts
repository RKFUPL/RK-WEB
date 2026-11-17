import { expect, test, type Page } from '@playwright/test';

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
  const diagnostic = page.getByRole('region', { name: 'Messaging diagnostics' });
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
  const diagnostics = page.getByRole('region', { name: 'Messaging diagnostics' });
  for (const [scope, title] of scopes) {
    await diagnostics.getByRole('button', { name: `Refresh ${title}`, exact: true }).click();
    const card = diagnostics.getByRole('article', { name: `${title} diagnostic` });
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
  const transactionalConsent = page.getByLabel('I agree to receive transactional WhatsApp messages');
  await expect(otpConsent).not.toBeChecked();
  await expect(transactionalConsent).not.toBeChecked();
  await page.getByLabel('First name', { exact: true }).fill('Fixture');
  await page.getByLabel('Last name', { exact: true }).fill('Customer');
  await page.getByLabel('Username', { exact: true }).fill('fixture.signup');
  await page.getByLabel('Email', { exact: true }).fill('signup@example.test');
  await page.getByLabel('Country and dialling code', { exact: true }).selectOption('US');
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


test('checkout keeps WhatsApp consent optional and sends the explicit choice', async ({ page }) => {
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
  const consent = page.getByLabel('I agree to receive transactional WhatsApp messages');
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


for (const save of [false, true]) {
  test(`checkout alternate WhatsApp snapshot is independent of saved delivery phone; save primary ${save}`, async ({ page }) => {
    let submitted: Record<string, unknown> | null = null;
    await page.addInitScript(() => {
      localStorage.setItem('rk_access_token', 'fixture-token');
      localStorage.setItem('rk_shopping_bag', JSON.stringify({ currency: 'INR', items: [{ productId: 'fixture-product', variantId: 'fixture-colour', sku: 'RK-1-RED', name: 'Fixture garment', price: 1250, quantity: 1, size: 'M' }] }));
    });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'fixture', role: 'customer', email: 'fixture@example.test', whatsappPhone: '+14155552671', whatsappConsentValid: true } } });
      if (url.pathname === '/api/auth/addresses') return route.fulfill({ json: { addresses: [{ id: 'saved-address', fullName: 'Fixture Customer', phone: '9619888755', line1: 'Fixture Street', city: 'Mumbai', state: 'Maharashtra', country: 'India', postalCode: '400001', isDefault: true }] } });
      if (url.pathname === '/api/payments/razorpay/order') {
        submitted = route.request().postDataJSON();
        return route.fulfill({ status: 502, json: { error: 'Mock payment provider unavailable.' } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
      if (url.origin !== 'http://127.0.0.1:3210') return route.fulfill({ status: 204, body: '' });
      return route.continue();
    });
    await page.goto('/checkout');
    const consent = page.getByLabel('I agree to receive transactional WhatsApp messages');
    await expect(page.getByText('Registered WhatsApp number: +14155552671')).toBeVisible();
    await expect(consent).toHaveCount(0);
    await page.getByLabel('Use a different WhatsApp number for this order').check();
    await page.getByLabel('Country and dialling code', { exact: true }).selectOption('GB');
    await page.getByLabel('Mobile number', { exact: true }).fill('123');
    await page.getByRole('button', { name: /^Pay / }).click();
    expect(submitted).toBeNull();
    await expect(page.getByText('Enter a valid WhatsApp number with its country code. Your delivery details have been kept.')).toBeVisible();
    await page.getByLabel('Mobile number', { exact: true }).fill('02079460018');
    await expect(consent).not.toBeChecked();
    await consent.check();
    if (save) await page.getByLabel('Save this number as my primary WhatsApp number for future orders.').check();
    await page.getByRole('button', { name: /^Pay / }).click();
    await expect.poll(() => submitted).not.toBeNull();
    expect(submitted!.whatsappRecipient).toBe('+442079460018');
    expect(submitted!.whatsappCountry).toBe('GB');
    expect(submitted!.saveWhatsappAsPrimary).toBe(save);
    expect(submitted!.whatsappTransactionalConsent).toBe(true);
    expect((submitted!.shipping as { phone: string }).phone).toBe('9619888755');
    await expect(page.getByRole('textbox', { name: 'Full name' })).toHaveValue('Fixture Customer');
  });
}


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
  const diagnostics = page.getByRole('region', { name: 'Messaging diagnostics' });
  await expect(diagnostics).toContainText('WHATSAPP_PRODUCTION_TEST_SEND_ENABLED');
  await expect(diagnostics).toContainText('code_verification_status NOT_VERIFIED');
  await expect(diagnostics).toContainText('card charge does not confirm billing clearance');
  await expect(diagnostics).toContainText('messages webhook field');
  await expect(page.getByLabel('Selected template eligibility diagnostics')).toContainText('application test-send gate is off or expired');
  await expect(page.getByRole('button', { name: 'Send approved test template', exact: true })).toBeDisabled();
  expect(calls.sent).toHaveLength(0);
});
