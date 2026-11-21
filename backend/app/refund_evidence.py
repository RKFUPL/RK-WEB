"""Validate persisted refund facts; status labels are never payment evidence."""
from pymongo import ReturnDocument

from .time_utils import as_utc_datetime


def captured_paise(order):
    from .manual_payments import is_manual, paise
    if is_manual(order):
        return max(0, sum(int(t.get("amountPaise", 0)) for t in order.get("paymentTransactions", [])))
    payment = order.get("payment") or {}
    if not (order.get("razorpayPaymentId") or payment.get("razorpayPaymentId")) or not as_utc_datetime(order.get("paymentVerifiedAt") or payment.get("verifiedAt")):
        return 0
    amount = order.get("amountPaise", paise(order.get("total", 0)))
    if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0:
        return 0
    return amount


def verified_refunds(order):
    """Fail closed on malformed, duplicate, foreign or excessive refund evidence."""
    from .manual_payments import is_manual
    refunds = order.get("refunds", [])
    if not isinstance(refunds, list) or any(not isinstance(refund, dict) for refund in refunds):
        raise ValueError("Valid persisted refund evidence is required.")
    if not refunds:
        return []
    if is_manual(order):
        raise ValueError("Manual refunds require a separately audited offline refund process.")
    captured = captured_paise(order)
    payment_id = order.get("razorpayPaymentId") or (order.get("payment") or {}).get("razorpayPaymentId")
    seen, amount = set(), 0
    for refund in refunds:
        value = refund.get("amountPaise")
        reference = refund.get("id")
        if (not captured or not isinstance(reference, str) or not reference or reference in seen
                or refund.get("status") != "processed" or refund.get("source") != "razorpay_signed_webhook"
                or refund.get("paymentId") != payment_id or refund.get("currency") != order.get("currency", "INR")
                or not as_utc_datetime(refund.get("processedAt"))
                or not isinstance(value, int) or isinstance(value, bool) or value <= 0):
            raise ValueError("A verified processed refund for the captured payment is required.")
        seen.add(reference)
        amount += value
    if amount > captured:
        raise ValueError("Refunds cannot exceed the captured payment amount.")
    return refunds


def require_full_refund(order):
    if not captured_paise(order):
        raise ValueError("An unpaid order cannot be marked refunded.")
    refunds = verified_refunds(order)
    if not refunds or sum(r["amountPaise"] for r in refunds) != captured_paise(order):
        raise ValueError("A full verified processed refund is required before marking this order refunded.")


def record_provider_refund(db, order, proof):
    """Called only after signature verification. CAS prevents concurrent over-refunds."""
    for _ in range(5):
        existing = next((r for r in order.get("refunds", []) if r.get("id") == proof.get("id")), None)
        if existing:
            verified_refunds(order)
            if any(existing.get(k) != proof.get(k) for k in ("id", "paymentId", "amountPaise", "currency", "source", "status")):
                raise ValueError("The refund reference already has different recorded evidence.")
            return order, existing
        candidate = {**order, "refunds": [*order.get("refunds", []), proof]}
        refunds = verified_refunds(candidate)
        full = sum(r["amountPaise"] for r in refunds) == captured_paise(order)
        payment_status = "refunded" if full else "partially_refunded"
        from .order_fulfillment import timeline_event, actor_view
        event = timeline_event("refund_completed", proof["processedAt"], actor_view("system", name="Razorpay"),
                               "A verified processed refund was recorded.", {"refundId": proof["id"], "amountPaise": proof["amountPaise"]})
        event["notifyCustomer"] = True
        query = {"_id": order["_id"], "refunds": order.get("refunds", {"$exists": False}),
                 "paymentVerifiedAt": order.get("paymentVerifiedAt"), "razorpayPaymentId": order.get("razorpayPaymentId"),
                 "payment": order.get("payment"), "total": order.get("total"), "amountPaise": order.get("amountPaise"),
                 "captureClaimToken": order.get("captureClaimToken"), "paymentTransactions": order.get("paymentTransactions", {"$exists": False})}
        updated = db.orders.find_one_and_update(query, {"$push": {"refunds": proof, "timeline": event}, "$set": {
            "paymentStatus": payment_status, "payment.status": payment_status}}, return_document=ReturnDocument.AFTER)
        if updated:
            # Use Mongo's persisted timestamp precision/timezone for both channels.
            return updated, next(r for r in updated["refunds"] if r["id"] == proof["id"])
        order = db.orders.find_one({"_id": order["_id"]})
        if not order:
            break
    raise ValueError("The payment or refund ledger changed. Reconciliation is required.")
