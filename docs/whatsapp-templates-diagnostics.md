# Order templates and Messaging Diagnostics

This feature builds on the manual-order work in PR #2. It changes local template definitions/value builders and the Admin Studio diagnostics presentation. It does not submit templates, activate mappings, change any production gate, send real messages or alter the backend diagnostics evidence checks.

## Exact new Meta contracts

Both templates use `en_US`, category `UTILITY`, a TEXT header, BODY and the footer text `Rashi Kapoor Official`. Footer components follow the existing Meta convention (`type: FOOTER`, `text`, without an unsupported footer `format` field). Local definitions are drafts, not proof of approval.

### rk_order_placed

Header: `Order Received`

Body:

```text
Dear {{1}},

Thank you for placing your order with Rashi Kapoor.

We have received your order {{2}} for {{3}}.

Order total: ₹{{4}}

Your order is now awaiting review by our team. Payment has not yet been collected. Our team will contact you to confirm availability and arrange payment.

We will keep you updated here as your order progresses.
```

Parameters: `customer_name`, `order_number`, `items_summary`, `order_total`.

Event: `order_placed`, independently of paid Razorpay `order_confirmation`. Item names/quantities come from the persisted order. Numeric monetary values exclude currency prefixes because the body already supplies ₹.

### rk_order_status_update

Header: `Order Update`

Body:

```text
Dear {{1}},

There is an update on your Rashi Kapoor order {{2}}.

{{3}}

Payment status: {{4}}

Order total: ₹{{5}}

Amount received: ₹{{6}}

Balance due: ₹{{7}}

Thank you for choosing Rashi Kapoor. We will keep you informed as your order progresses.
```

Parameters: `customer_name`, `order_number`, `update_message`, `payment_status`, `order_total`, `amount_received`, `balance_due`.

Supported canonical events:

| Requested lifecycle | Existing canonical identifier |
| --- | --- |
| Accepted / rejected | `order_accepted`, `order_rejected` |
| Processing / packed | `processing`, `packed` |
| Shipment / delivery | `shipped`, `out_for_delivery`, `delivered` |
| Advance / part payment / completed | `advance_payment_received`, `part_payment_received`, `payment_received` |
| Cancellation / verified completed refund | `cancelled`, `refund_completed` |

No duplicate aliases such as `order_processing` or `payment_completed` were added. For shipment details, courier/tracking are included only from persisted complete shipment evidence. Refunds retain signed-provider proof requirements. Payment events retain receipt-specific identities; cumulative amounts are recomputed from the immutable ledger through the particular receipt, with due-date semantics preserved. Cached balance fields and caller-provided values are not authoritative.

## Existing templates and activation

Existing approved template component definitions, including the `_v2` variants derived from them, are unchanged. Existing shipment, delivery, cancellation and refund defaults are retained. Those events can be explicitly mapped to `rk_order_status_update` through the existing registry after its exact contract has been approved; there is no silent replacement of a working approved mapping.

New order-placed, acceptance/rejection, processing/packed and manual-payment mappings remain disabled by default. Approval requires current account-scoped Meta evidence matching name, language, Utility category and every component. An older approval for the prior draft contract is insufficient. Missing, pending, stale, disabled or mismatched evidence cannot queue or dispatch the new template. No free-text fallback was added.

`WHATSAPP_ORDER_NOTIFICATIONS_ENABLED`, the existing database order switch, consent snapshots, STOP suppression, restricted order-only allowlists, mapping checks, worker rechecks and event-specific idempotency remain in effect. Generic messaging, OTP, Marketing and restricted manual production-test gates are unchanged.

## Diagnostics navigation and UI

- Diagnostics appears only in its new top-level tab. Overview has compact status counts and a View Diagnostics action; Test Messages does not duplicate the full component.
- Seven compact full-width rows show the name, actual backend status, short reason, individual checked time, next action, evidence toggle and optional scoped refresh.
- Counts distinguish Verified, Action Required, Blocked and Unknown / Not Verified. Unknown, stale and unverified evidence never increments Blocked.
- Expanded rows preserve provider errors, messaging/billing interpretation, per-entity status/scope, sender/OTP/business/quality/capacity, template, webhook, worker/code/database/image limitations and outbox evidence. Raw evidence is a secondary closed disclosure. A shared display guard removes sensitive fields from both structured and raw output.
- Refresh All posts only `{ "scope": "all" }`; per-row refresh uses the existing exact scope. A synchronous in-flight guard and disabled buttons prevent duplicate requests. Failed requests retain previous evidence and show an error. Refresh-response timestamps do not replace each diagnostic's own backend timestamp.
- No diagnostic controls activate gates, change Meta settings, submit templates, start/stop workers, or retry queues. Responsive rows, keyboard focus, labelled expansion state and dark mode are preserved.

## Validation and limits

Full backend: 856 passed, 4 skipped, with existing Mongo mock datetime deprecation warnings. Focused WhatsApp/backend contracts: 277 passed. Playwright WhatsApp UI: 68 passed. Frontend unit suite: 164 passed and 1 pre-existing editorial-copy failure; all 4 new diagnostics unit tests passed. Typecheck, production frontend build and `git diff --check` passed. Known-credential-pattern scan: 352 source/config/documentation files, no matches; environment files excluded. Tests use in-memory databases and mocked providers/APIs. No production account was contacted to submit or approve these drafts. Browser screenshots cover the compact Diagnostics view and mobile dark/light rendering; live Meta approval and actual customer delivery are not claimed.

The existing unrelated frontend editorial-copy test still expects contiguous `Where the art of` despite the homepage's existing `<br />` markup. This change does not alter that homepage or the existing lint tooling.

## Files changed

- `backend/app/whatsapp_catalogue.py`
- `backend/app/whatsapp_events.py`
- `backend/app/whatsapp_routes.py`
- `backend/app/whatsapp_templates.py`
- `backend/tests/test_manual_notifications.py`
- `backend/tests/test_manual_template_contracts.py`
- `docs/manual-payments.md`
- `docs/whatsapp-templates-diagnostics.md`
- `frontend/app/admin/integrations/whatsapp/page.tsx`
- `frontend/components/admin/whatsapp-diagnostics.tsx`
- `frontend/lib/whatsapp-diagnostics.test.mjs`
- `frontend/lib/whatsapp-diagnostics.ts`
- `frontend/tests/whatsapp-ui.spec.ts`
