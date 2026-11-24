"""Staff-only channel outcomes. No recipients, message bodies or provider errors."""
import hashlib
from datetime import datetime, timezone, timedelta
from contextlib import contextmanager
from threading import Event, Thread
from uuid import uuid4

SAFE_EMAIL_FAILURES = {"smtp_authentication_failed", "smtp_sender_rejected", "smtp_recipient_rejected", "smtp_data_rejected", "smtp_connection_failed"}
EMAIL_LEASE = timedelta(minutes=10)


def notification_key(event, key=None):
    event = {"confirmed": "order_accepted", "returned": "return_status"}.get(event, event)
    if event in {"order_accepted", "order_rejected"}:
        return "fulfillment:" + event
    return key or "fulfillment:" + event


def email_aliases(event, key):
    if event == "order_accepted":
        return [key, "fulfillment:confirmed"]
    if event in {"order_rejected", "cancelled"}:
        # These can describe the same terminal transition. Share email fences
        # in both directions, including accepted, held and in-flight claims.
        return list(dict.fromkeys([key, "fulfillment:order_rejected", "fulfillment:cancelled"]))
    return [key]


def activity_id(order_id, channel, key):
    return hashlib.sha256(f"{order_id}:{channel}:{key}".encode()).hexdigest()


def expire_stale_email_claims(db, order_id, at=None):
    """Only an expired, unrenewed generation can become held. Never release it."""
    at = at or datetime.now(timezone.utc)
    query = {"orderId": str(order_id), "channel": "email", "status": "sending",
             "leaseUntil": {"$lte": at}, "heartbeatAt": {"$lte": at - EMAIL_LEASE}}
    for row in db.order_notification_activity.find(query):
        changed = db.order_notification_activity.update_one({**query, "_id": row["_id"], "claimToken": row.get("claimToken"),
                "heartbeatAt": row["heartbeatAt"], "leaseUntil": row["leaseUntil"]}, {"$set": {
                    "status": "held", "reason": "smtp_submission_unknown", "updatedAt": at},
                    "$push": {"history": {"status": "held", "reason": "smtp_submission_unknown", "timestamp": at}}})
        if changed.modified_count and row.get("notificationKey") == "order_confirmation":
            db.orders.update_one({"_id": order_id, "confirmationEmail.claimToken": row.get("claimToken"), "confirmationEmail.status": "sending"},
                {"$set": {"confirmationEmail.status": "held", "confirmationEmail.error": "smtp_submission_unknown"}})


def claim_email(db, order_id, event, key, *, snapshot=None):
    """One order-level atomic fence covers canonical and pre-existing alias keys."""
    from .communication_preferences import channel_enabled
    if not channel_enabled(db, 'transactional', 'email'):
        record_channel(db, order_id, event, 'email', 'skipped', 'admin_channel_disabled', key='routing:' + notification_key(event, key))
        return None
    key = notification_key(event, key)
    expire_stale_email_claims(db, order_id)
    identity = activity_id(order_id, "email", key)
    previous = db.order_notification_activity.find_one({"_id": identity})
    if previous and not (previous.get("status") == "failed" and previous.get("reason") in SAFE_EMAIL_FAILURES
                         or previous.get("status") == "skipped"):
        return None
    aliases = email_aliases(event, key)
    token = uuid4().hex
    at = datetime.now(timezone.utc)
    query = {"_id": order_id, "notificationKeys": {"$nin": aliases}}
    if snapshot is not None:
        for field in ("fulfillment", "payment", "paymentStatus", "refunds", "captureFulfillmentStatus",
                      "captureClaimToken", "inventoryReservation", "inventoryReservationClaimToken", "items"):
            query[field] = snapshot.get(field, {"$exists": False})
    values = {f"emailClaimTokens.{identity}": token}
    if key == "order_confirmation":
        query["confirmationEmail.status"] = {"$nin": ["sent", "accepted", "sending", "held", "unknown"]}
        values.update({"confirmationEmail.status": "sending", "confirmationEmail.claimToken": token,
                       "confirmationEmail.lastAttemptAt": at, "confirmationEmail.error": None})
    update = {"$set": values, "$addToSet": {"notificationKeys": {"$each": aliases}}}
    if key == "order_confirmation":
        update["$inc"] = {"confirmationEmail.attempts": 1}
    if db.orders.update_one(query, update).modified_count != 1:
        return None
    db.order_notification_activity.update_one({"_id": identity}, {"$set": {
        "orderId": str(order_id), "event": event, "channel": "email", "notificationKey": key,
        "claimToken": token, "status": "sending", "reason": None, "updatedAt": at,
        "heartbeatAt": at, "leaseUntil": at + EMAIL_LEASE}, "$setOnInsert": {"createdAt": at},
        "$inc": {"attempts": 1}, "$push": {"history": {"$each": [
            {"status": "requested", "timestamp": at}, {"status": "sending", "timestamp": at}]}}}, upsert=True)
    return token


@contextmanager
def email_heartbeat(db, order_id, event, key, token):
    """Renew independently of a slow SMTP call; a dead process cannot renew."""
    identity = activity_id(order_id, "email", notification_key(event, key))
    stop = Event()
    def renew():
        while not stop.wait(30):
            at = datetime.now(timezone.utc)
            try:
                changed = db.order_notification_activity.update_one({"_id": identity, "claimToken": token, "status": "sending"},
                    {"$set": {"heartbeatAt": at, "leaseUntil": at + EMAIL_LEASE}})
                if changed.modified_count != 1:
                    return
            except Exception:
                return  # Fail closed: expiry holds the claim and never requeues it.
    thread = Thread(target=renew, daemon=True)
    thread.start()
    try:
        active = db.order_notification_activity.find_one({"_id": identity, "claimToken": token, "status": "sending", "leaseUntil": {"$gt": datetime.now(timezone.utc)}})
        if not active:
            from .mail import EmailDeliveryUnknown
            raise EmailDeliveryUnknown("SMTP claim requires reconciliation")
        yield
    finally:
        stop.set()
        thread.join(timeout=1)


def finish_email(db, order_id, event, key, token, state, reason=None, submission=None, provider_id=None):
    key = notification_key(event, key)
    identity = activity_id(order_id, "email", key)
    at = datetime.now(timezone.utc)
    changed = db.order_notification_activity.update_one({"_id": identity, "claimToken": token, "status": "sending"}, {
        "$set": {"status": state, "reason": reason, "updatedAt": at, "submission": submission or {}},
        "$push": {"history": {"status": state, "reason": reason, "timestamp": at}}})
    if changed.modified_count != 1:
        # An expired generation may record its late result, but cannot unlock/reuse a claim.
        db.order_notification_activity.update_one({"_id": identity, "claimToken": token}, {"$push": {
            "history": {"status": "late_provider_result", "outcome": state, "timestamp": at}}})
        return
    log_state = "sent" if state == "accepted" else state
    update = {"$push": {"notificationLog": {"key": key, "status": log_state, "reason": reason, "timestamp": at,
                                            "submission": submission or {}}}}
    if state == "failed" and reason in SAFE_EMAIL_FAILURES:
        update["$pull"] = {"notificationKeys": {"$in": email_aliases(event, key)}}
    if key == "order_confirmation":
        update["$set"] = {"confirmationEmail.status": log_state, "confirmationEmail.error": reason}
        if state == "accepted":
            update["$set"].update({"confirmationEmail.sentAt": at, "confirmationEmail.providerId": provider_id or ""})
    db.orders.update_one({"_id": order_id, f"emailClaimTokens.{identity}": token}, update)
    db.integrations.update_one({"_id": "zoho_mail"}, {"$set": {"last_submission": {
        "status": state, "reason": reason, "timestamp": at, "transport": "smtp", "submission": submission or {}}}}, upsert=True)


def record_channel(db, order_id, event, channel, status, reason=None, *, key=None):
    identity = hashlib.sha256(f"{order_id}:{channel}:{key or event}".encode()).hexdigest()
    at = datetime.now(timezone.utc)
    db.order_notification_activity.update_one({"_id": identity}, {
        "$set": {"orderId": str(order_id), "event": event, "channel": channel,
                 "notificationKey": key or event,
                 "status": status, "reason": reason, "updatedAt": at},
        "$setOnInsert": {"createdAt": at},
        "$push": {"history": {"status": status, "reason": reason, "timestamp": at}},
    }, upsert=True)
    if channel == "email" and status in {"accepted", "failed"}:
        db.integrations.update_one({"_id": "zoho_mail"}, {"$set": {"last_submission": {
            "status": status, "reason": reason, "timestamp": at, "transport": "smtp"}}}, upsert=True)


def email_failure_reason(error):
    import smtplib
    from .mail import EmailDeliveryUnknown, EmailPartialSubmission
    if isinstance(error, EmailPartialSubmission):
        return "smtp_customer_refused_partial"
    if isinstance(error, EmailDeliveryUnknown):
        return "smtp_submission_unknown"
    cause = error
    for _ in range(4):
        if isinstance(cause, smtplib.SMTPAuthenticationError) or str(cause) == "Zoho Mail SMTP authentication failed":
            return "smtp_authentication_failed"
        if isinstance(cause, smtplib.SMTPSenderRefused):
            return "smtp_sender_rejected"
        if isinstance(cause, smtplib.SMTPRecipientsRefused):
            return "smtp_recipient_rejected"
        known = {"SMTP recipient address rejected": "smtp_recipient_rejected", "SMTP sender address rejected": "smtp_sender_rejected",
                 "SMTP data rejected": "smtp_data_rejected", "Unable to reach the Zoho Mail SMTP server": "smtp_connection_failed"}
        if str(cause) in known:
            return known[str(cause)]
        cause = getattr(cause, "__cause__", None)
        if cause is None:
            break
    return "smtp_submission_unknown"


def staff_channel_activity(db, order, whatsapp):
    expire_stale_email_claims(db, order["_id"])
    fields = ("event", "channel", "status", "reason", "createdAt", "updatedAt", "history", "notificationKey", "submission")
    rows = [{k: item.get(k) for k in fields} for item in db.order_notification_activity.find({"orderId": str(order["_id"])})]
    # WhatsApp's existing audits/queue/provider receipts remain authoritative.
    rows = [r for r in rows if r["channel"] != "whatsapp"]
    for item in whatsapp.get("activity", []):
        state = item.get("status")
        state = {"waiting_for_approved_template": "skipped", "not_eligible": "skipped", "sending": "sending", "unknown": "held"}.get(state, state)
        rows.append({"event": item["event"], "channel": "whatsapp", "status": state,
                     "reference": item.get("reference"),
                     "reason": item.get("reasonDetail") or item.get("reason"),
                     "createdAt": item.get("createdAt"), "updatedAt": item.get("updatedAt"),
                     "history": [*(item.get("history") or []), *[{"status": stage, "timestamp": item[field]} for stage, field in
                         (("accepted", "acceptedAt"), ("sent", "sentAt"), ("delivered", "deliveredAt"), ("failed", "failedAt")) if item.get(field)]]})
    # Read legacy email evidence without inventing delivery receipts.
    current_email_events = {r["event"] for r in rows if r["channel"] == "email"}
    legacy = {}
    for item in order.get("notificationLog", []):
        legacy[item.get("key", "")] = item
    for item in legacy.values():
        key = item.get("key", "")
        event = key.removeprefix("fulfillment:")
        event = {"refunded": "refund_completed", "confirmed": "order_accepted", "order_confirmation": "order_placed" if order.get("paymentGateway") == "manual" else "order_confirmation"}.get(event, event)
        if event in current_email_events:
            continue
        rows.append({"event": event, "channel": "email", "status": "accepted" if item.get("status") == "sent" else item.get("status"),
                     "notificationKey": key,
                     "reason": item.get("reason") or (email_failure_reason(RuntimeError(item.get("error", ""))) if item.get("status") == "failed" else None),
                     "updatedAt": item.get("timestamp")})
    return rows
