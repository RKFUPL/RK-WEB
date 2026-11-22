import type { Order } from "./orders";

const statuses: Record<string, string> = {
  requested: 'Requested', skipped: 'Skipped', queued: 'Queued', sending: 'Sending',
  accepted: 'Accepted by provider', sent: 'Sent', delivered: 'Delivered', read: 'Read',
  failed: 'Failed', held: 'Held for reconciliation', unknown: 'Delivery outcome unknown',
};
const reasons: Record<string, string> = {
  legacy_template_mapping_requires_migration: 'The superseded order-placed mapping requires an operator-reviewed migration to order_received.',
  meta_body_correction_required: 'The observed Meta BODY requires correction and fresh approval.',
  template_mapping_disabled: 'Template mapping is disabled in this environment.',
  template_approval_unverified: 'Current Meta approval is not verified in this environment.',
  template_components_unverified: 'Exact template components have not been verified.',
  template_evidence_stale: 'Template evidence needs a fresh verification.',
  template_not_approved_or_enabled: 'Template is disabled or its approval is not verified.',
  missing_or_withdrawn_consent: 'Consent for this order recipient is missing or withdrawn.',
  business_event_not_confirmed: 'The required business event has not been verified.',
  refund_not_processed: 'A verified processed refund has not been recorded.',
  refund_status_only: 'Status-only update; refund notifications require the verified provider event.',
  smtp_authentication_failed: 'SMTP authentication failed. Check the backend mailbox username and app password; a connection test does not prove this email was sent.',
  smtp_sender_rejected: 'SMTP rejected the configured sender.',
  smtp_recipient_rejected: 'SMTP rejected the recipient.',
  email_delivery_failed: 'Email submission failed; inspect the SMTP diagnostics.',
  smtp_submission_unknown: 'SMTP submission outcome is unknown. Reconcile with the provider before another attempt.',
  smtp_customer_refused_partial: 'The customer recipient was refused, but another recipient was accepted. Held for reconciliation; do not resend the entire message.',
  smtp_other_recipient_refused: 'The customer recipient was accepted; a copy recipient was refused. No customer retry is needed.',
  smtp_connection_failed: 'SMTP connection failed before submission.',
  smtp_data_rejected: 'SMTP rejected the message before acceptance.',
  email_recipient_missing: 'An email recipient is missing.',
  automation_disabled: 'Order notification automation is disabled in this environment.',
  staff_notifications_disabled: 'Customer notifications were disabled for this update.',
  invalid_recipient: 'The order recipient is invalid.',
  queue_expired_or_unavailable: 'The queue record expired or is unavailable.',
  business_event_or_consent_changed: 'The saved business event or consent is no longer eligible.',
  operator_reconciliation_required: 'Operator reconciliation is required before another attempt.',
};
export const notificationStatusLabel = (status: string) => statuses[status] ?? 'Outcome unavailable';
export const notificationReasonLabel = (reason?: string) => reason ? reasons[reason] ?? 'Notification unavailable; inspect the channel diagnostics.' : '';


/** UI eligibility only: the backend must recheck saved evidence before queueing. */
export function savedWhatsAppRetryEvents(order: Pick<Order, "fulfillment" | "fulfillmentStatus" | "availabilityDecision" | "timeline">): string[] {
  const events = ["order_placed", "order_confirmation", "order_accepted", "processing", "packed", "shipped", "out_for_delivery", "delivered"];
  const status = order.fulfillment?.status || order.fulfillmentStatus;
  if (status !== "cancelled") return events;
  const timeline = Array.isArray(order.timeline) ? order.timeline : [];
  const hasId = (entry: (typeof timeline)[number]) => typeof entry?.id === "string" && Boolean(entry.id.trim());
  const terminalIndex = timeline.reduce((last, entry, index) => ["cancelled", "order_rejected"].includes(entry?.status) ? index : last, -1);
  const terminal = timeline[terminalIndex];
  if (!terminal || !hasId(terminal)) return events;
  const acceptanceIndex = timeline.findIndex(entry => ["order_accepted", "confirmed"].includes(entry?.status) && hasId(entry));
  const decision = order.availabilityDecision;
  if (terminal.status === "cancelled" && decision?.status === "accepted" && acceptanceIndex >= 0 && acceptanceIndex < terminalIndex) {
    events.push("cancelled");
  } else if (terminal.status === "order_rejected" && decision?.status === "rejected" && acceptanceIndex < 0
    && ["requested_size_unavailable", "fabric_or_material_unavailable", "production_or_fulfilment_limitation", "other"].includes(decision.reason || "")
    && (decision.reason !== "other" || Boolean(decision.explanation?.trim()))) {
    events.push("order_rejected");
  }
  return events;
}
