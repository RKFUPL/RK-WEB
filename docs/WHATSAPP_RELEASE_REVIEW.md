# WhatsApp checkout repair: final release review

**Historical observations below.** See [the final production readiness report](WHATSAPP_FINAL_PRODUCTION_READINESS.md) for later 17 November reads: business verification VERIFIED, CONNECTED sender with conflicting OTP-code status, tier 250, phone health LIMITED, worker failed/exit 1, current worker image/key parity unverified, fresh app-level subscription confirmed, provider prerequisites and current validation. Earlier worker success is not current proof.

Review base: `ce01b83` (the committed privacy/deletion release). The checkout
repair remains uncommitted. This includes local validation and a subsequent
authorized read-only VPS/Meta inspection on 16 November 2026. It is not a claim
that live delivery has been verified.

## Verified evidence and remaining blockers

| Check | Result |
| --- | --- |
| Worker definition | `deploy/systemd/rk-whatsapp-worker.service` runs `python -m flask --app wsgi:app whatsapp-worker` in a one-off backend container, with flock and a fixed container name. |
| Timer definition | `rk-whatsapp-worker.timer`: 2 minutes after boot, then 30 seconds after the previous service becomes inactive. A completed oneshot service can correctly be inactive while its timer is active. |
| Actual VPS scheduler | **Confirmed by SSH.** Both worker and template-refresh services are installed under `/etc/systemd/system`; both timers are enabled. The worker timer is active, with the actual 2-minute boot and 30-second inactive intervals. An existing worker container was observed running. Last observed trigger: 16 November 2026 11:37:28 UTC. |
| Default Compose/Docker startup | Only backend Gunicorn and frontend are started. There is no worker service in base Compose and no worker subprocess in the backend Docker CMD. |
| CI deployment | `.github/workflows/deploy.yml` rebuilds/restarts base Compose on a main push. It does not install the systemd units or synchronize `/etc/rk-whatsapp/images.env`. |
| Worker image parity | **Current parity confirmed:** the existing worker and web backend use `sha256:9ac5d6acbf1ea259dc2316cfa66edc0fe4ac0b50c13ab47556ad55fa6409ada3`. Both expected worker/refresh CLI commands, release override and flock were confirmed from the installed service commands without rendering environment values. Candidate-image parity still needs checking before the next release because CI does not synchronize `images.env`. |
| Secret continuity | **Current backend/worker equality confirmed in memory:** outbox, App Secret, WorkDrive encryption, application and JWT keys are present and identical. `SHARED_SESSION_INTERNAL_SECRET` is absent in both container environments. No values or key hashes were printed. **Candidate/resolved-host-environment equality remains unverified:** `images.env` is protected and this SSH account has no noninteractive sudo. No key was generated or rotated. |
| Existing backlog | **Stable audit still blocked by the active worker.** The audit procedure below was not executed against live jobs. Unexpired, still-authorized pending jobs can send in the existing worker. Deployment is not a backlog release approval. An authorized pause is needed before a stable audit; this review did not stop production services. |
| Webhook public GET | Read-only public checks returned `/api/health` HTTP 200 and `/api/webhooks/whatsapp` HTTP 403 with `Forbidden` for an unverified GET. These match the expected backend behavior; they do not prove valid challenge or signed receipt delivery. |
| Signed webhook implementation | GET compares `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; POST requires HMAC-SHA256 over the exact raw body using `WHATSAPP_APP_SECRET`, rejects missing/invalid signatures before DB processing, limits body size, and scopes events to the configured WABA and Phone Number ID. |
| Meta subscription | **Read-only Meta GETs confirmed** the configured app is subscribed to the WABA and the configured Phone Number ID belongs to it. A fresh inventory contained 19 templates; `rk_order_confirmation` was `APPROVED`, `en_US`, `UTILITY`, with matching components and quality `UNKNOWN`. The phone returned quality `GREEN` but `codeVerification=NOT_VERIFIED`, which needs operator investigation. App-level callback/`messages` verification remains unverified because an app access token was not available to the audit. |
| Protected host evidence | System journal access, protected `images.env` and privileged cron inspection were unavailable without sudo. No worker entries were found in the readable standard `/etc/cron.d`, `/etc/cron.daily` or `/etc/cron.hourly` paths. This does not prove there is no other private scheduler. No privilege bypass was attempted. |
| Local Linux/Docker acceptance | Docker is unavailable on this Windows host. Image build/runtime checks and actual systemd validation must run on the approved staging/Linux host. |
| Frontend suite | One homepage copy assertion also fails at the isolated base revision. It is not introduced by the repair. Fix separately or obtain an explicit release waiver. |

No worker was started or stopped by this review; the pre-existing worker remained
active. No production secrets/gates were changed, no messages were initiated by
this review, and no Meta settings were changed. The existing runtime environment
reported the restricted order gate `true`; general messaging, development tests,
marketing and temporary production testing were all `false`. These existing values
were observed only. Private recent worker outcome logs could not be inspected, so
this review does not assert that the independently running worker sent zero jobs.

## Outbox findings

The worker only claims `pending` jobs whose `expiresAt` is in the future and whose
retry time is due. Restricted order mode additionally requires a permitted event
and `orderNotification=true`. The encrypted payload must contain the matching
business-event identity and order ID; an outer tag alone is insufficient.

Before dispatch and after backoff it reloads the order/customer, checks payment
and event proof, exact recipient, consent, STOP suppression, template mapping,
fresh approval and components, and lease/claim authority. Expired, changed-recipient,
withdrawn-consent and cancelled-order regression tests make no provider call.
Existing accepted/sent/delivered/read claims are not resent. Ambiguous dispatches
are held; only explicit rate-limit rejection receives bounded automatic retries.

**There is no deployment cutoff or automatic backlog quarantine.** A job created
12 hours ago can still send if unexpired and eligible. `order_confirmation` allows
later confirmed fulfilment states and a `shipped` event can remain valid after the
order advances. Thus “obsolete” in the operational sense is not fully determined
by the business-state checks. Do not start/enable an eligible live worker to audit
it, and do not claim all old jobs are automatically suppressed.

### Safe pending-job audit (operator procedure, not executed here)

First establish that all worker services, containers and alternate schedulers are
already inactive and sending is disabled. If any are active, stop this procedure
and obtain separate authorization to suspend them; the commands below do not stop
or reconfigure them. Audit a stable queue, rerun immediately before any separately
authorized activation, and review all pre-existing jobs. Do not mass-reset states,
extend expiry, retag legacy jobs, delete idempotency/consent history, or replay
held/unknown/sending outcomes. A populated queue is a review result, not permission
to dispatch. Any quarantine/cancellation requires a separate exact-ID operation.

From `/opt/apps/rashi-kapoor/rk-web` on the approved VPS, this reads the running
backend's existing environment and MongoDB, without creating a Flask application,
claiming jobs, modifying documents, printing payloads or contacting Meta:

```sh
docker exec -i rk-backend python - <<'PY'
import json
from datetime import datetime, timezone
from cryptography.fernet import Fernet
from pymongo import MongoClient
from app.config import ProductionConfig, validate_database_maintenance_target

try:
    config = {key: getattr(ProductionConfig, key) for key in dir(ProductionConfig) if key.isupper()}
    target = validate_database_maintenance_target(config, config.get('WHATSAPP_EXPECTED_DATABASE'))
    cipher = Fernet(config['WHATSAPP_OUTBOX_KEY'].encode())
    client = MongoClient(config['MONGO_URI'], tz_aware=True, serverSelectionTimeoutMS=5000)
    db = client[target]
    checked = datetime.now(timezone.utc)
    states = ['pending', 'processing', 'held', 'unknown']
    query = {'status': {'$in': states}}
    count = db.whatsapp_outbox.count_documents(query)
    rows = db.whatsapp_outbox.find(query, {
        '_id': 1, 'status': 1, 'createdAt': 1, 'expiresAt': 1,
        'orderNotification': 1, 'payload': 1,
    }).sort('createdAt', 1).limit(1000)
    summary = []
    for row in rows:
        decryptable = False
        try:
            decoded = json.loads(cipher.decrypt(row.get('payload', '').encode()))
            decryptable = isinstance(decoded, dict)
            del decoded  # Never render recipient, parameters, OTP or ciphertext.
        except Exception:
            pass
        expiry = row.get('expiresAt')
        summary.append({
            'jobId': str(row['_id']), 'status': row['status'],
            'createdAt': row.get('createdAt'), 'expiresAt': expiry,
            'expiredOrMissingExpiry': not expiry or expiry <= checked,
            'orderNotification': row.get('orderNotification') is True,
            'payloadDecryptable': decryptable,
            'dispatchAuthorizedByAudit': False,
        })
    print(json.dumps({'checkedAt': checked, 'totalReviewJobs': count,
                      'truncated': count > 1000, 'jobs': summary}, default=str))
    client.close()
except Exception:
    print(json.dumps({'audit': 'blocked', 'reason': 'configuration_or_database_audit_failed'}))
    raise SystemExit(1)
PY
```

Expected: a bounded metadata-only inventory. If `truncated=true`, do not approve
the queue from this sample; use an approved complete read-only review. If payload
decryption fails, preserve the original key/ciphertext and reconcile privately.
Do not replace the key to make the audit pass. Even `totalReviewJobs=0` is only a
point-in-time observation; continue to keep all workers/gates disabled.

For each reviewed job, privately trace its encrypted order ID/business-event key
to the current order, compare the exact order recipient and consent with the job,
review current template evidence and payment/event authority, and check the message
claim/WAMID. Do not print decrypted payloads in a support log. Freshness, consent
or business-event failures must not be bypassed to clear a backlog.

## Secret preservation

`WHATSAPP_OUTBOX_KEY` is the Fernet encryption key. `WHATSAPP_APP_SECRET` also keys
recipient HMACs, STOP/suppression bindings and deduplication scope; changing it is
not merely a webhook secret update. Preserve both. Also preserve
`ZOHO_WORKDRIVE_TOKEN_ENCRYPTION_KEY`, `SECRET_KEY`, `JWT_SECRET_KEY` and
`SHARED_SESSION_INTERNAL_SECRET` where configured. The WorkDrive key protects
stored refresh tokens; JWT/session secrets protect existing sessions.

Base Compose injects the existing host `.env` at runtime. The release Compose
override changes image references only. `.dockerignore` excludes environment files
and the backend Dockerfile copies only requirements, app source and `wsgi.py`.
The current workflow performs no key rotation and does not remove ignored `.env`
files. This establishes preservation by design, not actual production equality.

Before replacement, compare the current container environment to the fully
resolved candidate Compose environment **inside Python memory**. Do not run a
plain `docker inspect` or `docker compose config` into a shared log; both can
contain credentials. With the approved image references already selected:

```sh
python3 - <<'PY'
import hmac, json, subprocess
try:
    current = json.loads(subprocess.check_output(['docker', 'inspect', 'rk-backend']))[0]
    before = dict(value.split('=', 1) for value in current['Config']['Env'] if '=' in value)
    projected = json.loads(subprocess.check_output([
        'docker', 'compose', '-f', 'docker-compose.yml', '-f',
        'deploy/docker-compose.release.yml', 'config', '--format', 'json']))
    after = projected['services']['backend']['environment']
    names = ['WHATSAPP_OUTBOX_KEY', 'WHATSAPP_APP_SECRET',
             'ZOHO_WORKDRIVE_TOKEN_ENCRYPTION_KEY', 'SECRET_KEY',
             'JWT_SECRET_KEY', 'SHARED_SESSION_INTERNAL_SECRET']
    result = {}
    for name in names:
        old, new = str(before.get(name) or ''), str(after.get(name) or '')
        required = name in {'WHATSAPP_OUTBOX_KEY', 'WHATSAPP_APP_SECRET', 'SECRET_KEY', 'JWT_SECRET_KEY'}
        result[name] = {'presentBefore': bool(old), 'presentAfter': bool(new),
                        'unchanged': hmac.compare_digest(old.encode(), new.encode()) and (bool(old) or not required)}
    print(json.dumps(result))
    raise SystemExit(0 if all(row['unchanged'] for row in result.values()) else 1)
except (subprocess.SubprocessError, ValueError, KeyError, TypeError):
    print('{"secretContinuity":"comparison_unavailable"}')
    raise SystemExit(1)
PY
```

Expected: every `unchanged` is true, required keys present, and the outbox audit
can decrypt existing retained payloads. Preserve the same protected environment
source throughout deployment and rollback. No keys, hashes or values are printed.
Stop if any value differs; investigate with the authorized secret owner.

## Staging-to-production checklist

These are operator instructions for a separately approved deployment. Nothing in
this review authorizes activation, running a live worker, or changing Meta.

1. **Review and pin the candidate.** The repair is uncommitted; review it before
   preparing immutable candidate/rollback image references. Do not push to main
   as a testing action: its workflow deploys automatically. On the approved Linux
   staging host, build from the reviewed tree (no production `.env` in build context):

   ```sh
   read -r -p 'Reviewed backend image reference: ' RK_BACKEND_IMAGE
   read -r -p 'Reviewed frontend image reference: ' RK_FRONTEND_IMAGE
   export RK_BACKEND_IMAGE RK_FRONTEND_IMAGE
   docker build -f Dockerfile.backend -t "$RK_BACKEND_IMAGE" .
   docker build -f Dockerfile.frontend -t "$RK_FRONTEND_IMAGE" .
   docker run --rm --network none --entrypoint python "$RK_BACKEND_IMAGE" -c 'import dns.resolver, phonenumbers; from cryptography.fernet import Fernet; print("runtime imports: ok")'
   ```

   Expected: successful images/runtime imports. Record immutable image IDs for
   both reviewed candidates and both currently deployed images. Tests must use
   mocks or the approved isolated staging database, never production records.

2. **Run local/staging validation from the candidate tree.**

   ```sh
   (cd backend && python -m pytest -q)
   (cd frontend && npm ci && npm test)
   (cd frontend && npm run typecheck && npm run build && npm run test:whatsapp-ui)
   python scripts/audit_release_context.py --git
   python scripts/audit_release_context.py
   git diff --check
   ```

   Expected: backend/browser/type/build checks pass. The known base homepage
   failure must have an explicitly accepted waiver or a separate reviewed fix;
   do not report the entire frontend suite as green. Secret scans report no
   new findings; reconcile any pre-existing untracked patch finding separately.

3. **Inspect the actual VPS without starting anything.**

   ```sh
   cd /opt/apps/rashi-kapoor/rk-web
   sudo systemctl show rk-whatsapp-worker.service -p LoadState -p FragmentPath -p ActiveState -p SubState -p Result -p ExecMainStatus
   sudo systemctl show rk-whatsapp-worker.timer -p LoadState -p FragmentPath -p ActiveState -p UnitFileState -p NextElapseUSecMonotonic
   sudo systemctl list-timers --all 'rk-whatsapp*'
   docker ps -a --filter name=rk-whatsapp --format '{{.Names}} {{.Image}} {{.Status}}'
   docker inspect --format '{{.Config.Image}} {{.Image}}' rk-backend
   sudo grep -Rl --fixed-strings 'whatsapp-worker' /etc/cron.d /etc/cron.daily /etc/cron.hourly /var/spool/cron 2>/dev/null || true
   ```

   Expected: actual worker installation/state/image evidence, including any
   alternate scheduler. `not-found` means the service is not installed, not that
   a scheduler exists. Review protected unit definitions/overrides privately to
   verify the expected command and project directory; do not paste environment
   values into the report. Do not start units to see what happens.

4. **Establish a disabled deployment window.** Verify all five send gates are
   false and that no existing worker is active. If not, stop the release and
   obtain separate operational authorization; do not alter gates under this
   checklist. A safe runtime flag check (no secret output or Flask application):

   ```sh
   docker exec -i rk-backend python - <<'PY'
   import json
   from app.config import ProductionConfig
   names = ['WHATSAPP_ENABLED', 'WHATSAPP_ORDER_NOTIFICATIONS_ENABLED',
            'WHATSAPP_TEST_SEND_ENABLED', 'WHATSAPP_MARKETING_ENABLED',
            'WHATSAPP_PRODUCTION_TEST_SEND_ENABLED']
   states = {name: getattr(ProductionConfig, name, None) is False for name in names}
   print(json.dumps({'allSendingGatesOff': all(states.values()), 'off': states}))
   raise SystemExit(0 if all(states.values()) else 1)
   PY
   ```

   Run the pending-job and secret-continuity audits above. Backlog review,
   non-decryptable data, active workers or changed keys block activation/release.
   Preserve protected environment backups under the existing approved process.

5. **Resolve image parity before replacement.** Verify the approved candidate
   backend image is also the one selected by `/etc/rk-whatsapp/images.env` for
   the worker/refresh services. The current main workflow does not do this. Any
   file update requires the separate deployment authorization; no change was made
   by this review. Select/export the same approved image references on the VPS
   using step 1's prompts; staging-shell exports do not carry across hosts.
   A stale pinned worker must remain inactive. Validate unit syntax
   on Linux without installation or start:

   ```sh
   sudo systemd-analyze verify deploy/systemd/rk-whatsapp-worker.service deploy/systemd/rk-whatsapp-worker.timer deploy/systemd/rk-whatsapp-template-refresh.service deploy/systemd/rk-whatsapp-template-refresh.timer
   ```

6. **Deploy the approved disabled images only after these preconditions pass.**

   ```sh
   docker image inspect --format '{{.Id}}' "$RK_BACKEND_IMAGE" "$RK_FRONTEND_IMAGE"
   docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml up -d --no-build --pull never --no-deps backend frontend
   curl -fsS http://127.0.0.1:5000/api/health
   curl -fsS https://rashikapoor.co.in/api/health
   curl -sS -o /dev/null -w '%{http_code}\n' https://rashikapoor.co.in/api/webhooks/whatsapp
   docker compose -f docker-compose.yml -f deploy/docker-compose.release.yml exec -T backend python -m flask --app wsgi:app whatsapp-check --production
   docker exec rk-backend sh -c 'python -m flask --app wsgi:app whatsapp-indexes --database "$WHATSAPP_EXPECTED_DATABASE"'
   ```

   Expected: health 200, unverified webhook GET 403, readiness `ready=true` with
   every send gate off, and the read-only index check reports no missing/conflicting
   indexes. No `--apply` is included. Recheck runtime flags, actual image IDs and projected
   secret equality after replacement. No `whatsapp-worker` invocation, timer start,
   production enqueue or success-page notification test is part of this deployment.

7. **Read-only Meta and webhook acceptance.** With authorized server-side
   credentials, `python -m flask --app wsgi:app whatsapp-provider-audit` reads
   WABA membership, sender and inventory. Inside the container use:

   ```sh
   docker exec rk-backend python -m flask --app wsgi:app whatsapp-provider-audit
   ```

   Expected: `wabaSubscription.configuredAppSubscribed=true`,
   `phone.configuredPhoneBelongsToWaba=true`, exact approved template/language and
   components. App-level callback/field inspection needs an existing app-token
   environment variable name via `--app-token-env`; do not create/expose a token
   for this review. Missing app-token access leaves that check unverified.
   `appWebhook.productionCallback` and `messagesField` must both be true for the
   **same active subscription**. Live dashboard verification and a later controlled
   signed-receipt test remain separate, without editing Meta or sending customers
   a message as part of this checklist. Publishing, activation and actual live
   delivery acceptance require separate authorization.

8. **Rollback, if required.** Keep workers/gates inactive, preserve `.env`, all
   encrypted payloads, audit/consent/STOP/deduplication records and indexes. Select
   the recorded rollback backend/frontend image references and repeat step 6's
   `up --no-build --pull never` and health checks. Keep pinned worker images aligned
   but inactive. Do not restore/drop the database, rotate keys or replay jobs.

## Base failure and validation record

The homepage test and all six source files it reads are identical to `HEAD`
(`ce01b83`) after CRLF/LF normalization. An isolated temporary fixture containing
only `git show HEAD:<file>` copies ran `node --test` and produced **3 passed,
1 failed**, with the same `/Where the art of/` assertion. The base source contains
`Where the <br /> art of draping meets...` and `timeless<br/> luxury.`; a regex over
raw JSX does not normalize that markup. The WhatsApp repair changed neither file.
No homepage test or source was edited to hide the failure.

The new regression verifies signed `read` as the first/only receipt, duplicate
idempotency, exact WAMID/order correlation and the admin API's
`deliveryReceiptStatus=confirmed_by_read_receipt`, `readReceiptStatus=received`.
It does not fabricate `deliveredAt`. A browser regression checks that the final
log shows delivery confirmed by the read receipt and its unavailable exact
delivery timestamp. Another regression rejects combining a correct callback
entry with a different entry's `messages` field.

The review changes only `backend/app/whatsapp_provider.py`, adds
`backend/tests/test_whatsapp_release_review.py`, adds the browser regression in
`frontend/tests/whatsapp-ui.spec.ts`, and updates these two repair/release reports.
All earlier repair changes remain intact; the untracked
`whatsapp-production-test-mode.patch` remains untouched.

Final validation against the combined working tree:

- Backend: **574 passed, 1 skipped**, two existing mongomock deprecation warnings.
- Frontend node: **158 passed, 1 failed** (the independently reproduced base
  homepage assertion above).
- TypeScript: passed.
- Production frontend build: passed, all 63 static pages generated.
- Python application/test and checklist-snippet syntax: passed.
- Repository secret scan: 354 files, no findings. Modeled Docker build context
  secret scan: 313 files, no findings. This is not an actual Docker image scan.
- Whitespace: passed.
- WhatsApp browser suite: **52 passed**, including read without delivered and the
  final log's delivery-confirmed-by-read wording. All provider/API routes are mocked.
