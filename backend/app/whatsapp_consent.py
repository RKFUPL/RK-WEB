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
              "timestamp": timestamp, "updatedAt": timestamp, "source": source, "version": "authentication-v1" if category == "authentication" else "transactional-v4",
              "orderId": str(order_id) if order_id else None, "recipientHash": fingerprint(phone, config)}
    if category == "transactional":
        from .whatsapp_catalogue import CONSENT_TEXT
        record["text"] = CONSENT_TEXT
    elif category == 'authentication':
        from .communication_preferences import AUTH_TEXT, OTP_REQUEST_TEXT
        requested_code = source.startswith('explicit_') or source == 'verified_signup'
        record['text'] = OTP_REQUEST_TEXT if requested_code else AUTH_TEXT
        record['version'] = 'authentication-request-v1' if requested_code else 'authentication-v1'
    consent_id = db.whatsapp_consents.insert_one(dict(record)).inserted_id
    if update_user and customer_id:
        identity = ObjectId(str(customer_id))
        db.users.update_one({"_id": identity}, {"$set": {"whatsappNotifications": enabled is True, "whatsappConsent": {**record, 'consentId': str(consent_id)}, "whatsappPhone": phone}})
    if enabled and category == "transactional":
        db.whatsapp_optouts.update_one({"_id": record["recipientHash"]}, {"$set": {"active": False, "reconsentedAt": timestamp}}, upsert=True)
    elif update_user and category == "transactional":
        fields = {'active': True, 'withdrawnAt': timestamp, 'source': source, 'category': 'transactional'}
        if source in {'authenticated_profile', 'phone_changed'}:
            # Never downgrade a concurrently received broad STOP to a narrower block.
            result = db.whatsapp_optouts.update_one({'_id': record['recipientHash'], '$or': [
                {'active': {'$ne': True}}, {'category': 'transactional', 'source': {'$in': ['authenticated_profile', 'phone_changed']}},
            ]}, {'$set': fields})
            if not result.matched_count and not db.whatsapp_optouts.find_one({'_id': record['recipientHash']}):
                from pymongo.errors import DuplicateKeyError
                try:
                    db.whatsapp_optouts.insert_one({'_id': record['recipientHash'], **fields})
                except DuplicateKeyError:
                    pass  # A concurrent STOP owns the existing block.
        else:
            db.whatsapp_optouts.update_one({'_id': record['recipientHash']}, {'$set': {**fields, 'category': 'all'}}, upsert=True)
    return {**record, "consentId": str(consent_id)}


def opted_out(db, config, phone, *, category='transactional'):
    from .whatsapp import fingerprint
    record = db.whatsapp_optouts.find_one({'_id': fingerprint(phone, config)}) or {}
    # Unknown/legacy scope and signed STOP stay broad. Only an explicit new
    # transactional-only withdrawal can leave independent OTP requests eligible.
    return record.get('active') is True and not (category == 'authentication' and record.get('category') == 'transactional' and record.get('source') in {'authenticated_profile', 'phone_changed'})


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
    db.whatsapp_optouts.update_one({"_id": key}, {"$set": {"active": True, "withdrawnAt": timestamp, "source": "signed_inbound_stop", 'category': 'all'}}, upsert=True)
    for user in db.users.find({"$or": [{"phone": {"$in": [phone, phone[1:]]}}, {'whatsappPhone': phone}, {"whatsappConsent.recipientHash": key}, {'whatsappOtpConsentRecord.recipientHash': key}]}):
        record = {"customerId": str(user["_id"]), "phone": phone, "category": "transactional",
                  "enabled": False, "status": "withdrawn", "timestamp": timestamp, "updatedAt": now(),
                  "source": "signed_inbound_stop", "recipientHash": key, "orderId": None}
        from .whatsapp_catalogue import CONSENT_TEXT
        record.update(version='transactional-v4', text=CONSENT_TEXT)
        audit_key = f"inbound:{key}:{timestamp.isoformat()}:{user['_id']}"
        db.whatsapp_consents.update_one({"_id": audit_key}, {"$setOnInsert": record}, upsert=True)
        db.users.update_one({"_id": user["_id"]}, {"$set": {"whatsappNotifications": False, "whatsappConsent": record}})
        from .communication_preferences import AUTH_TEXT
        auth_id = audit_key + ':authentication'
        auth_record = {**record, 'category': 'authentication', 'version': 'authentication-v1', 'text': AUTH_TEXT}
        db.whatsapp_consents.update_one({'_id': auth_id}, {'$setOnInsert': auth_record}, upsert=True)
        db.users.update_one({'_id': user['_id']}, {'$set': {'whatsappOtpConsentRecord': {**auth_record, 'consentId': auth_id}}})


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


def order_consent_status(db, config, user, order):
    """Expose only this customer's order recipient and current consent state."""
    from .whatsapp import normalize_phone

    candidate = order.get("whatsappRecipient") or user.get("whatsappPhone") or user.get("phone")
    try:
        number = normalize_phone(candidate)
    except ValueError:
        number = None
    try:
        active = consent_phone(db, config, user, order)
    except ValueError:
        active = None
    return {"number": number, "enabled": active is not None}
