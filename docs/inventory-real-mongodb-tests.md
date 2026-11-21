# Real MongoDB inventory safety tests

The inventory recovery integration suite is opt-in and uses a **real MongoDB server**. It never falls back to MongoMock. Without `RK_INVENTORY_TEST_MONGODB_URI`, these tests report as skipped during ordinary pytest runs.

## Isolated local setup

Use a disposable local MongoDB container and a fresh database name for each run. Docker must be installed locally; no repository Compose services are used.

PowerShell terminal 1:

```powershell
docker run --rm --name rk-inventory-mongo-test `
  -p 127.0.0.1:27018:27017 `
  mongo:7.0.16
```

PowerShell terminal 2, from the repository root:

```powershell
$env:RK_INVENTORY_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/rk_inventory_test_localabcd12?directConnection=true'
Set-Location backend
python -m pytest -s -m real_mongodb tests/integration
```

The image version is pinned for repeatability; the suite prints the actual server version returned by MongoDB. Use a new suffix matching `rk_inventory_test_<8-64 lowercase letters, digits, underscores, or hyphens>` for a distinct test database. The runner binds only to loopback.

For an isolated remote staging MongoDB instance, keep the database name in the same disposable `rk_inventory_test_*` namespace, provide the URI through the shell's protected environment mechanism, and set `RK_INVENTORY_TEST_ALLOWED_HOST` to the exact URI hostname. Remote targets without that second host assertion fail before a `MongoClient` is created. Production-like hostnames, production-like database names, multi-host URIs, and other database names are rejected. Never point this suite at a database containing customer or production data.

## Safety and cleanup

The fixture verifies MongoDB with `ping`, `hello`, and `buildInfo`/server version before yielding the client. It prints only the server version and never prints the URI. Test orders, products, test staff identities, operation records, notification activity, and webhook event IDs use fresh identifiers. Teardown deletes only records tracked by the current test run and exact order/product/event IDs; it does not drop a database or clear a collection. An abruptly terminated parent process can leave isolated test records behind, so use a fresh disposable database name for the next run rather than broad cleanup.

The tests use a synthetic Razorpay webhook signing key and local Flask test clients. SMTP and WhatsApp transports are mocked or gated off. The suite does not start background workers, contact Razorpay/Meta/SMTP, send messages, create payment requests, or access production systems.

## Covered scenarios

- Manual order reservation, release, safe retry, and process death after each product write.
- Razorpay capture with multiple products; concurrent duplicate signed webhook requests against MongoDB; and webhook redelivery from a fresh Python process after another process exits.
- Process termination after each capture product write, after product writes but before order completion, and during each compensation product update.
- Concurrent staff reconciliation, duplicate recovery requests, and retry after a verified complete operation.
- Missing, duplicate/conflicting, wrong-capture, wrong-claim, wrong-quantity, and stale-claim evidence. Conflicting ledger claim ownership is rejected; missing projections can be reconstructed only from matching atomic product proof.
- Fulfilment, email, and WhatsApp notification suppression while capture is processing or held.
- Parent-size, variant-only, variant-and-size, multiple items/variants on one parent, duplicate operations and insufficient stock. The new races synchronize both stale reads immediately before their first competing product writes, then verify stock and marker conservation.
- Reservation A released, reservation B established, then A's stale rollback rejected without altering B. Releasing B after historical markers must compensate exactly B's marker, and repeated release cannot restore stock twice.
- Closed capture recovery and cancellation racing the final conditional recovery write. Partial/full refunds cannot be promoted to paid through recovery.
- Concurrent append-only warehouse investigations, linked corrections, authorization and operation/order binding. These records do not adjust stock, unblock fulfilment or send notifications.

Run the complete backend suite separately with `python -m pytest`. Real MongoDB tests remain skipped unless the explicit URI is set. The opt-in suite has not been run merely by running the mocked suite.

## Reproducible validation commands

From `backend`, with the disposable URI set as above:

```powershell
python -m pytest -q tests/integration
python -m pytest -q tests/integration tests/test_inventory_crash_harness.py tests/test_inventory_mongodb_safety.py tests/test_whatsapp.py::WhatsAppTests::test_rate_limit_retries_are_bounded tests/test_whatsapp_checks.py::test_manual_test_rechecks_provider_proofs_before_dispatch_and_retry tests/test_whatsapp_display_name.py::test_name_status_change_during_retry_blocks_second_dispatch tests/test_whatsapp_order_mode.py::test_order_dispatch_rechecks_after_provider_backoff tests/test_whatsapp_production_test.py::test_restrictions_rechecked_after_retry_backoff
```

For the ordinary suite, unset only this test-process opt-in, then run:

```powershell
Remove-Item Env:RK_INVENTORY_TEST_MONGODB_URI -ErrorAction SilentlyContinue
python -m pytest -q
```

The combined full suite is also supported with the URI set. Retry tests now patch
the retry module's `retry_sleep` reference, leaving PyMongo's global `time.sleep`
untouched. Separate commands remain useful for distinguishing real database
results from mocked-provider coverage; they are no longer a workaround for
background-thread interference. The fixture closes the client deterministically.

Frontend commands, from `frontend`: `npm test`, `npm run typecheck`, `npm run build`,
then `npx playwright test` (uses the local built frontend and mocked APIs).

The synthetic staff JWT key is at least 32 bytes. No production JWT, SMTP,
Razorpay, WhatsApp or MongoDB credentials are used by these local tests. Real
MongoDB 7.0.16 is a standalone test instance, not proof of replica-set failover or
production/provider behaviour. Final counts are recorded in
`order-refund-notification-safety.md` after validation.
