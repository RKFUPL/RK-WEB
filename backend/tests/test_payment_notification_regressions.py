"""Late provider events, endpoint alias races and SMTP recipient outcomes; isolated only."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch
import hashlib
import hmac
import json
import smtplib

import pytest
from bson import ObjectId
from pymongo.errors import AutoReconnect

from test_whatsapp_remediation import case
from test_whatsapp_order_mode import order_case
from app.mail import EmailDeliveryUnknown
from app.notification_activity import claim_email, finish_email, activity_id, expire_stale_email_claims
from app.order_fulfillment import send_status_notification


def webhooks(c):
    from app.blueprints.payments.routes import razorpay_webhook_bp
    c.app.register_blueprint(razorpay_webhook_bp, url_prefix="/api/webhooks")
    c.app.config["RAZORPAY_WEBHOOK_SECRET"] = "isolated-monotonic-secret"
    c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": {"razorpayOrderId": "order_fixture"}})
    # Install boundaries once, outside concurrent requests. Nested thread-local
    # patch contexts could restore a global dependency while another request runs.
    for boundary in (
        patch("app.blueprints.payments.routes.database", return_value=c.db),
        patch("app.blueprints.payments.routes.send_order_confirmation", return_value=True),
        patch("app.order_fulfillment.send_status_notification"),
    ):
        boundary.start()
        c.addCleanup(boundary.stop)
    def post(event_id, event, amount=None, payment_id="pay_fixture"):
        if event == "refund.processed":
            entity = {"id": "refund_" + event_id, "payment_id": payment_id, "amount": amount, "currency": "INR", "status": "processed"}
            kind = "refund"
        else:
            entity = {"id": payment_id, "order_id": "order_fixture", "amount": c.order["amountPaise"], "currency": "INR", "status": event.split(".")[1]}
            kind = "payment"
        raw = json.dumps({"id": event_id, "event": event, "payload": {kind: {"entity": entity}}}).encode()
        sig = hmac.new(b"isolated-monotonic-secret", raw, hashlib.sha256).hexdigest()
        with c.app.test_client() as client:
            return client.post("/api/webhooks/razorpay", data=raw, headers={"X-Razorpay-Signature": sig}, content_type="application/json")
    return post


@pytest.mark.parametrize("amount,status", [(125000, "refunded"), (25000, "partially_refunded")])
def test_late_failure_and_capture_preserve_verified_refund(order_case, amount, status):
    c = order_case; post = webhooks(c)
    assert post("first-refund", "refund.processed", amount).json["handled"]
    before = c.db.orders.find_one({"_id": c.order["_id"]})
    failed = post("late-failed", "payment.failed", payment_id="pay_failed_attempt")
    captured = post("late-captured", "payment.captured")
    saved = c.db.orders.find_one({"_id": c.order["_id"]})
    assert saved["paymentStatus"] == status
    assert saved["refunds"] == before["refunds"] and saved["timeline"] == before["timeline"]
    assert failed.json["reconciliationRequired"] and captured.json["reconciliationRequired"]
    assert not captured.json["fulfillmentApplied"]
    assert c.db.payment_reconciliations.count_documents({"orderId": str(saved["_id"])}) >= 1
    assert c.db.razorpay_webhook_events.find_one({"eventId": "late-captured"})["paymentEvidence"]["status"] == "captured"


def pending(c, closed=False):
    product = {"_id": ObjectId(), "stock": 5}
    c.db.products.insert_one(product)
    c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": {
        "paymentStatus": "order_created", "payment": {"gateway": "razorpay", "status": "pending"},
        "fulfillment": {"status": "cancelled" if closed else "order_placed"}, "status": "cancelled" if closed else "order_placed",
        "items": [{"productId": str(product["_id"]), "quantity": 1}]},
        "$unset": {"razorpayPaymentId": "", "paymentVerifiedAt": "", "inventoryAdjustedAt": "", "captureFulfillmentStatus": "", "captureClaimToken": "", "captureEvidence": ""}})
    return product


def test_initial_failure_then_capture_and_duplicate_capture_adjust_inventory_once(order_case):
    c = order_case; post = webhooks(c); product = pending(c)
    assert post("initial-failure", "payment.failed").json["transitionApplied"]
    assert post("initial-capture", "payment.captured").json["fulfillmentApplied"]
    assert post("initial-capture", "payment.captured").json["duplicate"]
    assert not post("duplicate-capture-new-id", "payment.captured").json["fulfillmentApplied"]
    assert c.db.products.find_one({"_id": product["_id"]})["stock"] == 4
    assert c.db.orders.find_one({"_id": c.order["_id"]})["captureFulfillmentStatus"] == "completed"


def test_genuine_capture_on_closed_order_records_money_without_fulfillment(order_case):
    c = order_case; post = webhooks(c); product = pending(c, closed=True)
    result = post("closed-capture", "payment.captured")
    saved = c.db.orders.find_one({"_id": c.order["_id"]})
    assert result.json["reconciliationRequired"] and not result.json["fulfillmentApplied"]
    assert saved["paymentStatus"] == "paid" and saved["fulfillment"]["status"] == "cancelled"
    assert saved["captureEvidence"]["paymentId"] == "pay_fixture"
    assert c.db.products.find_one({"_id": product["_id"]})["stock"] == 5


def test_concurrent_capture_webhooks_have_one_stock_owner(order_case):
    c = order_case; post = webhooks(c); product = pending(c)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda key: post(key, "payment.captured"), ["race-one", "race-two"]))
    assert all(result.status_code == 200 for result in results)
    assert sum(bool(r.json.get("fulfillmentApplied")) for r in results) == 1
    assert c.db.products.find_one({"_id": product["_id"]})["stock"] == 4


def test_refund_during_capture_is_preserved_and_only_current_deduction_is_compensated(order_case):
    c = order_case; post = webhooks(c); product = pending(c)
    real = c.db.orders.find_one_and_update; raced = False
    def interleave(query, update, **kwargs):
        nonlocal raced
        if not raced and query.get("captureClaimToken") and "$push" in update:
            raced = True
            assert post("concurrent-refund", "refund.processed", 125000).json["handled"]
        return real(query, update, **kwargs)
    with patch.object(c.db.orders, "find_one_and_update", side_effect=interleave):
        post("capture-in-flight", "payment.captured")
    post("capture-redelivery", "payment.captured")
    saved = c.db.orders.find_one({"_id": c.order["_id"]})
    assert raced and saved["paymentStatus"] == "refunded"
    assert len(saved["refunds"]) == 1 and saved["captureFulfillmentStatus"] == "held"
    assert c.db.products.find_one({"_id": product["_id"]})["stock"] == 5


def test_lost_final_capture_acknowledgement_does_not_release_committed_stock(order_case):
    c = order_case; post = webhooks(c); product = pending(c)
    real = c.db.orders.find_one_and_update
    def lose_ack(query, update, **kwargs):
        result = real(query, update, **kwargs)
        if query.get("captureClaimToken") and result and "$push" in update:
            raise AutoReconnect("isolated lost commit acknowledgement")
        return result
    with patch.object(c.db.orders, "find_one_and_update", side_effect=lose_ack):
        post("lost-ack-capture", "payment.captured")
    post("repeat-lost-ack", "payment.captured")
    assert c.db.products.find_one({"_id": product["_id"]})["stock"] == 4


def test_captured_money_remains_visible_when_fulfillment_is_held(order_case):
    from app.manual_payments import payment_summary
    from app.blueprints.payments.routes import StockUnavailable
    c = order_case; post = webhooks(c); product = pending(c)
    c.db.products.update_one({"_id": product["_id"]}, {"$set": {"stock": 0}})
    with patch.object(c.db.products, "update_one", side_effect=StockUnavailable("isolated inventory conflict")):
        post("out-of-stock-capture", "payment.captured")
    post("repeat-out-of-stock-capture", "payment.captured")
    saved = c.db.orders.find_one({"_id": c.order["_id"]})
    assert saved["captureFulfillmentStatus"] == "held"
    assert saved["fulfillment"]["status"] == "order_placed"
    summary = payment_summary(saved)
    assert summary["received"] == 1250 and summary["status"] == "paid" and summary["balanceDue"] == 0
    assert c.db.products.find_one({"_id": product["_id"]})["stock"] == 0


def retry_route(c, event):
    from app.blueprints.orders.routes import staff_orders_bp
    if "staff_orders" not in c.app.blueprints:
        c.app.register_blueprint(staff_orders_bp, url_prefix="/api/staff/orders")
    with patch("app.blueprints.orders.routes.database", return_value=c.db):
        return c.client.post(f"/api/staff/orders/{c.order['_id']}/notifications/retry", headers=c.headers, json={"event": event})


def email_order(c, event):
    c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": {
        "email": "fixture@example.test", "fulfillment.status": "cancelled" if event == "order_rejected" else "confirmed",
        "availabilityDecision.status": "rejected" if event == "order_rejected" else "accepted"}})
    return c.db.orders.find_one({"_id": c.order["_id"]})


@pytest.mark.parametrize("event", ["order_accepted", "order_rejected"])
@pytest.mark.parametrize("outcome", ["accepted", "unknown", "db_ack_failure", "safe_rejection"])
def test_original_and_retry_share_one_identity(order_case, event, outcome):
    c = order_case; order = email_order(c, event)
    # Register before making requests; this endpoint is the actual retry path.
    from app.blueprints.orders.routes import staff_orders_bp
    c.app.register_blueprint(staff_orders_bp, url_prefix="/api/staff/orders")
    real = c.db.orders.update_one
    def lose_ack(query, update, **kwargs):
        if outcome == "db_ack_failure" and update.get("$push", {}).get("notificationLog", {}).get("status") == "sent":
            raise AutoReconnect("isolated acknowledgement loss")
        return real(query, update, **kwargs)
    error = EmailDeliveryUnknown("isolated unknown") if outcome == "unknown" else smtplib.SMTPAuthenticationError(535, b"isolated rejection") if outcome == "safe_rejection" else None
    with c.app.app_context(), patch("app.order_fulfillment.send_html_email", side_effect=error, return_value={}) as first, patch.object(c.db.orders, "update_one", side_effect=lose_ack):
        if outcome == "db_ack_failure":
            with pytest.raises(AutoReconnect): send_status_notification(c.db, order, event)
        else:
            send_status_notification(c.db, order, event)
    with patch("app.order_fulfillment.send_html_email", return_value={}) as retry:
        assert retry_route(c, event).status_code == 200
    assert first.call_count == 1 and retry.call_count == (1 if outcome == "safe_rejection" else 0)
    activity = c.db.order_notification_activity.find_one({"event": event, "channel": "email"})
    assert activity["attempts"] == (2 if outcome == "safe_rejection" else 1)


def test_concurrent_original_and_retry_submit_once(order_case):
    c = order_case; order = email_order(c, "order_rejected")
    from app.blueprints.orders.routes import staff_orders_bp
    c.app.register_blueprint(staff_orders_bp, url_prefix="/api/staff/orders")
    def interleave(*args, **kwargs):
        assert retry_route(c, "order_rejected").status_code == 200
        return {}
    with c.app.app_context(), patch("app.order_fulfillment.send_html_email", side_effect=interleave) as email:
        send_status_notification(c.db, order, "order_rejected")
    assert email.call_count == 1


def test_expired_generation_becomes_persisted_held_and_cannot_retry(order_case):
    c = order_case; order = email_order(c, "order_rejected")
    token = claim_email(c.db, order["_id"], "order_rejected", "fulfillment:order_rejected")
    past = datetime.now(timezone.utc) - timedelta(minutes=11)
    c.db.order_notification_activity.update_one({"claimToken": token}, {"$set": {"heartbeatAt": past, "leaseUntil": past + timedelta(minutes=10)}})
    with patch("app.order_fulfillment.send_html_email") as email:
        assert retry_route(c, "order_rejected").status_code == 200
    email.assert_not_called()
    assert c.db.order_notification_activity.find_one({"claimToken": token})["status"] == "held"


def test_renewed_active_generation_cannot_be_marked_held_by_a_stale_scan(order_case):
    c = order_case; order = email_order(c, "order_rejected")
    token = claim_email(c.db, order["_id"], "order_rejected", "fulfillment:order_rejected")
    at = datetime.now(timezone.utc); past = at - timedelta(minutes=11)
    c.db.order_notification_activity.update_one({"claimToken": token}, {"$set": {"heartbeatAt": past, "leaseUntil": past + timedelta(minutes=10)}})
    real = c.db.order_notification_activity.update_one
    def heartbeat_wins(query, update, **kwargs):
        if update.get("$set", {}).get("status") == "held":
            real({"claimToken": token}, {"$set": {"heartbeatAt": at, "leaseUntil": at + timedelta(minutes=10)}})
        return real(query, update, **kwargs)
    with patch.object(c.db.order_notification_activity, "update_one", side_effect=heartbeat_wins):
        expire_stale_email_claims(c.db, order["_id"], at)
    assert c.db.order_notification_activity.find_one({"claimToken": token})["status"] == "sending"


@pytest.mark.parametrize("refused,expected", [([], "sent"), (["customer"], "held"), (["copy"], "sent"), (["customer", "copy"], "failed")])
def test_customer_smtp_outcome_is_independent_of_copy_recipient(order_case, refused, expected):
    c = order_case
    from app.order_confirmation import send_order_confirmation
    customer, copy = "fixture@example.test", "copy@example.test"
    order = email_order(c, "order_accepted")
    smtp = MagicMock()
    smtp.send_message.return_value = {address: (550, b"isolated refusal") for role, address in [("customer", customer), ("copy", copy)] if role in refused}
    if len(refused) == 2:
        smtp.send_message.side_effect = smtplib.SMTPRecipientsRefused(smtp.send_message.return_value)
    with c.app.app_context(), patch("app.mail._smtp_connection", return_value=smtp), patch("app.order_confirmation.confirmation_bcc_recipients", return_value=[copy]):
        send_order_confirmation(c.db, order, c.app.config, c.app.logger)
        if expected != "failed":
            send_order_confirmation(c.db, c.db.orders.find_one({"_id": order["_id"]}), c.app.config, c.app.logger, force=True)
    saved = c.db.orders.find_one({"_id": order["_id"]})
    assert saved["confirmationEmail"]["status"] == expected
    assert smtp.send_message.call_count == 1
    activity = list(c.db.order_notification_activity.find({"channel": "email"}))
    assert customer not in str(activity) and copy not in str(activity) and "isolated refusal" not in str(activity)
    if expected == "sent":
        assert activity[0]["status"] == "accepted" and activity[0]["submission"]["customerAccepted"] == 1
    if expected == "held":
        assert activity[0]["submission"]["customerRefused"] == 1


def test_confirmation_expiry_is_consistent_with_persisted_claim(order_case):
    c = order_case; order = c.order
    token = claim_email(c.db, order["_id"], "order_confirmation", "order_confirmation")
    past = datetime.now(timezone.utc) - timedelta(minutes=11)
    c.db.order_notification_activity.update_one({"claimToken": token}, {"$set": {"heartbeatAt": past, "leaseUntil": past + timedelta(minutes=10)}})
    expire_stale_email_claims(c.db, order["_id"])
    assert c.db.orders.find_one({"_id": order["_id"]})["confirmationEmail"]["status"] == "held"


@pytest.mark.parametrize("event,alias", [("order_accepted", "fulfillment:confirmed"), ("order_rejected", "fulfillment:cancelled")])
def test_legacy_email_alias_claim_also_blocks_new_canonical_identity(order_case, event, alias):
    c = order_case; order = email_order(c, event)
    c.db.orders.update_one({"_id": order["_id"]}, {"$addToSet": {"notificationKeys": alias}})
    with c.app.app_context(), patch("app.order_fulfillment.send_html_email") as email:
        send_status_notification(c.db, order, event)
    email.assert_not_called()


@pytest.mark.parametrize("outcome", ["timeout", "lost_activity_ack", "lost_order_ack"])
def test_initial_confirmation_uncertainty_never_releases_submission(order_case, outcome):
    from app.order_confirmation import send_order_confirmation
    c = order_case; order = email_order(c, "order_accepted")
    smtp = MagicMock()
    smtp.send_message.return_value = {}
    if outcome == "timeout":
        smtp.send_message.side_effect = TimeoutError("isolated uncertain DATA")
    collection = c.db.order_notification_activity if outcome == "lost_activity_ack" else c.db.orders
    real = collection.update_one
    def lose_ack(query, update, **kwargs):
        if (outcome == "lost_activity_ack" and update.get("$set", {}).get("status") == "accepted"
                or outcome == "lost_order_ack" and update.get("$set", {}).get("confirmationEmail.status") == "sent"):
            raise AutoReconnect("isolated acknowledgement loss")
        return real(query, update, **kwargs)
    with c.app.app_context(), patch("app.mail._smtp_connection", return_value=smtp):
        with patch.object(collection, "update_one", side_effect=lose_ack):
            if outcome == "timeout":
                assert not send_order_confirmation(c.db, order, c.app.config, c.app.logger)
            else:
                with pytest.raises(AutoReconnect):
                    send_order_confirmation(c.db, order, c.app.config, c.app.logger)
        send_order_confirmation(c.db, c.db.orders.find_one({"_id": order["_id"]}), c.app.config, c.app.logger, force=True)
    assert smtp.send_message.call_count == 1
    assert "order_confirmation" in c.db.orders.find_one({"_id": order["_id"]})["notificationKeys"]


def test_late_smtp_result_cannot_release_a_held_generation(order_case):
    c = order_case; order = email_order(c, "order_rejected")
    token = claim_email(c.db, order["_id"], "order_rejected", "fulfillment:order_rejected")
    past = datetime.now(timezone.utc) - timedelta(minutes=11)
    c.db.order_notification_activity.update_one({"claimToken": token}, {"$set": {"heartbeatAt": past, "leaseUntil": past + timedelta(minutes=10)}})
    expire_stale_email_claims(c.db, order["_id"])
    finish_email(c.db, order["_id"], "order_rejected", "fulfillment:order_rejected", token, "failed", "smtp_recipient_rejected")
    assert claim_email(c.db, order["_id"], "order_rejected", "fulfillment:cancelled") is None
    saved = c.db.order_notification_activity.find_one({"claimToken": token})
    assert saved["status"] == "held" and saved["history"][-1]["status"] == "late_provider_result"
