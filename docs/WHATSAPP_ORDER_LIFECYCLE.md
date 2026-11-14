> Historical implementation/submission notes. Current operations and off-gate policy are in [WHATSAPP_DEPLOYMENT.md](WHATSAPP_DEPLOYMENT.md); current verification and remaining blockers are in [WHATSAPP_POST_REMEDIATION_AUDIT.md](WHATSAPP_POST_REMEDIATION_AUDIT.md). Older flags, counts, approval snapshots and activation instructions below are historical. Template definitions are not proof of Meta approval.

# WhatsApp order lifecycle integration

Current template-contract update: see [OTP, marketing and button extension](WHATSAPP_OTP_MARKETING_BUTTONS.md). Local Utility components/variable order now match the actual PENDING Meta submissions; the seven existing submissions were not modified. Separate `_v2` button definitions are disabled drafts. Older template parameter examples below are historical.

## Inspected event map (before implementation)

| Persisted event | Existing route and function | Existing notification path |
| --- | --- | --- |
| Checkout/contact/consent | `POST /api/payments/razorpay/order`, `create_razorpay_order`, `_normalise_shipping`, `_new_order_document` | Saves shipping snapshot and optional order-specific transactional consent; no confirmation before payment |
| Verified capture | `POST /api/payments/razorpay/verify`, `verify_razorpay_payment`; signed `POST /api/webhooks/razorpay`, `payment.captured` | `_fulfil_paid_order` persists payment proof/inventory/order result, then `send_order_confirmation` calls order/payment WhatsApp hooks |
| Availability confirmation | `PATCH /api/staff/orders/<id>/fulfillment`, `change_fulfillment` → `apply_transition` | Atomic status/history update followed by `send_status_notification` |
| Shipped/out for delivery/delivered/cancelled | Same fulfillment route and `apply_transition` | Existing status hook after the successful database update; delivery proof/time already stored |
| Courier/AWB/URL update after shipping | `PATCH /api/staff/orders/<id>/shipment`, `edit_shipment` → `update_shipment` | Existing shipment hook; previously used a timestamp-based tracking event key in addition to a shipped key |
| Payment pending/failed | Checkout/state verification and signed `payment.failed` | No successful-payment notification is authorized by these states; separate legacy failure event remains |
| Processed refund | Signed Razorpay `refund.processed` branch | Validates payment/order/currency/amount and stores refund proof, then calls `refund_completed` |
| Manual refunded status | Existing fulfillment transition | Does not establish gateway refund proof and cannot authorize a processed-refund message |
| Returns/custom orders/authentication | Existing returns/custom/auth services | Separate legacy/auth notification events retained |
| Courier status webhook | None exists | Staff records actual observed carrier statuses; no fictional callback introduced |

Admin order details are rendered by `frontend/components/orders/admin-order-detail.tsx`; customer and staff routes reuse `order_view`. Shipment fields are `fulfillment.courier`, `trackingNumber`, `trackingUrl`, `shippedAt`; customer contact is primarily `shipping.phone`. The existing checkout consent is persisted in `whatsapp_consents` and on the order as `whatsappConsent`, separately from marketing preferences. Signed inbound STOP and authenticated profile withdrawal already block future dispatch.

The gaps identified were: notification callers could rely on supplied records instead of reloading the order; consent resolution could choose a consent phone different from the shipping snapshot; skipped events had no order activity record; shipment keys did not distinguish replacement AWBs and could duplicate tracking messages; queue rate-limit retries were not scheduled durably; dispatch date was not editable; and the order details API/UI had no WhatsApp activity view.

## Implemented shared service and contact policy

`whatsapp.notify` routes the seven business events (and legacy tracking-update calls) to `whatsapp_orders.notify_order_whatsapp`. The service reloads the actual order by ID and loads only its associated customer. Caller-provided customer, phone, amount, fulfillment and refund dictionaries cannot override persisted state. It uses the original transport and encrypted outbox through `_enqueue_notification`; no second sender or order-update endpoint was created.

Recipient precedence is `shipping.phone`, legacy `shippingAddress.phone`, the order `phone`, then an order-specific consent phone. A present invalid snapshot is rejected rather than silently replaced. The recipient must be valid E.164 and covered by an explicit transactional grant for the actual customer and that number. Order checkout consent can cover a shipping number different from the account phone. A conflicting/missing grant, later profile withdrawal, account deactivation, or phone-level signed STOP blocks it. No delivery address or legacy boolean creates consent. Marketing and requested authentication consent remain separate.

When all saved order contact numbers are absent, RK-WEB has no standalone verified-contact table. The only permitted fallback is the current profile phone with its existing explicit profile consent plus verified signed inbound metadata for the same WABA/Phone Number ID. This additional contact-binding condition does not impose a 24-hour window on a saved order recipient or Utility template. An administrator or another customer's contact is never a fallback.

`whatsapp_order_events` records permanent event claims, masked-contact source, queue identity and safe reasons even while automation is off. Staff order GET/update responses include this activity and join current outbox/message delivery evidence. They expose no encrypted payload, App Secret, access token or key. The UI distinguishes missing consent, pending approval, queued/sent/delivered/read/failed/skipped states and shows actual receipt timestamps. Queuing is not proof of delivery; reading is never inferred from delivery.

## Event identity and shipment edits

| Event | Identity beyond order ID/event | Required proof |
| --- | --- | --- |
| order_confirmation | constant | Persisted paid and confirmed/progress fulfillment state |
| payment_confirmation | captured payment ID | Recorded payment verification timestamp and paid/refunded payment state |
| shipped | hash of courier + AWB | Persisted shipped/progress status, dispatch time, courier and AWB |
| out_for_delivery | shipment identity | Actual recorded out-for-delivery state |
| delivered | shipment identity | Actual recorded delivery state and deliveredAt |
| cancelled | constant | Actual recorded cancelled state |
| refund_completed | actual refund ID | Stored signed Razorpay processed-refund proof; caller input is insufficient |

Courier comparison ignores surrounding space/case; AWB comparison preserves the recorded value. The order activity event key is durable and pins its first eligible recipient. The encrypted queue/message IDs additionally use the existing keyed phone fingerprint. Repeated saves, repeated service invocations, webhook retries and worker restarts cannot create another dispatch for the same event identity. A different courier or AWB is treated as an explicitly saved replacement shipment and can queue one new shipped event. URL, note and dispatch-date corrections do not cause another WhatsApp send. Old queued shipment identities are skipped instead of being rewritten with new tracking details. Keep claims/tombstones when archiving; TTL must not erase the permanent event ledger.

The existing optional `sendCustomerNotification=false` choice is preserved and records a safe skipped reason for the required order events. Email paths and claims remain independent. Notification/queue failures are caught after the order update and cannot roll it back. Missing courier/AWB/dispatch data records a skip and is reevaluated by the existing shipment update route when staff saves sufficient information. Same-status fulfillment saves retain the existing validation error and do not enqueue again.

## Templates and approval evidence

| Event | Exact Utility template | Ordered body parameters |
| --- | --- | --- |
| order_confirmation | rk_order_confirmation | customer_name, order_number, order_total |
| payment_confirmation | rk_payment_confirmation | customer_name, paid_amount, order_number, payment_reference |
| shipped | rk_order_shipped | customer_name, order_number, courier_name, tracking_id |
| out_for_delivery | rk_out_for_delivery | customer_name, order_number |
| delivered | rk_order_delivered | customer_name, order_number |
| cancelled | rk_order_cancelled | customer_name, order_number |
| refund_completed | rk_refund_processed | customer_name, refund_amount, order_number, refund_reference |

All use `en_US`. The exact submission bodies are in [WHATSAPP_TEMPLATE_SUBMISSIONS.md](WHATSAPP_TEMPLATE_SUBMISSIONS.md); the shipped body is the newly requested text ending `Thank you for shopping with Rashi Kapoor.` and has no tracking button. No tracking URL or AWB is fabricated. A future dynamic URL button requires a separately reviewed template and actual approval.

On 2026-11-13, the local Meta read refresh returned `MISSING_OR_UNKNOWN` for these seven exact name/language pairs. Local configuration leaves all seven `NOT_SUBMITTED` and disabled. This is a pending submission plan, not a claim of Meta review status or approval. No template was submitted or edited. Submit them separately, then use the existing admin status refresh to read real Meta approval/category/components and separately authorize enabling the mappings. Matching component signatures are required; manual approved flags cannot authorize these order Utility mappings. Meta example values are ignored when comparing definitions, while body/header/button changes block sending.

The current `3p_direct_integration_test_template` stays eligible only for the explicit local test event, with actual `APPROVED` Meta evidence and exact static components. It is never used for a business order event. `rk_test` is not enabled. Authentication remains separate. Existing unrelated mappings are preserved; a conflicting old order-template contract needs an explicit migration rather than silent substitution.

## Gates, worker and recovery

Local flags remain `WHATSAPP_ENVIRONMENT=development`, `WHATSAPP_TEST_SEND_ENABLED=true`, `WHATSAPP_ENABLED=false`. The database automation switch is additionally required. The production config class still forces both automation and local tests off. No worker/timer, production configuration, deployment, app publication or real message was activated here.

The actual bounded worker command from the repository root is:

```powershell
python -m flask --app backend.app whatsapp-worker
```

Alternatively run `python -m flask --app wsgi:app whatsapp-worker` from `backend`. A separately authorized process supervisor must invoke it about every ten seconds, with the same verified backend environment/database. Each call processes at most 50 eligible jobs and exits. Database maintenance/index creation is a separate explicit operation; this work does not run it or install a scheduler.

Pending jobs use atomic claims and persist `nextAttemptAt` plus bounded retry counts. Explicit rate-limit rejections can retry twice durably after 30/120 seconds or the longer numeric Retry-After, before job expiry; the transport retains its maximum three short HTTP attempts per dispatch. Rate-limited message records without a provider ID are atomically reclaimed using the same idempotency key. Consent, contact, business-event identity, component contract, template approval, gates and expiry are checked again. Changed or withdrawn consent prevents future sends. Jobs with unknown/ambiguous outcomes, interrupted processing claims or database uncertainty are not reset automatically; reconcile against Meta IDs and signed delivery logs. Expired/unavailable jobs are shown as skipped. Queuing cannot promise exactly-once or eventual delivery.

Events skipped while automation is disabled or approval is absent are audited, not silently scheduled for future activation. Review and explicitly reevaluate intended events after separate approval/activation; there is no automatic backfill that could surprise customers. Old queued jobs lacking the new component/business proof fail closed and need operator reconciliation. Do not replace claims or invent fresh event IDs to retry uncertain messages.

## Remaining external and workflow work

- Submit/review the seven Utility templates and confirm their exact components with Meta's read API; none is currently approved for order delivery.
- Verify the actual registered sender, app/WABA `messages` field subscription, reachable signed callback, consent, billing and permissions in the intended environment before a separately authorized real order-event test.
- No carrier API/webhook, multi-parcel shipment model, automatic delivery detection or dynamic tracking button exists. Staff records actual courier results through existing order routes. Tests of repeated shared-service calls model a future caller's retries, not a fictional live courier webhook.
- Actual refund notification proof comes only from signed Razorpay `refund.processed`; existing staff/manual refunded status and externally initiated-refund assertions do not prove a processed refund.
- Production messaging remains disabled. The generic integration-test template's prior delivery does not establish readiness of these order templates or an end-to-end order event.

## Validation and changed files (2026-11-13)

- Full backend suite: `python -m pytest -q` from `backend`: **376 passed**. Includes **106 WhatsApp tests**, with actual existing staff fulfillment/shipment routes, snapshot contact/consent/withdrawal rules, capture/refund proof, missing/late tracking, courier/AWB replacement, duplicate saves/service calls, bounded worker backoff/restart behavior, approval/component evidence, production gates, and signed delivery/read/failure callbacks.
- Mocked browser suite: `npm run test:whatsapp-ui`: **24 passed**. Includes the existing integration/checkout/consent tests and new Admin Orders shipment form, late tracking, notification activity/read milestones and missing-consent cases. Every API/external request in browser tests is mocked.
- `npm run typecheck`, `npm run build` (62 pages), `python -m compileall -q backend/app`, and `git diff --check`: passed.
- Backend tests use in-memory MongoDB, mocked Meta reads/sends and mocked email. Order Utility approval fixtures go through the same mocked Meta read refresh with matching components; an arbitrary operator approval flag cannot authorize an order Utility send.
- Outside tests, the only provider operations were Meta reads for template observations. Only local test-database observation records were refreshed. No messages, production changes, publication, deployment, commit, push or merge occurred. No worker or scheduler was activated. Restart the local backend to load the merged `.env.local` mappings before reviewing the running admin page.

Exact files touched for this lifecycle work (pre-existing unrelated changes preserved):

1. `backend/.env.local` (ignored local override): merged seven disabled pending-submission mappings; preserved the integration-test mapping and other variables.
2. `backend/app/blueprints/orders/routes.py`: staff detail/update response includes safe WhatsApp activity through existing authenticated endpoints.
3. `backend/app/order_fulfillment.py`: shared shipment event, suppression audit, preserved partial shipment edits and editable validated dispatch timestamp.
4. `backend/app/whatsapp.py`: shared order dispatch delegation, queue proof, rechecks and bounded durable rate-limit retries.
5. `backend/app/whatsapp_orders.py` (new): committed-order recipient/consent/event orchestration, permanent audit and staff activity view.
6. `backend/app/whatsapp_catalogue.py`: exact requested shipped body.
7. `backend/app/whatsapp_templates.py`: Meta evidence and component signature requirement for the seven order Utility events.
8. `backend/app/whatsapp_routes.py`: status refresh verifies exact component evidence/signature.
9. `backend/tests/test_whatsapp.py`: provider-evidence fixtures, order-route/contact/activity/durable-retry tests.
10. `frontend/components/orders/admin-order-detail.tsx`: order WhatsApp panel and shipment dispatch field.
11. `frontend/lib/orders.ts`: typed safe order WhatsApp activity response.
12. `frontend/tests/whatsapp-ui.spec.ts`: mocked Admin Orders browser coverage.
13. `docs/WHATSAPP_SETUP.md`: lifecycle link, activity storage and retry policy.
14. `docs/WHATSAPP_TEMPLATE_SUBMISSIONS.md`: exact shipment copy and current approval/event policy.
15. `docs/WHATSAPP_ORDER_LIFECYCLE.md` (new): inspected architecture map, implemented behavior, evidence and remaining requirements.

The only environment variable modified is local `WHATSAPP_TEMPLATES`. Existing `WHATSAPP_ENVIRONMENT=development`, `WHATSAPP_TEST_SEND_ENABLED=true`, `WHATSAPP_ENABLED=false`, backend sender Phone Number ID, credentials, callback and production configuration were preserved. No signing/encryption key or access token belongs in this report.
