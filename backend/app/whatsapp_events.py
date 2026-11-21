"""Read existing persisted business results; never perform business transitions."""
from decimal import Decimal, InvalidOperation
from datetime import timedelta
from .time_utils import as_utc_datetime

ORDER_EVENTS = {"order_placed", "order_accepted", "order_rejected", "processing", "packed", "advance_payment_received", "part_payment_received", "payment_received", "order_confirmation", "payment_confirmation", "shipped", "tracking_update", "out_for_delivery", "delivered", "cancelled", "refund_completed"}


def money(value, currency="INR"):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0:
            raise ValueError("invalid_amount")
    except (InvalidOperation, TypeError):
        raise ValueError("invalid_amount") from None
    return f"{currency} {amount:,.2f}"


def business_date(value):
    timestamp = as_utc_datetime(value)
    if not timestamp:
        raise ValueError("business_timestamp_missing")
    return (timestamp + timedelta(hours=5, minutes=30)).date().isoformat()


def event_values(event, record):
    fulfillment = record.get("fulfillment") or {}
    status = fulfillment.get("status") or record.get("fulfillmentStatus") or record.get("status")
    payment = record.get("payment") or {}
    paid = record.get("paymentStatus") or payment.get("status")
    number = str(record.get("orderNumber") or "").strip()
    name = str(record.get("customerName") or "").strip()
    values = {"customer_name": name, "order_number": number}
    from .manual_payments import is_manual, payment_summary, MANUAL_PAYMENT_EVENTS
    from .whatsapp_catalogue import STATUS_UPDATE_EVENTS
    if event == "order_placed":
        if record.get("paymentGateway") != "manual" or not record.get("createdAt") or status != "order_placed" or payment_summary(record)["status"] != "pending":
            raise ValueError("manual_order_not_placed")
        values["order_total"] = money(record.get("total"), "").strip()
        items = record.get("items") if isinstance(record.get("items"), list) else []
        summaries = []
        for item in items:
            if not isinstance(item, dict):
                continue
            label = str(item.get("name") or item.get("productCode") or "Item").strip()[:120]
            quantity = int(item.get("quantity") or 1)
            summaries.append(f"{label} x {quantity}")
        values["items_summary"] = (", ".join(summaries) or "your selected pieces")[:500]
    elif event in {"order_accepted", "order_rejected", "processing", "packed"} | MANUAL_PAYMENT_EVENTS:
        summary = payment_summary(record)
        if event in MANUAL_PAYMENT_EVENTS:
            transaction = record.get("whatsappPayment") or {}
            if (not is_manual(record) or not transaction or transaction not in record.get("paymentTransactions", []) or transaction.get("event") != event
                    or any(t.get("reverses") == transaction.get("id") for t in record.get("paymentTransactions", []))):
                raise ValueError("payment_transaction_not_recorded")
            # Recompute this receipt's cumulative position from the immutable
            # ledger, never caller values or cached client-calculated balances.
            receipt_index = next(index for index, entry in enumerate(record["paymentTransactions"]) if entry.get("id") == transaction["id"])
            summary = payment_summary({**record, "paymentTransactions": record["paymentTransactions"][:receipt_index + 1]})
            if (int(transaction.get("amountPaise", 0)) <= 0 or not 0 < summary["received"] <= summary["total"]
                    or (event == "payment_received") != (summary["balanceDue"] == 0)):
                raise ValueError("payment_event_ledger_mismatch")
        else:
            expected = {"order_accepted": "confirmed", "order_rejected": "cancelled"}.get(event, event)
            if status != expected:
                raise ValueError("order_state_not_recorded")
            if event == "order_accepted" and (record.get("availabilityDecision") or {}).get("status") != "accepted":
                raise ValueError("acceptance_not_recorded")
            if event == "order_rejected" and (record.get("availabilityDecision") or {}).get("status") != "rejected":
                raise ValueError("rejection_not_recorded")

    elif event == "order_confirmation":
        if (paid != "paid" or not (record.get("paymentVerifiedAt") or payment.get("verifiedAt"))
                or not (record.get("razorpayPaymentId") or payment.get("razorpayPaymentId"))
                or status not in {"confirmed", "processing", "packed", "shipped", "out_for_delivery", "delivered"}):
            raise ValueError("order_not_confirmed")
        values["order_total"] = money(record.get("total"), record.get("currency", "INR"))
        values["order_date"] = business_date(record.get("createdAt"))
    elif event == "payment_confirmation":
        reference = record.get("razorpayPaymentId") or payment.get("razorpayPaymentId")
        if paid not in {"paid", "refunded"} or not reference or not (record.get("paymentVerifiedAt") or payment.get("verifiedAt")):
            raise ValueError("payment_not_captured")
        values.update(paid_amount=money(record.get("total"), record.get("currency", "INR")), payment_reference=reference)
    elif event in {"shipped", "tracking_update", "out_for_delivery"}:
        if status not in {"shipped", "out_for_delivery", "delivered"} or not fulfillment.get("shippedAt") or not fulfillment.get("courier") or not fulfillment.get("trackingNumber"):
            raise ValueError("shipment_not_recorded")
        if event == "out_for_delivery" and status != "out_for_delivery":
            raise ValueError("delivery_state_not_recorded")
        values.update(courier_name=fulfillment["courier"], tracking_id=fulfillment["trackingNumber"])
    elif event in {"delivered", "cancelled"}:
        if status != event or (event == "delivered" and not fulfillment.get("deliveredAt")):
            raise ValueError("delivery_state_not_recorded")
        if event == "delivered":
            values["delivered_on"] = business_date(fulfillment["deliveredAt"])
        else:
            reference = next((item.get("id") for item in reversed(record.get("timeline", [])) if item.get("status") == "cancelled" and item.get("id")), None)
            if not reference:
                raise ValueError("cancellation_reference_missing")
            values["cancellation_reference"] = str(reference)
    elif event == "refund_completed":
        refund = record.get("whatsappRefund") or {}
        from .refund_evidence import verified_refunds
        if refund not in verified_refunds(record):
            raise ValueError("refund_not_processed")
        values.update(refund_amount=money(Decimal(str(refund["amountPaise"])) / 100, refund["currency"]), refund_reference=refund["id"])
    if event in STATUS_UPDATE_EVENTS and record.get("total") is not None:
        if event not in MANUAL_PAYMENT_EVENTS:
            summary = payment_summary(record)
        messages = {
            "order_accepted": "Your order has been accepted by our team.",
            "order_rejected": "Our team is unable to accept your order. Please contact us for assistance.",
            "processing": "Your order is being prepared by our team.",
            "packed": "Your order has been packed and is ready for dispatch.",
            "shipped": "Your order has shipped.",
            "out_for_delivery": "Your order is out for delivery.",
            "delivered": "Your order has been delivered.",
            "advance_payment_received": "Your advance payment has been received.",
            "part_payment_received": "Your part payment has been received.",
            "payment_received": "Your remaining payment has been received. Your order is paid in full.",
            "cancelled": "Your order has been cancelled.",
            "refund_completed": "Your refund has been processed.",
        }
        message = messages[event]
        if event in {"shipped", "out_for_delivery", "delivered"} and fulfillment.get("shippedAt") and fulfillment.get("courier") and fulfillment.get("trackingNumber"):
            message += " Courier: " + str(fulfillment["courier"])[:100] + ". Tracking: " + str(fulfillment["trackingNumber"])[:120] + "."
        if event in MANUAL_PAYMENT_EVENTS:
            message += " Payment received: INR " + money(Decimal(transaction["amountPaise"]) / 100, "").strip() + "."
        if event == "refund_completed":
            message += " " + values["refund_amount"] + ". Reference: " + str(refund["id"])[:120] + "."
        values.update(update_message=message, payment_status=summary["status"].title(),
                      order_total=money(record.get("total"), "").strip(),
                      amount_received=money(summary["received"], "").strip(), balance_due=money(summary["balanceDue"], "").strip())
    return values


def template_event_values(event, record, template):
    """Keep event authority shared; adapt only the exact reviewed text contract."""
    values = event_values(event, record)
    if template.get("catalogue") in {"order_received", "order_and_payment_update"} and record.get("currency", "INR") != "INR":
        raise ValueError("template_requires_inr_order")
    if template.get("catalogue") == "order_and_payment_update":
        # Meta's approved body owns the period immediately after {{3}}.
        values["update_message"] = values["update_message"].removesuffix(".")
    return values
