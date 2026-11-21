"""Subprocess helper for true interpreter termination after a real Mongo write."""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
from pathlib import Path

from bson import ObjectId
from flask import Flask
from pymongo import MongoClient
from pymongo.collection import Collection
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("capture", "capture-webhook", "capture-before-final", "redeliver", "compensate", "manual-reserve"))
    parser.add_argument("order_id")
    parser.add_argument("--fail-after", type=int, default=1)
    args = parser.parse_args()
    uri = os.environ["RK_INVENTORY_TEST_MONGODB_URI"]
    client = MongoClient(uri, serverSelectionTimeoutMS=5000, connectTimeoutMS=5000,
                         appname="rk-inventory-crash-test", tz_aware=True)
    database = client[os.environ["RK_INVENTORY_TEST_DBNAME"]]
    order_id = ObjectId(args.order_id)

    if args.mode == "manual-reserve":
        from app.manual_inventory import reserve_manual_acceptance
        original_product_update = Collection.update_one
        product_writes = 0

        def manual_product_update(collection, *positional, **named):
            nonlocal product_writes
            update = named.get("update", positional[1] if len(positional) > 1 else {})
            result = original_product_update(collection, *positional, **named)
            markers = (update.get("$push") or {}).get("inventoryOperationMarkers", [])
            if isinstance(markers, dict):
                markers = markers.get("$each", [markers])
            if collection.name == "products" and result.modified_count and any(row.get("operationType") == "manual_reservation" for row in markers):
                product_writes += 1
                if product_writes == args.fail_after:
                    os._exit(60 + product_writes)
            return result

        with patch.object(Collection, "update_one", manual_product_update):
            order = database.orders.find_one({"_id": order_id})
            reserve_manual_acceptance(database, order, {})
        return 0

    if args.mode in {"capture", "capture-webhook", "capture-before-final", "redeliver"}:
        from app.blueprints.payments import routes as payment_routes
        from app.blueprints.payments.routes import razorpay_webhook_bp
        application = Flask("rk-inventory-crash-test")
        application.config.update(SECRET_KEY="local-inventory-test-secret",
                                  JWT_SECRET_KEY="local-inventory-test-jwt-secret",
                                  RAZORPAY_WEBHOOK_SECRET="isolated-test-webhook-signature-key")
        application.logger.disabled = True
        if args.mode in {"capture-webhook", "redeliver"}:
            from app.extensions import limiter
            application.config.update(TESTING=True, RATELIMIT_STORAGE_URI="memory://",
                                      WHATSAPP_ENABLED=False, WHATSAPP_ORDER_NOTIFICATIONS_ENABLED=False,
                                      WHATSAPP_MARKETING_ENABLED=False)
            limiter.init_app(application)
            application.register_blueprint(razorpay_webhook_bp, url_prefix="/api/webhooks")
            payment_routes.database = lambda: database
        original_product_update = Collection.update_one
        product_writes = 0

        def product_update(collection, *positional, **named):
            nonlocal product_writes
            update = named.get("update", positional[1] if len(positional) > 1 else {})
            result = original_product_update(collection, *positional, **named)
            if (collection.name == "products" and result.modified_count
                    and "inventoryOperationMarkers" in (update.get("$push") or {})):
                product_writes += 1
                if args.mode in {"capture", "capture-webhook"} and product_writes == args.fail_after:
                    os._exit(70 + product_writes)
            return result

        if args.mode == "capture-before-final":
            original_order_update = Collection.find_one_and_update

            def order_update(collection, query, update, *positional, **named):
                if collection.name == "orders" and (update.get("$set") or {}).get("captureFulfillmentStatus") == "completed":
                    os._exit(80)
                return original_order_update(collection, query, update, *positional, **named)

        payment_routes.send_order_confirmation = lambda *_args, **_kwargs: False
        with patch.object(Collection, "update_one", product_update):
            if args.mode == "capture-before-final":
                with patch.object(Collection, "find_one_and_update", order_update):
                    with application.app_context():
                        order = database.orders.find_one({"_id": order_id})
                        payment_routes._fulfil_paid_order(database, order, str(order["_testCaptureId"]), "test", "")
            elif args.mode in {"capture-webhook", "redeliver"}:
                with application.test_client() as client_context:
                    order = database.orders.find_one({"_id": order_id})
                    payload = {"id": order["_testWebhookEventId"], "event": "payment.captured",
                               "payload": {"payment": {"entity": {
                                   "id": order["_testCaptureId"], "order_id": order["razorpayOrderId"],
                                   "amount": order["amountPaise"], "currency": order["currency"],
                                   "status": "captured"}}}}
                    body = json.dumps(payload, separators=(",", ":")).encode()
                    signature = hmac.new(application.config["RAZORPAY_WEBHOOK_SECRET"].encode(),
                                         body, hashlib.sha256).hexdigest()
                    response = client_context.post("/api/webhooks/razorpay", data=body,
                                                   headers={"X-Razorpay-Signature": signature,
                                                            "Content-Type": "application/json"})
                    if response.status_code != 200:
                        return 2
            else:
                with application.app_context():
                    order = database.orders.find_one({"_id": order_id})
                    payment_routes._fulfil_paid_order(database, order, str(order["_testCaptureId"]), "test", "")
        return 0

    from app.inventory_operations import compensate_capture_markers
    order = database.orders.find_one({"_id": order_id})
    token = str(order["captureClaimToken"])
    original_product_update = Collection.update_one
    compensated_writes = 0

    def product_update(collection, *positional, **named):
        nonlocal compensated_writes
        update = named.get("update", positional[1] if len(positional) > 1 else {})
        result = original_product_update(collection, *positional, **named)
        markers = (update.get("$set") or {}).get("inventoryOperationMarkers", [])
        if collection.name == "products" and result.modified_count and any(row.get("state") == "compensated" for row in markers):
            compensated_writes += 1
            if compensated_writes == args.fail_after:
                os._exit(90 + compensated_writes)
        return result

    with patch.object(Collection, "update_one", product_update):
        compensate_capture_markers(database, order_id, token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
