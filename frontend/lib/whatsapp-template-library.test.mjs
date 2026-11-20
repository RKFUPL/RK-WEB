import test from 'node:test';
import assert from 'node:assert/strict';
import { marketingInventoryRow, templateLibraryAvailability, templateLibraryStatus } from './whatsapp-template-library.ts';

const entry = (name, values = {}) => ({ name, category: 'UTILITY', language: 'en_US', parameters: [], enabled: false, approved: false, ...values });

test('legacy order drafts are visibly superseded by the approved replacement names', () => {
  assert.equal(templateLibraryStatus(entry('rk_order_placed')), 'Superseded');
  assert.match(templateLibraryAvailability(entry('rk_order_placed'), false), /Superseded by order_received/);
  assert.equal(templateLibraryStatus(entry('rk_order_status_update')), 'Superseded');
  assert.match(templateLibraryAvailability(entry('rk_order_status_update'), false), /Superseded by order_and_payment_update/);
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
});
