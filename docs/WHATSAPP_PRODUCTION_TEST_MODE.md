# Restricted temporary production template tests

Implemented locally; no production environment, Meta settings or messaging gates were changed. The mode defaults off. This does not authorize deployment or a real send.

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

To end a separately authorized test window, turn the new flag off and remove its recipient/expiry through the approved runtime configuration process. No admin toggle can enable or extend it. Do not copy local environment files onto the server. The ordinary disabled-release readiness and index-maintenance commands refuse an enabled temporary production flag; conduct those operations with all sending gates off. This narrow test mode does not satisfy outstanding deployment, webhook, WABA subscription or production-readiness blockers documented in the audits.

Automated tests mock every Meta request and use an in-memory database. Run from `backend/`: `python -m pytest -q`. Run from `frontend/`: `npm run typecheck`, `npm run build`, then `npm run test:whatsapp-ui`.

Local validation on 2026-11-15 after enforcing the maximum window: full backend **498 passed, 1 skipped**, with two existing mongomock deprecation warnings; the skip is the real Nginx test because Nginx is unavailable. WhatsApp browser suite **46 passed**. TypeScript and the production build passed (62 generated pages). The frontend Node suite retains the pre-existing homepage assertion expecting contiguous `Where the art of` across a `<br />`; its test and component both match HEAD. Git whitespace and secret-content scans passed. No real Meta requests, production environment edits, commits, pushes or deployments were performed for this change.
