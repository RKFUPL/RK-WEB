"""Manual lifecycle uses the same consent, approved templates, restricted outbox and worker."""
from unittest.mock import patch
import pytest

from test_whatsapp_remediation import case
from test_whatsapp_order_mode import order_case
from app.order_confirmation import send_order_confirmation
from app.order_fulfillment import apply_transition, OrderTransitionError
from app.manual_payments import record_payment, reverse_payment
from app.whatsapp import process_outbox, notify


def manual(c):
    c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": {
        "paymentGateway": "manual", "payment": {"gateway": "manual", "status": "pending"},
        "paymentStatus": "pending", "paymentTransactions": [], "paymentLedgerVersion": 0,
        "fulfillment.status": "order_placed", "items": []},
        "$unset": {"paymentVerifiedAt": "", "razorpayPaymentId": ""}})
    return c.db.orders.find_one({"_id": c.order["_id"]})


def test_initial_manual_email_and_approved_whatsapp_are_idempotent(order_case):
    c = order_case
    order = manual(c)
    c.app.config["WHATSAPP_TEMPLATES"]["order_placed"]["enabled"] = True
    with c.app.app_context(), patch("app.order_confirmation.send_html_email", return_value={}) as mail:
        for _ in range(2):
            assert send_order_confirmation(c.db, order, c.app.config, c.app.logger)
    mail.assert_called_once()
    assert "received" in mail.call_args.kwargs["subject"]
    assert c.db.whatsapp_outbox.count_documents({}) == 1
    assert process_outbox(c.db, c.app.config) == 1
    assert c.http.call_args.kwargs["json"]["template"]["name"] == "rk_order_placed"


@pytest.mark.parametrize("problem", ["consent", "template", "smtp"])
def test_notification_problems_do_not_change_saved_order_or_payment(order_case, problem):
    c = order_case
    order = manual(c)
    if problem == "consent":
        c.db.orders.update_one({"_id": order["_id"]}, {"$unset": {"whatsappConsent": ""}})
        order = c.db.orders.find_one({"_id": order["_id"]})
    with c.app.app_context(), patch("app.order_confirmation.send_html_email", side_effect=RuntimeError("synthetic mail outage")):
        assert not send_order_confirmation(c.db, order, c.app.config, c.app.logger)
        updated = record_payment(c.db, order, c.admin, {"transactionId": "receipt-fixture-01", "method": "cash", "amount": 100})
    assert updated["paymentStatus"] == "partial"
    assert c.db.orders.find_one({"_id": order["_id"]})["paymentTransactions"][0]["amount"] == 100
    assert c.db.whatsapp_outbox.count_documents({}) == 0
    c.http.assert_not_called()


def test_distinct_part_payments_dispatch_distinct_immutable_transaction_events(order_case):
    c = order_case
    order = manual(c)
    c.app.config["WHATSAPP_TEMPLATES"]["part_payment_received"]["enabled"] = True
    with c.app.app_context(), patch("app.order_fulfillment.send_html_email", return_value={}):
        for key in ["receipt-distinct-01", "receipt-distinct-02"]:
            order = record_payment(c.db, order, c.admin, {"transactionId": key, "method": "upi", "amount": 100})
        with pytest.raises(ValueError):
            record_payment(c.db, order, c.admin, {"transactionId": "receipt-distinct-02", "method": "upi", "amount": 100})
    assert c.db.whatsapp_outbox.count_documents({}) == 2
    assert process_outbox(c.db, c.app.config) == 2
    assert c.http.call_count == 2
    bodies = [call.kwargs["json"]["template"]["components"][0]["parameters"] for call in c.http.call_args_list]
    assert [body[-1]["text"] for body in bodies] == ["INR 1,150.00", "INR 1,050.00"]


def test_reversal_appends_audit_and_worker_rejects_reversed_receipt(order_case):
    c = order_case
    order = manual(c)
    c.app.config["WHATSAPP_TEMPLATES"]["part_payment_received"]["enabled"] = True
    with c.app.app_context(), patch("app.order_fulfillment.send_html_email", return_value={}):
        order = record_payment(c.db, order, c.admin, {"transactionId": "receipt-correction-01", "method": "cash", "amount": 100})
        original = dict(order["paymentTransactions"][0])
        updated = reverse_payment(c.db, order, c.admin, {"transactionId": "correction-fixture-01", "reverses": original["id"], "note": "Receipt was recorded against the wrong order."})
        assert updated["paymentTransactions"][0] == original
        assert updated["paymentTransactions"][1]["amount"] == -100
        assert updated["amountReceived"] == 0 and updated["balanceDue"] == 1250
        with pytest.raises(ValueError):
            reverse_payment(c.db, updated, c.admin, {"transactionId": "correction-fixture-02", "reverses": original["id"], "note": "Duplicate reversal"})
    assert process_outbox(c.db, c.app.config) == 1
    c.http.assert_not_called()


def test_accept_reject_and_every_fulfillment_event_use_persisted_state(order_case):
    c = order_case
    order = manual(c)
    for event in ["order_accepted", "processing", "packed", "shipped", "out_for_delivery", "delivered"]:
        c.app.config["WHATSAPP_TEMPLATES"][event]["enabled"] = True
    with c.app.app_context(), patch("app.order_fulfillment.send_html_email", return_value={}):
        for target in ["confirmed", "processing", "packed", "shipped", "out_for_delivery", "delivered"]:
            order = apply_transition(c.db, order, target, "staff", c.admin, {"courier": "Fixture carrier", "trackingNumber": "FIXTURE-AWB"})
            count = c.db.whatsapp_outbox.count_documents({})
            with pytest.raises(OrderTransitionError):
                apply_transition(c.db, order, target, "staff", c.admin, {})
            assert c.db.whatsapp_outbox.count_documents({}) == count
    assert {item["event"] for item in c.db.whatsapp_outbox.find()} == {"order_accepted", "processing", "packed", "shipped", "out_for_delivery", "delivered"}
    # An initial rejection has a distinct event, not a later cancellation.
    order = manual(c)
    c.app.config["WHATSAPP_TEMPLATES"]["order_rejected"]["enabled"] = True
    with c.app.app_context(), patch("app.order_fulfillment.send_html_email", return_value={}):
        apply_transition(c.db, order, "cancelled", "staff", c.admin, {"rejectionReason": "requested_size_unavailable"})
    assert c.db.whatsapp_outbox.count_documents({"event": "order_rejected"}) == 1
    assert c.db.whatsapp_outbox.count_documents({"event": "cancelled"}) == 0
