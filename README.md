# Rashi Kapoor

Luxury womenswear ecommerce platform scaffold for the `Rashi Kapoor` brand.

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
