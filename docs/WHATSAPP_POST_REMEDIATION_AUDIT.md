# WhatsApp post-remediation audit - 2026-11-14

## Release verdict

**NO-GO for production deployment or live messaging at this point.** Local source remediation is complete and tested, but Linux image/proxy validation, production configuration/index checks and Meta subscription prerequisites remain outstanding. All real send gates are false. No commit, push, deployment, production change, Meta write, publication or real message occurred.

This is a second verification pass by the implementing agent, not an assertion of review by a separate human or agent. It re-read the resulting code, exercised crash/replay/concurrency counterexamples, evaluated the actual update expressions using real MongoDB without writing messages, refreshed provider evidence with GET requests, and repeated the final test suites. That pass found an additional ambiguous-response retry defect; it was corrected and regression-tested before the final full backend run.

Repository: `C:\Users\athul\Desktop\RK-WEB-recovery`; branch `main`; base `4e8cbbb`. The existing main-push workflow deploys automatically. Do not push main as a review step.

## Original findings and resolution

| Finding | Final evidence and status |
| --- | --- |
| Credential-bearing Docker context | Recursive exclusions and explicit backend COPY allowlist implemented. Modeled context and Git-content secret scans pass. Actual Linux image build/inspection remains required: Docker is unavailable locally. |
| Status crash/replay regression | One atomic Mongo update pipeline persists projection, timestamps and history. Duplicate replay repairs legacy partial projections. Concurrent/out-of-order/read-before-delivered regression tests pass. |
| Legacy local approval bypass | Removed. Every sendable mapping requires fresh exact WABA-bound name, language, category, status and component evidence. Local flags cannot approve templates. Unsupported legacy/button contracts fail closed. |
| Public callback 404 | Exact-match Flask Nginx snippet and isolated fixture implemented. Fresh public GET and unsigned empty POST still return 404; health returns 200. A local patch cannot change the live VPS under this authorization. |
| Empty WABA subscription | Fresh GET still returns HTTP 200 with an empty subscription list. Separate authorized Meta action required. App callback/messages field subscription remains unverified without the appropriate app token. |
| Missing secondary/TTL indexes | Guarded additive migration implemented and applied only to local `RK_WEB_TEST_N2`; required indexes now verify. Before/after record counts unchanged. Production database has not been inspected or modified. |
| Missing scheduler/inventory refresh | Worker and read-only Meta inventory refresh CLI plus four systemd service/timer files implemented. Not installed or enabled remotely. |
| Shared limiter/proxy identity | Explicit bounded proxy trust added, default zero. Production readiness rejects memory limiter and missing exact database target. Server shared store/ingress chain must be verified. |
| Existing homepage Node failure | Still pre-existing: 153 pass, 1 fail. Test and component both match HEAD; preserved. |
| Historical deployment notes | Five historical notes now point to the authoritative disabled-deployment runbook. Original audit and submission/component definitions preserved. |

## Exact remediation files

The following **31 files** differ from the start-of-task SHA-256 snapshot. This is the remediation delta, not a claim that the original integration's other dirty files can be discarded.

```text
.dockerignore
Dockerfile.backend
backend/.env.example
backend/app/__init__.py
backend/app/config.py
backend/app/extensions.py
backend/app/whatsapp.py
backend/app/whatsapp_ops.py
backend/app/whatsapp_provider.py
backend/app/whatsapp_routes.py
backend/app/whatsapp_storage.py
backend/app/whatsapp_templates.py
backend/tests/test_whatsapp.py
backend/tests/test_whatsapp_nginx.py
backend/tests/test_whatsapp_remediation.py
deploy/docker-compose.release.yml
deploy/nginx/whatsapp-local.conf
deploy/nginx/whatsapp-location.conf
deploy/systemd/rk-whatsapp-template-refresh.service
deploy/systemd/rk-whatsapp-template-refresh.timer
deploy/systemd/rk-whatsapp-worker.service
deploy/systemd/rk-whatsapp-worker.timer
deploy/whatsapp-images.env.example
docs/WHATSAPP_DEPLOYMENT.md
docs/WHATSAPP_IMPLEMENTATION_REPORT.md
docs/WHATSAPP_ORDER_LIFECYCLE.md
docs/WHATSAPP_OTP_MARKETING_BUTTONS.md
docs/WHATSAPP_SETUP.md
docs/WHATSAPP_TEMPLATE_SUBMISSIONS.md
docs/WHATSAPP_POST_REMEDIATION_AUDIT.md
scripts/audit_release_context.py
```

Additional ignored local configuration change: only the test-send gate in `backend/.env.local` was changed to false. It must not be committed or copied to the server. Local development capability remains implemented. The original 48-file review allowlist is in `WHATSAPP_PREPRODUCTION_AUDIT.md`; preserve its existing shared authentication, checkout, payments, shipment and consent work. All start-snapshot files outside the remediation list retain their hashes.

Never commit actual environment files, tokens/credentials, keys, private uploads, dumps, archives containing data/configuration, raw provider responses, browser traces, logs, generated builds, caches or dependencies. Sanitized example files above are exceptions, not authorization to add real configuration. Review the exact staged diff in a future authorized commit; no staging occurred here.

## Webhook, routing and authentication

- GET and POST remain `/api/webhooks/whatsapp`, registered on Flask. GET reads `WHATSAPP_WEBHOOK_VERIFY_TOKEN` from backend configuration, validates subscribe mode/token/challenge and returns the exact challenge; invalid verification returns 403.
- POST validates the size-bounded raw body with HMAC-SHA256 and `WHATSAPP_APP_SECRET` before parsing/persistence. Invalid signatures return 403, malformed signed input 400, oversized input 413. Persistence failure remains non-2xx so Meta may retry.
- Existing inbound handling, STOP withdrawal, WABA/phone scoping, event deduplication and app/admin authorization are retained. Backend tests exercise these behaviors with synthetic secrets and mocked Meta requests.
- `deploy/nginx/whatsapp-location.conf` routes only the exact callback directly to Flask at port 5000, preserves body/signature, disables access logging/caching and leaves website locations intact. It must be included inside the actual HTTPS server block after review. No live Nginx file was edited.
- Environment/callback selection uses server configuration only. Production callback stays `https://rashikapoor.co.in/api/webhooks/whatsapp`; development uses `WHATSAPP_DEVELOPMENT_CALLBACK_URL`. Host/browser input cannot choose it. ProxyFix trusts only explicitly configured client-address hops, never host/protocol/prefix.

Nginx is unavailable on this Windows machine. The real-proxy integration test is explicitly skipped; Flask tests alone do not prove the deployed routing chain. Live public 404 is still a blocker.

## Fresh Meta evidence and mappings

The GET-only diagnostic and guarded cache refresh read a complete inventory: **one page, 19 records**. Current configured API version v26.0 succeeded for these reads. Approval and quality are separate; quality UNKNOWN/pending does not turn APPROVED into PENDING.

| Records | Fresh result and runtime consequence |
| --- | --- |
| `rk_order_confirmation`, `rk_payment_confirmation`, `rk_order_shipped`, `rk_out_for_delivery`, `rk_order_delivered`, `rk_order_cancelled`, `rk_refund_processed` | APPROVED, UTILITY, en_US; exact reviewed components match. Mapping/automation switches remain separate and disabled. |
| `3p_direct_integration_test_template` | APPROVED, UTILITY, en_US; exact static header/body/footer, zero variables/buttons preserved. Separate Integration Test group and test selector retained. Real test gate is currently off. |
| Nine optional lifecycle templates | PENDING: `rk_payment_failure`, `rk_processing`, `rk_packed`, `rk_tracking_update`, `rk_return_requested`, `rk_return_status`, `rk_refund_initiated`, `rk_custom_order_received`, `rk_custom_order_status`. No reviewed runtime contract match; blocked. No unsupported event is enabled. |
| `rk_new_collection_drop` | Now APPROVED at Meta, but observed components do **not** match the reviewed local contract. Remains blocked. Requires explicit content reconciliation, not an inferred approval or silent template edit. |
| `rk_test` | APPROVED MARKETING, language en; unmapped. Not an approved Utility test candidate. |
| `rk_authentication_otp` | Absent; prior creation permission denial remains an unresolved external dependency. Authentication eligibility stays separate and unavailable. |
| `rk_exclusive_offer` | Absent local draft; no validated coupon engine, remains disabled. |
| `rk_admin_notification` | Internal-only local draft; absent from customer submission catalogue. |
| Seven `_v2` transactional variants | Absent; cannot inherit approval from originals. |

The configured phone belongs to the intended WABA; its quality is GREEN, but code verification reports NOT_VERIFIED. This does not establish registration/publication/billing readiness. WABA app membership is empty; app-level callback/fields are unverified. No access token or secret is printed in diagnostic output.

Exact future requests, permissions and expected responses are in [the Meta request section](WHATSAPP_DEPLOYMENT.md#exact-meta-requests---authorization-still-required-for-writes). They include WABA `subscribed_apps` GET/POST and app `subscriptions` GET/POST with the production callback and `messages` field. Preserve existing subscribed fields. **Do not execute the writes without separate authorization.** A callback challenge alone does not establish WABA membership. Meta's `messages` field carries inbound messages and outbound status notifications. See [Meta webhook subscriptions](https://developers.facebook.com/docs/graph-api/webhooks/subscriptions-edge).

## Status projection, retries and recovery

Exact provider message IDs correlate accepted sends to signed sent/delivered/read/failed callbacks. History deduplication, earliest milestone timestamps, status precedence and failure details update atomically; read implies delivery without fabricating a read receipt from delivery. Later sent/accepted/failed events cannot erase confirmed read/delivery evidence. Unknown IDs and multiple-status payloads are covered.

HTTP acceptance metadata is saved separately so a webhook arriving before the API response cannot be downgraded. An error response carrying a Meta message ID is ambiguous: retain its ID/API response, mark UNKNOWN and never retry automatically. HTTP success/server-error rate codes are also not treated as definitive safe rejection. Only explicit rate-limit rejection follows bounded existing retries/backoff, with consent/window checks retained.

Worker claims have UUID fencing and bounded renewable leases. Before dispatch/retry the worker verifies ownership; stale workers cannot overwrite newer owners. Expired fenced claims without any dispatch record may be requeued once. Known accepted/sent/delivered/read outcomes restore queue state without another send. Sending/unknown/failed outcomes and unfenced legacy claims become held for reconciliation. There is no blind recovery/replay command and no exactly-once delivery claim.

## Database and operations verification

Eleven required indexes cover partial unique string providerId, message time/status, inbox recipient/time and existing 30-day TTL, event 30-day TTL, queue status/time and expiresAt TTL0, consent customer/time, order events, campaigns and processing leases. Permanent message/consent/order claims have no TTL. No retention duration was invented.

The guarded command validates exact database/URI/DB_NAME, all off gates, MongoDB 5+, duplicates and conflicts before additive creation. A newly added TTL that would immediately expire existing records is refused for retention review. No drops/deletes occur. Real local index application and readiness passed with unchanged record counts. Production indexes, persistence/backups and durability still require server verification. Actual atomic expressions also passed a read-only real Mongo aggregation; mocked concurrency tests supplement this, rather than proving production load behavior. See [MongoDB unique index behavior](https://www.mongodb.com/docs/manual/core/index-unique/).

Systemd oneshot service/timer pairs under `deploy/systemd/` repeat worker batches 30 seconds after completion and inventory refresh every six hours. Same-unit scheduling, flock, fixed container name and database fencing address overlap at different layers. SIGTERM stops subsequent claims after the current bounded job. Structured logs expose only safe correlation/status. DB failures and held outcomes remain visible for reconciliation. Shared limiter and approved alerting/storage/backups are operator dependencies. Units use existing Gunicorn image/Compose, never Flask's development HTTP server. See [systemd timer semantics](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html).

## Production configuration checklist

Verify these **names**, without printing values or replacing production files:

```text
FLASK_ENV
WHATSAPP_ENVIRONMENT
WHATSAPP_ENABLED
WHATSAPP_TEST_SEND_ENABLED
WHATSAPP_MARKETING_ENABLED
WHATSAPP_API_VERSION
WHATSAPP_BUSINESS_ACCOUNT_ID
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_APP_ID
WHATSAPP_APP_SECRET
WHATSAPP_ACCESS_TOKEN
WHATSAPP_WEBHOOK_VERIFY_TOKEN
WHATSAPP_OUTBOX_KEY
WHATSAPP_CANONICAL_URL
WHATSAPP_TEMPLATES
WHATSAPP_EXPECTED_DATABASE
WHATSAPP_WORKER_LEASE_SECONDS
DB_NAME
MONGO_DB / MONGO_URI
RATELIMIT_STORAGE_URI
SECRET_KEY
JWT_SECRET_KEY
BACKEND_INTERNAL_URL
```

Flask currently ignores client-IP forwarding headers. Do not trust one until the active ingress overwrite and backend-peer restrictions are verified end to end.

Production environment must be production; all three WhatsApp send flags false. ProductionConfig additionally forces the flags off. Keep integration/mapping switches off. Omit development callback in production; preserve the outbox encryption key, App Secret fingerprint bindings and existing SMTP/Razorpay settings. `META_APP_ACCESS_TOKEN` is optional diagnostic-only, not a frontend or normal send variable. `RK_BACKEND_IMAGE`/`RK_FRONTEND_IMAGE` are nonsecret release references for the systemd override.

Actual local development readiness with guarded DB passed. Actual production-mode validation against local configuration correctly **failed closed** for `RATELIMIT_STORAGE_URI` and `WHATSAPP_EXPECTED_DATABASE`. These are not evidence about secret presence on the VPS; no production environment was read/modified. Detailed policies are in [the deployment checklist](WHATSAPP_DEPLOYMENT.md#production-environment-checklist).

## Executed validation

| Check | Actual result |
| --- | --- |
| Full backend baseline | 407 passed. |
| Final full backend | **455 passed, 1 skipped**, two mongomock deprecation warnings; 63.33 seconds. |
| Final WhatsApp-specific suites | **185 passed, 1 skipped**, same warnings; 20.54 seconds. Subset of full run, not additional coverage count. |
| WhatsApp Playwright browser tests | **35 passed**, mocked backend/Meta; 36 seconds. |
| Frontend Node suite, baseline and final | **153 passed, 1 failed / 154**. Existing homepage assertion described above. |
| TypeScript | Passed. |
| Production Next.js build | Passed, 62 pages. |
| Python dependency consistency | `python -m pip check` passed. |
| Frontend production dependency audit | `npm audit --omit=dev --json`: zero advisories. This is not an independent full Python vulnerability audit. |
| Git whitespace and secret/context scans | Passed; rechecked after this report. No secret values printed. |
| Real guarded local Mongo indexes/readiness | Passed; records unchanged; only additive indexes and local inventory cache changed. |
| Real Mongo status expressions | Passed read-only expression evaluation; no real message writes. |
| Off-mode worker | Disabled, zero processed; no queue draining or sends. |
| Meta inventory and WABA/phone audit | GETs succeeded; negative prerequisites above remain blockers. |
| Docker image build/inspection | Not executed: Docker unavailable. |
| Real Nginx integration/config validation | Not executed: Nginx unavailable; one explicit skipped backend test. |
| systemd unit execution/verification | Not executed on Windows; files provided, Linux verification required. |

Backend tests cover one-off approved-but-disabled mappings, independent gates, admin/consent/window safeguards, eight Utility contracts, OTP/marketing restrictions, STOP withdrawal, recipient/contact resolution, logs/webhook updates, deduplication, retry recovery and new indexes. Browser tests retain selector/component preview/consent/log/status behavior. No automated test sends to Meta. Current provider metadata checks were GET-only and were not mocked test sends.

## Startup, deployment and rollback

Exact local startup (separate PowerShell terminals):

```powershell
Set-Location 'C:\Users\athul\Desktop\RK-WEB-recovery\backend'
$env:FLASK_ENV = 'development'
$env:WHATSAPP_ENVIRONMENT = 'development'
$env:WHATSAPP_ENABLED = 'false'
$env:WHATSAPP_TEST_SEND_ENABLED = 'false'
$env:WHATSAPP_MARKETING_ENABLED = 'false'
python -m flask --app wsgi:app run --host 127.0.0.1 --port 5000
```

```powershell
Set-Location 'C:\Users\athul\Desktop\RK-WEB-recovery\frontend'
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Local callback: `http://127.0.0.1:5000/api/webhooks/whatsapp`. Verify token variable: `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.

The exact ordered **future VPS commands** are in [WHATSAPP_DEPLOYMENT.md](WHATSAPP_DEPLOYMENT.md#future-vps-deployment-commands), including image creation/inspection, guarded production check/index migration, immutable release Compose override, Nginx include/test/reload, systemd install/verification and disabled worker checks. They use `/opt/apps/rashi-kapoor/rk-web`; verify the real host path and existing server layout first. Manual files: actual HTTPS server block include, existing approved runtime environment (never overwrite), `/etc/rk-whatsapp/images.env`, and four installed systemd units. No such server action occurred here.

Core guarded commands, **only after separate authorization and prerequisites**:

```sh
cd /opt/apps/rashi-kapoor/rk-web
docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml run --rm --no-deps --pull never backend python -m flask --app wsgi:app whatsapp-check --production
docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml run --rm --no-deps --pull never backend python -m flask --app wsgi:app whatsapp-indexes --database "$RK_PRODUCTION_DATABASE" --apply
docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml up -d --no-build --pull never backend frontend
```

Do not execute this abbreviated block without first selecting/validating image references, backing up server configuration and completing the full runbook checks. Never run broad catalogue maintenance for WhatsApp indexes.

Rollback: stop timers/services; verify the worker container stopped; restore recorded immutable backend/frontend image references with the same Compose override and `up -d --no-build --pull never`; restore backed-up Nginx configuration after `nginx -t`; preserve environment secrets, all DB records/indexes, consent/STOP bindings and permanent claims. Keep old workers off because they lack fencing. Never replay uncertain outcomes or restore a database just to roll back code. The [exact rollback commands](WHATSAPP_DEPLOYMENT.md#rollback) leave messaging disabled.

## Final release blockers

1. Linux Docker build and image/content inspection; Nginx/systemd validation on the actual topology.
2. Separately authorized disabled deployment and end-to-end production callback verification; public route currently 404.
3. Separately authorized WABA app subscription; independently verify app callback/messages fields, number registration, permissions, publication and billing prerequisites.
4. Verify actual server secrets, shared limiter, trusted ingress, exact DB, required indexes, durable storage/backups and monitoring. Local configuration cannot establish these.
5. Resolve or explicitly accept the unrelated pre-existing homepage Node failure in its own scope.
6. Before any later feature activation, reconcile marketing component mismatch and other unavailable mappings; do not silently alter approved templates or infer approval.

**Final verdict: NO-GO.** Locally implementable remediation is complete; external verification/actions remain explicit. The repository stays uncommitted, production untouched and every real messaging gate disabled.
