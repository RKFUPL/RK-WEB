"""Inventory operation fencing and marker evidence tests; Mongo/provider isolated."""
from unittest.mock import patch

import pytest

from app.inventory_operations import (capture_operation_id, manual_operation_id, operation_evidence,
                                     capture_recoverable, manual_reservation_recoverable,
                                     persisted_inventory_block_reason)
from app.order_fulfillment import OrderTransitionError, apply_transition
from app.whatsapp_orders import notify_order_whatsapp
from test_whatsapp_order_mode import order_case, enqueue
from test_whatsapp_remediation import case


@pytest.mark.parametrize("capture_state", ["processing", "held", "unresolved"])
def test_capture_inventory_state_blocks_direct_fulfillment_and_stale_success_notifications(order_case, capture_state):
    case = order_case
    case.db.orders.update_one({"_id": case.order["_id"]}, {"$set": {
        "captureFulfillmentStatus": capture_state, "paymentStatus": "paid",
        "payment": {"gateway": "razorpay", "status": "paid"},
    }})
    stale = case.order.copy()
    with pytest.raises(OrderTransitionError) as error:
        apply_transition(case.db, stale, "processing", "staff", case.user, {})
    assert error.value.code == "inventory_reconciliation_required"
    with case.app.app_context():
        result = notify_order_whatsapp(case.db, case.order["_id"], "processing")
    assert result["status"] == "skipped"
    assert result["reason"] == "inventory_reconciliation_required"
    assert case.db.whatsapp_outbox.count_documents({}) == 0
    from app.blueprints.orders.routes import _customer_view
    customer = _customer_view(case.db, case.db.orders.find_one({"_id": case.order["_id"]}))
    assert customer["fulfillmentStatus"] == "order_placed"
    assert customer["customerNotice"]
    assert "captureFulfillmentStatus" not in customer


def test_direct_confirmation_email_is_blocked_for_held_capture(order_case):
    case = order_case
    case.db.orders.update_one({"_id": case.order["_id"]}, {"$set": {"captureFulfillmentStatus": "held", "paymentStatus": "paid"}})
    with case.app.app_context(), patch("app.order_confirmation.send_html_email", side_effect=AssertionError("must not send")) as mail:
        from app.order_confirmation import send_order_confirmation
        assert not send_order_confirmation(case.db, case.order, case.app.config, case.app.logger)
    mail.assert_not_called()


def test_queued_success_notification_is_fenced_again_at_worker_dispatch(order_case):
    case = order_case
    from app.whatsapp import process_outbox
    assert enqueue(case)["status"] == "queued"
    case.db.orders.update_one({"_id": case.order["_id"]}, {"$set": {"captureFulfillmentStatus": "held"}})
    with case.app.app_context():
        processed = process_outbox(case.db, case.app.config)
    assert processed == 1
    assert case.http.call_count == 0
    job = case.db.whatsapp_outbox.find_one()
    assert job["status"] == "invalid_payload"


def test_stable_capture_item_id_and_read_only_recovery_evidence(order_case):
    case = order_case
    product = {"_id": __import__("bson").ObjectId(), "stock": 4}
    case.db.products.insert_one(product)
    item = {"productId": str(product["_id"]), "quantity": 1}
    case.db.orders.update_one({"_id": case.order["_id"]}, {"$set": {"items": [item], "razorpayPaymentId": "capture-fixture"}})
    op_id = capture_operation_id(case.order["_id"], "capture-fixture", 0)
    assert op_id == capture_operation_id(str(case.order["_id"]), "capture-fixture", 0)
    evidence = operation_evidence(case.db, case.db.orders.find_one({"_id": case.order["_id"]}))
    assert evidence["capture"][0]["operationId"] == op_id
    assert evidence["capture"][0]["state"] == "unresolved"
    assert not evidence["capture"][0]["markerMatches"]
    assert not capture_recoverable(evidence)


def test_completed_capture_has_atomic_product_marker_and_ledger(order_case):
    case = order_case
    from bson import ObjectId
    product = {"_id": ObjectId(), "stock": 5}
    case.db.products.insert_one(product)
    item = {"productId": str(product["_id"]), "quantity": 1}
    case.db.orders.update_one({"_id": case.order["_id"]}, {"$set": {"items": [item], "paymentStatus": "pending"}, "$unset": {"razorpayPaymentId": "", "paymentVerifiedAt": ""}})
    with case.app.app_context(), patch("app.order_confirmation.send_html_email", return_value={"id": "mock"}):
        from app.blueprints.payments.routes import _fulfil_paid_order
        order, changed = _fulfil_paid_order(case.db, case.db.orders.find_one({"_id": case.order["_id"]}), "capture-marker", "test", "")
    op_id = capture_operation_id(order["_id"], "capture-marker", 0)
    saved_product = case.db.products.find_one({"_id": product["_id"]})
    marker = next(m for m in saved_product["inventoryOperationMarkers"] if m["operationId"] == op_id)
    ledger = case.db.inventory_operations.find_one({"_id": op_id})
    assert changed and order["captureFulfillmentStatus"] == "completed"
    assert saved_product["stock"] == 4 and marker["state"] == "applied" and marker["stockDelta"] == -1
    assert ledger["state"] == "applied" and ledger["productMarkerObserved"] is True


def test_manual_recovery_rejects_a_reservation_marker_from_another_claim(order_case):
    case = order_case
    from bson import ObjectId

    product_id = ObjectId()
    order_id = case.order["_id"]
    case.db.products.insert_one({
        "_id": product_id,
        "manualReservations": [f"{order_id}:0"],
        "inventoryOperationMarkers": [{
            "operationId": manual_operation_id(order_id, 0, "older-claim"), "state": "reserved",
            "operationType": "manual_reservation", "productId": str(product_id),
                "orderId": str(order_id), "itemIndex": 0, "quantity": 1,
                "stockDelta": -1, "claimToken": "older-claim",
        }],
    })
    item = {"productId": str(product_id), "quantity": 1}
    order = {"_id": order_id, "paymentGateway": "manual", "inventoryReservation": "unresolved",
             "inventoryReservationClaimToken": "current-claim", "items": [item]}
    evidence = operation_evidence(case.db, order)
    assert evidence["manual"][0]["productMarkerPresent"]
    assert not evidence["manual"][0]["markerMatches"]
    assert not manual_reservation_recoverable(evidence)

    case.db.products.update_one({"_id": product_id}, {"$set": {
        "inventoryOperationMarkers.0.claimToken": "current-claim",
        "inventoryOperationMarkers.0.operationId": manual_operation_id(order_id, 0, "current-claim"),
    }})
    matching = operation_evidence(case.db, order)
    assert matching["manual"][0]["markerMatches"]
    assert manual_reservation_recoverable(matching)
    order["inventoryReservation"] = "reserved"
    from app.manual_inventory import reserve_manual_acceptance
    assert reserve_manual_acceptance(case.db, order, {}) == []


def test_legacy_accepted_manual_order_without_reservation_evidence_stays_blocked(order_case):
    case = order_case
    order = {"_id": case.order["_id"], "paymentGateway": "manual",
             "fulfillment": {"status": "confirmed"}, "items": [{"productId": "missing", "quantity": 1}]}
    case.db.orders.update_one({"_id": order["_id"]}, {"$set": order})
    assert persisted_inventory_block_reason(case.db, order) == "manual_inventory_unresolved"


def test_retry_endpoint_cannot_send_for_held_capture(order_case):
    case=order_case
    from app.blueprints.orders.routes import staff_orders_bp
    case.app.register_blueprint(staff_orders_bp,url_prefix="/api/staff/orders")
    case.db.orders.update_one({"_id":case.order["_id"]},{"$set":{"captureFulfillmentStatus":"held"}})
    with patch("app.blueprints.orders.routes.database",return_value=case.db),patch("app.order_confirmation.send_html_email") as smtp:
        response=case.client.post(f"/api/staff/orders/{case.order['_id']}/notifications/retry",headers=case.headers,json={"event":"order_confirmation"})
    assert response.status_code==200
    smtp.assert_not_called()
    assert case.db.whatsapp_outbox.count_documents({})==0
    assert not case.db.order_notification_activity.find_one({"status":"accepted"})
