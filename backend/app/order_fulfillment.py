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

from bson import ObjectId
from flask import current_app
from pymongo import ReturnDocument
from pymongo.errors import OperationFailure

from .whatsapp import notify, notify_admins
from .mail import SENDERS, send_html_email

from .time_utils import as_utc_datetime, isoformat_utc, json_value as serialize_json_value


PAYMENT_STATUSES = ("pending", "partial", "overdue", "paid", "failed", "refunded", "partially_refunded")
FULFILLMENT_STATUSES = (
    "order_placed",
    "awaiting_confirmation",
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
    "order_placed", "awaiting_confirmation", "confirmed", "processing", "packed", "shipped", "out_for_delivery"
}
FULFILLMENT_SEQUENCE = (
    "order_placed", "awaiting_confirmation", "confirmed", "processing", "packed", "shipped", "out_for_delivery", "delivered"
)

STATUS_LABELS = {
    "order_placed": "Order placed",
    "awaiting_confirmation": "Awaiting availability confirmation",
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
    "awaiting_confirmation": {"confirmed", "cancelled"},
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
    "awaiting_confirmation": "Your requested size is being confirmed by the RK team.",
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

    def __init__(self, message, code="invalid_transition"):
        super().__init__(message)
        self.code = code


class OrderTransitionConflict(RuntimeError):
    """Raised when another request changed an order during an update."""


REJECTION_REASONS = {
    "requested_size_unavailable",
    "fabric_or_material_unavailable",
    "production_or_fulfilment_limitation",
    "other",
}


def rejection_decision(payload: dict) -> tuple[str, str]:
    reason = safe_text(payload.get("rejectionReason"), 80).lower().replace(" ", "_")
    explanation = safe_text(payload.get("rejectionExplanation"), 500)
    if reason not in REJECTION_REASONS:
        raise OrderTransitionError("Choose a valid rejection reason.")
    if reason == "other" and not explanation:
        raise OrderTransitionError("Enter an explanation when the rejection reason is Other.")
    return reason, explanation


def _iso(value: datetime) -> str:
    return isoformat_utc(value) or ""


def json_value(value: Any) -> Any:
    return serialize_json_value(value)


def safe_text(value: object, maximum: int = 240) -> str:
    return str(value or "").strip()[:maximum]


def canonical_payment_status(order: dict) -> str:
    from .manual_payments import is_manual, payment_summary
    if is_manual(order):
        return payment_summary(order)["status"]
    nested = order.get("payment") if isinstance(order.get("payment"), dict) else {}
    status = safe_text(nested.get("status") or order.get("paymentStatus"), 40).lower()
    if status in {"refunded", "partially_refunded"} or order.get("refunds"):
        return payment_summary(order)["status"]
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
    # New manual orders already have tracking. Never persist a stale read over
    # a concurrent ledger update or inventory-backed acceptance.
    if order.get("paymentGateway") == "manual":
        return order
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
    target = "awaiting_confirmation" if order.get("requiresAvailabilityConfirmation") else "confirmed"
    fulfillment = {**normalized["fulfillment"], "status": target}
    events = [
        timeline_event("payment_confirmed", now, actor_view("system", name="Razorpay"), "Payment confirmed."),
        timeline_event(target, now + timedelta(microseconds=1), actor_view("system", name="RK checkout"), DEFAULT_NOTES[target]),
    ]
    fields = {
        "status": target,
        "fulfillmentStatus": target,
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
    if canonical_payment_status(order) != "paid" and order.get("paymentGateway") != "manual":
        statuses = [status for status in statuses if status in {"cancelled", "refunded"}]
    from .inventory_operations import inventory_block_reason
    if inventory_block_reason(order):
        statuses = [status for status in statuses if status in {"cancelled", "refunded", "return_requested"}]
    if "refunded" in statuses:
        from .refund_evidence import require_full_refund
        try:
            require_full_refund(order)
        except ValueError:
            statuses.remove("refunded")
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
    fields = {
        "courier": courier,
        "trackingNumber": tracking_number,
        "trackingUrl": validate_tracking_url(payload.get("trackingUrl")),
        "shippingNote": safe_text(payload.get("shippingNote") or payload.get("note"), 500),
    }
    if payload.get("shippedAt"):
        try:
            value = payload["shippedAt"]
            dispatch = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            dispatch = as_utc_datetime(dispatch)
            if not dispatch or dispatch > datetime.now(timezone.utc) + timedelta(minutes=5):
                raise ValueError()
            fields["shippedAt"] = dispatch
        except (ValueError, TypeError):
            raise OrderTransitionError("Enter a valid dispatch date that is not in the future.") from None
    return fields


def validate_transition(order: dict, target_status: str, actor_type: str = "staff") -> tuple[str, str]:
    current = canonical_fulfillment_status(order)
    target = safe_text(target_status, 60).lower().replace(" ", "_")
    if target not in FULFILLMENT_STATUSES:
        raise OrderTransitionError("Choose a valid fulfillment status.")
    if target == current:
        raise OrderTransitionError(f"The order is already {STATUS_LABELS[target].lower()}.")
    if target not in VALID_TRANSITIONS.get(current, set()):
        raise OrderTransitionError(f"{STATUS_LABELS.get(current, current)} cannot move directly to {STATUS_LABELS.get(target, target)}.")
    from .inventory_operations import inventory_block_reason
    if inventory_block_reason(order) and target not in {"cancelled", "refunded", "return_requested"}:
        raise OrderTransitionError("Inventory reconciliation is required before fulfillment can proceed. Refresh the order and review its inventory operations.", code="inventory_reconciliation_required")
    if target == "confirmed" and canonical_payment_status(order) != "paid" and order.get("paymentGateway") != "manual":
        raise OrderTransitionError("Payment must be confirmed before fulfillment can begin.")
    if actor_type == "customer" and target != "return_requested":
        raise OrderTransitionError("Customers cannot make that fulfillment change.")
    if target == "refunded":
        from .refund_evidence import require_full_refund
        try:
            require_full_refund(order)
        except ValueError as error:
            raise OrderTransitionError(str(error)) from None
    return current, target


def _notification_copy(status: str) -> tuple[str, str] | None:
    status = {"return_status": "returned", "refund_completed": "refunded"}.get(status, status)
    copies = {
        "order_placed": ("Your RK order has been received", "Your order is pending review. Payment is pending; please wait for payment instructions."),
        "order_accepted": ("Your RK order has been accepted", "Our team has accepted your order."),
        "order_rejected": ("Your RK order has been rejected", "Our team is unable to accept your order."),
        "advance_payment_received": ("Advance payment received", "Your advance payment has been recorded."),
        "part_payment_received": ("Part payment received", "Your part payment has been recorded."),
        "payment_received": ("Payment received in full", "The remaining payment has been recorded. Your balance is now zero."),
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
    from .inventory_operations import persisted_inventory_block_reason
    if status in {"confirmed", "order_accepted", "processing", "packed", "shipped", "out_for_delivery", "delivered"} and persisted_inventory_block_reason(database, order):
        return
    copy = _notification_copy(status)
    email = safe_text(order.get("email"), 160).lower()
    if not copy or not email:
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
        response = send_html_email(
            sender=SENDERS["orders"], recipients=[email], subject=f"{subject} — {number}",
            html=f"<p>Dear {html.escape(safe_text(order.get('customerName'), 120) or 'Customer')},</p><p>{html.escape(message)}</p>{tracking}",
        )
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
    from .notification_activity import record_channel, email_failure_reason, claim_email, finish_email, email_heartbeat, SAFE_EMAIL_FAILURES
    from .notification_activity import notification_key as canonical_key
    event = {"confirmed": "order_accepted", "returned": "return_status", "refunded": "refund_completed"}.get(status, status)
    if notification_key and notification_key.startswith("shipment:"):
        event = "shipped"
    supplied_refund = (order.get("whatsappRefund") or {}).get("id")
    order = database.orders.find_one({"_id": order.get("_id")})
    if not order:
        return
    if notification_key and notification_key.startswith("payment:"):
        order["whatsappPayment"] = next((t for t in order.get("paymentTransactions", []) if t.get("id") == notification_key[8:]), {})
    if event == "refund_completed":
        refund_id = notification_key[7:] if notification_key and notification_key.startswith("refund:") else supplied_refund
        order["whatsappRefund"] = next((r for r in order.get("refunds", []) if r.get("id") == refund_id), {})
    if status != "refunded":
        from .whatsapp_events import event_values, ORDER_EVENTS
        try:
            if event in ORDER_EVENTS:
                event_values(event, order)
            elif {"return_requested": "return_requested", "return_status": "returned"}.get(event) != canonical_fulfillment_status(order):
                raise ValueError("notification_lifecycle_ineligible")
        except (ValueError, KeyError):
            for channel in ("email", "whatsapp"):
                record_channel(database, order["_id"], event, channel, "skipped", "business_event_not_confirmed", key="invalid_request:" + event)
            # Preserve the staff-visible WhatsApp skip evidence without calling
            # transport, and never overwrite an existing queue/provider outcome.
            from .whatsapp_orders import business_event_key
            import hashlib
            at = datetime.now(timezone.utc)
            audit_id = hashlib.sha256(business_event_key(order, event).encode()).hexdigest()
            reason = "shipment_not_recorded" if event in {"shipped", "tracking_update", "out_for_delivery"} else "business_event_not_confirmed"
            database.whatsapp_order_events.update_one({"_id": audit_id}, {"$setOnInsert": {
                "orderId": str(order["_id"]), "event": event, "status": "skipped", "reason": reason,
                "createdAt": at, "updatedAt": at}}, upsert=True)
            return
    from .inventory_operations import persisted_inventory_block_reason
    success_events = {"order_confirmation", "order_accepted", "processing", "packed", "shipped", "out_for_delivery", "delivered"}
    if event in success_events and persisted_inventory_block_reason(database, order):
        for channel in ("email", "whatsapp"):
            record_channel(database, order["_id"], event, channel, "skipped", "inventory_reconciliation_required", key=notification_key)
        return
    if status == "refunded":
        for channel in ("email", "whatsapp"):
            record_channel(database, order["_id"], event, channel, "skipped", "refund_status_only", key=notification_key)
        return
    if event == "refund_completed":
        # A status label and a client-supplied reference never authorize a refund message.
        from .whatsapp_events import event_values
        try:
            event_values(event, order)
        except (ValueError, KeyError):
            for channel in ("whatsapp", "email"):
                record_channel(database, order["_id"], event, channel, "skipped", "refund_not_processed", key=notification_key)
            if status != "refunded":
                notify(database, event, order)
            return
    if notification_key and notification_key.startswith("payment:"):
        order = {**order, "whatsappPayment": next((t for t in order.get("paymentTransactions", []) if t.get("id") == notification_key[8:]), {})}
    if notification_key and notification_key.startswith("shipment:"):
        event = "shipped"
    if status == "return_requested":
        notify_admins(database, order, "return_requested")
    notification_id = f"order_confirmation:{order.get('_id')}" if event == "order_confirmation" else f"{order.get('_id')}:{notification_key or ('fulfillment:' + status)}"
    notify(database, event, order, key=notification_id,
           parameters={"reference": str(order.get("orderNumber") or order.get("_id") or ""),
                       "status": {"returned": "return received", "refunded": "refund completed"}.get(status, status.replace("_", " "))})
    copy = _notification_copy(event)
    email = safe_text(order.get("email"), 160).lower()
    if not copy or not email:
        record_channel(database, order["_id"], event, "email", "skipped", "email_recipient_missing" if not email else "email_event_unsupported", key=notification_key)
        return
    key = canonical_key(event, notification_key)
    claim = claim_email(database, order["_id"], event, key, snapshot=order)
    if not claim:
        return
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
    if feedback_link:
        tracking += f'<p><a href="{html.escape(feedback_link, quote=True)}">Share your experience</a></p>'
    note = html.escape(safe_text(customer_note, 500))
    note_html = f"<div style='border-left:2px solid #c09355;padding:12px 16px;margin:24px 0'>{note}</div>" if note else ""
    from .order_confirmation import render_order_confirmation
    from .manual_payments import payment_summary
    summary = payment_summary(order)
    payment_html = f"<p>Payment: {html.escape(summary['status'])}. Received: INR {summary['received']:,.2f}. Balance due: INR {summary['balanceDue']:,.2f}.</p>"
    try:
        with email_heartbeat(database, order["_id"], event, key, claim):
            response = send_html_email(
                sender=SENDERS["orders"], recipients=[email], subject=f"{subject} — {number}",
                html=render_order_confirmation(order, title=subject, message=message, details_html=note_html + tracking + payment_html),
            )
    except Exception as error:
        reason = email_failure_reason(error)
        state = "failed" if reason in SAFE_EMAIL_FAILURES else "held"
        finish_email(database, order["_id"], event, key, claim, state, reason, getattr(error, "submission", None))
        current_app.logger.warning("Order email failed: %s", reason)
    else:
        # A DB acknowledgement failure after SMTP acceptance must retain the claim.
        # It must never be mistaken for a retryable SMTP rejection.
        response = response if isinstance(response, dict) else {}
        finish_email(database, order["_id"], event, key, claim, "accepted", response.get("reason"), response.get("submission"), response.get("id"))


def apply_transition(database, order: dict, target_status: str, actor_type: str, actor_user: dict | None, payload: dict) -> dict:
    loaded = order
    order = database.orders.find_one({"_id": order.get("_id")}) or order
    if canonical_fulfillment_status(loaded) != canonical_fulfillment_status(order):
        raise OrderTransitionConflict("The order changed in another session. Refresh and try again.")
    from .inventory_operations import persisted_inventory_block_reason
    normalized_target = safe_text(target_status, 60).lower().replace(" ", "_")
    if normalized_target not in {"cancelled", "refunded", "return_requested"} and persisted_inventory_block_reason(database, order):
        raise OrderTransitionError("Inventory reconciliation is required before fulfillment can proceed. Refresh the order and review its inventory operations.", code="inventory_reconciliation_required")
    current, target = validate_transition(order, target_status, actor_type)
    order = ensure_order_tracking(database, order)
    send_customer_notification = payload.get("sendCustomerNotification", True) is not False
    requested_customer_note = safe_text(payload.get("customerNote"), 500)
    customer_note = requested_customer_note if send_customer_notification or actor_type == "customer" else ""
    internal_note = safe_text(payload.get("internalNote") or payload.get("note") or payload.get("shippingNote"), 500)
    rejection_reason = ""
    rejection_explanation = ""
    if current in {"order_placed", "awaiting_confirmation"} and target == "cancelled":
        rejection_reason, rejection_explanation = rejection_decision(payload)
        customer_note = rejection_explanation or rejection_reason.replace("_", " ").capitalize()
        internal_note = customer_note
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
        fulfillment["shippedAt"] = shipment.get("shippedAt") or now
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
    if current in {"order_placed", "awaiting_confirmation"} and target in {"confirmed", "cancelled"}:
        fields["availabilityDecision"] = {
            "status": "accepted" if target == "confirmed" else "rejected",
            "reason": rejection_reason or None,
            "explanation": rejection_explanation or None,
            "decidedAt": now,
            "decidedBy": str((actor_user or {}).get("_id") or ""),
        }
    if target == "refunded":
        payment = dict(order.get("payment") or {})
        payment["status"] = "refunded"
        fields.update({"payment": payment, "paymentStatus": "refunded", "refundedAt": now})
    notification_status = "order_accepted" if target == "confirmed" else "order_rejected" if current in {"order_placed", "awaiting_confirmation"} and target == "cancelled" else target
    event = timeline_event(notification_status, now, actor_view(actor_type, actor_user), note, metadata)
    if internal_note and actor_type != "customer":
        event["internalNote"] = internal_note
    if customer_note:
        event["customerNote"] = customer_note
    event["notifyCustomer"] = send_customer_notification
    reservations = None
    if order.get("paymentGateway") == "manual" and target == "confirmed":
        from .manual_inventory import reserve_manual_acceptance
        reservations = reserve_manual_acceptance(database, order, payload)
        fields["inventoryReservation"] = "reserved"
    try:
        transition_query = {"_id": order["_id"], "fulfillment.status": current}
        if reservations is not None:
            transition_query.update({"inventoryReservationClaimToken": reservations.claim_token,
                                     "inventoryReservation": "reserving" if reservations.owned else "reserved"})
        if target == "refunded":
            # Fence the evidence read above against concurrent payment/refund changes.
            transition_query.update({"refunds": order.get("refunds"), "payment": order.get("payment"),
                                     "paymentVerifiedAt": order.get("paymentVerifiedAt"), "razorpayPaymentId": order.get("razorpayPaymentId"),
                                     "total": order.get("total"), "paymentTransactions": order.get("paymentTransactions", {"$exists": False})})
        updated = database.orders.find_one_and_update(
            transition_query,
            {"$set": fields, "$push": {"timeline": event}},
            return_document=ReturnDocument.AFTER,
        )
    except Exception:
        # If acknowledgement was lost, never release stock for a committed acceptance.
        persisted = database.orders.find_one({"_id": order["_id"]})
        if reservations is not None and (persisted or {}).get("inventoryReservation") == "reserving" and (persisted.get("fulfillment") or {}).get("status") == current:
            from .manual_inventory import rollback_manual_acceptance
            rollback_manual_acceptance(database, order, reservations)
        raise
    if not updated:
        if reservations is not None:
            from .manual_inventory import rollback_manual_acceptance
            rollback_manual_acceptance(database, order, reservations)
        raise OrderTransitionConflict("The order changed in another session. Refresh and try again.")
    if target == "refunded":
        # Only the signed provider event may request a refund-completed message.
        from .notification_activity import record_channel
        for channel in ("email", "whatsapp"):
            record_channel(database, updated["_id"], "refund_completed", channel, "skipped", "refund_status_only", key="fulfillment:refunded")
    elif send_customer_notification:
        send_status_notification(database, updated, notification_status, customer_note)
    else:
        from .whatsapp_orders import ORDER_NOTIFICATIONS, notify_order_whatsapp
        from .notification_activity import record_channel
        whatsapp_event = {"confirmed": "order_accepted", "refunded": "refund_completed"}.get(notification_status, notification_status)
        record_channel(database, updated["_id"], whatsapp_event, "email", "skipped", "staff_notifications_disabled", key="fulfillment:" + notification_status)
        if whatsapp_event in ORDER_NOTIFICATIONS:
            notify_order_whatsapp(database, updated["_id"], whatsapp_event, {"suppressed": True})
    return updated


def update_shipment(database, order: dict, actor_user: dict, payload: dict) -> dict:
    order = database.orders.find_one({"_id": order.get("_id")}) or order
    from .inventory_operations import persisted_inventory_block_reason
    if persisted_inventory_block_reason(database, order):
        raise OrderTransitionError("Inventory reconciliation is required before shipment changes can be made.", code="inventory_reconciliation_required")
    order = ensure_order_tracking(database, order)
    current = canonical_fulfillment_status(order)
    if current not in {"shipped", "out_for_delivery", "delivered"}:
        raise OrderTransitionError("Shipment information can only be edited after an order has shipped.")
    shipment = shipment_fields({**dict(order.get("fulfillment") or {}), **payload}, require_complete=False)
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
    else:
        from .whatsapp_orders import notify_order_whatsapp
        notify_order_whatsapp(database, updated["_id"], "shipped", {"suppressed": True})
    return updated


def order_view(order: dict, include_private_payment: bool = False) -> dict:
    payment = dict(order.get("payment") or {})
    payment["status"] = canonical_payment_status(order)
    payment["gateway"] = payment.get("gateway") or order.get("paymentGateway") or "razorpay"
    if include_private_payment and payment["gateway"] != "manual":
        payment["razorpayOrderId"] = payment.get("razorpayOrderId") or order.get("razorpayOrderId")
        payment["razorpayPaymentId"] = payment.get("razorpayPaymentId") or order.get("razorpayPaymentId")
    else:
        payment.pop("razorpayOrderId", None)
        payment.pop("razorpayPaymentId", None)
    fulfillment = dict(order.get("fulfillment") or {})
    fulfillment["status"] = canonical_fulfillment_status(order)
    timeline = order.get("timeline") if isinstance(order.get("timeline"), list) else []
    if not include_private_payment:
        timeline = [{key: value for key, value in event.items() if key not in {"internalNote", "notifyCustomer", "notificationOutcomes"}} for event in timeline]
    fields = (
        "orderNumber", "customerName", "email", "phone", "shipping", "items", "subtotal", "shippingCharge",
        "tax", "discount", "total", "amountPaise", "currency", "confirmationEmail", "requiresAvailabilityConfirmation", "availabilityDecision", "createdAt", "updatedAt",
    )
    view = {"id": str(order["_id"]), **{key: json_value(order.get(key)) for key in fields if key in order}}
    from .manual_payments import payment_summary
    view["paymentCollection"] = json_value(payment_summary(order))
    if not include_private_payment:
        view["paymentCollection"].pop("evidenceIssue", None)
        if isinstance(view.get("confirmationEmail"), dict):
            view["confirmationEmail"] = {key: value for key, value in view["confirmationEmail"].items()
                                         if key in {"status", "attempts", "sentAt"}}
    if include_private_payment:
        view["paymentTransactions"] = json_value(order.get("paymentTransactions", []))
        view["notificationLog"] = json_value(order.get("notificationLog", []))
        view["inventoryReservation"] = order.get("inventoryReservation")
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
    view["refunds"] = json_value([{key: refund.get(key) for key in ("id", "status", "amountPaise", "currency", "processedAt")}
                                for refund in order.get("refunds", []) if refund.get("source") == "razorpay_signed_webhook" and refund.get("status") == "processed"])
    return view
