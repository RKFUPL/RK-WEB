# Manual checkout and order collections

This change uses the existing checkout endpoint, order documents, Admin Studio settings, email renderer, template registry and encrypted WhatsApp outbox. It does not enable any messaging gates or change production configuration.

## Compatibility and rollout

- `admin_settings` / `store.razorpayEnabled` defaults to `true` when absent. Only Admin can save it. Public storefront settings expose the boolean, never payment secrets.
- Razorpay checkout retains its necessary public key ID in the existing checkout response, explicitly approved by Athul. The key secret and webhook secret stay backend-only. Signature verification, captured-amount validation and signed webhooks remain authoritative.
- When disabled, `POST /api/payments/razorpay/order` validates the same cart, prices, variants, sizes, shipping and identity. It creates an idempotent pending manual order and returns `paymentMode: manual`, order ID and number without Razorpay checkout fields or provider calls.
- A manual checkout needs explicit checkout transactional consent; profile consent is not adopted. WhatsApp remains optional. Missing consent or approval is visible in staff activity and cannot prevent the saved order/payment.
- Existing Razorpay orders keep their identifiers and verified status. Manual collection endpoints reject them. No old order is converted, marked paid or replayed. No bulk data migration is needed; new ledger/reservation fields are written only during the corresponding new operations.
- An existing checkout attempt cannot be silently converted between gateways. A manual retry returns its original order; an incompatible unfinished Razorpay attempt returns a conflict and the client starts a fresh attempt.

## Manual inventory

Manual placement does not reserve stock or accept availability. Staff acceptance atomically claims the order, then reserves ready-size stock using optimistic conditional product updates. Each product mutation writes its order/item reservation marker with the decrement. A repeated/stale acceptance cannot decrement again or revert accepted fulfilment.

If a later item cannot reserve, previous item reservations are released using the same markers. An ambiguous database interruption leaves the acceptance locked rather than risking a second decrement. Staff see `inventoryReservation: reserving` as requiring reconciliation: inspect the order and product reservation markers before any operator repair. There is deliberately no blind automatic unlock of uncertain writes.

Custom/insufficient-stock items retain `requiresAvailabilityConfirmation`. Acceptance requires an explicit staff availability/production confirmation; these made-to-order items do not consume nonexistent ready stock. Processing does not decrement again.

## Ledger and staff/customer views

- Receipts are append-only transactions with paise amounts, method, reference, note, timestamp, actor and transaction ID. Server-derived totals/balances use the ledger; version checks prevent concurrent overcollection.
- Advance and 50% actions remain partial unless the balance reaches zero. Zero, negative, non-finite, sub-paise, duplicate and excess receipts are rejected. No due date means no overdue status; expired due dates count only while a balance remains.
- Corrections append a separately audited full reversal with a reason. They never rewrite an original receipt. A reversed receipt cannot later dispatch a queued payment notification.
- Staff can assign due dates/instructions, collect payments, inspect receipt/reversal history, filter pending/partial/overdue orders, and inspect/retry eligible notification activity. Customers see the current payment summary, instructions and separate fulfilment timeline. Manual fulfilment does not imply payment confirmation.

## WhatsApp templates Athul must submit and approve

These are local definitions, **not evidence of approval**. Submit/approve the exact components in the existing Meta template library and refresh status through the existing process before enabling the relevant mappings.

| Name | Language | Category | Text header | Body parameters, in order | Events |
| --- | --- | --- | --- | --- | --- |
| `rk_order_placed` | `en_US` | `UTILITY` | `Order Received` | customer name, order number, order total | initial manual order placed |
| `rk_order_status_update` | `en_US` | `UTILITY` | `Order Update` | customer name, order number, event label, payment status, amount received, balance due | accepted, rejected, processing, packed, advance payment, part payment, final payment |

Exact body text and component contracts are in `backend/app/whatsapp_catalogue.py`. Existing approved shipment, delivery, cancellation and signed-refund mappings are retained. Category, language, components and current account-scoped Meta approval are rechecked; there is no free-text fallback.

The restricted order-only worker adds only the new order/collection events. Generic WhatsApp, OTP and Marketing gates remain unchanged. Payment event keys include the immutable receipt ID so distinct part-payments each dispatch once. The worker reloads consent, STOP state, template mapping, approval, persisted event and transaction identity before dispatch. Earlier lifecycle jobs that no longer match current state are skipped rather than sending stale status.

Notification transport failures do not reverse order/payment changes. Email delivery and WhatsApp activity are independent. Successful email keys and WhatsApp event identities remain deduplicated on staff retry; failed email claims can be retried. Uncertain provider outcomes still follow the existing held/reconciliation policy.

## Email images

The missing image was caused by `_item_html()` accepting only absolute HTTPS strings while WorkDrive product snapshots contain relative public proxy URLs. `email_image_url()` now resolves only the known `/api/catalog/products/<product>/media/<media>` route against the configured HTTPS canonical origin, preserving the version query. Public Cloudinary HTTPS images remain valid. Credentials, unsafe schemes, protocol-relative URLs, whitespace/control characters and unrelated paths are rejected; the server fetches nothing.

Order-received and lifecycle emails share item rendering, explicit image dimensions/alt text, email table markup, narrow-screen rules and a neutral fallback. Real public image availability and actual Gmail/Outlook delivery still require operator verification after an approved deployment; automated tests use fixtures and mocked transports.

## Validation

Full backend: 832 passed, 4 skipped (existing Mongo mock datetime deprecation warnings). Relevant Playwright: 72 passed, including 9 new manual checkout/payment/settings/customer timeline tests. Frontend typecheck and production build passed. Full frontend unit tests: 160 passed, 1 pre-existing editorial-copy failure. `git diff --check` passed. A known-credential-pattern scan of 347 source/config/documentation files found no matches; environment files were excluded. All payment, Meta and SMTP tests use in-memory databases/mocked providers. Browser screenshots cover desktop (1440), tablet (768) and mobile (390). The production build is run from a matching isolated QA copy so the user's local development server is not disrupted.

Known baseline issues: the frontend editorial-copy test expects contiguous `Where the art of` despite existing `<br />` markup, and `npm run lint` stops at the existing ESLint setup prompt because this checkout has no ESLint configuration. These unrelated files/tooling are unchanged.

## Files changed

- `backend/app/blueprints/admin/routes.py`
- `backend/app/blueprints/orders/routes.py`
- `backend/app/blueprints/payments/routes.py`
- `backend/app/manual_inventory.py`
- `backend/app/manual_payments.py`
- `backend/app/order_confirmation.py`
- `backend/app/order_fulfillment.py`
- `backend/app/whatsapp.py`
- `backend/app/whatsapp_catalogue.py`
- `backend/app/whatsapp_events.py`
- `backend/app/whatsapp_orders.py`
- `backend/app/whatsapp_templates.py`
- `backend/tests/test_manual_checkout.py`
- `backend/tests/test_manual_notifications.py`
- `backend/tests/test_storefront_settings.py`
- `backend/tests/test_whatsapp.py`
- `backend/tests/test_whatsapp_order_mode.py`
- `backend/tests/test_whatsapp_remediation.py`
- `docs/manual-payments.md`
- `frontend/components/admin/admin-settings.tsx`
- `frontend/components/checkout/checkout-page.tsx`
- `frontend/components/checkout/order-success-page.tsx`
- `frontend/components/orders/admin-order-detail.tsx`
- `frontend/components/orders/customer-order-detail.tsx`
- `frontend/components/orders/customer-orders-page.tsx`
- `frontend/components/orders/order-management.tsx`
- `frontend/components/orders/order-timeline.tsx`
- `frontend/components/orders/payment-collection.tsx`
- `frontend/lib/orders.ts`
- `frontend/playwright.config.ts`
- `frontend/tests/manual-payments.spec.ts`
