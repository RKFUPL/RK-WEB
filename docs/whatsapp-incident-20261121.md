# Read-only WhatsApp incident investigation: RK-20261121-6A4F57

Production was inspected on 21 November 2026 using the running backend's configured
database selection, without running the application factory or bootstrap. The URI
has no database path; the configured `MONGO_DBNAME` is the database used by
`rbac.database()`. The deployed source was
`156865315107357843c936f17d282c4a1492eab0`.

**The exact order number was not found.** Its internal identity, timeline, outbox,
consent and signed receipts therefore cannot be established conclusively. No
unrelated order or customer records were queried. Local fixtures are not production
evidence. No credentials, customer details or message payloads were displayed.

| Current setting | Observed |
| --- | --- |
| Order-notification environment gate | true |
| Admin order-notification switch | true |
| General WhatsApp environment gate | false |
| General admin sending switch | false |
| Marketing environment gate | false |
| `order_rejected` | `order_and_payment_update`, enabled, APPROVED, components verified, not stale |
| `refund_completed` | `rk_refund_processed`, disabled, APPROVED, components verified, not stale |

Both timers were inactive and enabled; both services were inactive. No WhatsApp
worker/refresh container was running. `systemctl show` recorded both timers becoming
inactive at **2026-11-21 11:46:31 UTC / 5:16:31 PM IST**. The worker service's last
inactive timestamp was 11:46:20 UTC; the refresh service's was 07:17:00 UTC. The
requested journal window was readable but yielded no matching transitions in the
safe filtered inspection. No raw service logs were printed.

The reported 5:27 PM IST events would be after that timer-stop timestamp. Their
actual occurrence cannot be verified without the missing order/source system.

## Rejection

Exact incident root cause: **undetermined; production order not found**. The current
enabled mapping does not prove consent, event eligibility, queue insertion,
dispatch or delivery. Stopped workers prevent new dispatch, but cannot be asserted
as this event's sole cause without its outbox record. `CUSTOMER NOTIFICATION
REQUESTED` is application intent, not any later notification outcome.

## Refund

Exact incident root cause: **undetermined; production order not found**. The current
refund mapping is disabled and would block sending. This does not establish the
historical event's complete path. A manual lifecycle action cannot generate a
signed Razorpay `refund.processed` webhook. Zero receipts without a verified
capture and matching processed refund do not qualify for a refund-completed
notification. The local candidate rejects that action without manufacturing facts.

## Queue resumption and remediation

The exact-order-number message-log query returned zero records. A direct
order-number-tagged outbox query also returned zero, but outbox identities are
normally linked through the missing order/audit; that does not prove there are no
hashed jobs. Exact-order pending, expired, skipped, held, failed and eligible jobs
are **not established**. No job was retried, replayed, reset, cancelled or deleted. No
production state, template, credential, gate or timer was changed.

1. Keep the maintenance state. An authorized operator must verify the source
   domain/environment and locate the exact order using an approved internal
   reference, without broadly searching customer data.
2. Inspect only its audits, linked queue records and signed receipts using safe
   metadata. Reconcile actual UTC/IST timestamps before assigning a root cause.
3. Verify captured/refunded amounts before any separately authorized audited
   historical lifecycle correction. Do not fabricate payment/refund evidence.
4. Reassess gates, consent and exact template evidence without enabling mappings
   or bypassing suppression. Do not automatically replay historical events.
5. Complete the existing paused-worker, outbox, immutable-image and recovery audit
   before any later separately authorized operator activation.

This investigation does not resolve or claim to resolve the production incident.
