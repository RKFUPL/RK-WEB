"""Real MongoDB failure-injection tests. Opt in with the guarded URI fixture.

All payment, SMTP, and WhatsApp transports are mocked or bypassed. No provider
credentials are read, and no test starts a worker or sends a message.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
import hashlib
import hmac
import json
import os
import re
from pathlib import Path
import subprocess
import sys
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

from bson import ObjectId
from flask import Flask
from flask_jwt_extended import create_access_token
import pytest

from app.extensions import jwt, limiter
from app.inventory_operations import (
    capture_operation_id,
    inventory_block_reason,
    operation_evidence,
    capture_recoverable,
    compensate_capture_markers,
)
from app.manual_inventory import reserve_manual_acceptance, rollback_manual_acceptance
from app.order_fulfillment import OrderTransitionError, apply_transition

pytestmark = pytest.mark.real_mongodb
BACKEND = Path(__file__).resolve().parents[2]
CRASH_HELPER = Path(__file__).with_name("inventory_crash_worker.py")
_SECRET = "isolated-test-webhook-signature-key"


def _stock_product(sandbox, stock: int, *, variants: bool = False):
    product_id = ObjectId()
    document = {"_id": product_id, "status": "active", "isActive": True,
                "stock": stock, "sizeInventoryConfigured": False}
    if variants:
        document["variants"] = [{"id": "colour:ivory", "sku": f"SKU-{product_id}", "status": "active",
                                 "stock": stock, "sizeInventory": [{"size": "S", "stock": stock}]}]
    return sandbox["insert_product"](document)


def _capture_order(sandbox, products, *, status="pending"):
    order_id = ObjectId()
    capture_id = "pay_test_" + uuid4().hex
    razorpay_order_id = "order_test_" + uuid4().hex
    items = [{"productId": str(product["_id"]), "quantity": quantity, "size": ""}
             for product, quantity in products]
    order = {
        "_id": order_id, "orderNumber": "RK-TEST-" + uuid4().hex[:12].upper(),
        "paymentGateway": "razorpay", "razorpayOrderId": razorpay_order_id,
        "paymentStatus": status, "payment": {"gateway": "razorpay", "status": status,
                                                "razorpayOrderId": razorpay_order_id},
        "currency": "INR", "amountPaise": 250000, "total": 2500,
        "status": "order_placed", "fulfillmentStatus": "order_placed",
        "fulfillment": {"status": "order_placed"}, "items": items,
        "timeline": [], "createdAt": datetime.now(timezone.utc),
        "_testCaptureId": capture_id, "_testWebhookEventId": "evt_test_" + uuid4().hex,
    }
    return sandbox["insert_order"](order)


def _manual_order(sandbox, products):
    items = [{"productId": str(product["_id"]), "variantId": "colour:ivory",
              "sku": product["variants"][0]["sku"], "size": "S", "quantity": quantity}
             for product, quantity in products]
    return sandbox["insert_order"]({
        "_id": ObjectId(), "orderNumber": "RK-MANUAL-TEST-" + uuid4().hex[:10].upper(),
        "paymentGateway": "manual", "paymentStatus": "pending",
        "payment": {"gateway": "manual", "status": "pending"},
        "status": "order_placed", "fulfillmentStatus": "order_placed",
        "fulfillment": {"status": "order_placed"}, "items": items, "timeline": [],
    })


def _run_capture(db, order, application=None):
    from app.blueprints.payments.routes import _fulfil_paid_order
    app = application or Flask("rk-real-mongo-inventory-test")
    app.config.update(SECRET_KEY="isolated-inventory-test-secret",
                      JWT_SECRET_KEY="isolated-inventory-test-jwt-secret",
                      WHATSAPP_ENABLED=False, WHATSAPP_ORDER_NOTIFICATIONS_ENABLED=False,
                      WHATSAPP_MARKETING_ENABLED=False)
    with app.app_context(), patch("app.blueprints.payments.routes.send_order_confirmation", return_value=False):
        return _fulfil_paid_order(db, db.orders.find_one({"_id": order["_id"]}),
                                  order["_testCaptureId"], "isolated_integration_test", "")


def _assert_capture_evidence(db, order, expected_states):
    saved = db.orders.find_one({"_id": order["_id"]})
    evidence = operation_evidence(db, saved)
    assert len(evidence["capture"]) == len(expected_states)
    for row, expected in zip(evidence["capture"], expected_states):
        assert row["state"] == expected
        assert row["markerMatches"] is (expected == "applied")
        if expected == "applied":
            ledger = db.inventory_operations.find_one({"_id": row["operationId"]})
            assert ledger and ledger["state"] == "applied"
            product = db.products.find_one({"_id": ObjectId(row["productId"])})
            marker = next(m for m in product["inventoryOperationMarkers"] if m["operationId"] == row["operationId"])
            assert marker["state"] == "applied" and marker["stockDelta"] == -row["quantity"]
    return saved, evidence


def _minimal_staff_app(db, monkeypatch, track_user):
    from app.blueprints.orders import routes as order_routes
    import app.rbac as rbac
    from app.blueprints.orders.routes import staff_orders_bp

    app = Flask("rk-real-mongo-staff-inventory-test")
    app.config.update(TESTING=True, SECRET_KEY="isolated-staff-test-secret",
                      JWT_SECRET_KEY="isolated-staff-test-jwt-secret-at-least-32-bytes",
                      JWT_TOKEN_LOCATION=["headers"], JWT_ACCESS_TOKEN_EXPIRES=timedelta(minutes=5),
                      RATELIMIT_STORAGE_URI="memory://")
    jwt.init_app(app)
    limiter.init_app(app)
    app.register_blueprint(staff_orders_bp, url_prefix="/api/staff/orders")
    monkeypatch.setattr(order_routes, "database", lambda: db)
    monkeypatch.setattr(rbac, "database", lambda: db)
    monkeypatch.setattr(order_routes, "_staff_view", lambda _db, order: {"id": str(order["_id"])})
    monkeypatch.setattr(order_routes, "send_order_confirmation", lambda *_args, **_kwargs: False)
    user_id = ObjectId()
    db.users.insert_one({"_id": user_id, "role": "admin", "isActive": True,
                         "email": f"inventory-{uuid4().hex}@example.test"})
    track_user(user_id)
    with app.app_context():
        token = create_access_token(identity=str(user_id))
    return app, {"Authorization": f"Bearer {token}"}, user_id


def _signed_capture_payload(order, event_id=None):
    payload = {"id": event_id or order["_testWebhookEventId"], "event": "payment.captured",
               "payload": {"payment": {"entity": {
                   "id": order["_testCaptureId"], "order_id": order["razorpayOrderId"],
                   "amount": order["amountPaise"], "currency": order["currency"],
                   "status": "captured",
               }}}}
    body = json.dumps(payload, separators=(",", ":")).encode()
    signature = hmac.new(_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return body, signature, payload["id"]


def _run_crash_worker(target, order, mode, fail_after=1):
    # Pass only a minimal environment. The URI remains in the child environment
    # and is never included in command arguments, output, or assertion messages.
    child_env = {name: os.environ[name] for name in ("PATH", "SystemRoot", "TEMP", "TMP") if name in os.environ}
    child_env.update({
        "RK_INVENTORY_TEST_MONGODB_URI": target["_uri"],
        "RK_INVENTORY_TEST_DBNAME": target["database_name"],
        "MONGO_DB": target["_uri"], "MONGO_URI": target["_uri"],
        "DB_NAME": target["database_name"],
        "PYTHONPATH": str(BACKEND),
        "WHATSAPP_ENABLED": "false", "WHATSAPP_ORDER_NOTIFICATIONS_ENABLED": "false",
        "WHATSAPP_MARKETING_ENABLED": "false", "WHATSAPP_TEST_SEND_ENABLED": "false",
        "SECRET_KEY": "isolated-crash-test-secret", "JWT_SECRET_KEY": "isolated-crash-test-jwt-secret",
    })
    command = [sys.executable, str(CRASH_HELPER), mode, str(order["_id"]), "--fail-after", str(fail_after)]
    expected = {"manual-reserve": 60 + fail_after, "capture": 70 + fail_after,
                "capture-webhook": 70 + fail_after, "capture-before-final": 80,
                "compensate": 90 + fail_after, "redeliver": 0}[mode]

    def redact(value):
        text = value.decode("utf-8", errors="replace") if isinstance(value, bytes) else str(value or "")
        for key, secret in child_env.items():
            if secret and any(part in key for part in ("URI", "SECRET", "TOKEN", "PASSWORD")):
                text = text.replace(secret, "<redacted>")
        return re.sub(r"mongodb(?:\+srv)?://[^\s\"'<>]+", "<redacted-mongodb-uri>", text)

    def diagnostic(code, stdout, stderr):
        return redact(f"Crash worker failed: mode={mode}, failure_index={fail_after}\n"
                      f"Command: {subprocess.list2cmdline(command)}\n"
                      f"Working directory: {BACKEND}\n"
                      f"Return code: {code}; expected: {expected}\n"
                      f"Child stdout:\n{redact(stdout)}\nChild stderr:\n{redact(stderr)}")

    try:
        result = subprocess.run(command, cwd=BACKEND, env=child_env, capture_output=True, timeout=45)
    except subprocess.TimeoutExpired as error:
        pytest.fail(diagnostic("timeout", error.stdout, error.stderr), pytrace=False)
    except OSError as error:
        pytest.fail(diagnostic("launch error", "", str(error)), pytrace=False)
    if result.returncode != expected:
        pytest.fail(diagnostic(result.returncode, result.stdout, result.stderr), pytrace=False)
    return result.returncode


def test_manual_order_reservation_release_and_safe_retry(inventory_sandbox):
    box = inventory_sandbox
    product = _stock_product(box, 4, variants=True)
    order = box["insert_order"]({
        "_id": ObjectId(), "paymentGateway": "manual", "paymentStatus": "pending",
        "fulfillment": {"status": "order_placed"}, "status": "order_placed",
        "items": [{"productId": str(product["_id"]), "variantId": "colour:ivory",
                   "sku": product["variants"][0]["sku"], "size": "S", "quantity": 1}],
    })
    db = box["db"]
    first = reserve_manual_acceptance(db, order, {})
    current = db.orders.find_one({"_id": order["_id"]})
    reserved_product = db.products.find_one({"_id": product["_id"]})
    assert reserved_product["variants"][0]["sizeInventory"][0]["stock"] == 3
    marker = reserved_product["inventoryOperationMarkers"][0]
    assert marker["state"] == "reserved" and marker["stockDelta"] == -1
    assert marker["claimToken"] == current["inventoryReservationClaimToken"]

    rollback_manual_acceptance(db, current, first)
    released = db.products.find_one({"_id": product["_id"]})
    assert released["variants"][0]["sizeInventory"][0]["stock"] == 4
    assert released["inventoryOperationMarkers"][0]["state"] == "compensated"
    # A second release from the stale claim cannot restore stock again.
    rollback_manual_acceptance(db, current, first)
    assert db.products.find_one({"_id": product["_id"]})["variants"][0]["sizeInventory"][0]["stock"] == 4

    retry_order = db.orders.find_one({"_id": order["_id"]})
    reserve_manual_acceptance(db, retry_order, {})
    active = db.products.find_one({"_id": product["_id"]})
    markers = active["inventoryOperationMarkers"]
    assert active["variants"][0]["sizeInventory"][0]["stock"] == 3
    assert len(markers) == 2 and markers[0]["operationId"] != markers[1]["operationId"]
    assert [entry["state"] for entry in markers] == ["compensated", "reserved"]


@pytest.mark.parametrize("fail_after", [1, 2, 3])
def test_manual_acceptance_process_termination_after_each_product_update(inventory_sandbox, monkeypatch, fail_after):
    box = inventory_sandbox
    products = [_stock_product(box, 6, variants=True) for _ in range(3)]
    order = _manual_order(box, list(zip(products, (1, 2, 1))))
    assert _run_crash_worker(box, order, "manual-reserve", fail_after) == 60 + fail_after
    saved = box["db"].orders.find_one({"_id": order["_id"]})
    assert saved["inventoryReservation"] == "reserving"
    assert inventory_block_reason(saved) == "manual_inventory_unresolved"
    stocks = [box["db"].products.find_one({"_id": product["_id"]})["variants"][0]["sizeInventory"][0]["stock"]
              for product in products]
    assert stocks == [6 - quantity if index < fail_after else 6
                      for index, quantity in enumerate((1, 2, 1))]
    evidence = operation_evidence(box["db"], saved)
    assert sum(row["markerMatches"] for row in evidence["manual"]) == fail_after
    with pytest.raises(OrderTransitionError) as raised:
        apply_transition(box["db"], saved, "confirmed", "staff", {"_id": ObjectId()}, {})
    assert raised.value.code == "inventory_reconciliation_required"

    app, headers, _user_id = _minimal_staff_app(box["db"], monkeypatch, box["track_user"])
    with app.test_client() as client:
        response = client.post(f"/api/staff/orders/{order['_id']}/inventory-reconciliation",
                               headers=headers, json={"action": "reconcile_product_markers",
                                                     "reason": "Verify manual reservation markers"})
    if fail_after < len(products):
        assert response.status_code == 409
        assert box["db"].orders.find_one({"_id": order["_id"]})["inventoryReservation"] == "reserving"
        return
    assert response.status_code == 200
    recovered = box["db"].orders.find_one({"_id": order["_id"]})
    assert recovered["inventoryReservation"] == "reserved"
    before = [box["db"].products.find_one({"_id": product["_id"]})["variants"][0]["sizeInventory"][0]["stock"]
              for product in products]
    with patch("app.order_fulfillment.send_status_notification"):
        apply_transition(box["db"], recovered, "confirmed", "staff", {"_id": ObjectId()}, {})
    after = [box["db"].products.find_one({"_id": product["_id"]})["variants"][0]["sizeInventory"][0]["stock"]
             for product in products]
    assert after == before == [5, 4, 5]


def test_capture_deducts_multiple_products_once_with_durable_evidence(inventory_sandbox):
    box = inventory_sandbox
    products = [_stock_product(box, 9), _stock_product(box, 5), _stock_product(box, 7)]
    order = _capture_order(box, list(zip(products, (2, 1, 3))))
    result, applied = _run_capture(box["db"], order)
    assert applied and result["captureFulfillmentStatus"] == "completed"
    saved, _ = _assert_capture_evidence(box["db"], order, ["applied"] * 3)
    assert saved["paymentStatus"] == "paid"
    stocks = [box["db"].products.find_one({"_id": p["_id"]})["stock"] for p in products]
    assert stocks == [7, 4, 4]
    retried, changed = _run_capture(box["db"], order)
    assert not changed and retried["captureFulfillmentStatus"] == "completed"
    assert [box["db"].products.find_one({"_id": p["_id"]})["stock"] for p in products] == stocks


def test_concurrent_duplicate_signed_capture_webhooks_change_stock_once(inventory_sandbox, monkeypatch):
    from app.blueprints.payments import routes as payment_routes
    from app.blueprints.payments.routes import razorpay_webhook_bp
    box = inventory_sandbox
    product = _stock_product(box, 6)
    order = _capture_order(box, [(product, 2)])
    app = Flask("rk-real-mongo-webhook-test")
    app.config.update(TESTING=True, SECRET_KEY="isolated-webhook-test-secret",
                      JWT_SECRET_KEY="isolated-webhook-jwt-secret", RAZORPAY_WEBHOOK_SECRET=_SECRET,
                      WHATSAPP_ENABLED=False, WHATSAPP_ORDER_NOTIFICATIONS_ENABLED=False,
                      WHATSAPP_MARKETING_ENABLED=False, RATELIMIT_STORAGE_URI="memory://")
    limiter.init_app(app)
    app.register_blueprint(razorpay_webhook_bp, url_prefix="/api/webhooks")
    monkeypatch.setattr(payment_routes, "database", lambda: box["db"])
    monkeypatch.setattr(payment_routes, "send_order_confirmation", lambda *_args, **_kwargs: False)
    body, signature, event_id = _signed_capture_payload(order)
    box["track_webhook_event"](event_id)
    barrier = Barrier(2)

    def deliver():
        with app.test_client() as client:
            barrier.wait(timeout=10)
            return client.post("/api/webhooks/razorpay", data=body,
                               headers={"X-Razorpay-Signature": signature,
                                        "Content-Type": "application/json"}).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _n: deliver(), range(2)))
    assert statuses == [200, 200]
    saved, _ = _assert_capture_evidence(box["db"], order, ["applied"])
    assert saved["captureFulfillmentStatus"] == "completed"
    assert box["db"].products.find_one({"_id": product["_id"]})["stock"] == 4
    marker_count = box["db"].products.count_documents({"_id": product["_id"],
        "inventoryOperationMarkers.operationId": capture_operation_id(order["_id"], order["_testCaptureId"], 0)})
    assert marker_count == 1


@pytest.mark.parametrize("fail_after", [1, 2, 3])
def test_process_termination_after_each_product_update_stays_blocked(inventory_sandbox, fail_after):
    box = inventory_sandbox
    products = [_stock_product(box, 10) for _ in range(3)]
    order = _capture_order(box, list(zip(products, (1, 2, 3))))
    exit_code = _run_crash_worker(box, order, "capture", fail_after)
    assert exit_code == 70 + fail_after
    saved = box["db"].orders.find_one({"_id": order["_id"]})
    assert saved["paymentStatus"] == "processing"
    assert saved["captureFulfillmentStatus"] == "processing"
    assert inventory_block_reason(saved) == "capture_inventory_unresolved"
    stocks = [box["db"].products.find_one({"_id": product["_id"]})["stock"] for product in products]
    assert stocks == [10 - n if n <= fail_after else 10 for n in (1, 2, 3)]
    evidence = operation_evidence(box["db"], saved)
    assert sum(row["productMarkerPresent"] for row in evidence["capture"]) == fail_after
    with pytest.raises(OrderTransitionError) as raised:
        apply_transition(box["db"], saved, "processing", "staff", {"_id": ObjectId()}, {})
    assert raised.value.code == "inventory_reconciliation_required"


def test_backend_restart_then_webhook_redelivery_does_not_deduct_twice(inventory_sandbox):
    box = inventory_sandbox
    products = [_stock_product(box, 8), _stock_product(box, 6)]
    order = _capture_order(box, list(zip(products, (2, 1))))
    box["track_webhook_event"](order["_testWebhookEventId"])
    assert _run_crash_worker(box, order, "capture-webhook", 1) == 71
    # A fresh Python process redelivers the same signed event after restart.
    assert _run_crash_worker(box, order, "redeliver") == 0
    assert [box["db"].products.find_one({"_id": p["_id"]})["stock"] for p in products] == [6, 6]
    saved = box["db"].orders.find_one({"_id": order["_id"]})
    assert saved["captureFulfillmentStatus"] == "processing"
    assert inventory_block_reason(saved)
    event = box["db"].razorpay_webhook_events.find_one({"eventId": order["_testWebhookEventId"]})
    assert event and event.get("processedAt")


def test_interruption_between_product_updates_and_order_completion_is_recoverable(inventory_sandbox, monkeypatch):
    box = inventory_sandbox
    products = [_stock_product(box, 8), _stock_product(box, 4)]
    order = _capture_order(box, list(zip(products, (2, 1))))
    box["db"].orders.update_one({"_id": order["_id"]}, {"$set": {
        "payment.providerMetadata": {"reference": "synthetic-preserved-reference"},
        "refundEvidence": {"reviewReference": "synthetic-preserved-review"},
        "staffMetadata": {"note": "synthetic-preserved-note"},
        "inventoryRecoveryAudit": [{"action": "prior_test_observation"}],
    }})
    assert _run_crash_worker(box, order, "capture-before-final") == 80
    saved, evidence = _assert_capture_evidence(box["db"], order, ["applied", "applied"])
    assert saved["captureFulfillmentStatus"] == "processing"
    before = [box["db"].products.find_one({"_id": p["_id"]})["stock"] for p in products]
    app, headers, _user_id = _minimal_staff_app(box["db"], monkeypatch, box["track_user"])
    with app.test_client() as client:
        response = client.post(f"/api/staff/orders/{order['_id']}/inventory-reconciliation",
                               headers=headers, json={"action": "reconcile_product_markers",
                                                     "reason": "Verify persisted capture product markers"})
    assert response.status_code == 200
    recovered, _ = _assert_capture_evidence(box["db"], order, ["applied", "applied"])
    _assert_recovered_snapshot(saved, recovered)
    assert [box["db"].products.find_one({"_id": p["_id"]})["stock"] for p in products] == before


def _assert_recovered_snapshot(before, after):
    """Prove recovery changes confirmation fields, preserving saved evidence."""
    assert after["captureFulfillmentStatus"] == "completed"
    assert after["captureClaimToken"] == before["captureClaimToken"]
    assert after["captureEvidence"] == before["captureEvidence"]
    assert after.get("refunds") == before.get("refunds")
    assert after.get("refundEvidence") == before.get("refundEvidence")
    assert after.get("staffMetadata") == before.get("staffMetadata")
    assert after["paymentStatus"] == after["payment"]["status"] == "paid"
    assert after["payment"]["razorpayPaymentId"] == before["razorpayPaymentId"]
    assert after["payment"]["verifiedAt"] == after["paymentVerifiedAt"]
    for key, value in before["payment"].items():
        if key not in {"status", "razorpayPaymentId", "verifiedAt"}:
            assert after["payment"][key] == value
    assert after["fulfillmentStatus"] == after["fulfillment"]["status"] == "confirmed"
    prior_audit = before.get("inventoryRecoveryAudit", [])
    assert after["inventoryRecoveryAudit"][:-1] == prior_audit
    assert len(after["inventoryRecoveryAudit"]) == len(prior_audit) + 1
    audit = after["inventoryRecoveryAudit"][-1]
    assert audit["action"] == "reconcile_product_markers"
    assert audit["operationIds"] == [row["operationId"] for row in audit["before"]["capture"]]
    assert after["timeline"][:len(before["timeline"])] == before["timeline"]
    assert len(after["timeline"]) == len(before["timeline"]) + 2


def test_concurrent_and_duplicate_staff_reconciliation_is_idempotent(inventory_sandbox, monkeypatch):
    box = inventory_sandbox
    products = [_stock_product(box, 10), _stock_product(box, 7)]
    order = _capture_order(box, list(zip(products, (2, 1))))
    assert _run_crash_worker(box, order, "capture-before-final") == 80
    snapshot = box["db"].orders.find_one({"_id": order["_id"]})
    app, headers, _user_id = _minimal_staff_app(box["db"], monkeypatch, box["track_user"])
    barrier = Barrier(2)

    def reconcile():
        with app.test_client() as client:
            barrier.wait(timeout=10)
            return client.post(f"/api/staff/orders/{order['_id']}/inventory-reconciliation",
                               headers=headers, json={"action": "reconcile_product_markers",
                                                     "reason": "Concurrent marker verification"}).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = sorted(pool.map(lambda _n: reconcile(), range(2)))
    assert statuses == [200, 409]
    stock_after = [box["db"].products.find_one({"_id": p["_id"]})["stock"] for p in products]
    assert stock_after == [8, 6]
    recovered, _ = _assert_capture_evidence(box["db"], order, ["applied", "applied"])
    _assert_recovered_snapshot(snapshot, recovered)
    with app.test_client() as client:
        duplicate = client.post(f"/api/staff/orders/{order['_id']}/inventory-reconciliation",
                                headers=headers, json={"action": "reconcile_product_markers",
                                                      "reason": "Duplicate reconciliation request"})
    assert duplicate.status_code == 409
    assert [box["db"].products.find_one({"_id": p["_id"]})["stock"] for p in products] == stock_after
    assert box["db"].orders.find_one({"_id": order["_id"]}) == recovered


@pytest.mark.parametrize("fail_after", [1, 2])
def test_interrupted_compensation_can_resume_without_double_restoration(inventory_sandbox, fail_after):
    box = inventory_sandbox
    products = [_stock_product(box, 9), _stock_product(box, 6)]
    order = _capture_order(box, list(zip(products, (2, 1))))
    captured, applied = _run_capture(box["db"], order)
    assert applied
    before = [box["db"].products.find_one({"_id": p["_id"]})["stock"] for p in products]
    assert _run_crash_worker(box, order, "compensate", fail_after) == 90 + fail_after
    partially = [box["db"].products.find_one({"_id": p["_id"]})["stock"] for p in products]
    assert partially == [p["stock"] if index < fail_after else before[index]
                         for index, p in enumerate(products)]
    compensate_capture_markers(box["db"], order["_id"], captured["captureClaimToken"])
    restored = [box["db"].products.find_one({"_id": p["_id"]})["stock"] for p in products]
    assert restored == [9, 6]
    compensate_capture_markers(box["db"], order["_id"], captured["captureClaimToken"])
    assert [box["db"].products.find_one({"_id": p["_id"]})["stock"] for p in products] == restored
    final = operation_evidence(box["db"], box["db"].orders.find_one({"_id": order["_id"]}))
    assert all(row["compensated"] for row in final["capture"])


@pytest.mark.parametrize("damage", ["missing", "wrong_capture", "wrong_claim", "wrong_quantity", "wrong_state", "duplicate_conflict"])
def test_ambiguous_capture_markers_never_authorize_recovery(inventory_sandbox, monkeypatch, damage):
    box = inventory_sandbox
    product = _stock_product(box, 5)
    order = _capture_order(box, [(product, 1)])
    assert _run_crash_worker(box, order, "capture-before-final") == 80
    current = box["db"].orders.find_one({"_id": order["_id"]})
    op_id = capture_operation_id(order["_id"], order["_testCaptureId"], 0)
    if damage == "missing":
        box["db"].products.update_one({"_id": product["_id"]}, {"$pull": {"inventoryOperationMarkers": {"operationId": op_id}}})
    elif damage == "duplicate_conflict":
        marker = box["db"].products.find_one({"_id": product["_id"]})["inventoryOperationMarkers"][0]
        box["db"].products.update_one({"_id": product["_id"]}, {"$push": {"inventoryOperationMarkers": {**marker, "claimToken": "conflicting-claim"}}})
    else:
        changes = {"wrong_capture": {"inventoryOperationMarkers.$.captureId": "different-capture"},
                   "wrong_claim": {"inventoryOperationMarkers.$.claimToken": "stale-claim"},
                   "wrong_state": {"inventoryOperationMarkers.$.state": "planned"},
                   "wrong_quantity": {"inventoryOperationMarkers.$.quantity": 99}}[damage]
        box["db"].products.update_one({"_id": product["_id"], "inventoryOperationMarkers.operationId": op_id}, {"$set": changes})
    evidence = operation_evidence(box["db"], current)
    assert not capture_recoverable(evidence)
    app, headers, _user_id = _minimal_staff_app(box["db"], monkeypatch, box["track_user"])
    with app.test_client() as client:
        response = client.post(f"/api/staff/orders/{order['_id']}/inventory-reconciliation",
                               headers=headers, json={"action": "reconcile_product_markers",
                                                     "reason": "Marker evidence requires review"})
    assert response.status_code == 409
    assert box["db"].orders.find_one({"_id": order["_id"]})["captureFulfillmentStatus"] == "processing"
    assert box["db"].products.find_one({"_id": product["_id"]})["stock"] == 4


def test_stale_capture_claim_or_operation_tokens_do_not_authorize_stock_changes(inventory_sandbox, monkeypatch):
    box = inventory_sandbox
    product = _stock_product(box, 5)
    order = _capture_order(box, [(product, 1)])
    assert _run_crash_worker(box, order, "capture-before-final") == 80
    current = box["db"].orders.find_one({"_id": order["_id"]})
    operation_id = capture_operation_id(order["_id"], order["_testCaptureId"], 0)

    # The order claim is the recovery fence. A stale value makes the product
    # marker ambiguous and staff reconciliation must leave stock untouched.
    box["db"].orders.update_one({"_id": order["_id"]}, {"$set": {"captureClaimToken": "stale-order-claim"}})
    stale_order = box["db"].orders.find_one({"_id": order["_id"]})
    assert not capture_recoverable(operation_evidence(box["db"], stale_order))
    app, headers, _user_id = _minimal_staff_app(box["db"], monkeypatch, box["track_user"])
    with app.test_client() as client:
        rejected = client.post(f"/api/staff/orders/{order['_id']}/inventory-reconciliation",
                               headers=headers, json={"action": "reconcile_product_markers",
                                                     "reason": "Stale capture claim requires review"})
    assert rejected.status_code == 409
    assert box["db"].products.find_one({"_id": product["_id"]})["stock"] == 4

    # A stale secondary operation claim also fails closed. Product proof must
    # never be treated as permission to overwrite conflicting claim ownership.
    box["db"].orders.update_one({"_id": order["_id"]}, {"$set": {"captureClaimToken": current["captureClaimToken"]}})
    box["db"].inventory_operations.update_one({"_id": operation_id}, {"$set": {"claimToken": "stale-ledger-claim"}})
    stale_ledger_app, stale_ledger_headers, _user_id = _minimal_staff_app(box["db"], monkeypatch, box["track_user"])
    with stale_ledger_app.test_client() as client:
        stale_ledger = client.post(f"/api/staff/orders/{order['_id']}/inventory-reconciliation",
                                   headers=stale_ledger_headers, json={"action": "reconcile_product_markers",
                                                                     "reason": "Stale ledger claim requires review"})
    assert stale_ledger.status_code == 409
    assert box["db"].products.find_one({"_id": product["_id"]})["stock"] == 4
    assert box["db"].orders.find_one({"_id": order["_id"]})["captureFulfillmentStatus"] == "processing"


@pytest.mark.parametrize("state", ["processing", "held"])
def test_notifications_and_fulfillment_stay_blocked_during_capture_work(inventory_sandbox, state):
    from app.order_confirmation import send_order_confirmation
    from app.order_fulfillment import send_status_notification
    from app.whatsapp_orders import notify_order_whatsapp
    box = inventory_sandbox
    product = _stock_product(box, 4)
    order = _capture_order(box, [(product, 1)])
    box["db"].orders.update_one({"_id": order["_id"]}, {"$set": {
        "paymentStatus": "paid", "payment.status": "paid", "paymentVerifiedAt": datetime.now(timezone.utc),
        "razorpayPaymentId": order["_testCaptureId"], "captureFulfillmentStatus": state,
        "captureClaimToken": "incomplete-claim", "email": "customer@example.test",
    }})
    app = Flask("rk-real-mongo-notification-block-test")
    app.config.update(SECRET_KEY="inventory-notification-test-secret",
                      JWT_SECRET_KEY="inventory-notification-test-jwt-secret",
                      WHATSAPP_ENABLED=False, WHATSAPP_ORDER_NOTIFICATIONS_ENABLED=False,
                      WHATSAPP_MARKETING_ENABLED=False)
    with app.app_context(), patch("app.order_confirmation.send_html_email", side_effect=AssertionError("SMTP must not run")) as smtp, \
            patch("app.order_fulfillment.send_html_email", side_effect=AssertionError("SMTP must not run")) as status_smtp, \
            patch("app.order_confirmation.notify", side_effect=AssertionError("WhatsApp must not enqueue")) as initial_wa:
        assert not send_order_confirmation(box["db"], order, app.config, app.logger)
        send_status_notification(box["db"], order, "processing")
        result = notify_order_whatsapp(box["db"], order["_id"], "processing")
    assert result["reason"] == "inventory_reconciliation_required"
    smtp.assert_not_called(); status_smtp.assert_not_called(); initial_wa.assert_not_called()
    assert box["db"].whatsapp_outbox.count_documents({"orderId": str(order["_id"])}) == 0
    assert box["db"].orders.find_one({"_id": order["_id"]})["captureFulfillmentStatus"] == state
