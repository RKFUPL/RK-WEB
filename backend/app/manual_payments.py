"""Manual collections on the existing order. Amounts and event identities are server-owned."""
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import re

from bson import ObjectId
from pymongo import ReturnDocument

from .time_utils import as_utc_datetime

MANUAL_PAYMENT_EVENTS = {"advance_payment_received", "part_payment_received", "payment_received"}


def paise(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0 or amount.as_tuple().exponent < -2:
            raise ValueError()
        return int(amount * 100)
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError("Enter a valid INR amount with at most two decimal places.") from None


def parse_due(value):
    if value is None or value == "":
        return None
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError("Enter a valid payment due date.")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=timezone.utc) if len(value) == 10 else as_utc_datetime(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except ValueError:
        raise ValueError("Enter a valid payment due date.") from None


def is_manual(order):
    return order.get("paymentGateway") == "manual" or (order.get("payment") or {}).get("gateway") == "manual"


def payment_summary(order, at=None):
    total = paise(order.get("total", 0))
    if is_manual(order):
        received = sum(int(t["amountPaise"]) for t in order.get("paymentTransactions", []))
        balance = max(0, total - received)
        due = as_utc_datetime(order.get("paymentDueAt"))
        status = "paid" if balance == 0 and received > 0 else "partial" if received else "pending"
        if balance and due and due < (at or datetime.now(timezone.utc)):
            status = "overdue"
    else:
        status = (order.get("payment") or {}).get("status") or order.get("paymentStatus", "pending")
        from .refund_evidence import captured_paise
        received = captured_paise(order)
        balance = max(0, total - received)
        if status in {"refunded", "partially_refunded"}:
            status = "paid" if received else "pending"
    from .refund_evidence import verified_refunds
    evidence_issue = None
    try:
        refunded = sum(r["amountPaise"] for r in verified_refunds(order))
    except ValueError:
        refunded = 0
        evidence_issue = "refund_evidence_invalid"
    if refunded:
        status = "refunded" if refunded == received else "partially_refunded"
    closed = ((order.get("fulfillment") or {}).get("status") or order.get("fulfillmentStatus") or order.get("status")) in {"cancelled", "rejected", "returned", "refunded"}
    if closed and status == "overdue":
        status = "partial" if received else "pending"
    collectible = 0 if closed else balance
    if closed and not refunded and ((order.get("fulfillment") or {}).get("status") or order.get("status")) == "refunded":
        evidence_issue = evidence_issue or "refund_evidence_missing"
    return {"total": total / 100, "received": received / 100, "balanceDue": balance / 100,
            "refunded": refunded / 100, "netReceived": (received - refunded) / 100,
            "collectibleBalance": collectible / 100, "refundableAmount": max(0, received - refunded) / 100,
            "evidenceIssue": evidence_issue,
            "status": status, "dueAt": order.get("paymentDueAt"), "instructions": order.get("paymentInstructions", "")}


def record_payment(db, order, actor, payload):
    if not is_manual(order):
        raise ValueError("Manual collections cannot change Razorpay payment records.")
    if not actor or not ObjectId.is_valid(str(actor.get("_id", ""))):
        raise ValueError("A valid staff actor is required.")
    if (order.get("fulfillment") or {}).get("status") in {"cancelled", "refunded", "rejected"}:
        raise ValueError("Payments cannot be collected on a closed order.")
    key = payload.get("transactionId")
    if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{8,80}", key):
        raise ValueError("A valid transaction ID is required.")
    if any(t.get("id") == key for t in order.get("paymentTransactions", [])):
        raise ValueError("This transaction was already recorded. Refresh the order.")
    method = payload.get("method")
    if method not in {"upi", "bank_transfer", "cash", "cheque", "other"}:
        raise ValueError("Choose a valid payment method.")
    reference, note = payload.get("reference", ""), payload.get("note", "")
    if not isinstance(reference, str) or len(reference) > 160 or not isinstance(note, str) or len(note) > 500:
        raise ValueError("Payment reference or note is too long.")
    summary = payment_summary(order)
    balance = paise(summary["balanceDue"])
    action = payload.get("action")
    if action not in {None, "advance", "half", "remaining"}:
        raise ValueError("Choose a valid collection action.")
    amount = balance if action == "remaining" else min(paise(summary["total"]) // 2, balance) if action == "half" else paise(payload.get("amount"))
    if amount <= 0 or amount > balance:
        raise ValueError("Payment must be positive and cannot exceed the outstanding balance.")
    now = datetime.now(timezone.utc)
    due = order.get("paymentDueAt")
    if "dueAt" in payload:
        raw = payload["dueAt"]
        due = parse_due(raw)
        if raw and not due:
            raise ValueError("Enter a valid payment due date.")
    received = paise(summary["received"]) + amount
    event_name = "payment_received" if amount == balance else "advance_payment_received" if action == "advance" else "part_payment_received"
    transaction = {"id": key, "amountPaise": amount, "amount": amount / 100, "method": method,
                   "reference": reference.strip(), "note": note.strip(), "timestamp": now,
                   "recordedBy": str(actor["_id"]), "event": event_name,
                   "receivedPaise": received, "balancePaise": balance - amount}
    status = "paid" if amount == balance else "partial"
    from .order_fulfillment import actor_view, timeline_event
    event = timeline_event(event_name, now, actor_view("staff", actor), "Payment received.", {"transactionId": key, "amount": amount / 100})
    version = order.get("paymentLedgerVersion", 0)
    query = {"_id": order["_id"], "paymentTransactions.id": {"$ne": key},
             "paymentLedgerVersion": version if version else {"$in": [None, 0]},
             "fulfillment.status": (order.get("fulfillment") or {}).get("status")}
    updated = db.orders.find_one_and_update(query, {
        "$push": {"paymentTransactions": transaction, "timeline": event},
        "$inc": {"paymentLedgerVersion": 1},
        "$set": {"paymentStatus": status, "payment.status": status, "amountReceived": received / 100,
                 "balanceDue": (balance - amount) / 100, "paymentDueAt": due, "updatedAt": now}},
        return_document=ReturnDocument.AFTER)
    if not updated:
        raise ValueError("The payment ledger changed. Refresh before recording another payment.")
    # A notification failure must never reverse a successfully recorded payment.
    from .order_fulfillment import send_status_notification
    try:
        send_status_notification(db, updated, event_name, notification_key="payment:" + key)
    except Exception:
        from flask import current_app
        current_app.logger.warning("Payment saved; notification activity needs reconciliation")
    return updated


def reverse_payment(db, order, actor, payload):
    """A correction appends a full reversal; the original receipt is never rewritten."""
    if not is_manual(order) or not actor or not ObjectId.is_valid(str(actor.get("_id", ""))):
        raise ValueError("A valid manual order and staff actor are required.")
    key, original_id, note = payload.get("transactionId"), payload.get("reverses"), payload.get("note")
    if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{8,80}", key) or not isinstance(note, str) or not note.strip() or len(note) > 500:
        raise ValueError("A unique transaction ID and correction reason are required.")
    transactions = order.get("paymentTransactions", [])
    original = next((t for t in transactions if t.get("id") == original_id and t["amountPaise"] > 0), None)
    if not original or any(t.get("reverses") == original_id or t.get("id") == key for t in transactions):
        raise ValueError("Choose an original payment that has not already been reversed.")
    received = paise(payment_summary(order)["received"]) - original["amountPaise"]
    balance = paise(order["total"]) - received
    now = datetime.now(timezone.utc)
    adjustment = {"id": key, "reverses": original_id, "amountPaise": -original["amountPaise"],
                  "amount": -original["amount"], "method": original["method"], "note": note.strip(),
                  "timestamp": now, "recordedBy": str(actor["_id"]), "event": "payment_reversed"}
    from .order_fulfillment import timeline_event, actor_view
    event = timeline_event("payment_reversed", now, actor_view("staff", actor), "Payment correction recorded.", {"transactionId": key, "reverses": original_id})
    event["internalNote"] = note.strip()
    status = "partial" if received else "pending"
    updated = db.orders.find_one_and_update({"_id": order["_id"], "paymentLedgerVersion": order.get("paymentLedgerVersion", 0),
                                             "paymentTransactions.id": {"$ne": key}, "paymentTransactions.reverses": {"$ne": original_id}},
        {"$push": {"paymentTransactions": adjustment, "timeline": event}, "$inc": {"paymentLedgerVersion": 1},
         "$set": {"paymentStatus": status, "payment.status": status, "amountReceived": received / 100, "balanceDue": balance / 100, "updatedAt": now}},
        return_document=ReturnDocument.AFTER)
    if not updated:
        raise ValueError("The payment ledger changed. Refresh before recording a correction.")
    return updated
