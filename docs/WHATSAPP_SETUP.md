> Historical implementation/submission notes. Current operations and off-gate policy are in [WHATSAPP_DEPLOYMENT.md](WHATSAPP_DEPLOYMENT.md); current verification and remaining blockers are in [WHATSAPP_POST_REMEDIATION_AUDIT.md](WHATSAPP_POST_REMEDIATION_AUDIT.md). Older flags, counts, approval snapshots and activation instructions below are historical. Template definitions are not proof of Meta approval.

# Official WhatsApp Cloud API — RK-WEB

## Current state and routing

Local implementation only; messaging remains disabled by default. No deployment, Meta account/number change, production environment change or real message is included in the tests. Protect the existing WhatsApp Business app/number: use Meta's test number first. Migration, registration, coexistence or deregistration requires a separately approved plan.

- Admin: `/admin/integrations/whatsapp`
- Flask: `GET|POST /api/webhooks/whatsapp`
- Production callback: **https://rashikapoor.co.in/api/webhooks/whatsapp**
- Local development callback: backend `WHATSAPP_DEVELOPMENT_CALLBACK_URL`, with no production fallback when empty/invalid. The admin page explicitly labels the resolved environment.

Routing is verified from source: `frontend/next.config.mjs` preserves `/api/:path*` when forwarding to Flask; `docker-compose.yml` sets `BACKEND_INTERNAL_URL=http://backend:5000`; `backend/app/__init__.py` mounts the blueprint at `/api/webhooks`. The production domain is present in existing site metadata and the CORS allowlist. This callback has not been deployed or tested externally. Saving it in Meta now cannot validate the local changes.

## Architecture

The completed order-event map, contact policy, shipment resend rules and worker requirements are in [WHATSAPP_ORDER_LIFECYCLE.md](WHATSAPP_ORDER_LIFECYCLE.md). The seven automatic Utility mappings require exact components and actual Meta read evidence; operator approval flags cannot authorize them.

`app/whatsapp.py` contains the official HTTPS transport, encrypted outbox, worker, consent checks, international number validation and independent message claims. `app/whatsapp_templates.py` owns all template names, languages, categories and parameter order. `app/whatsapp_routes.py` provides signed public webhooks and existing `requireAdmin` authorization for administration.

Customer workflows enqueue delivery so Meta network latency stays outside checkout and email requests. Failures are caught at the WhatsApp boundary. Zoho keeps its existing behavior and separate email claims. Outbound message `_id` reservations are atomic across workers. Meta acceptance is recorded as `accepted`, not delivery success.

Storage:

- `whatsapp_messages`: masked recipient, keyed phone fingerprint, template/event, order reference, correlation/provider IDs, status, timestamps, attempts and allowlisted error kind/code. No bodies, OTPs, raw provider errors, names, addresses or email addresses. Retain deduplication tombstones when archiving logs.
- `whatsapp_outbox`: Fernet-encrypted phone/parameters for deferred delivery. OTP jobs expire at the existing challenge's absolute ten-minute expiry and recheck consumption/attempts/hash; utility jobs expire after 24 hours. Payloads are removed after processing and TTL removes expired queue entries. Do not dump or decrypt this collection into logs.
- `whatsapp_inbox`: incoming message ID digest, keyed sender fingerprint, type and provider time only. No customer text/media is retained or executed; no automatic reply is sent. Metadata expires after 30 days and supports the internal 24-hour text reply guard.
- `whatsapp_events`: idempotent account/status event metadata, with 30-day retention. Account events do not automatically approve templates.
- `whatsapp_consents`: private consent audit with phone/customer/category/status/time/source/order, never OTP values. `whatsapp_optouts` stores keyed phone blocks; signed STOP commands and explicit profile withdrawal block pending work and test sends.
- `whatsapp_template_status`: safe observed Meta review statuses that can block revoked mappings; backend configuration remains explicit.
- `whatsapp_manual_events`: actor and independent email claims for manual lifecycle updates. `integrations/whatsapp` stores the non-secret admin switch and operational timestamps/status.
- `whatsapp_order_events`: permanent order/event claims and safe queued/skipped/failed reasons. Staff order details join these records to the existing encrypted outbox and delivery log without decrypting parameters.

Signed events are scoped to the configured WABA and phone ID. In Meta's app webhook configuration, subscribe the **`messages`** field: the handler processes both inbound `messages[]` and outbound delivery/read `statuses[]` from `changes[].value` on that field. The local connection check confirms whether the app is attached to the WABA through `subscribed_apps`; it does not verify the app-level webhook field selection, which must be checked in Meta. Duplicate status callbacks are harmless; out-of-order callbacks cannot downgrade a read/delivered state, and a read receipt itself confirms delivery without inventing a delivered timestamp. Webhooks remain available while outgoing messaging is disabled.

Only explicit rate-limit rejections are retried: at most three HTTP attempts per dispatch, then at most two durable queue retries after 30/120 seconds or the longer numeric Meta Retry-After, within the job expiry. Only a definitively rate-limited message without a provider ID can be atomically reclaimed for this retry. Timeouts, server failures and malformed success responses can represent accepted messages, so they become `unknown` and are not blindly resent. Interrupted worker claims stay `processing`; reconcile with Meta/message logs before acting. MongoDB and Meta do not share a transaction: this implementation does not promise exactly-once delivery, automatic crash recovery or guaranteed eventual delivery.

## API version and official references

On 2026-11-12, [Meta's official Python Business SDK configuration](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py) declares `API_VERSION: v26.0`. This is an observed official-source version, not a claim that it is the latest Graph version. Official changelog requests returned HTTP 429 during implementation. Verify app/WhatsApp support and the current version in the changelog before activation. Code requires an explicit version and has no guessed default.

- [Graph versions](https://developers.facebook.com/docs/graph-api/changelog/versions/)
- [WhatsApp overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview)
- [Webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview)
- [Templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)
- [Authentication templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates)

Dashboard labels, permissions and field availability can vary by account; confirm the options shown for this app.

## Backend environment checklist

Merge approved entries into the existing backend environment; do not replace entire environment files. Compose loads the backend from the repository-root `.env`; local Flask loads `backend/.env` and `backend/.env.local` following existing precedence. Existing production environment files are preserved; local overrides are read from the ignored `backend/.env.local`. Never use `NEXT_PUBLIC_*` or frontend variables for these values.

```dotenv
WHATSAPP_ENVIRONMENT=production
WHATSAPP_ENABLED=false
WHATSAPP_TEST_SEND_ENABLED=false
WHATSAPP_DEVELOPMENT_CALLBACK_URL=
WHATSAPP_API_VERSION=v26.0
WHATSAPP_PHONE_NUMBER_ID=<Meta sending Phone Number ID>
WHATSAPP_BUSINESS_ACCOUNT_ID=<Meta WhatsApp Business Account ID>
WHATSAPP_ACCESS_TOKEN=<Meta system-user access token>
WHATSAPP_APP_ID=<Meta Developer app ID>
WHATSAPP_APP_SECRET=<Meta App settings / Basic / App secret>
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<generated token supplied once in the final report>
WHATSAPP_OUTBOX_KEY=<separately generated Fernet key>
WHATSAPP_TEMPLATES={}
```

Generate the outbox key privately:

```sh
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

The webhook verify token uses 32 cryptographically random bytes. Save the final-report value in a password manager and set that exact value in both Meta and the backend. It is deliberately absent from this document and ordinary GET APIs. It is not the App Secret or access token. To replace it privately: `python -c "import secrets; print(secrets.token_urlsafe(32))"`. Update both sides together.

Configure reverse-proxy/access logging to omit webhook query strings containing `hub.verify_token` and Authorization headers. Disable HTTP debug logs. Pause messaging and reconcile/drain queues before rotating App Secret or outbox keys: App Secret changes phone fingerprints/deduplication scope; a new Fernet key cannot decrypt old queued payloads.

Automated messaging requires both the environment gate and admin database switch. The admin switch defaults false. Manual local test sends have a separate development-only gate described below and do not enable automation. Normal GET APIs return only non-secret IDs/version, presence flags, approved mappings, timestamps and safe errors. Secrets are environment-only.

## Local admin test-message tool

The **Send Test WhatsApp Message** section adds a manually entered E.164 recipient, textarea, explicit recipient-consent confirmation, backend window status, last incoming time, expiry and safe send result. The existing **Send approved test template** section remains available. Both test endpoints use the existing transport and delivery log; no second Graph client exists. These explicit admin tests send directly after validation so a queued text job cannot silently outlive its verified service window. They do not start or drain the automated outbox.

For an intentionally enabled local session, privately merge the following into the existing development backend environment. The existing local override enables only the explicit local test facility; automated messaging stays off:

```dotenv
FLASK_ENV=development
WHATSAPP_ENVIRONMENT=development
WHATSAPP_ENABLED=false
WHATSAPP_TEST_SEND_ENABLED=true
WHATSAPP_DEVELOPMENT_CALLBACK_URL=https://<your-temporary-https-tunnel>/api/webhooks/whatsapp
```

Use the configured Meta test number, consenting test recipient and existing backend-only Meta credentials/key/API version. Restart the local backend after changing its environment. Set `WHATSAPP_TEST_SEND_ENABLED=false` to switch tests off. Its default is false. The WhatsApp environment is read from the server-only `WHATSAPP_ENVIRONMENT`, normalized/validated and defaults to production when missing/invalid. The production application configuration class additionally forces production and both send flags off, regardless of environment flags. It is never selected from request headers, browser fields or a writable admin setting. Production always refuses this test facility even if someone sets the test flag true. The ordinary `WHATSAPP_ENABLED` and admin automation switch can remain off throughout testing.

Configure the development tunnel callback and matching verify token in the intended Meta test app. The page shows only the configured development callback; it never silently substitutes the production domain. A development URL must use HTTPS, have `/api/webhooks/whatsapp` as its path, and contain no user credentials, query or fragment. Production ignores this override and displays the fixed production callback. A configured display URL is not evidence that a tunnel is running or externally reachable. No tunnel or Meta configuration was created here.

Admin-only endpoints:

- `POST /api/admin/integrations/whatsapp/test-window` with `{ "recipient": "+14155552671" }`: reads the latest verified incoming customer message for the recipient and the current WABA/Phone Number ID; returns normalized recipient, `open`, `lastIncomingAt`, `expiresAt`, server `checkedAt` and `testSendEnabled`. Recipient input uses a POST body rather than query strings in access logs. It sends nothing.
- `POST /api/admin/integrations/whatsapp/test-message` with `recipient`, `message`, boolean `confirmed: true` and a stable random `requestId`: validates number, 1–4096 Unicode code points with non-whitespace content, consent, local gate, configuration and a fresh backend window check immediately before the existing text transport sends. Frontend status/checkboxes/timestamps cannot open a window. Keep the request ID for network retries and change it only for an intentional new message.
- `POST /api/admin/integrations/whatsapp/test-send`: retains the configured `test` template, explicit consent, backend approval/enabled checks and ordered parameter validation. No open customer-service window is required for an approved template. An optional `event` selects a configured utility event mapping, never an arbitrary template name. Exact ordered `parameters` must match its backend schema; authentication OTPs cannot be sent through this manual template tester.

The two send endpoints share the three/minute and ten/hour limiter. Window checks have a separate thirty/minute limit. No test send bypasses recipient consent, template approval or the free-text window rule. Incoming webhook signature verification remains mandatory. Only supported customer-message types with verified, current account/phone metadata can open a window. Pre-extension inbox records lacking that proof do not open one; receive a fresh signed customer message after updating. Out-of-order deliveries use the latest provider message timestamp and exact duplicates do not extend the window. Exactly 24 hours old is closed. The frontend polls/rechecks expiry, but the server remains authoritative at send time.

If closed or unknown, the recipient must first message the configured business, or the administrator must use an approved template. Never fabricate an incoming record to open a real messaging window. Test sends log masked recipient, text/template type, Meta ID, correlation, API HTTP status, delivery updates and safe error kind/code/subcode. They do not log typed text, raw Meta error messages, access tokens or App Secrets. Provider acceptance remains distinct from delivered/read status. Ambiguous timeouts are not automatically resent.

Production rate limits require shared `RATELIMIT_STORAGE_URI` using the existing supported backend storage. Memory limits are process-local and suitable only for isolated development. No production limiter configuration was changed.

## Meta app, assets and credentials

1. Open the existing Developer app and **Connect on WhatsApp** use case. Select the intended portfolio/WABA. Do not register, move, delete or migrate the real business number during this setup.
2. In **Basic setup / Step 1. Try it out**, or **API Setup**, use Meta's test number. Copy **Phone Number ID** and **WhatsApp Business Account ID**. These are Graph object IDs, distinct from the actual phone digits and Business Portfolio ID.
3. Copy **App ID** and reveal **App Secret** in **App settings / Basic** directly into the backend secret store.
4. In Business Settings / Users / System users, assign the app and necessary WhatsApp assets to a dedicated backend system user. Generate a token for the correct app with the least required permissions. Select a non-expiring/system-user token when offered; do not assume every token is permanent. Record expiry/rotation procedures privately.
5. Functional permissions: `whatsapp_business_messaging` for sending and `whatsapp_business_management` for account/template/subscription administration and the connection check. `business_management` may be needed by the operator for asset discovery/assignment; the runtime sender does not use it. Complete the account-specific verification, review/advanced-access and payment requirements shown by Meta.
6. **Test connection (no message)** performs read-only phone and `/{WABA_ID}/subscribed_apps` requests. It sends no messages and makes no subscription changes.

## Save the webhook in the supplied Meta screen

These steps require a separately authorized deployment and matching backend secrets first.

1. Open **Connect on WhatsApp / Basic setup / Step 2. Production setup / Configure Webhooks**.
2. Callback URL: `https://rashikapoor.co.in/api/webhooks/whatsapp`.
3. Verify token: the exact generated value from the final report, also stored as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Leave the client certificate option off unless independently configuring mutual TLS.
4. Click **Verify and save**. Meta sends `hub.mode=subscribe`, `hub.verify_token` and `hub.challenge`. Flask securely compares the token, returns only the challenge with 200, or returns 403. The admin page records verification time without returning the token.
5. For **whatsapp_business_account**, select **messages**. It includes inbound messages and sent/delivered/read/failed statuses; there are no separate delivered/read subscription fields.
6. Also select these operational fields when available: **account_update**, **account_alerts**, **phone_number_quality_update**, **phone_number_name_update**, **message_template_status_update**, **message_template_quality_update**.
7. Ensure the app is subscribed to this specific WABA through the supported dashboard or a separately authorized `/{WABA_ID}/subscribed_apps` operation. Saving the callback alone is insufficient. The connection check reports WABA subscription separately; selected fields must also be checked in Meta.
8. Run Meta's **messages** test event. POST requests must carry `X-Hub-Signature-256` computed with App Secret over the exact raw body. Missing/invalid signatures are rejected before processing. Inspect last webhook time in the admin page.
9. The supplied screenshot warns that unpublished apps receive only dashboard test webhooks. Complete **Publish your app**, business verification and required actions before expecting production events, according to Meta's requirements for this app. This implementation does not publish it.

## Template catalogue and compatible legacy mappings

The eight exact submission specifications, current approval tracking, new mapping schema, event proof requirements, consent behavior and remaining Meta publication checks are in [WHATSAPP_TEMPLATE_SUBMISSIONS.md](WHATSAPP_TEMPLATE_SUBMISSIONS.md). All 21 existing event keys remain supported. The table below describes the **legacy schema** for existing nonempty mappings; new catalogue mappings use their exact catalogue parameter contracts instead. New default authentication names are `rk_authentication_otp` for all three auth events; no default is approved or enabled.

### Legacy template approval and configuration

Every mapping starts disabled/unapproved. Create each required template in WhatsApp Manager for the correct WABA and language `en_US`, supply realistic samples, submit and wait for Meta approval. Set local flags only after the approved components match. Local `approved=true` is an operator assertion, not a Meta approval response; templates may later be rejected, paused or recategorized.

Authentication uses Meta's predefined authentication format, a single body code and a **Copy code** button. The same code is passed as body parameter 1 and URL button parameter 1, button index 0. Match the existing ten-minute code validity if configuring an expiry note; queued OTP delivery expires at that same absolute challenge expiry and rechecks consumption/attempts before each request. Do not add marketing copy or extra variables.

Utility bodies use event-specific non-promotional wording, with `{{1}}` for reference and `{{2}}` for update. Shipping/tracking add `Tracking details: {{3}}.` For example: `Rashi Kapoor: order {{1}} has this shipping update: {{2}}. Tracking details: {{3}}.` The test has no variables: `This is the WhatsApp connection test you requested from Rashi Kapoor. No action is needed.` Utility templates have body components only, with no extra buttons/headers. Meta determines final approval/category.

| Event | Template | Category | Body parameter order |
|---|---|---|---|
| signup_otp | rk_authentication_otp | AUTHENTICATION | code |
| login_otp | rk_authentication_otp | AUTHENTICATION | code |
| forgot_password_otp | rk_authentication_otp | AUTHENTICATION | code |
| order_confirmation | rk_order_confirmation | UTILITY | reference, status |
| payment_confirmation | rk_payment_confirmation | UTILITY | reference, status |
| payment_failure | rk_payment_failure | UTILITY | reference, status |
| processing | rk_processing | UTILITY | reference, status |
| packed | rk_packed | UTILITY | reference, status |
| shipped | rk_shipped | UTILITY | reference, status, tracking |
| tracking_update | rk_tracking_update | UTILITY | reference, status, tracking |
| out_for_delivery | rk_out_for_delivery | UTILITY | reference, status |
| delivered | rk_delivered | UTILITY | reference, status |
| cancelled | rk_cancelled | UTILITY | reference, status |
| return_requested | rk_return_requested | UTILITY | reference, status |
| return_status | rk_return_status | UTILITY | reference, status |
| refund_initiated | rk_refund_initiated | UTILITY | reference, status |
| refund_completed | rk_refund_completed | UTILITY | reference, status |
| custom_order_received | rk_custom_order_received | UTILITY | reference, status |
| custom_order_status | rk_custom_order_status | UTILITY | reference, status |
| admin_notification | rk_admin_notification | UTILITY | reference, status |
| test | rk_test | UTILITY | none |

`reference` is the order number or custom-request ID. `status` is the actual update such as `processing`, `delivered`, `return accepted`, `return shipment submitted`, `in progress` or `refund initiated externally`. `tracking` combines the saved courier, tracking number and URL, using `Not provided` for missing fields, up to 500 characters. `code` is ephemeral and never logged. Admin messages contain only references/event descriptions.

Example single-line environment override, enabling only approved test and signup templates:

```dotenv
WHATSAPP_TEMPLATES={"test":{"name":"rk_test","language":"en_US","enabled":true,"approved":true},"signup_otp":{"name":"rk_signup_otp","language":"en_US","enabled":true,"approved":true}}
```

Add other approved events explicitly. Categories and parameter order remain fixed. No marketing sender/campaign is implemented.

## Workflow and consent coverage

- Signup has separate initially unchecked options for one requested WhatsApp OTP and ongoing transactional messages, using the persisted challenge phone. Neither enables marketing. Transactional consent is persisted after successful signup verification; checkout separately records order-specific consent.
- Login/recovery use the account's stored phone only after the operation explicitly requests WhatsApp OTP delivery. A prior transactional preference does not itself request an OTP. Hashing, ten-minute expiry, five-attempt limit, atomic one-time consumption and independent email delivery are enforced.
- The existing profile WhatsApp preference governs transactional messages. Explicit saves record source/time/policy version; a legacy true boolean without explicit consent metadata is insufficient; obtain fresh consent. Workers recheck consent, activity and phone immediately before dispatch. Incoming messages do not grant opt-in.
- Order/payment confirmation uses the centralized confirmation service, independent of email resend claims. Payment failures use recorded failure paths and the payment-attempt key. Cancellation is not labeled payment failure. Razorpay verification/capture/inventory logic is unchanged.
- Processing, packed, shipping, tracking edits, out-for-delivery, delivery, cancellation, return requested/received and refund completed use existing fulfillment notification entry points and honor `sendCustomerNotification=false`.
- Return acceptance and submitted return shipments have separate events. Relevant order/return/custom events notify opted-in active admins at their own stored numbers.
- Custom creation uses WhatsApp only for an authenticated account matching the request email. Anonymous supplied email/phone does not authorize sending to an existing account. Existing custom-request emails remain independent.
- Custom status/refund initiation had no original lifecycle endpoints. The admin page adds confirmed manual actions via `POST /api/admin/integrations/whatsapp/lifecycle-update`. Custom statuses: `in_review`, `quoted`, `confirmed`, `in_progress`, `completed`, `cancelled`. Refund initiation requires a paid order and records an operator assertion that a refund was initiated externally; it does not issue a refund, call Razorpay or change payment status. Processed-refund notifications now require a verified Razorpay refund.processed result; a manual refunded status alone cannot drive that notification. These actions independently use centralized Zoho and queue WhatsApp; duplicate event/status claims suppress repeats. Reconcile failed/uncertain outcomes before resending.
- Numbers require explicit international prefixes (`+` or `00`) and `phonenumbers` validation. National-only numbers are skipped, never assumed Indian. A valid number does not prove WhatsApp availability; provider delivery determines the outcome.
- Internal-only text sending requires explicit consent and a customer message within 24 hours. All business notifications use approved template mappings. No automatic inbound reply or execution exists.

## Worker, indexes and operations

Install backend requirements. During separately authorized activation, run the existing explicit `flask --app wsgi:app database-maintenance` in the verified target environment to create indexes; its exact database confirmation applies. Do not run maintenance against an unverified database for local tests.

Schedule `flask --app wsgi:app whatsapp-worker` with the same backend environment every ten seconds using the process supervisor/timer. Each invocation drains up to 50 jobs and exits. Atomic claims allow multiple workers, but a single supervised worker is normally enough. OTP delivery requires a fast cadence, not a one-minute cron. The timer must execute in the backend container/environment. This change does not install or activate a worker schedule.

Monitor pending age, worker failures, `processing` claims after interruption and `unknown` outcomes. Do not automatically reset claims or invent fresh keys. Correlate delivery events with opaque correlation/Meta IDs before considering another send. An operator must explicitly accept duplicate risk if Meta acceptance cannot be determined. Expired jobs may be removed by TTL without sending; this favors stale-code protection over guaranteed delivery.

## Isolated testing and production activation

Tests use in-memory Mongo and mocked Meta/SMTP. Install `backend/requirements-dev.txt`; run `python -m pytest -q` from `backend`, and TypeScript/Node tests/build from `frontend`. No test requires production credentials or a database. Browser acceptance uses mocked authenticated API data.

Frontend commands: `npm test`, `npm run typecheck`, `npm run build`, then `npm run test:whatsapp-ui`. Install Playwright Chromium with `npx playwright install chromium`, or select an already installed Chrome through `PLAYWRIGHT_CHANNEL=chrome`. The Playwright config starts the compiled frontend on `127.0.0.1:3210` and mocks every API/external request. Screenshots and traces remain in ignored `test-results/`.

For a separately authorized sandbox send, isolate the development database/environment, use Meta's test sending number, verify a consenting recipient in Meta's test-recipient list, configure credentials/templates/key and deliberately enable only the local test gate. Keep automated messaging off. Run the read-only connection check first. Both test forms require explicit recipient consent and share three attempts/minute, ten/hour. Verify the Meta ID and signed sent/delivered/read events; API acceptance alone is insufficient.

Production requires account verification, permissions/review, approved templates, appropriate number/account setup and billing. Separately authorize deployment, securely merge environment entries into existing root `.env`, recreate the backend to read them, run approved target maintenance and install the worker timer. Keep `WHATSAPP_ENABLED=false` until callback/signature/subscriptions and isolated test evidence are reviewed. Any future activation requires separately authorized changes to the explicit production code/configuration guards and the admin switch. None of these production operations were performed here.

## Troubleshooting

- Verify/save fails: local changes are undeployed, HTTPS/path inaccessible or verify token differs. Do not use access token/App Secret as verify token.
- Verified but no events: check app publication warning, WABA subscription, selected `messages` field, IDs and phone scope. Connection success is not webhook delivery proof.
- POST 403: wrong App Secret, missing signature or changed raw body. Never bypass validation.
- `invalid_credentials` / Meta 190: inspect token expiry, app, assigned assets and permissions without logging credentials.
- `rate_limited`: bounded retry budget exhausted or Retry-After too long. Use shared production limiter storage; reconcile before authorizing another attempt.
- `unknown`, stuck `sending`/`processing`: ambiguous provider/worker outcome. Correlate Meta ID/opaque callback data; do not blindly resend.
- No send/log: check both gates, config, approval flags, consent, international number, worker and queue expiry. Skipped jobs do not create outbound logs.
- Template rejection: confirm WABA/name/language/category/current approval and body/button parameter order. Local approval flags are not proof of Meta approval.
- Queue not draining: check timer, database/environment, Fernet key and expiry. A rotated key cannot decrypt old jobs; do not dump plaintext for diagnosis.
- Recipient unavailable on WhatsApp: preserve independent email; phone validation/API acceptance is not delivery proof.


## Current local and production flags

The local `test` mapping uses the existing `3p_direct_integration_test_template` (`en_US`, `UTILITY`). Its exact static contract is defined in `LOCAL_TEST_TEMPLATE` in `app/whatsapp_templates.py`: text header `Integration Test`, the verified onboarding body, footer `WhatsApp Business Platform`, and no variables, media, or buttons. Static components are rendered by Meta from the template name/language; the send request has zero parameter overrides and does not send a custom validity period. The ignored `backend/.env.local` contains the mapping without an operator approval flag. The local status refresh must observe Meta `APPROVED`, matching category and exact components before the test becomes eligible; backend `approved:true` alone cannot enable this mapping. It is restricted to development and the `test` event. `rk_test` has no enabled local mapping. Existing unrelated mappings are preserved when merging this entry.

Local backend uses `backend/.env` and ignored `backend/.env.local`, with process environment taking precedence. Keep:

```dotenv
FLASK_ENV=development
WHATSAPP_ENVIRONMENT=development
WHATSAPP_TEST_SEND_ENABLED=true
WHATSAPP_ENABLED=false
WHATSAPP_DEVELOPMENT_CALLBACK_URL=https://<current-temporary-host>.trycloudflare.com/api/webhooks/whatsapp
```

The temporary URL must actually exist; it is not fabricated or auto-created by the application. Run from the repository root: `python -m flask --app backend.app run --host 127.0.0.1 --port 5000`. In another terminal: `cloudflared tunnel --url http://127.0.0.1:5000`. Update the local callback and Meta after each new temporary hostname, then restart the backend. Do not expose secrets in terminal output or webhook query logs.

Production must retain `FLASK_ENV=production`, `WHATSAPP_ENVIRONMENT=production`, `WHATSAPP_TEST_SEND_ENABLED=false`, `WHATSAPP_ENABLED=false`; clear/omit the development callback. `ProductionConfig` enforces the send flags off in code. Automated activation therefore requires a separate authorized config/code change as well as the existing admin switch; no activation is part of this implementation.

Both environments require backend-only `WHATSAPP_API_VERSION`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_OUTBOX_KEY` and carefully merged `WHATSAPP_TEMPLATES`. No values belong in `NEXT_PUBLIC_*`. Preserve existing Mongo/JWT/Zoho/Razorpay configuration. Confirm existing `RAZORPAY_WEBHOOK_SECRET` and subscribe to `refund.processed` for real refund results. Shared production `RATELIMIT_STORAGE_URI`, indexes and the explicit worker timer remain operational prerequisites, not changes performed here.

The template-status admin action is a read-only Graph operation (`POST /api/admin/integrations/whatsapp/template-status` locally to avoid response caching). It cannot submit, approve, enable, subscribe, publish or send a template. The actual provider state is displayed separately from operator confirmation.
