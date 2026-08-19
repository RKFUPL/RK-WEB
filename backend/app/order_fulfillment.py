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

from .time_utils import as_utc_datetime, isoformat_utc, json_value as serialize_json_value


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
RETURN_FULFILLMENT_STATUSES = ("return_requested", "returned", "refunded")
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
    return isoformat_utc(value) or ""


def json_value(value: Any) -> Any:
    return serialize_json_value(value)


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
    created = as_utc_datetime(order.get("createdAt")) or datetime.now(timezone.utc)
    payment_at = as_utc_datetime(order.get("paymentVerifiedAt")) or created
    updated = as_utc_datetime(order.get("updatedAt")) or payment_at
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


def shipment_fields(payload: dict, require_complete: bool = False) -> dict:
    courier = safe_text(payload.get("courier"), 100)
    tracking_number = safe_text(payload.get("trackingNumber"), 160)
    if require_complete and (not courier or not tracking_number):
        raise OrderTransitionError("Courier and tracking number are required for this shipment update.")
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
        "processing": ("Your RK order has been processed", "Your order has been processed and will be sent for shipping shortly."),
        "packed": ("Your RK order has been packed", "Your order has been packed and is ready for dispatch."),
        "shipped": ("Your RK order has shipped", "Your order has shipped."),
        "out_for_delivery": ("Your RK order is out for delivery", "Your order is out for delivery."),
        "delivered": ("Your RK order has been delivered", "Your order has been delivered."),
        "cancelled": ("Your RK order was cancelled", "Your order was cancelled."),
        "returned": ("Your RK return was received", "Your returned order has been received."),
        "refunded": ("Your RK refund was recorded", "Your order refund has been recorded."),
    }
    return copies.get(status)


def _legacy_send_status_notification(database, order: dict, status: str) -> None:
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


def _proof_data(value: object, maximum: int = 2_500_000) -> str:
    candidate = safe_text(value, maximum)
    if not candidate:
        return ""
    if not re.fullmatch(r"data:image/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+", candidate):
        raise OrderTransitionError("Delivery proof must be a PNG, JPEG, or WebP image.")
    return candidate


def send_status_notification(database, order: dict, status: str, customer_note: str = "", notification_key: str | None = None) -> None:
    copy = _notification_copy(status)
    email = safe_text(order.get("email"), 160).lower()
    if not copy or not email:
        return
    key = notification_key or f"fulfillment:{status}"
    claimed = database.orders.update_one(
        {"_id": order["_id"], "notificationKeys": {"$ne": key}},
        {"$addToSet": {"notificationKeys": key}},
    )
    if claimed.modified_count != 1:
        return
    api_key = current_app.config.get("RESEND_API_KEY")
    subject, message = copy
    number = html.escape(safe_text(order.get("orderNumber"), 80))
    customer_name = html.escape(safe_text(order.get("customerName"), 120) or "Customer")
    fulfillment = order.get("fulfillment") if isinstance(order.get("fulfillment"), dict) else {}
    tracking = ""
    if status == "shipped" or key.startswith("shipment:"):
        courier = html.escape(safe_text(fulfillment.get("courier"), 100))
        tracking_number = html.escape(safe_text(fulfillment.get("trackingNumber"), 160))
        tracking = f"<p>Courier: <strong>{courier or 'To be assigned'}</strong><br>Tracking number: <strong>{tracking_number or 'Not yet available'}</strong></p>"
        tracking_url = safe_text(fulfillment.get("trackingUrl"), 2048)
        if tracking_url:
            tracking += f'<p><a href="{html.escape(tracking_url, quote=True)}">Track shipment</a></p>'
    feedback_link = ""
    if status == "delivered":
        delivery = fulfillment.get("delivery") if isinstance(fulfillment.get("delivery"), dict) else {}
        received_by = html.escape(safe_text(delivery.get("receivedBy"), 160))
        if received_by:
            tracking += f"<p>Received by: <strong>{received_by}</strong></p>"
        if delivery.get("proofPhoto") or delivery.get("signature"):
            tracking += "<p>Delivery proof has been recorded securely with your order.</p>"
        try:
            from .feedback import create_feedback_token, feedback_url
            token = create_feedback_token(database, order, delivery.get("deliveredAt") or datetime.now(timezone.utc))
            feedback_link = feedback_url(token)
        except Exception:
            current_app.logger.exception("Unable to create delivery feedback link")
    if not api_key:
        return
    if feedback_link:
        tracking += f'<p><a href="{html.escape(feedback_link, quote=True)}">Share your experience</a></p>'
    note = html.escape(safe_text(customer_note, 500))
    note_html = f"<div style='border-left:2px solid #c09355;padding:12px 16px;margin:24px 0'>{note}</div>" if note else ""
    try:
        resend.api_key = api_key
        response = resend.Emails.send({
            "from": f'{current_app.config["EMAIL_FROM_NAME"]} <{current_app.config["EMAIL_FROM"]}>',
            "to": [email],
            "subject": f"{subject} — {number}",
            "html": f"<div style='background:#f8f5ef;padding:32px;color:#27221d;font-family:Arial,sans-serif'><p style='letter-spacing:.28em;text-transform:uppercase;font-size:11px'>RASHI KAPOOR</p><h1 style='font-family:Georgia,serif;font-weight:400'>{html.escape(subject)}</h1><p>Dear {customer_name},</p><p>{html.escape(message)}</p>{note_html}{tracking}<p>We will keep you updated as your order progresses.</p><p>Yours sincerely,<br>The Rashi Kapoor Team</p></div>",
        })
        database.orders.update_one({"_id": order["_id"]}, {"$push": {"notificationLog": {"key": key, "status": "sent", "timestamp": datetime.now(timezone.utc), "providerId": safe_text((response or {}).get("id") if isinstance(response, dict) else "", 160)}}})
    except Exception as error:
        database.orders.update_one({"_id": order["_id"]}, {"$push": {"notificationLog": {"key": key, "status": "failed", "timestamp": datetime.now(timezone.utc), "error": safe_text(error, 240)}}})
        current_app.logger.exception("Unable to send order status notification")


def apply_transition(database, order: dict, target_status: str, actor_type: str, actor_user: dict | None, payload: dict) -> dict:
    order = ensure_order_tracking(database, order)
    current, target = validate_transition(order, target_status, actor_type)
    send_customer_notification = payload.get("sendCustomerNotification", True) is not False
    requested_customer_note = safe_text(payload.get("customerNote"), 500)
    customer_note = requested_customer_note if send_customer_notification or actor_type == "customer" else ""
    internal_note = safe_text(payload.get("internalNote") or payload.get("note") or payload.get("shippingNote"), 500)
    if actor_type != "customer" and not send_customer_notification and requested_customer_note:
        internal_note = internal_note or requested_customer_note
    note = customer_note or (internal_note if actor_type == "customer" else DEFAULT_NOTES.get(target, ""))
    if target == "return_requested" and not note:
        raise OrderTransitionError("Enter a reason for the return request.")
    fulfillment = dict(order.get("fulfillment") or {})
    metadata = None
    now = datetime.now(timezone.utc)
    if target == "shipped":
        shipment = shipment_fields(payload, require_complete=False)
        fulfillment.update(shipment)
        fulfillment["shippedAt"] = now
        metadata = {"courier": shipment["courier"], "trackingNumber": shipment["trackingNumber"]}
    if target == "delivered":
        fulfillment["deliveredAt"] = now
        delivery = dict(fulfillment.get("delivery") or {})
        delivery.update({
            "receivedBy": safe_text(payload.get("receivedBy"), 160),
            "proofPhoto": _proof_data(payload.get("proofPhoto")),
            "signature": _proof_data(payload.get("signature")),
            "deliveredAt": now,
        })
        fulfillment["delivery"] = delivery
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
    if internal_note and actor_type != "customer":
        event["internalNote"] = internal_note
    if customer_note:
        event["customerNote"] = customer_note
    event["notifyCustomer"] = send_customer_notification
    updated = database.orders.find_one_and_update(
        {"_id": order["_id"], "fulfillment.status": current},
        {"$set": fields, "$push": {"timeline": event}},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise OrderTransitionConflict("The order changed in another session. Refresh and try again.")
    if send_customer_notification:
        send_status_notification(database, updated, target, customer_note)
    return updated


def update_shipment(database, order: dict, actor_user: dict, payload: dict) -> dict:
    order = ensure_order_tracking(database, order)
    current = canonical_fulfillment_status(order)
    if current not in {"shipped", "out_for_delivery", "delivered"}:
        raise OrderTransitionError("Shipment information can only be edited after an order has shipped.")
    shipment = shipment_fields(payload, require_complete=False)
    now = datetime.now(timezone.utc)
    fulfillment = {**dict(order.get("fulfillment") or {}), **shipment}
    send_customer_notification = payload.get("sendCustomerNotification", True) is not False
    requested_customer_note = safe_text(payload.get("customerNote"), 500)
    customer_note = requested_customer_note if send_customer_notification else ""
    internal_note = safe_text(payload.get("internalNote") or payload.get("note") or payload.get("shippingNote"), 500)
    if not send_customer_notification and requested_customer_note:
        internal_note = internal_note or requested_customer_note
    event = timeline_event(
        "shipment_updated",
        now,
        actor_view("staff", actor_user),
        customer_note or "Shipment information updated.",
        {"courier": shipment["courier"], "trackingNumber": shipment["trackingNumber"]},
    )
    event["notifyCustomer"] = send_customer_notification
    if customer_note:
        event["customerNote"] = customer_note
    if internal_note:
        event["internalNote"] = internal_note
    updated = database.orders.find_one_and_update(
        {"_id": order["_id"], "fulfillment.status": current},
        {"$set": {"fulfillment": fulfillment, "updatedAt": now}, "$push": {"timeline": event}},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise OrderTransitionConflict("The order changed in another session. Refresh and try again.")
    if payload.get("sendCustomerNotification", True) is not False:
        send_status_notification(database, updated, "shipped", customer_note, f"shipment:{now.isoformat()}")
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
    if not include_private_payment:
        timeline = [{key: value for key, value in event.items() if key not in {"internalNote", "notifyCustomer"}} for event in timeline]
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
        "availableActions": valid_next_statuses(order, "staff") + (["shipment_update"] if fulfillment["status"] in {"shipped", "out_for_delivery", "delivered"} else []) + (["return_accept"] if fulfillment["status"] == "return_requested" and isinstance(order.get("returnRequest"), dict) and order["returnRequest"].get("status") != "accepted" else []),
    })
    if isinstance(order.get("returnRequest"), dict):
        return_request = {key: value for key, value in order["returnRequest"].items() if key not in {"token", "tokenHash"}}
        view["returnRequest"] = json_value(return_request)
    return view
