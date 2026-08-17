"""Order payment/fulfillment views, migration, and transition rules.

Razorpay's existing top-level fields remain intact for backwards compatibility.
This module adds the canonical payment and fulfillment structures used by the
customer, Admin, and Staff order-tracking experiences.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import html
import re
import secrets
from typing import Any
from urllib.parse import urlparse

import resend
from bson import ObjectId
from flask import current_app
from pymongo import ReturnDocument
from pymongo.errors import OperationFailure


PAYMENT_STATUSES = ("pending", "paid", "failed", "refunded")
FULFILLMENT_STATUSES = (
    "order_placed",
    "confirmed",
    "processing",
    "packed",
    "shipped",
    "out_for_delivery",
    "delivered",
    "cancelled",
    "return_requested",
    "returned",
    "refunded",
)
ACTIVE_FULFILLMENT_STATUSES = {
    "order_placed", "confirmed", "processing", "packed", "shipped", "out_for_delivery"
}
FULFILLMENT_SEQUENCE = (
    "order_placed", "confirmed", "processing", "packed", "shipped", "out_for_delivery", "delivered"
)

STATUS_LABELS = {
    "order_placed": "Order placed",
    "payment_confirmed": "Payment confirmed",
    "payment_failed": "Payment failed",
    "confirmed": "Order confirmed",
    "processing": "Processing",
    "packed": "Packed",
    "shipped": "Shipped",
    "shipment_updated": "Shipment updated",
    "out_for_delivery": "Out for delivery",
    "delivered": "Delivered",
    "cancelled": "Cancelled",
    "return_requested": "Return requested",
    "returned": "Returned",
    "refunded": "Refunded",
}

VALID_TRANSITIONS = {
    "order_placed": {"confirmed", "cancelled"},
    "confirmed": {"processing", "cancelled"},
    "processing": {"packed", "cancelled"},
    "packed": {"shipped", "cancelled"},
    "shipped": {"out_for_delivery", "delivered"},
    "out_for_delivery": {"delivered"},
    "delivered": {"return_requested"},
    "return_requested": {"returned"},
    "returned": {"refunded"},
    "cancelled": {"refunded"},
    "refunded": set(),
}

DEFAULT_NOTES = {
    "confirmed": "Your order has been confirmed.",
    "processing": "Your order is being prepared by the RK team.",
    "packed": "Packed and ready for dispatch.",
    "shipped": "Your order has shipped.",
    "out_for_delivery": "Your order is out for delivery.",
    "delivered": "Your order has been delivered.",
    "cancelled": "The order was cancelled.",
    "return_requested": "A return was requested.",
    "returned": "The returned order was received.",
    "refunded": "The order refund was recorded.",
}


class OrderTransitionError(ValueError):
    """Raised when an order status change is invalid or incomplete."""


class OrderTransitionConflict(RuntimeError):
    """Raised when another request changed an order during an update."""


def _iso(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return _iso(value)
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, list):
        return [json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: json_value(item) for key, item in value.items()}
    return value


def safe_text(value: object, maximum: int = 240) -> str:
    return str(value or "").strip()[:maximum]


def canonical_payment_status(order: dict) -> str:
    nested = order.get("payment") if isinstance(order.get("payment"), dict) else {}
    status = safe_text(nested.get("status") or order.get("paymentStatus"), 40).lower()
    if status in PAYMENT_STATUSES:
        return status
    if status in {"creation_failed", "stock_unavailable", "cancelled", "canceled"} or "fail" in status:
        return "failed"
    return "pending"


def canonical_fulfillment_status(order: dict) -> str:
    nested = order.get("fulfillment") if isinstance(order.get("fulfillment"), dict) else {}
    status = safe_text(nested.get("status") or order.get("fulfillmentStatus"), 60).lower().replace(" ", "_")
    if status in FULFILLMENT_STATUSES:
        return status
    legacy = safe_text(order.get("status"), 60).lower().replace(" ", "_")
    mapping = {
        "pending": "order_placed",
        "pending_payment": "order_placed",
        "payment_failed": "cancelled",
        "confirmed": "confirmed",
        "processing": "processing",
        "packed": "packed",
        "shipped": "shipped",
        "out_for_delivery": "out_for_delivery",
        "fulfilled": "delivered",
        "delivered": "delivered",
        "cancelled": "cancelled",
        "canceled": "cancelled",
        "return_requested": "return_requested",
        "returned": "returned",
        "refunded": "refunded",
    }
    if legacy in mapping:
        return mapping[legacy]
    return "confirmed" if canonical_payment_status(order) == "paid" else "order_placed"


def actor_view(actor_type: str, user: dict | None = None, name: str = "") -> dict:
    actor = {"type": actor_type}
    if user and user.get("_id"):
        actor["userId"] = user["_id"]
    actor_name = safe_text(
        name
        or (" ".join(filter(None, ((user or {}).get(key) for key in ("firstName", "lastName")))))
        or (user or {}).get("displayName")
        or (user or {}).get("username"),
        120,
    )
    if actor_name:
        actor["name"] = actor_name
    return actor


def timeline_event(status: str, timestamp: datetime, actor: dict, note: str = "", metadata: dict | None = None) -> dict:
    event = {
        "id": secrets.token_hex(8),
        "status": status,
        "label": STATUS_LABELS.get(status, status.replace("_", " ").title()),
        "timestamp": timestamp,
        "actor": actor,
        "note": safe_text(note, 500),
    }
    if metadata:
        event["metadata"] = metadata
    return event


def _historical_timeline(order: dict, fulfillment_status: str, payment_status: str) -> list[dict]:
    created = order.get("createdAt") if isinstance(order.get("createdAt"), datetime) else datetime.now(timezone.utc)
    payment_at = order.get("paymentVerifiedAt") if isinstance(order.get("paymentVerifiedAt"), datetime) else created
    updated = order.get("updatedAt") if isinstance(order.get("updatedAt"), datetime) else payment_at
    events = [timeline_event("order_placed", created, actor_view("customer"), "Order placed.")]
    if payment_status == "paid":
        events.append(timeline_event("payment_confirmed", payment_at, actor_view("system", name="Razorpay"), "Payment confirmed."))
    if fulfillment_status != "order_placed":
        event_at = payment_at if fulfillment_status == "confirmed" else max(updated, payment_at + timedelta(microseconds=1))
        events.append(timeline_event(fulfillment_status, event_at, actor_view("system", name="RK migration"), DEFAULT_NOTES.get(fulfillment_status, "Status preserved from the existing order.")))
    return events


def normalisation_updates(order: dict) -> dict:
    payment_status = canonical_payment_status(order)
    fulfillment_status = canonical_fulfillment_status(order)
    payment = dict(order.get("payment") or {}) if isinstance(order.get("payment"), dict) else {}
    payment.update({
        "status": payment_status,
        "gateway": payment.get("gateway") or order.get("paymentGateway") or "razorpay",
        "razorpayOrderId": payment.get("razorpayOrderId") or order.get("razorpayOrderId"),
        "razorpayPaymentId": payment.get("razorpayPaymentId") or order.get("razorpayPaymentId"),
        "verifiedAt": payment.get("verifiedAt") or order.get("paymentVerifiedAt"),
    })
    fulfillment = dict(order.get("fulfillment") or {}) if isinstance(order.get("fulfillment"), dict) else {}
    fulfillment.update({
        "status": fulfillment_status,
        "courier": fulfillment.get("courier") or order.get("courier") or "",
        "trackingNumber": fulfillment.get("trackingNumber") or order.get("trackingNumber") or "",
        "trackingUrl": fulfillment.get("trackingUrl") or order.get("trackingUrl") or "",
        "shippedAt": fulfillment.get("shippedAt") or order.get("shippedAt"),
        "deliveredAt": fulfillment.get("deliveredAt") or order.get("deliveredAt"),
    })
    timeline = order.get("timeline") if isinstance(order.get("timeline"), list) else []
    if not timeline:
        timeline = _historical_timeline(order, fulfillment_status, payment_status)
    return {
        "payment": payment,
        "fulfillment": fulfillment,
        "fulfillmentStatus": fulfillment_status,
        "status": fulfillment_status,
        "timeline": timeline,
    }


def ensure_order_tracking(database, order: dict) -> dict:
    updates = normalisation_updates(order)
    needs_update = any(order.get(key) != value for key, value in updates.items())
    if needs_update:
        database.orders.update_one({"_id": order["_id"]}, {"$set": updates})
        order = {**order, **updates}
    return order


def migrate_legacy_orders(database, limit: int = 500) -> int:
    query = {"$or": [
        {"payment.status": {"$exists": False}},
        {"fulfillment.status": {"$exists": False}},
        {"timeline": {"$exists": False}},
        {"fulfillmentStatus": {"$exists": False}},
    ]}
    migrated = 0
    for order in database.orders.find(query).sort("createdAt", 1).limit(limit):
        ensure_order_tracking(database, order)
        migrated += 1
    return migrated


def ensure_order_indexes(database) -> None:
    for spec, options in (
        ([("customerId", 1), ("createdAt", -1)], {}),
        ([("payment.status", 1), ("createdAt", -1)], {}),
        ([("fulfillment.status", 1), ("createdAt", -1)], {}),
        ("fulfillment.trackingNumber", {"sparse": True}),
    ):
        try:
            database.orders.create_index(spec, **options)
        except OperationFailure:
            continue


def payment_confirmation_changes(order: dict, payment_id: str, source: str, signature: str, now: datetime) -> tuple[dict, list[dict]]:
    normalized = normalisation_updates(order)
    payment = {**normalized["payment"], "status": "paid", "razorpayPaymentId": payment_id, "verifiedAt": now}
    fulfillment = {**normalized["fulfillment"], "status": "confirmed"}
    events = [
        timeline_event("payment_confirmed", now, actor_view("system", name="Razorpay"), "Payment confirmed."),
        timeline_event("confirmed", now + timedelta(microseconds=1), actor_view("system", name="RK checkout"), DEFAULT_NOTES["confirmed"]),
    ]
    fields = {
        "status": "confirmed",
        "fulfillmentStatus": "confirmed",
        "fulfillment": fulfillment,
        "payment": payment,
        "paymentStatus": "paid",
        "razorpayPaymentId": payment_id,
        "razorpaySignature": signature or None,
        "paymentVerifiedAt": now,
        "inventoryAdjustedAt": now,
        "paymentVerifiedSource": source,
        "updatedAt": now,
    }
    return fields, events


def payment_failure_changes(order: dict, reason: str, now: datetime, cancelled: bool = False) -> tuple[dict, dict]:
    normalized = normalisation_updates(order)
    fulfillment_status = "cancelled" if cancelled else normalized["fulfillment"]["status"]
    payment = {**normalized["payment"], "status": "failed"}
    fulfillment = {**normalized["fulfillment"], "status": fulfillment_status}
    event_status = "cancelled" if cancelled else "payment_failed"
    event = timeline_event(event_status, now, actor_view("customer" if cancelled else "system", name="Razorpay" if not cancelled else "Customer"), reason)
    return {
        "payment": payment,
        "paymentStatus": "cancelled" if cancelled else "failed",
        "paymentFailureReason": safe_text(reason, 240) or None,
        "fulfillment": fulfillment,
        "fulfillmentStatus": fulfillment_status,
        "status": fulfillment_status,
        "updatedAt": now,
    }, event


def valid_next_statuses(order: dict, actor_type: str = "staff") -> list[str]:
    current = canonical_fulfillment_status(order)
    statuses = list(VALID_TRANSITIONS.get(current, set()))
    if actor_type == "customer":
        return [status for status in statuses if status == "return_requested"]
    if canonical_payment_status(order) != "paid":
        statuses = [status for status in statuses if status in {"cancelled"}]
    return sorted(statuses, key=lambda status: FULFILLMENT_STATUSES.index(status))


def validate_tracking_url(value: object) -> str:
    url = safe_text(value, 2048)
    if not url:
        return ""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise OrderTransitionError("Enter a valid HTTP or HTTPS tracking URL.")
    return url


def shipment_fields(payload: dict, require_complete: bool = True) -> dict:
    courier = safe_text(payload.get("courier"), 100)
    tracking_number = safe_text(payload.get("trackingNumber"), 160)
    if require_complete and (not courier or not tracking_number):
        raise OrderTransitionError("Courier and tracking number are required before an order can be shipped.")
    if tracking_number and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9\s._/-]{2,159}", tracking_number):
        raise OrderTransitionError("Enter a valid tracking number.")
    return {
        "courier": courier,
        "trackingNumber": tracking_number,
        "trackingUrl": validate_tracking_url(payload.get("trackingUrl")),
        "shippingNote": safe_text(payload.get("shippingNote") or payload.get("note"), 500),
    }


def validate_transition(order: dict, target_status: str, actor_type: str = "staff") -> tuple[str, str]:
    current = canonical_fulfillment_status(order)
    target = safe_text(target_status, 60).lower().replace(" ", "_")
    if target not in FULFILLMENT_STATUSES:
        raise OrderTransitionError("Choose a valid fulfillment status.")
    if target == current:
        raise OrderTransitionError(f"The order is already {STATUS_LABELS[target].lower()}.")
    if target not in VALID_TRANSITIONS.get(current, set()):
        raise OrderTransitionError(f"{STATUS_LABELS.get(current, current)} cannot move directly to {STATUS_LABELS.get(target, target)}.")
    if target == "confirmed" and canonical_payment_status(order) != "paid":
        raise OrderTransitionError("Payment must be confirmed before fulfillment can begin.")
    if actor_type == "customer" and target != "return_requested":
        raise OrderTransitionError("Customers cannot make that fulfillment change.")
    return current, target


def _notification_copy(status: str) -> tuple[str, str] | None:
    copies = {
        "packed": ("Your RK order has been packed", "Your order has been packed and is ready for dispatch."),
        "shipped": ("Your RK order has shipped", "Your order has shipped."),
        "out_for_delivery": ("Your RK order is out for delivery", "Your order is out for delivery."),
        "delivered": ("Your RK order has been delivered", "Your order has been delivered."),
        "cancelled": ("Your RK order was cancelled", "Your order was cancelled."),
        "returned": ("Your RK return was received", "Your returned order has been received."),
        "refunded": ("Your RK refund was recorded", "Your order refund has been recorded."),
    }
    return copies.get(status)


def send_status_notification(database, order: dict, status: str) -> None:
    copy = _notification_copy(status)
    api_key = current_app.config.get("RESEND_API_KEY")
    email = safe_text(order.get("email"), 160).lower()
    if not copy or not api_key or not email:
        return
    key = f"fulfillment:{status}"
    claimed = database.orders.update_one(
        {"_id": order["_id"], "notificationKeys": {"$ne": key}},
        {"$addToSet": {"notificationKeys": key}},
    )
    if claimed.modified_count != 1:
        return
    subject, message = copy
    number = html.escape(safe_text(order.get("orderNumber"), 80))
    fulfillment = order.get("fulfillment") if isinstance(order.get("fulfillment"), dict) else {}
    tracking_url = safe_text(fulfillment.get("trackingUrl"), 2048)
    tracking = ""
    if status == "shipped":
        courier = html.escape(safe_text(fulfillment.get("courier"), 100))
        tracking_number = html.escape(safe_text(fulfillment.get("trackingNumber"), 160))
        tracking = f"<p>Courier: <strong>{courier}</strong><br>Tracking number: <strong>{tracking_number}</strong></p>"
        if tracking_url:
            tracking = f'{tracking}<p><a href="{html.escape(tracking_url, quote=True)}">Track shipment</a></p>'
    try:
        resend.api_key = api_key
        response = resend.Emails.send({
            "from": f'{current_app.config["EMAIL_FROM_NAME"]} <{current_app.config["EMAIL_FROM"]}>',
            "to": [email],
            "subject": f"{subject} — {number}",
            "html": f"<p>Dear {html.escape(safe_text(order.get('customerName'), 120) or 'Customer')},</p><p>{html.escape(message)}</p>{tracking}",
        })
        database.orders.update_one({"_id": order["_id"]}, {"$push": {"notificationLog": {"key": key, "status": "sent", "timestamp": datetime.now(timezone.utc), "providerId": safe_text((response or {}).get("id") if isinstance(response, dict) else "", 160)}}})
    except Exception as error:
        database.orders.update_one({"_id": order["_id"]}, {"$push": {"notificationLog": {"key": key, "status": "failed", "timestamp": datetime.now(timezone.utc), "error": safe_text(error, 240)}}})
        current_app.logger.exception("Unable to send order status notification")


def apply_transition(database, order: dict, target_status: str, actor_type: str, actor_user: dict | None, payload: dict) -> dict:
    order = ensure_order_tracking(database, order)
    current, target = validate_transition(order, target_status, actor_type)
    note = safe_text(payload.get("note") or payload.get("shippingNote") or DEFAULT_NOTES.get(target), 500)
    if target == "return_requested" and not note:
        raise OrderTransitionError("Enter a reason for the return request.")
    fulfillment = dict(order.get("fulfillment") or {})
    metadata = None
    now = datetime.now(timezone.utc)
    if target == "shipped":
        shipment = shipment_fields(payload, require_complete=True)
        fulfillment.update(shipment)
        fulfillment["shippedAt"] = now
        metadata = {"courier": shipment["courier"], "trackingNumber": shipment["trackingNumber"]}
    if target == "delivered":
        fulfillment["deliveredAt"] = now
    fulfillment["status"] = target
    fields: dict[str, Any] = {
        "fulfillment": fulfillment,
        "fulfillmentStatus": target,
        "status": target,
        "updatedAt": now,
    }
    if target == "refunded":
        payment = dict(order.get("payment") or {})
        payment["status"] = "refunded"
        fields.update({"payment": payment, "paymentStatus": "refunded", "refundedAt": now})
    event = timeline_event(target, now, actor_view(actor_type, actor_user), note, metadata)
    updated = database.orders.find_one_and_update(
        {"_id": order["_id"], "fulfillment.status": current},
        {"$set": fields, "$push": {"timeline": event}},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise OrderTransitionConflict("The order changed in another session. Refresh and try again.")
    send_status_notification(database, updated, target)
    return updated


def update_shipment(database, order: dict, actor_user: dict, payload: dict) -> dict:
    order = ensure_order_tracking(database, order)
    current = canonical_fulfillment_status(order)
    if current not in {"shipped", "out_for_delivery", "delivered"}:
        raise OrderTransitionError("Shipment information can only be edited after an order has shipped.")
    shipment = shipment_fields(payload, require_complete=True)
    now = datetime.now(timezone.utc)
    fulfillment = {**dict(order.get("fulfillment") or {}), **shipment}
    event = timeline_event(
        "shipment_updated",
        now,
        actor_view("staff", actor_user),
        shipment.get("shippingNote") or "Shipment information updated.",
        {"courier": shipment["courier"], "trackingNumber": shipment["trackingNumber"]},
    )
    updated = database.orders.find_one_and_update(
        {"_id": order["_id"], "fulfillment.status": current},
        {"$set": {"fulfillment": fulfillment, "updatedAt": now}, "$push": {"timeline": event}},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise OrderTransitionConflict("The order changed in another session. Refresh and try again.")
    return updated


def order_view(order: dict, include_private_payment: bool = False) -> dict:
    payment = dict(order.get("payment") or {})
    payment["status"] = canonical_payment_status(order)
    payment["gateway"] = payment.get("gateway") or order.get("paymentGateway") or "razorpay"
    if include_private_payment:
        payment["razorpayOrderId"] = payment.get("razorpayOrderId") or order.get("razorpayOrderId")
        payment["razorpayPaymentId"] = payment.get("razorpayPaymentId") or order.get("razorpayPaymentId")
    else:
        payment.pop("razorpayOrderId", None)
        payment.pop("razorpayPaymentId", None)
    fulfillment = dict(order.get("fulfillment") or {})
    fulfillment["status"] = canonical_fulfillment_status(order)
    timeline = order.get("timeline") if isinstance(order.get("timeline"), list) else []
    fields = (
        "orderNumber", "customerName", "email", "phone", "shipping", "items", "subtotal", "shippingCharge",
        "tax", "discount", "total", "amountPaise", "currency", "createdAt", "updatedAt",
    )
    view = {"id": str(order["_id"]), **{key: json_value(order.get(key)) for key in fields if key in order}}
    view.update({
        "shippingAddress": json_value(order.get("shipping") or {}),
        "payment": json_value(payment),
        "paymentStatus": payment["status"],
        "fulfillment": json_value(fulfillment),
        "fulfillmentStatus": fulfillment["status"],
        "timeline": json_value(timeline),
        "latestStatus": json_value(timeline[-1]) if timeline else None,
        "availableActions": valid_next_statuses(order, "staff"),
    })
    return view
