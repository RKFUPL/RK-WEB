import test from 'node:test';
import assert from 'node:assert/strict';
import { marketingInventoryRow, templateLibraryAvailability, templateLibraryCounts, templateLibraryDraftExplanation, templateLibraryStatus, visibleTemplateLibraryEntries } from './whatsapp-template-library.ts';

const entry = (name, values = {}) => ({ name, category: 'UTILITY', language: 'en_US', parameters: [], enabled: false, approved: false, ...values });

test('legacy order drafts are visibly superseded by the approved replacement names', () => {
  assert.equal(templateLibraryStatus(entry('rk_order_placed')), 'Superseded');
  assert.match(templateLibraryAvailability(entry('rk_order_placed'), false), /Superseded by order_received/);
  assert.equal(templateLibraryStatus(entry('rk_order_status_update')), 'Superseded');
  assert.match(templateLibraryAvailability(entry('rk_order_status_update'), false), /Superseded by order_and_payment_update/);
});

test('superseded draft explanations override outdated backend submission instructions', () => {
  for (const [name, replacement] of [['rk_order_placed', 'order_received'], ['rk_order_status_update', 'order_and_payment_update']]) {
    const draft = entry(name, { localDraft: true, draftExplanation: 'Submit the exact contract and refresh Meta status.' });
    const explanation = templateLibraryDraftExplanation(draft, false);
    assert.match(explanation, new RegExp(`Superseded by ${replacement}\\.`));
    assert.match(explanation, /must not be submitted to Meta/);
    assert.doesNotMatch(explanation, /Submit the exact/);
    assert.equal(draft.draftExplanation, 'Submit the exact contract and refresh Meta status.');
  }
});

test('only the absent disabled unmapped Utility rk_test draft is suppressed', () => {
  const stale = entry('rk_test', { localDraft: true, presentInMeta: false });
  const marketing = marketingInventoryRow({ name: 'rk_test', category: 'MARKETING', language: 'en', status: 'APPROVED' });
  const preserve = [marketing, ...[{ enabled: true }, { mappingEnabled: true }, { locallyMapped: true },
    { approved: true }, { presentInMeta: true }, { localDraft: false }].map(values => ({ ...stale, ...values })), entry('other_draft', { localDraft: true })];
  assert.deepEqual(visibleTemplateLibraryEntries([stale, ...preserve]), preserve);
  assert.equal(stale.category, 'UTILITY');
  assert.equal(marketing.category, 'MARKETING');
});

test('summary counts agree with visible drafts and pending replacement without duplicate inventory entries', () => {
  const drafts = ['rk_authentication_otp', 'rk_order_placed', 'rk_order_status_update', 'rk_exclusive_offer', 'rk_admin_notification']
    .map(name => entry(name, { localDraft: true }));
  const approved = entry('rk_order_confirmation', { observedStatus: 'APPROVED' });
  const pending = entry('order_received', { observedStatus: 'APPROVED' });
  const marketing = marketingInventoryRow({ name: 'rk_test', category: 'MARKETING', language: 'en', status: 'APPROVED' });
  const rows = [approved, { ...approved }, pending, marketing, entry('rk_test', { localDraft: true, presentInMeta: false }),
    ...drafts, entry('unknown_template'), entry('rk_order_confirmation_v2', { versionOf: 'rk_order_confirmation', observedStatus: 'APPROVED' })];
  assert.deepEqual(templateLibraryCounts(rows), { approved: 2, review: 1, unknown: 1, drafts: 5 });
  assert.equal(visibleTemplateLibraryEntries(rows).filter(row => row.localDraft).length, 5);
});

test('known blocked draft reasons stay accurate while unrelated backend reasons are preserved', () => {
  assert.match(templateLibraryDraftExplanation(entry('rk_authentication_otp'), false), /Meta has denied Authentication-template creation/);
  assert.match(templateLibraryDraftExplanation(entry('rk_exclusive_offer'), false), /coupon and promotion/);
  assert.match(templateLibraryDraftExplanation(entry('rk_admin_notification'), false), /Internal-only/);
  assert.equal(templateLibraryDraftExplanation(entry('other', { draftExplanation: 'Specific backend reason.' }), false), 'Specific backend reason.');
});

test('order_received stays pending and unavailable until corrected Meta approval and component verification', () => {
  const approvedButBlocked = entry('order_received', { observedStatus: 'APPROVED', approved: true, componentsVerified: true });
  assert.equal(templateLibraryStatus(approvedButBlocked), 'Pending Meta Review');
  assert.match(templateLibraryAvailability(approvedButBlocked, false), /unavailable for sending until Meta approves the corrected template and its components are freshly verified/i);
});

test('authentication, promotion and internal templates retain their explicit restrictions', () => {
  assert.equal(templateLibraryStatus(entry('rk_authentication_otp')), 'Blocked');
  assert.match(templateLibraryAvailability(entry('rk_authentication_otp'), false), /Meta has denied Authentication-template creation for this WABA/);
  assert.equal(templateLibraryStatus(entry('rk_exclusive_offer')), 'Blocked');
  assert.match(templateLibraryAvailability(entry('rk_exclusive_offer'), false), /coupon and promotion system is implemented/);
  assert.equal(templateLibraryStatus(entry('rk_admin_notification')), 'Internal only');
  assert.match(templateLibraryAvailability(entry('rk_admin_notification'), false), /Internal-only template/);
});

test('rk_test is a separate Marketing row and reports the disabled gate as unavailable', () => {
  const row = marketingInventoryRow({ name: 'rk_test', category: 'MARKETING', language: 'en', status: 'APPROVED' });
  assert.equal(row.templateGroup, 'Marketing');
  assert.equal(row.enabled, false);
  assert.equal(row.approved, false);
  assert.match(templateLibraryAvailability(row, false), /Marketing gate is disabled; unavailable for sending/);
  assert.match(templateLibraryAvailability(row, true), /transactional automation is not available/);
});

test('library wiring keeps Marketing out of the generic unmapped list and labels rows with availability', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../app/admin/integrations/whatsapp/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /template\.name === 'rk_test'[\s\S]*template\.category === 'MARKETING'/);
  assert.match(source, /name: 'Marketing',[\s\S]*name: 'Internal only',[\s\S]*name: 'Optional lifecycle drafts'/);
  assert.match(source, /templateGroup === 'Internal only'/);
  assert.match(source, /unmapped\.filter\(item => item\.name !== 'rk_test'\)/);
  assert.match(source, /TemplateLibrary templates=\{libraryRows\} unmapped=\{status\.unmappedTemplates\} marketingEnabled=/);
  assert.match(source, /templateLibraryAvailability\(template, marketingEnabled\)/);
  assert.match(source, /templateLibraryDraftExplanation\(template, marketingEnabled\)/);
  assert.doesNotMatch(source, /template\.draftExplanation \?\? templateLibraryAvailability/);
  assert.match(source, /const counts = templateLibraryCounts\(base\)/);
});
