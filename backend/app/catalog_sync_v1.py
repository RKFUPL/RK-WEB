"""Shared catalog.sync.v1 primitives for RK-WEB.

This module contains no inventory, order, payment, or provider-asset mutation.
Inbound application updates only RK-WEB's local catalog relationships.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
from uuid import uuid4
from urllib.parse import urlsplit

from bson import ObjectId
from pymongo import ReturnDocument


SCHEMA_VERSION = "catalog.sync.v1"
SYSTEM = "rk-web"
EVENT_TYPES = {
    "PRODUCT_CREATED", "PRODUCT_UPDATED", "PRODUCT_DEACTIVATED", "PRODUCT_DELETED",
    "COLLECTION_CREATED", "COLLECTION_UPDATED", "COLLECTION_DEACTIVATED", "COLLECTION_DELETED",
    "CATEGORY_CREATED", "CATEGORY_UPDATED", "CATEGORY_DEACTIVATED", "CATEGORY_DELETED",
    "PRODUCT_COLLECTION_CHANGED", "MEDIA_CREATED", "MEDIA_UPDATED", "MEDIA_DELETED",
    "MEDIA_REORDERED", "MEDIA_PRIMARY_CHANGED",
}
ENTITY_TYPES = {"product", "collection", "category", "product_collection", "media"}
ACK_STATUSES = {"APPLIED", "ALREADY_APPLIED", "STALE", "CONFLICT", "REJECTED", "INVALID"}
REQUIRED_FIELDS = {
    "schema_version", "event_id", "event_type", "source_system", "source_id", "entity_type",
    "entity_identity", "entity_version", "observed_versions", "occurred_at", "correlation_id", "payload",
}
CATALOG_FIELDS = {"product_code", "sku", "name", "description", "price", "currency", "tax_inclusive", "category", "status", "active"}
FORBIDDEN_FIELDS = {"stock", "physical_stock", "reserved_stock", "available_stock", "inventory", "stock_ledger", "linesheets", "orders", "payments"}


class CatalogEventError(ValueError):
    pass


def now():
    return datetime.now(timezone.utc)


def payload_digest(event: dict) -> str:
    encoded = json.dumps(event.get("payload"), sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def validate_event(event: dict, *, expected_source: str | None = None) -> dict:
    if not isinstance(event, dict) or REQUIRED_FIELDS - set(event):
        raise CatalogEventError("Missing required catalog event fields.")
    if event["schema_version"] != SCHEMA_VERSION:
        raise CatalogEventError("Unsupported catalog event schema.")
    if event["event_type"] not in EVENT_TYPES or event["entity_type"] not in ENTITY_TYPES:
        raise CatalogEventError("Unsupported catalog event type.")
    if event["source_system"] not in {"rk-web", "rk-stock"} or (expected_source and event["source_system"] != expected_source):
        raise CatalogEventError("Invalid catalog event source.")
    if not isinstance(event["source_id"], str) or not event["source_id"].strip() or len(event["source_id"]) > 200:
        raise CatalogEventError("Invalid catalog source identity.")
    identity = event["entity_identity"]
    if not isinstance(identity, dict) or identity.get("origin_system") not in {"rk-web", "rk-stock"} or not str(identity.get("origin_id") or "").strip():
        raise CatalogEventError("Invalid canonical entity identity.")
    if isinstance(event["entity_version"], bool) or not isinstance(event["entity_version"], int) or event["entity_version"] < 1:
        raise CatalogEventError("Invalid entity version.")
    if not isinstance(event["observed_versions"], dict) or any(isinstance(value, bool) or not isinstance(value, int) or value < 0 for value in event["observed_versions"].values()):
        raise CatalogEventError("Invalid observed versions.")
    if not isinstance(event["payload"], dict) or FORBIDDEN_FIELDS.intersection(event["payload"]):
        raise CatalogEventError("Catalog event contains forbidden operational fields.")
    if event["entity_type"] == "media":
        media = event["payload"]
        provider = str(media.get("provider") or "").lower()
        if provider not in {"cloudinary", "zoho_workdrive"} or not str(media.get("media_id") or "").strip() or media.get("owner_system") not in {"rk-web", "rk-stock"}:
            raise CatalogEventError("Invalid media identity or ownership.")
        if provider == "cloudinary" and not str(media.get("public_id") or "").strip():
            raise CatalogEventError("Cloudinary media requires public_id.")
        if provider == "zoho_workdrive":
            permalink = str(media.get("permalink") or "")
            parsed = urlsplit(permalink)
            if parsed.scheme != "https" or "/file/" not in parsed.path or "/embed/" in parsed.path:
                raise CatalogEventError("WorkDrive media requires its canonical /file/ permalink.")
        if isinstance(media.get("position", 0), bool) or not isinstance(media.get("position", 0), int) or media.get("position", 0) < 0 or not isinstance(media.get("is_primary", False), bool):
            raise CatalogEventError("Invalid media position or primary state.")
    for key in ("event_id", "correlation_id"):
        try: uuid4().__class__(str(event[key]))
        except (ValueError, TypeError, AttributeError): raise CatalogEventError(f"Invalid {key}.")
    return event


def ensure_indexes(db) -> None:
    db.catalog_sync_identities.create_index([("entity_type", 1), ("origin_system", 1), ("origin_id", 1)], unique=True, name="catalog_identity_origin")
    db.catalog_sync_identities.create_index([("entity_type", 1), ("rk_web_id", 1)], unique=True, partialFilterExpression={"rk_web_id": {"$type": "string"}}, name="catalog_identity_web")
    db.catalog_sync_identities.create_index([("entity_type", 1), ("rk_stock_id", 1)], unique=True, partialFilterExpression={"rk_stock_id": {"$type": "string"}}, name="catalog_identity_stock")
    db.catalog_sync_outbox.create_index("event_id", unique=True, name="catalog_outbox_event")
    db.catalog_sync_outbox.create_index([("status", 1), ("next_attempt_at", 1)], name="catalog_outbox_due")
    db.catalog_sync_outbox.create_index("lease_until", name="catalog_outbox_lease")
    db.catalog_applied_events.create_index("event_id", unique=True, name="catalog_applied_event")
    db.catalog_applied_events.create_index([("source_system", 1), ("entity_type", 1), ("source_id", 1), ("entity_version", 1)], name="catalog_applied_version")
    db.catalog_sync_conflicts.create_index([("status", 1), ("detected_at", 1)], name="catalog_conflict_status")
    db.catalog_sync_logs.create_index([("created_at", -1)], name="catalog_log_created")
    db.catalog_sync_logs.create_index("correlation_id", name="catalog_log_correlation")
    db.catalog_reconciliation_runs.create_index("run_id", unique=True, name="catalog_reconcile_run")


def make_event(event_type: str, entity_type: str, source_id, version: int, payload: dict, *, observed_versions=None, identity=None, actor_id=None, correlation_id=None, causation_id=None, origin_event_id=None) -> dict:
    event_id = str(uuid4())
    return validate_event({
        "schema_version": SCHEMA_VERSION, "event_id": event_id, "event_type": event_type,
        "source_system": SYSTEM, "source_id": str(source_id), "entity_type": entity_type,
        "entity_identity": identity or {"origin_system": SYSTEM, "origin_id": str(source_id)},
        "entity_version": version, "observed_versions": observed_versions or {SYSTEM: version},
        "occurred_at": now().isoformat(), "correlation_id": correlation_id or str(uuid4()),
        "causation_id": causation_id, "origin_event_id": origin_event_id,
        "actor": {"type": "user", "id": str(actor_id)} if actor_id else None, "payload": payload,
    })


def enqueue(db, event: dict) -> dict:
    validate_event(event, expected_source=SYSTEM)
    timestamp = now()
    document = {**event, "status": "pending", "attempts": 0, "next_attempt_at": timestamp, "created_at": timestamp, "updated_at": timestamp}
    db.catalog_sync_outbox.update_one({"event_id": event["event_id"]}, {"$setOnInsert": document}, upsert=True)
    return document


def claim_due(db, worker_id: str, lease_seconds=60):
    timestamp = now()
    return db.catalog_sync_outbox.find_one_and_update(
        {"status": "pending", "next_attempt_at": {"$lte": timestamp}, "$or": [{"lease_until": {"$exists": False}}, {"lease_until": {"$lte": timestamp}}]},
        {"$set": {"lease_id": worker_id, "lease_until": timestamp + timedelta(seconds=lease_seconds), "claimed_at": timestamp, "updated_at": timestamp}},
        sort=[("created_at", 1)], return_document=ReturnDocument.AFTER,
    )


def complete(db, event: dict, receiver_status: str) -> bool:
    outbox_status = "conflict" if receiver_status == "CONFLICT" else "completed"
    return db.catalog_sync_outbox.update_one(
        {"_id": event["_id"], "status": "pending", "lease_id": event.get("lease_id")},
        {"$set": {"status": outbox_status, "receiver_status": receiver_status, "completed_at": now(), "updated_at": now(), "last_error": "Receiver reported a catalog conflict" if receiver_status == "CONFLICT" else None}, "$unset": {"lease_id": "", "lease_until": "", "claimed_at": ""}},
    ).modified_count == 1


def fail(db, event: dict, error: Exception) -> bool:
    attempts = int(event.get("attempts", 0)) + 1
    timestamp = now()
    return db.catalog_sync_outbox.update_one(
        {"_id": event["_id"], "status": "pending", "lease_id": event.get("lease_id")},
        {"$set": {"attempts": attempts, "last_error": str(error)[:500], "next_attempt_at": timestamp + timedelta(seconds=min(3600, 2 ** min(attempts, 10))), "updated_at": timestamp}, "$unset": {"lease_id": "", "lease_until": "", "claimed_at": ""}},
    ).modified_count == 1


def _ack(event, status, local_id=None):
    return {"schema_version": SCHEMA_VERSION, "status": status, "event_id": event["event_id"], "entity_type": event["entity_type"], "source_id": event["source_id"], "entity_version": event["entity_version"], "local_entity_id": str(local_id) if local_id else None}


def _identity(db, event, local_id=None):
    identity = event["entity_identity"]
    query = {"entity_type": event["entity_type"], "origin_system": identity["origin_system"], "origin_id": str(identity["origin_id"])}
    current = db.catalog_sync_identities.find_one(query)
    if local_id and not current:
        values = {**query, "rk_stock_id": event["source_id"] if event["source_system"] == "rk-stock" else None, "rk_web_id": str(local_id), "versions": {}, "created_at": now(), "updated_at": now()}
        db.catalog_sync_identities.insert_one(values)
        current = values
    return current


def apply_incoming(db, raw_event: dict) -> tuple[dict, int]:
    event = validate_event(raw_event, expected_source="rk-stock")
    digest = payload_digest(event)
    applied = db.catalog_applied_events.find_one({"event_id": event["event_id"]})
    if applied:
        if applied.get("payload_digest") != digest:
            return _ack(event, "INVALID"), 400
        return _ack(event, "ALREADY_APPLIED", applied.get("local_entity_id")), 200
    mapping = _identity(db, event)
    versions = dict((mapping or {}).get("versions") or {})
    known_source = int(versions.get("rk-stock", 0))
    if event["entity_version"] <= known_source:
        return _ack(event, "STALE", (mapping or {}).get("rk_web_id")), 200
    observed_web = int(event["observed_versions"].get("rk-web", 0))
    known_web = int(versions.get("rk-web", 0))
    if observed_web < known_web:
        conflict = {"conflict_id": str(uuid4()), "event_id": event["event_id"], "entity_type": event["entity_type"], "entity_identity": event["entity_identity"], "local_versions": versions, "incoming_versions": event["observed_versions"], "incoming_payload": event["payload"], "status": "unresolved", "detected_at": now()}
        db.catalog_sync_conflicts.insert_one(conflict)
        return _ack(event, "CONFLICT", (mapping or {}).get("rk_web_id")), 409
    local_id = _apply_payload(db, event, mapping)
    mapping = _identity(db, event, local_id)
    versions.update({"rk-stock": event["entity_version"]})
    db.catalog_sync_identities.update_one({"entity_type": event["entity_type"], "origin_system": event["entity_identity"]["origin_system"], "origin_id": str(event["entity_identity"]["origin_id"])}, {"$set": {"versions": versions, "rk_stock_id": event["source_id"], "rk_web_id": str(local_id), "updated_at": now()}})
    db.catalog_applied_events.insert_one({"event_id": event["event_id"], "source_system": event["source_system"], "entity_type": event["entity_type"], "source_id": event["source_id"], "entity_version": event["entity_version"], "payload_digest": digest, "result": "APPLIED", "local_entity_id": str(local_id), "correlation_id": event["correlation_id"], "applied_at": now()})
    db.catalog_sync_logs.insert_one({"event_id": event["event_id"], "event_type": event["event_type"], "entity_type": event["entity_type"], "source_id": event["source_id"], "status": "APPLIED", "correlation_id": event["correlation_id"], "created_at": now()})
    return _ack(event, "APPLIED", local_id), 200


def _apply_payload(db, event, mapping):
    payload, entity_type = event["payload"], event["entity_type"]
    local_id = (mapping or {}).get("rk_web_id")
    object_id = ObjectId(local_id) if local_id and ObjectId.is_valid(local_id) else None
    if entity_type == "product":
        document = db.products.find_one({"_id": object_id}) if object_id else None
        values = {key: payload[key] for key in CATALOG_FIELDS if key in payload}
        if "tax_inclusive" in values: values["taxInclusive"] = values.pop("tax_inclusive")
        if "active" in values: values["isActive"] = values.pop("active")
        values.update({"source_system": event["entity_identity"]["origin_system"], "source_id": str(event["entity_identity"]["origin_id"]), "updatedAt": now()})
        if event["event_type"] in {"PRODUCT_DEACTIVATED", "PRODUCT_DELETED"}: values.update({"isActive": False, "status": "archived"})
        if document: db.products.update_one({"_id": document["_id"]}, {"$set": values}); return document["_id"]
        values["createdAt"] = now(); result = db.products.insert_one(values); return result.inserted_id
    if entity_type == "collection":
        document = db.collections.find_one({"_id": object_id}) if object_id else None
        values = {key: payload[key] for key in ("name", "slug", "code", "description", "status") if key in payload}
        values.update({"source_system": event["entity_identity"]["origin_system"], "source_id": str(event["entity_identity"]["origin_id"]), "updatedAt": now()})
        if event["event_type"] in {"COLLECTION_DEACTIVATED", "COLLECTION_DELETED"}: values.update({"isActive": False, "status": "archived"})
        if document: db.collections.update_one({"_id": document["_id"]}, {"$set": values}); return document["_id"]
        values.update({"productRefs": [], "createdAt": now()}); result = db.collections.insert_one(values); return result.inserted_id
    if entity_type == "category":
        setting = db.settings.find_one({"_id": "global"}) or {}; metadata = list(setting.get("catalog_source_categories") or [])
        metadata = [item for item in metadata if not (item.get("source_system") == event["entity_identity"]["origin_system"] and item.get("source_id") == str(event["entity_identity"]["origin_id"]))]
        metadata.append({**payload, "source_system": event["entity_identity"]["origin_system"], "source_id": str(event["entity_identity"]["origin_id"])})
        db.settings.update_one({"_id": "global"}, {"$set": {"catalog_source_categories": metadata, "updated_at": now()}}, upsert=True)
        return event["source_id"]
    # Membership and media application require the product mapping and never duplicate products.
    product_identity = payload.get("product_identity") or {}
    product_map = db.catalog_sync_identities.find_one({"entity_type": "product", "origin_system": product_identity.get("origin_system"), "origin_id": str(product_identity.get("origin_id") or "")})
    if not product_map or not ObjectId.is_valid(str(product_map.get("rk_web_id") or "")):
        raise CatalogEventError("Mapped product is required before relationship events.")
    product_id = ObjectId(product_map["rk_web_id"])
    if entity_type == "product_collection":
        for change in payload.get("changes") or []:
            identity = change.get("collection_identity") or {}
            collection_map = db.catalog_sync_identities.find_one({"entity_type": "collection", "origin_system": identity.get("origin_system"), "origin_id": str(identity.get("origin_id") or "")})
            if not collection_map or not ObjectId.is_valid(str(collection_map.get("rk_web_id") or "")): continue
            collection_id = ObjectId(collection_map["rk_web_id"]); operation = change.get("operation")
            if operation == "REMOVE": db.collections.update_one({"_id": collection_id}, {"$pull": {"productRefs": {"productId": product_id}}})
            elif operation == "ADD": db.collections.update_one({"_id": collection_id, "productRefs.productId": {"$ne": product_id}}, {"$push": {"productRefs": {"productId": product_id, "displayOrder": int(change.get("display_order", 0))}}})
            elif operation == "REORDER": db.collections.update_one({"_id": collection_id, "productRefs.productId": product_id}, {"$set": {"productRefs.$.displayOrder": int(change.get("display_order", 0))}})
        return product_id
    media = list((db.products.find_one({"_id": product_id}) or {}).get("catalogMedia") or [])
    media_id = str(payload.get("media_id") or "")
    media = [item for item in media if str(item.get("media_id")) != media_id]
    if event["event_type"] != "MEDIA_DELETED": media.append(payload)
    media.sort(key=lambda item: int(item.get("position", 0)))
    db.products.update_one({"_id": product_id}, {"$set": {"catalogMedia": media, "updatedAt": now()}})
    return media_id


def manifest(db):
    items = []
    for mapping in db.catalog_sync_identities.find({}):
        payload = None
        local_id = mapping.get("rk_web_id")
        if mapping.get("entity_type") == "product" and local_id and ObjectId.is_valid(str(local_id)):
            product = db.products.find_one({"_id": ObjectId(local_id)}) or {}
            payload = {key: product.get(key) for key in CATALOG_FIELDS if product.get(key) is not None}
            payload["active"] = product.get("isActive") is not False
        elif mapping.get("entity_type") == "collection" and local_id and ObjectId.is_valid(str(local_id)):
            collection = db.collections.find_one({"_id": ObjectId(local_id)}) or {}
            payload = {key: collection.get(key) for key in ("name", "slug", "code", "description", "status") if collection.get(key) is not None}
            payload["active"] = collection.get("isActive") is not False
        elif mapping.get("entity_type") == "category":
            setting = db.settings.find_one({"_id": "global"}) or {}
            category = next((item for item in setting.get("catalog_source_categories") or [] if item.get("source_system") == mapping.get("origin_system") and str(item.get("source_id")) == str(mapping.get("origin_id"))), None)
            payload = {key: category[key] for key in ("name", "slug", "description", "status", "active") if category and category.get(key) is not None} if category else None
        items.append({
            "entity_type": mapping.get("entity_type"),
            "entity_identity": {"origin_system": mapping.get("origin_system"), "origin_id": mapping.get("origin_id")},
            "versions": mapping.get("versions") or {},
            "rk_web_id": mapping.get("rk_web_id"), "rk_stock_id": mapping.get("rk_stock_id"),
            "payload": payload,
        })
        if mapping.get("entity_type") == "product" and payload is not None:
            product = db.products.find_one({"_id": ObjectId(local_id)}) or {}
            for media in product.get("catalogMedia") or product.get("media") or []:
                if isinstance(media, dict) and media.get("media_id"):
                    items.append({"entity_type": "media", "entity_identity": {"origin_system": media.get("owner_system") or mapping.get("origin_system"), "origin_id": str(media.get("media_id"))}, "product_identity": {"origin_system": mapping.get("origin_system"), "origin_id": mapping.get("origin_id")}, "versions": mapping.get("versions") or {}, "payload": {key: media[key] for key in ("media_id", "provider", "owner_system", "url", "permalink", "secure_url", "public_id", "position", "is_primary", "alt_text", "description", "asset_folder", "view") if media.get(key) is not None}})
        if mapping.get("entity_type") == "collection" and payload is not None:
            collection = db.collections.find_one({"_id": ObjectId(local_id)}) or {}
            collection_identity = {"origin_system": mapping.get("origin_system"), "origin_id": str(mapping.get("origin_id"))}
            for ref in collection.get("productRefs") or []:
                product_id = ref.get("productId") if isinstance(ref, dict) else ref
                product_map = db.catalog_sync_identities.find_one({"entity_type": "product", "rk_web_id": str(product_id)})
                if not product_map:
                    continue
                product_identity = {"origin_system": product_map.get("origin_system"), "origin_id": str(product_map.get("origin_id"))}
                membership_id = f"{product_identity['origin_system']}:{product_identity['origin_id']}->{collection_identity['origin_system']}:{collection_identity['origin_id']}"
                versions = dict(product_map.get("versions") or {})
                items.append({"entity_type": "product_collection", "entity_identity": {"origin_system": product_identity["origin_system"], "origin_id": membership_id}, "product_identity": product_identity, "collection_identity": collection_identity, "versions": versions, "payload": {"product_identity": product_identity, "collection_identity": collection_identity, "display_order": int(ref.get("displayOrder", 0)) if isinstance(ref, dict) else 0, "active": True}})
    return {"schema_version": SCHEMA_VERSION, "source_system": SYSTEM, "generated_at": now().isoformat(), "items": items}


def classify_manifest_difference(local_item, remote_item):
    if not local_item and remote_item:
        return "LOCAL_MISSING"
    if local_item and not remote_item:
        return "REMOTE_MISSING"
    if not local_item and not remote_item:
        return "UNSAFE_TO_REPAIR"
    local_versions = local_item.get("versions") or {}; remote_versions = remote_item.get("versions") or {}
    local_version = int(local_versions.get(SYSTEM, 0)); remote_version = int(remote_versions.get(SYSTEM, 0))
    if local_version == remote_version and local_item.get("payload") == remote_item.get("payload"):
        return "IDENTICAL"
    if local_version > remote_version:
        return "LOCAL_NEWER"
    if remote_version > local_version:
        return "REMOTE_NEWER"
    return "CONCURRENT_CONFLICT"


def queue_repair_events(db, remote_items, actor_id=None):
    """Queue only locally-owned newer catalog snapshots; never mutate remotely."""
    for item in remote_items:
        identity = item.get("entity_identity") if isinstance(item, dict) else None
        if not isinstance(identity, dict) or identity.get("origin_system") not in {"rk-web", "rk-stock"} or not str(identity.get("origin_id") or "").strip():
            fingerprint = payload_digest({"payload": item if isinstance(item, dict) else {"invalid": True}})
            if not db.catalog_sync_conflicts.find_one({"reason": "ambiguous_reconciliation_authority", "fingerprint": fingerprint, "status": "unresolved"}):
                db.catalog_sync_conflicts.insert_one({"conflict_id": str(uuid4()), "entity_type": item.get("entity_type") if isinstance(item, dict) else None, "entity_identity": identity, "reason": "ambiguous_reconciliation_authority", "fingerprint": fingerprint, "status": "unresolved", "detected_at": now()})
    remote = {(item.get("entity_type"), (item.get("entity_identity") or {}).get("origin_system"), str((item.get("entity_identity") or {}).get("origin_id") or "")): item for item in remote_items if isinstance(item, dict)}
    queued = []
    for mapping in db.catalog_sync_identities.find({}):
        key = (mapping.get("entity_type"), mapping.get("origin_system"), str(mapping.get("origin_id") or ""))
        versions = mapping.get("versions") or {}
        local_version = int(versions.get(SYSTEM, 0))
        remote_version = int((remote.get(key) or {}).get("versions", {}).get(SYSTEM, 0))
        if local_version and local_version == remote_version and remote.get(key) and (manifest(db)["items"] and payload_digest({"payload": (remote.get(key) or {}).get("payload")}) != payload_digest({"payload": next((item.get("payload") for item in manifest(db)["items"] if (item.get("entity_type"), (item.get("entity_identity") or {}).get("origin_system"), str((item.get("entity_identity") or {}).get("origin_id") or "")) == key), None)})):
            if not db.catalog_sync_conflicts.find_one({"entity_type": mapping.get("entity_type"), "entity_identity": {"origin_system": mapping.get("origin_system"), "origin_id": mapping.get("origin_id")}, "status": "unresolved", "reason": "reconciliation_payload_divergence"}):
                db.catalog_sync_conflicts.insert_one({"conflict_id": str(uuid4()), "entity_type": mapping.get("entity_type"), "entity_identity": {"origin_system": mapping.get("origin_system"), "origin_id": mapping.get("origin_id")}, "local_versions": versions, "incoming_versions": (remote.get(key) or {}).get("versions") or {}, "reason": "reconciliation_payload_divergence", "status": "unresolved", "detected_at": now()})
            continue
        if not local_version or local_version <= remote_version:
            continue
        entity_type = mapping.get("entity_type")
        local_id = mapping.get("rk_web_id")
        if entity_type == "product" and ObjectId.is_valid(str(local_id)):
            product = db.products.find_one({"_id": ObjectId(local_id)}) or {}
            payload = {key: product.get(key) for key in CATALOG_FIELDS if product.get(key) is not None}
            payload["active"] = product.get("isActive") is not False
            event_type = "PRODUCT_CREATED" if key not in remote else "PRODUCT_DEACTIVATED" if payload.get("active") is False else "PRODUCT_UPDATED"
        elif entity_type == "collection" and ObjectId.is_valid(str(local_id)):
            collection = db.collections.find_one({"_id": ObjectId(local_id)}) or {}
            payload = {key: collection.get(key) for key in ("name", "slug", "code", "description", "status") if collection.get(key) is not None}
            payload["active"] = collection.get("isActive") is not False
            event_type = "COLLECTION_CREATED" if key not in remote else "COLLECTION_DEACTIVATED" if payload.get("active") is False else "COLLECTION_UPDATED"
        elif entity_type == "category":
            setting = db.settings.find_one({"_id": "global"}) or {}
            category = next((item for item in setting.get("catalog_source_categories") or [] if item.get("source_system") == mapping.get("origin_system") and str(item.get("source_id")) == str(mapping.get("origin_id"))), None)
            if not category:
                continue
            payload = {field: category[field] for field in ("name", "slug", "description", "status", "active") if category.get(field) is not None}
            event_type = "CATEGORY_CREATED" if key not in remote else "CATEGORY_DEACTIVATED" if payload.get("active") is False else "CATEGORY_UPDATED"
        else:
            continue
        existing = db.catalog_sync_outbox.find_one({"entity_type": entity_type, "entity_identity": {"origin_system": mapping["origin_system"], "origin_id": mapping["origin_id"]}, "entity_version": local_version, "status": {"$in": ["pending", "completed"]}})
        if existing:
            continue
        queued.append(enqueue(db, make_event(event_type, entity_type, local_id, local_version, payload, observed_versions=versions, identity={"origin_system": mapping["origin_system"], "origin_id": mapping["origin_id"]}, actor_id=actor_id, causation_id="reconciliation")))
    local_manifest = manifest(db)["items"]
    for item in local_manifest:
        entity_type = item.get("entity_type"); identity = item.get("entity_identity") or {}; payload = item.get("payload") or {}
        if entity_type not in {"media", "product_collection"} or not identity.get("origin_system") or not identity.get("origin_id"):
            continue
        key = (entity_type, identity["origin_system"], str(identity["origin_id"]))
        remote_item = remote.get(key); versions = item.get("versions") or {}; local_version = int(versions.get(SYSTEM, 0)); remote_version = int((remote_item or {}).get("versions", {}).get(SYSTEM, 0))
        if local_version and local_version == remote_version and remote_item and payload_digest({"payload": payload}) != payload_digest({"payload": remote_item.get("payload")}):
            if not db.catalog_sync_conflicts.find_one({"entity_type": entity_type, "entity_identity": identity, "status": "unresolved", "reason": "reconciliation_payload_divergence"}):
                db.catalog_sync_conflicts.insert_one({"conflict_id": str(uuid4()), "entity_type": entity_type, "entity_identity": identity, "local_versions": versions, "incoming_versions": remote_item.get("versions") or {}, "reason": "reconciliation_payload_divergence", "status": "unresolved", "detected_at": now()})
            continue
        if not local_version or local_version <= remote_version:
            continue
        event_type = "MEDIA_CREATED" if entity_type == "media" and not remote_item else "MEDIA_UPDATED" if entity_type == "media" else "PRODUCT_COLLECTION_CHANGED"
        if entity_type == "media" and remote_item and payload.get("position") != (remote_item.get("payload") or {}).get("position"):
            event_type = "MEDIA_REORDERED"
        if entity_type == "media" and remote_item and payload.get("is_primary") != (remote_item.get("payload") or {}).get("is_primary"):
            event_type = "MEDIA_PRIMARY_CHANGED"
        duplicate = db.catalog_sync_outbox.find_one({"event_type": event_type, "entity_type": entity_type, "entity_identity": identity, "entity_version": local_version, "status": {"$in": ["pending", "completed"]}})
        if duplicate:
            continue
        event_payload = dict(payload)
        if entity_type == "media":
            event_payload["product_identity"] = item.get("product_identity")
        if entity_type == "product_collection":
            event_payload = {"product_identity": item.get("product_identity") or identity, "changes": [{"operation": "ADD", "collection_identity": item.get("collection_identity") or {"origin_system": identity.get("origin_system"), "origin_id": item.get("collection_id")}, "display_order": payload.get("display_order", 0)}]}
        queued.append(enqueue(db, make_event(event_type, entity_type, identity["origin_id"], local_version, event_payload, observed_versions=versions, identity=identity, actor_id=actor_id, causation_id="reconciliation")))
    return queued
