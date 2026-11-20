# Meta order mapping review — 20 November 2026

Local implementation and proposal only. No production configuration was changed,
no messages were sent, and no customer, order or payment records were created or
modified. The production checkout remains `fcebdbc56bfefa0fc3d1da64cdd7335a5ecb7087`.

## Evidence and exact contracts

The current-WABA MongoDB observations were read without changing them. All four
candidate templates were `APPROVED`, `UTILITY`, `en_US`, observed through
`meta_api_read` at **2026-11-20T14:18:40.479Z**. Their cached local verification was
false (`found_not_locally_mapped`), not proof of a component mismatch. Full Meta
header/body/footer/button contracts are represented exactly in
`backend/app/whatsapp_catalogue.py` and independently in the regression fixtures.
Submission examples are not component definitions or customer event values.

| Template | Proposed events | Ordered BODY variables | Other components |
| --- | --- | --- | --- |
| `order_received` | `order_placed` | customer_name, order_number, items_summary, order_total | TEXT header `Order Received`; footer `Rashi Kapoor Official` |
| `order_and_payment_update` | `order_accepted`, `order_rejected`, `advance_payment_received`, `part_payment_received`, `payment_received` | customer_name, order_number, update_message, payment_status, order_total, amount_received, balance_due | TEXT header `Order Update`; footer `Rashi Kapoor Official` |
| `rk_processing` | `processing` | customer_name, order_number | TEXT header `Order Being Prepared`; footer `Rashi Kapoor Official`; static URL button `Visit website` → `https://rashikapoor.co.in/` |
| `rk_packed` | `packed` | customer_name, order_number | TEXT header `Your Order Has Been Packed`; footer `Rashi Kapoor Official` |

**BLOCKED pending Meta BODY correction:** a second read of the current scoped
observations confirms that the BODY itself ends with
`We will keep you updated here as your order progresses.Hello`. The separate
FOOTER is `Rashi Kapoor Official`; this template has no BUTTONS component.
This is not concatenated footer or button text. The exact defective contract and
signature `01fad496a131a8752da5e6c9cfe68de15de15e767dc969e957d5192e97ffc1c6`
remain unchanged as evidence. `activationBlock=meta_body_correction_required`
prevents registry approval, enabling, queueing and manual template testing, even
if a runtime entry explicitly sets enabled=true or omits its catalogue alias.
Already queued jobs are also refused at dispatch. No local text/signature was
changed to pretend the approved contract is corrected.

The approved update template has `{{3}}.` immediately after the order-number
paragraph. Its explicit server-side adapter removes the terminal period from
the generated update message. The original `rk_order_status_update` is unchanged.
The two templates whose text includes the rupee symbol reject non-INR orders.

## Persisted event authority

| Event | Available values and required evidence |
| --- | --- |
| `order_placed` | Four variables above; created, pending, unpaid manual order in `order_placed`; persisted items and server total |
| `order_confirmation` | customer_name, order_number, order_date, order_total; verified captured Razorpay payment, payment ID and confirmed-or-later order |
| `order_accepted` / `order_rejected` | Seven update variables; matching saved fulfillment state and staff availability decision |
| `processing` / `packed` | Saved matching fulfillment state; new contracts select only customer_name and order_number |
| Advance / partial / final payment | Seven update variables; receipt ID must identify an unreversed, positive persisted ledger entry with the matching event; cumulative receipt-position ledger totals determine received/balance/status; only final payment may exhaust the balance |
| `shipped` / `out_for_delivery` | customer_name, order_number, courier_name, tracking_id; saved shipped timestamp, courier and tracking; out-for-delivery state must match |
| `delivered` | customer_name, order_number, delivered_on; saved delivered state and timestamp |
| `cancelled` | customer_name, order_number, cancellation_reference; saved cancelled state and timeline reference |
| `refund_completed` | customer_name, order_number, refund_amount, refund_reference; saved processed refund from the signed Razorpay webhook |

Existing `rk_order_confirmation`, shipment, delivery, cancellation and refund
contracts/defaults are unchanged. The new update template does not replace them.
`rk_test` is approved only as `MARKETING` / `en` and remains outside order events.
`3p_direct_integration_test_template` remains restricted to integration testing.
Neither template is added to the transactional catalogue or proposed event merge.
OTP and Marketing are separate; no gate or consent behavior was changed.

## Runtime configuration and activation boundary

Production currently configures only the existing paid `order_confirmation`
entry through `WHATSAPP_TEMPLATES`. `plan_order_template_mappings(db, config)`
prepares an additive proposal for the eight events above, verifying each raw
observation's current account, freshness, exact name/language/category, approved
status and full components. Every existing entry, including a disabled entry,
is preserved. The function never writes configuration or approval observations.

The live observations were exported as a sanitized local review snapshot and
checked against the local planner. Seven candidate event mappings are ready
after fresh verification; `order_placed` is BLOCKED because of the approved BODY
defect. The regenerated proposal excludes that blocked entry and defaults every
new ready entry to disabled. Only an explicit `enable_events` operator choice
can propose enabling a verified, unblocked entry. The planner never applies it.

After source and test review, any separately authorized activation must refresh
the exact inventory using the deployed definitions and confirm fresh,
current-account component signatures before applying the additive runtime merge.
The normal template registry and worker continue to reject the old unmapped
observations: the planner does not grant cached approval. Re-read approval at
activation; this document is not durable approval evidence. `order_received`
requires a corrected Meta BODY, fresh approval, and a separately reviewed update
of the local expected contract before its activation block can be removed.

## Final mapping categories

All three ready templates use the exact observed **UTILITY / en_US** contracts.

| Category | Template | Events | Full component signature |
| --- | --- | --- | --- |
| Ready after fresh Meta verification and explicit activation | `rk_processing` | `processing` | `d0ea8a2cce01449a216155a3c18042e47f2aa076ac48e06f9ca9cea5bb1efbb7` |
| Ready after fresh Meta verification and explicit activation | `rk_packed` | `packed` | `3955b1bb47aaf8298b21c5d3932fb9b84cb7476984d67a5e0b8380416b6699d7` |
| Ready after fresh Meta verification and explicit activation | `order_and_payment_update` | accepted, rejected, advance payment, part payment, final payment | `6918da761ee4a79468bc74bae7c3ab75d3830fe7d0c292cd0e2993f8a92c67c0` |
| BLOCKED pending Meta template correction | `order_received` | `order_placed` | `01fad496a131a8752da5e6c9cfe68de15de15e767dc969e957d5192e97ffc1c6` (defective observed BODY retained) |
| Not eligible for transactional automation | `rk_test` | None; MARKETING / en | Not a transactional contract |
| Not eligible for transactional automation | `3p_direct_integration_test_template` | None; integration testing only | Not an order lifecycle contract |

The current production `rk_order_confirmation` signature remains
`90af87932c4b9641e0cae67bf0e206d7177886d18fc26ba3263d50b7936d0a2c`.
Existing shipment/delivery/cancellation/refund defaults and component signatures
also match their original definitions. Their activation settings are preserved.
Marketing remains disabled in the production configuration read during review.

## Corrected order_received text for separate Meta submission

Keep name `order_received`, category `UTILITY`, language `en_US`, TEXT header
`Order Received`, footer `Rashi Kapoor Official`, and no buttons. Submit only
through the separately authorized Meta process; no submission was performed.

Corrected BODY (same four variables in the same order):

```text
Dear {{1}},

Thank you for placing your order with Rashi Kapoor.

We have received your order {{2}} for {{3}}.

Order total: ₹{{4}}

Your order is now awaiting review by our team. Payment has not yet been collected. Our team will contact you to confirm availability and arrange payment.

We will keep you updated here as your order progresses.
```

Order-only gates, transactional consent, STOP suppression, event-specific keys,
distinct immutable receipt keys, lease checks and dispatch/retry revalidation
continue to apply. Tests use isolated Mongo fixtures and mocked HTTP/SMTP only.

## Validation

- Full backend suite after final safety review, Python 3.12: **1,006 passed, 4 skipped, 2 warnings,
  96 subtests passed**. The skips require native Linux, Nginx or Docker Compose;
  the warnings are existing `mongomock` datetime deprecations.
- Frontend unit tests: **165 passed, 0 failed**.
- TypeScript: passed.
- Frontend production build: passed, 63 pages generated in a matching isolated
  source copy so the existing local dev server was not interrupted.
- `git diff --check`: passed. All changes remain uncommitted on local `main`.

The original seven changed/untracked files are preserved. Final safety review
also updates `backend/app/whatsapp_templates.py` to enforce the BODY activation
block in the registry and transport approval path, including legacy mappings
that omit their catalogue name. Nothing is staged, pushed or deployed.

Two old payment fixtures used fully settled receipts for advance/part-payment
events. They now model outstanding balances and assert the actual received,
balance and payment-status values. No assertion was removed or weakened.
