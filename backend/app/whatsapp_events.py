"""Read existing persisted business results; never perform business transitions."""
from decimal import Decimal, InvalidOperation
from datetime import timedelta
from .time_utils import as_utc_datetime

ORDER_EVENTS = {"order_confirmation", "payment_confirmation", "shipped", "tracking_update", "out_for_delivery", "delivered", "cancelled", "refund_completed"}


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
    if event == "order_confirmation":
        if paid != "paid" or status not in {"confirmed", "processing", "packed", "shipped", "out_for_delivery", "delivered"}:
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
        if refund.get("status") != "processed" or refund.get("source") != "razorpay_signed_webhook" or not refund.get("id"):
            raise ValueError("refund_not_processed")
        values.update(refund_amount=money(Decimal(str(refund["amountPaise"])) / 100, refund["currency"]), refund_reference=refund["id"])
    return values
