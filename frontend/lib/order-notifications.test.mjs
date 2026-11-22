import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationStatusLabel, notificationReasonLabel } from './order-notifications.ts';

test('notification labels distinguish queueing, acceptance and delivery', () => {
  assert.equal(notificationStatusLabel('queued'), 'Queued');
  assert.equal(notificationStatusLabel('accepted'), 'Accepted by provider');
  assert.equal(notificationStatusLabel('delivered'), 'Delivered');
  assert.equal(notificationStatusLabel('held'), 'Held for reconciliation');
});

test('order-placed routing reasons identify migration and exact Meta evidence blockers', () => {
  assert.match(notificationReasonLabel('legacy_template_mapping_requires_migration'), /migration to order_received/);
  assert.match(notificationReasonLabel('meta_body_correction_required'), /BODY requires correction/);
  assert.match(notificationReasonLabel('template_approval_unverified'), /approval is not verified/);
  assert.match(notificationReasonLabel('template_components_unverified'), /components have not been verified/);
  assert.match(notificationReasonLabel('template_evidence_stale'), /fresh verification/);
});

test('notification reasons explain local eligibility and SMTP authentication without echoing raw errors', () => {
  assert.match(notificationReasonLabel('template_mapping_disabled'), /this environment/);
  assert.match(notificationReasonLabel('smtp_authentication_failed'), /app password/);
  assert.match(notificationReasonLabel('refund_not_processed'), /verified processed refund/);
  assert.doesNotMatch(notificationReasonLabel('private token and recipient payload'), /private token|recipient payload/);
});

test('SMTP partial submissions explain customer and copy outcomes without claiming delivery', () => {
  assert.match(notificationReasonLabel('smtp_customer_refused_partial'), /customer|recipient/i);
  assert.match(notificationReasonLabel('smtp_other_recipient_refused'), /copy|other|staff/i);
  assert.doesNotMatch(notificationReasonLabel('smtp_customer_refused_partial'), /delivered/i);
  assert.match(notificationReasonLabel('smtp_submission_unknown'), /Reconcile with the provider before another attempt/i);
});
