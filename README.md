# Rashi Kapoor

Luxury womenswear ecommerce platform scaffold for the `Rashi Kapoor` brand.

RK-WEB is an independent application. It uses its own backend, authentication,
database configuration, and catalog; it does not call or require RK-STOCK.

## AI Virtual Try-On (local-only, disabled by default)

The optional AI Try-On service is implemented in `backend/app/ai_tryon.py` and
uses Google's official Gemini Interactions API with the currently documented
Nano Banana models. Its admin `enabled` setting defaults to `false`, so the
feature cannot call Google until it is deliberately configured and enabled.

Configure these backend-only values in the existing environment file or secret
manager before controlled testing:

```env
GEMINI_API_KEY=<Google Gemini API key>
AI_TRYON_ENABLED=false
```

The admin page is `Admin Dashboard -> AI Virtual Try-On`. The page shows only
whether `GEMINI_API_KEY` is configured and identifies its source as the backend
environment. The key is never accepted from, returned to, or displayed in the
browser. Change it only in local backend environment files or deployment
secrets. Customer uploads and generated previews stay under the backend private
instance directory, are owner-scoped and quota limited, and are removed by the
`cleanup_expired()` maintenance hook after the configured retention period.
Keep `AI_TRYON_ENABLED=false` through automated validation; change it to `true`
only after credentials, model, privacy, retention, and one controlled test
generation have been reviewed.

## Forex provider

Storefront prices are converted from INR through the existing backend-cached
currency context. Twelve Data support is backend-only and remains disabled
unless commercial customer-facing use has been contractually approved. After
that approval, configure these backend variables without exposing them to the
frontend:

```env
TWELVE_DATA_API_KEY=
TWELVE_DATA_COMMERCIAL_USE_APPROVED=true
FX_CACHE_TTL_SECONDS=21600
```

The API key is never returned to clients. Raw rates, provider status, and
manual refresh are restricted to the authenticated admin settings page.

Current phase:
- Frontend foundation
- Brand system and luxury landing shell
- Backend Flask architecture skeleton

Next phase after approval:
- MongoDB models and REST API
- CMS/admin workflows
- Product, collection, and lookbook data flows

## Razorpay Test Mode

Customer checkout uses Razorpay Standard Checkout in Test Mode. The backend creates the Razorpay order, calculates the amount from the database catalog, verifies the callback signature, checks that the payment is captured, and only then confirms the RK order and adjusts inventory.

Set these variables on the backend only (local `backend/.env` and the Render backend service):

```env
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
RAZORPAY_MODE=test
```

Never expose or commit `RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET`. The frontend does not need a Razorpay secret; it receives the public key from the authenticated backend response. Keep `NEXT_PUBLIC_API_URL` pointed at the backend as usual.

In Razorpay Test Mode, use the standard test UPI IDs `success@razorpay` and `failure@razorpay` to exercise successful and failed payments. Enable automatic capture for the test account, or the verify endpoint will correctly leave an authorized-but-not-captured payment unconfirmed.

Configure the Razorpay webhook URL as:

```text
https://api.physihome.shop/api/webhooks/razorpay
```

Use the same webhook secret in Razorpay and `RAZORPAY_WEBHOOK_SECRET`, and enable at least `payment.captured` and `payment.failed`. Webhook events are signature-checked against the raw request body and deduplicated by event ID.

Local checkout starts at `/bag` and continues to `/checkout`. The application order remains `pending_payment` until Razorpay verification succeeds. A payment failure or dismissal leaves the shopping bag intact for retry.

## Database maintenance

Backend startup and GET requests do not create indexes, seed catalog records, migrate orders, or persist product normalization. After independently verifying the configured target, an operator can run `flask --app app database-maintenance` from `backend` and must enter the exact configured database name. Any maintenance failure aborts that command rather than being swallowed by application startup.
