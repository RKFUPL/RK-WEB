# WhatsApp disabled deployment and operations

These are instructions for a future separately authorized VPS/Meta change window. No command in the VPS or Meta sections was executed during local remediation. The production configuration class forces the broad automation, marketing and development-test flags off in code. The new order-only gate defaults off and requires a separate admin database control. The expiring manual Utility test mode remains independent; see [WHATSAPP_PRODUCTION_TEST_MODE.md](WHATSAPP_PRODUCTION_TEST_MODE.md). This runbook supersedes operational instructions in the older implementation notes.

## Order-only activation requirements (separate authorization required)

Deploy first with `WHATSAPP_ORDER_NOTIFICATIONS_ENABLED=false`; no production flag or database document was changed during implementation. ProductionConfig reads this explicit environment flag without relaxing `WHATSAPP_ENABLED=false`, `WHATSAPP_TEST_SEND_ENABLED=false` or `WHATSAPP_MARKETING_ENABLED=false`.

Before a separately authorized activation:

1. Validate the disabled release using the checks below. Verify credentials, real registered Phone Number ID/WABA, webhook subscription/security, shared rate-limit storage, expected database, indexes and stable outbox key. The existing Razorpay backend verification and signed capture webhook remain the only payment-confirmation authorities.
2. Read the latest complete Meta inventory using the existing guarded `whatsapp-template-refresh` command. Approval must be `APPROVED`, exact `rk_order_confirmation` / `en_US` / `UTILITY`, with matching components and a fresh WABA-scoped API observation. Local/manual approval flags cannot authorize it. Refresh failure, revoked status, mismatched components or evidence older than 24 hours block dispatch.
3. Merge only the `order_confirmation` mapping's `enabled: true` into the existing `WHATSAPP_TEMPLATES` configuration after review, preserving its exact catalogue/components/parameters and every unrelated mapping. Do not enable other order mappings initially. Keep `payment_confirmation` explicitly disabled to avoid two initial customer messages. Mapping enablement alone never proves approval.
4. Under separate runtime-change authorization, set `WHATSAPP_ORDER_NOTIFICATIONS_ENABLED=true` and restart the reviewed backend/worker image. Preserve all three broad/development/marketing flags as false. No environment file in this checkout is an activation instruction by itself.
5. In Admin Studio → Advanced Settings → Transactional order notifications, authorize and enable the dedicated admin order control. It writes only `integrations._id=whatsapp.orderNotificationsEnabled=true` through the authenticated, rate-limited PATCH endpoint; the generic `enabled` field can stay false. Both order controls and each mapping must be enabled. The overview, library automation eligibility and order-detail activity expose the effective state.
6. Install/verify the existing worker and six-hour template-refresh systemd timers as described below. The worker command is `python -m flask --app wsgi:app whatsapp-worker`; it uses the same encrypted outbox and transport, never a second sender. With only the order gate, it claims only tagged jobs for order_confirmation, shipped, out_for_delivery, delivered, cancelled and refund_completed. Payment confirmation remains outside this mode to prevent a duplicate initial paid-order notification. Encrypted business-event identity and persisted state are checked again; OTP, campaigns, marketing, text, admin notifications and optional lifecycle jobs are excluded. Legacy untagged jobs are not replayed in this mode. Review them individually rather than mass-retagging them.
7. Monitor safe order activity and actual signed delivery/read/failure receipts. This task sends no real message and establishes no live-provider acceptance evidence. An order needs its saved checkout transactional consent for the actual shipping number; missing/declined/withdrawn consent and STOP skip dispatch. Checkout remains optional and unchecked. Marketing consent does not grant transactional consent.

To stop order dispatch, disable the admin order control and/or set the order environment gate false, then stop the worker timer/service if needed. Gates, consent, business proof and template evidence are rechecked on retries and immediately before dispatch. Requests already received by Meta cannot be recalled. Preserve permanent event/message deduplication records, encryption keys and audit history during rollback; do not bulk-replay skipped or uncertain jobs. Roll back to the recorded image digest only after stopping active workers. `whatsapp-check --production` deliberately validates a fully disabled rollout and rejects an active order flag; run it with sending off before maintenance, not as an active-mode health check.

## Local startup and validation

Backend (PowerShell, separate terminal):

```powershell
Set-Location 'C:\Users\athul\Desktop\RK-WEB-recovery\backend'
$env:FLASK_ENV = 'development'
$env:WHATSAPP_ENVIRONMENT = 'development'
$env:WHATSAPP_ENABLED = 'false'
$env:WHATSAPP_ORDER_NOTIFICATIONS_ENABLED = 'false'
$env:WHATSAPP_TEST_SEND_ENABLED = 'false'
$env:WHATSAPP_MARKETING_ENABLED = 'false'
python -m flask --app wsgi:app run --host 127.0.0.1 --port 5000
```

Frontend (another terminal):

```powershell
Set-Location 'C:\Users\athul\Desktop\RK-WEB-recovery\frontend'
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Local webhook: `http://127.0.0.1:5000/api/webhooks/whatsapp`. Admin: `http://127.0.0.1:3000/admin/integrations/whatsapp`. Flask CLI operation commands run from `backend/`; the root-level equivalent is `python -m flask --app backend.app <command>`. Use the `wsgi:app` form inside the backend image. A development Flask HTTP server is never used on the VPS.

Repository-root validation:

```powershell
python scripts/audit_release_context.py
python scripts/audit_release_context.py --git
Set-Location backend
python -m pytest -q
python -m flask --app wsgi:app whatsapp-check --database RK_WEB_TEST_N2
python -m flask --app wsgi:app whatsapp-indexes --database RK_WEB_TEST_N2
python -m flask --app wsgi:app whatsapp-provider-audit
```

`whatsapp-indexes` defaults to read-only inspection; `--apply` is required to create indexes. It requires all sending flags off and validates the exact database against DB_NAME and the URI. It never seeds catalog data, drops indexes or deletes records. It refuses duplicates, index/TTL conflicts and installation of a new TTL index that would expire existing records without retention review. The application requires MongoDB 5+ for the additive unique-index migration and atomic status pipeline.

The scanner models the Docker ignore syntax used by this repository, fails on unsupported syntax and prints paths/rules only. It compares actual local secret values without rendering them. It does not substitute for an actual Linux Docker build and image inspection.

With Nginx installed, the isolated local fixture is:

```sh
nginx -p "$PWD/" -c deploy/nginx/whatsapp-local.conf -t
nginx -p "$PWD/" -c deploy/nginx/whatsapp-local.conf
```

The fixture listens on `127.0.0.1:8088` and forwards the exact callback to Flask port 5000. `backend/tests/test_whatsapp_nginx.py` starts its own isolated backend/proxy and tests a valid challenge, raw-body signatures, bad signatures and an unrelated website path when Nginx is available. The test explicitly skips when Nginx is absent.

## Production environment checklist

Verify these names in the existing approved runtime environment; never replace the server environment with a local file. Do not print values or run `docker compose config` into logs, because resolved configuration can contain secrets.

| Names | Required policy |
| --- | --- |
| `FLASK_ENV` | Explicit production marker; no conflicting development marker in APP_ENV/ENVIRONMENT. |
| `WHATSAPP_ORDER_NOTIFICATIONS_ENABLED` | Default false; dedicated order-only environment gate, also requiring admin order control and individually verified/enabled mappings. |
| `WHATSAPP_ENVIRONMENT` | Production. Environment is never selected from browser/Host headers. |
| `WHATSAPP_ENABLED`, `WHATSAPP_TEST_SEND_ENABLED`, `WHATSAPP_MARKETING_ENABLED` | All off. Keep database integration and automated template switches off as well. |
| `WHATSAPP_PRODUCTION_TEST_SEND_ENABLED`, `WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT` | New flag off and expiry blank for a disabled deployment. Any future temporary test requires separate authorization; the administrator manually enters one valid E.164 recipient per request, and an explicit UTC expiry no more than 24 hours ahead is checked at dispatch and retry. See the dedicated guide. |
| `WHATSAPP_API_VERSION` | Explicit provider-supported version; current configured v26.0 metadata GETs were verified. No guessed default/version upgrade. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_ID` | Exact intended app/WABA/registered business-number relationship, independently verified. |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Backend-only runtime secrets with correct permissions and lifetime. |
| `WHATSAPP_OUTBOX_KEY` | Existing valid Fernet key; preserve it while any encrypted payloads remain. No key is generated/rotated by deployment. |
| `WHATSAPP_CANONICAL_URL` | Canonical rashikapoor.co.in origin for URL contracts; production callback is fixed separately in backend code. |
| `WHATSAPP_TEMPLATES` | Merge exact reviewed mappings; all automated switches disabled. Local approval flags never authorize a send. |
| `WHATSAPP_EXPECTED_DATABASE` | Explicit exact target matching DB_NAME and the configured URI; mandatory for enabled worker and unattended template refresh. |
| `WHATSAPP_WORKER_LEASE_SECONDS` | Valid processing lease from 60–3600 seconds; default 300. This is not a retention/TTL setting. |
| `DB_NAME`, `MONGO_DB` / `MONGO_URI` | One authoritative URI; MONGO_DB currently takes precedence. Confirm URI database/DB_NAME/expected-target agreement and durable storage/backups. |
| `RATELIMIT_STORAGE_URI` | Verified shared store; memory storage fails the production readiness check. Existing dependencies support MongoDB. Redis requires its driver if chosen. |
| Client-IP forwarding | Flask currently ignores X-Forwarded-For, CF-Connecting-IP and custom client-IP headers. Do not enable trusted-header resolution until the active Nginx config is verified to overwrite caller values from a validated Cloudflare source and backend ingress is restricted to the expected proxy peers. |
| `SECRET_KEY`, `JWT_SECRET_KEY` | Preserve existing strong application secrets. |
| `BACKEND_INTERNAL_URL` | Frontend server-to-Flask routing inside Compose. No Meta secret belongs in NEXT_PUBLIC variables. |

Keep `WHATSAPP_DEVELOPMENT_CALLBACK_URL` empty/omitted in production. Preserve existing SMTP/Zoho (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`) and Razorpay (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_MODE`) configuration. Actual processed-refund notifications require the existing signed `refund.processed` event. Local file presence is not production presence evidence.

App Secret also keys recipient fingerprints. Rotation needs a reviewed binding/suppression migration. Do not replace it or the outbox key to make validation pass. Do not export/decrypt outbox bodies into logs. Permanent message/order deduplication and consent/suppression records have no TTL.

## Exact Meta requests — authorization still required for writes

The GET-only diagnostic command is `whatsapp-provider-audit`. It reads the complete inventory, WABA app membership and sender ownership. App webhook configuration additionally requires an app access token; the optional `--app-token-env META_APP_ACCESS_TOKEN` argument is the name of a backend environment variable, never a token value. Supply that temporary secret through the approved secret manager. It is not required for sending and is not persisted by this repository.

Read and verify independently:

```http
GET /{WHATSAPP_API_VERSION}/{WHATSAPP_BUSINESS_ACCOUNT_ID}/subscribed_apps
Authorization: Bearer <system-user token with whatsapp_business_management>

GET /{WHATSAPP_API_VERSION}/{WHATSAPP_APP_ID}/subscriptions
Authorization: Bearer <app access token for this exact app>
```

Expect the intended app ID in the first response, and an active `whatsapp_business_account` object with the exact production callback and `messages` field in the second. A verified callback alone does not prove WABA membership. `messages` carries inbound messages and outbound sent/delivered/read/failed statuses. Sending requires `whatsapp_business_messaging`; management/template/account operations require the appropriate `whatsapp_business_management` asset access.

If the WABA subscription is absent, the separately authorized request is:

```http
POST https://graph.facebook.com/{WHATSAPP_API_VERSION}/{WHATSAPP_BUSINESS_ACCOUNT_ID}/subscribed_apps
Authorization: Bearer <authorized system-user token with whatsapp_business_management>
```

Expected successful response: `{"success":true}`. Follow it with the GET and exact app-ID comparison. Do not execute it during this remediation task.

If the app-level webhook registration is absent or incorrect, the separately authorized request is:

```http
POST https://graph.facebook.com/{WHATSAPP_API_VERSION}/{WHATSAPP_APP_ID}/subscriptions
Authorization: Bearer <app access token>
Content-Type: application/x-www-form-urlencoded

object=whatsapp_business_account
callback_url=https://rashikapoor.co.in/api/webhooks/whatsapp
verify_token=<existing backend WHATSAPP_WEBHOOK_VERIFY_TOKEN>
fields=messages
```

Expected successful response: `{"success":true}` after Meta's GET verification succeeds. Read existing fields first and preserve them in the submitted union; do not replace an existing field set with `messages` alone. The handler also accepts `account_update`, `account_alerts`, `phone_number_quality_update`, `phone_number_name_update`, `message_template_status_update` and `message_template_quality_update`; add only fields actually supported for this app/version. Never send a provider token in a query URL or paste a secret into a shell command/history. Publication, access review, number verification/registration, billing and applicable business requirements remain operator checks; none are inferred from a successful inventory read.

Primary references: [Meta subscriptions edge](https://developers.facebook.com/docs/graph-api/webhooks/subscriptions-edge), [WABA subscription API](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/subscribed_apps/), [Meta verification requests](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/). Some reference-page fetches were rate limited during remediation; fresh GET evidence and explicit permissions remain separate checks.

## Scheduler files and recovery

Files under `deploy/systemd/` provide a oneshot worker service/timer and a separate inventory-refresh service/timer. They use the reviewed release image override and `/etc/rk-whatsapp/images.env`, containing only image references. They do not copy or source application credentials into host shell commands. Compose supplies the existing runtime environment.

- Worker repeats 30 seconds after completion, with at most 50 jobs per batch. systemd prevents normal same-unit overlap, flock guards duplicate host starts, a fixed container name guards manual collisions, and atomic queue claims/fencing guard concurrent workers.
- SIGTERM stops new claims after the active bounded job completes. ExecStop sends SIGTERM via `docker stop`; a forced kill can leave a claim for the next recovery pass.
- An expired fenced claim without a dispatch record may return to pending. Existing accepted/delivered/read outcomes are restored without another API call. Sending/unknown/failed outcomes and legacy unfenced claims are held for reconciliation. Duplicate uncertain dispatches also become held. No command blindly resets or replays uncertainty.
- Only explicit rate-limit rejections receive existing bounded retries/backoff. Provider ambiguity is never retried automatically. Leases are renewed/checked before sends and retries; stale workers cannot overwrite a newer claim.
- Inventory refresh runs every six hours, within the existing 24-hour evidence limit. It makes Meta GETs only and writes the guarded local cache. A failed/incomplete read preserves observations and blocks stale approvals.
- CLI output is structured JSON. Queue job logs contain digest correlation, status and safe reason only. Monitor aged pending/processing, held/unknown, refresh staleness/failure, DB disconnects, invalid signatures and failed systemd units. The deployment operator must connect the host's approved alerting system; no notification destination is invented here.

The service runs with Docker privileges. Verify the actual approved execution identity, `/usr/bin/docker` and `/usr/bin/flock`, Compose version/project and service paths on the VPS. The timeout is one hour for a bounded batch; stop timeout is 100 seconds. On overruns, verify no worker container survives before restarting. These services do not promise exactly-once provider delivery or guaranteed eventual delivery after ambiguity. See [systemd timer semantics](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html).

## Future VPS deployment commands

Run only after separate deployment authorization and Linux Docker validation. The repository's `main` push workflow auto-deploys; do not use it as a review mechanism. Preserve the current VPS environment and take approved backups. Stop any existing worker/refresh timers and active worker before maintenance. Record the currently running backend/frontend image IDs and active Nginx configuration for rollback.

From the reviewed server checkout, choose explicit candidate image references and the verified target (non-secret values supplied by the operator):

```sh
cd /opt/apps/rashi-kapoor/rk-web
read -r -p 'Reviewed release identifier: ' RK_RELEASE_ID
read -r -p 'Exact production database name: ' RK_PRODUCTION_DATABASE
export RK_BACKEND_IMAGE="rk-web-backend:whatsapp-${RK_RELEASE_ID}"
export RK_FRONTEND_IMAGE="rk-web-frontend:whatsapp-${RK_RELEASE_ID}"
docker inspect --format '{{.Image}}' rk-backend
docker inspect --format '{{.Image}}' rk-frontend
python3 scripts/audit_release_context.py
python3 scripts/audit_release_context.py --git
docker build -f Dockerfile.backend -t "$RK_BACKEND_IMAGE" .
docker build -f Dockerfile.frontend -t "$RK_FRONTEND_IMAGE" .
```

Record immutable resulting image IDs/digests and do not rebuild those candidates after validation. Inspect image file names without running application entrypoints or enabling networking; no actual environment file should be present:

```sh
docker run --rm --network none --entrypoint sh "$RK_BACKEND_IMAGE" -c 'if find /app -type f \( -name ".env" -o -name ".env.*" -o -name ".dev.vars*" -o -name "*.pem" -o -name "*.key" -o -name "*.bson" -o -name "*.dump" \) ! -name ".env.example" -print | grep -q .; then exit 1; fi'
docker run --rm --network none --entrypoint sh "$RK_FRONTEND_IMAGE" -c 'if find /app -type f \( -name ".env" -o -name ".env.*" -o -name ".dev.vars*" \) ! -name ".env.example" -print | grep -q .; then exit 1; fi'
```

Also scan exported `/app` application/bundle contents and image environment metadata against the server's known secrets with an approved redacting scanner; filename checks alone do not prove absence of embedded secrets. Check Linux dependencies, Gunicorn and container runtime before promotion. Do not log image environment values.

After the operator has verified all required server variables, off gates, expected database and shared limiter configuration:

```sh
docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml run --rm --no-deps --pull never backend python -m flask --app wsgi:app whatsapp-check --production
docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml run --rm --no-deps --pull never backend python -m flask --app wsgi:app whatsapp-indexes --database "$RK_PRODUCTION_DATABASE"
docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml run --rm --no-deps --pull never backend python -m flask --app wsgi:app whatsapp-indexes --database "$RK_PRODUCTION_DATABASE" --apply
docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml run --rm --no-deps --pull never backend python -m flask --app wsgi:app whatsapp-check --production --database "$RK_PRODUCTION_DATABASE"
docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml up -d --no-build --pull never backend frontend
curl -fsS http://127.0.0.1:5000/api/health
```

Do not use the broad `database-maintenance` command merely for WhatsApp indexes; it also seeds/migrates unrelated data. If the guarded index command refuses existing expired records or duplicate provider IDs, stop and reconcile under a separate retention/data plan. Do not delete records to force success.

Add `include /etc/nginx/snippets/rk-whatsapp-location.conf;` **inside the existing rashikapoor.co.in HTTPS server block**, preserving all other locations. The exact-match snippet targets Flask directly and leaves Next.js website locations unchanged. Back up any existing snippet first, then install the reviewed file and validate before an authorized reload:

```sh
sudo install -m 0644 deploy/nginx/whatsapp-location.conf /etc/nginx/snippets/rk-whatsapp-location.conf
sudo nginx -t
sudo systemctl reload nginx
curl -sS -o /dev/null -w '%{http_code}\n' https://rashikapoor.co.in/api/webhooks/whatsapp
```

The last request must return 403 once the route is deployed; a 404 or a Next.js/login/challenge page is a failed deployment. Validate a correctly tokened challenge and correctly signed synthetic webhook in the separately authorized validation window, without logging their token/query or sending any customer message. Ensure proxy/CDN rules preserve the raw body/signature header, avoid caching/auth challenges on this exact path and redact verification queries.

Securely prepare `/etc/rk-whatsapp/images.env` from `deploy/whatsapp-images.env.example` with the exact validated image IDs/references, preserving any existing file and its previous values for rollback. It contains only `RK_BACKEND_IMAGE` and `RK_FRONTEND_IMAGE`, not credentials. Then install the reviewed unit files:

```sh
sudo install -d -m 0700 /etc/rk-whatsapp
sudo install -m 0644 deploy/systemd/rk-whatsapp-worker.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/rk-whatsapp-worker.timer /etc/systemd/system/
sudo install -m 0644 deploy/systemd/rk-whatsapp-template-refresh.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/rk-whatsapp-template-refresh.timer /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/rk-whatsapp-worker.service /etc/systemd/system/rk-whatsapp-worker.timer /etc/systemd/system/rk-whatsapp-template-refresh.service /etc/systemd/system/rk-whatsapp-template-refresh.timer
sudo systemctl daemon-reload
sudo systemctl start rk-whatsapp-template-refresh.service
sudo systemctl start rk-whatsapp-worker.service
sudo journalctl -u rk-whatsapp-template-refresh.service -u rk-whatsapp-worker.service --since '10 minutes ago'
sudo systemctl enable --now rk-whatsapp-worker.timer rk-whatsapp-template-refresh.timer
```

Check that the worker reports disabled/zero processed. Cache refresh must complete without changing any mapping switch. Install timers only with separate approval. Complete independent Meta subscription/callback/number requirements; do not publish or modify Meta as an incidental deployment step. Stop at a disabled deployment. No live sending activation is included in these commands or authorized by this runbook.

## Rollback

1. Keep every send flag and mapping off. Stop both timers and any active worker service. Verify the named worker container has stopped; do not reset/replay uncertain claims.
2. Export the previously recorded immutable image references as `RK_BACKEND_IMAGE` and `RK_FRONTEND_IMAGE`, then use the same two Compose files:

```sh
sudo systemctl stop rk-whatsapp-worker.timer rk-whatsapp-template-refresh.timer
sudo systemctl stop rk-whatsapp-worker.service rk-whatsapp-template-refresh.service
docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml up -d --no-build --pull never backend frontend
curl -fsS http://127.0.0.1:5000/api/health
```

3. Restore the previous image-reference file and compatible Nginx snippet/server block from the saved backups, validate `nginx -t`, then perform an approved reload. Do not overwrite application credentials with local files and do not push main as a rollback shortcut.
4. Preserve all WhatsApp collections, permanent `_id` claims, provider IDs, consent/STOP/suppression records, indexes, encryption keys and fingerprint bindings. No database restore/drop/delete or index removal is required for application rollback. Old workers must remain off; they do not understand the new fencing protocol.
5. If the previous backend lacks the webhook route, preserve a compatible receiver or plan the approved Meta retry/holding strategy before switching it away. Never fake 200 responses to discard valid callbacks. Meta changes require separate authorization.
6. Reconcile held/sending/unknown outcomes by correlation/wamid before any future retry. A rollback cannot undo a delivered message or erase a customer withdrawal. Verify health, login/order read paths, callback responses and effective off gates; leave timers disabled pending approval.
