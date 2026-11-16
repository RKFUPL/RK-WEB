# WhatsApp final production readiness — 16 November 2026

**NOT production-ready. Live delivery has not been verified.**

Checkout: `main`, base `0c85e98` (checkout recipient and messaging diagnostics repair). Those committed repairs were preserved; this report covers the new uncommitted diagnostic/eligibility changes. No commit, push, deployment, production gate/secret/document change, Meta write, service control, order/payment creation or message initiation was performed. Production inspection used read-only SSH, Mongo queries and Meta GETs, without initializing Flask or invoking its worker.

This supersedes older point-in-time findings in `WHATSAPP_RELEASE_REVIEW.md` and `WHATSAPP_PRODUCTION_TEST_MODE.md`. Their safe audit procedures remain relevant with the additional prerequisites here.

## Root-cause matrix

| Area | Finding | Classification / next action |
| --- | --- | --- |
| Checkout | Historical code validated a local delivery number as WhatsApp and preferred delivery contact over explicit recipient. Base repair separates recipient and exact consent snapshot. | Fixed in base and locally regression-tested. No live checkout/payment test. |
| Manual gate | Production switch false, expiry empty; first restriction `production_test_disabled`. Enabling switch without expiry would fail next. | DISABLED BY CONFIGURATION; intentional application restriction, not a Meta failure. |
| Provider prerequisite | Manual test eligibility previously lacked sufficiently fresh sender/provider eligibility evidence. | Fixed locally: require scoped fresh proofs at entry, immediately before POST and after retry backoff. |
| Billing | Supplied Visa charge success and INR 0.93 remaining balance do not establish clearance, allocation or Messaging Account relationship. | NOT VERIFIED; manual Billing & Payments review. No inferred rounding/settlement/new usage. |
| Meta health | Overall LIMITED; phone LIMITED, WABA/Business/App AVAILABLE. Phone/app entities include codes 138024/138025. | ACTION REQUIRED; these codes concern calling/SIP in Meta documentation, not proof of a billing cause. Do not configure SIP to bypass the finding. |
| Sender | Ownership NOT_VERIFIED; registration CONNECTED; quality GREEN; display-name status unclassified. | ACTION REQUIRED. Connected registration and ownership verification are separate. |
| Template | `rk_order_confirmation`, en_US, UTILITY, APPROVED, exact mapped components match; quality UNKNOWN. | Freshly verified, not delivery proof. Quality pending and closed service window do not prevent an otherwise eligible approved Utility template. |
| Subscriptions | Correct app/WABA membership; active app-level WhatsApp subscription with exact production HTTPS callback and `messages`. | Verified separately by GETs; not evidence that a new signed delivery receipt executed. |
| Worker | Service failed, exit code 1; timer enabled and active/waiting. No worker container observed during bounded inspection. | Release blocker. Root cause unknown: protected journal inaccessible. Do not trigger a backlog to diagnose it. |
| Image/key continuity | Current backend image differs from older report. No current worker available for fresh comparison; protected image/environment source unreadable by this account. | NOT VERIFIED for current worker/candidate parity. Earlier equality is historical only. |
| Queue | Sample counts pending/processing/held/unknown/failed/invalid_payload and retry jobs all zero. | Snapshot only while timer enabled; not a stable audit or backlog release approval. |
| Homepage test | Expects contiguous `Where the art of`, but JSX contains a line-break element. | Pre-existing at committed HEAD; unchanged. Separate fix or explicit release waiver. |

## Fresh production facts

All times UTC; observations are point-in-time, not continuing guarantees.

- **12:16:29:** health/sender/app subscription reads. An initial grouped phone GET returned 429; individual GETs then succeeded. Missing display-name evidence remains unknown. Masked identifiers: Phone Number ID **0686**, WABA **3373**, App **3432**, Business **6556** (last four digits only). No credentials or full phones were rendered.
- **12:29:46:** complete inventory, one page, **19 records**, all APPROVED at that read. Seven original order templates match production mappings: `rk_order_confirmation`, `rk_payment_confirmation`, `rk_order_shipped`, `rk_out_for_delivery`, `rk_order_delivered`, `rk_order_cancelled`, `rk_refund_processed`. All reported quality values UNKNOWN. `rk_test` is **en / MARKETING**, not en_US Utility. The integration-test template is APPROVED/en_US/UTILITY, but no matching configured production mapping was established by this comparison. Other optional/marketing records similarly lack matching runtime components. This does not prove their Meta components are wrong or authorize new mappings. No mapping changed.
- **12:29:46:** guarded read-only Mongo snapshot: pending=0, processing=0, held=0, unknown=0, failed=0, invalid_payload=0, retryJobs=0. No payload read/decryption or document mutation. Timer not paused. `adminOrderControl=true`.
- **12:31:16:** service failed/exit-code/1, last exit **12:30:51**; timer active/waiting. Journal command reported insufficient visibility/no readable entries. Current web backend image `sha256:22d7ac09dbdfe3db1ae5aa0b6f10ae2e77b19b8f40ac260d06e3d3fc440fb0af`. Protected pinned worker image/projected keys were not read. No service control occurred.

```dotenv
# Observed values; not changes or an activation recommendation.
WHATSAPP_ENVIRONMENT=production
WHATSAPP_ENABLED=false
WHATSAPP_ORDER_NOTIFICATIONS_ENABLED=true
WHATSAPP_TEST_SEND_ENABLED=false
WHATSAPP_PRODUCTION_TEST_SEND_ENABLED=false
WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT=
WHATSAPP_MARKETING_ENABLED=false
```

Order environment and admin order controls are already ON. Do not call this an all-sending-disabled environment. Individual mapping, payment/event, exact consent and worker checks still apply. This task did not change these controls. A disabled release window needs separate operational authorization.

## Fixed locally and preserved protections

Seven diagnostic cards provide individual refresh plus Refresh All through admin-only `POST /api/admin/integrations/whatsapp/diagnostics/refresh`. Supported scopes are configuration, billing, sender, templates, webhook, worker, outbox, all. Authentication, explicit DB guard, no-store responses and 20/minute refresh limiting apply. Selected checks read current backend/provider evidence and store safe time/source/reason/action. The new endpoint was not invoked against production here. Provider operations are GET-only. No new environment variables.

Statuses: VERIFIED, BLOCKED, ACTION REQUIRED, NOT VERIFIED, UNKNOWN, DISABLED BY CONFIGURATION. Unknown is not a confirmed failure. Failed fresh diagnostic reads replace prior diagnostic success with UNKNOWN; the existing template refresh separately retains prior observations and marks them stale after a failed/incomplete inventory. Evidence is scoped to app/WABA/phone/API version and App Secret; scope bindings are never returned. Generic evidence expires after 15 minutes, worker observations after two minutes.

Billing remains explicitly `billingLedgerVerified=false`: the supported health field cannot establish a paid balance. Manual production tests require overall health AVAILABLE and exact phone/WABA/app entities AVAILABLE; sender ownership VERIFIED and registration CONNECTED. Fresh scoped proofs must be <=15 minutes old and are reloaded before dispatch and each retry. Health availability is not a zero-balance guarantee: manual ledger/account reconciliation remains necessary. Current LIMITED/NOT_VERIFIED evidence blocks testing even if its application switch were enabled. Historical 131042 payment/business-eligibility failures remain labelled historical, not proof of a current balance.

Worker cards expose guarded execution observations, code version, DB/environment consistency, key availability and queue counts. Host service/timer/image facts remain explicitly UNKNOWN until an authorized host inspection. A heartbeat or completed batch is not proof of dispatch. No Docker socket/host privilege is given to Flask. Queue refresh never reads payloads, claims/deletes/retags jobs or replays a backlog.

Manual tests retain exact Utility template/language/components, valid normalized E.164, explicit attestation, suppression/STOP, shared 3/minute and 10/hour send limits, request-ID deduplication, configured sender, WAMID logs and maximum 24-hour explicit UTC expiry. Attestation is audited as operator testimony, not independent system proof of consent. The path creates/modifies no order and enqueues no order event. Mapping enablement controls automation separately from preview/manual eligibility. Development text, order-only automation, Authentication and Marketing remain independently gated.

GET `/api/webhooks/whatsapp` still verifies mode, backend `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and challenge. POST still validates raw-body HMAC-SHA256 with `WHATSAPP_APP_SECRET` before processing and scopes events to configured WABA/Phone Number ID. Incoming STOP, deduplication and sent/delivered/read/failed WAMID correlation remain intact. Read without delivered establishes delivery evidence without fabricating `deliveredAt`; the UI distinguishes this from an actual delivered receipt. HTTP 200/accepted is not Delivered.

The base repairs/tests preserve country-aware signup/profile, primary/alternate checkout recipient, optional saving, exact order consent, withdrawn/changed recipient protection, verified payment before enqueueing, idempotent initial confirmation, retries and email behavior. Success-page refresh does not create another confirmation. These are mocked/local proofs, not live checkout/provider verification.

## Exact changed files

| File | Reason |
| --- | --- |
| `backend/app/whatsapp_checks.py` | New guarded/scoped evidence checks, provider prerequisite, worker observations. |
| `backend/app/whatsapp.py` | Fresh provider rechecks at entry and immediately before production-test dispatch/retry. |
| `backend/app/whatsapp_ops.py` | Guarded worker execution observations; no scheduler/control change. |
| `backend/app/whatsapp_routes.py` | Admin refresh, eligibility/status fields, safe blocker explanations, masked business phone in status. |
| `backend/tests/test_whatsapp_checks.py` | Diagnostic freshness, missing evidence, independent subscriptions, guard/auth/limits, worker/outbox, retries and template regressions. |
| `backend/tests/test_whatsapp_production_test.py` | Mocked fresh provider prerequisites for existing production-test fixtures. |
| `frontend/components/admin/whatsapp-diagnostics.tsx` | Seven actionable cards, refresh/error/evidence states and mobile/dark styles. |
| `frontend/app/admin/integrations/whatsapp/page.tsx` | Cards and unexpired provider prerequisite for sending. |
| `frontend/tests/whatsapp-ui.spec.ts` | Every refresh, unknown/error, provider gating, mobile/light/dark and fixture updates. |
| `docs/WHATSAPP_FINAL_PRODUCTION_READINESS.md` | This current report and conditional operational plan. |
| `docs/WHATSAPP_RELEASE_REVIEW.md` | Link to superseding observations. |
| `docs/WHATSAPP_PRODUCTION_TEST_MODE.md` | Fresh provider prerequisites and superseding evidence. |

No legal/homepage, environment, mapping or systemd file changed. `whatsapp-production-test-mode.patch` is already tracked in base `0c85e98`, contrary to older descriptions of it as untracked. It remains exactly as found: SHA-256 `BB10EBA2073C396DA009F9106DEA48F54B497A4886E2B8FECE7D5E6070BAF866`. No staging/untracking of it was performed; no implementation changes staged.

## Validation

| Check | Final code result |
| --- | --- |
| Entire backend, `python -m pytest -q` | **612 passed, 1 skipped**, two existing mongomock deprecation warnings. Nginx runtime test skipped because Nginx unavailable. |
| Frontend Node, `npm test` | **158 passed, 1 pre-existing homepage failure**. Isolated committed HEAD reproduces 3 pass/1 fail in that test; test and all source inputs match HEAD after line-ending normalization. |
| WhatsApp browser, `npm run test:whatsapp-ui` | **58 passed**, production frontend server, mocked backend/provider traffic. Mobile light/dark diagnostic screenshots inspected. |
| TypeScript / production frontend build | Passed / passed, 63 static pages. |
| Git/build-context secret scans / whitespace | No findings / `git diff --check` passed. |
| Linux Docker/systemd candidate acceptance | Not run locally: Docker/systemd unavailable; required on approved staging host. |
| Live delivery | Not attempted or verified. |

## Existing configuration names and continuity

Backend-only names (values omitted): `WHATSAPP_ENVIRONMENT`, `WHATSAPP_ENABLED`, `WHATSAPP_ORDER_NOTIFICATIONS_ENABLED`, `WHATSAPP_TEST_SEND_ENABLED`, `WHATSAPP_PRODUCTION_TEST_SEND_ENABLED`, `WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT`, `WHATSAPP_MARKETING_ENABLED`, `WHATSAPP_CANONICAL_URL`, `WHATSAPP_API_VERSION`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_OUTBOX_KEY`, `WHATSAPP_TEMPLATES`, `WHATSAPP_EXPECTED_DATABASE`, `WHATSAPP_WORKER_LEASE_SECONDS`, `MONGO_DB`/`MONGO_URI`, `DB_NAME`, `RATELIMIT_STORAGE_URI`, `SECRET_KEY`, `JWT_SECRET_KEY`, existing WorkDrive/session encryption secrets. `WHATSAPP_DEVELOPMENT_CALLBACK_URL` remains development-only. App subscription reads assemble a server-only app token from existing App ID/App Secret; no new secret variable or token disclosure.

Do not regenerate keys. Preserve `WHATSAPP_OUTBOX_KEY`, `WHATSAPP_APP_SECRET`, `ZOHO_WORKDRIVE_TOKEN_ENCRYPTION_KEY`, application/JWT/session keys across web, worker, candidate and rollback. Use the boolean in-memory secret comparison in `WHATSAPP_RELEASE_REVIEW.md`; do not render values or hashes. Required candidate equality and retained-payload decryption have not been freshly verified. URI database, `DB_NAME` and `WHATSAPP_EXPECTED_DATABASE` must agree. Retain unique event/claim/provider-ID indexes and reviewed retention. No index mutation here.

## Staging-to-production plan — commands not executed

Nothing below authorizes production changes. Current timer/order gate are not a disabled rollout. Resolve worker failure, host access and all preconditions first.

1. Review exact diff against `0c85e98`. After separate approval, prepare a release branch and immutable candidate SHA; none exists yet. Do not use a main push as a test: its workflow auto-deploys and does not synchronize protected worker image references. Record both old image IDs for rollback. On isolated approved staging:

   ```sh
   git status --short
   git diff --check
   python scripts/audit_release_context.py --git
   python scripts/audit_release_context.py
   (cd backend && python -m pytest -q)
   (cd frontend && npm ci && npm test)
   (cd frontend && npm run typecheck && npm run build && npm run test:whatsapp-ui)
   ```

   Expected: reported passing checks with only acknowledged homepage failure. Staging uses approved isolated DB, mocks and all sending gates false, never production environment/recipient data.

2. Build reviewed images on approved Linux staging, with no credential build context:

   ```sh
   read -r -p 'Reviewed backend image reference: ' RK_BACKEND_IMAGE
   read -r -p 'Reviewed frontend image reference: ' RK_FRONTEND_IMAGE
   export RK_BACKEND_IMAGE RK_FRONTEND_IMAGE
   docker build -f Dockerfile.backend -t "$RK_BACKEND_IMAGE" .
   docker build -f Dockerfile.frontend -t "$RK_FRONTEND_IMAGE" .
   docker run --rm --network none --entrypoint python "$RK_BACKEND_IMAGE" -c 'import dns.resolver, phonenumbers; from cryptography.fernet import Fernet; print("runtime imports: ok")'
   systemd-analyze verify deploy/systemd/rk-whatsapp-worker.service deploy/systemd/rk-whatsapp-worker.timer deploy/systemd/rk-whatsapp-template-refresh.service deploy/systemd/rk-whatsapp-template-refresh.timer
   ```

   Expected: image/import/unit acceptance; pin immutable digests. The worker must use the same reviewed backend image. Do not run a candidate worker against live data.

3. Read-only VPS inspection:

   ```sh
   cd /opt/apps/rashi-kapoor/rk-web
   systemctl show rk-whatsapp-worker.service -p LoadState -p ActiveState -p SubState -p Result -p ExecMainStatus -p ExecMainExitTimestamp
   systemctl show rk-whatsapp-worker.timer -p ActiveState -p SubState -p UnitFileState
   systemctl list-timers --all 'rk-whatsapp*'
   docker ps -a --filter name=rk-whatsapp --format '{{.Names}} {{.Image}} {{.Status}}'
   docker inspect --format '{{.Image}}' rk-backend
   ```

   Authorized host operator must privately inspect `sudo journalctl -u rk-whatsapp-worker.service -n 100 --no-pager`, protected overrides and `/etc/rk-whatsapp/images.env`. Logs/environment may contain secrets; never paste raw output. Determine actual exit-1 cause without guessing or starting worker. This account lacks required protected access.

4. Obtain separate authorization for a quiescent disabled window. Only under that authorization may the host operator pause:

   ```sh
   sudo systemctl stop rk-whatsapp-worker.timer
   sudo systemctl stop rk-whatsapp-worker.service
   systemctl is-active rk-whatsapp-worker.timer rk-whatsapp-worker.service
   docker ps --filter name=rk-whatsapp-worker --format '{{.Names}} {{.Status}}'
   ```

   Expected: inactive units/no worker; privately exclude alternative schedulers. Coordinate template-refresh environment consistency separately. Set all sending gates false only through a separately authorized protected configuration change. Execute the exact metadata/decryption backlog audit and boolean secret-continuity comparison in `WHATSAPP_RELEASE_REVIEW.md`. No claims, deletion, retagging, expiry extension or replay. Review exact jobs, consent, payment/event freshness and WAMID authority. An unexpired still-eligible old job can send: no automatic deployment cutoff/quarantine exists. Inability to obtain a stable audit blocks release.

5. After approval and preconditions, deploy reviewed **disabled** images. Authorized privileged server shell must select the approved candidate in the existing protected source for web and worker; CI does not do this. Preserve keys and record rollback images first:

   ```sh
   cd /opt/apps/rashi-kapoor/rk-web
   set -a
   . /etc/rk-whatsapp/images.env
   set +a
   docker image inspect --format '{{.Id}}' "$RK_BACKEND_IMAGE" "$RK_FRONTEND_IMAGE"
   docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml up -d --no-build --pull never --no-deps backend frontend
   curl -fsS http://127.0.0.1:5000/api/health
   curl -fsS https://rashikapoor.co.in/api/health
   curl -sS -o /dev/null -w '%{http_code}\n' https://rashikapoor.co.in/api/webhooks/whatsapp
   docker exec rk-backend python -m flask --app wsgi:app whatsapp-check --production
   docker exec rk-backend sh -c 'python -m flask --app wsgi:app whatsapp-indexes --database "$WHATSAPP_EXPECTED_DATABASE"'
   ```

   Expected: health 200, unauthenticated challenge-less webhook GET 403, disabled-release readiness true and clean read-only index check. Current order gate ON would intentionally fail disabled readiness. No `--apply`, worker CLI or timer start. Flask initialization is appropriate only in the separately approved window. Recheck flags, DB guard, image IDs and projected key equality after replacement.

6. Admin refresh every diagnostic. Expect real timestamps/sources, correct app/WABA/callback/messages, exact template evidence and explicit host UNKNOWN where inaccessible. Worker failure cause, candidate image parity, key continuity and stable backlog audit must be resolved before any separately authorized resume. Service installation/heartbeat alone does not prove dispatch.

## Meta actions and one controlled test — separate authorization required

1. Meta Business > Billing & Payments > **Messaging Accounts** > account linked to WABA ending 3373 (supplied name Rashi Kapoor Mumbai). Match payment to correct account/Business, review balance/restrictions/eligibility. This is not Ad Account billing. Seek Meta reconciliation for inconsistent charge/balance; do not repeatedly charge.
2. WhatsApp Manager > Account tools > Phone numbers > sender ID ending 0686. Investigate NOT_VERIFIED ownership separately from CONNECTED registration. Only independently authorized verification/registration actions may change it; no automatic register/deregister.
3. Refresh exact `rk_order_confirmation`/en_US/UTILITY APPROVED and matching components. Quality pending and closed service window are not approval failures. Do not edit/resubmit templates or enable automated mappings just to test.
4. Meta Developers > correct app > WhatsApp/Webhooks: active `whatsapp_business_account`, callback `https://rashikapoor.co.in/api/webhooks/whatsapp`, `messages` field; separately confirm WABA subscribed_apps membership. Keep verify token private and raw-body signature mandatory. Subscription alone is not executed receipt proof.
5. Authorize one business-owned recipient with documented number/WhatsApp consent and one short window. Complete manual billing review and refresh health AVAILABLE/exact entities AVAILABLE, ownership VERIFIED/registration CONNECTED. Never override UNKNOWN/LIMITED/NOT_VERIFIED. Provider evidence expires after 15 minutes independently of the test window.
6. Only after explicit authorization, operator enables `WHATSAPP_PRODUCTION_TEST_SEND_ENABLED` and sets `WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT` through existing protected runtime source. Generate a short UTC expiry without secrets:

   ```sh
   python3 -c 'from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(minutes=15)).isoformat())'
   ```

   Missing/invalid/non-UTC/expired/>24-hour expiry fails closed. General, development and marketing switches stay false. Do not alter independent order gate under test authorization; worker isolation needs its own approved operational window. Recreate reviewed backend to load authorized environment changes; restart alone does not inject new variables:

   ```sh
   docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml up -d --no-build --pull never --no-deps --force-recreate backend
   ```

7. Refresh provider/template diagnostics. Admin Test Messages: manually enter one authorized E.164 number, preview exact components and ordered fields, use clearly labelled test values and explicitly attest consent. Submit once, retaining request ID for reconciliation. No implicit customer recipient, real order/payment or lifecycle event. Backend rechecks prerequisites immediately before every dispatch/retry.
8. Log must show testSend/productionTestSend true, orderId null, API status and WAMID if accepted. HTTP 200 is not delivery. Require actual signed Delivered (or Read proving delivery) matching that WAMID. Missing receipt means not verified; do not resend blindly or claim success.
9. Close authorized window: disable flag, clear expiry, recreate through same approved process, verify `production_test_disabled`. Worker/automation activation remains separate. Do not enable general/OTP/Marketing.

## Rollback — separately approved operator procedure

Keep workers quiescent and sending disabled. Preserve encrypted jobs, WAMIDs, claims and consent/audit history; no database restore that erases deduplication evidence, key rotation, Meta change or backlog replay.

```sh
cd /opt/apps/rashi-kapoor/rk-web
read -r -p 'Recorded previous backend image: ' RK_BACKEND_IMAGE
read -r -p 'Recorded previous frontend image: ' RK_FRONTEND_IMAGE
export RK_BACKEND_IMAGE RK_FRONTEND_IMAGE
docker image inspect --format '{{.Id}}' "$RK_BACKEND_IMAGE" "$RK_FRONTEND_IMAGE"
docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml up -d --no-build --pull never --no-deps --force-recreate backend frontend
curl -fsS http://127.0.0.1:5000/api/health
```

Reconcile protected worker/refresh image source to the same approved rollback references before any later activation. Preserve keys, repeat disabled gates, DB guard, indexes and backlog checks. Unknown delivery stays held for reconciliation. Rollback does not authorize worker resume. No rollback command executed.

## Remaining blockers

Billing clearance/relationship, LIMITED health, NOT_VERIFIED ownership, worker exit-1 cause, fresh worker/web candidate image/key parity, stable queue audit, Linux Docker/systemd/Nginx acceptance and one separately authorized delivered message remain unresolved. Homepage test needs waiver or separate repair. Protected host journal/environment access is unavailable. Passing mocked tests cannot resolve these blockers.

Meta references: [Health Status](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/health-status), [Phone Numbers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers), [Registration](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration), [App Subscriptions](https://developers.facebook.com/docs/graph-api/reference/app/subscriptions).
