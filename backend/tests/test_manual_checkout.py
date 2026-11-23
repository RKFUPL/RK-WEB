"""In-memory order/payment tests. All transport is mocked; no provider or database connections."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import mongomock
import pytest
from bson import ObjectId
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from app.blueprints.payments.routes import payments_bp
from app.blueprints.orders.routes import customer_orders_bp, staff_orders_bp
from app.blueprints.admin.routes import admin_bp, storefront_lookbooks_bp, SETTINGS_DEFAULTS
from app.manual_payments import payment_summary, record_payment
from app.order_confirmation import email_image_url, render_order_confirmation
from app.order_fulfillment import apply_transition, OrderTransitionError, OrderTransitionConflict


@pytest.fixture
def shop():
    db = mongomock.MongoClient(tz_aware=True).manual_checkout
    app = Flask(__name__)
    app.config.update(TESTING=True, RATELIMIT_ENABLED=False, JWT_SECRET_KEY="manual-tests-signing-key-long-enough", WHATSAPP_APP_SECRET="synthetic-manual-secret", WHATSAPP_CANONICAL_URL="https://rashikapoor.co.in")
    JWTManager(app)
    from app.extensions import limiter
    limiter.init_app(app)
    app.register_blueprint(payments_bp, url_prefix="/api/payments")
    app.register_blueprint(staff_orders_bp, url_prefix="/api/staff/orders")
    app.register_blueprint(customer_orders_bp, url_prefix="/api/orders")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(storefront_lookbooks_bp, url_prefix="/api")
    user = {"_id": ObjectId(), "role": "admin", "isActive": True, "email": "customer@example.test", "firstName": "Test", "phone": "+14155552671"}
    db.users.insert_one(user)
    db.admin_settings.insert_one({"_id": "store", "razorpayEnabled": False})
    product = {"_id": ObjectId(), "status": "active", "isActive": True, "name": "Couture", "sku": "PARENT", "price": 1000,
               "variants": [{"id": "colour:ivory", "sku": "PARENT-IVORY", "colour": "IVORY", "status": "active", "price": 1000,
                             "sizes": ["S", "M"], "stock": 3, "sizeInventory": [{"size": "S", "stock": 3}], "images": []}]}
    db.products.insert_one(product)
    with app.app_context():
        headers = {"Authorization": "Bearer " + create_access_token(identity=str(user["_id"]))}
    payload = {"checkoutAttemptId": "attempt-fixture-001", "cart": [{"productId": str(product["_id"]), "variantId": "colour:ivory", "sku": "PARENT-IVORY", "size": "S", "quantity": 1}],
               "shipping": {"fullName": "Test", "phone": user["phone"], "line1": "Test road", "city": "City", "state": "State", "country": "US", "postalCode": "12345"},
               "whatsappRecipient": user["phone"], "whatsappTransactionalConsent": False}
    with patch("app.rbac.database", return_value=db), patch("app.rbac.current_user", return_value=user), \
         patch("app.blueprints.payments.routes.database", return_value=db), patch("app.blueprints.payments.routes.current_user", return_value=user), \
         patch("app.blueprints.orders.routes.database", return_value=db), patch("app.blueprints.orders.routes.current_user", return_value=user), \
         patch("app.blueprints.admin.routes.database", return_value=db), patch("app.blueprints.admin.routes.current_user", return_value=user), \
         patch("app.blueprints.payments.routes.authenticated_user_id", return_value=user["_id"]), \
         patch("app.blueprints.payments.routes.ensure_catalog_seed"), patch("app.blueprints.payments.routes.sync_product_variants", side_effect=lambda db, p: p), \
         patch("app.order_confirmation.send_html_email", return_value={"id": "mock-email"}) as mail, \
         patch("app.order_fulfillment.send_html_email", return_value={"id": "mock-status"}), app.app_context():
        yield db, app.test_client(), user, product, headers, payload, mail


def checkout(shop):
    db, client, user, product, headers, payload, mail = shop
    response = client.post("/api/payments/razorpay/order", headers=headers, json=payload)
    assert response.status_code in {200, 201}, response.json
    return db.orders.find_one({"_id": ObjectId(response.json["order"]["id"])})


def payment(shop, order, key="txn-first-001", **kwargs):
    return record_payment(shop[0], order, shop[2], {"transactionId": key, "amount": 100, "method": "upi", **kwargs})


def test_disabled_checkout_revalidates_is_idempotent_and_never_calls_razorpay(shop):
    with patch("app.blueprints.payments.routes.is_configured", side_effect=AssertionError("must not call")), \
         patch("app.blueprints.payments.routes.razorpay_api_request", side_effect=AssertionError("must not call")):
        first = checkout(shop)
        assert checkout(shop)["_id"] == first["_id"]
    assert shop[0].orders.count_documents({}) == 1
    assert first["status"] == "order_placed" and first["paymentStatus"] == first["payment"]["status"] == "pending"
    assert first["paymentGateway"] == "manual" and first["amountReceived"] == 0 and first["balanceDue"] == 1000
    assert not first.get("paymentVerifiedAt") and not first.get("razorpayPaymentId")
    assert shop[6].call_count == 1
    assert "order has been received" in shop[6].call_args.kwargs["html"]
    assert "pending team review" in shop[6].call_args.kwargs["html"] or "pending team" in shop[6].call_args.kwargs["html"] or "pending" in shop[6].call_args.kwargs["html"]
    assert not first["whatsappConsent"]["enabled"]


@pytest.mark.parametrize("field,value", [("quantity", 0), ("size", "INVALID"), ("sku", "WRONG"), ("variantId", "missing")])
def test_manual_cart_validation(shop, field, value):
    shop[5]["cart"][0][field] = value
    assert shop[1].post("/api/payments/razorpay/order", headers=shop[4], json=shop[5]).status_code == 400
    assert shop[0].orders.count_documents({}) == 0


def test_manual_response_omits_razorpay_fields_and_state_cannot_mutate_manual_order(shop):
    order = checkout(shop)
    response = shop[1].post("/api/payments/razorpay/order", headers=shop[4], json=shop[5])
    assert response.json["paymentMode"] == "manual" and "razorpay" not in response.json
    response = shop[1].post("/api/payments/razorpay/state", headers=shop[4], json={"orderId": str(order["_id"]), "state": "failed"})
    assert response.status_code == 400


def test_advance_half_and_final_are_derived_from_immutable_ledger(shop):
    order = payment(shop, checkout(shop), action="advance")
    assert payment_summary(order)["status"] == "partial"
    order = payment(shop, order, "txn-second-002", action="half")
    assert payment_summary(order)["received"] == 600
    assert payment_summary(order)["balanceDue"] == 400
    order = payment(shop, order, "txn-final-003", action="remaining")
    assert payment_summary(order)["status"] == order["payment"]["status"] == "paid"
    assert [t["amount"] for t in order["paymentTransactions"]] == [100, 500, 400]
    assert not order.get("paymentVerifiedAt") and not order.get("razorpayPaymentId")


@pytest.mark.parametrize("amount", [0, -1, 1001, "nan", "Infinity", "0.001", True])
def test_invalid_payments_rejected(shop, amount):
    with pytest.raises(ValueError):
        payment(shop, checkout(shop), amount=amount)


def test_duplicate_and_stale_concurrent_collections_rejected(shop):
    order = checkout(shop)
    updated = payment(shop, order)
    with pytest.raises(ValueError):
        payment(shop, updated)
    with pytest.raises(ValueError):
        payment(shop, order, "txn-stale-002", amount=950)
    assert shop[0].orders.find_one()["amountReceived"] == 100


def test_concurrent_collections_use_ledger_version_compare_and_swap(shop):
    order = checkout(shop)
    with patch("app.order_fulfillment.send_status_notification"):
        def collect(key):
            try:
                return payment(shop, order, key, amount=700)
            except ValueError as error:
                return error
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(collect, ["txn-race-a", "txn-race-b"]))
    successful = [outcome for outcome in outcomes if isinstance(outcome, dict)]
    rejected = [outcome for outcome in outcomes if isinstance(outcome, ValueError)]
    assert len(successful) == 1 and len(rejected) == 1
    saved = shop[0].orders.find_one({"_id": order["_id"]})
    assert len(saved["paymentTransactions"]) == 1
    assert saved["amountReceived"] == 700 and saved["balanceDue"] == 300


def test_payment_reversal_appends_immutable_compensation_and_reopens_balance(shop):
    from app.manual_payments import reverse_payment
    order = payment(shop, checkout(shop), amount=300)
    original = order["paymentTransactions"][0].copy()
    reversed_order = reverse_payment(shop[0], order, shop[2], {
        "transactionId": "txn-reversal-001", "reverses": original["id"], "note": "Duplicate receipt correction",
    })
    assert reversed_order["paymentTransactions"][0] == original
    assert reversed_order["paymentTransactions"][1]["amountPaise"] == -30000
    assert reversed_order["amountReceived"] == 0 and reversed_order["balanceDue"] == 1000
    assert reversed_order["paymentStatus"] == "pending"
    with pytest.raises(ValueError, match="already been reversed"):
        reverse_payment(shop[0], reversed_order, shop[2], {
            "transactionId": "txn-reversal-002", "reverses": original["id"], "note": "Repeat correction",
        })


def test_overdue_only_with_expired_due_and_remaining_balance(shop):
    order = checkout(shop)
    assert payment_summary(order)["status"] == "pending"
    order = payment(shop, order, dueAt="2000-01-01")
    assert payment_summary(order)["status"] == "overdue"
    order = payment(shop, order, "txn-full-002", action="remaining")
    assert payment_summary(order)["status"] == "paid"


def test_razorpay_orders_cannot_accept_manual_payments(shop):
    order = checkout(shop)
    order["paymentGateway"] = "razorpay"; order["payment"]["gateway"] = "razorpay"
    with pytest.raises(ValueError, match="Razorpay"):
        payment(shop, order)


def test_acceptance_reserves_once_and_processing_does_not_reserve_again(shop):
    order = checkout(shop)
    updated = apply_transition(shop[0], order, "confirmed", "staff", shop[2], {})
    assert updated["paymentStatus"] == "pending" and updated["inventoryReservation"] == "reserved"
    assert shop[0].products.find_one()["variants"][0]["sizeInventory"][0]["stock"] == 2
    with pytest.raises((OrderTransitionError, OrderTransitionConflict)):
        apply_transition(shop[0], updated, "confirmed", "staff", shop[2], {})
    apply_transition(shop[0], updated, "processing", "staff", shop[2], {})
    assert shop[0].products.find_one()["variants"][0]["stock"] == 2


def test_stock_race_does_not_oversell_or_accept(shop):
    order = checkout(shop)
    shop[0].products.update_one({}, {"$set": {"variants.0.sizeInventory.0.stock": 0}})
    with pytest.raises(OrderTransitionError, match="Stock changed"):
        apply_transition(shop[0], order, "confirmed", "staff", shop[2], {})
    assert shop[0].orders.find_one()["fulfillment"]["status"] == "order_placed"
    assert not shop[0].orders.find_one().get("inventoryReservation")


def test_stale_acceptance_cannot_revert_a_committed_acceptance(shop):
    order = checkout(shop)
    apply_transition(shop[0], order, "confirmed", "staff", shop[2], {})
    with pytest.raises(OrderTransitionConflict):
        apply_transition(shop[0], order, "confirmed", "staff", shop[2], {})
    assert shop[0].orders.find_one()["fulfillment"]["status"] == "confirmed"
    assert shop[0].products.find_one()["variants"][0]["stock"] == 2


def test_multi_item_reservation_rolls_back_when_a_later_item_fails(shop):
    from copy import deepcopy
    other = deepcopy(shop[3]); other["_id"] = ObjectId()
    shop[0].products.insert_one(other)
    shop[5]["cart"].append({**shop[5]["cart"][0], "productId": str(other["_id"])})
    order = checkout(shop)
    shop[0].products.update_one({"_id": other["_id"]}, {"$set": {"variants.0.sizeInventory.0.stock": 0}})
    with pytest.raises(OrderTransitionError):
        apply_transition(shop[0], order, "confirmed", "staff", shop[2], {})
    first = shop[0].products.find_one({"_id": shop[3]["_id"]})
    assert first["variants"][0]["stock"] == 3 and first["manualReservations"] == []
    assert not shop[0].orders.find_one().get("inventoryReservation")


def test_safely_rolled_back_acceptance_can_be_retried_with_a_new_operation_identity(shop):
    from copy import deepcopy
    other = deepcopy(shop[3]); other["_id"] = ObjectId()
    shop[0].products.insert_one(other)
    shop[5]["cart"].append({**shop[5]["cart"][0], "productId": str(other["_id"])})
    order = checkout(shop)
    shop[0].products.update_one({"_id": other["_id"]}, {"$set": {"variants.0.sizeInventory.0.stock": 0}})
    with pytest.raises(OrderTransitionError):
        apply_transition(shop[0], order, "confirmed", "staff", shop[2], {})
    first = shop[0].products.find_one({"_id": shop[3]["_id"]})
    old_marker = next(marker for marker in first["inventoryOperationMarkers"] if marker.get("operationType") == "manual_reservation")
    assert old_marker["state"] == "compensated"
    shop[0].products.update_one({"_id": other["_id"]}, {"$set": {"variants.0.sizeInventory.0.stock": 1}})
    accepted = apply_transition(shop[0], shop[0].orders.find_one({"_id": order["_id"]}), "confirmed", "staff", shop[2], {})
    assert accepted["inventoryReservation"] == "reserved"
    first = shop[0].products.find_one({"_id": shop[3]["_id"]})
    active = [marker for marker in first["inventoryOperationMarkers"] if marker.get("operationType") == "manual_reservation" and marker.get("state") == "reserved"]
    assert len(active) == 1 and active[0]["operationId"] != old_marker["operationId"]
    assert first["variants"][0]["stock"] == 2


def test_failed_attempt_does_not_release_preexisting_reservation_marker(shop):
    from copy import deepcopy
    other = deepcopy(shop[3]); other["_id"] = ObjectId()
    shop[0].products.insert_one(other)
    shop[5]["cart"].append({**shop[5]["cart"][0], "productId": str(other["_id"])})
    order = checkout(shop)
    marker = f"{order['_id']}:0"
    shop[0].products.update_one({"_id": shop[3]["_id"]}, {
        "$set": {"variants.0.stock": 2, "variants.0.sizeInventory.0.stock": 2}, "$addToSet": {"manualReservations": marker},
    })
    shop[0].products.update_one({"_id": other["_id"]}, {"$set": {"variants.0.sizeInventory.0.stock": 0}})
    with pytest.raises(OrderTransitionError):
        apply_transition(shop[0], order, "confirmed", "staff", shop[2], {})
    first = shop[0].products.find_one({"_id": shop[3]["_id"]})
    assert first["variants"][0]["stock"] == 2
    assert first["variants"][0]["sizeInventory"][0]["stock"] == 2
    assert first["manualReservations"] == [marker]


def test_interrupted_acceptance_rolls_back_only_this_attempt_reservations(shop):
    order = checkout(shop)
    orders = shop[0].orders
    original = orders.find_one_and_update
    calls = 0

    def interrupt_after_reserving(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:  # reservation lock
            return original(*args, **kwargs)
        raise RuntimeError("simulated interrupted acceptance write")

    with patch.object(orders, "find_one_and_update", side_effect=interrupt_after_reserving):
        with pytest.raises(RuntimeError, match="interrupted"):
            apply_transition(shop[0], order, "confirmed", "staff", shop[2], {})
    product = shop[0].products.find_one({"_id": shop[3]["_id"]})
    assert product["variants"][0]["stock"] == 3
    assert product["variants"][0]["sizeInventory"][0]["stock"] == 3
    assert product.get("manualReservations", []) == []
    saved = orders.find_one({"_id": order["_id"]})
    assert saved["fulfillment"]["status"] == "order_placed"
    assert "inventoryReservation" not in saved


def test_availability_required_is_preserved_and_needs_explicit_staff_confirmation(shop):
    shop[5]["cart"][0]["size"] = "M"
    order = checkout(shop)
    assert order["requiresAvailabilityConfirmation"]
    with pytest.raises(OrderTransitionError, match="Explicitly"):
        apply_transition(shop[0], order, "confirmed", "staff", shop[2], {})
    updated = apply_transition(shop[0], order, "confirmed", "staff", shop[2], {"availabilityConfirmed": True})
    assert updated["requiresAvailabilityConfirmation"] and updated["availabilityDecision"]["status"] == "accepted"
    assert shop[0].products.find_one()["variants"][0]["stock"] == 3


def test_backend_settings_legacy_default_and_admin_authority(shop):
    shop[0].admin_settings.delete_many({})
    shop[0].admin_settings.insert_one({"_id": "store", "RAZORPAY_KEY_SECRET": "must-not-return"})
    assert shop[1].get("/api/storefront-settings").json["settings"]["razorpayEnabled"] is True
    assert "must-not-return" not in shop[1].get("/api/admin/settings", headers=shop[4]).text
    response = shop[1].put("/api/admin/settings", headers=shop[4], json={**SETTINGS_DEFAULTS, "razorpayEnabled": False})
    assert response.status_code == 200 and response.json["settings"]["razorpayEnabled"] is False
    with patch("app.rbac.current_user", return_value={**shop[2], "role": "staff", "permissions": ["orders:manage"]}):
        assert shop[1].put("/api/admin/settings", headers=shop[4], json=SETTINGS_DEFAULTS).status_code == 403


def test_collection_endpoint_authority_and_terms(shop):
    order = checkout(shop)
    path = f"/api/staff/orders/{order['_id']}"
    assert shop[1].post(path + "/payments", json={}).status_code == 401
    result = shop[1].patch(path + "/payment-instructions", headers=shop[4], json={"dueAt": "2030-01-01", "instructions": "Contact the studio for bank details."})
    assert result.status_code == 200 and result.json["order"]["paymentCollection"]["dueAt"]
    assert result.json["order"]["paymentCollection"]["instructions"]


def test_email_image_resolver_and_shared_rendering(shop):
    path = "/api/catalog/products/product123/media/media456?v=0123456789abcdef"
    assert email_image_url(path) == "https://rashikapoor.co.in" + path
    assert email_image_url("https://rashikapoor.co.in" + path) == "https://rashikapoor.co.in" + path
    assert email_image_url("https://res.cloudinary.com/public/image/upload/item.jpg")
    for unsafe in ["data:image/png;base64,AA", "javascript:alert(1)", "//evil.test/image", "/private/image", "https://user:pass@res.cloudinary.com/a", "https://evil.test/a", "https://evil.test" + path, "/api/catalog/products/product123/media/media456?token=private", "/api/catalog/products/../media/a"]:
        assert email_image_url(unsafe) == ""
    order = checkout(shop); order["items"][0]["image"] = path
    assert "https://rashikapoor.co.in" + path in render_order_confirmation(order)


def test_email_image_fallback_for_invalid_or_missing_images(shop):
    order = checkout(shop)
    for image in ("https://attacker.example/image.jpg", "data:image/png;base64,abc", ""):
        order["items"][0]["image"] = image
        rendered = render_order_confirmation(order)
        assert "aria-label='Product image unavailable'" in rendered
        assert "attacker.example" not in rendered
        assert "<img src=''" not in rendered
