"""Order-bound orchestration and safe activity; uses the existing transport/outbox."""
import hashlib
import json

from bson import ObjectId
from flask import current_app, has_app_context

from .whatsapp_catalogue import EVENT_CATALOGUE
from .whatsapp_consent import consent_phone
from .whatsapp_events import event_values
from .whatsapp_templates import template_registry, order_template_block_reason

ORDER_NOTIFICATIONS = {"order_placed", "order_accepted", "order_rejected", "processing", "packed", "advance_payment_received", "part_payment_received", "payment_received", "order_confirmation", "payment_confirmation", "shipped", "out_for_delivery", "delivered", "cancelled", "refund_completed"}
# Restricted order-only mode deliberately sends a single initial confirmation;
# payment_confirmation is reserved for the separately enabled broad flow.
ORDER_ONLY_EVENTS = ORDER_NOTIFICATIONS - {"payment_confirmation"}


def order_contact(db, config, order, user):
    from .whatsapp import normalize_phone, fingerprint
    if "whatsappRecipient" in order:
        try:
            return {"phone": normalize_phone(order["whatsappRecipient"]), "source": order.get("whatsappRecipientSource", "order_snapshot"), "reason": None}
        except ValueError:
            return {"phone": None, "source": order.get("whatsappRecipientSource"), "reason": "invalid_recipient"}
    candidates = [("shipping.phone", (order.get("shipping") or {}).get("phone")),
                  ("shippingAddress.phone", (order.get("shippingAddress") or {}).get("phone")),
                  ("phone", order.get("phone")), ("order_consent.phone", (order.get("whatsappConsent") or {}).get("phone"))]
    for source, value in candidates:
        if str(value or "").strip():
            try:
                return {"phone": normalize_phone(value), "source": source, "reason": None}
            except ValueError:
                return {"phone": None, "source": source, "reason": "invalid_recipient"}
    # There is no separate verified-contact table. A fallback therefore needs
    # both the existing explicit profile consent binding and signed inbound
    # evidence for that exact current account/phone scope. It is never needed
    # for an order snapshot recipient or to open a template service window.
    try:
        phone = normalize_phone((user or {}).get("phone"))
        if consent_phone(db, config, user, {}) == phone and db.whatsapp_inbox.find_one({
            "recipientHash": fingerprint(phone, config), "verified": True,
            "phoneNumberId": str(config.get("WHATSAPP_PHONE_NUMBER_ID")),
            "businessAccountId": str(config.get("WHATSAPP_BUSINESS_ACCOUNT_ID")),
        }):
            return {"phone": phone, "source": "verified_profile_contact", "reason": None}
    except (ValueError, KeyError):
        pass
    return {"phone": None, "source": None, "reason": "missing_phone"}


def order_recipient(db, config, order, user):
    contact = order_contact(db, config, order, user)
    if contact["reason"]:
        return contact
    # Order-only automation requires the checkout snapshot's explicit grant.
    # A missing/declined order grant must never inherit profile consent.
    if config.get("WHATSAPP_ORDER_NOTIFICATIONS_ENABLED") is True and not order.get("whatsappConsent"):
        return {**contact, "reason": "missing_or_withdrawn_consent"}
    try:
        consented = consent_phone(db, config, user, order)
    except ValueError:
        consented = None
    if consented != contact["phone"]:
        return {**contact, "reason": "missing_or_withdrawn_consent"}
    return contact


def business_event_key(order, event):
    fulfillment = order.get("fulfillment") or {}
    shipment = [str(fulfillment.get("courier") or "").strip().casefold(), str(fulfillment.get("trackingNumber") or "").strip()]
    shipment_id = hashlib.sha256(json.dumps(shipment, separators=(",", ":")).encode()).hexdigest()
    reference = ""
    if event in {"advance_payment_received", "part_payment_received", "payment_received"}:
        reference = str((order.get("whatsappPayment") or {}).get("id") or "missing_transaction")
    elif event == "payment_confirmation":
        reference = str(order.get("razorpayPaymentId") or (order.get("payment") or {}).get("razorpayPaymentId") or "missing_payment")
    elif event in {"shipped", "out_for_delivery", "delivered"}:
        reference = shipment_id
    elif event == "refund_completed":
        reference = str((order.get("whatsappRefund") or {}).get("id") or "missing_refund")
    return f"{order['_id']}:{event}:{reference}"


def notify_order_whatsapp(db, order_id, event, event_data=None):
    """Reload committed state, authorize its recipient and enqueue once per event."""
    if not has_app_context():
        return {"status": "skipped", "reason": "no_application_context"}
    from .whatsapp import _enqueue_notification, now, fingerprint, automation_enabled
    try:
        if event not in ORDER_NOTIFICATIONS or not ObjectId.is_valid(str(order_id)):
            return {"status": "skipped", "reason": "invalid_order_event"}
        order = db.orders.find_one({"_id": ObjectId(str(order_id))})
        if not order:
            return {"status": "skipped", "reason": "order_not_found"}
        from .inventory_operations import persisted_inventory_block_reason
        if event in {"order_confirmation", "order_accepted", "processing", "packed", "shipped", "out_for_delivery", "delivered"} and persisted_inventory_block_reason(db, order):
            blocked_key = business_event_key(order, event)
            blocked_id = hashlib.sha256(blocked_key.encode()).hexdigest()
            db.whatsapp_order_events.update_one({"_id": blocked_id}, {
                "$set": {"orderId": str(order["_id"]), "event": event, "status": "skipped",
                         "reason": "inventory_reconciliation_required", "updatedAt": now()},
                "$setOnInsert": {"createdAt": now()},
                "$push": {"history": {"status": "skipped", "reason": "inventory_reconciliation_required", "timestamp": now()}},
            }, upsert=True)
            return {"status": "skipped", "reason": "inventory_reconciliation_required"}
        if event in {"advance_payment_received", "part_payment_received", "payment_received"}:
            transaction_id = (event_data or {}).get("transactionId")
            order["whatsappPayment"] = next((t for t in order.get("paymentTransactions", []) if t.get("id") == transaction_id), {})
        if event == "refund_completed":
            refund_id = (event_data or {}).get("refundId")
            order["whatsappRefund"] = next((item for item in order.get("refunds", []) if item.get("id") == refund_id), {})
        key = business_event_key(order, event)
        audit_id = hashlib.sha256(key.encode()).hexdigest()
        previous = db.whatsapp_order_events.find_one({"_id": audit_id}) or {}
        if previous.get("queueId"):
            return {"status": "duplicate", "correlationId": previous["queueId"]}
        config = current_app.config
        identity = order.get("customerId")
        user = db.users.find_one({"_id": ObjectId(str(identity))}) if ObjectId.is_valid(str(identity)) else None
        recipient = order_recipient(db, config, order, user)
        result = {"status": "skipped", "reason": "staff_notifications_disabled"} if (event_data or {}).get("suppressed") else ({"status": "skipped", "reason": recipient["reason"]} if recipient["reason"] else None)
        from .communication_preferences import channel_enabled
        if not channel_enabled(db, 'transactional', 'whatsapp'):
            result = {'status': 'skipped', 'reason': 'admin_channel_disabled'}
        if not result:
            try:
                event_values(event, order)
            except (ValueError, KeyError):
                result = {"status": "skipped", "reason": "shipment_not_recorded" if event == "shipped" else "business_event_not_confirmed"}
        template = template_registry(db, config).get(event, {})
        template_reason = order_template_block_reason(event, template)
        if not result and (event not in template.get("definitionEvents", []) or template.get("category") != "UTILITY" or not template.get("requiresMetaApproval")
                           or not template.get("enabled") or not template.get("approved")):
            result = {"status": "skipped", "reason": template_reason if event == "order_placed" else "template_not_approved_or_enabled"}
        if not result:
            if automation_enabled(db, config, event):
                recipient_hash = fingerprint(recipient["phone"], config)
                db.whatsapp_order_events.update_one({"_id": audit_id}, {"$setOnInsert": {"createdAt": now()}}, upsert=True)
                db.whatsapp_order_events.update_one({"_id": audit_id, "recipientHash": {"$exists": False}}, {"$set": {"recipientHash": recipient_hash}})
                pinned = db.whatsapp_order_events.find_one({"_id": audit_id}) or {}
                if pinned.get("recipientHash") != recipient_hash:
                    db.whatsapp_order_events.update_one({"_id": audit_id}, {"$set": {"lastSkippedReason": "order_contact_changed", "lastSkippedAt": now()}})
                    return {"status": "skipped", "reason": "order_contact_changed"}
            result = _enqueue_notification(db, event, order, key=key, user=user, business_event_key=key)
            if result.get("reason") == "disabled":
                result["reason"] = "automation_disabled"
        reason = result.get("reason")
        state = "waiting_for_approved_template" if reason == "template_not_approved_or_enabled" or (template_reason and reason == template_reason) else "not_eligible" if reason in {"missing_phone", "invalid_recipient", "missing_or_withdrawn_consent"} else result["status"]
        values = {"orderId": str(order["_id"]), "event": event, "template": template.get("name"), "status": state, "reason": reason,
                  "reference": (event_data or {}).get("refundId") or (event_data or {}).get("transactionId"),
                  "reasonDetail": template_reason if reason == "template_not_approved_or_enabled" else reason,
                  "contactSource": recipient["source"], "updatedAt": now()}
        if result.get("correlationId") and result["status"] in {"queued", "duplicate"}:
            values["queueId"] = result["correlationId"]
        outcome = "skipped" if result["status"] == "skipped" else result["status"]
        db.whatsapp_order_events.update_one({"_id": audit_id}, {"$set": values, "$setOnInsert": {"createdAt": now()},
            "$push": {"history": {"$each": [{"status": "requested", "timestamp": now()},
                {"status": outcome, "reason": values["reasonDetail"], "timestamp": now()}]}}}, upsert=True)
        if result["status"] not in {"queued", "duplicate"}:
            db.whatsapp_messages.update_one({"_id": "order-attempt:" + audit_id}, {"$set": {
                "orderId": str(order["_id"]), "orderNumber": order.get("orderNumber"), "customerId": str(order.get("customerId") or ""),
                "recipient": "***" + recipient["phone"][-4:] if recipient["phone"] else "Unavailable",
                "recipientSource": recipient["source"], "type": event, "template": template.get("name"),
                "status": "skipped", "error": {"kind": reason or "notification_unavailable"}, "updatedAt": now(), "testSend": False,
            }, "$setOnInsert": {"createdAt": now(), "attempts": 0}}, upsert=True)
        return result
    except Exception:
        try:
            if 'audit_id' in locals():
                db.whatsapp_order_events.update_one({"_id": audit_id}, {"$set": {"orderId": str(order_id), "event": event, "status": "failed", "reason": "notification_unavailable", "updatedAt": now()}, "$setOnInsert": {"createdAt": now()}}, upsert=True)
        except Exception:
            pass
        current_app.logger.warning("WhatsApp order notification unavailable")
        return {"status": "unavailable", "reason": "notification_unavailable"}


def order_whatsapp_activity(db, config, order):
    """Safe staff-only view. Never decrypt queued phones or template parameters."""
    from .whatsapp import automation_enabled, now
    from .time_utils import as_utc_datetime
    try:
        identity = order.get("customerId")
        user = db.users.find_one({"_id": ObjectId(str(identity))}) if ObjectId.is_valid(str(identity)) else None
        contact = order_recipient(db, config, order, user)
        templates = template_registry(db, config)
        activity = []
        for audit in db.whatsapp_order_events.find({"orderId": str(order["_id"])}).sort("updatedAt", -1).limit(50):
            row = {key: audit.get(key) for key in ("event", "template", "status", "reason", "reasonDetail", "createdAt", "updatedAt", "history", "reference")}
            attempted = db.whatsapp_messages.find_one({"_id": "order-attempt:" + str(audit["_id"])}, {"template": 1}) or {}
            row["template"] = attempted.get("template") or row.get("template")
            queue_id = audit.get("queueId")
            if queue_id:
                queue = db.whatsapp_outbox.find_one({"_id": queue_id}) or {}
                message = db.whatsapp_messages.find_one({"_id": queue_id}) or {}
                row["template"] = message.get("template") or row.get("template")
                row["status"] = message.get("status") or {"pending": "queued", "processing": "sending", "invalid_payload": "skipped", "held": "unknown"}.get(queue.get("status"), queue.get("status", row["status"]))
                if queue.get("status") == "pending":
                    row["status"] = "queued"
                row.update({key: message.get(key) for key in ("acceptedAt", "sentAt", "deliveredAt", "readAt", "failedAt", "providerId")})
                row["reason"] = queue.get("reason") or row["reason"]
                error = message.get("error") or queue.get("error") or {}
                if isinstance(error.get("errors"), list) and error["errors"]:
                    error = {**error, **error["errors"][0]}
                row["error"] = {key: error[key] for key in ("kind", "code", "subcode") if key in error}
                row["nextAttemptAt"] = queue.get("nextAttemptAt")
                expiry = as_utc_datetime(queue.get("expiresAt"))
                if not message and (not queue or queue.get("status") == "pending" and expiry and expiry <= now()):
                    row.update(status="skipped", reason="queue_expired_or_unavailable")
            activity.append(row)
        return {"number": "***" + contact["phone"][-4:] if contact["phone"] else None, "contactSource": contact["source"], "consent": "granted" if not contact["reason"] else "missing_or_withdrawn",
                "eligibilityReason": contact["reason"], "automationEnabled": automation_enabled(db, config, "order_confirmation"), "activity": activity,
                "templates": [{"event": event, "name": templates[event]["name"], "approved": templates[event]["approved"], "enabled": templates[event]["enabled"],
                               "status": templates[event].get("observedStatus", templates[event]["approvalStatus"])} for event in sorted(ORDER_NOTIFICATIONS)]}
    except Exception:
        return {"number": None, "consent": "unknown", "eligibilityReason": "notification_activity_unavailable", "automationEnabled": False, "activity": [], "templates": []}
