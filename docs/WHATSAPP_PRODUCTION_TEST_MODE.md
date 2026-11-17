# Restricted temporary production template tests

## Local provider-eligibility correction awaiting review

The prepared change on `main` is not committed, pushed or deployed. No production
gate, expiry, secret, Meta setting, queue or timer was changed and no message was
sent. This supersedes the older AVAILABLE-only eligibility description below.

Provider evidence remains bound to the exact app/WABA/phone/configuration and
expires after 15 minutes. `senderStatus` is the canonical registration field;
legacy `registration` remains readable. Conflicting fields fail closed rather
than claiming a connected phone is disconnected. OTP status, WABA verification,
actual Meta `name_status`, quality and messaging tier remain independent facts.
The exact `WHATSAPP_BUSINESS_PORTFOLIO_ID` from Meta Business Settings is also
required to bind the health response's `BUSINESS` entity; the current read-only
Meta health response returned `982250818266556`. It must not be replaced with
the WABA ID. Missing or mismatched portfolio identity invalidates the proof.

Only a manually initiated production Utility-template test can use the exact
documented PHONE_NUMBER display-name limitation: overall LIMITED, only the phone
messaging entity LIMITED, its sole recognized reason being the unapproved display
name, and WABA/BUSINESS/APP messaging AVAILABLE. Unknown reasons, incomplete or
mis-scoped entities, missing tier, messaging errors and any messaging BLOCKED
entity remain ineligible. Meta's documented SIP-only aggregate BLOCKED shape is
messaging-eligible only when all four entity messaging states are AVAILABLE and
every reported error is an entity-scoped SIP code on a SIP-BLOCKED entity. The
raw aggregate remains in diagnostics. Calling/SIP statuses and codes 138024/138025
are separate.
For this exact display-name limitation, `PENDING_REVIEW` and
`AVAILABLE_WITHOUT_REVIEW` are compatible with the manual Utility exception;
available without review is not a reviewed `APPROVED` name. `APPROVED` conflicts
with the unapproved health reason. `ACTIVE`, `DECLINED`, `EXPIRED`, `NONE` and
unsupported non-empty statuses fail closed. Missing/unavailable `name_status`
is shown as `UNKNOWN` and does not independently decide eligibility. The latest
stored sender proof is rechecked immediately before the first provider request
and on every retry; no live Meta lookup is implied by that recheck.
Old health snapshots without the complete version-2 entity details require a
fresh guarded diagnostic read after any approved deployment; they cannot opt in
to the exception merely from a stored eligibility boolean.

The exact template name, language, Utility category, current approval and matching
components must be backed by fresh account-bound Meta observations. The backend
checks those observations, provider evidence and expiry again before dispatch
and each retry. Consent attestation, normalized recipient, suppression/STOP,
request-ID idempotency, admin auth and shared send limits remain mandatory.
The production test gate must still be explicitly opened by a separately
authorized operator with a maximum 24-hour UTC expiry; this change opens nothing.

Billing ledger status stays unverified and is never inferred from AVAILABLE,
LIMITED or an accepted request. Explicit billing errors and unresolved 131042
dispatch records block testing. A latest recorded account restriction (131031 or
368) also blocks the exception. Old failures do not silently expire into payment
clearance, and a connection GET cannot erase their message-record evidence.
Legacy unscoped failures are handled conservatively pending reconciliation;
future records carry a private provider-scope binding. Reconciliation is not a
reason to delete a log, replay a job or treat a checkbox as provider clearance.

The current tier/capacity is shown. For the exception, existing local message
claims conservatively reserve unique-recipient slots across a rolling 24-hour
window, including ambiguous attempts; quota is checked before claim/dispatch and
on retries. A repeated recipient does not consume a new unique slot. This local
check cannot observe sends outside RK-WEB or all other business phone numbers.
Meta remains authoritative for business-wide capacity; no tier increase is
requested and no provider quota failure is bypassed.

The health card preserves safe per-entity `can_send_message`, `additional_info`,
errors, timestamp and masked scope. It displays SIP separately and directs
display-name review to WhatsApp Manager > Phone numbers > select number > Profile
> Display name. Private credential-derived scope hashes never reach the frontend.
There is no phone re-registration instruction. Worker UNKNOWN remains independent
of manual tests. Order automation, Authentication, Marketing and free text cannot
use this exception; their existing gates and flows are unchanged.

Reference: [Meta messaging and calling health status](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/health-status).

Implemented locally; no production environment, Meta settings or messaging gates were changed. The mode defaults off. This does not authorize deployment or a real send.

**Current sender interpretation (17 November):** Fresh WABA evidence reports business verification `verified` and tier `TIER_250`; the Phone Number ID reports `status=CONNECTED`, `code_verification_status=NOT_VERIFIED`, and quality `GREEN` (Manager displays HIGH). Meta documents code verification as the phone ownership OTP flow and `CONNECTED` as the status required for Cloud API send/receive. These fields conflict. Diagnostics show each independently and mark the combined sender check UNKNOWN; they do not infer disconnection or recommend removing/re-registering the number from this mismatch. Fresh phone health is still LIMITED, and billing clearance is not verified. Those remain separate blockers. The 250 tier is active capacity, not a sending restriction. See [the final production readiness report](WHATSAPP_FINAL_PRODUCTION_READINESS.md).

**Additional current prerequisite:** manual production tests require account-bound sender/provider diagnostic evidence no older than 15 minutes, independently of the maximum 24-hour UTC test window. Health and exact phone/WABA/app entities must be AVAILABLE, WABA business verification VERIFIED and phone status CONNECTED. Rechecks occur immediately before dispatch and after retry backoff. Billing ledger clearance is not inferred from a card charge or health request; manual account reconciliation remains required. UNKNOWN/LIMITED health cannot authorize a test. Refresh never activates a gate. Historical observations/counts below are superseded by the dated current findings above.

Backend environment names and safe defaults:

```dotenv
WHATSAPP_PRODUCTION_TEST_SEND_ENABLED=false
WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT=
```

A separately authorized temporary configuration must supply a future ISO 8601 UTC expiry, including seconds and either `Z` or `+00:00`. The administrator enters one recipient manually for each request. Each request permits one valid, normalized E.164 number; bulk sends, imports, broadcasts and recipient queues are not supported. The expiry may be at most 24 hours after the current UTC time: exactly 24 hours is accepted; any later instant is rejected. Naive timestamps, nonzero offsets, invalid dates, malformed/noncanonical phone numbers, missing values and expired/equal-to-now timestamps fail closed. The backend checks recipient validity and expiry when the admin request arrives, immediately before each provider dispatch and again after retry backoff. Use a short deliberate test window; the implementation does not invent an expiry or extend it automatically. Reaching the expiry stops new dispatches and retries, including already-open admin forms. It cannot cancel a request Meta has already received.

The environment must be production and these three settings remain hard-disabled by ProductionConfig:

```dotenv
WHATSAPP_ENABLED=false
WHATSAPP_MARKETING_ENABLED=false
WHATSAPP_TEST_SEND_ENABLED=false
```

The temporary mode refuses dispatch if any of those old gates is on. The development-only switch and free-text test endpoint retain their old behavior. `test_send_enabled()` is still development-only. Only the admin `POST /api/admin/integrations/whatsapp/test-send` endpoint opts into restricted production sending through the existing transport. No second client, queue or order-event path is introduced.

Every send requires active admin authorization, explicit operator confirmation that they verified the recipient supplied the number and agreed to receive WhatsApp messages from this business, the existing shared test rate limit and request-ID deduplication. The audit records this as an operator attestation and labels its evidence as not system-verified; it does not create a customer consent record or claim the checkbox independently proves consent. Existing signed STOP suppression is checked before dispatch. The exact Utility template name/language, fresh WABA-bound Meta APPROVED evidence, verified components and all component parameters are mandatory. Local mapping enablement and local approval flags do not authorize sending. Marketing/Authentication templates and free text cannot use the mode. The transport checks the entered E.164 recipient and expiry at entry, on every retry and immediately before the provider request. Template evidence and suppression are rechecked for retries.

No template mapping or Meta template was changed. Explicitly configured `3p_direct_integration_test_template` mappings can now validate in production against the same exact static contract and fresh provider evidence. Its development default remains development-only; production does not automatically acquire that mapping or approval.

The admin status response keeps `testSendEnabled` development-only and exposes a separate `productionTest` object to authenticated admins with effective enablement, UTC expiry and safe blocking reason. Test Messages provides an editable recipient field and allows one manual test to any valid E.164 recipient. It disables sends for an invalid number, expired mode or ineligible template. A page timer updates expiry without a reload. Backend checks remain authoritative. Tokens, App Secrets and encryption keys are never returned.

Results use the existing WhatsApp message log, `testSend=true`, `productionTestSend=true`, configured Phone Number ID, Meta message ID and safe API status/error fields. Existing delivery/read/failure webhooks correlate normally. No order notification is enqueued or real order lifecycle event triggered. Ambiguous outcomes retain existing no-blind-retry behavior.

To end a separately authorized test window, turn the new flag off and clear its expiry through the approved runtime configuration process. No admin toggle can enable or extend it. Do not copy local environment files onto the server. The ordinary disabled-release readiness and index-maintenance commands refuse an enabled temporary production flag; conduct those operations with all sending gates off. This narrow test mode does not satisfy outstanding deployment, webhook, WABA subscription or production-readiness blockers documented in the audits.

Automated tests mock every Meta request and use an in-memory database. Run from `backend/`: `python -m pytest -q`. Run from `frontend/`: `npm run typecheck`, `npm run build`, then `npm run test:whatsapp-ui`.

Local validation on 2026-11-15 after enforcing the maximum window: full backend **498 passed, 1 skipped**, with two existing mongomock deprecation warnings; the skip is the real Nginx test because Nginx is unavailable. WhatsApp browser suite **46 passed**. TypeScript and the production build passed (62 generated pages). The frontend Node suite retains the pre-existing homepage assertion expecting contiguous `Where the art of` across a `<br />`; its test and component both match HEAD. Git whitespace and secret-content scans passed. No real Meta requests, production environment edits, commits, pushes or deployments were performed for this change.


## Production diagnosis: 16 November 2026

A read-only inspection of the running backend at 11:42:37 UTC confirmed:

```dotenv
WHATSAPP_ENVIRONMENT=production
WHATSAPP_PRODUCTION_TEST_SEND_ENABLED=false
WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT=
WHATSAPP_ENABLED=false
WHATSAPP_TEST_SEND_ENABLED=false
WHATSAPP_MARKETING_ENABLED=false
WHATSAPP_ORDER_NOTIFICATIONS_ENABLED=true
```

These values were read, not changed. `production_test_state()` evaluates the
production environment/switch first, so this produces `production_test_disabled`.
It is **not** an expiry-only error: enabling the switch without setting the empty
expiry would next produce `production_test_expiry_invalid`. No test request reaches
Meta while this application gate is closed. The active order worker and order
environment gate are independent and do not enable one-off testing.

The backend reads the two manual-test variables in `backend/app/config.py` through
`os.getenv`. ProductionConfig deliberately keeps the three general/development/
marketing gates false; it does not force the separate production test switch off.
Base Compose supplies `/opt/apps/rashi-kapoor/rk-web/.env` through `env_file` on the
VPS, and the service's runtime process environment takes precedence. Configure the
protected server runtime source through its authorized operator, not frontend
variables, a local `.env`, a browser header, a database mapping switch or Meta.
No admin PATCH endpoint enables this temporary mode.

A container must be **recreated** to receive changed Compose environment values;
`docker restart` or a browser refresh does not inject a changed host environment.
Preserve the exact reviewed backend image and all existing secrets, especially
`WHATSAPP_OUTBOX_KEY` and `WHATSAPP_APP_SECRET`.

### Distinct sending paths

| Path | Authority and scope |
| --- | --- |
| Manual production Utility test | Separate opt-in production test switch plus explicit UTC expiry. Admin-only `/api/admin/integrations/whatsapp/test-send`, one recipient/request, fresh exact approval/components and explicit consent attestation. No order ID, order transition, order event or automated outbox enqueue. |
| Automated transactional orders | Backend `WHATSAPP_ORDER_NOTIFICATIONS_ENABLED` plus admin order control, individually enabled approved mappings, verified payment/events and exact persisted recipient consent. Uses the persistent encrypted outbox/worker. Does not authorize a manual test. |
| General automation and WhatsApp OTP | General backend/admin gates plus the exact Authentication template, live OTP challenge and separate explicit OTP request where applicable. The production general gate stays false. Transactional signup consent does not request an OTP. |
| Marketing | Separate marketing enablement, general messaging authority, approved Marketing templates, active marketing consent and campaign/suppression validation. Manual Utility testing cannot activate it. |
| Development free text | Development environment and development test gate, consent and verified 24-hour customer service window. Not available through production testing. |

### Meta evidence is independent of application gates

- The supplied billing observations report an earlier account restriction, a
  successful Visa charge and a remaining INR 0.93 balance. No fresh billing-ledger
  read was performed; the exact cause of that remaining balance is **unconfirmed**.
  Do not assume rounding, settlement delay, new usage, wrong account allocation or
  successful restriction clearance. Match the charge to this exact WABA/payment
  account, review the current balance and restriction state, and ask Meta billing
  support to reconcile an inconsistency. Do not repeatedly charge the card to
  diagnose it. The application cannot clear a Meta restriction.
- The read-only Meta audit confirmed `rk_order_confirmation`, `en_US`, `UTILITY`,
  `APPROVED` and matching components. Quality `UNKNOWN`/pending is separate from
  approval; it is not a reason to reclassify an approved template as pending.
- The 17 November read returned WABA `business_verification_status=verified`,
  phone `status=CONNECTED`, `code_verification_status=NOT_VERIFIED`, and quality
  `GREEN` (shown as HIGH in WhatsApp Manager). Business verification, phone OTP
  ownership-code state, Cloud API connection/registration, and health-based
  messaging eligibility are distinct facts. The CONNECTED/NOT_VERIFIED pair is
  conflicting evidence; it does not establish disconnection. Preserve the sender:
  do not remove, re-add, re-register, deregister, or request a new code based on
  this diagnostic alone. The independent `health_status=LIMITED` remains a blocker.
- `TIER_250` is active capacity for up to 250 unique recipients per rolling
  24-hour period, not a sending restriction. The dashboard's five conversations
  over seven days is a separate metric. No tier increase was requested.
- App membership in the WABA and the configured Phone Number ID's membership were
  confirmed by read-only Meta requests. The app-level active production callback
  and its `messages` field remain unverified without appropriate app-token access
  or a dashboard inspection. A WABA membership check alone does not establish them.
- A closed 24-hour customer service window blocks free text, not a correctly
  approved/eligible template. It does not remove billing or sender restrictions.
- HTTP 200/WAMID means accepted/submitted. Delivery/read/failure must be reconciled
  from signed `messages` webhooks. A successful connection GET or payment receipt
  is not message delivery evidence.

Official references: [Meta error codes](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes)
identify billing/business eligibility error 131042, registration errors 131045,
133006 and 133010, and the template alternative for a closed service window.
[Meta registration](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration)
distinguishes ownership verification from the API registration operation.

### Newly added local diagnostics

The admin status response exposes safe diagnostic codes/messages. Test connection
requests and records only allowlisted phone verification metadata and a timestamp,
plus the existing WABA subscription result. A successful GET does not clear
historical billing failure evidence used in diagnostics: relevant existing message
failures are read separately. A recorded failure is labelled historical evidence,
not proof of the current unpaid balance or a new send restriction. Unknown billing
and webhook evidence are labelled unknown. No new billing verification or approval
flag is invented. The UI shows selected template category, approval, evidence
freshness, component verification and application test gate independently.

These messages do not modify `eligibleForTesting`, consent/suppression, recipient
normalization, expiry checks, rate limits, request IDs, encryption, retry rules or
provider policy. No Meta-specific restriction is bypassed. The OTP code status is
shown as reported, without a misleading ACTION REQUIRED/blocked conclusion when
the same fresh read reports CONNECTED. This does not claim that billing or the
separate LIMITED health state has been repaired.

### One controlled short test: procedure requiring explicit authorization

1. **Resolve provider blockers first.** Confirm the correct WABA's billing/account
   restriction is cleared and ownership/Cloud API registration is valid. Verify
   the production callback, `messages` subscription and exact current template.
   Do not treat a charged Visa transaction alone as resolution. No code change or
   general messaging toggle substitutes for these checks.
2. **Agree on isolation.** The worker is already active and the order gate is on.
   Obtain explicit authorization for a maintenance pause before claiming the test
   is the only possible outgoing message. An authorized operator may stop the
   timer with `sudo systemctl stop rk-whatsapp-worker.timer`, then let the active
   bounded worker finish naturally. Verify `systemctl is-active rk-whatsapp-worker.service`
   reports inactive and `docker ps --filter name=rk-whatsapp-worker --format '{{.Names}}'`
   is empty. Do not force-reset in-flight claims. Review the existing backlog before
   any later resume. The production test gate itself does not require the separate
   order flag to change; any order-gate change needs its own authorization.
3. **Select only an authorized business-owned/tester recipient.** Retain evidence
   that the person provided this WhatsApp number and agreed to this message.
   The checkbox records an operator attestation, not independent proof of consent.
   There is no configured-recipient variable or hidden allowlist; the operator
   enters one normalized E.164 number per request. Existing STOP blocks still apply.
4. **Authorize a 15-minute backend test window.** On the VPS, generate a fresh UTC
   expiry immediately before configuration:

   ```sh
   date -u -d '+15 minutes' '+%Y-%m-%dT%H:%M:%SZ'
   ```

   In the protected production runtime configuration, set only the intended test
   switch/expiry through the approved operator process:

   ```dotenv
   WHATSAPP_PRODUCTION_TEST_SEND_ENABLED=true
   WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT=<fresh UTC timestamp from the command above>
   WHATSAPP_ENABLED=false
   WHATSAPP_TEST_SEND_ENABLED=false
   WHATSAPP_MARKETING_ENABLED=false
   ```

   Do not paste the angle-bracket placeholder literally. The expiry must be strictly
   after server UTC now and no more than 24 hours ahead. It must include `Z` or
   `+00:00`; missing, malformed, naive, non-UTC, equal-to-now, expired or farther
   future values fail closed. Nothing extends it automatically.
5. **Recreate only the approved backend after authorization.** In an authorized
   server shell with access to the existing protected image-reference file:

   ```sh
   cd /opt/apps/rashi-kapoor/rk-web
   set -a
   . /etc/rk-whatsapp/images.env
   set +a
   docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml up -d --no-build --pull never --no-deps --force-recreate backend
   ```

   This is a procedure, not an action performed by this repair. Confirm the selected
   image is the reviewed image and preserve all keys; do not rebuild or pull an
   arbitrary image to change a gate. The current SSH account cannot read the
   protected image file without additional access. Verify backend health and the
   admin response: `productionTest.enabled=true`, the exact new UTC expiry and
   no application blocking reason. Do not use the general Enable WhatsApp button
   or switch automated mappings on to make a test eligible.
6. **Initiate one test through Test Messages.** Select the exact freshly verified
   Utility template/language; an automated mapping can remain disabled. Preview its
   approved components and enter all exact parameters. Use clearly labelled test
   content, not an invented real order. Confirm the intended recipient and its
   documented consent, then click Send once. Preserve the same request ID for any
   retry/reconciliation; a new request ID represents a new send request. Do not
   create an order or trigger a payment/order lifecycle event for this test.
7. **Inspect the result rather than retrying blindly.** The log must have
   `testSend=true`, `productionTestSend=true`, `orderId=null`, HTTP status and WAMID
   if accepted. Match subsequent sent/delivered/read/failed receipts by WAMID.
   Error 131042 or another provider restriction requires provider remediation;
   changing gates, recipients or templates is not a bypass. Ambiguous outcomes
   retain the existing reconciliation policy. Expiry is rechecked at dispatch
   and after rate-limit backoff.
8. **Close the window.** Set `WHATSAPP_PRODUCTION_TEST_SEND_ENABLED=false`, clear
   the expiry through the same authorized process, and recreate the backend again.
   Verify `production_test_disabled` and the Send button disabled. Keep the worker
   paused until a separately authorized backlog review/resume. Do not enable broad
   automation, OTP or marketing as part of ending the test.

No step above was executed to enable testing, pause/start services, register a
number, charge a payment method or send a real message. Diagnostics were implemented
locally; the only new production inspection read the existing switch/expiry and
other non-secret gate states. Earlier read-only Meta findings are identified above.


### Validation of the diagnostic update

- Full backend suite: **578 passed, 1 skipped**, two existing mongomock warnings.
- WhatsApp browser suite: **53 passed**. All sends/provider API interactions in
  these automated tests are mocked.
- Frontend node tests: **158 passed, 1 pre-existing homepage-copy failure** already
  reproduced at the base revision in WHATSAPP_RELEASE_REVIEW.md.
- TypeScript, production frontend build (63 static pages), secret scans and
  whitespace checks passed.
- New regression coverage checks the disabled-switch explanation, historical
  billing evidence after a successful connection GET, unverified phone and missing
  WABA diagnostics, closed-window approved-template sending, no order mutation,
  and the disabled browser Send button despite visible diagnostics.

Files changed for this diagnostic update (earlier checkout/release work preserved):

- `backend/app/whatsapp_diagnostics.py`
- `backend/app/whatsapp_routes.py`
- `backend/tests/test_whatsapp_diagnostics.py`
- `frontend/app/admin/integrations/whatsapp/page.tsx`
- `frontend/tests/whatsapp-ui.spec.ts`
- `docs/WHATSAPP_PRODUCTION_TEST_MODE.md`
