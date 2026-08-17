from datetime import datetime, timezone
import html
import hashlib
import json
import re
import secrets

import resend
from bson import ObjectId
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, OperationFailure

from ...catalog import ensure_catalog_seed
from ...order_fulfillment import (
    actor_view,
    ensure_order_tracking,
    order_view as tracked_order_view,
    payment_confirmation_changes,
    payment_failure_changes,
    timeline_event,
)
from ...payments import RazorpayAPIError, is_configured, razorpay_api_request, verify_payment_signature, verify_webhook_signature
from ...rbac import current_user, database, requireAuth


payments_bp = Blueprint("payments", __name__)
razorpay_webhook_bp = Blueprint("razorpay_webhook", __name__)


class StockUnavailable(RuntimeError):
    pass


def _json_value(value):
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, list):
        return [_json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    return value


def _order_view(order: dict) -> dict:
    return tracked_order_view(order)


def _payment_response(order: dict) -> dict:
    return {
        "order": _order_view(order),
        "razorpay": {
            "keyId": current_app.config.get("RAZORPAY_KEY_ID", ""),
            "orderId": order.get("razorpayOrderId"),
            "amount": order.get("amountPaise"),
            "currency": order.get("currency", "INR"),
            "mode": current_app.config.get("RAZORPAY_MODE", "test"),
        },
    }


def _ensure_payment_indexes(db) -> None:
    for collection, spec, kwargs in (
        (db.orders, "razorpayOrderId", {"unique": True, "sparse": True}),
        (db.orders, [("customerId", 1), ("checkoutAttemptId", 1)], {"unique": True, "sparse": True}),
        (db.razorpay_webhook_events, "eventId", {"unique": True}),
    ):
        try:
            collection.create_index(spec, **kwargs)
        except OperationFailure:
            # Existing production databases may already have a compatible
            # index with a different name/options. Runtime payment safety does
            # not depend on replacing it during a request.
            continue


def _safe_text(value: object, maximum: int = 240) -> str:
    return str(value or "").strip()[:maximum]


def _normalise_shipping(db, user_id: ObjectId, payload: dict) -> dict:
    address_id = _safe_text(payload.get("addressId"), 64)
    if address_id:
        if not ObjectId.is_valid(address_id):
            raise ValueError("Choose a valid saved address.")
        saved = db.addresses.find_one({"_id": ObjectId(address_id), "userId": user_id})
        if not saved:
            raise ValueError("The saved address could not be found.")
        return {
            "addressId": address_id,
            "label": _safe_text(saved.get("label"), 60),
            "fullName": _safe_text(saved.get("fullName"), 120),
            "phone": _safe_text(saved.get("phone"), 30),
            "line1": _safe_text(saved.get("line1"), 240),
            "line2": _safe_text(saved.get("line2"), 240),
            "city": _safe_text(saved.get("city"), 100),
            "state": _safe_text(saved.get("state"), 100),
            "postalCode": _safe_text(saved.get("postalCode"), 30),
            "country": _safe_text(saved.get("country"), 80),
        }

    required = ("fullName", "phone", "line1", "city", "state", "postalCode", "country")
    if any(not _safe_text(payload.get(key)) for key in required):
        raise ValueError("Complete the shipping address before continuing.")
    phone = _safe_text(payload.get("phone"), 30)
    if not re.fullmatch(r"\+?[0-9\s().-]{7,20}", phone):
        raise ValueError("Enter a valid shipping phone number.")
    return {
        "label": _safe_text(payload.get("label") or "Checkout", 60),
        **{key: _safe_text(payload.get(key), 240 if key in {"line1", "line2"} else 120) for key in required},
        "line2": _safe_text(payload.get("line2"), 240),
    }


def _checkout_items(db, cart: object) -> tuple[list[dict], int]:
    if not isinstance(cart, list) or not cart or len(cart) > 50:
        raise ValueError("Your shopping bag is empty or contains too many items.")

    items = []
    seen = set()
    subtotal = 0
    for raw_item in cart:
        if not isinstance(raw_item, dict) or not ObjectId.is_valid(str(raw_item.get("productId") or "")):
            raise ValueError("One of the pieces in your bag is no longer available.")
        product_id = ObjectId(str(raw_item["productId"]))
        quantity = raw_item.get("quantity")
        try:
            quantity = int(quantity)
        except (TypeError, ValueError):
            quantity = 0
        if quantity < 1 or quantity > 50:
            raise ValueError("Choose a valid quantity for every piece.")

        variant = raw_item.get("variant") if isinstance(raw_item.get("variant"), dict) else None
        variant_id = _safe_text((variant or {}).get("id"), 80)
        key = (str(product_id), variant_id)
        if key in seen:
            raise ValueError("A piece appears more than once in your bag.")
        seen.add(key)

        product = db.products.find_one({"_id": product_id, "status": {"$ne": "archived"}, "isActive": {"$ne": False}})
        if not product:
            raise ValueError("One of the pieces in your bag is no longer available.")
        availability = str(product.get("availability") or ("sold_out" if int(product.get("stock") or 0) <= 0 else "in_stock")).lower()
        if availability == "sold_out":
            raise ValueError(f'{product.get("name") or "A selected piece"} is sold out.')
        price = product.get("price")
        try:
            price = round(float(price), 2)
        except (TypeError, ValueError):
            raise ValueError("A selected piece does not have a valid price.")
        if price < 0:
            raise ValueError("A selected piece does not have a valid price.")
        if availability == "in_stock" and quantity > int(product.get("stock") or 0):
            raise ValueError(f'There are only {int(product.get("stock") or 0)} of {product.get("name") or "this piece"} available.')

        line_total = round(price * quantity, 2)
        subtotal += line_total
        media = product.get("media") if isinstance(product.get("media"), list) else []
        items.append({
            "productId": str(product_id),
            "name": _safe_text(product.get("name"), 160),
            "sku": _safe_text(product.get("sku"), 80),
            "quantity": quantity,
            "unitPrice": price,
            "lineTotal": line_total,
            "image": media[0] if media and isinstance(media[0], str) else "",
            "availability": availability,
            "variant": {"id": variant_id, "name": _safe_text((variant or {}).get("name"), 60), "value": _safe_text((variant or {}).get("value"), 120)} if variant_id else None,
        })
    return items, int(round(subtotal))


def _new_order_document(user: dict, shipping: dict, items: list[dict], subtotal: int, attempt_id: str, now: datetime) -> dict:
    customer_name = " ".join(filter(None, (user.get("firstName"), user.get("lastName")))) or user.get("displayName") or user.get("username") or "RK Customer"
    order = {
        "orderNumber": f"RK-{now:%Y%m%d}-{secrets.token_hex(3).upper()}",
        "customerId": user["_id"],
        "checkoutAttemptId": attempt_id,
        "customerName": _safe_text(customer_name, 120),
        "email": _safe_text(user.get("email"), 160).lower(),
        "phone": _safe_text(user.get("phone") or shipping.get("phone"), 30),
        "shipping": shipping,
        "items": items,
        "subtotal": subtotal,
        "shippingCharge": 0,
        "tax": 0,
        "discount": 0,
        "total": subtotal,
        "amountPaise": subtotal * 100,
        "currency": "INR",
        "status": "pending_payment",
        "paymentGateway": "razorpay",
        "paymentStatus": "pending",
        "payment": {"status": "pending", "gateway": "razorpay", "razorpayOrderId": None, "razorpayPaymentId": None, "verifiedAt": None},
        "fulfillmentStatus": "order_placed",
        "fulfillment": {"status": "order_placed", "courier": "", "trackingNumber": "", "trackingUrl": "", "shippedAt": None, "deliveredAt": None},
        "createdAt": now,
        "updatedAt": now,
    }
    order["timeline"] = [timeline_event("order_placed", now, actor_view("customer", user), "Order placed.")]
    return order


def _send_order_confirmation(order: dict) -> None:
    api_key = current_app.config.get("RESEND_API_KEY")
    if not api_key or not order.get("email"):
        return
    resend.api_key = api_key
    customer = html.escape(str(order.get("customerName") or "Customer"))
    number = html.escape(str(order.get("orderNumber") or ""))
    total = html.escape(f'{order.get("currency", "INR")} {order.get("total", 0):,.0f}')
    resend.Emails.send({
        "from": f'{current_app.config["EMAIL_FROM_NAME"]} <{current_app.config["EMAIL_FROM"]}>',
        "to": [order["email"]],
        "subject": f"Rashi Kapoor order confirmed — {number}",
        "html": f"<p>Dear {customer},</p><p>Your order <strong>{number}</strong> has been confirmed.</p><p>Total: <strong>{total}</strong></p>",
    })


def _fulfil_paid_order(db, order: dict, payment_id: str, source: str, payment_signature: str = "") -> tuple[dict, bool]:
    now = datetime.now(timezone.utc)
    order = ensure_order_tracking(db, order)
    if order.get("paymentStatus") == "paid":
        return order, False

    locked = db.orders.find_one_and_update(
        {"_id": order["_id"], "paymentStatus": {"$in": ["pending", "order_created", "verification_pending", "failed", "cancelled"]}},
        {"$set": {"paymentStatus": "processing", "updatedAt": now}},
        return_document=ReturnDocument.AFTER,
    )
    if not locked:
        current = db.orders.find_one({"_id": order["_id"]})
        if current and current.get("paymentStatus") == "paid":
            return current, False
        raise ValueError("This payment is already being processed. Please refresh in a moment.")

    decremented: list[tuple[ObjectId, int]] = []
    try:
        for item in locked.get("items", []):
            product_id = ObjectId(str(item["productId"]))
            quantity = int(item.get("quantity") or 0)
            if str(item.get("availability") or "").lower() != "in_stock":
                continue
            result = db.products.update_one(
                {"_id": product_id, "status": {"$ne": "archived"}, "isActive": {"$ne": False}, "availability": "in_stock", "stock": {"$gte": quantity}},
                {"$inc": {"stock": -quantity}, "$set": {"updatedAt": now}},
            )
            if result.modified_count != 1:
                raise StockUnavailable("A selected piece is no longer available in the requested quantity.")
            decremented.append((product_id, quantity))

        fields, events = payment_confirmation_changes(locked, payment_id, source, payment_signature, now)
        updated = db.orders.find_one_and_update(
            {"_id": locked["_id"], "paymentStatus": "processing"},
            {"$set": fields, "$push": {"timeline": {"$each": events}}},
            return_document=ReturnDocument.AFTER,
        )
        if not updated:
            raise ValueError("The order could not be confirmed safely.")
    except Exception as error:
        for product_id, quantity in decremented:
            db.products.update_one({"_id": product_id}, {"$inc": {"stock": quantity}, "$set": {"updatedAt": now}})
        db.orders.update_one(
            {"_id": locked["_id"], "paymentStatus": "processing"},
            {"$set": {"status": "payment_failed", "paymentStatus": "stock_unavailable", "paymentFailureReason": str(error)[:240], "updatedAt": now}},
        )
        raise

    try:
        _send_order_confirmation(updated)
    except Exception:
        current_app.logger.exception("Unable to send order confirmation email")
    return updated, True


def _validate_payment_entity(order: dict, payment: dict) -> None:
    if str(payment.get("order_id") or "") != str(order.get("razorpayOrderId") or ""):
        raise ValueError("The payment does not belong to this order.")
    try:
        amount = int(payment.get("amount"))
    except (TypeError, ValueError):
        raise ValueError("Razorpay returned an invalid payment amount.")
    if amount != int(order.get("amountPaise") or 0) or str(payment.get("currency") or "INR") != order.get("currency", "INR"):
        raise ValueError("The payment amount does not match the order.")


@payments_bp.post("/razorpay/order")
@requireAuth
def create_razorpay_order():
    if not is_configured(current_app.config):
        return jsonify({"error": "Razorpay Test Mode is not configured on the backend."}), 503
    payload = request.get_json(silent=True) or {}
    attempt_id = _safe_text(payload.get("checkoutAttemptId"), 80)
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{8,80}", attempt_id):
        return jsonify({"error": "A valid checkout attempt is required."}), 400
    user = current_user()
    user_id = ObjectId(get_jwt_identity())
    db = database()
    _ensure_payment_indexes(db)
    ensure_catalog_seed(db)
    try:
        shipping = _normalise_shipping(db, user_id, payload.get("shipping") if isinstance(payload.get("shipping"), dict) else {})
        items, subtotal = _checkout_items(db, payload.get("cart"))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    existing = db.orders.find_one({"customerId": user_id, "checkoutAttemptId": attempt_id})
    if existing and existing.get("razorpayOrderId"):
        if existing.get("paymentStatus") in {"failed", "cancelled"}:
            existing = db.orders.find_one_and_update(
                {"_id": existing["_id"], "paymentStatus": {"$in": ["failed", "cancelled"]}},
                {"$set": {"status": "pending_payment", "paymentStatus": "order_created", "updatedAt": datetime.now(timezone.utc)}},
                return_document=ReturnDocument.AFTER,
            ) or existing
        return jsonify(_payment_response(existing)), 200

    now = datetime.now(timezone.utc)
    order = existing or _new_order_document(user, shipping, items, subtotal, attempt_id, now)
    if not existing:
        try:
            order["_id"] = db.orders.insert_one(order).inserted_id
        except DuplicateKeyError:
            order = db.orders.find_one({"customerId": user_id, "checkoutAttemptId": attempt_id})
            if not order:
                return jsonify({"error": "We could not start checkout safely. Please try again."}), 409
    try:
        razorpay_order = razorpay_api_request(current_app.config, "POST", "/orders", {
            "amount": order["amountPaise"],
            "currency": order["currency"],
            "receipt": order["orderNumber"],
            "notes": {"application_order_id": str(order["_id"]), "customer_id": str(user_id)},
        })
        razorpay_order_id = str(razorpay_order.get("id") or "").strip()
        if not razorpay_order_id:
            raise RazorpayAPIError("Razorpay did not return an order id.")
        order = db.orders.find_one_and_update(
            {"_id": order["_id"]},
            {"$set": {"razorpayOrderId": razorpay_order_id, "paymentStatus": "order_created", "updatedAt": datetime.now(timezone.utc)}},
            return_document=ReturnDocument.AFTER,
        )
    except RazorpayAPIError as error:
        db.orders.update_one({"_id": order["_id"]}, {"$set": {"paymentStatus": "creation_failed", "paymentFailureReason": str(error)[:240], "updatedAt": datetime.now(timezone.utc)}})
        current_app.logger.warning("Razorpay order creation failed: %s", error)
        return jsonify({"error": str(error)}), 502
    return jsonify(_payment_response(order)), 201


@payments_bp.post("/razorpay/verify")
@requireAuth
def verify_razorpay_payment():
    if not is_configured(current_app.config):
        return jsonify({"error": "Razorpay Test Mode is not configured on the backend."}), 503
    payload = request.get_json(silent=True) or {}
    payment_id = _safe_text(payload.get("razorpay_payment_id"), 80)
    callback_order_id = _safe_text(payload.get("razorpay_order_id"), 80)
    signature = _safe_text(payload.get("razorpay_signature"), 128)
    if not payment_id or not callback_order_id or not signature:
        return jsonify({"error": "The Razorpay payment response is incomplete."}), 400

    db = database()
    user_id = ObjectId(get_jwt_identity())
    order = db.orders.find_one({"customerId": user_id, "razorpayOrderId": callback_order_id})
    if not order:
        return jsonify({"error": "The checkout order could not be found."}), 404
    if order.get("paymentStatus") == "paid":
        if order.get("razorpayPaymentId") == payment_id:
            return jsonify({"order": _order_view(order), "alreadyProcessed": True}), 200
        return jsonify({"error": "This order has already been paid with another payment."}), 409
    if not verify_payment_signature(str(order["razorpayOrderId"]), payment_id, signature, current_app.config["RAZORPAY_KEY_SECRET"]):
        return jsonify({"error": "Payment verification failed."}), 400

    try:
        payment = razorpay_api_request(current_app.config, "GET", f"/payments/{payment_id}")
        _validate_payment_entity(order, payment)
        if str(payment.get("status") or "").lower() != "captured":
            return jsonify({"error": "Payment is not captured yet. Please wait or try again."}), 409
        confirmed, _ = _fulfil_paid_order(db, order, payment_id, "checkout", signature)
    except StockUnavailable as error:
        current_app.logger.error("Captured Razorpay payment could not reserve inventory: %s", error)
        return jsonify({"error": "Payment was received, but inventory needs staff attention before this order can be confirmed."}), 409
    except (RazorpayAPIError, ValueError) as error:
        return jsonify({"error": str(error)}), 409
    return jsonify({"order": _order_view(confirmed)}), 200


@payments_bp.post("/razorpay/state")
@requireAuth
def update_razorpay_state():
    payload = request.get_json(silent=True) or {}
    order_id = _safe_text(payload.get("orderId"), 64)
    state = _safe_text(payload.get("state"), 20).lower()
    reason = _safe_text(payload.get("reason"), 240)
    if not ObjectId.is_valid(order_id) or state not in {"failed", "cancelled"}:
        return jsonify({"error": "Invalid payment state."}), 400
    db = database()
    order = db.orders.find_one({"_id": ObjectId(order_id), "customerId": ObjectId(get_jwt_identity())})
    if not order:
        return jsonify({"error": "Order not found."}), 404
    if order.get("paymentStatus") == "paid":
        return jsonify({"order": _order_view(order), "alreadyProcessed": True}), 200
    now = datetime.now(timezone.utc)
    fields, event = payment_failure_changes(order, reason or ("Payment failed." if state == "failed" else "Customer cancelled payment."), now, cancelled=state == "cancelled")
    updated = db.orders.find_one_and_update(
        {"_id": order["_id"], "paymentStatus": {"$in": ["pending", "order_created", "verification_pending"]}},
        {"$set": fields, "$push": {"timeline": event}},
        return_document=ReturnDocument.AFTER,
    )
    return jsonify({"order": _order_view(updated or order)}), 200


@payments_bp.get("/orders/<order_id>")
@requireAuth
def get_customer_order(order_id: str):
    if not ObjectId.is_valid(order_id):
        return jsonify({"error": "Order not found."}), 404
    order = database().orders.find_one({"_id": ObjectId(order_id), "customerId": ObjectId(get_jwt_identity())})
    if not order:
        return jsonify({"error": "Order not found."}), 404
    return jsonify({"order": _order_view(ensure_order_tracking(database(), order))}), 200


@razorpay_webhook_bp.post("/razorpay")
def razorpay_webhook():
    raw_body = request.get_data(cache=True)
    secret = str(current_app.config.get("RAZORPAY_WEBHOOK_SECRET") or "").strip()
    received_signature = request.headers.get("X-Razorpay-Signature", "")
    if not secret:
        return jsonify({"error": "Razorpay webhook secret is not configured."}), 503
    if not received_signature or not verify_webhook_signature(raw_body, received_signature, secret):
        return jsonify({"error": "Invalid webhook signature."}), 400
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return jsonify({"error": "Invalid webhook payload."}), 400

    db = database()
    _ensure_payment_indexes(db)
    event_id = _safe_text(payload.get("id"), 120) or hashlib.sha256(raw_body).hexdigest()
    now = datetime.now(timezone.utc)
    try:
        db.razorpay_webhook_events.insert_one({"eventId": event_id, "event": payload.get("event"), "receivedAt": now, "payloadHash": hashlib.sha256(raw_body).hexdigest()})
    except DuplicateKeyError:
        return jsonify({"received": True, "duplicate": True}), 200

    event_name = str(payload.get("event") or "")
    payment_entity = (((payload.get("payload") or {}).get("payment") or {}).get("entity") or {})
    order_id = str(payment_entity.get("order_id") or "").strip()
    order = db.orders.find_one({"razorpayOrderId": order_id}) if order_id else None
    result = {"received": True, "event": event_name, "handled": False}
    try:
        if event_name == "payment.captured" and order:
            _validate_payment_entity(order, payment_entity)
            confirmed, _ = _fulfil_paid_order(db, order, str(payment_entity.get("id") or ""), "webhook")
            result.update({"handled": True, "orderId": str(confirmed["_id"])})
        elif event_name == "payment.failed" and order:
            fields, event = payment_failure_changes(order, _safe_text(((payment_entity.get("error_description") or payment_entity.get("error_reason"))), 240) or "Razorpay reported a failed payment.", now)
            db.orders.update_one(
                {"_id": order["_id"], "paymentStatus": {"$ne": "paid"}},
                {"$set": fields, "$push": {"timeline": event}},
            )
            result.update({"handled": True, "orderId": str(order["_id"])})
    except (StockUnavailable, ValueError) as error:
        current_app.logger.error("Razorpay webhook could not be applied: %s", error)
        result["error"] = str(error)
    db.razorpay_webhook_events.update_one({"eventId": event_id}, {"$set": {"processedAt": datetime.now(timezone.utc), "result": result}})
    return jsonify(result), 200
