"""Explicit consent audit and signed inbound opt-outs; never retain message text."""
from bson import ObjectId
from .time_utils import as_utc_datetime


def record_consent(db, config, customer_id, phone, enabled, source, *, order_id=None, category="transactional", update_user=True):
    from .whatsapp import normalize_phone, fingerprint, now
    try:
        phone = normalize_phone(phone)
    except ValueError:
        if enabled:
            raise
        phone = str(phone or "")[:40]
    timestamp = now()
    # MongoDB persists millisecond precision. Return the same precision so a
    # just-saved withdrawal cannot appear older than an in-memory order grant.
    timestamp = timestamp.replace(microsecond=(timestamp.microsecond // 1000) * 1000)
    record = {"customerId": str(customer_id) if customer_id else None, "phone": phone,
              "category": category, "enabled": enabled is True, "status": "granted" if enabled else "withdrawn",
              "timestamp": timestamp, "updatedAt": timestamp, "source": source, "version": "transactional-v3",
              "orderId": str(order_id) if order_id else None, "recipientHash": fingerprint(phone, config)}
    if category == "transactional":
        from .whatsapp_catalogue import CONSENT_TEXT
        record["text"] = CONSENT_TEXT
    consent_id = db.whatsapp_consents.insert_one(dict(record)).inserted_id
    if update_user and customer_id:
        identity = ObjectId(str(customer_id))
        db.users.update_one({"_id": identity}, {"$set": {"whatsappNotifications": enabled is True, "whatsappConsent": record, "whatsappPhone": phone}})
    if enabled and category == "transactional":
        db.whatsapp_optouts.update_one({"_id": record["recipientHash"]}, {"$set": {"active": False, "reconsentedAt": timestamp}}, upsert=True)
    elif update_user and category == "transactional":
        db.whatsapp_optouts.update_one({"_id": record["recipientHash"]}, {"$set": {"active": True, "withdrawnAt": timestamp, "source": source}}, upsert=True)
    return {**record, "consentId": str(consent_id)}


def opted_out(db, config, phone):
    from .whatsapp import fingerprint
    return (db.whatsapp_optouts.find_one({"_id": fingerprint(phone, config)}) or {}).get("active") is True


def withdraw_from_inbound(db, config, phone, timestamp):
    from .whatsapp import fingerprint, now
    from .whatsapp_marketing_consent import withdraw_marketing_from_inbound
    withdraw_marketing_from_inbound(db, config, phone, timestamp)
    key = fingerprint(phone, config)
    previous = db.whatsapp_optouts.find_one({"_id": key}) or {}
    reconsented = as_utc_datetime(previous.get("reconsentedAt"))
    if reconsented and timestamp <= reconsented:
        return
    # Keep a durable phone-level block even if the sender has no user yet.
    db.whatsapp_optouts.update_one({"_id": key}, {"$set": {"active": True, "withdrawnAt": timestamp, "source": "signed_inbound_stop"}}, upsert=True)
    for user in db.users.find({"$or": [{"phone": {"$in": [phone, phone[1:]]}}, {"whatsappConsent.recipientHash": key}]}):
        record = {"customerId": str(user["_id"]), "phone": phone, "category": "transactional",
                  "enabled": False, "status": "withdrawn", "timestamp": timestamp, "updatedAt": now(),
                  "source": "signed_inbound_stop", "recipientHash": key, "orderId": None}
        audit_key = f"inbound:{key}:{timestamp.isoformat()}:{user['_id']}"
        db.whatsapp_consents.update_one({"_id": audit_key}, {"$setOnInsert": record}, upsert=True)
        db.users.update_one({"_id": user["_id"]}, {"$set": {"whatsappNotifications": False, "whatsappConsent": record}})


def consent_phone(db, config, user, record):
    from .whatsapp import normalize_phone
    if not user or user.get("isActive", True) is False:
        return None
    if "whatsappConsent" not in record and user.get("whatsappNotifications") is not True:
        return None
    consent = record.get("whatsappConsent", user.get("whatsappConsent")) or {}
    withdrawal = user.get("whatsappConsent") or {}
    withdrawn_at = as_utc_datetime(withdrawal.get("timestamp"))
    consent_at = as_utc_datetime(consent.get("timestamp"))
    if record.get("whatsappConsent") and withdrawal.get("enabled") is False and withdrawn_at and (not consent_at or withdrawn_at >= consent_at):
        return None
    if (consent.get("enabled") is not True or consent.get("category") != "transactional"
            or not consent.get("source") or not consent.get("timestamp")
            or consent.get("customerId") != str(user.get("_id"))):
        return None
    phone = normalize_phone(consent.get("phone"))
    # Profile consent is invalid after a phone change. Order consent is tied to
    # the explicitly consented checkout number, not an inferred address number.
    if not record.get("whatsappConsent") and phone != normalize_phone(user.get("whatsappPhone", user.get("phone"))):
        return None
    return None if opted_out(db, config, phone) else phone
