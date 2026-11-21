"""Order-only automation: isolated Mongo fixtures and mocked Meta/SMTP calls."""
from datetime import timedelta
import hashlib
import hmac
import json
import os
import runpy
from unittest.mock import patch

import pytest

from test_whatsapp_remediation import case
from app.whatsapp import notify, now, process_outbox, send, production_test_state
from app.whatsapp_orders import ORDER_NOTIFICATIONS, ORDER_ONLY_EVENTS
from app.whatsapp_consent import record_consent


@pytest.fixture
def order_case(case):
    case.app.config.update(WHATSAPP_ENVIRONMENT="production", WHATSAPP_ENABLED=False,
                           WHATSAPP_TEST_SEND_ENABLED=False, WHATSAPP_MARKETING_ENABLED=False,
                           WHATSAPP_ORDER_NOTIFICATIONS_ENABLED=True)
    case.db.integrations.update_one({"_id": "whatsapp"}, {"$set": {"enabled": False, "orderNotificationsEnabled": True}})
    for event, mapping in case.app.config["WHATSAPP_TEMPLATES"].items():
        mapping["enabled"] = event == "order_confirmation"
    order = case.confirmed_order()
    consent = record_consent(case.db, case.app.config, case.user["_id"], case.user["phone"], True,
                             "checkout", order_id=order["_id"], update_user=False)
    case.db.orders.update_one({"_id": order["_id"]}, {"$set": {"whatsappConsent": consent, "items": [], "email": case.user["email"], "razorpayOrderId": "order_fixture"}})
    case.order = case.db.orders.find_one({"_id": order["_id"]})
    return case


def enqueue(case, event="order_confirmation"):
    with case.app.app_context():
        return notify(case.db, event, case.order)


def test_production_gate_is_explicit_default_off_and_keeps_other_gates_off():
    for value in (None, "false", "true"):
        env = {} if value is None else {"WHATSAPP_ORDER_NOTIFICATIONS_ENABLED": value}
        with patch.dict(os.environ, env, clear=True):
            config = runpy.run_path("app/config.py")["ProductionConfig"]
        assert config.WHATSAPP_ORDER_NOTIFICATIONS_ENABLED is (value == "true")
        assert config.WHATSAPP_ENABLED is False
        assert config.WHATSAPP_TEST_SEND_ENABLED is False
        assert config.WHATSAPP_MARKETING_ENABLED is False


def test_verified_capture_queues_one_initial_message_and_email_is_independent(order_case):
    from app.blueprints.payments.routes import _fulfil_paid_order
    c = order_case
    # Even if separately configured for future use, payment confirmation is
    # not duplicated alongside the one order confirmation for this event.
    c.app.config["WHATSAPP_TEMPLATES"]["payment_confirmation"]["enabled"] = True
    c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": {"paymentStatus": "pending"}, "$unset": {"paymentVerifiedAt": "", "razorpayPaymentId": ""}})
    pending = c.db.orders.find_one({"_id": c.order["_id"]})
    with c.app.app_context(), patch("app.order_confirmation.send_html_email", return_value={"id": "email_fixture"}) as email:
        paid, changed = _fulfil_paid_order(c.db, pending, "pay_verified", "checkout", "verified_signature")
        assert changed and paid["paymentVerifiedAt"]
        _fulfil_paid_order(c.db, paid, "pay_verified", "webhook")
    email.assert_called_once()
    assert c.db.whatsapp_outbox.count_documents({}) == 1
    assert c.db.whatsapp_outbox.find_one()["event"] == "order_confirmation"
    c.http.assert_not_called()
    assert process_outbox(c.db, c.app.config) == 1
    c.http.assert_called_once()
    assert c.http.call_args.kwargs["json"]["template"]["name"] == "rk_order_confirmation"


@pytest.mark.parametrize("status,proof", [("pending", True), ("failed", True), ("paid", False)])
def test_unverified_or_failed_payment_cannot_enqueue(order_case, status, proof):
    c = order_case
    changes = {"$set": {"paymentStatus": status}}
    if not proof:
        changes["$unset"] = {"paymentVerifiedAt": "", "razorpayPaymentId": ""}
    c.db.orders.update_one({"_id": c.order["_id"]}, changes)
    assert enqueue(c)["reason"] == "business_event_not_confirmed"
    assert c.db.whatsapp_outbox.count_documents({}) == 0


@pytest.mark.parametrize("consent", ["missing", "declined", "withdrawn", "stop"])
def test_order_grant_cannot_inherit_profile_consent_or_override_withdrawal(order_case, consent):
    from app.whatsapp import fingerprint
    c = order_case
    if consent == "missing":
        c.db.orders.update_one({"_id": c.order["_id"]}, {"$unset": {"whatsappConsent": ""}})
    elif consent == "declined":
        c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": {"whatsappConsent.enabled": False}})
    elif consent == "withdrawn":
        record_consent(c.db, c.app.config, c.user["_id"], c.user["phone"], False, "profile_withdrawal")
    else:
        c.db.whatsapp_optouts.update_one({"_id": fingerprint(c.user["phone"], c.app.config)}, {"$set": {"active": True}}, upsert=True)
    assert enqueue(c)["reason"] == "missing_or_withdrawn_consent"
    assert c.db.whatsapp_order_events.find_one()["status"] == "not_eligible"
    assert c.db.whatsapp_outbox.count_documents({}) == 0


@pytest.mark.parametrize("gate", ["environment", "database"])
def test_both_order_controls_required_at_enqueue_and_dispatch(order_case, gate):
    c = order_case
    assert enqueue(c)["status"] == "queued"
    if gate == "environment":
        c.app.config["WHATSAPP_ORDER_NOTIFICATIONS_ENABLED"] = False
    else:
        c.db.integrations.update_one({"_id": "whatsapp"}, {"$set": {"orderNotificationsEnabled": False}})
    assert process_outbox(c.db, c.app.config) == 0
    c.http.assert_not_called()
    other = c.confirmed_order()
    c.order = other
    assert enqueue(c)["status"] == "skipped"


@pytest.mark.parametrize("evidence", ["stale", "revoked", "mismatch", "missing", "disabled", "language"])
def test_current_exact_template_evidence_required_at_dispatch(order_case, evidence):
    c = order_case
    assert enqueue(c)["status"] == "queued"
    change = {"stale": {"checkedAt": now() - timedelta(hours=25)}, "revoked": {"status": "PAUSED"},
              "mismatch": {"componentSignature": "different"}, "missing": {"presentInMeta": False},
              "language": {"language": "en_GB"}}
    if evidence == "disabled":
        c.app.config["WHATSAPP_TEMPLATES"]["order_confirmation"]["enabled"] = False
    else:
        c.db.whatsapp_template_status.update_one({"_id": "rk_order_confirmation:en_US"}, {"$set": change[evidence]})
    process_outbox(c.db, c.app.config)
    c.http.assert_not_called()


@pytest.mark.parametrize("change", ["gate", "consent", "payment", "template"])
def test_order_dispatch_rechecks_after_provider_backoff(order_case, change):
    c = order_case
    enqueue(c)
    c.http.return_value = c.response(429, {"error": {"code": 130429}}, {"Retry-After": "1"})
    def revoke(_):
        if change == "gate":
            c.app.config["WHATSAPP_ORDER_NOTIFICATIONS_ENABLED"] = False
        elif change == "consent":
            c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": {"whatsappConsent.enabled": False}})
        elif change == "payment":
            c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": {"paymentStatus": "failed"}})
        else:
            c.db.whatsapp_template_status.update_one({"_id": "rk_order_confirmation:en_US"}, {"$set": {"status": "REJECTED"}})
    with patch("app.whatsapp.retry_sleep", side_effect=revoke):
        process_outbox(c.db, c.app.config)
    assert c.http.call_count == 1
    assert c.db.whatsapp_messages.find_one()["status"] == "failed"


def test_order_only_mode_does_not_claim_otp_marketing_or_unrelated_jobs(order_case):
    c = order_case
    for event in ("signup_otp", "new_collection_drop", "exclusive_offer", "payment_failure", "admin_notification", "text"):
        c.db.whatsapp_outbox.insert_one({"_id": "unrelated-" + event, "event": event, "orderNotification": True,
                                       "payload": "not-decrypted", "status": "pending", "expiresAt": now() + timedelta(hours=1), "createdAt": now()})
        with c.app.app_context():
            assert notify(c.db, event, c.order)["status"] == "skipped"
        assert send(c.db, c.app.config, c.user["phone"], event, {}, "unrelated:" + event)["reason"] == "disabled"
    enqueue(c)
    with patch("app.whatsapp_campaigns.materialize_campaigns") as campaigns:
        assert process_outbox(c.db, c.app.config) == 1
    campaigns.assert_not_called()
    assert c.db.whatsapp_outbox.count_documents({"status": "pending"}) == 6
    c.http.assert_called_once()


def test_order_only_mode_does_not_enqueue_or_claim_payment_confirmation(order_case):
    c = order_case
    c.app.config["WHATSAPP_TEMPLATES"]["payment_confirmation"]["enabled"] = True
    assert enqueue(c, "payment_confirmation")["status"] == "skipped"
    assert c.db.whatsapp_outbox.count_documents({}) == 0
    c.db.whatsapp_outbox.insert_one({"_id": "legacy-payment", "event": "payment_confirmation", "orderNotification": True,
                                    "payload": "not-decrypted", "status": "pending", "expiresAt": now() + timedelta(hours=1), "createdAt": now()})
    assert process_outbox(c.db, c.app.config) == 0
    c.http.assert_not_called()


def test_payload_cannot_lie_about_order_tag(order_case):
    from cryptography.fernet import Fernet
    c = order_case
    enqueue(c)
    item = c.db.whatsapp_outbox.find_one()
    cipher = Fernet(c.app.config["WHATSAPP_OUTBOX_KEY"].encode())
    payload = json.loads(cipher.decrypt(item["payload"].encode()))
    payload["event"] = "signup_otp"
    c.db.whatsapp_outbox.update_one({"_id": item["_id"]}, {"$set": {"payload": cipher.encrypt(json.dumps(payload).encode()).decode()}})
    assert process_outbox(c.db, c.app.config) == 1
    assert c.db.whatsapp_outbox.find_one()["status"] == "invalid_payload"
    c.http.assert_not_called()


def test_manual_test_expiry_remains_independent(order_case):
    c = order_case
    c.app.config.update(WHATSAPP_PRODUCTION_TEST_SEND_ENABLED=True,
                        WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT=(now() - timedelta(seconds=1)).isoformat())
    assert production_test_state(c.app.config)["reason"] == "production_test_expired"
    assert enqueue(c)["status"] == "queued"
    assert process_outbox(c.db, c.app.config) == 1


def test_admin_order_control_is_separate_and_requires_backend_gate(order_case):
    c = order_case
    url = "/api/admin/integrations/whatsapp"
    assert c.client.patch(url, json={"orderNotificationsEnabled": True}).status_code == 401
    c.app.config["WHATSAPP_ORDER_NOTIFICATIONS_ENABLED"] = False
    assert c.client.patch(url, headers=c.headers, json={"orderNotificationsEnabled": True}).status_code == 409
    c.app.config["WHATSAPP_ORDER_NOTIFICATIONS_ENABLED"] = True
    result = c.client.patch(url, headers=c.headers, json={"orderNotificationsEnabled": True})
    assert result.status_code == 200
    assert result.json["orderNotificationsEnabled"] is True
    assert result.json["enabled"] is False and result.json["marketingEnabled"] is False
    assert result.json["templates"]["order_confirmation"]["eligibleForAutomation"] is True
    assert result.json["templates"]["signup_otp"]["eligibleForAutomation"] is False


@pytest.mark.parametrize("event", sorted(ORDER_NOTIFICATIONS - {"order_confirmation", "payment_confirmation"}))
def test_other_lifecycle_mappings_are_off_and_require_business_proof(order_case, event):
    c = order_case
    assert enqueue(c, event)["status"] == "skipped"
    c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": {"fulfillment.status": "order_placed"}})
    c.app.config["WHATSAPP_TEMPLATES"][event]["enabled"] = True
    assert enqueue(c, event)["status"] == "skipped"
    assert c.db.whatsapp_outbox.count_documents({}) == 0


def test_signed_capture_is_idempotent_and_bad_signatures_cannot_enqueue(order_case):
    from app.blueprints.payments.routes import razorpay_webhook_bp
    c = order_case
    c.app.register_blueprint(razorpay_webhook_bp, url_prefix="/api/webhooks")
    c.app.config["RAZORPAY_WEBHOOK_SECRET"] = "synthetic-webhook-secret"
    c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": {"paymentStatus": "pending"}, "$unset": {"paymentVerifiedAt": "", "razorpayPaymentId": ""}})
    raw = json.dumps({"id": "capture-fixture", "event": "payment.captured", "payload": {"payment": {"entity": {
        "id": "pay_capture", "order_id": "order_fixture", "amount": 125000, "currency": "INR", "status": "captured"}}}}).encode()
    signature = hmac.new(b"synthetic-webhook-secret", raw, hashlib.sha256).hexdigest()
    with patch("app.blueprints.payments.routes.database", return_value=c.db), patch("app.order_confirmation.send_html_email", return_value={}) as email:
        assert c.client.post("/api/webhooks/razorpay", data=raw, headers={"X-Razorpay-Signature": "invalid"}).status_code == 400
        assert c.db.whatsapp_outbox.count_documents({}) == 0
        for _ in range(2):
            response = c.client.post("/api/webhooks/razorpay", data=raw, headers={"X-Razorpay-Signature": signature})
            assert response.status_code == 200
    email.assert_called_once()
    assert c.db.whatsapp_outbox.count_documents({}) == 1
    c.http.assert_not_called()


@pytest.mark.parametrize("scenario", ["verified", "bad_signature", "not_captured", "wrong_amount"])
def test_checkout_verification_remains_the_payment_authority(order_case, scenario):
    from app.blueprints.payments.routes import payments_bp
    c = order_case
    c.app.register_blueprint(payments_bp, url_prefix="/api/payments")
    c.app.config["RAZORPAY_KEY_SECRET"] = "synthetic-checkout-secret"
    c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": {"paymentStatus": "pending"}, "$unset": {"paymentVerifiedAt": "", "razorpayPaymentId": ""}})
    signature = hmac.new(b"synthetic-checkout-secret", b"order_fixture|pay_checkout", hashlib.sha256).hexdigest()
    payment = {"id": "pay_checkout", "order_id": "order_fixture", "amount": 125000, "currency": "INR", "status": "captured"}
    if scenario == "not_captured":
        payment["status"] = "authorized"
    elif scenario == "wrong_amount":
        payment["amount"] = 1
    with patch("app.blueprints.payments.routes.database", return_value=c.db), patch("app.blueprints.payments.routes.authenticated_user_id", return_value=c.user["_id"]), patch("app.blueprints.payments.routes.is_configured", return_value=True), patch("app.blueprints.payments.routes.razorpay_api_request", return_value=payment), patch("app.order_confirmation.send_html_email", return_value={}) as email:
        response = c.client.post("/api/payments/razorpay/verify", headers=c.headers, json={
            "razorpay_payment_id": "pay_checkout", "razorpay_order_id": "order_fixture",
            "razorpay_signature": "bad" if scenario == "bad_signature" else signature})
    if scenario == "verified":
        assert response.status_code == 200
        assert c.db.whatsapp_outbox.count_documents({}) == 1
        email.assert_called_once()
    else:
        assert response.status_code in {400, 409}
        assert c.db.whatsapp_outbox.count_documents({}) == 0
        email.assert_not_called()
    c.http.assert_not_called()


@pytest.mark.parametrize("event", sorted(ORDER_ONLY_EVENTS - {"order_confirmation"}))
def test_individually_authorized_lifecycle_events_use_existing_worker(order_case, event):
    c = order_case
    c.app.config["WHATSAPP_TEMPLATES"][event]["enabled"] = True
    fields = {"fulfillment.status": "confirmed"}
    if event in {"processing", "packed"}:
        fields["fulfillment.status"] = event
    elif event == "order_placed":
        fields.update(paymentGateway="manual", paymentStatus="pending", paymentTransactions=[])
        fields["fulfillment.status"] = "order_placed"
    elif event == "order_accepted":
        fields["availabilityDecision.status"] = "accepted"
    elif event == "order_rejected":
        fields.update({"fulfillment.status": "cancelled", "availabilityDecision.status": "rejected"})
    elif event in {"advance_payment_received", "part_payment_received", "payment_received"}:
        # Advance/part receipts must leave a balance; only the final receipt
        # may claim that the order has been paid in full.
        amount = 125000 if event == "payment_received" else 25000
        transaction = {"id": "txn_recorded", "event": event, "amountPaise": amount, "receivedPaise": amount, "balancePaise": 125000 - amount}
        fields.update(paymentGateway="manual", paymentTransactions=[transaction], paymentStatus="paid" if event == "payment_received" else "partial")
        c.order["whatsappPayment"] = transaction
    if event in {"shipped", "out_for_delivery", "delivered"}:
        fields.update({"fulfillment.status": event, "fulfillment.shippedAt": now(),
                       "fulfillment.courier": "Recorded carrier", "fulfillment.trackingNumber": "ACTUAL_AWB"})
        if event == "delivered":
            fields["fulfillment.deliveredAt"] = now()
    elif event == "cancelled":
        fields.update({"fulfillment.status": "cancelled", "timeline": [{"status": "cancelled", "id": "recorded_transition"}]})
    elif event == "refund_completed":
        fields["refunds"] = [{"id": "rfnd_saved", "status": "processed", "source": "razorpay_signed_webhook",
                             "amountPaise": 10000, "currency": "INR", "paymentId": c.order["razorpayPaymentId"], "processedAt": now()}]
        c.order["whatsappRefund"] = {"id": "rfnd_saved"}
    c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": fields})
    assert enqueue(c, event)["status"] == "queued"
    assert process_outbox(c.db, c.app.config) == 1
    c.http.assert_called_once()
    assert c.db.whatsapp_messages.find_one()["type"] == event
    if event in {"advance_payment_received", "part_payment_received", "payment_received"}:
        parameters = c.http.call_args.kwargs["json"]["template"]["components"][0]["parameters"]
        assert parameters[3]["text"] == ("Paid" if event == "payment_received" else "Partial")
        assert [item["text"] for item in parameters[5:]] == (["1,250.00", "0.00"] if event == "payment_received" else ["250.00", "1,000.00"])


def test_existing_worker_cli_can_process_order_only_mode(order_case):
    from app.whatsapp_ops import register_commands
    c = order_case
    enqueue(c)
    register_commands(c.app, None)
    with patch("app.whatsapp_ops.guarded_database", return_value=c.db), patch("app.whatsapp_ops.index_problems", return_value=[]):
        result = c.app.test_cli_runner().invoke(args=["whatsapp-worker"])
    assert result.exit_code == 0, result.output
    assert '"processed": 1' in result.output
    c.http.assert_called_once()


def test_order_activity_is_masked_and_retains_real_delivery_read_receipts(order_case):
    from app.whatsapp_orders import order_whatsapp_activity
    c = order_case
    enqueue(c)
    process_outbox(c.db, c.app.config)
    c.signed(c.webhook(statuses=[c.provider_status("delivered"), c.provider_status("read", timestamp="1700000010")]))
    activity = order_whatsapp_activity(c.db, c.app.config, c.order)
    assert activity["number"] == "***2671"
    assert activity["automationEnabled"] is True
    assert activity["activity"][0]["status"] == "read"
    assert activity["activity"][0]["readAt"]
    assert c.user["phone"] not in str(activity)
