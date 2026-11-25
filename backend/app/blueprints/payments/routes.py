from ...inventory import allocated_variant_total
import math
from datetime import datetime, timezone
import hashlib
import json
import re
import secrets

from bson import ObjectId
from flask import Blueprint, current_app, jsonify, request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, OperationFailure

from ...catalog import ensure_catalog_seed, is_excluded_collection, public_variant_primary_image
from ...inventory import STANDARD_SIZES, has_size_system, validate_custom_size
from ...order_fulfillment import (
    actor_view,
    ensure_order_tracking,
    normalisation_updates,
    order_view as tracked_order_view,
    payment_confirmation_changes,
    payment_failure_changes,
    timeline_event,
)
from ...whatsapp import notify
from ...whatsapp import normalize_phone
from ...checkout_whatsapp import checkout_recipient
from ...whatsapp_consent import consent_phone, order_consent_status, record_consent
from ...whatsapp_marketing_consent import record_marketing_consent
from ...order_confirmation import email_image_url, send_order_confirmation
from ...payments import RazorpayAPIError, is_configured, razorpay_api_request, verify_payment_signature, verify_webhook_signature
from ...product_variants import find_variant, sync_product_variants
from ...rbac import authenticated_user_id, current_user, database, requireAuth
from ...time_utils import json_value as serialize_json_value
from ...extensions import limiter
from ...payment_state import failure_fence, failure_snapshot


payments_bp = Blueprint("payments", __name__)
razorpay_webhook_bp = Blueprint("razorpay_webhook", __name__)


class StockUnavailable(RuntimeError):
    pass


def _json_value(value):
    return serialize_json_value(value)


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


def _display_currency(value: object) -> str:
    currency = _safe_text(value, 3).upper()
    if currency not in {"INR", "USD", "EUR", "AED", "GBP"}:
        raise ValueError("Choose a supported display currency.")
    return currency


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


def _checkout_items(db, cart: object) -> tuple[list[dict], float]:
    if not isinstance(cart, list) or not cart or len(cart) > 50:
        raise ValueError("Your shopping bag is empty or contains too many items.")

    items = []
    seen = set()
    subtotal = 0.0
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

        legacy_variant = raw_item.get("variant") if isinstance(raw_item.get("variant"), dict) else None
        variant_id = _safe_text(raw_item.get("variantId") or (legacy_variant or {}).get("id"), 120)
        requested_sku = _safe_text(raw_item.get("sku"), 120).upper()

        product = db.products.find_one({"_id": product_id, "status": {"$ne": "archived"}, "isActive": {"$ne": False}})
        if not product:
            raise ValueError("One of the pieces in your bag is no longer available.")
        product = sync_product_variants(db, product) or product
        variant = find_variant(product, variant_id)
        if not variant_id or not variant:
            raise ValueError(f'Select a valid colour for {product.get("name") or "this piece"}.')
        variant_status = str(variant.get("status") or "").strip().lower()
        if variant_status != "active":
            raise ValueError(f'{product.get("name") or "A selected piece"} in {variant.get("colour") or "the selected colour"} is sold out.')
        server_sku = _safe_text(variant.get("sku"), 120).upper()
        if not requested_sku or requested_sku != server_sku:
            raise ValueError("The selected colour SKU does not match the product variant.")

        raw_size = raw_item.get("size")
        size = _safe_text(raw_size, 20).upper()
        valid_sizes = [str(item).strip().upper() for item in variant.get("sizes", STANDARD_SIZES) if str(item).strip()]
        custom_size = validate_custom_size(product, raw_item.get("customSize"))
        requested_mode = _safe_text(raw_item.get("purchaseMode"), 30).lower()
        purchase_mode = requested_mode if requested_mode in {"standard_size", "custom_size"} else "custom_size" if custom_size else "standard_size"
        if purchase_mode == "custom_size" and not custom_size:
            raise ValueError("Complete the custom measurements before checkout.")
        if purchase_mode == "standard_size" and custom_size:
            raise ValueError("Choose either a standard size or custom measurements.")
        if size and custom_size:
            raise ValueError("Choose either a standard size or custom measurements.")
        if not size and not custom_size:
            raise ValueError(f'Select a size for {product.get("name") or "this piece"}.')
        if size and size not in valid_sizes:
            raise ValueError(f'{size} is not a valid size for {product.get("name") or "this piece"}.')
        key = (str(product_id), variant_id, size, json.dumps(custom_size, sort_keys=True) if custom_size else "")
        if key in seen:
            raise ValueError("A piece appears more than once in your bag.")
        seen.add(key)
        from ...sales import effective_catalog_price
        pricing = effective_catalog_price(db, product, variant)
        price = pricing['effectivePrice']
        if price is None or not math.isfinite(float(price)) or price <= 0:
            raise ValueError("A selected piece does not have a valid price.")
        line_total = round(price * quantity, 2)
        subtotal += line_total
        size_entry = next((entry for entry in variant.get("sizeInventory", []) if str(entry.get("size") or "").strip().upper() == size), None) if size else None
        requires_confirmation = purchase_mode == "custom_size" or not size_entry or int(size_entry.get("stock") or 0) < quantity
        image = email_image_url(public_variant_primary_image(product, variant_id))
        collection = next((item for item in db.collections.find(
            {"productRefs.productId": product_id},
            {"name": 1, "slug": 1, "collectionType": 1},
        ) if not is_excluded_collection(item)), None)
        items.append({
            "productId": str(product_id),
            "productCode": _safe_text(product.get("productCode") or product.get("sku") or product.get("name"), 120),
            "name": _safe_text(product.get("name"), 160),
            "parentSku": _safe_text(product.get("sku"), 120),
            "variantId": variant_id,
            "sku": server_sku,
            "collection": _safe_text((collection or {}).get("name"), 120),
            "collectionSlug": _safe_text((collection or {}).get("slug"), 160),
            "colour": _safe_text(variant.get("colour"), 120),
            "quantity": quantity,
            "unitPrice": price,
            "mrp": pricing["mrp"],
            "sale": pricing,
            "lineTotal": line_total,
            "image": image,
            "availability": "confirmation_required" if requires_confirmation else "in_stock",
            "requiresAvailabilityConfirmation": requires_confirmation,
            "variantStatus": variant_status,
            "inventoryMode": "variant",
            "purchaseMode": purchase_mode,
            "variant": {"id": variant_id, "sku": server_sku, "name": "Colour", "value": _safe_text(variant.get("colour"), 120)},
            "size": size or None,
            "customSize": custom_size,
        })
    return items, round(subtotal, 2)


def _new_order_document(user: dict, shipping: dict, items: list[dict], subtotal: float, attempt_id: str, now: datetime, display_currency: str = "INR") -> dict:
    customer_name = " ".join(filter(None, (user.get("firstName"), user.get("lastName")))) or user.get("displayName") or user.get("username") or "RK Customer"
    requires_confirmation = any(bool(item.get("requiresAvailabilityConfirmation")) for item in items)
    order = {
        "orderNumber": f"RK-{now:%Y%m%d}-{secrets.token_hex(3).upper()}",
        "customerId": user["_id"],
        "checkoutAttemptId": attempt_id,
        "customerName": _safe_text(customer_name, 120),
        "email": _safe_text(user.get("email"), 160).lower(),
        "phone": _safe_text(user.get("phone") or shipping.get("phone"), 30),
        "shipping": shipping,
        "items": items,
        "requiresAvailabilityConfirmation": requires_confirmation,
        "subtotal": subtotal,
        "shippingCharge": 0,
        "tax": 0,
        "discount": 0,
        "total": subtotal,
        "amountPaise": int(round(subtotal * 100)),
        "currency": "INR",
        "displayCurrency": display_currency,
        "status": "pending_payment",
        "paymentGateway": "razorpay",
        "paymentStatus": "pending",
        "payment": {"status": "pending", "gateway": "razorpay", "razorpayOrderId": None, "razorpayPaymentId": None, "verifiedAt": None},
        "confirmationEmail": {"status": "pending", "attempts": 0, "lastAttemptAt": None, "sentAt": None, "providerId": None, "error": None},
        "fulfillmentStatus": "order_placed",
        "fulfillment": {"status": "order_placed", "courier": "", "trackingNumber": "", "trackingUrl": "", "shippedAt": None, "deliveredAt": None},
        "createdAt": now,
        "updatedAt": now,
    }
    order["timeline"] = [timeline_event("order_placed", now, actor_view("customer", user), "Order placed.")]
    return order


def _revalidate_variant_order_item(db, item: dict) -> tuple[dict, dict, str]:
    product_id = ObjectId(str(item.get("productId") or ""))
    product = db.products.find_one({"_id": product_id, "status": {"$ne": "archived"}, "isActive": {"$ne": False}})
    if not product:
        raise StockUnavailable("A selected product is no longer available.")
    product = sync_product_variants(db, product) or product
    variant = find_variant(product, item.get("variantId") or (item.get("variant") or {}).get("id"))
    if not variant or str(variant.get("status") or "").lower() != "active":
        raise StockUnavailable("A selected colour is no longer active.")
    if _safe_text(item.get("sku"), 120).upper() != _safe_text(variant.get("sku"), 120).upper():
        raise StockUnavailable("A selected colour SKU no longer matches the product.")
    try:
        server_price = round(float(variant.get("price", product.get("price"))), 2)
        order_price = round(float(item.get("mrp", item.get("unitPrice"))), 2)
    except (TypeError, ValueError):
        raise StockUnavailable("A selected variant has an invalid price.")
    if server_price != order_price:
        raise StockUnavailable("A selected variant price changed before payment confirmation.")
    size = _safe_text(item.get("size"), 20).upper()
    valid_sizes = [str(value).strip().upper() for value in variant.get("sizes", STANDARD_SIZES) if str(value).strip()]
    custom_size = validate_custom_size(product, item.get("customSize"))
    if item.get("purchaseMode") == "custom_size" and not custom_size:
        raise StockUnavailable("Custom measurements are missing from a selected item.")
    if item.get("purchaseMode") != "custom_size" and (not size or size not in valid_sizes):
        raise StockUnavailable("A selected item has an invalid size.")
    return product, variant, size


def _decrement_tracked_variant_inventory(db, product: dict, variant: dict, size: str, quantity: int, now: datetime, operation: dict) -> tuple[ObjectId, int, str, str] | None:
    """CAS the exact persisted variant snapshot and its truthful stock marker."""
    from copy import deepcopy
    from ...inventory_operations import record_capture_product_marker
    marker = record_capture_product_marker(db, product["_id"], operation)
    marker.update(stockDelta=-quantity, stockPath="variant", variantId=str(variant.get("id") or ""), size=size or None)
    variant_id = str(variant.get("id") or "")
    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
        return None
    for _ in range(5):
        saved = db.products.find_one({"_id": product["_id"], "status": {"$ne": "archived"}, "isActive": {"$ne": False}})
        if not saved:
            return None
        prior = [row for row in saved.get("inventoryOperationMarkers", []) if row.get("operationId") == operation["operationId"]]
        if prior:
            matching = len(prior) == 1 and prior[0].get("state") == "applied" and all(
                prior[0].get(key) == marker.get(key) for key in
                ("orderId", "captureId", "itemIndex", "quantity", "claimToken", "operationType", "stockDelta", "variantId", "size"))
            return (product["_id"], quantity, size, variant_id) if matching else None
        variants = deepcopy(saved.get("variants", []))
        matches = [row for row in variants if str(row.get("id")) == variant_id]
        if len(matches) != 1 or matches[0].get("status") != "active":
            return None
        current = matches[0]
        if int(current.get("stock") or 0) < quantity:
            return None
        if size:
            sizes = [row for row in current.get("sizeInventory", []) if str(row.get("size") or "").upper() == size]
            if len(sizes) != 1 or int(sizes[0].get("stock") or 0) < quantity:
                return None
            sizes[0]["stock"] -= quantity
        current["stock"] -= quantity
        result = db.products.update_one(
            {"_id": product["_id"], "status": {"$ne": "archived"}, "isActive": {"$ne": False},
             "variants": saved.get("variants", []),
             "inventoryOperationMarkers": saved.get("inventoryOperationMarkers", {"$exists": False})},
            {"$set": {"variants": variants, "updatedAt": now, **allocated_variant_total(saved, variants)}, "$push": {"inventoryOperationMarkers": marker}},
        )
        if result.modified_count == 1:
            return product["_id"], quantity, size, variant_id
    return None


def _fulfil_paid_order(db, order: dict, payment_id: str, source: str, payment_signature: str = "") -> tuple[dict, bool]:
    from ...payment_state import has_capture, failure_fence, CLOSED_ORDER_STATES, reconcile, capture_evidence
    now = datetime.now(timezone.utc)
    order = db.orders.find_one({"_id": order["_id"]}) or order
    if has_capture(order) or order.get("paymentStatus") == "processing":
        recorded_id = order.get("razorpayPaymentId") or (order.get("payment") or {}).get("razorpayPaymentId")
        state = (order.get("fulfillment") or {}).get("status") or order.get("fulfillmentStatus") or order.get("status")
        if recorded_id == payment_id and order.get("paymentStatus") == "paid" and not order.get("refunds") and state not in CLOSED_ORDER_STATES:
            send_order_confirmation(db, order, current_app.config, current_app.logger)
        else:
            reconcile(db, order, payment_id, "capture_after_verified_payment_or_refund", source)
        return order, False
    state = (order.get("fulfillment") or {}).get("status") or order.get("fulfillmentStatus") or order.get("status")
    if state in CLOSED_ORDER_STATES:
        # Genuine capture on a closed order is money received, not authority to reopen it.
        evidence = capture_evidence(order, payment_id, source, now)
        query = failure_fence(order["_id"])
        query.update({"fulfillment": order.get("fulfillment"), "status": order.get("status")})
        updated = db.orders.find_one_and_update(query, {"$set": {
            "captureEvidence": evidence, "razorpayPaymentId": payment_id, "paymentVerifiedAt": now,
            "paymentStatus": "paid", "payment.status": "paid", "payment.razorpayPaymentId": payment_id,
            "payment.verifiedAt": now, "captureFulfillmentStatus": "held"}}, return_document=ReturnDocument.AFTER)
        current = updated or db.orders.find_one({"_id": order["_id"]})
        reconcile(db, current, payment_id, "capture_on_closed_order", source)
        return current, False
    claim_token = secrets.token_hex(16)
    query = failure_fence(order["_id"])
    query.update({"fulfillment": order.get("fulfillment"), "status": order.get("status"),
                  "payment": order.get("payment"), "timeline": order.get("timeline", {"$exists": False})})
    normalized = normalisation_updates(order)
    normalized["payment"].update({"status": "paid", "razorpayPaymentId": payment_id, "verifiedAt": now})
    locked = db.orders.find_one_and_update(
        query,
        {"$set": {**normalized, "paymentStatus": "processing", "updatedAt": now, "captureEvidence": capture_evidence(order, payment_id, source, now),
                  "razorpayPaymentId": payment_id, "paymentVerifiedAt": now, "captureFulfillmentStatus": "processing", "captureClaimToken": claim_token}},
        return_document=ReturnDocument.AFTER,
    )
    if not locked:
        current = db.orders.find_one({"_id": order["_id"]})
        if current:
            reconcile(db, current, payment_id, "capture_transition_conflict", source)
            return current, False
        raise ValueError("This payment is already being processed. Please refresh in a moment.")

    try:
        from ...inventory_operations import prepare_capture_operation, mark_capture_operation, reconcile_capture_ledger_from_product
        capture_id = payment_id
        for item_index, item in enumerate(locked.get("items", [])):
            product_id = ObjectId(str(item["productId"]))
            raw_quantity = item.get("quantity")
            if isinstance(raw_quantity, bool) or not isinstance(raw_quantity, int) or raw_quantity <= 0:
                raise ValueError("Captured order contains an invalid inventory quantity.")
            quantity = raw_quantity
            operation = prepare_capture_operation(db, locked, capture_id, item_index, item, claim_token)
            if operation.get("state") == "applied":
                continue
            mark_capture_operation(db, operation["operationId"], claim_token, "applying")
            if item.get("variantId") or (isinstance(item.get("variant"), dict) and (item.get("variant") or {}).get("sku")):
                product, variant, size = _revalidate_variant_order_item(db, item)
                adjustment = _decrement_tracked_variant_inventory(db, product, variant, size, quantity, now, operation)
                if adjustment:
                    mark_capture_operation(db, operation["operationId"], claim_token, "applied", productMarkerObserved=True, stockDelta=-quantity)
                else:
                    mark_capture_operation(db, operation["operationId"], claim_token, "unresolved", productMarkerObserved=False, reason="stock_adjustment_not_confirmed")
                    raise ValueError("Captured payment is held for inventory reconciliation.")
                continue
            size = str(item.get("size") or "").strip().upper()
            product = db.products.find_one({"_id": product_id}, {"sizeInventoryConfigured": 1, "sizeSystemEnabled": 1, "sizeInventory": 1}) or {}
            if size and has_size_system(product):
                if len([row for row in product.get("sizeInventory", []) if row.get("size") == size and row.get("enabled") is True]) != 1:
                    raise ValueError("The captured size inventory is ambiguous.")
                from ...inventory_operations import record_capture_product_marker
                marker = record_capture_product_marker(db, product_id, operation)
                marker.update(stockDelta=-quantity, stockPath=f"sizeInventory[{size}].stock;stock")
                result = db.products.update_one(
                    {"_id": product_id, "status": {"$ne": "archived"}, "isActive": {"$ne": False}, "stock": {"$gte": quantity}, "inventoryOperationMarkers.operationId": {"$ne": operation["operationId"]}, "sizeInventory": {"$elemMatch": {"size": size, "enabled": True, "stock": {"$gte": quantity}}}},
                    {"$inc": {"sizeInventory.$.stock": -quantity, "stock": -quantity}, "$set": {"updatedAt": now}, "$push": {"inventoryOperationMarkers": marker}},
                )
            else:
                from ...inventory_operations import record_capture_product_marker
                marker = record_capture_product_marker(db, product_id, operation)
                marker.update(stockDelta=-quantity, stockPath="stock")
                result = db.products.update_one(
                    {"_id": product_id, "status": {"$ne": "archived"}, "isActive": {"$ne": False}, "stock": {"$gte": quantity}, "inventoryOperationMarkers.operationId": {"$ne": operation["operationId"]}},
                    {"$inc": {"stock": -quantity}, "$set": {"updatedAt": now}, "$push": {"inventoryOperationMarkers": marker}},
                )
            # Legacy parent-level items still require an atomic stock threshold
            # and matching marker. Captured funds stay held if stock is unknown.
            if result.modified_count == 1:
                mark_capture_operation(db, operation["operationId"], claim_token, "applied", productMarkerObserved=True, stockDelta=-quantity)
            else:
                existing_marker = db.products.find_one({"_id": product_id, "inventoryOperationMarkers.operationId": operation["operationId"]})
                if existing_marker:
                    mark_capture_operation(db, operation["operationId"], claim_token, "applied", productMarkerObserved=True, recoveredFromMarker=True)
                else:
                    mark_capture_operation(db, operation["operationId"], claim_token, "unresolved", productMarkerObserved=False, reason="stock_adjustment_not_confirmed")
                    raise ValueError("Captured payment is held for inventory reconciliation.")

        from ...inventory_operations import operation_evidence, capture_recoverable
        if locked.get("items") and not capture_recoverable(operation_evidence(db, locked)):
            raise ValueError("Captured stock markers require reconciliation before confirmation.")
        fields, events = payment_confirmation_changes(locked, payment_id, source, payment_signature, now)
        fields["captureFulfillmentStatus"] = "completed"
        updated = db.orders.find_one_and_update(
            {"_id": locked["_id"], "paymentStatus": "processing", "captureClaimToken": claim_token,
             "refunds.0": {"$exists": False}, "fulfillment": locked.get("fulfillment")},
            {"$set": fields, "$push": {"timeline": {"$each": events}}},
            return_document=ReturnDocument.AFTER,
        )
        if not updated:
            raise ValueError("The order could not be confirmed safely.")
    except Exception as error:
        persisted = db.orders.find_one({"_id": locked["_id"]})
        if (persisted or {}).get("captureClaimToken") == claim_token and persisted.get("captureFulfillmentStatus") == "completed":
            # The final commit succeeded but its acknowledgement was lost.
            return persisted, False
        # Do not compensate from an in-memory list: a process interruption can
        # make that list incomplete. Product markers and ledger state are the
        # evidence; leave stock untouched and the order held for explicit review.
        db.orders.update_one(
            {"_id": locked["_id"], "captureClaimToken": claim_token},
            {"$set": {"captureFulfillmentStatus": "held", "updatedAt": now}},
        )
        reconcile_capture_ledger_from_product(db, locked["_id"])
        if (persisted or {}).get("paymentStatus") == "refunded":
            from ...inventory_operations import compensate_capture_markers
            try:
                compensate_capture_markers(db, locked["_id"], claim_token)
            except Exception as compensation_error:
                current_app.logger.error("Capture inventory compensation remains unresolved (%s)", type(compensation_error).__name__)
        db.inventory_operations.update_many(
            {"orderId": str(locked["_id"]), "claimToken": claim_token,
             "state": {"$in": ["planned", "applying"]}},
            {"$set": {"state": "unresolved", "updatedAt": now, "reason": "capture_interrupted"}},
        )
        reconcile(db, persisted or locked, payment_id, "capture_fulfillment_interrupted", source)
        raise

    # Delivery state is deliberately separate from payment/order state. A
    # provider outage records a retryable failure but never rolls back payment.
    send_order_confirmation(db, updated, current_app.config, current_app.logger)
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
@limiter.limit("10 per minute")
def create_razorpay_order():
    payload = request.get_json(silent=True) or {}
    attempt_id = _safe_text(payload.get("checkoutAttemptId"), 80)
    if "whatsappTransactionalConsent" in payload and not isinstance(payload["whatsappTransactionalConsent"], bool):
        return jsonify(error="WhatsApp consent must be boolean."), 400
    if "whatsappMarketingConsent" in payload and not isinstance(payload["whatsappMarketingConsent"], bool):
        return jsonify(error="Marketing WhatsApp consent must be boolean."), 400
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{8,80}", attempt_id):
        return jsonify({"error": "A valid checkout attempt is required."}), 400
    user = current_user()
    user_id = authenticated_user_id()
    db = database()
    store_settings = db.admin_settings.find_one({"_id": "store"}) or {}
    online = store_settings.get("razorpayEnabled") is not False
    from ...communication_preferences import collection_mode
    onboarding = collection_mode(db) == 'onboarding'
    mandatory_whatsapp = not onboarding and store_settings.get("requireWhatsappConsentForCheckout") is True
    if mandatory_whatsapp and payload.get("whatsappTransactionalConsent") is not True:
        return jsonify(error="Explicit transactional WhatsApp consent is required before checkout.", code="whatsapp_consent_required"), 400
    try:
        display_currency = _display_currency(payload.get("displayCurrency", "INR"))
        shipping = _normalise_shipping(db, user_id, payload.get("shipping") if isinstance(payload.get("shipping"), dict) else {})
        try:
            whatsapp = checkout_recipient(db, current_app.config, user, payload, shipping, mandatory=mandatory_whatsapp)
        except ValueError as error:
            code = "whatsapp_choice_invalid" if "boolean" in str(error) else "whatsapp_number_invalid"
            return jsonify(error=str(error), code=code), 400
        if (mandatory_whatsapp or payload.get("whatsappTransactionalConsent") is True) and not whatsapp["phone"]:
            return jsonify(error="A valid WhatsApp number with its country code is required before checkout.", code="whatsapp_number_required"), 400
        if payload.get("whatsappMarketingConsent") is True and not whatsapp["phone"]:
            raise ValueError("Select a valid international WhatsApp number for marketing consent.")
        _ensure_payment_indexes(db)
        ensure_catalog_seed(db)
        items, subtotal = _checkout_items(db, payload.get("cart"))
    except ValueError as error:
        return jsonify({"error": str(error), "code": "whatsapp_number_invalid" if mandatory_whatsapp and "WhatsApp" in str(error) else "invalid_checkout"}), 400

    # Price is only a comparison acknowledgement; never an authoritative amount.
    quoted = payload.get('cart') or []
    changed = any(raw.get('quotedUnitPrice') is not None and str(raw.get('quotedUnitPrice')) != str(item['unitPrice'])
                  and _quote_differs(raw.get('quotedUnitPrice'), item['unitPrice']) for raw, item in zip(quoted, items))
    if changed:
        return jsonify(error="Prices in your bag have changed. Review the updated prices before continuing.",
                       code="price_changed", prices=[{"productId": i['productId'], "variantId": i['variantId'], "price": i['unitPrice'], "sale": i['sale']} for i in items]), 409

    existing = db.orders.find_one({"customerId": user_id, "checkoutAttemptId": attempt_id})
    if existing and mandatory_whatsapp and (existing.get("whatsappConsent") or {}).get("source") != "checkout":
        return jsonify(error="Start a new checkout attempt to provide explicit WhatsApp consent."), 409
    if existing and mandatory_whatsapp and consent_phone(db, current_app.config, user, existing) is None:
        return jsonify(error="WhatsApp consent was withdrawn. Start a new checkout attempt to consent again."), 409
    if existing and (existing.get("whatsappRecipient") != whatsapp["phone"] or (
            "whatsappTransactionalConsent" in payload and
            payload["whatsappTransactionalConsent"] != ((existing.get("whatsappConsent") or {}).get("enabled") is True))):
        return jsonify(error="The WhatsApp recipient or consent changed. Start a new checkout attempt."), 409
    if existing and existing.get("paymentGateway") == "manual":
        send_order_confirmation(db, existing, current_app.config, current_app.logger)
        return jsonify(order=_order_view(existing), paymentMode="manual"), 200
    if not online and existing:
        return jsonify(error="Payment mode changed. Start a new checkout attempt."), 409
    if online and not is_configured(current_app.config):
        return jsonify(error="Razorpay is not configured on the backend."), 503
    if existing and existing.get("razorpayOrderId"):
        if existing.get("paymentStatus") in {"failed", "cancelled"}:
            existing = db.orders.find_one_and_update(
                {"_id": existing["_id"], "paymentStatus": {"$in": ["failed", "cancelled"]}},
                {"$set": {"status": "pending_payment", "paymentStatus": "order_created", "updatedAt": datetime.now(timezone.utc)}},
                return_document=ReturnDocument.AFTER,
            ) or existing
        return jsonify(_payment_response(existing)), 200

    now = datetime.now(timezone.utc)
    order = existing or _new_order_document(user, shipping, items, subtotal, attempt_id, now, display_currency)
    if not existing:
        if not online:
            order.update(paymentGateway="manual", paymentStatus="pending", status="order_placed",
                         payment={"gateway": "manual", "status": "pending"},
                         paymentTransactions=[], paymentLedgerVersion=0, amountReceived=0, balanceDue=subtotal)
        try:
            order["_id"] = ObjectId()
            if payload.get("whatsappTransactionalConsent") is True and whatsapp.get("consent"):
                # Reuse a backend-verified grant for this exact customer/number.
                # The order snapshot is new, but this does not invent a fresh consent action.
                consent = {**whatsapp["consent"], "orderId": str(order["_id"])}
            elif payload.get("whatsappTransactionalConsent") is True:
                consent = record_consent(db, current_app.config, user_id, whatsapp["phone"], True, "checkout", order_id=order["_id"], update_user=False)
            elif payload.get("whatsappTransactionalConsent") is False:
                consent = {"customerId": str(user_id), "phone": whatsapp["phone"], "category": "transactional", "enabled": False, "status": "declined", "timestamp": now, "source": "checkout", "orderId": str(order["_id"])}
            elif whatsapp["consent"]:
                consent = {**whatsapp["consent"], "orderId": str(order["_id"])}
            else:
                consent = {"customerId": str(user_id), "phone": whatsapp["phone"], "category": "transactional", "enabled": False, "status": "declined", "timestamp": now, "source": "checkout", "orderId": str(order["_id"])}
            order.update(whatsappRecipient=whatsapp["phone"], whatsappCountry=whatsapp["country"], whatsappRecipientSource=whatsapp["source"], whatsappConsent=consent)
            # Recipient and consent are inserted with the order atomically.
            # No provider order can exist with a half-written recipient snapshot.
            db.orders.insert_one(order)
            if payload.get("saveWhatsappAsPrimary") is True:
                record_consent(db, current_app.config, user_id, whatsapp["phone"], True, "checkout_save_primary")
                db.users.update_one({"_id": user_id}, {"$set": {"whatsappCountry": whatsapp["country"]}})
            if "whatsappMarketingConsent" in payload and (whatsapp["phone"] or payload["whatsappMarketingConsent"] is True):
                marketing = record_marketing_consent(db, current_app.config, user_id, whatsapp["phone"] or shipping["phone"], payload["whatsappMarketingConsent"], "checkout", update_user=payload["whatsappMarketingConsent"] is True)
                db.orders.update_one({"_id": order["_id"]}, {"$set": {"whatsappMarketingConsent": marketing}})
        except DuplicateKeyError:
            order = db.orders.find_one({"customerId": user_id, "checkoutAttemptId": attempt_id})
            if (not order or order.get("whatsappRecipient") != whatsapp["phone"]
                    or ("whatsappTransactionalConsent" in payload and payload["whatsappTransactionalConsent"] != ((order.get("whatsappConsent") or {}).get("enabled") is True))):
                return jsonify({"error": "Checkout changed. Start a new checkout attempt."}), 409
    if order.get("paymentGateway") == "manual":
        send_order_confirmation(db, order, current_app.config, current_app.logger)
        return jsonify(order=_order_view(order), paymentMode="manual"), 201
    if not online:
        return jsonify(error="Payment mode changed. Start a new checkout attempt."), 409
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
@limiter.limit("20 per minute")
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
    user_id = authenticated_user_id()
    order = db.orders.find_one({"customerId": user_id, "razorpayOrderId": callback_order_id})
    if not order:
        return jsonify({"error": "The checkout order could not be found."}), 404
    if order.get("paymentStatus") == "paid":
        if order.get("razorpayPaymentId") == payment_id:
            send_order_confirmation(db, order, current_app.config, current_app.logger)
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
@limiter.limit("20 per minute")
def update_razorpay_state():
    payload = request.get_json(silent=True) or {}
    order_id = _safe_text(payload.get("orderId"), 64)
    state = _safe_text(payload.get("state"), 20).lower()
    reason = _safe_text(payload.get("reason"), 240)
    if not ObjectId.is_valid(order_id) or state not in {"failed", "cancelled"}:
        return jsonify({"error": "Invalid payment state."}), 400
    db = database()
    order = db.orders.find_one({"_id": ObjectId(order_id), "customerId": authenticated_user_id()})
    if not order:
        return jsonify({"error": "Order not found."}), 404
    if order.get("paymentGateway") == "manual":
        return jsonify(error="Manual orders do not accept Razorpay state changes."), 400
    if order.get("paymentStatus") == "paid":
        return jsonify({"order": _order_view(order), "alreadyProcessed": True}), 200
    now = datetime.now(timezone.utc)
    fields, event = payment_failure_changes(order, reason or ("Payment failed." if state == "failed" else "Customer cancelled payment."), now, cancelled=state == "cancelled")
    updated = db.orders.find_one_and_update(
        {**failure_snapshot(order),
         "paymentStatus": {"$in": ["pending", "order_created", "verification_pending"]}},
        {"$set": fields, "$push": {"timeline": event}},
        return_document=ReturnDocument.AFTER,
    )
    if updated and state == "failed":
        notify(db, "payment_failure", updated, key=f"payment_failure:{order['_id']}:{order.get('razorpayOrderId')}")
    return jsonify({"order": _order_view(updated or order)}), 200


@payments_bp.get("/orders/<order_id>")
@requireAuth
def get_customer_order(order_id: str):
    if not ObjectId.is_valid(order_id):
        return jsonify({"error": "Order not found."}), 404
    db = database()
    order = db.orders.find_one({"_id": ObjectId(order_id), "customerId": authenticated_user_id()})
    if not order:
        return jsonify({"error": "Order not found."}), 404
    view = _order_view(ensure_order_tracking(db, order))
    view["whatsappUpdates"] = order_consent_status(db, current_app.config, current_user(), order)
    return jsonify({"order": view}), 200


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
        if (db.razorpay_webhook_events.find_one({"eventId": event_id}) or {}).get("processedAt"):
            return jsonify({"received": True, "duplicate": True}), 200

    event_name = str(payload.get("event") or "")
    payment_entity = (((payload.get("payload") or {}).get("payment") or {}).get("entity") or {})
    if event_name in {"payment.captured", "payment.failed"}:
        evidence = {"paymentId": _safe_text(payment_entity.get("id"), 120),
                    "providerOrderId": _safe_text(payment_entity.get("order_id"), 120),
                    "currency": _safe_text(payment_entity.get("currency"), 10), "status": event_name.split(".")[1],
                    "amountPaise": payment_entity.get("amount") if isinstance(payment_entity.get("amount"), int) and not isinstance(payment_entity.get("amount"), bool) else None,
                    "source": "razorpay_signed_webhook"}
        db.razorpay_webhook_events.update_one({"eventId": event_id}, {"$set": {"paymentEvidence": evidence}})
    order_id = str(payment_entity.get("order_id") or "").strip()
    order = db.orders.find_one({"razorpayOrderId": order_id}) if order_id else None
    result = {"received": True, "event": event_name, "handled": False}
    try:
        if event_name == "refund.processed":
            refund = (((payload.get("payload") or {}).get("refund") or {}).get("entity") or {})
            reference, payment_id = _safe_text(refund.get("id"), 120), _safe_text(refund.get("payment_id"), 120)
            refunded_order = db.orders.find_one({"$or": [{"razorpayPaymentId": payment_id}, {"payment.razorpayPaymentId": payment_id}]}) if payment_id else None
            amount = refund.get("amount")
            if (not refunded_order or refund.get("status") != "processed" or not reference
                    or not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0
                    or amount > int(refunded_order.get("amountPaise") or round(float(refunded_order.get("total", 0)) * 100))
                    or refund.get("currency") != refunded_order.get("currency", "INR")):
                raise ValueError("Refund result does not match a recorded order.")
            proof = {"id": reference, "paymentId": payment_id, "status": "processed", "amountPaise": amount,
                     "currency": refund["currency"], "source": "razorpay_signed_webhook", "processedAt": now}
            from ...refund_evidence import record_provider_refund
            refunded_order, proof = record_provider_refund(db, refunded_order, proof)
            refunded_order["whatsappRefund"] = proof
            from ...order_fulfillment import send_status_notification
            send_status_notification(db, refunded_order, "refund_completed", notification_key=f"refund:{reference}")
            result.update(handled=True, orderId=str(refunded_order["_id"]))
        elif event_name == "payment.captured" and order:
            _validate_payment_entity(order, payment_entity)
            confirmed, applied = _fulfil_paid_order(db, order, str(payment_entity.get("id") or ""), "webhook")
            result.update({"handled": True, "orderId": str(confirmed["_id"]), "fulfillmentApplied": applied,
                           "reconciliationRequired": bool(confirmed.get("refunds") or confirmed.get("captureFulfillmentStatus") in {"held", "processing"}
                               or confirmed.get("razorpayPaymentId") != payment_entity.get("id"))})
        elif event_name == "payment.failed" and order:
            fields, event = payment_failure_changes(order, _safe_text(((payment_entity.get("error_description") or payment_entity.get("error_reason"))), 240) or "Razorpay reported a failed payment.", now)
            changed = db.orders.update_one(
                failure_snapshot(order),
                {"$set": fields, "$push": {"timeline": event}},
            )
            if changed.modified_count:
                notify(db, "payment_failure", order, key=f"payment_failure:{order['_id']}:{order.get('razorpayOrderId')}")
            else:
                from ...payment_state import reconcile
                reconcile(db, order, _safe_text(payment_entity.get("id"), 120), "late_failure_after_financial_transition", "webhook")
            result.update({"handled": True, "orderId": str(order["_id"]), "transitionApplied": bool(changed.modified_count),
                           "reconciliationRequired": not bool(changed.modified_count)})
    except (StockUnavailable, ValueError) as error:
        current_app.logger.error("Razorpay webhook could not be applied: %s", error)
        result["error"] = str(error)
    db.razorpay_webhook_events.update_one({"eventId": event_id}, {"$set": {"processedAt": datetime.now(timezone.utc), "result": result}})
    return jsonify(result), 200


def _quote_differs(quoted, actual):
    try:
        return not math.isfinite(float(quoted)) or round(float(quoted), 2) != actual
    except (TypeError, ValueError):
        return True
