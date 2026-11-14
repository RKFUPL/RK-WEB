# WhatsApp pre-production audit — 2026-11-14

Repository: `C:\Users\athul\Desktop\RK-WEB-recovery`. Branch: `main`. Base commit: `4e8cbbb`.

## Readiness decision

**HOLD deployment, including a deployment with messaging disabled, until the Docker build-context credential exclusion is corrected and verified. Live messaging is not approved.** Webhook status crash recovery and the legacy Utility approval path also need correction before enabling messaging. Production routing, subscriptions, indexes, secrets, scheduling and image-level checks remain deployment dependencies.

This audit changed only this report. It did not change application code, environment files, production configuration, Meta assets/subscriptions/templates, gates or databases. Meta calls were GET reads. Public probes used a token-free GET and an unsigned empty POST, both rejected with 404. No test message, email, worker batch, index creation, commit, push or deployment ran.

## Findings requiring action

| Priority | Finding and evidence | Required resolution |
| --- | --- | --- |
| Release blocker | Root `.dockerignore` contains `.env` and `.env.*` but lacks recursive environment exclusions. `Dockerfile.backend` copies the entire `backend/` directory. The actual ignored `backend/.env` and `backend/.env.local` can enter the context and image despite Git ignoring them. Frontend test artifacts and backend private instance data also lack context exclusions. | Add recursive exclusions such as `**/.env`, `**/.env.*`, `**/instance/private/**`, `**/test-results/**`, `**/playwright-report/**`, and appropriate dump/key/archive exclusions. Keep only explicitly sanitized example files where needed. Verify the resulting context and image contain no credentials, local env files, private uploads or traces before building release images. Do not build the current local context into a release image. |
| High | `_record_status` in `backend/app/whatsapp_routes.py:189` writes history/timestamps, then marks the event matched, then updates current status. A crash between these writes makes the replay return early at the history deduplication check. An in-memory injected crash followed by replay left `status=accepted`, `readAt` present, and one read history entry. | Make the status projection atomic with history, or make duplicate replay resume any incomplete projection. Add a regression that interrupts after history persistence and replays the callback. |
| High, before activation | `registry()` in `backend/app/whatsapp_templates.py:185` exempts legacy optional Utility mappings from `requiresMetaApproval`. With an enabled/operator-approved `processing` entry and no observations, `template_registry()` returned `approved=True`, `approvalSource=backend_confirmation`, `components=[]`. Current production gates prevent sends, and the strict one-off test endpoint rejects this path. | Require fresh WABA-bound Meta evidence and exact components for every sendable Utility mapping, including optional lifecycle/admin paths. Keep unsupported mappings disabled. Operator flags must never establish approval. |
| Deployment dependency | The public production callback currently returns Flask-style **404 for both GET and POST**. The public health endpoint returns 200 from `rashi-kapoor-api`. Source forwards `/api/:path*` through Next.js to Flask, but no active VPS Nginx configuration is available in this checkout. | Deploy reviewed routes only after the blockers are resolved, then verify direct Flask routing, raw body and signature-header preservation. Use the proposed exact Nginx location below if direct routing is required. A current 404 is not a working callback. |
| Meta dependency | A fresh `/{WABA_ID}/subscribed_apps` GET returned HTTP 200 with **zero subscriptions**. | Independently verify the configured app/WABA relationship and arrange the required app subscription only under separate authorization. App webhook field selection, publication/live status, permissions and business/billing requirements were not verified through the dashboard. |
| Database dependency | Read-only inspection of guarded local `RK_WEB_TEST_N2` found only built-in `_id` indexes on existing WhatsApp collections; required secondary/TTL indexes were absent. Several queue/consent collections do not yet exist. Production indexes were not inspected. | Apply and verify WhatsApp indexes on the explicitly identified production database before exposing real webhook traffic. Do not assume local or production maintenance has run. |
| Operations dependency | No WhatsApp scheduler exists in Compose or CI. Meta evidence expires after 24 hours, and no automatic template-inventory refresh job exists. | Use the proposed scheduler after approval, plus an operator refresh process or a separately reviewed read-only inventory refresh command. Monitor freshness, backlog and held claims. |
| Operations dependency | Two Gunicorn workers are configured; the default `RATELIMIT_STORAGE_URI` is `memory://`. The key function uses the observed remote address without a configured trusted proxy adapter. | Set a verified shared limiter store. The existing dependency includes MongoDB limiter support; Redis would require its driver if chosen. Verify trusted proxy/client identity rather than accepting arbitrary forwarded headers. |
| Existing test failure | Frontend Node suite: 153 passed, 1 failed. `frontend/lib/homepage-editorial-refinement.test.mjs:21` expects contiguous `Where the art of`; `shop-categories.tsx` includes a `<br />`. Both files match HEAD and are outside the dirty changes. | Resolve or explicitly accept this existing release-test failure in its own scope. This audit preserved both files. |
| Documentation | Older implementation/setup documents contain historical test counts, old variable orders, zero-mapping claims and earlier unverified-status statements. | Use this report for current audit evidence. Reconcile older deployment instructions before treating them as current production runbooks. JSON submission drafts and historical provider snapshots do not grant approval. |

Docker's documented matching rules explain why root patterns do not cover arbitrary subdirectories; use recursive `**` rules. See [Docker build-context documentation](https://docs.docker.com/build/concepts/context/) and the [Moby matcher implementation](https://github.com/moby/patternmatcher/blob/main/patternmatcher.go).

## Worktree and commit-content review

At audit start there were **23 modified tracked files and 24 untracked files: 47 candidates**. All were inventoried, scanned in full for secrets, and reviewed through their diffs/content, component definitions, route/function structure and tests. No distinct unrelated dirty file was found. The cumulative change is broader than the transport: it also changes existing OTP consumption/session handling, checkout/profile consent, refund persistence/customer display, shipment editing and authenticated custom-order association. Those shared changes need release review as listed below; they must not be silently discarded or excluded while retaining their dependents.

Adjacent behavior requiring particular review:

- `backend/app/blueprints/auth/routes.py` changes existing email OTP consumption, delivery responses and verification flags, and fixes an existing OTP-login session user-ID reference.
- `backend/app/blueprints/payments/routes.py` persists signed refund results and consent; `frontend/components/orders/customer-order-detail.tsx` exposes recorded refunds. These support refund notifications/CTA content and alter payment/order surfaces.
- `backend/app/order_fulfillment.py` and Admin Orders add dispatch timestamps and merge persisted shipment fields during edits.
- Product-detail requests now include authentication so anonymous email input cannot authorize messages to a stored customer account.
- No homepage/careers source change is in this worktree despite the existing Node test failure.

Secret review found **no matching actual local secret values, Meta-token patterns, credential-bearing Mongo URIs, private-key blocks or AWS access-key patterns in the 47 candidates**. Environment/key/dump/archive paths are not in the tracked or candidate lists. The actual backend environment files and browser artifacts are Git-ignored. Test credentials are synthetic fixtures. The sanitized tracked `backend/.env.example` contains empty credential fields/placeholders.

This is evidence about current candidate content, not a guarantee about a future staging operation. No staging occurred. Recheck the exact staged diff before any eventual commit; avoid blanket or force-add commands. Git safety does not imply Docker context safety.

### Exact content-safe allowlist for a review commit

The following 48 paths include the 47 existing candidates plus this new report. They are suitable for a **non-deploying review branch** from a credential-content perspective. The blockers above still prevent a deployment-ready release. Nothing was committed. `main` auto-deploys on push through `.github/workflows/deploy.yml`, so this is not authorization to push it.

```text
.gitignore
backend/.env.example
backend/app/__init__.py
backend/app/blueprints/auth/routes.py
backend/app/blueprints/catalog/routes.py
backend/app/blueprints/orders/routes.py
backend/app/blueprints/payments/routes.py
backend/app/config.py
backend/app/order_confirmation.py
backend/app/order_fulfillment.py
backend/app/returns.py
backend/requirements.txt
backend/tests/test_signup_flow.py
frontend/app/account/page.tsx
frontend/app/account/profile/page.tsx
frontend/components/checkout/checkout-page.tsx
frontend/components/dashboard-shell.tsx
frontend/components/orders/admin-order-detail.tsx
frontend/components/orders/customer-order-detail.tsx
frontend/components/products/product-detail-page.tsx
frontend/lib/orders.ts
frontend/package-lock.json
frontend/package.json
backend/app/whatsapp.py
backend/app/whatsapp_campaigns.py
backend/app/whatsapp_catalogue.py
backend/app/whatsapp_consent.py
backend/app/whatsapp_definitions.py
backend/app/whatsapp_events.py
backend/app/whatsapp_marketing_consent.py
backend/app/whatsapp_orders.py
backend/app/whatsapp_routes.py
backend/app/whatsapp_templates.py
backend/requirements-dev.txt
backend/tests/test_whatsapp.py
docs/WHATSAPP_IMPLEMENTATION_REPORT.md
docs/WHATSAPP_ORDER_LIFECYCLE.md
docs/WHATSAPP_OTP_MARKETING_BUTTONS.md
docs/WHATSAPP_SETUP.md
docs/WHATSAPP_TEMPLATE_DEFINITIONS.json
docs/WHATSAPP_TEMPLATE_SUBMISSIONS.md
frontend/app/admin/integrations/whatsapp/page.tsx
frontend/components/admin/whatsapp-campaigns.tsx
frontend/components/admin/whatsapp-test-message.tsx
frontend/lib/whatsapp-consent.ts
frontend/playwright.config.ts
frontend/tests/whatsapp-ui.spec.ts
docs/WHATSAPP_PREPRODUCTION_AUDIT.md
```

### Files that must not be committed or copied into a release image

- Actual `backend/.env`, `backend/.env.local`, root `.env`, `.env.local`, and actual environment files under frontend/careers or any nested directory. Only the explicitly sanitized, tracked example is allowlisted.
- Mongo/database exports, `.bson`, `.dump`, `.sql`, archives containing exports/configuration, private keys, certificates with private keys, credential JSON, provider tokens and shell/session histories.
- `backend/instance/private/` and any customer/private uploads.
- `frontend/test-results/`, `frontend/playwright-report/`, Playwright traces/screenshots, logs, raw provider responses and query logs containing webhook verification tokens.
- `frontend/.next/`, `frontend/node_modules/`, `frontend/tsconfig.tsbuildinfo`, equivalent careers artifacts, Python `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.venv/`, `venv/` and local tool caches.
- Unreviewed files outside the exact allowlist. The unchanged Docker/CI/proxy files are audit dependencies, not automatically part of this WhatsApp commit.

## Backend route and security review

`backend/app/__init__.py` registers the webhook blueprint at `/api/webhooks` and the admin blueprint at `/api/admin/integrations/whatsapp`.

| Method and route | Authorization and behavior |
| --- | --- |
| GET `/api/webhooks/whatsapp` | Reads backend `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; requires subscribe mode and a nonempty challenge of at most 512 characters; constant-time comparison. Valid requests return the exact challenge as text/plain and record verification time. Invalid requests return 403. No token is hardcoded or returned. |
| POST `/api/webhooks/whatsapp` | Reads at most 1 MiB of the exact raw body; verifies `X-Hub-Signature-256` using HMAC-SHA256 and backend App Secret before JSON parsing or persistence. Missing/bad signatures return 403; malformed signed payloads return 400; oversized bodies return 413. Database failure produces non-2xx for retry. |
| GET / PATCH `/api/admin/integrations/whatsapp` | Active authenticated admin. Reads safe state; PATCH only changes the database integration switch and cannot bypass the environment gate. |
| POST `/test-connection` | Admin and rate limited; read-only Meta phone/WABA-subscription check. |
| POST `/template-status` | Admin and rate limited; paginates a complete Meta inventory. Failed reads retain prior evidence and mark it stale. No template writes or approval changes in Meta. |
| POST `/test-send` | Admin; development plus explicit test flag; consent confirmation; canonical E.164 recipient; exact name/language; Utility-only; fresh WABA-bound approval and verified components. Mapping enablement is independent. Direct shared transport, no lifecycle transition/outbox job. |
| POST `/test-window` | Admin and rate limited; derives the window from latest verified inbound metadata scoped to WABA/Phone Number ID. |
| POST `/test-message` | Admin; shared test rate limit; explicit consent; validated message and recipient; server window checks before sending and retries. |
| GET `/messages` | Admin; safe projection with masked recipient, Meta ID, HTTP status, test flag, milestones/history and allowlisted failures. |
| GET `/campaigns/options`, GET `/campaigns` | Admin; safe options/state. Exclusive offers remain unavailable. |
| POST `/campaigns/preview`, `/campaigns/drafts`, `/campaigns/authorize` | Admin and rate limited. Preview/draft do not send. Authorization requires current preview/consent audience, approved enabled marketing template, normal automation gate and separate marketing gate. |
| POST `/lifecycle-update` | Admin, rate limit and explicit confirmation. This is a real business-data action, not a test endpoint: it can save a custom-request status/refund-initiation assertion and send Zoho email even when WhatsApp is disabled. Do not use it as a deployment smoke test. |

The suffix routes in the table use the admin prefix. Both public webhook methods are intentionally available while outbound messaging is disabled. WABA and Phone Number ID checks scope signed message/status events. The required Meta `messages` field contains incoming `messages[]` and outgoing `statuses[]`; app-level field selection was not verified live.

### Public routing evidence and proposed direct Flask location

During this audit, `https://rashikapoor.co.in/api/health` returned 200 with the Flask API service identity. Token-free GET and unsigned empty POST to `/api/webhooks/whatsapp` both returned Werkzeug/Flask-style 404 HTML rather than a Next.js page. This supports forwarding to the backend, but the new route is not deployed. It does not prove which live Nginx location handled the requests.

Source currently uses Next.js `/api/:path*` rewrites to `BACKEND_INTERNAL_URL`; Compose sets that to the Flask service on port 5000. Thus an API request can transit Next.js before reaching Flask. No active Nginx/Cloudflare rule was changed or inspected through server access. Direct routing can be configured during a separately authorized deployment using an exact location, preserving the original URI and raw body:

```nginx
location = /api/webhooks/whatsapp {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Hub-Signature-256 $http_x_hub_signature_256;
    proxy_pass_request_body on;
    client_max_body_size 1m;
    proxy_cache off;
    access_log off;
}
```

This is a proposal only. Adapt it to the actual active server block and test `nginx -t` before any approved reload. `proxy_pass` intentionally has no URI suffix, preserving `/api/webhooks/whatsapp`. Query strings contain the verification token; keep them out of proxy/app/CDN logs or use a redacted log format. No browser login, cache or challenge page should intercept this exact route. See [Nginx proxy documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass).

## Fresh Meta inventory and provider dependencies

A successful complete **GET-only inventory read on 2026-11-14** returned **1 page and 19 templates**, using the currently configured Graph version `v26.0`. This audit did not refresh the database cache or mutate Meta. Every returned quality score was `UNKNOWN`; quality remains separate from approval.

| Exact Meta name | Language | Category | Fresh status | Local contract / use |
| --- | --- | --- | --- | --- |
| `rk_order_confirmation` | en_US | UTILITY | APPROVED | Exact components match; automated mapping disabled. |
| `rk_payment_confirmation` | en_US | UTILITY | APPROVED | Exact components match; automated mapping disabled. |
| `rk_order_shipped` | en_US | UTILITY | APPROVED | Exact components match; automated mapping disabled. |
| `rk_out_for_delivery` | en_US | UTILITY | APPROVED | Exact components match; automated mapping disabled. |
| `rk_order_delivered` | en_US | UTILITY | APPROVED | Exact components match; automated mapping disabled. |
| `rk_order_cancelled` | en_US | UTILITY | APPROVED | Exact components match; automated mapping disabled. |
| `rk_refund_processed` | en_US | UTILITY | APPROVED | Exact components match; automated mapping disabled. |
| `3p_direct_integration_test_template` | en_US | UTILITY | APPROVED | Exact zero-variable components match. Existing local test mapping is enabled; it is development-only and not an order mapping. Production test sends are disabled. |
| `rk_payment_failure` | en_US | UTILITY | PENDING | Optional legacy runtime contract does not match; disabled. |
| `rk_processing` | en_US | UTILITY | PENDING | Optional legacy runtime contract does not match; disabled. |
| `rk_packed` | en_US | UTILITY | PENDING | Optional legacy runtime contract does not match; disabled. |
| `rk_tracking_update` | en_US | UTILITY | PENDING | Optional legacy runtime contract does not match; disabled. |
| `rk_return_requested` | en_US | UTILITY | PENDING | Optional legacy runtime contract does not match; disabled. |
| `rk_return_status` | en_US | UTILITY | PENDING | Optional legacy runtime contract does not match; disabled. |
| `rk_refund_initiated` | en_US | UTILITY | PENDING | Optional legacy runtime contract does not match; disabled. |
| `rk_custom_order_received` | en_US | UTILITY | PENDING | Optional legacy runtime contract does not match; disabled. |
| `rk_custom_order_status` | en_US | UTILITY | PENDING | Optional legacy runtime contract does not match; disabled. |
| `rk_new_collection_drop` | en_US | MARKETING | PENDING | Provider components differ from the local definition; disabled. |
| `rk_test` | en | MARKETING | APPROVED | Unmapped. This is not the Utility integration-test template; remains unavailable to Utility tests. Earlier PENDING evidence is outdated. |

Absent from the complete inventory: `rk_authentication_otp` (creation previously denied; no current Meta template), `rk_exclusive_offer` (local draft blocked by missing checkout coupon engine), and `rk_admin_notification` (internal-only draft, outside the customer submission catalogue). Seven `_v2` button definitions are also absent and must remain unavailable; do not alter the existing seven approved submissions to add buttons.

The configured Phone Number ID belongs to the configured WABA. Its returned verified name is **Rashi Kapoor Mumbai**, rather than a sample/test name, and its quality is GREEN. Meta also returned `code_verification_status=NOT_VERIFIED`; verify what remains necessary for this actual number/account in Manager before activation. This field alone does not establish registration, billing or send capability. No delivery smoke test was performed.

`subscribed_apps` returned an empty data list in two read checks. The configured app therefore was not listed as subscribed through that API. Confirm the exact app/token/WABA assets, required `whatsapp_business_management` / `whatsapp_business_messaging` access, app publication status, `messages` field subscription, billing and number registration through separately authorized operations. A valid template read is not proof of all these conditions.

## Gates, consent, delivery and recovery

- `ProductionConfig` forces environment=production, test-send=false, automated=false and marketing=false, overriding those send flags even if their environment values are true. Docker sets `FLASK_ENV=production`; verify the production environment does not replace it with a development marker. Future live activation would require a separately reviewed code/config change, not merely checking an admin box.
- Development test sends require both the development environment and the explicit test flag. The current ignored local flags allow testing while normal and marketing automation remain off. No flag was changed by this audit.
- Automated sending additionally requires `WHATSAPP_ENABLED`, the database integration switch, the mapping switch, business-event proof, exact customer/phone consent and an approved template. Marketing adds its independent flag, policy-specific consent, audience binding and campaign authorization.
- The seven order mappings, Authentication and Marketing paths require exact fresh provider evidence. The optional legacy Utility fallback is the exception identified above and must be closed before activation.
- Free text uses only verified, scoped incoming timestamps. The 24-hour window is enforced on the backend and checked again before HTTP attempts. Approved Utility templates can start a conversation outside that window.
- Transactional and marketing grants are separate. Phone changes invalidate profile consent. Signed STOP commands create durable phone-level suppression; marketing-only withdrawal preserves transactional consent. Consent and STOP persistence have sequential tests; real Mongo concurrency/fault behavior has not been validated by those in-memory tests.
- Mongo `_id` reservations deduplicate sends, jobs, business-event claims and inbound metadata. One-off admin submissions use stable user/request/phone correlation keys and share rate limits. API acceptance is recorded separately from delivery/read. No message bodies, OTPs or raw Meta error text are retained in delivery logs.
- Status handling matches exact wamid, checks recipient hashes where available, persists sent/delivered/read/failed milestones and history, handles ordinary duplicates/out-of-order callbacks monotonically, and treats read as delivery proof without inventing an exact delivery timestamp. The crash/replay exception above remains unresolved.
- Definitive Meta rate-limit rejections can retry three HTTP attempts per dispatch and up to two delayed durable dispatches, respecting expiry/Retry-After. Timeouts, 5xx and malformed success outcomes remain unknown/held, with no blind replay. Interrupted `processing` claims are intentionally not auto-reclaimed. Monitor and reconcile them before any retry.
- Jobs pin template identity/components, consent and business proof; the worker rechecks them before dispatch/retry. Normal queue lifetime is 24 hours; OTP jobs expire with the existing ten-minute challenge. Completed payloads are removed. Unknown/held claims and logs must be reconciled before queue TTL removal obscures operational context.
- App Secret is also the phone-fingerprint key. Rotating it changes suppression, correlation and consent bindings. Preserve it or perform an explicit hash migration; ordinary App Secret rotation is not transparent. Preserve the Fernet outbox key until all jobs encrypted with it are resolved. Do not delete permanent send/order deduplication records during rollback or log retention.

## Persistence, indexes and production inputs

Local guarded database inspection used `RK_WEB_TEST_N2` only and made no writes. It is a Mongo replica set; write concern was not explicitly overridden by the application. Real production backup/restore, write-concern policy, index deployment and failure recovery were not tested. The public health endpoint reports production database identity `RKFUPL`; this is evidence of a health response, not permission to access or modify it. Independently verify the deployment's intended database and URI path.

`ensure_indexes()` defines ten secondary indexes: messages provider-ID lookup and created/status lookup; inbox recipient/time and 30-day TTL; event 30-day TTL; outbox status/time and expiry TTL; consent customer/time; order-event order/update; campaign status/schedule. `_id` uniqueness exists implicitly on Mongo collections. The provider-ID index is sparse but not unique. No production secondary index is claimed installed.

The existing `database-maintenance` command creates WhatsApp indexes **and also seeds/migrates catalog/order data**. Do not run that broad command merely to add WhatsApp indexes. Prefer a reviewed WhatsApp-only maintenance command/script which validates the exact database and URI path before calling `ensure_indexes`, and verify definitions with `listIndexes` afterwards. No maintenance ran in this audit.

Production variable **names only** are listed below. Server-side presence/validity remains unverified; local presence does not prove production presence. Secrets should be supplied at runtime through the approved backend environment, never copied into images or the frontend.

```text
FLASK_ENV
WHATSAPP_ENVIRONMENT
WHATSAPP_TEST_SEND_ENABLED
WHATSAPP_ENABLED
WHATSAPP_MARKETING_ENABLED
WHATSAPP_API_VERSION
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_BUSINESS_ACCOUNT_ID
WHATSAPP_APP_ID
WHATSAPP_ACCESS_TOKEN
WHATSAPP_APP_SECRET
WHATSAPP_WEBHOOK_VERIFY_TOKEN
WHATSAPP_OUTBOX_KEY
WHATSAPP_CANONICAL_URL
WHATSAPP_TEMPLATES
RATELIMIT_STORAGE_URI
DB_NAME
MONGO_DB
MONGO_URI
SECRET_KEY
JWT_SECRET_KEY
BACKEND_INTERNAL_URL
```

`MONGO_DB` currently takes precedence over the compatibility `MONGO_URI`; resolve one authoritative URI and ensure its database path agrees with `DB_NAME`. Keep application/WhatsApp environment markers in production and all three sending flags off. Omit/clear `WHATSAPP_DEVELOPMENT_CALLBACK_URL` in production; production callback selection ignores it. Preserve the existing Zoho, session and Razorpay configuration. Actual refund notifications additionally depend on the existing `RAZORPAY_WEBHOOK_SECRET` and a signed `refund.processed` subscription. Shared limiter credentials belong only in the runtime store URI. No production values were read from the server or changed.

## Worker and proposed production scheduler

The registered command, executed from `backend/` or inside the backend container, is:

```sh
python -m flask --app wsgi:app whatsapp-worker
```

For the existing Compose layout:

```sh
cd /opt/apps/rashi-kapoor/rk-web
docker compose exec -T backend python -m flask --app wsgi:app whatsapp-worker
```

It processes at most 50 jobs per batch. With current production flags it returns without dispatching. It is **not** a daemon, not an inventory refresh, and not a repair/replay command. No worker was invoked during this audit.

Proposed host systemd service `/etc/systemd/system/rk-whatsapp-worker.service`:

```ini
[Unit]
Description=RK WhatsApp bounded queue worker
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
WorkingDirectory=/opt/apps/rashi-kapoor/rk-web
ExecStart=/usr/bin/flock -E 75 -n /run/lock/rk-whatsapp-worker.lock /usr/bin/docker compose exec -T backend python -m flask --app wsgi:app whatsapp-worker
SuccessExitStatus=75
TimeoutStartSec=1h
StandardOutput=journal
StandardError=journal
```

Proposed `/etc/systemd/system/rk-whatsapp-worker.timer`:

```ini
[Unit]
Description=Schedule RK WhatsApp bounded queue batches

[Timer]
OnBootSec=2min
OnUnitInactiveSec=30s
AccuracySec=1s
Unit=rk-whatsapp-worker.service

[Install]
WantedBy=timers.target
```

These are proposals, not installed/enabled configuration. Verify Docker/flock paths, Compose project identity, host/service permissions, and container environment on the actual VPS. Docker control is privileged; use the server's approved execution identity. The inactive interval prevents normal overlap; flock guards manual duplicate launches. Configure journal retention and an approved failed-unit alert. The one-hour timeout accommodates a bounded batch with provider timeouts/backoff; alert on overruns and verify no worker remains before restarting. A forced stop can leave held/processing claims that require reconciliation. The scheduler cannot provide exactly-once provider delivery or automatic crash recovery.

Do not install or enable this timer until separately authorized. When eventually installed for a disabled rollout, validate all off gates first. Before future activation, provide a reviewed inventory-refresh process at an interval comfortably below the 24-hour evidence limit; none exists in this repository. Validate throughput/OTP delay under backlog before enabling OTP delivery.

## Validation results and limits

| Check | This audit's result |
| --- | --- |
| Full backend `python -m pytest -q` from backend | **407 passed**, including 137 WhatsApp cases. |
| Frontend `npm test` | **153 passed, 1 existing failure** out of 154. Failure identified above; test/component match HEAD. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed; 62 static pages generated, including the WhatsApp admin route. |
| `npm run test:whatsapp-ui` | **35 passed** against the production frontend build, backend/Meta calls mocked. |
| `git diff --check` | Passed. Untracked candidate whitespace/secret/structure checks also performed. |
| Fresh Meta GET inventory | Complete: 1 page, 19 templates; exact statuses/contracts documented above. |
| Meta app subscription / sender ownership GETs | Empty subscription list; brand number belongs to WABA, quality GREEN, code verification NOT_VERIFIED. |
| Public HTTP | Health 200; webhook GET/unsigned POST 404. |
| In-memory fault probes | Confirmed status projection crash/replay gap and legacy local-approval fallback. No real message/database writes. |
| Docker image / Linux Gunicorn / Nginx/systemd tests | **Not run**: Docker/Go executables unavailable in this Windows environment; active VPS configuration not accessible. Release image verification is outstanding. |

Passing mocked tests does not validate production Mongo indexes, process concurrency, external delivery, WABA publication/subscriptions, container contents, runtime secrets, host scheduling, actual reverse-proxy configuration or rollback restoration.

## Deployment plan — future separately authorized work

1. Preserve the current dirty checkout. Prepare a non-deploying review branch and review the exact allowlist plus the shared auth/payment/order changes. Do not push `main`: its existing workflow immediately fetches, resets and rebuilds the VPS checkout on any push.
2. Correct and regression-test the Docker context exclusions, status crash/replay projection and legacy approval fallback. Reconcile outdated operational docs and the existing Node test failure or obtain a scoped release exception. Re-run checks affected by those corrections.
3. Build immutable backend/frontend images from a clean reviewed context on Linux/CI. Inspect context/image contents for nested env files, private uploads and traces without printing their contents. Validate Gunicorn/Compose runtime and dependencies. Keep the prior image digests and active proxy configuration for rollback; do not rely on rebuilding an old commit with floating dependencies.
4. Have the authorized operator verify runtime production variable presence, intended production database/URI, durable secret storage and backups. Confirm production environment selection and all sending flags off; confirm the database integration switch/mappings are off. Keep the local test database, local credentials and temporary callback out of this deployment.
5. Create/verify only the intended WhatsApp indexes under an exact database guard. Preserve existing collections, orders, consent, suppression and permanent claims. Avoid the broad catalog-seeding maintenance command. Prove backup/restore separately without rolling the live database back.
6. Deploy the reviewed immutable images with all gates off. Verify backend health, admin authorization and the effective production config without logging credentials. Do not call lifecycle/update, campaign authorization, send or payment-mutation endpoints for smoke checks.
7. Verify the exact production callback reaches Flask and preserves body/signature headers. Check token-free GET and unsigned POST return 403 after the route is deployed, not 404/HTML/login. A valid challenge and a correctly signed synthetic dashboard webhook can be tested only in the separately authorized production-validation window; suppress verification-token query logging. Do not send customer messages.
8. Verify the exact app/WABA subscription, `messages` field, app live/publication requirements, number verification/registration, access/permissions and billing. Changing a callback/subscription or publishing an app requires separate authorization and is not part of this audit/deployment plan execution.
9. Read a fresh complete Meta inventory into the intended production cache through the authenticated read-only refresh endpoint; confirm name/language/category/components and disabled mappings. Keep pending, unknown, unsubmitted, internal and mismatched templates unavailable. The currently approved `rk_test` is Marketing/en and is not a Utility test mapping.
10. After separate approval, install the proposed scheduler initially as a disabled/no-op operation and observe it with production gates off. Establish alerts for failed runs, aged pending/processing jobs, unknown outcomes, Meta refresh failure/staleness, signature rejection and DB errors. Add the missing read-only inventory refresh mechanism before any future activation.
11. Stop at an operational, disabled deployment. Do not enable test sending in production, automated notifications, marketing, mappings or new Meta assets. Any live messaging rollout needs a separate decision after blockers, external dependencies, consent/audience review and provider validation are resolved.

## Rollback plan — future separately authorized work

1. Keep all production sending gates off. Stop the timer and active worker before rollback; if it ever timed out, verify there is no surviving container worker. Do not reset/requeue processing or unknown jobs.
2. Restore the recorded previous immutable images and compatible proxy configuration using a reviewed deployment procedure. Do not push `main` as a rollback shortcut because that workflow auto-deploys. Preserve the authoritative production environment and key material; never replace it with local `.env` files.
3. Preserve WhatsApp messages/order claims, consent audits, STOP/suppression data and provider IDs. Keep additive indexes/collections; no database drop, dump restore over live orders, or deduplication reset is needed for application rollback.
4. Retain the outbox key and App Secret needed to interpret existing payloads/hashes. Reconcile accepted/unknown/held/processing outcomes against known Meta IDs before any future retry. A rollback cannot unsend a message or reverse a customer consent withdrawal.
5. If the prior backend lacks the webhook route, determine the approved callback/retry holding strategy before reverting it. Do not acknowledge valid events with fake 200 responses or discard status history. Keep/restore a compatible verified receiver where required; any Meta callback change is separately authorized.
6. Verify health, login, checkout/order read paths, effective off gates and expected webhook responses using non-mutating checks. Leave the scheduler disabled until the rollback is validated and separately approved. Preserve diagnostic evidence with secrets and message bodies redacted.

