# Refund evidence and notification outcomes

## Scope

Local implementation with isolated mocked-provider and real disposable MongoDB
tests. Production inspection was authorized read-only and is reported separately
in `whatsapp-incident-20261121.md`. No production configuration, mappings, gates,
timers, provider inventory or customer records are modified. The historical order
is not repaired or replayed by this change.

## Financial authority

- A lifecycle label is not a payment receipt or refund receipt.
- Razorpay refund evidence must come through the existing signed webhook route,
  bind to a previously verified payment and currency, have a positive integer
  amount, and remain within the cumulative captured amount.
- Refund IDs are immutable. Repeated events do not append another refund or
  send another receipt. Concurrent refunds compare the persisted refund/payment
  snapshot before appending, then revalidate after a conflict.
- Staff can mark a cancelled/returned order Refunded only after a full verified
  processed refund. This status action does not request a refund message.
- The signed provider event records a receipt-specific timeline event and can
  request independent email and WhatsApp notifications. WhatsApp still requires
  local mapping enablement, fresh scoped approval/components, consent and gates.
- Payment collection, gross received, verified amount refunded, net retained,
  unpaid contractual balance and remaining collectible balance are distinct.
  A closed unpaid order has zero received/refunded/collectible amounts; the
  original unpaid balance remains available in the API for reconciliation.
- An existing incorrect Refunded label does not create money. Staff see an
  evidence warning; customer views omit internal diagnostic details.

## Notification history

The old timeline request flag is only intent. Staff now receive per-channel
outcomes. WhatsApp reads the existing event audit, outbox and signed provider
receipts. Email records requested, sending, accepted, failed or held states and
safe reason codes in an independent activity record. SMTP acceptance is not a
delivery receipt. Unknown submission outcomes retain their claims and require
reconciliation; a database acknowledgement failure after SMTP acceptance must
not release the claim. New sending claims carry a generation token and a
ten-minute lease, renewed every 30 seconds while SMTP is active. An expired,
unrenewed generation is atomically persisted as held using its observed token,
heartbeat and lease. A concurrent heartbeat defeats that stale update. A late
provider result is audited without unlocking a held generation. Nothing is
automatically replayed.

Original acceptance/rejection and their retry endpoints use canonical email
identities. Legacy confirmed/cancelled aliases are included in the same atomic
order fence. Accepted, held, unknown and in-flight claims cannot be bypassed by
force resend or an alternate endpoint. Only confirmed pre-submission failures
(connection/authentication) or explicit SMTP rejection can release the fence;
attempt history is retained.

SMTP recipient refusals are evaluated for the intended customer separately from
copy recipients. Customer refusal after another recipient was accepted becomes
held, never customer acceptance or a blanket retry. Customer acceptance with a
refused copy remains acceptance with a safe warning. Only recipient counts and
fixed reason codes are stored, never addresses or raw provider responses.

## Late payment events

Signed capture evidence is distinct from permission to fulfil. Capture ownership
is claimed atomically before stock changes, with normalization inside that claim.
Completion compares the claim token, unchanged lifecycle and absence of refunds.
Only the current attempt's deductions can be compensated; a persisted successful
completion with a lost acknowledgement is not compensated. Interrupted capture
ownership remains held for reconciliation, rather than being released to repeat
stock adjustments.

Failure transitions require an unverified initial payment and the same lifecycle
and payment snapshot. Existing captures/refunds cannot regress to failed. Late
or contradictory captures preserve existing refunds and lifecycle; a genuine
first capture on a closed order records money without reopening or stock changes.
Signed payment facts remain in the webhook audit and contradictions receive an
idempotent staff reconciliation record. No historical event replay is added.

Rejection skips explain disabled local mappings, stale approval, component
mismatch or missing consent. Production template approval is never imported into
the local registry. No mappings are activated by this implementation.

## Email diagnostics

The Email settings Test Connection and application order mail both use the same
SMTP username/password selection (SMTP_* overrides ZOHO_SMTP_*). They do not use
Zoho OAuth tokens. OAuth credentials can exist for other integrations without
authorizing SMTP. A saved successful SMTP login is historical evidence, not a
promise of later submission/delivery. The dashboard now states that scope and
shows the last application submission separately. Authentication failures point
staff to mailbox access, the backend SMTP username/app password and Zoho region;
raw provider errors and credentials are not persisted in new notification logs.

## Business decisions remaining

There is no approved audited offline-refund receipt process in the current data
model. Manual/offline refunds remain blocked. Implementing one requires decisions
about authorization, settlement evidence, receipt identity, partial refunds and
reversal policy; it must not manufacture a Razorpay webhook. The affected unpaid
test order needs an explicitly authorized audited lifecycle correction, not a
fabricated financial receipt. Production deployment and any historical retry
need separate review and authorization.

## Changed files

Backend implementation:

- `backend/app/refund_evidence.py`
- `backend/app/payment_state.py`
- `backend/app/notification_activity.py`
- `backend/app/order_fulfillment.py`
- `backend/app/manual_payments.py`
- `backend/app/order_confirmation.py`
- `backend/app/mail.py`
- `backend/app/whatsapp_events.py`
- `backend/app/whatsapp_orders.py`
- `backend/app/blueprints/orders/routes.py`
- `backend/app/blueprints/payments/routes.py`

Frontend implementation:

- `frontend/components/orders/admin-order-detail.tsx`
- `frontend/components/orders/payment-collection.tsx`
- `frontend/app/admin/integrations/email/page.tsx`
- `frontend/lib/orders.ts`
- `frontend/lib/order-notifications.ts`

Regression tests:

- `backend/tests/test_refund_safety.py`
- `backend/tests/test_payment_notification_regressions.py`
- `backend/tests/test_mail.py`
- `backend/tests/test_order_confirmation.py`
- `backend/tests/test_whatsapp_order_mode.py`
- `frontend/lib/order-notifications.test.mjs`
- `frontend/tests/manual-payments.spec.ts`

Documentation: this file.

The complete current changed-file manifest is maintained below. Earlier local
work remains included. The initial worktree contained 39 intended files and no
staged changes at base `156865315107357843c936f17d282c4a1492eab0`.

## Validation boundary

Coverage includes mongomock, mocked SMTP/Meta boundaries and a real disposable
MongoDB 7.0.16 server. It does not prove replica-set failover, live provider delivery
or production readiness. A narrow unit-test adapter supports only the manual
operation marker array filter absent from MongoMock; real MongoDB tests validate
the actual command. Retry tests patch `app.whatsapp.retry_sleep`, not global
`time.sleep`, so PyMongo monitoring threads cannot invoke retry mocks.

## Inventory operation recovery (local implementation)

Razorpay capture inventory changes now use a stable per-item identity derived
from the persisted order ID, captured payment ID, and item index. Before a
stock mutation, an `inventory_operations` intent is written. The stock delta
and an `inventoryOperationMarkers` entry are then written in one atomic
product-document update. The product marker carries the capture/order/item
identity, quantity, delta, claim token, operation type and state. The separate
ledger is an index/audit projection and can be reconstructed from those
product markers. A missing ledger row is never treated as proof that stock was
unchanged.

The flow intentionally does not use MongoDB multi-document transactions. The
existing deployment does not establish transaction-capable replica-set
semantics for these paths, so the implementation relies on per-document
atomic compare-and-set writes and a durable saga state. If a capture is
interrupted or its final order write conflicts, the order remains held. A
verified full-refund race can compensate only markers owned by the exact
capture claim; the stock restoration and marker transition to `compensated`
are one product-document compare-and-set. Other partial or ambiguous work is
left held for staff review.

Manual reservations preserve the legacy `manualReservations` marker and add a
per-item operation marker in the same product write. Synchronous compensation
uses persisted markers and the persisted acceptance claim token, not an
in-memory list. If the process stops while `inventoryReservation` is
`reserving`, an authorized inventory manager can explicitly reconcile only
when every required product marker and operation marker matches the order
item. Recovery records actor, timestamp, reason, action, operation IDs, and
before/after evidence on the order. Capture recovery similarly requires every
capture marker to match and records its verified settlement in the audit.
There is no force-complete or force-restore action.

Unresolved/missing markers, contradictory operation states, a lost product, or
any state that cannot prove the exact adjustment remains blocked for manual
investigation. The recovery workflow does not automatically replay work when
an order is viewed. Payment evidence is retained, but no successful
fulfillment transition or success notification is permitted while capture or
reservation evidence is unresolved. A release still requires live validation
against the actual production MongoDB topology and a controlled operational
recovery exercise.

## Final safety corrections

Variant capture deductions re-read persisted variants and markers, check unique
active variant/size identities and sufficient variant and size stock, then compare
the entire original snapshot while changing stock and adding the marker. A
competing write forces a fresh read. Failed stock conditions cannot create an
applied marker. Parent and parent-size paths also require nonnegative stock.

Manual reservation operation IDs include the attempt's unique claim. The returned
attempt retains that original token through rollback; it cannot acquire a newer
reservation's ownership. Release uses an exact operation-ID/claim/state array
filter and a full product snapshot predicate. Stock and its marker transition
together, including after historical compensated markers. Repeated completed
release is a no-op; stale rollback cannot release or clear a newer claim.

Capture recovery allows only open unconfirmed orders and preserves the payment,
fulfilment, refund and claim compare-and-set conditions. Closed orders or records
with refunds cannot become paid/confirmed through recovery. Direct status-email
services reload and validate persisted lifecycle state. Email claims compare that
validated payment/inventory/lifecycle snapshot before authorizing submission.

## Ambiguous warehouse investigation and escalation

1. Authorized staff inspect the order's lifecycle, capture/refund evidence, item,
   product, operation ID, claim, marker state, quantity and delta. Atomic product
   markers are authoritative; the separate operation ledger is a projection.
2. Use **Reconcile verified product markers** only when every required marker is
   unique and matches. Supply a reason; the operation records before/after proof,
   actor and timestamp. Concurrent lifecycle or claim changes defeat completion.
3. If proof is missing, duplicated or conflicting, leave the order held. Do not
   manually edit stock, markers, tokens, status or financial evidence to make it
   appear complete. Do not retry fulfilment or success notifications.
4. Obtain a warehouse count and internal document reference. Use **Record warehouse
   investigation** to select the exact operation and record reason, findings,
   count, evidence ID, outcome and follow-up status. Omit customer details and
   credentials. The server supplies the order/product/item binding, staff identity
   and timestamp, and requires `inventory:manage` permission.
5. `inventoryInvestigations` is append-only on the order. Recording findings does
   not change stock, operation state, lifecycle, financial evidence or notifications.
   Every entry remains unresolved. Corrections append a new entry linked through
   `supersedesId` to an earlier entry for the same operation; originals remain.
6. Escalate unmatched evidence to the inventory administrator. Record each new
   finding/follow-up as another entry. An external count alone does not authorize
   completion. If the atomic proof cannot be established, keep the order blocked.
   Any later operational repair requires separate review and authorization; no
   force-complete, force-restore or arbitrary stock-adjustment shortcut is added.

Final commands, results and the complete manifest are recorded below after checks.

## Complete release-candidate manifest

47 intended files, including every initial modified/untracked file. No production or environment configuration files are included.

- `backend/app/blueprints/orders/routes.py`
- `backend/app/blueprints/payments/routes.py`
- `backend/app/inventory_operations.py`
- `backend/app/mail.py`
- `backend/app/manual_inventory.py`
- `backend/app/manual_payments.py`
- `backend/app/notification_activity.py`
- `backend/app/order_confirmation.py`
- `backend/app/order_fulfillment.py`
- `backend/app/payment_state.py`
- `backend/app/refund_evidence.py`
- `backend/app/whatsapp.py`
- `backend/app/whatsapp_events.py`
- `backend/app/whatsapp_orders.py`
- `backend/pytest.ini`
- `backend/tests/conftest.py`
- `backend/tests/integration/__init__.py`
- `backend/tests/integration/conftest.py`
- `backend/tests/integration/inventory_crash_worker.py`
- `backend/tests/integration/test_inventory_final_safety.py`
- `backend/tests/integration/test_inventory_real_mongodb.py`
- `backend/tests/test_inventory_crash_harness.py`
- `backend/tests/test_inventory_mongodb_safety.py`
- `backend/tests/test_inventory_recovery.py`
- `backend/tests/test_mail.py`
- `backend/tests/test_manual_checkout.py`
- `backend/tests/test_meta_order_mappings.py`
- `backend/tests/test_notification_lifecycle_safety.py`
- `backend/tests/test_order_confirmation.py`
- `backend/tests/test_payment_notification_regressions.py`
- `backend/tests/test_refund_safety.py`
- `backend/tests/test_whatsapp.py`
- `backend/tests/test_whatsapp_checks.py`
- `backend/tests/test_whatsapp_display_name.py`
- `backend/tests/test_whatsapp_order_mode.py`
- `backend/tests/test_whatsapp_production_test.py`
- `backend/tests/test_whatsapp_remediation.py`
- `docs/inventory-real-mongodb-tests.md`
- `docs/order-refund-notification-safety.md`
- `docs/whatsapp-incident-20261121.md`
- `frontend/app/admin/integrations/email/page.tsx`
- `frontend/components/orders/admin-order-detail.tsx`
- `frontend/components/orders/payment-collection.tsx`
- `frontend/lib/order-notifications.test.mjs`
- `frontend/lib/order-notifications.ts`
- `frontend/lib/orders.ts`
- `frontend/tests/manual-payments.spec.ts`

## Final validation and review

Validated locally on Windows with Python 3.14.3, Next.js 15.5.28 and the disposable
real MongoDB 7.0.16 instance. No production provider was exercised.

| Command / check | Final result |
| --- | --- |
| `python -m pytest -q` (opt-in unset) | 1,140 passed, 59 skipped, 2 existing mongomock datetime warnings |
| Same full command with disposable URI set | 1,197 passed, 2 skipped, 2 existing mongomock warnings |
| Real MongoDB cases within combined full suite | 57 passed; includes write-boundary races, subprocess crashes and restart |
| Focused payment/refund/inventory/notification/confirmation run | 117 passed |
| Integration + harness/safety + retry-isolation selection (earlier snapshot) | 82 passed |
| `npm test` | 177 passed |
| `npm run typecheck` | passed |
| `npm run build` | passed |
| `npx playwright test` | 118 passed |
| Strengthened long-operation-ID investigation browser cases | 3 additional passes at desktop/tablet/mobile |
| `git diff --check` | passed |

Earlier intermediate failures were corrected without removing assertions: the
shipment skip audit is retained when lifecycle evidence blocks sending, and the
new browser test locates its labelled select by accessible combobox role. Synthetic
JWT keys now meet the recommended length. No retry timing assertion is weakened;
the combined full run no longer has PyMongo sleep-mock interference.

Fresh final review: **PASS WITH WARNINGS for the local release candidate**. The
five reproduced application defects are corrected and regression-covered. Claim
ownership, exact marker identity, stock conservation, closed lifecycle fencing,
refund/capture binding and direct notification eligibility were inspected again.
No additional parent/nested MongoDB update conflict was found. Existing consent,
STOP, template/mapping gates, notification uncertainty fences and deployment
safeguards remain present. Production configuration and workflows are unchanged.

Operational warnings remain: ambiguous multi-document operations require holding
and audited warehouse investigation; no automatic repair is authorized. The exact
production incident order was not found, so its notification root causes and
queue-resumption eligibility remain unestablished. The local fixes do not resolve
that incident. Tests use mocked providers and standalone MongoDB; live delivery,
replica-set failover and the newly built Linux release image were not verified in
this local task. CI and deploy push triggers are restricted to main; a feature
branch push does not itself run those workflows. No production release is approved.
