"""Monotonic provider payment transitions, independent of fulfilment permission."""
from datetime import datetime, timezone

CLOSED_ORDER_STATES = {"cancelled", "rejected", "returned", "refunded", "return_requested", "delivered"}
INITIAL_PAYMENT_STATES = ["pending", "order_created", "verification_pending", "failed", "cancelled"]


def failure_fence(order_id):
    return {"_id": order_id, "paymentStatus": {"$in": INITIAL_PAYMENT_STATES},
            "paymentVerifiedAt": None, "payment.verifiedAt": None, "captureEvidence": {"$exists": False},
            "inventoryAdjustedAt": None, "refunds.0": {"$exists": False}}


def failure_snapshot(order):
    """A stale failure cannot replace a newer lifecycle/payment snapshot."""
    return {**failure_fence(order["_id"]), "fulfillment": order.get("fulfillment"),
            "status": order.get("status"), "payment": order.get("payment")}


def has_capture(order):
    return bool(order.get("paymentVerifiedAt") or (order.get("payment") or {}).get("verifiedAt")
                or order.get("captureEvidence") or order.get("inventoryAdjustedAt")
                or order.get("refunds") or order.get("paymentStatus") in {"paid", "refunded", "partially_refunded"})


def reconcile(db, order, payment_id, reason, source):
    """Safe audit identity, no provider payload or customer contact information."""
    import hashlib
    key = hashlib.sha256(f"{order['_id']}:{payment_id}:{reason}:{source}".encode()).hexdigest()
    db.payment_reconciliations.update_one({"_id": key}, {"$setOnInsert": {
        "orderId": str(order["_id"]), "paymentId": payment_id, "reason": reason,
        "source": source, "status": "held", "createdAt": datetime.now(timezone.utc)}}, upsert=True)


def capture_evidence(order, payment_id, source, at):
    from .manual_payments import paise
    return {"paymentId": payment_id, "amountPaise": order.get("amountPaise", paise(order.get("total", 0))), "currency": order.get("currency", "INR"),
            "status": "captured", "source": source, "verifiedAt": at}
