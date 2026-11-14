"""Additive WhatsApp indexes. No record deletion or TTL policy changes."""
from pymongo.errors import PyMongoError
from datetime import datetime, timedelta, timezone


INDEXES = [
    ("whatsapp_messages", [("providerId", 1)], "wa_provider_id_unique", {"unique": True, "partialFilterExpression": {"providerId": {"$type": "string"}}}),
    ("whatsapp_messages", [("createdAt", -1), ("status", 1)], "createdAt_-1_status_1", {}),
    ("whatsapp_inbox", [("recipientHash", 1), ("receivedAt", -1)], "recipientHash_1_receivedAt_-1", {}),
    ("whatsapp_inbox", [("receivedAt", 1)], "receivedAt_1", {"expireAfterSeconds": 30 * 86400}),
    ("whatsapp_events", [("receivedAt", 1)], "receivedAt_1", {"expireAfterSeconds": 30 * 86400}),
    ("whatsapp_outbox", [("status", 1), ("createdAt", 1)], "status_1_createdAt_1", {}),
    ("whatsapp_outbox", [("expiresAt", 1)], "expiresAt_1", {"expireAfterSeconds": 0}),
    ("whatsapp_consents", [("customerId", 1), ("timestamp", -1)], "customerId_1_timestamp_-1", {}),
    ("whatsapp_order_events", [("orderId", 1), ("updatedAt", -1)], "orderId_1_updatedAt_-1", {}),
    ("whatsapp_campaigns", [("status", 1), ("scheduledAt", 1)], "status_1_scheduledAt_1", {}),
    ("whatsapp_outbox", [("status", 1), ("leaseUntil", 1)], "wa_processing_lease", {}),
]


def index_problems(db):
    """Read-only readiness check; unavailable indexes never imply readiness."""
    problems = []
    try:
        for collection, keys, name, options in INDEXES:
            indexes = db[collection].index_information()
            if not any(list(item.get("key", [])) == keys
                       and all(item.get(k) == v for k, v in options.items())
                       for item in indexes.values()):
                problems.append(collection + ":" + name)
    except PyMongoError:
        return ["indexes_unavailable"]
    return problems


def ensure_indexes(db):
    """Preflight all conflicts before additive creation. Requires MongoDB 5+."""
    duplicates = list(db.whatsapp_messages.aggregate([
        {"$match": {"providerId": {"$type": "string"}}},
        {"$group": {"_id": "$providerId", "count": {"$sum": 1}}},
        {"$match": {"count": {"$gt": 1}}}, {"$limit": 1},
    ]))
    if duplicates:
        raise ValueError("duplicate_provider_ids_require_reconciliation")
    for collection, keys, name, options in INDEXES:
        indexes = db[collection].index_information()
        if "expireAfterSeconds" in options and not any(list(old.get("key", [])) == keys and old.get("expireAfterSeconds") == options["expireAfterSeconds"] for old in indexes.values()):
            cutoff = datetime.now(timezone.utc) - timedelta(seconds=options["expireAfterSeconds"])
            if db[collection].count_documents({keys[0][0]: {"$lte": cutoff}}, limit=1):
                raise ValueError("expired_records_require_retention_review:" + collection)
        for old_name, old in indexes.items():
            if old_name == name and (list(old.get("key", [])) != keys or any(old.get(k) != v for k, v in options.items())):
                raise ValueError("index_definition_conflict:" + collection + ":" + name)
            if list(old.get("key", [])) == keys and "expireAfterSeconds" in old:
                if old.get("expireAfterSeconds") != options.get("expireAfterSeconds"):
                    raise ValueError("retention_index_conflict:" + collection)
    for collection, keys, name, options in INDEXES:
        db[collection].create_index(keys, name=name, **options)
