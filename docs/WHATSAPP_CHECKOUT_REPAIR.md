# WhatsApp checkout recipient repair

Final release review: see [WHATSAPP_RELEASE_REVIEW.md](WHATSAPP_RELEASE_REVIEW.md)
for the current validation results, worker/image-parity and backlog blockers,
private secret-continuity checks, and exact disabled-deployment commands. The
local validation counts below record the original repair completion; the release
review adds regression coverage and supersedes those counts. Live delivery is
not verified, and existing pending jobs are not automatically quarantined at
deployment.

## Findings and evidence limits

The prior checkout accepted local delivery contact numbers, but called strict
international WhatsApp validation on that number when a consent box was checked.
That exposed `invalid_recipient` before payment. The order resolver also preferred
`shipping.phone` over the explicit consent number. A saved address could therefore
override the intended WhatsApp recipient. These are reproduced in isolated tests.

General messaging and restricted order messaging are separate gates by design.
The general gate being off does not disable an explicitly authorized restricted
order gate. The admin page now explains the scope and configuration blockers.
An HTTP 200 with a WAMID is acceptance, not proof of delivery. Missing production
receipts cannot be attributed to application parsing or Meta subscription settings
from the screenshots alone. This repair did not inspect or change live Meta,
production databases, credentials, webhook subscriptions, or VPS settings.

## Data and consent

- Signup stores canonical `users.phone`, `phoneCountry`, `whatsappPhone` and
  `whatsappCountry`. The new country selector defaults to India but validates the
  operator's selected country with phone metadata. Backend validation is authoritative.
- `phone` remains the account contact; address `phone` remains a delivery contact.
  The primary WhatsApp contact can be updated independently in profile or explicitly
  saved from checkout. Saving an alternate does not rewrite delivery addresses.
- New orders atomically store `whatsappRecipient`, `whatsappCountry`,
  `whatsappRecipientSource` (`primary_account` or `alternate_checkout`) and
  `whatsappConsent`. The worker uses and revalidates this exact snapshot, never
  substitutes a changed profile/address, and fences recipient changes during retries.
- Existing explicit primary transactional consent can be copied to the order for
  the same number. New numbers require a fresh explicit grant. The grant records
  category, source, timestamp, exact consent text and `transactional-v3` version.
  OTP permission and marketing permission remain separate and optional.
- An order without WhatsApp consent can still be paid. It records a skipped
  notification reason and never inherits consent for a different number.
- Profile withdrawal and signed STOP suppression remain authoritative. Changing
  the phone clears frontend consent choices. Provider retries recheck current consent.
- Message logs add order number, customer ID, recipient source and safe explanations
  derived from Meta error codes. They never store arbitrary provider error strings.
  Older manual test rows without an order cannot be truthfully backfilled and remain
  unlinked. Skipped automated attempts are now visible in the existing message logs.

## Backward compatibility and migration

No bulk database migration is run or required. The fields above are additive.
Existing E.164 account numbers remain usable with valid recorded consent. Existing
local-format numbers require the customer to confirm a country and number through
profile or checkout. The server parses local numbers only with an explicit ISO
country; it never infers India from a ten-digit number, address, or account region.
Normalization alone never grants consent. Existing order snapshots are not rewritten;
legacy order resolution remains available with its existing consent checks. A changed
recipient/consent requires a new checkout attempt rather than reusing a provider order.

Existing indexes on outbox `_id`, unique Meta `providerId`, event history and
customer/time consent records remain in use. No new index or retention policy is
needed. All validation tests use in-memory databases; no live documents were migrated.

## Gates and deployment prerequisites

No new environment variables. Existing required server configuration names:
`WHATSAPP_ENVIRONMENT`, `WHATSAPP_API_VERSION`, `WHATSAPP_APP_ID`,
`WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_OUTBOX_KEY`,
`WHATSAPP_CANONICAL_URL`, `WHATSAPP_TEMPLATES`, `WHATSAPP_EXPECTED_DATABASE`,
`WHATSAPP_WORKER_LEASE_SECONDS`, `DB_NAME`, `MONGO_URI`/`MONGO_DB` and
`RATELIMIT_STORAGE_URI`. Preserve existing encryption keys across deploys.

Restricted order delivery requires both the explicitly authorized backend
`WHATSAPP_ORDER_NOTIFICATIONS_ENABLED` and admin `orderNotificationsEnabled`,
plus an individually enabled mapping with fresh exact Meta approval/components.
General `WHATSAPP_ENABLED`, local `WHATSAPP_TEST_SEND_ENABLED`, marketing
`WHATSAPP_MARKETING_ENABLED`, and temporary production testing remain independent.
This repair changes none of their environment values and activates no messaging.

The existing bounded worker must be scheduled: from the backend directory run
`python -m flask --app wsgi:app whatsapp-worker`. Use the existing production
worker service/timer with the backend environment and the expected database guard;
do not start a worker against live pending jobs without authorization. It sends
only permitted order events when general messaging is off. Explicit rate-limit
rejections receive bounded backoff; ambiguous timeouts/5xx are held for operator
reconciliation because replay could duplicate an already accepted message.

## Controlled live acceptance procedure (requires separate authorization)

1. Review/deploy the change through the normal process. Use only a business-owned
   or explicitly authorized tester's WhatsApp number and an approved test purchase.
   Do not use an unsuspecting customer's order or replay old paid orders.
2. Read Meta inventory freshly using the admin Refresh Meta statuses action or
   `python -m flask --app wsgi:app whatsapp-template-refresh`. Confirm exact
   `rk_order_confirmation`, actual language, category UTILITY and components.
   The code blocks stale, missing or mismatched evidence; do not override it.
3. Use admin Test connection or the read-only `whatsapp-provider-audit` command to
   check the configured registered business Phone Number ID, WABA and app association.
   Check permissions/token validity server-side; never copy credentials to a browser.
   No current approval, permission or subscription is asserted by local tests.
4. In Meta, manually verify the published app, HTTPS callback
   `https://rashikapoor.co.in/api/webhooks/whatsapp`, matching backend verify token,
   App Secret signature checking, `messages` subscription and correct WABA/app
   subscription. GET verification must echo the challenge; unsigned POSTs must be
   rejected. Follow Meta's current dashboard requirements without disabling HMAC.
5. With approval, enable only the restricted backend/order admin gate and the
   verified order-confirmation mapping. Keep general messaging, marketing and
   development test sending off. Confirm worker scheduling and inspect pending jobs
   before allowing dispatch. The general Enable button is not an order prerequisite.
6. Sign up using the tester's explicit country and canonical number. Separately
   grant transactional consent; leave marketing unchecked. At checkout select a
   different authorized tester number if testing the alternate path, grant consent
   to that number, and choose whether to save it as primary.
7. Complete the approved Razorpay test payment flow. Server verification/captured
   payment must precede exactly one outbox job. Check saved order recipient/source,
   WAMID, HTTP status and one order-confirmation log. Confirm email still operates.
8. Inspect signed POST receipt processing and observe sent/delivered/read or failure
   by exact WAMID. Opening/refreshing order-success must create no extra send. A read
   receipt may not be available; do not fabricate it or exact delivery time.
9. Disable the authorized order admin control after the test if rollout is not yet
   approved. Inspect ambiguous jobs rather than replaying them. Verify no marketing,
   OTP, manual tests or unrelated lifecycle events were enabled by this procedure.

The procedure above is documentation only; no real messages were sent by this work.

## Local validation and review scope

- Full backend suite: 567 passed, 1 skipped (optional live integration), two existing
  mongomock deprecation warnings. All Meta/Razorpay test requests are mocked.
- New checkout/phone/signup regressions: 21 passed, including verified signup
  persistence of the exact phone, country, consent category, source, text and version.
- Frontend node tests: 158 passed, 1 pre-existing unrelated homepage editorial-copy
  assertion failed (`Where the art of` versus the current line-broken homepage copy).
  The homepage source and that test are untouched.
- TypeScript validation and Python compile checks passed.
- Production Next.js build passed. WhatsApp Playwright suite passed 51 tests;
  test runs use a local production frontend with mocked API routes and no live sends.
- Whitespace checks passed. The pre-existing untracked patch retains SHA-256
  `BB10EBA2073C396DA009F9106DEA48F54B497A4886E2B8FECE7D5E6070BAF866`.
- Backend/frontend test logs were reviewed. Live server logs, actual production
  credential permissions, live database documents, template evidence and Meta
  delivery/subscription settings were not read or changed by these local tests.

Phone validation uses the existing Python `phonenumbers` dependency and the new
frontend [libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js)
max metadata dependency. No provider templates, pricing, payment calculations,
email implementation, production environment values or legal pages were changed.

## Exact changed files

- `backend/app/blueprints/auth/routes.py`
- `backend/app/blueprints/payments/routes.py`
- `backend/app/checkout_whatsapp.py`
- `backend/app/phone_numbers.py`
- `backend/app/whatsapp.py`
- `backend/app/whatsapp_catalogue.py`
- `backend/app/whatsapp_consent.py`
- `backend/app/whatsapp_diagnostics.py`
- `backend/app/whatsapp_marketing_consent.py`
- `backend/app/whatsapp_orders.py`
- `backend/app/whatsapp_routes.py`
- `backend/tests/test_whatsapp.py`
- `backend/tests/test_whatsapp_checkout_repair.py`
- `docs/WHATSAPP_CHECKOUT_REPAIR.md`
- `frontend/app/account/page.tsx`
- `frontend/app/account/profile/page.tsx`
- `frontend/app/admin/integrations/whatsapp/page.tsx`
- `frontend/components/checkout/checkout-page.tsx`
- `frontend/components/commerce/international-phone.tsx`
- `frontend/lib/phone-number.test.mjs`
- `frontend/lib/phone-number.ts`
- `frontend/lib/whatsapp-consent.ts`
- `frontend/package-lock.json`
- `frontend/package.json`
- `frontend/tests/whatsapp-ui.spec.ts`
