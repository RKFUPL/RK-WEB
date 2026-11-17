# WhatsApp final production readiness — updated 17 November 2026

**NOT production-ready. Live delivery has not been verified.**

**Current image-pin permissions correction:** The operator reports deployment
`cd1a65ceac9183af910e5c7a396119f0bf9f29ac` built both images but stopped at
`sudo: interactive authentication is required`, before replacing application
containers. The local fix replaces passwordless repository Python with an
independent root-owned host helper. Install and verify that helper **before any
main push**; main still auto-deploys. Exact installation, checksum and sudoers
commands are in [WHATSAPP_IMAGE_PIN_HELPER.md](WHATSAPP_IMAGE_PIN_HELPER.md).
The operator reports both timers paused and all five sending gates OFF; this
local task did not inspect/change production configuration or execute SSH.
Earlier observed ON gates below are historical, not a fresh production claim.

**17 November worker configuration correction:** The later operator-supplied VPS
logs identify the Docker startup failure precisely. The local repair and recovery
procedure below supersede the earlier unknown exit-1 cause and image-pin deployment
instructions in this report. No SSH, production command, service control, message,
Meta operation or environment change was performed for this repair.

Checkout: `main`, base `0c85e98` (checkout recipient and messaging diagnostics repair). Those committed repairs were preserved; this report covers the new uncommitted diagnostic/eligibility changes. No commit, push, deployment, production gate/secret/document change, Meta write, service control, order/payment creation or message initiation was performed. Production inspection used read-only SSH, Mongo queries and Meta GETs, without initializing Flask or invoking its worker.

This supersedes older point-in-time findings in `WHATSAPP_RELEASE_REVIEW.md` and `WHATSAPP_PRODUCTION_TEST_MODE.md`. Their safe audit procedures remain relevant with the additional prerequisites here.

## Root-cause matrix

| Area | Finding | Classification / next action |
| --- | --- | --- |
| Checkout | Historical code validated a local delivery number as WhatsApp and preferred delivery contact over explicit recipient. Base repair separates recipient and exact consent snapshot. | Fixed in base and locally regression-tested. No live checkout/payment test. |
| Manual gate | Production switch false, expiry empty; first restriction `production_test_disabled`. Enabling switch without expiry would fail next. | DISABLED BY CONFIGURATION; intentional application restriction, not a Meta failure. |
| Provider prerequisite | Manual test eligibility previously lacked sufficiently fresh sender/provider eligibility evidence. | Fixed locally: require scoped fresh proofs at entry, immediately before POST and after retry backoff. |
| Billing | Supplied Visa charge success and INR 0.93 remaining balance do not establish clearance, allocation or Messaging Account relationship. | NOT VERIFIED; manual Billing & Payments review. No inferred rounding/settlement/new usage. |
| Meta health | Fresh phone `health_status` still says LIMITED; phone LIMITED, WABA/Business/App AVAILABLE. Phone/app entities include codes 138024/138025. | ACTION REQUIRED; Meta classifies these codes under calling/SIP, so they do not establish a billing cause. The independent LIMITED health remains a provider eligibility blocker. |
| Business verification | Fresh WABA `business_verification_status=verified`; screenshot identifies RASHI KAPOOR FASHION UNICUS PRIVATE LIMITED and original verification date 12 November. | VERIFIED for business only. Does not prove sender OTP verification, messaging eligibility or billing clearance. |
| Sender | Fresh phone `status=CONNECTED`, `code_verification_status=NOT_VERIFIED`, Graph quality `GREEN` (Manager shows HIGH). | CONNECTED is the Cloud API status. The OTP-code field is separately NOT_VERIFIED; the pair conflicts. Diagnostic reports UNKNOWN for the combined check, displays both facts and does not recommend removal/re-registration. Quality is shown independently. |
| Messaging capacity | Fresh WABA `whatsapp_business_manager_messaging_limit=TIER_250`. Manager screenshot reports 5 customer conversations in the previous 7 days. | The tier is an active capacity of 250 unique recipients per rolling 24 hours, shared across business phone numbers. It is not a restriction and no tier-change request was attempted. The five-conversation count is dashboard screenshot evidence, not the same metric as unique-recipient capacity. |
| Template | `rk_order_confirmation`, en_US, UTILITY, APPROVED, exact mapped components match; quality UNKNOWN. | Freshly verified, not delivery proof. Quality pending and closed service window do not prevent an otherwise eligible approved Utility template. |
| App subscription | WABA/app membership was confirmed in read-only checks; the latest production app-level callback and `messages` field subscription could not be verified with the available app-token/dashboard access. | UNKNOWN; a WABA membership result alone does not confirm callback URL or subscribed fields. |
| Worker | Service failed, exit code 1; timer enabled and active/waiting at the earlier read. Later operator logs identify `failed to solve: build tag cannot contain a digest`. | Release blocker with a local configuration fix: reset inherited backend build and synchronize actual inspectable image pins. No successful execution verified. |
| Image/key continuity | Current backend image differs from older report. No current worker available for fresh comparison; protected image/environment source unreadable by this account. | NOT VERIFIED for current worker/candidate parity. Earlier equality is historical only. |
| Queue | Sample counts pending/processing/held/unknown/failed/invalid_payload and retry jobs all zero. | Snapshot only while timer enabled; not a stable audit or backlog release approval. |
| Homepage test | Expects contiguous `Where the art of`, but JSX contains a line-break element. | Pre-existing at committed HEAD; unchanged. Separate fix or explicit release waiver. |

## Fresh production facts

All times UTC; observations are point-in-time, not continuing guarantees.

- **12:16:29:** health/sender/app subscription reads. An initial grouped phone GET returned 429; individual GETs then succeeded. Missing display-name evidence remains unknown. Masked identifiers: Phone Number ID **0686**, WABA **3373**, App **3432**, Business **6556** (last four digits only). No credentials or full phones were rendered.
- **12:29:46:** complete inventory, one page, **19 records**, all APPROVED at that read. Seven original order templates match production mappings: `rk_order_confirmation`, `rk_payment_confirmation`, `rk_order_shipped`, `rk_out_for_delivery`, `rk_order_delivered`, `rk_order_cancelled`, `rk_refund_processed`. All reported quality values UNKNOWN. `rk_test` is **en / MARKETING**, not en_US Utility. The integration-test template is APPROVED/en_US/UTILITY, but no matching configured production mapping was established by this comparison. Other optional/marketing records similarly lack matching runtime components. This does not prove their Meta components are wrong or authorize new mappings. No mapping changed.
- **12:29:46:** guarded read-only Mongo snapshot: pending=0, processing=0, held=0, unknown=0, failed=0, invalid_payload=0, retryJobs=0. No payload read/decryption or document mutation. Timer not paused. `adminOrderControl=true`.
- **12:31:16:** service failed/exit-code/1, last exit **12:30:51**; timer active/waiting. Journal command reported insufficient visibility/no readable entries. Current web backend image `sha256:22d7ac09dbdfe3db1ae5aa0b6f10ae2e77b19b8f40ac260d06e3d3fc440fb0af`. Protected pinned worker image/projected keys were not read. No service control occurred.
- **17 November 07:26:39:** fresh WABA GET reported `business_verification_status=verified` and `whatsapp_business_manager_messaging_limit=TIER_250`; phone GET reported `status=CONNECTED`, `code_verification_status=NOT_VERIFIED`, quality `GREEN`. Phone Number ID is **482608498260686** (configured production sender). The supplied Manager screenshot labels quality HIGH and shows business verification originally completed 12 November.
- **07:26:53:** fresh phone health GET still reported overall/phone LIMITED; WABA, Business and App entities AVAILABLE. Codes 138024/138025 remain present at phone/App level and are not treated as billing evidence.
- **07:28:58–07:29:25:** latest read-only host check: worker service still failed, exit code 1; timer active/waiting. Journal remains inaccessible to this SSH identity. Service was not controlled.
- **07:29:25:** production gates reread: `WHATSAPP_ENABLED=false`, `WHATSAPP_TEST_SEND_ENABLED=false`, `WHATSAPP_PRODUCTION_TEST_SEND_ENABLED=false`, expiry unset, `WHATSAPP_MARKETING_ENABLED=false`; `WHATSAPP_ORDER_NOTIFICATIONS_ENABLED=true` and admin order control true. These were observed, not changed.

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

Business verification, phone OTP ownership verification, Cloud API registration and messaging eligibility are separate diagnostic facts. Meta's official API distinguishes the WABA `business_verification_status` from the phone `status` and `code_verification_status`; registration guidance describes ownership-code verification and API registration as separate steps, while the phone-numbers guide identifies `CONNECTED` as the phone status required to send/receive. Here Graph simultaneously reports CONNECTED and NOT_VERIFIED code status. The diagnostic marks the combined sender check UNKNOWN because the signals conflict, but does not claim disconnection or advise removal/re-registration. The visible admin card lists Sender API status, phone ownership OTP code status, WABA business verification, quality (Graph and Manager display), messaging tier and capacity independently. The production test prerequisite uses fresh CONNECTED registration and VERIFIED WABA business status; the code field by itself does not decide registration.

The Graph quality rating is GREEN; Meta Manager renders that tier as HIGH. The 250 tier is capacity for 250 unique recipients in a moving 24-hour period, not a sending restriction; no automatic increase is attempted. The screenshot's five conversations in seven days is recorded as dashboard context only. The new sender card shows these fields directly and masks the displayed business phone, while retaining the Phone Number ID for asset identification.

Billing remains explicitly `billingLedgerVerified=false`: health does not establish a paid balance. Manual production tests require overall health AVAILABLE and exact phone/WABA/app entities AVAILABLE, fresh CONNECTED registration and VERIFIED WABA business status. Fresh scoped proofs must be <=15 minutes old and are reloaded before dispatch and each retry. Health availability would not guarantee a zero balance; manual ledger/account reconciliation remains necessary. Current LIMITED health and unresolved billing clearance block testing even with the application switch enabled. Historical 131042 payment/business-eligibility failures remain labelled historical, not proof of a current balance.

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
| `backend/tests/test_whatsapp_checks.py` | Diagnostic freshness, business/sender/OTP/registration/quality/tier separation, missing evidence, subscriptions, guard/auth/limits, worker/outbox, retries and template regressions. |
| `backend/tests/test_whatsapp_production_test.py` | Mocked fresh provider prerequisites for existing production-test fixtures. |
| `backend/app/whatsapp_diagnostics.py` | Informational OTP-code diagnostic; no unsupported ownership/remediation claim. |
| `backend/tests/test_whatsapp_diagnostics.py` | Assert contradictory code/connected facts remain informational. |
| `frontend/components/admin/whatsapp-diagnostics.tsx` | Seven actionable cards, refresh/error/evidence states and mobile/dark styles. |
| `frontend/app/admin/integrations/whatsapp/page.tsx` | Cards and unexpired provider prerequisite for sending. |
| `frontend/tests/whatsapp-ui.spec.ts` | Every refresh, unknown/error, provider gating, mobile/light/dark and updated code-status explanation. |
| `docs/WHATSAPP_FINAL_PRODUCTION_READINESS.md` | This current report and conditional operational plan. |
| `docs/WHATSAPP_RELEASE_REVIEW.md` | Link to superseding observations. |
| `docs/WHATSAPP_PRODUCTION_TEST_MODE.md` | Fresh provider prerequisites and superseding evidence. |
| `deploy/docker-compose.worker.yml` | Worker/refresh-only `!reset null` removes inherited backend build. |
| `deploy/systemd/rk-whatsapp-worker.service` | Include third Compose file and read-only image/model preflight before Flask. |
| `deploy/systemd/rk-whatsapp-template-refresh.service` | Same reviewed backend image and build-free preflight for controlled refresh. |
| `.github/workflows/deploy.yml` | Refuse active timers/jobs, sync inspectable build RepoDigests atomically, verify running parity; never invoke worker/refresh. |
| `scripts/whatsapp_images.py` | Read-only merged JSON, local digest/running parity and paused checks; privileged writer removed. |
| `backend/tests/test_whatsapp_worker_images.py` | Compose 5.5.0 digest/build regression, unit commands, missing/stale pins, digest availability and no mutable fallback. |
| `deploy/whatsapp-images.env.example` | Explain image-only digest requirements and synchronization. |

No legal/homepage, environment, mapping or systemd file changed. `whatsapp-production-test-mode.patch` is already tracked in base `0c85e98`, contrary to older descriptions of it as untracked. It remains exactly as found: SHA-256 `BB10EBA2073C396DA009F9106DEA48F54B497A4886E2B8FECE7D5E6070BAF866`. No staging/untracking of it was performed; no implementation changes staged.

## Validation

| Check | Final code result |
| --- | --- |
| Entire backend, `python -m pytest -q` | **636 passed, 2 skipped**, two existing mongomock deprecation warnings. Skips: unavailable Nginx and Linux-only file-permission acceptance. Includes the later worker-image repair. |
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

1. Review exact diff against `0c85e98`. After separate approval, prepare a release branch and immutable candidate SHA; none exists yet. Do not use a main push as a test: its workflow auto-deploys. The local workflow correction below synchronizes protected worker pins only after the authorized pause prerequisite. Record both old image IDs for rollback. On isolated approved staging:

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
   docker compose build
   docker run --rm --network none --entrypoint python rk-web-backend -c 'import dns.resolver, phonenumbers; from cryptography.fernet import Fernet; print("runtime imports: ok")'
   systemd-analyze verify deploy/systemd/rk-whatsapp-worker.service deploy/systemd/rk-whatsapp-worker.timer deploy/systemd/rk-whatsapp-template-refresh.service deploy/systemd/rk-whatsapp-template-refresh.timer
   ```

   Expected: image/import/unit acceptance. Use the staging project's actual build tag if its project name differs from rk-web. Build with ordinary tags, never use a repository digest as a build tag. Then resolve and validate actual RepoDigests as described below; local builds may not produce them. The worker must use the same reviewed backend image. Do not run a candidate worker against live data.

3. Read-only VPS inspection:

   ```sh
   cd /opt/apps/rashi-kapoor/rk-web
   systemctl show rk-whatsapp-worker.service -p LoadState -p ActiveState -p SubState -p Result -p ExecMainStatus -p ExecMainExitTimestamp
   systemctl show rk-whatsapp-worker.timer -p ActiveState -p SubState -p UnitFileState
   systemctl list-timers --all 'rk-whatsapp*'
   docker ps -a --filter name=rk-whatsapp --format '{{.Names}} {{.Image}} {{.Status}}'
   docker inspect --format '{{.Image}}' rk-backend
   ```

   Authorized host operator must privately inspect protected overrides and `/etc/rk-whatsapp/images.env`. Later supplied logs identify the build/digest startup error; further Python/runtime failures, if any, remain untested. Logs/environment may contain secrets; never paste raw output. Do not start a worker for diagnosis.

4. Obtain separate authorization for a quiescent disabled window. Only under that authorization may the host operator pause:

   ```sh
   sudo systemctl stop rk-whatsapp-worker.timer
   sudo systemctl stop rk-whatsapp-worker.service
   systemctl is-active rk-whatsapp-worker.timer rk-whatsapp-worker.service
   docker ps --filter name=rk-whatsapp-worker --format '{{.Names}} {{.Status}}'
   ```

   Expected: inactive units/no worker; privately exclude alternative schedulers. Coordinate template-refresh environment consistency separately. Set all sending gates false only through a separately authorized protected configuration change. Execute the exact metadata/decryption backlog audit and boolean secret-continuity comparison in `WHATSAPP_RELEASE_REVIEW.md`. No claims, deletion, retagging, expiry extension or replay. Review exact jobs, consent, payment/event freshness and WAMID authority. An unexpired still-eligible old job can send: no automatic deployment cutoff/quarantine exists. Inability to obtain a stable audit blocks release.

5. After approval and preconditions, deploy reviewed **disabled** images using the guarded workflow and image synchronization procedure below. CI now updates only the protected image pins and verifies parity; it does not install/start services or change application environment/gates. Preserve keys and record rollback images first. For a separately authorized pinned rollback/manual application replacement (the worker override removes build):

   ```sh
   cd /opt/apps/rashi-kapoor/rk-web
   set -a
   . /etc/rk-whatsapp/images.env
   set +a
   docker image inspect --format '{{.Id}}' "$RK_BACKEND_IMAGE" "$RK_FRONTEND_IMAGE"
   docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml -f deploy/docker-compose.worker.yml up -d --no-build --pull never --no-deps backend frontend
   curl -fsS http://127.0.0.1:5000/api/health
   curl -fsS https://rashikapoor.co.in/api/health
   curl -sS -o /dev/null -w '%{http_code}\n' https://rashikapoor.co.in/api/webhooks/whatsapp
   docker exec rk-backend python -m flask --app wsgi:app whatsapp-check --production
   docker exec rk-backend sh -c 'python -m flask --app wsgi:app whatsapp-indexes --database "$WHATSAPP_EXPECTED_DATABASE"'
   ```

   Expected: health 200, unauthenticated challenge-less webhook GET 403, disabled-release readiness true and clean read-only index check. Current order gate ON would intentionally fail disabled readiness. No `--apply`, worker CLI or timer start. Flask initialization is appropriate only in the separately approved window. Recheck flags, DB guard, image IDs and projected key equality after replacement.

6. Admin refresh every diagnostic. Expect real timestamps/sources, correct app/WABA/callback/messages, exact template evidence and explicit host UNKNOWN where inaccessible. Worker image correction, candidate parity, key continuity and stable backlog audit must be verified before any separately authorized resume. Service installation/heartbeat alone does not prove dispatch.

## Meta actions and one controlled test — separate authorization required

1. Meta Business > Billing & Payments > **Messaging Accounts** > account linked to WABA ending 3373 (supplied name Rashi Kapoor Mumbai). Match payment to correct account/Business, review balance/restrictions/eligibility. This is not Ad Account billing. Seek Meta reconciliation for inconsistent charge/balance; do not repeatedly charge.
2. WhatsApp Manager > Account tools > Phone numbers > sender ID ending 0686. Review `status=CONNECTED` and `code_verification_status=NOT_VERIFIED` together. The latter is the OTP ownership verification field, but it conflicts with current CONNECTED status; do not remove/re-add/re-register or request a new code solely from this mismatch. If the dashboard and API continue to disagree, ask Meta support to reconcile the state. Business verification is separately VERIFIED.
3. Refresh exact `rk_order_confirmation`/en_US/UTILITY APPROVED and matching components. Quality pending and closed service window are not approval failures. Do not edit/resubmit templates or enable automated mappings just to test.
4. Meta Developers > correct app > WhatsApp/Webhooks: active `whatsapp_business_account`, callback `https://rashikapoor.co.in/api/webhooks/whatsapp`, `messages` field; separately confirm WABA subscribed_apps membership. Keep verify token private and raw-body signature mandatory. Subscription alone is not executed receipt proof.
5. Authorize one business-owned recipient with documented number/WhatsApp consent and one short window. Complete manual billing review and refresh health AVAILABLE/exact entities AVAILABLE, WABA business verification VERIFIED and phone status CONNECTED. Do not use the conflicting OTP field alone as a re-registration instruction. Never override UNKNOWN/LIMITED messaging health. Provider evidence expires after 15 minutes independently of the test window.
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

Billing clearance/relationship, LIMITED health, conflicting phone OTP/CONNECTED fields, production acceptance of the local worker image correction, fresh worker/web candidate image/key parity, stable queue audit, Linux Docker/systemd/Nginx acceptance and one separately authorized delivered message remain unresolved. Homepage test needs waiver or separate repair. Passing mocked tests cannot resolve these blockers.

## Worker image repair: confirmed failure and effective Compose models

The following production facts were supplied by the operator, not freshly read
over SSH during this local implementation. The host runs Compose **v5.5.0** at
`/opt/apps/rashi-kapoor/rk-web`. Its protected pins refer to images no longer
locally inspectable:

```text
backend stale: rk-web-backend@sha256:9ac5d6acbf1ea259dc2316cfa66edc0fe4ac0b50c13ab47556ad55fa6409ada3
frontend stale: rk-web-frontend@sha256:25212b70dbebd75b39e05e3fe39fa19ea495562e5bd0bc3c209543ef949f4128
backend running/available: rk-web-backend@sha256:f44a5e618cba2a3a43472308da2b08313bb604c041416e460b083b90741c7791
frontend running/available: rk-web-frontend@sha256:6366b2b5dec8f02108690c55341ae772e5fbacadd7263ff35e52760b908f09bd
```

The workflow rebuilt application images without updating the protected pin file.
This explains stale references after deployment; the exact pruning/replacement
history that made the old images unavailable has not been established. Do not
guess that history or copy the supplied references without reinspection.

There are two independent faults: stale/unavailable pins, and Compose retaining
the base `build` map alongside a digest `image`. Setting `image` in a later file
does not remove `build`. When Compose tries to build/tag that service, it fails
with **`failed to solve: build tag cannot contain a digest`**, before Python runs.
The existing worker and template-refresh unit commands have the same defect.

Before (`docker-compose.yml` + `deploy/docker-compose.release.yml`):

```yaml
services:
  backend:
    image: rk-web-backend@sha256:<reviewed-manifest-digest>
    build:
      context: /opt/apps/rashi-kapoor/rk-web
      dockerfile: Dockerfile.backend
    networks:
      rk-internal: null
```

After adding `-f deploy/docker-compose.worker.yml` last:

```yaml
services:
  backend:
    image: rk-web-backend@sha256:<reviewed-manifest-digest>
    # build is absent in Compose 5.5.0 canonical JSON (equivalent to null).
    networks:
      rk-internal: null
```

The source override uses `build: !reset null`. The real Compose model must satisfy
`backend.get('build') is None`; `{}` is rejected. Both service commands use this
same merged backend model. Network, application `.env`, service settings and
database/encryption guards remain inherited unchanged. The frontend is not run
by either worker service. The normal application build configuration is intact.

Both units retain root, project working directory, named containers, flock locks,
`--rm --no-deps --pull never`, existing timeouts, and bounded Flask commands:

```sh
/usr/bin/flock -E 75 -n /run/lock/rk-whatsapp-worker.lock /usr/bin/docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml -f deploy/docker-compose.worker.yml run --rm --no-deps --pull never --name rk-whatsapp-worker backend python -m flask --app wsgi:app whatsapp-worker
/usr/bin/flock -E 75 -n /run/lock/rk-whatsapp-template-refresh.lock /usr/bin/docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml -f deploy/docker-compose.worker.yml run --rm --no-deps --pull never --name rk-whatsapp-template-refresh backend python -m flask --app wsgi:app whatsapp-template-refresh
```

**These are descriptions of unit commands, not recovery instructions to run now.**
Each now has `ExecStartPre=/usr/bin/python3 scripts/whatsapp_images.py validate
--pins /etc/rk-whatsapp/images.env --require-running`. It reads both merged models
in memory, confirms exact image pins, no backend build, identical network/env/
settings, local image availability, parity with Compose build tags, and parity
with running application containers. A missing/stale pin fails before Flask can
dispatch or refresh anything. Docker operations are inspection/config only.

## Deployment image synchronization and pause prerequisite

The main-push auto-deploy trigger remains. Review/approval must precede a push.
**Because timers currently fire every 30 seconds, an authorized operator must
pause them before deploying the repaired files.** The workflow refuses to proceed
before `git reset` if either timer is active, either service is executing, or a
named worker/refresh container is running. It neither stops nor resumes them.
Alternative schedulers must also be excluded manually. Pausing alone does not
authorize sending; obtain a stable outbox audit before the first execution.

The permissions fix supersedes the original repository-based writer. Before git
changes, the workflow now requires passwordless preflight of the already-installed
`/usr/local/sbin/rk-whatsapp-image-pin-sync`. After base `docker compose build`,
that independent helper's `--sync` operation:

1. Takes both existing flock locks and checks the paused state again.
2. Inspects only the fixed `rk-web-backend:latest` and `rk-web-frontend:latest`
   build identities, without parsing/executing writable repository Compose as
   root. The non-root repository validator separately checks actual base Compose
   JSON/project tags against `docker compose config --images`.
3. Inspects each build's actual `RepoDigests`, selects a matching repository
   digest and inspects that exact digest locally. Its image ID must equal the
   build result. A config image ID is never relabelled as a repository digest.
4. Rechecks images and paused state before commit. No repository code, Compose,
   application `.env` or environment-derived executable is loaded by the helper.
5. Uses a same-directory temporary file, root ownership, mode **0600**, fsync and
   atomic rename to replace only `/etc/rk-whatsapp/images.env`. The directory
   must be root-owned and not group/world writable; symlinks are rejected.
6. Emits only two non-secret image assignments after successful pin replacement.
   The workflow captures them in a deploy-user-owned 0600 temporary file. The
   non-root repository validator checks both merged models and local parity before
   exporting the validated values into the deployment shell. Three-file release
   Compose starts only backend/frontend using those immutable pins with
   `--no-build --pull never`; health and running-image validation follow.

The only new passwordless commands are the exact installed helper with
`--preflight` or `--sync`. No sudo grant for Python, Docker, a shell, install or
repository script is required. A missing helper or sudo denial stops before git
fetch/build. The root-owned helper verifies its own installed path and protected
ancestors and uses isolated Python with only standard-library imports, fixed
executables, clean environment and safe file/lock descriptors. The root pin file
remains 0600; the workflow validates its returned image-only copy as a non-root
user. Application `.env`, keys, all five gates and timers are unchanged. No host
installation, job activation or Meta refresh is performed by deployment.

**No RepoDigest fallback:** classic local Docker builds may have empty
`RepoDigests`. In that case synchronization fails before application replacement
and preserves the old pin file. An operator must provide a reviewed image through
an approved registry/containerd image workflow that yields locally inspectable
repository digests. Registry choice, publishing and pulling are separate approved
operations; this repair invents no registry and performs no push/pull. A mutable
tag, `latest`, fabricated `repository@<image-ID>`, or missing local digest is never
accepted. Keep previous images locally available for rollback.

## Exact recovery procedure (operator authorization required; not executed)

Run these only in the approved maintenance window. Do not paste resolved Compose
configuration, application environment, decrypted messages or unrestricted logs.

1. **Pause before repaired files/pins can be deployed.** On the VPS:

   ```sh
   cd /opt/apps/rashi-kapoor/rk-web
   sudo systemctl stop rk-whatsapp-worker.timer rk-whatsapp-template-refresh.timer
   sudo systemctl stop rk-whatsapp-worker.service rk-whatsapp-template-refresh.service
   systemctl show rk-whatsapp-worker.timer rk-whatsapp-template-refresh.timer -p ActiveState
   systemctl show rk-whatsapp-worker.service rk-whatsapp-template-refresh.service -p ActiveState
   docker ps --format '{{.Names}}'
   ```

   Expected: both timers inactive, services inactive/failed and no named worker or
   refresh container. Privately exclude cron/other hosts/manual workers. Preserve
   timer definitions: no interval or enablement change is part of this repair.
   Preserve a root-only copy of the prior image-only pins and record old image IDs
   before approved deployment; keep `.env` and all existing keys unchanged.

2. **Stable outbox audit.** Use the full read-only metadata/decryption procedure
   under [Safe pending-job audit](WHATSAPP_RELEASE_REVIEW.md#safe-pending-job-audit-operator-procedure-not-executed-here),
   in the running backend. It uses the existing DB guard/key, creates no Flask app,
   claims no job, mutates nothing and emits no payload/recipient. Run it twice
   while all consumers are quiescent, then immediately before any authorized
   execution. Account for concurrent checkout/admin producers: sending controls
   may still enqueue jobs, so a stable/complete audit is a prerequisite, not a
   promise from paused timers. If the full queue cannot be reviewed, stay paused.
   Review each job's age/expiry, current order/payment/event, consent/recipient,
   template evidence and WAMID/claim history privately. Existing eligible old jobs
   **can send**; there is no automatic release cutoff. Preserve held/unknown,
   failed and ambiguous records; do not clear/replay/retag jobs or extend expiry.
   Any exact-ID cancellation/quarantine needs separate authorization. Preserve
   `WHATSAPP_OUTBOX_KEY`, App Secret and related encryption/session keys.

3. **Deploy only after code review and explicit deployment authorization.** The
   existing main workflow does fetch/reset, base build, guarded root pin sync,
   application `up --no-build --pull never`, health check and parity validation.
   On an approved staging host, exercise these same stages with isolated runtime
   configuration and no live data. If no RepoDigest is produced, stop and resolve
   that prerequisite; do not substitute tags. Install/verify the host helper as
   described in the dedicated guide before pushing this workflow. Pre-deployment
   validation compares selected pins to the new builds; post-deployment validation
   also compares them to running containers. In the reported failure, old
   containers still run, so a pre-deployment `--require-running` would correctly
   fail for the new builds. Do not start worker/refresh services in that mismatch.
   For an authorized validation-only inspection after helper installation:

   ```sh
   sudo -n /usr/local/sbin/rk-whatsapp-image-pin-sync --preflight
   python3 scripts/whatsapp_images.py check-paused
   ```

   Expected: helper preflight and paused checks verified. No synchronization,
   application replacement or job execution occurs in those two checks. The
   administrator's installation guide includes root-only pin-file mode checking.

4. **Install and syntax-check reviewed units with timers still paused.**

   ```sh
   sudo systemd-analyze verify deploy/systemd/rk-whatsapp-worker.service deploy/systemd/rk-whatsapp-worker.timer deploy/systemd/rk-whatsapp-template-refresh.service deploy/systemd/rk-whatsapp-template-refresh.timer
   sudo install -o root -g root -m 0644 deploy/systemd/rk-whatsapp-worker.service /etc/systemd/system/rk-whatsapp-worker.service
   sudo install -o root -g root -m 0644 deploy/systemd/rk-whatsapp-template-refresh.service /etc/systemd/system/rk-whatsapp-template-refresh.service
   sudo systemctl daemon-reload
   python3 scripts/whatsapp_images.py check-paused
   sudo -n /usr/local/sbin/rk-whatsapp-image-pin-sync --preflight
   ```

   Expected: unit syntax accepted and both validators verified. Keep existing
   timer files unchanged. Review any installed drop-ins privately: a drop-in can
   override ExecStart; repository unit syntax alone does not prove installed
   effective configuration. Do not reset/start a failed service just for a green
   status. `daemon-reload` loads definitions without activating these units.

5. **Inspect merged JSON safely.** The validator executes both `docker compose
   config --format json` commands and asserts them without exposing environment.
   During an authorized deployment, to display only non-secret effective fields
   as the deploy user using the workflow's validated image-only temporary file:

   ```sh
   python3 - "$pin_file" <<'PY'
   from pathlib import Path
   from scripts.whatsapp_images import read_pins, merged_models
   import sys
   pins = read_pins(Path(sys.argv[1]))
   release, worker = merged_models(pins)
   import json
   print(json.dumps({
       'backendImage': worker['services']['backend']['image'],
       'frontendImage': worker['services']['frontend']['image'],
       'backendBuild': worker['services']['backend'].get('build'),
       'backendNetworks': list(worker['services']['backend']['networks']),
       'frontendNetworks': list(worker['services']['frontend']['networks']),
       'environmentUnchanged': release['services']['backend']['environment'] == worker['services']['backend']['environment'],
   }))
   PY
   ```

   Expected: both reviewed repository digests; `backendBuild=null`; each network
   list exactly `rk-internal`; `environmentUnchanged=true`. Do not print the full
   models. For Linux staging regression coverage run `(cd backend && python3 -m
   pytest -q tests/test_whatsapp_worker_images.py)` using installed Compose 5.5.0.

6. **First refresh/worker execution is a separate approval.** After pin/parity,
   key continuity and stable backlog audit pass, an authorized admin may use the
   existing guarded inventory refresh in Admin Studio. Alternatively a privileged
   operator may start the template-refresh service only with explicit approval;
   it reads Meta inventory/cache and sends no messages. Deployment does neither.
   Recheck expiry/approval/consent/provider eligibility before any messaging
   authorization. Only then may the operator execute the approved bounded worker
   or resume its existing timer. No start command is included in the automatic
   deployment path. Confirm real outcomes from signed receipts; accepted/exit 0
   alone does not establish customer delivery.

   Only after that separate authorization, the exact existing service operations
   are shown below. The worker start can dispatch every currently eligible job in
   its bounded batch; it is not an inspection command or a one-recipient test.
   Choose only the authorized operation, rather than executing this block as a
   combined recovery script:

   ```sh
   # Authorized inventory refresh only (Meta GET/cache write, no customer send):
   sudo systemctl start rk-whatsapp-template-refresh.service
   # Separately authorized bounded live worker execution, AFTER stable job audit:
   sudo systemctl start rk-whatsapp-worker.service
   # Resume only the timer(s) that the operator separately approved:
   sudo systemctl start rk-whatsapp-worker.timer
   sudo systemctl start rk-whatsapp-template-refresh.timer
   ```

   After the approved operation, inspect safe status metadata with
   `systemctl show rk-whatsapp-worker.service -p Result -p ExecMainStatus` and the
   corresponding refresh unit. Expected successful bounded process exit: 0.
   Inspect any error journal privately and stop on a new failure. No start/resume
   operation was performed during this task.

**Rollback:** remain paused; preserve jobs, claims and keys. Select previously
reviewed locally available backend/frontend digest references, replace the
image-only file atomically under root ownership using the same validation
standard, and restore application containers with the three-file Compose command
above using `--no-build --pull never`. Verify health, keys, effective models and
running image parity. If base mutable build tags now point at a different candidate,
restore those tags to the reviewed rollback images before validation; do not
bypass the parity check. Do not restore a DB snapshot over message idempotency
history. Resume only after a new stable audit and separate authorization.

## Final local worker-repair validation (17 November)

| Check | Result and evidence boundary |
| --- | --- |
| Full backend suite, exact final implementation | **636 passed, 2 skipped**, two existing mongomock deprecation warnings. Skips: Nginx unavailable and Linux-only root/file-permission check. |
| Worker-image + existing worker/template-refresh + release tests | **80 passed, 1 Linux-only skip**. Included in full suite as well. |
| Actual Compose merge / generated build tags | Passed with official checksum-verified **Compose v5.5.0** Windows binary, isolated synthetic `.env`, real `config --format json` and `config --images`. Canonical worker backend build is absent/null, pins/networks/env preserved. No Docker daemon involved. |
| Image availability/parity/failure regression | Mocked local Docker inspections cover missing RepoDigest, uninspectable digest, wrong repository/image, stale pins, running image mismatch, and safe failure without replacing pins. Actual host/image acceptance remains required. |
| Systemd command/config regression | Both unit command paths checked: third override, Flask command, flock, no-deps, pull-never, names, user, working directory, timeout and image preflight. **Native systemd-analyze unavailable on Windows/WSL absent**; run the exact Linux verify command above before installation. |
| Workflow syntax | YAML parsed and extracted deployment shell passed Git Bash `bash -n`; no remote script was executed. |
| Frontend Node suite | **158 passed, 1 pre-existing failure** in `homepage-editorial-refinement.test.mjs`. Isolated committed HEAD reproduces 3 pass/1 fail; all seven test/source inputs match HEAD after newline normalization. Homepage work untouched. |
| WhatsApp browser suite | **58 passed** against the rebuilt production frontend with mocked backend/Meta requests. |
| TypeScript and production frontend build | Passed; **63 static pages** generated. |
| Git/build-context secret scans and whitespace | No findings; `git diff --check` passed (Git emits existing LF/CRLF notices). |
| Production/daemon acceptance | Not performed. No SSH, protected file update, image build on VPS, unit/timer execution, queue mutation, Meta refresh or customer message. |

The eight files changed for this worker repair are `.github/workflows/deploy.yml`,
`deploy/docker-compose.worker.yml`, both WhatsApp `.service` files,
`deploy/whatsapp-images.env.example`, `scripts/whatsapp_images.py`,
`backend/tests/test_whatsapp_worker_images.py`, and this report. Earlier diagnostic
changes in the working tree remain preserved. No application configuration,
runtime encryption code, mappings, sending gate or timer definition was edited.
The existing tracked `whatsapp-production-test-mode.patch` is unchanged (SHA-256
`BB10EBA2073C396DA009F9106DEA48F54B497A4886E2B8FECE7D5E6070BAF866`). Nothing is staged,
committed, pushed or deployed.

## Image-pin deployment permissions repair

The operator reports the application containers were not replaced after the
failed passwordless Python command. Built digests are available:
`rk-web-backend@sha256:c62c7c4ee901908789d55da62928b8b83f911f2d19ef1a97e8b1f99c657201a5`
and `rk-web-frontend@sha256:68f50d38a01ff1cb13e693fb03387a554f2f70a5c08aaa1f7eed05fafcffc821`.
Old running image IDs start `f44a5e618cba` and `6366b2b5dec8`. These are supplied
observations, not a fresh VPS inspection; they are not hardcoded into deployment.

The least-privilege correction is implemented locally on **main**, without a
feature branch. The helper's reviewed executable and its exact two-command
sudoers fragment must be installed by the administrator before this workflow is
pushed. [WHATSAPP_IMAGE_PIN_HELPER.md](WHATSAPP_IMAGE_PIN_HELPER.md) contains the
complete security design, candidate hashes, transfer/install/visudo commands and
passwordless verification sequence. Repository Python has no privileged writer
or `sync` CLI operation. All repository Compose/image validation runs as the
non-root deploy account. The helper returns two non-secret pins so 0600 access to
the protected host file need not be relaxed.

The workflow's first privileged operation is exact helper `--preflight`, before
fetch/reset/build. Only that helper's `--sync` can replace the root-owned image
file. Both commands check paused units and locks; sync validates local image
identities and uses atomic replacement. Non-root validation runs before
application replacement and after the health check. Application `up` now uses
all three Compose files with exported verified pins, so it deploys the immutable
images rather than falling back to the base mutable build tags. Timers, services
and Meta refresh remain untouched by deployment.

Changed files for this permission fix:

- `.github/workflows/deploy.yml`
- `.gitattributes` (LF only for the two host-installable files)
- `deploy/host/rk-whatsapp-image-pin-sync`
- `deploy/sudoers/rk-whatsapp-image-pin-sync`
- `deploy/whatsapp-images.env.example`
- `scripts/whatsapp_images.py`
- `backend/tests/test_whatsapp_host_helper.py`
- `backend/tests/test_whatsapp_worker_images.py`
- `docs/WHATSAPP_IMAGE_PIN_HELPER.md`
- `docs/WHATSAPP_FINAL_PRODUCTION_READINESS.md`

Final local validation against the permission-fix implementation:

| Check | Result |
| --- | --- |
| Complete backend suite | **686 passed, 2 skipped**, two existing mongomock warnings. Skips: unavailable Nginx runtime and native Linux directory-fd/ownership acceptance. |
| Host helper, worker-image and workflow regression subset | **73 passed, 1 native Linux skip**, included in the full suite. Includes simulated missing/denied helper and sync failure stopping application replacement. |
| Actual Compose v5.5.0 configuration | Passed with the checksum-verified official local binary and synthetic `.env`; existing merge/digest/network/environment protections retained. |
| Workflow YAML and extracted shell | Parsed; Git Bash `bash -n` passed. Helper Python syntax parsed without running host operations. |
| Git/build-context secret scans | No findings (367 Git candidate files, 322 modeled build-context files). |
| Whitespace | `git diff --check` passed; only Git LF/CRLF notices. |
| Native sudoers/host acceptance | Not executed: `visudo`, installed ownership/ACL/lock checks and Linux filesystem acceptance remain administrator prerequisites. |
| Frontend | No frontend files changed; earlier frontend results above are historical and were not rerun for this deployment-only repair. |

No new sudo privilege or host installation was applied during this task. No
application environment, key, gate, outbox, index, Admin Order Control, Meta
setting or timer definition changed. The existing patch file remains untouched.
Nothing is staged, committed or pushed. Do not claim the worker runs or delivery
works from these local tests.

Meta references: [WABA business verification, health and messaging-limit fields](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account), [Phone Number status and code verification](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers), [Cloud API registration](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration), [Health Status](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/health-status), [App Subscriptions](https://developers.facebook.com/docs/graph-api/reference/app/subscriptions).

Docker references: [Compose merge/reset semantics](https://docs.docker.com/reference/compose-file/merge/), [local image inspection](https://docs.docker.com/reference/cli/docker/image/inspect/).
