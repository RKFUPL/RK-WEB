"""Harness-only regressions: no server, providers, or business mutations."""
import sys
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from bson import ObjectId

from integration import inventory_crash_worker as worker
from integration import test_inventory_real_mongodb as integration


class InjectedExit(BaseException):
    pass


@pytest.mark.parametrize("mode, expected", [
    ("capture", 71), ("capture-webhook", 71), ("capture-before-final", 80),
    ("manual-reserve", 61), ("compensate", 91), ("redeliver", None),
])
def test_child_modes_reach_the_requested_boundary_without_local_import_errors(monkeypatch, mode, expected):
    from app.blueprints.payments import routes as payments
    from app import manual_inventory, inventory_operations

    order = {"_id": ObjectId(), "_testCaptureId": "pay_synthetic", "captureClaimToken": "test-claim",
             "_testWebhookEventId": "evt_synthetic", "razorpayOrderId": "order_synthetic",
             "amountPaise": 100, "currency": "INR"}
    database = SimpleNamespace(orders=SimpleNamespace(find_one=lambda *_a, **_kw: order))
    product = SimpleNamespace(name="products")
    order_collection = SimpleNamespace(name="orders")
    monkeypatch.setenv("RK_INVENTORY_TEST_MONGODB_URI", "mongodb://localhost/rk_inventory_test_harness01")
    monkeypatch.setenv("RK_INVENTORY_TEST_DBNAME", "rk_inventory_test_harness01")
    monkeypatch.setattr(sys, "argv", ["inventory_crash_worker.py", mode, str(order["_id"]), "--fail-after", "1"])
    monkeypatch.setattr(worker, "MongoClient", lambda *_a, **_kw: {"rk_inventory_test_harness01": database})
    monkeypatch.setattr(worker.Collection, "update_one", lambda *_a, **_kw: SimpleNamespace(modified_count=1))
    monkeypatch.setattr(worker.Collection, "find_one_and_update", lambda *_a, **_kw: order)
    exits = []

    def terminate(code):
        exits.append(code)
        raise InjectedExit()

    def fulfil(*_args, **_kwargs):
        worker.Collection.update_one(product, {}, {"$push": {"inventoryOperationMarkers": {"state": "applied"}}})
        worker.Collection.find_one_and_update(order_collection, {}, {"$set": {"captureFulfillmentStatus": "completed"}})
        return order, True

    monkeypatch.setattr(worker.os, "_exit", terminate)
    monkeypatch.setattr(payments, "_fulfil_paid_order", fulfil)
    monkeypatch.setattr(payments, "send_order_confirmation", lambda *_a, **_kw: False)
    monkeypatch.setattr(payments, "database", lambda: database)
    monkeypatch.setattr(manual_inventory, "reserve_manual_acceptance", lambda *_a: worker.Collection.update_one(
        product, {}, {"$push": {"inventoryOperationMarkers": {"operationType": "manual_reservation"}}}))
    monkeypatch.setattr(inventory_operations, "compensate_capture_markers", lambda *_a: worker.Collection.update_one(
        product, {}, {"$set": {"inventoryOperationMarkers": [{"state": "compensated"}]}}))

    # Exercise child Flask dispatch without provider or Mongo I/O; the actual
    # signed webhook/database behavior belongs to the opt-in integration suite.
    monkeypatch.setattr(worker.Flask, "test_client", lambda *_a: SyntheticClient(fulfil))
    if expected is not None:
        with pytest.raises(InjectedExit):
            worker.main()
        assert exits == [expected]
    else:
        assert worker.main() == 0
        assert exits == []


class SyntheticClient:
    def __init__(self, fulfil):
        self.fulfil = fulfil

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def post(self, *_args, **_kwargs):
        self.fulfil()
        return SimpleNamespace(status_code=200)


def test_unexpected_child_exit_includes_full_redacted_diagnostics(monkeypatch):
    uri = "mongodb://sensitive-user:sensitive-password@localhost/rk_inventory_test_harness01"
    target = {"_uri": uri, "database_name": "rk_inventory_test_harness01"}
    seen = {}

    def failed_child(command, **kwargs):
        seen.update(command=command, **kwargs)
        return SimpleNamespace(returncode=1, stdout=b"complete stdout", stderr=(
            "Traceback: Collection UnboundLocalError\n" + uri).encode())

    monkeypatch.setattr(integration.subprocess, "run", failed_child)
    with pytest.raises(pytest.fail.Exception) as failure:
        integration._run_crash_worker(target, {"_id": ObjectId()}, "capture", 1)
    message = str(failure.value)
    assert "mode=capture, failure_index=1" in message
    assert "Return code: 1; expected: 71" in message
    assert "Command:" in message and sys.executable in message
    assert "Working directory:" in message and "complete stdout" in message
    assert "Collection UnboundLocalError" in message
    assert uri not in message and "sensitive-password" not in message
    assert seen["command"][0] == sys.executable
    assert seen["cwd"] == integration.BACKEND
    assert seen["env"]["RK_INVENTORY_TEST_MONGODB_URI"] == uri
    assert seen["env"]["PYTHONPATH"] == str(integration.BACKEND)
