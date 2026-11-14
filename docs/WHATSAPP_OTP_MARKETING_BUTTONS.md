> Historical implementation/submission notes. Current operations and off-gate policy are in [WHATSAPP_DEPLOYMENT.md](WHATSAPP_DEPLOYMENT.md); current verification and remaining blockers are in [WHATSAPP_POST_REMEDIATION_AUDIT.md](WHATSAPP_POST_REMEDIATION_AUDIT.md). Older flags, counts, approval snapshots and activation instructions below are historical. Template definitions are not proof of Meta approval.

# Local WhatsApp OTP, marketing and template button implementation

Verified 2026-11-13 in RK-WEB-recovery. This is local implementation and mocked-test evidence, not a production activation or live delivery acceptance report. No messages, template submissions/edits, app publishing, worker/scheduler activation, deployment, commit or push were performed. No production environment file was changed.

## Current provider evidence and local configuration

A read-only Meta Graph template refresh was performed using existing backend credentials; only the local `RK_WEB_TEST_N2.whatsapp_template_status` evidence cache was updated. All seven existing Utility submissions are `PENDING`; their exact returned components match the corrected local definitions. Their submissions were not altered. The sole local OTP mapping is `rk_authentication_otp`; OTP/marketing/button versions remain unapproved unless a fresh exact-name/language/component read confirms otherwise. The integration test template remains `APPROVED` with verified static components. Missing provider evidence never becomes approval through an operator checkbox.

Ignored `backend/.env.local` retains:

```dotenv
WHATSAPP_ENVIRONMENT=development
WHATSAPP_TEST_SEND_ENABLED=true
WHATSAPP_ENABLED=false
WHATSAPP_MARKETING_ENABLED=false
WHATSAPP_CANONICAL_URL=https://rashikapoor.co.in
```

`WHATSAPP_MARKETING_ENABLED` and `WHATSAPP_CANONICAL_URL` were added. `WHATSAPP_TEMPLATES` was merged: all three authentication events select disabled `rk_authentication_otp`; two disabled marketing mappings were added; seven disabled Utility schemas now match the actual submitted parameter order; unrelated mappings and the approved integration-test mapping were preserved. The duplicate `rk_login_otp` local draft was removed after callsite and mapping review; no Meta template was changed. No `_v2` automatically replaces an existing mapping. Backend configuration requires actual read-only Meta component/category/language approval evidence as well as local enabling. ProductionConfig forces normal, local-test and marketing gates off. Manual Utility tests retain the independent development gate and explicit recipient consent; they cannot send AUTHENTICATION or MARKETING messages. Marketing requires the normal environment/database integration gates AND its additional marketing gate AND exact campaign authorization. No scheduler was started.

The existing registered Rashi Kapoor Phone Number ID was preserved; no sample number was substituted. Access tokens, App Secret, verify token, Fernet key and other credentials remain backend-only and are omitted from this report. Existing webhook GET verification, raw-body HMAC-SHA256 POST validation, inbound handling, exact-wamid status history and read-receipt semantics remain in use.

## Required new Meta templates

The machine-readable [template definitions](WHATSAPP_TEMPLATE_DEFINITIONS.json) contain exact headers, bodies, footers, buttons, events, ordered variable names and types for all local definitions. They are specifications, not API submission payloads or proof of approval. Meta submission examples must be supplied separately using synthetic values. `rk_authentication_otp` is the single canonical local Authentication template for signup, login and recovery.

New names: `rk_authentication_otp`, `rk_new_collection_drop`, `rk_exclusive_offer`, `rk_order_confirmation_v2`, `rk_payment_confirmation_v2`, `rk_order_shipped_v2`, `rk_out_for_delivery_v2`, `rk_order_delivered_v2`, `rk_order_cancelled_v2`, `rk_refund_processed_v2`. All use `en_US`. Each needs a separate exact Meta submission and verified approval before enabling; this work does not submit any. Keep the exclusive-offer mapping disabled even after approval until the checkout promotion system described below exists.

`rk_authentication_otp`: AUTHENTICATION, BODY `add_security_recommendation: true`; FOOTER `code_expiration_minutes: 10`; one BUTTONS entry `{type: OTP, otp_type: COPY_CODE, text: "Copy code"}`. Meta supplies the authentication wording. The send payload uses one body code and the same code in URL button index `0`. This follows Meta's [authentication component schema](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-hsm-whats-app-hsm-component-get/) and [official Copy Code example](https://www.postman.com/meta/whatsapp-business-platform/request/6vkv46u/create-authentication-template-w-otp-copy-code-button).

`rk_new_collection_drop`: MARKETING; TEXT HEADER `A New Collection Has Arrived`; BODY exactly:

```text
Hello {{1}},
A new expression of Rashi Kapoor has arrived.
Discover {{2}}, our latest collection, thoughtfully curated and now available to explore.
Explore the collection and discover pieces that speak to your style.
```

FOOTER `Rashi Kapoor`; URL button `Explore Collection`, registered dynamic URL `https://rashikapoor.co.in/{{1}}`. Its URL suffix comes from the actual selected collection route, independently of body placeholders.

`rk_exclusive_offer`: MARKETING; TEXT HEADER `A Special Offer for You`; BODY exactly:

```text
Hello {{1}},
A little something from Rashi Kapoor.
Enjoy {{2}} on your next purchase with code {{3}}.
Offer valid until {{4}}, subject to the applicable terms.
Explore our collections and discover something you'll love.
```

FOOTER `Rashi Kapoor`; URL button `Shop Now`, same dynamic URL prefix. General destination `/collections`; a collection promotion uses that collection's actual route. Coupon choices and authorization fail closed with `coupon_integration_unavailable`. No discount or coupon has been invented.

The seven `_v2` definitions copy their original, actual Meta-submitted TEXT header/body/footer unchanged and add exactly one URL button `https://rashikapoor.co.in/account/orders/{{1}}`. No media or additional header/footer parameters are introduced. Order/payment/delivered/cancelled: `View Order`; shipped/out-for-delivery: `Track Shipment`; refund: `View Refund`. The suffix is the persisted order `_id`, not a frontend destination. Shipment variants require actual saved courier/AWB; their protected order page shows the persisted shipment and its validated external tracking URL. Refund links open the same owner-protected order details, now displaying signed-provider processed refund evidence. There is no invented standalone refund or carrier route. The sender refuses button parameters unless the exact approved Meta component contains that button. See Meta's [message template schema](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/message_templates/).

## Ordered variables and persisted source fields

| Template/event | Body variable order and source |
| --- | --- |
| Authentication signup/login/forgot-password | `code`: the existing generated challenge code; bcrypt hash/expiry/attempts remain in `otp_challenges` or `users`; encrypted short-lived outbox only |
| Collection launch | `first_name`: `users.firstName`; `collection_name`: selected `collections.name` |
| Exclusive offer (blocked) | `first_name`; `offer_description`, `coupon_code`, `expiry_date` from future authoritative validated promotion and actual campaign expiry, bounded by promotion expiry |
| Order confirmation / `_v2` | `customer_name`: `orders.customerName`; `order_number`: `orders.orderNumber`; `order_date`: `orders.createdAt` business date; `order_total`: persisted `orders.total/currency` |
| Payment confirmation / `_v2` | customer name; order number; `paid_amount`: persisted total/currency; `payment_reference`: verified `razorpayPaymentId` |
| Shipped/out for delivery / `_v2` | customer name; order number; `courier_name`: `fulfillment.courier`; `tracking_id`: `fulfillment.trackingNumber`; actual dispatch/state evidence required |
| Delivered / `_v2` | customer name; order number; `delivered_on`: `fulfillment.deliveredAt` business date |
| Cancelled / `_v2` | customer name; order number; `cancellation_reference`: persisted cancellation timeline event `id`, never a fabricated reference |
| Refund / `_v2` | customer name; order number; `refund_amount`: signed processed refund `amountPaise/currency`; `refund_reference`: its provider `id` |

Dates use India business dates, formatted ISO `YYYY-MM-DD`. Existing customer/order contact and explicit transactional consent resolution remain authoritative. No approved template requires an incoming 24-hour window; free text still does. HTTP acceptance does not establish delivery; read status still requires signed Meta read evidence.

## Authentication and consent behavior

Signup, one-time-code login and password recovery let customers choose email, WhatsApp or both. Email remains the default and password login remains available. WhatsApp requires its explicit request consent. The same existing challenge/code is delivered to both selected channels; expiry (10 minutes), rate limits, five attempts and atomic one-time consumption are reused. WA-only requests fail with a channel error when automation or approval is unavailable; they do not silently send email. Both-channel responses state each channel's dispatch result. Plaintext codes never enter delivery logs, campaign records or unencrypted queue payloads. No live OTP was sent.

A WhatsApp/both-channel code does not prove email ownership. It cannot set `emailVerified` or create a domain-based staff role; already-verified email status is retained. Email-only verification retains the existing behavior. Profile email-change verification remains email-specific.

Checkout and profile have separate optional marketing consent; absent/new customer consent defaults unchecked. Existing saved grants display their actual state and phone. Consent includes customer ID, E.164 number, marketing category, grant/withdrawal state, timestamp, source, policy version `whatsapp-marketing-v1`, and withdrawal timestamp. Audit records reuse `whatsapp_consents`; category suppression uses `whatsapp_marketing_suppressions`. A checkout decline is order-specific and does not withdraw an unrelated existing grant. Profile withdrawal revokes the original grant number, including a checkout shipping number different from the profile number. Phone edits reset frontend consent choices. Transactional preference alone never qualifies a customer for campaigns.

Signed inbound global STOP suppresses both categories. `STOP MARKETING`, `UNSUBSCRIBE MARKETING`, or signed interactive reply ID `whatsapp_marketing_unsubscribe` withdraws marketing only. Webhook duplicate controls and timestamp comparisons protect fresh reconsent from stale/duplicate unsubscribe events. The existing transactional order records remain separate.

## Campaign and URL validation

Admin-only integration APIs provide options, backend-generated previews, explicit authorization and safe campaign summaries. Customers can never authorize a campaign. Collection options come from active, public persisted collections with actual product counts. Audience choices are all active marketing-consenting customers or actual past customers of the selected collection (order item collectionSlug/collectionId), with deduplicated eligible phone numbers and required first names. No collection names are hardcoded.

Actual Next.js routes inspected: `/collections`, `/collections/[slug]`, `/collections/lakme`, `/aakaar/collection`, `/account/orders/[orderId]`. Public production GET checks of the listing, Lakme and Aakaar collection routes returned 200. Each campaign preview probes its server-resolved canonical destination without redirects before authorization. The dedicated canonical setting avoids relying on the unrelated existing frontend SEO-domain fallback. No browser Host/header/frontend input selects environment or canonical domain.

Preview shows exact registered header/footer, backend-rendered body, ordered actual variables, masked sample recipients, exclusions/count and CTA destination. Authorization binds content, destination, audience, recipient phone/variable hashes, template approval/components and selected schedule to the current preview digest, explicit admin confirmation and idempotent request ID. Worker materialization uses the existing encrypted outbox and stable deduplication keys; rechecks consent, recipient binding, due schedule, expiry, saved collection/coupon data and Meta approval before sending and retries. No campaign records or outbox jobs were created against the live local database, and no worker or scheduler was enabled.

## Checkout/promotion audit and proposed integrated architecture

No existing executable coupon provider, coupon validation/redemption engine or automatic discount rule was found. `_checkout_items` in payments routes reads persisted variant/product price and quantity, computes line totals and subtotal; `_new_order_document` writes `discount: 0`, `total: subtotal`, and Razorpay amount from that total. Checkout displays subtotal as total and has no coupon field. The order view's discount field and legal references to promotions are not a redemption implementation. Read-only local database collection-name inspection found no coupon/discount/promotion collection. Product price is the stored selling price, not evidence of a validated promotional entitlement.

Proposal only; no disconnected coupon database or checkout pricing change was implemented:

1. Add an admin-authenticated promotion service and UI with normalized unique code, revision, draft/active/paused status, percentage or fixed-minor-unit discount, currency, UTC start/expiry, minimum eligible subtotal, optional discount cap, product/variant/collection IDs, global and per-customer limits, and explicit customer eligibility rules. Persist actor/version audit history. Validate percentage bounds and fixed currency; default to no stacking and specify tax/shipping allocation policy before launch.
2. Use one backend pricing/eligibility function for checkout quote, Razorpay order creation and future campaign coupon selection. Resolve actual products, variants, customer, dates and eligibility server-side; ignore client-supplied discount/totals. Return an expiring signed/versioned quote with line-level allocations in integer minor units and a human-readable reason on rejection. Campaigns select an actual active promotion ID and derive its code, permitted offer description, audience restrictions and expiry from that same service.
3. On creating the persisted checkout attempt, atomically reserve promotion capacity alongside the order using MongoDB transactions, a unique checkout-attempt key, unique promotion/order reservation, and conditional global/per-customer capacity updates. A standalone single-document counter is insufficient for multi-document eligibility. Fail closed if transaction support is unavailable. Set bounded reservation expiry; release unpaid expired/cancelled reservations through an idempotent recovery job. Do not call Razorpay inside a retriable database transaction: commit a pending payment intent, call with its stable attempt identity, then reconcile the provider result; ambiguous provider outcomes must be reconciled before releasing capacity.
4. Snapshot promotion ID/revision/code, eligible line amounts, discount allocation, quote version and final amount on the order. Revalidate the quote/reservation before payment creation; verify signed payment callbacks against the snapshotted payable amount. Atomically convert the reservation to a redemption exactly once using unique provider event/order identities and conditional state transitions. Payment retries and webhook duplicates must not consume limits twice.
5. Preserve the paid snapshot when catalogue prices or promotion rules later change. Cancellation of unpaid orders releases reservations. Paid cancellations/refunds use original discounted line allocations for partial/full refund amounts; signed refund records are idempotent and cumulative refunds cannot exceed captured payment. Decide explicitly whether redeemed capacity is restored after refunds; default to retaining usage to prevent abuse, with audited exceptions. Never recompute historical discounts from current catalogue prices.
6. End-to-end tests must cover concurrent last-slot attempts, customer/global limits, timezone boundaries, expired/changed quotes, ineligible products/customers, duplicate requests/provider callbacks, payment ambiguity/reconciliation, partial refunds/rounding, cancellations and quote-to-Razorpay amount consistency before marketing offers can be enabled.

## Exact changed files for this extension

This checkout already contained substantial uncommitted integration work. The following lists this extension's changes, not every file currently dirty in Git.

Backend: `backend/app/config.py`, `backend/app/blueprints/auth/routes.py`, `backend/app/blueprints/payments/routes.py`, `backend/app/order_fulfillment.py`, `backend/app/whatsapp.py`, `backend/app/whatsapp_routes.py`, `backend/app/whatsapp_templates.py`, `backend/app/whatsapp_catalogue.py`, `backend/app/whatsapp_events.py`, `backend/app/whatsapp_orders.py`, `backend/app/whatsapp_consent.py`, new `backend/app/whatsapp_definitions.py`, new `backend/app/whatsapp_marketing_consent.py`, new `backend/app/whatsapp_campaigns.py`, `backend/tests/test_whatsapp.py`, `backend/.env.example`, ignored `backend/.env.local`.

Frontend: `frontend/app/account/page.tsx`, `frontend/app/account/profile/page.tsx`, `frontend/app/admin/integrations/whatsapp/page.tsx`, `frontend/components/checkout/checkout-page.tsx`, `frontend/components/orders/customer-order-detail.tsx`, `frontend/lib/orders.ts`, `frontend/lib/whatsapp-consent.ts`, new `frontend/components/admin/whatsapp-campaigns.tsx`, `frontend/tests/whatsapp-ui.spec.ts`.

Documentation: this file, new `docs/WHATSAPP_TEMPLATE_DEFINITIONS.json`, historical-contract notices in `docs/WHATSAPP_TEMPLATE_SUBMISSIONS.md` and `docs/WHATSAPP_ORDER_LIFECYCLE.md`.

## Validation and restart

Final validation:

| Check | Result |
| --- | --- |
| Backend `python -m pytest -q` from backend | 392 passed |
| Browser `npm run test:whatsapp-ui` from frontend | 27 passed, all backend/Meta requests mocked |
| Frontend Node `npm test` | 153 passed, 1 pre-existing failure: `homepage-editorial-refinement.test.mjs:22` expects contiguous `/Where the art of/`, while unchanged `shop-categories.tsx` contains a `<br />` between the words. Both files are untouched by this task. |
| Python `python -m compileall -q app tests` | Passed |
| Frontend `npm run typecheck` | Passed |
| Frontend `npm run build` | Passed, 62 static pages generated; local build only |
| `git diff --check` | Passed |

Coverage includes the shared-code OTP payload/Copy Code button, expiry/replay/attempt/rate limits, email-ownership and staff-role boundary, optional checkout/profile marketing consent, category STOP/global STOP, audience/URL resolution, explicit current-preview/schedule authorization, queued-consent withdrawal, approved component and parameter/button contracts, protected customer order access, existing lifecycle events, and signed delivery/read correlation. The first new campaign browser run exposed an exact-label locator mismatch; the locator was corrected to select the accessible combobox and the final complete browser suite passed.

Automated tests mock all Meta sends and webhook payloads, and do not send real WhatsApp messages. Public page GET/Meta template GET checks are separate read-only evidence; they do not prove live OTP, campaign delivery, refund behavior or production readiness. The remaining provider work is manual approval of the new exact templates, later deliberate local mapping choices, and a separately authorized integrated promotion implementation before offers. Live delivery acceptance testing would require separate authorization; it was not performed here.

Restart manually in separate PowerShell terminals. No worker command is needed or authorized. Stop each existing development server from its own terminal with Ctrl+C before restarting it. The local environment changes are loaded when Flask restarts.

```powershell
Set-Location 'C:\Users\athul\Desktop\RK-WEB-recovery'
python -m flask --app backend.app run --host 127.0.0.1 --port 5000
```

```powershell
Set-Location 'C:\Users\athul\Desktop\RK-WEB-recovery\frontend'
npm run dev
```

Local admin: `http://localhost:3000/admin/integrations/whatsapp`. Local webhook: `http://127.0.0.1:5000/api/webhooks/whatsapp` (GET verification and signed POST events). If refreshing the temporary tunnel, use `cloudflared tunnel --url http://127.0.0.1:5000`, set backend `WHATSAPP_DEVELOPMENT_CALLBACK_URL` to its HTTPS origin plus `/api/webhooks/whatsapp`, restart Flask, then manually configure that callback in the intended Meta development app with the existing backend `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Never paste access tokens or App Secrets into callback fields. Do not publish the app or replace production configuration as part of this local task.

## Optional Utility template drafts (2026-11-13)

The following nine definitions were added to [the machine-readable template definitions](WHATSAPP_TEMPLATE_DEFINITIONS.json). They are **DRAFT**, disabled and not approved. A business event or database field existing does not mean the exact WhatsApp template is wired into the approved local catalogue. The optional drafts are not sendable until a later exact-name/language/category/components Meta read confirms approval and the backend event integration is deliberately completed.

The component schema follows Meta's message-template contract: ordered `HEADER` (when present), `BODY`, `FOOTER` (when present), and `BUTTONS` components; the Meta reference describes these component types, placeholder examples, and URL button fields ([Meta Graph API message-template reference](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/message_templates/)). These nine drafts have no header or footer. The body text below is the exact proposed body. Each URL CTA uses the existing authenticated `/account/orders/[orderId]` route and canonical production origin; its suffix must be the actual saved `orders._id` for that recipient. No return tokens, refund IDs, made-up order numbers, or fabricated public request IDs are embedded. The two custom-order drafts have no URL button because no customer-facing custom-order detail route was found.

### Exact body, ordered variables, examples, and proposed CTA

| Template / event | Status | Exact BODY text | Ordered body variables and persisted source | Example values (synthetic placeholders only) | Header / footer / URL CTA |
| --- | --- | --- | --- | --- | --- |
| `rk_payment_failure` / `payment_failure` | DRAFT; event emitted from failed-state and signed gateway paths, no exact catalogue mapping | `Rashi Kapoor: order {{1}} has this update: {{2}}.` | 1 `reference` ← `orders.orderNumber`; 2 `status` ← sanitized `orders.paymentFailureReason` | `<synthetic order number>`; `<synthetic persisted payment failure reason>` | None / None / **View Order** → `https://rashikapoor.co.in/account/orders/{{1}}`; URL suffix ← actual `orders._id` |
| `rk_processing` / `processing` | DRAFT; fulfillment transition emits event, no exact catalogue mapping | `Rashi Kapoor: order {{1}} has this update: {{2}}.` | 1 `reference` ← `orders.orderNumber`; 2 `status` ← `orders.fulfillment.status` | `<synthetic order number>`; `processing` | None / None / **View Order** → `https://rashikapoor.co.in/account/orders/{{1}}`; suffix ← actual `orders._id` |
| `rk_packed` / `packed` | DRAFT; fulfillment transition emits event, no exact catalogue mapping | `Rashi Kapoor: order {{1}} has this update: {{2}}.` | 1 `reference` ← `orders.orderNumber`; 2 `status` ← `orders.fulfillment.status` | `<synthetic order number>`; `packed` | None / None / **View Order** → `https://rashikapoor.co.in/account/orders/{{1}}`; suffix ← actual `orders._id` |
| `rk_tracking_update` / `tracking_update` | DRAFT; event currently aliases to `shipped`, not a separate catalogue dispatch | `Rashi Kapoor: order {{1}} has this shipping update: {{2}}. Tracking details: {{3}}.` | 1 `reference` ← `orders.orderNumber`; 2 `status` ← `orders.fulfillment.status`; 3 `tracking` ← saved `orders.fulfillment.courier`, `trackingNumber`, and `trackingUrl` only | `<synthetic order number>`; `shipped`; `<saved courier; saved tracking number; saved URL when present>` | None / None / **View Order** → `https://rashikapoor.co.in/account/orders/{{1}}`; suffix ← actual `orders._id` |
| `rk_return_requested` / `return_requested` | DRAFT; return data exists, but customer-request handler suppresses customer notification | `Rashi Kapoor: order {{1}} has this update: {{2}}.` | 1 `reference` ← `orders.orderNumber`; 2 `status` ← saved `orders.returnRequest.status` (and `requestedAt` is the persisted event time) | `<synthetic order number>`; `requested` | None / None / **View Order** → `https://rashikapoor.co.in/account/orders/{{1}}`; suffix ← actual `orders._id` |
| `rk_return_status` / `return_status` | DRAFT; return acceptance/submission handlers emit event, no exact catalogue mapping | `Rashi Kapoor: order {{1}} has this update: {{2}}.` | 1 `reference` ← `orders.orderNumber`; 2 `status` ← saved `returns.status` / `orders.returnRequest.status`; returned-order state ← `orders.fulfillment.status` | `<synthetic order number>`; `accepted` or `submitted`, from the persisted return state | None / None / **View Order** → `https://rashikapoor.co.in/account/orders/{{1}}`; suffix ← actual `orders._id`. No return token is used. |
| `rk_refund_initiated` / `refund_initiated` | DRAFT; admin action records operator-reported initiation; it does not initiate a gateway refund | `Rashi Kapoor: order {{1}} has this update: {{2}}.` | 1 `reference` ← `orders.orderNumber` (backend fallback is this same order's persisted `_id`); 2 `status` ← presence of `orders.refundNotification.initiatedAt`, rendered by the handler as `refund initiated externally` | `<synthetic order number>`; `refund initiated externally` | None / None / **View Order** → `https://rashikapoor.co.in/account/orders/{{1}}`; suffix ← actual `orders._id` |
| `rk_custom_order_received` / `custom_order_received` | DRAFT; creation emits event only for a request associated with the matching authenticated account; consent still required | `Rashi Kapoor: custom order request {{1}} has this update: {{2}}.` | 1 `reference` ← persisted `custom_order_requests._id` (do not call it a public request number); 2 `status` ← `custom_order_requests.status` | `<persisted request identifier; no invented public ID>`; `new` | None / None / **No URL button**; no customer-facing custom-order detail route was verified |
| `rk_custom_order_status` / `custom_order_status` | DRAFT; admin lifecycle action saves status and emits event, no exact catalogue mapping | `Rashi Kapoor: custom order request {{1}} has this update: {{2}}.` | 1 `reference` ← persisted `custom_order_requests._id` (do not call it a public request number); 2 `status` ← `custom_order_requests.status` | `<persisted request identifier; no invented public ID>`; one actual saved status: `in_review`, `quoted`, `confirmed`, `in_progress`, `completed`, or `cancelled` | None / None / **No URL button**; no customer-facing custom-order detail route was verified |

The bracketed example values are documentation placeholders, not literal Meta examples or customer data. When an operator later submits a draft, Meta's example fields should contain synthetic values that match the field type and format. For URL-button examples, use a synthetic non-customer suffix for submission validation; production sends must always use the actual saved order `_id` bound to the recipient. Never place a made-up reference into a live message.

### Exact component definitions

All nine use category `UTILITY`, language `en_US`, and the following component list. For the first seven order/return/refund templates, include the actual persisted-order CTA as the final component; for both custom-order templates, omit `BUTTONS` because no verified customer details route exists. The corresponding JSON records include the exact per-template body and ordered persisted-field mapping.

```json
{
  "name": "<one exact rk_* name from the table>",
  "language": "en_US",
  "category": "UTILITY",
  "components": [
    {
      "type": "BODY",
      "text": "<the exact body from the table>"
    },
    {
      "type": "BUTTONS",
      "buttons": [
        {
          "type": "URL",
          "text": "View Order",
          "url": "https://rashikapoor.co.in/account/orders/{{1}}"
        }
      ]
    }
  ]
}
```

For `rk_custom_order_received` and `rk_custom_order_status`, the exact components are BODY only, with no `BUTTONS`. There is no HEADER or FOOTER on any of the nine. URL `{{1}}` is the button component's URL suffix parameter; body placeholders follow the separate ordered variables documented above. Do not insert URL button parameters into the BODY parameter list.

### Meta submission checklist and existing-state safeguards

For each of the nine drafts, when separately authorized to submit:

1. In WhatsApp Manager, select the intended WABA and create only the exact listed name, `UTILITY` category and `en_US` language.
2. Copy the exact BODY and optional BUTTONS component structure from the JSON definition. Do not add a header/footer, change wording, reorder variables, or add a return/refund/request identifier.
3. Supply synthetic body examples in positional order; for the URL button, use a synthetic example suffix accepted by Meta. Do not use a customer's order ID, phone, name, payment failure text, or return data as a sample.
4. Submit the draft and record Meta's returned/current name, language, category, component structure and status from a real read. `PENDING` is not approval. A Meta review that changes category or components requires an explicit review of the resulting exact contract.
5. Keep the local template `DRAFT` and `enabled: false` until a read-only Meta result confirms exact name, language, `UTILITY` category, `APPROVED` status and component equality. Then implement/verify its event mapping, recipient consent and parameter source before enabling anything.
6. Keep `WHATSAPP_ENABLED=false` for automated messaging and `WHATSAPP_MARKETING_ENABLED=false`. This documentation work performed no Meta writes, no send and no provider read.

Preserved customer-facing submissions remain the seven existing Utility names (`rk_order_confirmation`, `rk_payment_confirmation`, `rk_order_shipped`, `rk_out_for_delivery`, `rk_order_delivered`, `rk_order_cancelled`, `rk_refund_processed`). This update does not replace or resubmit them. `rk_authentication_otp` remains the sole canonical Authentication template for signup, login and recovery. `3p_direct_integration_test_template` remains the separate previously read-approved local test template and is deliberately outside the customer-facing submission list. `rk_admin_notification` remains excluded from that catalogue.

At the preceding extension update, the seven existing submissions were documented as `PENDING` from an earlier read and were not refreshed then. The fresh inventory below supersedes that snapshot for current-state purposes. Their template definitions were not changed in this repair.

## Fresh Meta inventory reconciliation (2026-11-13)

A complete read-only Graph inventory succeeded for the configured WABA: 1 page, 19 templates. No template was created, updated, submitted or sent. `3p_direct_integration_test_template` (`en_US`, `UTILITY`) returned Graph status `APPROVED`; `quality_score.score` returned `UNKNOWN`, shown as “Quality pending.” Its fresh returned components match the exact static local header, body and footer contract; it has no parameters, buttons or media. Approval is determined by the Graph `status`; the independent quality score does not demote it to review.

The three records in the Template Library's missing/unknown count were:

| Record | Classification from current evidence | Explanation |
| --- | --- | --- |
| `rk_authentication_otp` | Local Authentication draft, absent from the complete inventory | Meta previously denied Authentication-template creation for this WABA; no template was submitted. This is a creation-permission blocker, not a Meta review status. |
| `rk_exclusive_offer` | Local Marketing draft, absent from the complete inventory | It is blocked until RK-WEB has an integrated, validated coupon/promotion system; it was not submitted. |
| `rk_admin_notification` | Internal-only local draft, absent from the complete inventory | It is not a customer-facing submission and remains excluded from the customer-facing template catalogue. |

`rk_test` is a separate found-but-unmapped Meta record: language `en`, category `MARKETING`, status `PENDING`. It is not the approved `3p_direct_integration_test_template` and remains unavailable to local sending. It was not remapped to `en_US` or `UTILITY`.

The disappearance was caused by a frontend filter in `frontend/app/admin/integrations/whatsapp/page.tsx`: the Template Library's extra-row construction explicitly discarded both `rk_test` and `3p_direct_integration_test_template`. The backend still had the static template contract in its registry and the Test Messages selector already considered Utility templates, but the library could not display the integration template. The filter is removed; the integration template now has its own library group and is sorted to the top of Test Messages. Customer order templates remain in the Transactional group.
