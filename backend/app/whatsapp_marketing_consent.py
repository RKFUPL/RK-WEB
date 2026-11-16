"""Category-specific marketing grants and suppression, separate from order consent."""
from bson import ObjectId
from .time_utils import as_utc_datetime
from .whatsapp_definitions import MARKETING_POLICY_VERSION


def record_marketing_consent(db, config, customer_id, phone, enabled, source, *, update_user=True, timestamp=None, audit_key=None):
    from .whatsapp import normalize_phone, fingerprint, now
    try:
        phone = normalize_phone(phone)
    except ValueError:
        if enabled:
            raise
        phone = str(phone or "")[:40]
    timestamp = timestamp or now()
    timestamp = timestamp.replace(microsecond=timestamp.microsecond // 1000 * 1000)
    key = fingerprint(phone, config)
    record = {"customerId": str(customer_id) if customer_id else None, "phone": phone, "recipientHash": key,
              "category": "marketing", "enabled": enabled is True, "status": "granted" if enabled else "withdrawn",
              "timestamp": timestamp, "source": source, "policyVersion": MARKETING_POLICY_VERSION,
              "withdrawnAt": None if enabled else timestamp}
    if audit_key:
        db.whatsapp_consents.update_one({"_id": audit_key}, {"$setOnInsert": record}, upsert=True)
    else:
        db.whatsapp_consents.insert_one(dict(record))
    if update_user and customer_id:
        db.users.update_one({"_id": ObjectId(str(customer_id))}, {"$set": {"whatsappMarketingNotifications": enabled is True, "whatsappMarketingConsent": record}})
    if enabled:
        db.whatsapp_marketing_suppressions.update_one({"_id": key}, {"$set": {"active": False, "reconsentedAt": timestamp}}, upsert=True)
    elif update_user:
        db.whatsapp_marketing_suppressions.update_one({"_id": key}, {"$set": {"active": True, "withdrawnAt": timestamp, "source": source}}, upsert=True)
    return record


def marketing_suppressed(db, config, phone):
    from .whatsapp import fingerprint
    key = fingerprint(phone, config)
    category = db.whatsapp_marketing_suppressions.find_one({"_id": key}) or {}
    if category.get("active") is True:
        return True
    global_stop = db.whatsapp_optouts.find_one({"_id": key}) or {}
    if global_stop.get("active") is True and global_stop.get("source") == "signed_inbound_stop":
        grant = as_utc_datetime(category.get("reconsentedAt"))
        withdrawal = as_utc_datetime(global_stop.get("withdrawnAt"))
        return not grant or not withdrawal or grant <= withdrawal
    return False


def marketing_phone(db, config, user):
    from .whatsapp import normalize_phone
    consent = (user or {}).get("whatsappMarketingConsent") or {}
    if (not user or user.get("role", "customer") != "customer" or user.get("isActive", True) is False
            or user.get("whatsappMarketingNotifications") is not True or consent.get("enabled") is not True
            or consent.get("category") != "marketing" or consent.get("customerId") != str(user.get("_id"))
            or consent.get("policyVersion") != MARKETING_POLICY_VERSION or not consent.get("source")
            or not as_utc_datetime(consent.get("timestamp"))):
        return None
    try:
        phone = normalize_phone(consent.get("phone"))
        if consent["source"] == "authenticated_profile" and phone != normalize_phone(user.get("whatsappPhone", user.get("phone"))):
            return None
        return None if marketing_suppressed(db, config, phone) else phone
    except ValueError:
        return None


def withdraw_marketing_from_inbound(db, config, phone, timestamp):
    from .whatsapp import fingerprint
    key = fingerprint(phone, config)
    previous = db.whatsapp_marketing_suppressions.find_one({"_id": key}) or {}
    grant = as_utc_datetime(previous.get("reconsentedAt"))
    if grant and timestamp <= grant:
        return
    db.whatsapp_marketing_suppressions.update_one({"_id": key}, {"$set": {"active": True, "withdrawnAt": timestamp, "source": "signed_marketing_unsubscribe"}}, upsert=True)
    for user in db.users.find({"$or": [{"whatsappMarketingConsent.recipientHash": key}, {"phone": {"$in": [phone, phone[1:]]}}]}):
        record_marketing_consent(db, config, user["_id"], phone, False, "signed_marketing_unsubscribe", timestamp=timestamp,
                                 audit_key=f"marketing-stop:{key}:{timestamp.isoformat()}:{user['_id']}")
