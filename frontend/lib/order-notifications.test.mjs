import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationStatusLabel, notificationReasonLabel, savedWhatsAppRetryEvents } from './order-notifications.ts';

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


const cancellationFixture = () => ({ fulfillment: { status: 'cancelled' }, fulfillmentStatus: 'cancelled',
  availabilityDecision: { status: 'accepted' }, timeline: [
    { status: 'order_placed', id: 'placed-fixture' }, { status: 'order_accepted', id: 'accepted-fixture' },
    { status: 'cancelled', id: 'cancelled-fixture' }] });
const terminalChoices = order => savedWhatsAppRetryEvents(order).filter(event => ['cancelled', 'order_rejected'].includes(event));

test('accepted then cancelled exposes only the persisted cancellation', () => {
  const order = cancellationFixture(); const before = structuredClone(order);
  assert.deepEqual(terminalChoices(order), ['cancelled']);
  assert.deepEqual(order, before);
});

test('rejected before acceptance exposes only rejection with valid saved evidence', () => {
  const order = cancellationFixture();
  order.availabilityDecision = { status: 'rejected', reason: 'requested_size_unavailable' };
  order.timeline = [{ status: 'order_placed', id: 'placed' }, { status: 'order_rejected', id: 'rejected' }];
  assert.deepEqual(terminalChoices(order), ['order_rejected']);
  order.availabilityDecision.reason = 'other';
  assert.deepEqual(terminalChoices(order), []);
  order.availabilityDecision.explanation = 'Synthetic customer-facing explanation';
  assert.deepEqual(terminalChoices(order), ['order_rejected']);
});

test('active or inconsistent canonical status cannot offer a stale cancellation', () => {
  const order = cancellationFixture();
  for (const status of ['confirmed', 'processing', 'refunded']) {
    order.fulfillment.status = status;
    assert.deepEqual(terminalChoices(order), []);
  }
});

test('missing IDs and contradictory decisions do not expose terminal retries', () => {
  const order = cancellationFixture();
  order.timeline[2].id = '';
  assert.deepEqual(terminalChoices(order), []);
  order.timeline[2].id = 'saved'; order.timeline[1].id = '';
  assert.deepEqual(terminalChoices(order), []);
  order.timeline[1].id = 'accepted'; order.availabilityDecision.status = 'rejected';
  assert.deepEqual(terminalChoices(order), []);
  order.timeline.push({ status: 'order_rejected', id: 'later-rejection' });
  order.availabilityDecision.reason = 'requested_size_unavailable';
  assert.deepEqual(terminalChoices(order), []);
});
