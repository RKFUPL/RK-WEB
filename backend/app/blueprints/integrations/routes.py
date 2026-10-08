import hashlib
import hmac
import secrets
import re
from uuid import uuid4
from bcrypt import gensalt, hashpw
from datetime import datetime, timezone
from urllib.parse import urlsplit
from bson import ObjectId

from flask import Blueprint, current_app, jsonify, request

from ...rbac import database
from ...time_utils import json_value
from ...credential_sync import consume_handoff, retry_pending, verify_handoff
from ...catalog_sync_v1 import CatalogEventError, apply_incoming, manifest as catalog_manifest, queue_repair_events, classify_manifest_difference


integrations_bp = Blueprint("integrations", __name__)


def _credential_sync_authorized() -> bool:
    configured = str(current_app.config.get("STOCK_CREDENTIAL_SYNC_SECRET") or "")
    supplied = _bearer_token()
    return bool(configured and supplied and hmac.compare_digest(supplied, configured))


def _bearer_token():
    value = request.headers.get("Authorization", "")
    return value[7:] if value.startswith("Bearer ") else ""


@integrations_bp.post("/internal/auth/sync-ack")
def credential_sync_ack():
    if not _credential_sync_scope_authorized():
        return jsonify({"error": "Service credential rejected."}), 401
    payload = request.get_json(silent=True) or {}
    event_id = str(payload.get("event_id") or "").strip()
    required = ("event_type", "source_user_id", "credential_version", "status", "applied")
    if not event_id or "target_user_id" not in payload or any(key not in payload for key in required) or payload.get("status") not in {"APPLIED", "ALREADY_APPLIED", "STALE", "CONFLICT"} or not isinstance(payload.get("applied"), bool) or payload.get("source_system") not in {"rk-stock", "rk-web"} or payload.get("target_system") not in {"rk-web", "rk-stock"}:
        return jsonify({"error": "Invalid synchronization acknowledgement."}), 400
    event = database().credential_sync_outbox.find_one({"_id": event_id, "source_system": payload["target_system"], "target_system": payload["source_system"]})
    if not event:
        return jsonify({"error": "Synchronization event not found."}), 404
    if event.get("event_type") != payload.get("event_type") or event.get("source_user_id") != str(payload.get("source_user_id")) or event.get("credential_version") != payload.get("credential_version") or event.get("target_user_id") != payload.get("target_user_id") or bool(payload["applied"]) != (payload["status"] == "APPLIED"):
        return jsonify({"error": "Synchronization acknowledgement does not match the event."}), 409
    if payload.get("status") == "CONFLICT":
        return jsonify({"error": "Synchronization conflict."}), 409
    database().credential_sync_outbox.update_one({"_id": event_id, "status": {"$in": ["PENDING", "COMPLETED"]}}, {"$set": {"status": "COMPLETED", "completed_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc), "last_error": None, "receiver_status": payload["status"]}})
    return jsonify({"status": payload["status"], "event_id": event_id}), 200


def _credential_sync_scope_authorized():
    return _credential_sync_authorized() and request.headers.get("X-Credential-Sync-Scope") == "credential:sync"


def _validate_inbound_sync(payload, *, password_event=False):
    if not _credential_sync_scope_authorized():
        return jsonify({"error": "Credential synchronization scope required."}), 403
    required = ("event_id", "event_type", "source_system", "target_system", "source_user_id", "target_user_id", "credential_version", "profile_version", "payload_metadata")
    if password_event:
        required = required + ("credential_handoff",)
    if any(key not in payload for key in required):
        return jsonify({"error": "Invalid synchronization request."}), 400
    if payload["source_system"] != "rk-stock" or payload["target_system"] != "rk-web":
        return jsonify({"error": "Invalid synchronization direction."}), 400
    event = {"event_id": payload["event_id"], "event_type": payload["event_type"], "source_user_id": str(payload["source_user_id"]), "target_user_id": str(payload["target_user_id"]), "credential_version": payload["credential_version"], "profile_version": payload["profile_version"]}
    if password_event:
        try:
            payload["_claims"] = verify_handoff(payload["credential_handoff"], expected_event=event, issuer="rk-stock", audience="rk-web")
        except ValueError:
            return jsonify({"error": "Invalid credential handoff."}), 401
    else:
        payload["_claims"] = {**event, "jti": f"metadata:{payload['event_id']}"}
    if password_event and not isinstance(payload.get("password"), str):
        return jsonify({"error": "Credential is required."}), 400
    return None


@integrations_bp.post("/internal/auth/provision-credential")
def inbound_credential_provision():
    payload = request.get_json(silent=True) or {}
    failure = _validate_inbound_sync(payload, password_event=True)
    if failure:
        return failure
    db = database()
    user = db.users.find_one({"_id": ObjectId(payload["target_user_id"])}) if ObjectId.is_valid(payload["target_user_id"]) else None
    if not user:
        return jsonify({"error": "Target identity not found."}), 404
    current = int(user.get("credentialVersion", 0))
    if payload["credential_version"] < current:
        return jsonify({"event_id": payload["event_id"], "event_type": payload["event_type"], "status": "STALE", "applied": False, "credential_version": current}), 200
    if payload["credential_version"] == current:
        return jsonify({"event_id": payload["event_id"], "event_type": payload["event_type"], "status": "CONFLICT", "applied": False, "credential_version": current}), 409
    if not consume_handoff(db, payload["_claims"], event_type=payload["event_type"], source_system="rk-stock", target_system="rk-web"):
        return jsonify({"event_id": payload["event_id"], "event_type": payload["event_type"], "status": "ALREADY_APPLIED", "applied": False, "credential_version": current}), 200
    now = datetime.now(timezone.utc)
    db.users.update_one({"_id": user["_id"]}, {"$set": {"passwordHash": hashpw(payload["password"].encode(), gensalt()).decode(), "credentialVersion": payload["credential_version"], "updatedAt": now}})
    db.auth_sessions.update_many({"userId": user["_id"], "revokedAt": None}, {"$set": {"revokedAt": now}})
    return jsonify({"event_id": payload["event_id"], "event_type": payload["event_type"], "status": "APPLIED", "applied": True, "credential_version": payload["credential_version"]}), 200


@integrations_bp.post("/internal/users/provision")
def inbound_user_provision():
    payload = request.get_json(silent=True) or {}
    failure = _validate_inbound_sync(payload)
    if failure:
        return failure
    db = database()
    event_type = payload["event_type"]
    if event_type not in {"USER_CREATED", "ROLE_CHANGED", "STATUS_CHANGED", "USERNAME_CHANGED", "EMAIL_CHANGED"}:
        return jsonify({"error": "Unsupported metadata event."}), 400
    metadata = payload["payload_metadata"] if isinstance(payload["payload_metadata"], dict) else {}
    target_id = payload["target_user_id"]
    user = db.users.find_one({"_id": ObjectId(target_id)}) if ObjectId.is_valid(target_id) else None
    created = False
    if user is None and event_type == "USER_CREATED":
        role = metadata.get("role")
        if role not in {"admin", "staff"}:
            return jsonify({"error": "Only operational users may be provisioned."}), 403
        email = str(metadata.get("email") or "").strip().lower()
        username = str(metadata.get("username") or "").strip()
        if not email or "@" not in email or not username:
            return jsonify({"error": "Valid user metadata is required."}), 400
        if db.users.find_one({"$or": [{"email": email}, {"username": username}]}):
            return jsonify({"error": "User identity conflict."}), 409
        now = datetime.now(timezone.utc)
        user = {"email": email, "username": username, "role": role, "isActive": bool(metadata.get("is_active", True)), "emailVerified": True, "mustChangePassword": True, "credentialVersion": int(payload["credential_version"]), "createdAt": now, "updatedAt": now}
        result = db.users.insert_one(user)
        user["_id"] = result.inserted_id
        created = True
    if user is None:
        return jsonify({"error": "Target identity not found."}), 404
    if created:
        if not consume_handoff(db, payload["_claims"], event_type=event_type, source_system="rk-stock", target_system="rk-web"):
            return jsonify({"event_id": payload["event_id"], "event_type": event_type, "status": "ALREADY_APPLIED", "applied": False, "credential_version": payload["credential_version"]}), 200
        db.user_identity_links.update_one({"rk_stock_user_id": target_id}, {"$set": {"rk_web_user_id": user["_id"], "email": user["email"], "username": user["username"], "status": "active", "updated_at": datetime.now(timezone.utc)}, "$setOnInsert": {"created_at": datetime.now(timezone.utc)}}, upsert=True)
        return jsonify({"event_id": payload["event_id"], "event_type": event_type, "status": "APPLIED", "applied": True, "credential_version": payload["credential_version"]}), 200
    current = int(user.get("credentialVersion", 0))
    if payload["credential_version"] < current:
        return jsonify({"event_id": payload["event_id"], "event_type": event_type, "status": "STALE", "applied": False, "credential_version": current}), 200
    if payload["credential_version"] == current:
        if not consume_handoff(db, payload["_claims"], event_type=event_type, source_system="rk-stock", target_system="rk-web"):
            return jsonify({"event_id": payload["event_id"], "event_type": event_type, "status": "ALREADY_APPLIED", "applied": False, "credential_version": current}), 200
        return jsonify({"error": "Equal version conflict."}), 409
    if not consume_handoff(db, payload["_claims"], event_type=event_type, source_system="rk-stock", target_system="rk-web"):
        return jsonify({"event_id": payload["event_id"], "event_type": event_type, "status": "ALREADY_APPLIED", "applied": False, "credential_version": current}), 200
    updates = {"credentialVersion": payload["credential_version"], "updatedAt": datetime.now(timezone.utc)}
    if event_type in {"ROLE_CHANGED", "USER_CREATED"}:
        role = metadata.get("role")
        if role not in {"admin", "staff"}:
            return jsonify({"error": "Unsupported operational role."}), 403
        if role != user.get("role") and user.get("role") == "admin" and role != "admin" and db.users.count_documents({"role": "admin", "isActive": {"$ne": False}}) <= 1:
            return jsonify({"error": "The final administrator cannot be removed."}), 409
        updates["role"] = role
    if event_type in {"STATUS_CHANGED", "USER_CREATED"}:
        updates["isActive"] = bool(metadata.get("is_active", True))
        if not updates["isActive"]:
            db.auth_sessions.update_many({"userId": user["_id"], "revokedAt": None}, {"$set": {"revokedAt": datetime.now(timezone.utc)}})
    if event_type == "USERNAME_CHANGED":
        username = str(metadata.get("username") or "").strip()
        if not username or db.users.find_one({"username": username, "_id": {"$ne": user["_id"]}}):
            return jsonify({"error": "Username conflict."}), 409
        updates["username"] = username
    if event_type == "EMAIL_CHANGED":
        email = str(metadata.get("email") or "").strip().lower()
        if "@" not in email or db.users.find_one({"email": email, "_id": {"$ne": user["_id"]}}):
            return jsonify({"error": "Email conflict."}), 409
        updates["email"] = email
    db.users.update_one({"_id": user["_id"]}, {"$set": updates})
    db.user_identity_links.update_one({"rk_stock_user_id": target_id}, {"$set": {"rk_web_user_id": user["_id"], "email": updates.get("email", user.get("email")), "username": updates.get("username", user.get("username")), "updated_at": datetime.now(timezone.utc)}}, upsert=True)
    return jsonify({"event_id": payload["event_id"], "event_type": event_type, "status": "APPLIED", "applied": True, "credential_version": payload["credential_version"]}), 200


def _token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _connection_for_token():
    token = _bearer_token()
    if not token:
        return None
    return database().service_connections.find_one({"service": "stock_linesheets", "tokenHash": _token_hash(token), "active": True, "revokedAt": {"$exists": False}})


def _service_required():
    return _connection_for_token() is not None


def _catalog_write_required():
    connection = _connection_for_token()
    if not connection or "catalog:write" not in connection.get("scopes", []):
        return None
    return connection


def _catalog_event_required():
    connection = _connection_for_token()
    if not connection or not {"catalog:events:write", "catalog:write"}.intersection(connection.get("scopes", [])):
        return None
    return connection


@integrations_bp.post("/internal/catalog/events")
def inbound_catalog_event():
    if not _catalog_event_required():
        return jsonify({"error": "Catalog event scope is not authorized."}), 403 if _connection_for_token() else 401
    try:
        acknowledgement, status_code = apply_incoming(database(), request.get_json(silent=True) or {})
    except CatalogEventError as error:
        return jsonify({"schema_version": "catalog.sync.v1", "status": "INVALID", "message": str(error)}), 400
    except Exception:
        current_app.logger.exception("Unable to apply inbound catalog event")
        return jsonify({"schema_version": "catalog.sync.v1", "status": "REJECTED", "message": "Catalog event could not be applied."}), 503
    return jsonify(acknowledgement), status_code


@integrations_bp.get("/internal/catalog/manifest")
def internal_catalog_manifest():
    if not _catalog_event_required():
        return jsonify({"error": "Catalog event scope is not authorized."}), 403 if _connection_for_token() else 401
    return jsonify(catalog_manifest(database()))


@integrations_bp.post("/internal/catalog/reconcile")
def start_internal_catalog_reconcile():
    if not _catalog_event_required():
        return jsonify({"error": "Catalog event scope is not authorized."}), 403 if _connection_for_token() else 401
    run_id = str(uuid4())
    timestamp = datetime.now(timezone.utc); db = database(); local = catalog_manifest(db)
    remote_items = (request.get_json(silent=True) or {}).get("items") or []
    local_keys = {(item["entity_type"], item["entity_identity"]["origin_system"], str(item["entity_identity"]["origin_id"])) for item in local["items"]}
    remote_keys = {(item.get("entity_type"), (item.get("entity_identity") or {}).get("origin_system"), str((item.get("entity_identity") or {}).get("origin_id") or "")) for item in remote_items if isinstance(item, dict)}
    local_by_key = {(item["entity_type"], item["entity_identity"]["origin_system"], str(item["entity_identity"]["origin_id"])): item for item in local["items"]}
    remote_by_key = {(item.get("entity_type"), (item.get("entity_identity") or {}).get("origin_system"), str((item.get("entity_identity") or {}).get("origin_id") or "")): item for item in remote_items if isinstance(item, dict)}
    classes = [classify_manifest_difference(local_by_key.get(key), remote_by_key.get(key)) for key in set(local_by_key) | set(remote_by_key)]
    result = {"local_count": len(local_keys), "remote_count": len(remote_keys), "missing_locally": len(remote_keys - local_keys), "missing_remotely": len(local_keys - remote_keys), "identical": classes.count("IDENTICAL"), "conflicts": classes.count("CONCURRENT_CONFLICT"), "unsafe": classes.count("UNSAFE_TO_REPAIR"), "skipped": classes.count("REMOTE_NEWER")}
    repair_events = queue_repair_events(db, remote_items)
    result["repair_events_queued"] = len(repair_events)
    result["repaired"] = len(repair_events)
    result["pending"] = db.catalog_sync_outbox.count_documents({"status": "pending", "causation_id": "reconciliation"})
    result["conflicts"] = db.catalog_sync_conflicts.count_documents({"status": "unresolved"})
    result["skipped_idempotent"] = max(0, result["missing_remotely"] - len(repair_events))
    db.catalog_reconciliation_runs.insert_one({"run_id": run_id, "status": "completed", "requested_by": "rk-stock", "result": result, "created_at": timestamp, "updated_at": timestamp})
    return jsonify({"schema_version": "catalog.sync.v1", "run_id": run_id, "status": "completed", "result": result}), 200


@integrations_bp.get("/internal/catalog/reconcile/<run_id>")
def internal_catalog_reconcile_status(run_id):
    if not _catalog_event_required():
        return jsonify({"error": "Catalog event scope is not authorized."}), 403 if _connection_for_token() else 401
    run = database().catalog_reconciliation_runs.find_one({"run_id": run_id}, {"_id": 0})
    return (jsonify(json_value(run)), 200) if run else (jsonify({"error": "Reconciliation run not found."}), 404)


def _source_identity(payload):
    source_system = str(payload.get("source_system") or "rk-stock").strip()
    source_id = str(payload.get("source_id") or payload.get("rk_stock_product_id") or payload.get("rk_stock_collection_id") or "").strip()
    if source_system != "rk-stock" or not source_id or len(source_id) > 200:
        return None, None
    return source_system, source_id


@integrations_bp.post("/stock/catalog/collections/provision")
def provision_stock_collection():
    if not _catalog_write_required():
        return jsonify({"error": "Catalog write scope is not authorized."}), 403 if _connection_for_token() else 401
    payload = request.get_json(silent=True) or {}
    source_system, source_id = _source_identity(payload)
    name = str(payload.get("name") or "").strip()
    slug = str(payload.get("slug") or "").strip().lower()
    if not source_id or not name or not slug or len(name) > 200 or len(slug) > 160:
        return jsonify({"error": "source identity, name, and slug are required."}), 400
    db = database()
    existing = db.collections.find_one({"source_system": source_system, "source_id": source_id})
    if not existing:
        existing = db.collections.find_one({"slug": slug})
        if existing and existing.get("source_system") not in {None, source_system}:
            return jsonify({"error": "Collection slug belongs to an unrelated collection."}), 409
    now = datetime.now(timezone.utc)
    values = {"source_system": source_system, "source_id": source_id, "name": name, "slug": slug, "code": str(payload.get("code") or "").strip(), "description": str(payload.get("description") or "").strip(), "status": str(payload.get("status") or "active"), "isActive": payload.get("active", True) is not False, "updatedAt": now}
    if existing:
        db.collections.update_one({"_id": existing["_id"]}, {"$set": values})
        collection = db.collections.find_one({"_id": existing["_id"]}) or {**existing, **values}
        created = False
    else:
        values.update({"productRefs": [], "createdAt": now})
        result = db.collections.insert_one(values)
        collection = db.collections.find_one({"_id": result.inserted_id}) or {**values, "_id": result.inserted_id}
        created = True
    return jsonify({"status": "created" if created else "updated", "collection": {"id": str(collection["_id"]), "source_system": source_system, "source_id": source_id}}), 200 if not created else 201


@integrations_bp.post("/stock/catalog/products/provision")
def provision_stock_product():
    if not _catalog_write_required():
        return jsonify({"error": "Catalog write scope is not authorized."}), 403 if _connection_for_token() else 401
    payload = request.get_json(silent=True) or {}
    source_system, source_id = _source_identity(payload)
    required_text = ("product_code", "sku", "name")
    if not source_id or any(not isinstance(payload.get(key), str) or not payload[key].strip() for key in required_text):
        return jsonify({"error": "source identity, product_code, sku, and name are required."}), 400
    if "price" in payload and (isinstance(payload["price"], bool) or not isinstance(payload["price"], (int, float)) or payload["price"] < 0):
        return jsonify({"error": "price must be a non-negative number."}), 400
    incoming_media, media_error = _validated_stock_media(payload)
    if media_error:
        return jsonify({"error": media_error}), 400
    db = database()
    product = db.products.find_one({"source_system": source_system, "source_id": source_id})
    collection_ids = payload.get("collection_ids") or []
    if not isinstance(collection_ids, list) or any(not isinstance(value, str) or not ObjectId.is_valid(value) for value in collection_ids):
        return jsonify({"error": "collection_ids must contain RK-WEB collection IDs."}), 400
    if any(not db.collections.find_one({"_id": ObjectId(value)}) for value in collection_ids):
        return jsonify({"error": "One or more RK-WEB collections do not exist."}), 400
    now = datetime.now(timezone.utc)
    current_media = product.get("media") if product and isinstance(product.get("media"), list) else []
    existing_owned = product.get("rkStockMedia") if product and isinstance(product.get("rkStockMedia"), list) else []
    owned_urls = {str(item.get("url") or item.get("permalink")) for item in existing_owned if isinstance(item, dict)}
    preserved = [item for item in current_media if isinstance(item, str) and item not in owned_urls]
    combined = preserved + [item["url"] for item in incoming_media]
    values = {"source_system": source_system, "source_id": source_id, "product_code": payload["product_code"].strip(), "sku": payload["sku"].strip(), "name": payload["name"].strip(), "description": str(payload.get("description") or ""), "price": payload.get("price"), "currency": str(payload.get("currency") or "INR"), "taxInclusive": payload.get("tax_inclusive") is True, "isActive": payload.get("active", True) is not False, "status": str(payload.get("status") or "active"), "media": combined, "rkStockMedia": incoming_media, "updatedAt": now}
    if product:
        db.products.update_one({"_id": product["_id"]}, {"$set": values})
        product_id = product["_id"]
        created = False
    else:
        values["createdAt"] = now
        result = db.products.insert_one(values)
        product_id = result.inserted_id
        created = True
    for collection in db.collections.find({}):
        refs = [ref for ref in collection.get("productRefs") or [] if not isinstance(ref, dict) or str(ref.get("productId")) != str(product_id)]
        if str(collection.get("_id")) in collection_ids:
            refs.append({"productId": str(product_id), "source": "rk-stock"})
        if refs != list(collection.get("productRefs") or []):
            db.collections.update_one({"_id": collection["_id"]}, {"$set": {"productRefs": refs, "updatedAt": now}})
    return jsonify({"status": "created" if created else "updated", "product": {"id": str(product_id), "source_system": source_system, "source_id": source_id, "product_code": values["product_code"], "sku": values["sku"]}}), 200 if not created else 201


def _configured_scopes():
    scopes = ["connection:status"]
    if current_app.config.get("STOCK_INTEGRATION_CATALOG_WRITE_ENABLED"):
        scopes.extend(["catalog:write", "catalog:events:write", "catalog:snapshot:read", "catalog:reconcile"])
    return scopes


def _text(payload, key, maximum, *, required=False):
    value = payload.get(key)
    if value is None and not required:
        return None, None
    if not isinstance(value, str):
        return None, f"{key} must be text."
    value = value.strip()
    if (required and not value) or len(value) > maximum:
        return None, f"{key} is invalid."
    return value, None


def _validated_stock_media(payload):
    media = payload.get("media", [])
    if not isinstance(media, list) or len(media) > 24:
        return None, "media must contain at most 24 items."
    approved_host = current_app.config.get("STOCK_INTEGRATION_CLOUDINARY_HOST", "res.cloudinary.com")
    normalized = {}
    for index, item in enumerate(media):
        if not isinstance(item, dict) or item.get("source") != "rk-stock":
            return None, "Remotely managed media must have source rk-stock."
        provider = str(item.get("provider") or "cloudinary").strip().lower()
        media_type = str(item.get("type") or "image").strip().lower()
        url = str(item.get("permalink") or item.get("secure_url") or item.get("url") or "").strip()
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.fragment:
            return None, "Media URLs must use an approved HTTPS URL."
        if provider == "zoho_workdrive":
            if not parsed.netloc or media_type != "image":
                return None, "WorkDrive media requires a valid image permalink."
            public_id = str(item.get("source_id") or item.get("id") or url).strip()
        else:
            if parsed.hostname != approved_host:
                return None, "Cloudinary media must use the approved HTTPS host."
            public_id = str(item.get("public_id") or "").strip()
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./-]{0,254}", public_id) or ".." in public_id:
                return None, "Every rk-stock Cloudinary item requires a valid public_id."
        position = item.get("position", index)
        if isinstance(position, bool) or not isinstance(position, int) or position < 0:
            return None, "Media position must be a non-negative integer."
        description = item.get("description", "")
        if not isinstance(description, str) or len(description) > 500:
            return None, "Media description is invalid."
        if public_id in normalized:
            return None, "Duplicate media references are not allowed."
        normalized[public_id] = {
            "url": url, "secure_url": url, "public_id": public_id,
            "permalink": url, "provider": provider, "type": media_type,
            "source": "rk-stock", "source_id": str(item.get("source_id") or item.get("id") or public_id), "position": position,
            "is_primary": item.get("is_primary") is True,
            "is_main": item.get("is_primary") is True,
            "description": description.strip(),
        }
    return sorted(normalized.values(), key=lambda item: (item["position"], item["public_id"])), None


def _variant_catalog_view(variant):
    size_inventory = variant.get("sizeInventory") if isinstance(variant.get("sizeInventory"), list) else []
    sizes = [str(item.get("size")).strip() for item in size_inventory if isinstance(item, dict) and item.get("size")]
    return json_value({
        "id": variant.get("id"),
        "sku": variant.get("sku"),
        "colour": variant.get("colour") or variant.get("color"),
        "status": variant.get("status"),
        "price": variant.get("price"),
        "currency": variant.get("currency") or "INR",
        "images": variant.get("images") if isinstance(variant.get("images"), list) else [],
        "sizes": sizes,
    })


def _product_catalog_view(product, collection_map):
    variants = [_variant_catalog_view(item) for item in product.get("variants") or [] if isinstance(item, dict)]
    sizes = sorted({size for variant in variants for size in variant.get("sizes") or []})
    colours = [variant.get("colour") for variant in variants if variant.get("colour")]
    stock_media = [item for item in product.get("rkStockMedia") or [] if isinstance(item, dict)]
    image_urls = [item for item in product.get("media") or [] if isinstance(item, str) and item.strip()]
    media = stock_media or [{"url": url, "position": position, "is_primary": position == 0, "source": "rk-web"} for position, url in enumerate(image_urls)]
    return json_value({
        "id": product["_id"],
        "sku": product.get("sku"),
        "name": product.get("name"),
        "slug": product.get("slug"),
        "description": product.get("description"),
        "category": product.get("category"),
        "collection_ids": collection_map.get(str(product["_id"]), []),
        "price": product.get("price"),
        "currency": product.get("currency") or "INR",
        "tax_inclusive": bool(product.get("taxInclusive") or product.get("mrpIncludesGst")),
        "status": product.get("status", "draft"),
        "active": product.get("isActive") is not False and product.get("status") != "archived",
        "images": image_urls,
        "media": media,
        "source_system": product.get("source_system") or ("rk-stock" if stock_media else "rk-web"),
        "source_id": product.get("source_id") or product.get("rkStockProductId"),
        "primary_image": image_urls[0] if image_urls else None,
        "sizes": sizes,
        "colours": colours,
        "variants": variants,
        "created_at": product.get("createdAt"),
        "updated_at": product.get("updatedAt"),
    })


def _collection_catalog_view(collection):
    result = {
        "id": collection["_id"],
        "name": collection.get("name"),
        "slug": collection.get("slug"),
        "status": collection.get("status"),
        "active": collection.get("isActive") is not False and collection.get("status") != "archived",
        "created_at": collection.get("createdAt"),
        "updated_at": collection.get("updatedAt"),
    }
    if collection.get("code"):
        result["code"] = collection["code"]
    if isinstance(collection.get("lookbook"), dict):
        lookbook = collection["lookbook"]
        result["lookbook"] = {key: lookbook[key] for key in ("provider", "type", "embed_url", "permalink", "title") if isinstance(lookbook.get(key), str) and lookbook[key].strip()}
    return json_value(result)


@integrations_bp.post("/stock/connect")
def connect_stock():
    configured_secret = str(current_app.config.get("STOCK_INTEGRATION_BOOTSTRAP_SECRET") or "")
    supplied_secret = _bearer_token()
    payload = request.get_json(silent=True) or {}
    client_id = str(payload.get("client_id") or "").strip()
    expected_client = str(current_app.config.get("STOCK_INTEGRATION_CLIENT_ID") or "rk-stock-linesheets")
    if not configured_secret:
        return jsonify({"error": "Stock integration provisioning is not configured."}), 503
    if not supplied_secret or not hmac.compare_digest(supplied_secret, configured_secret) or client_id != expected_client:
        return jsonify({"error": "Service credential rejected."}), 401
    now = datetime.now(timezone.utc)
    token_hash = _token_hash(supplied_secret)
    existing = database().service_connections.find_one({"_id": f"stock_linesheets:{client_id}", "tokenHash": token_hash, "active": True, "revokedAt": {"$exists": False}})
    if existing:
        scopes = _configured_scopes()
        database().service_connections.update_one({"_id": existing["_id"]}, {"$set": {"lastSeenAt": now, "scopes": scopes}})
        return jsonify({"status": "connected", "connection_id": existing["connectionId"], "client_id": client_id, "scopes": scopes}), 200
    connection_id = secrets.token_hex(16)
    # One document per configured client makes credential rotation atomic: the
    # old token hash and the new hash can never both be active.
    scopes = _configured_scopes()
    database().service_connections.update_one(
        {"_id": f"stock_linesheets:{client_id}"},
        {"$set": {"connectionId": connection_id, "service": "stock_linesheets", "clientId": client_id, "tokenHash": token_hash, "scopes": scopes, "active": True, "createdAt": now, "lastSeenAt": now}, "$unset": {"revokedAt": "", "revokedReason": ""}},
        upsert=True,
    )
    return jsonify({"status": "connected", "connection_id": connection_id, "client_id": client_id, "issued_at": now.isoformat(), "scopes": scopes}), 201


@integrations_bp.get("/stock/status")
def stock_status():
    connection = _connection_for_token()
    if not connection:
        return jsonify({"error": "Service credential rejected."}), 401
    now = datetime.now(timezone.utc)
    return jsonify({"status": "connected", "service": "rk-web", "client_id": connection["clientId"], "connection_id": connection["connectionId"], "checked_at": now.isoformat(), "scopes": connection.get("scopes", [])}), 200


@integrations_bp.post("/stock/disconnect")
def disconnect_stock():
    connection = _connection_for_token()
    if not connection:
        return jsonify({"error": "Service credential rejected."}), 401
    now = datetime.now(timezone.utc)
    database().service_connections.update_one({"_id": connection["_id"], "active": True}, {"$set": {"active": False, "revokedAt": now, "revokedReason": "disconnected"}})
    return jsonify({"status": "disconnected", "revoked_at": now.isoformat()}), 200


@integrations_bp.get("/stock/catalog/products")
def stock_catalog_products():
    if not _service_required():
        return jsonify({"error": "Service credential rejected."}), 401
    db = database()
    collection_map = {}
    for collection in db.collections.find({}, {"productRefs.productId": 1}):
        for reference in collection.get("productRefs") or []:
            if isinstance(reference, dict) and reference.get("productId"):
                collection_map.setdefault(str(reference["productId"]), []).append(str(collection["_id"]))
    products = [_product_catalog_view(product, collection_map) for product in db.products.find({})]
    return jsonify({"items": products, "count": len(products)}), 200


@integrations_bp.get("/stock/catalog/categories")
def stock_catalog_categories():
    if not _service_required():
        return jsonify({"error": "Service credential rejected."}), 401
    names = sorted({str(value).strip() for value in database().products.distinct("category") if str(value).strip()}, key=str.casefold)
    items = [{"id": f"category:{'-'.join(name.casefold().split())}", "name": name, "slug": "-".join(name.casefold().split())} for name in names]
    return jsonify({"items": items, "count": len(items)}), 200


@integrations_bp.post("/stock/catalog/categories/provision")
def provision_stock_category():
    if not _catalog_write_required():
        return jsonify({"error": "Catalog write scope is not authorized."}), 403 if _connection_for_token() else 401
    payload = request.get_json(silent=True) or {}
    source_system, source_id = _source_identity(payload)
    name = str(payload.get("name") or "").strip()
    slug = str(payload.get("slug") or "").strip().lower()
    if not source_id or not name or not slug or len(name) > 200 or len(slug) > 160:
        return jsonify({"error": "source identity, name, and slug are required."}), 400
    db = database()
    setting = db.settings.find_one({"_id": "global"}) or {}
    names = list(setting.get("categories") or [])
    metadata = [item for item in list(setting.get("catalog_source_categories") or []) if item.get("source_id") != source_id]
    existing = next((value for value in names if str(value).casefold() == name.casefold()), None)
    if existing is None:
        names.append(name)
    elif existing != name:
        names[names.index(existing)] = name
    metadata.append({"id": f"category:{slug}", "name": name, "slug": slug, "source_system": source_system, "source_id": source_id, "active": payload.get("active", True) is not False})
    db.settings.update_one({"_id": "global"}, {"$set": {"categories": names, "catalog_source_categories": metadata, "updated_at": datetime.now(timezone.utc)}}, upsert=True)
    return jsonify({"status": "updated", "category": {"source_system": source_system, "source_id": source_id, "name": name, "slug": slug}}), 200


@integrations_bp.get("/stock/catalog/collections")
def stock_catalog_collections():
    if not _service_required():
        return jsonify({"error": "Service credential rejected."}), 401
    items = [_collection_catalog_view(collection) for collection in database().collections.find({})]
    return jsonify({"items": items, "count": len(items)}), 200


@integrations_bp.put("/stock/catalog/products/<product_id>")
def stock_catalog_product_write(product_id):
    connection = _catalog_write_required()
    if not connection:
        return jsonify({"error": "Catalog write scope is not authorized."}), 403 if _connection_for_token() else 401
    payload = request.get_json(silent=True) or {}
    if str(payload.get("rk_web_product_id") or product_id) != str(product_id):
        return jsonify({"error": "Product identity does not match the route."}), 400
    product = database().products.find_one({"_id": ObjectId(product_id)}) if ObjectId.is_valid(product_id) else None
    if not product:
        return jsonify({"error": "Product not found."}), 404
    updates = {}
    for key, maximum, required in (("sku", 100, True), ("name", 200, True), ("product_code", 100, False), ("colour", 100, False), ("category", 100, False), ("description", 5000, False), ("currency", 3, False), ("source_system", 40, False), ("source_id", 200, False)):
        value, error = _text(payload, key, maximum, required=required)
        if error:
            return jsonify({"error": error}), 400
        if value is not None:
            updates[key] = value
    if "sku" in updates:
        updates["sku"] = updates["sku"].upper()
        conflict = database().products.find_one({"sku": updates["sku"], "_id": {"$ne": product["_id"]}})
        if conflict:
            return jsonify({"error": "SKU already exists."}), 409
    if "price" in payload:
        if isinstance(payload["price"], bool) or not isinstance(payload["price"], (int, float)) or payload["price"] < 0:
            return jsonify({"error": "price must be a non-negative number."}), 400
        updates["price"] = payload["price"]
    if "tax_inclusive" in payload:
        if not isinstance(payload["tax_inclusive"], bool):
            return jsonify({"error": "tax_inclusive must be boolean."}), 400
        updates["tax_inclusive"] = payload["tax_inclusive"]
    if "active" in payload:
        updates["active"] = payload["active"]
    if "status" in payload:
        updates["status"] = payload["status"]
    if "active" in updates and not isinstance(updates["active"], bool):
        return jsonify({"error": "active must be boolean."}), 400
    if "status" in updates and updates["status"] not in {"active", "inactive", "archived", "draft"}:
        return jsonify({"error": "Invalid product status."}), 400
    if "active" in updates:
        updates["isActive"] = updates.pop("active")
    if "status" in updates:
        updates["status"] = updates["status"]

    incoming_media, media_error = _validated_stock_media(payload)
    if media_error:
        return jsonify({"error": media_error}), 400
    current_media = product.get("media") if isinstance(product.get("media"), list) else []
    existing_owned = product.get("rkStockMedia") if isinstance(product.get("rkStockMedia"), list) else []
    owned_urls = {str(item.get("url") or item.get("secure_url")) for item in existing_owned if isinstance(item, dict)}
    preserved = [
        {"url": item, "source": "rk-web"}
        for item in current_media
        if isinstance(item, str) and item not in owned_urls
    ]
    requested_primary = next((item for item in incoming_media if item["is_primary"]), None)
    if sum(item["is_primary"] for item in incoming_media) > 1:
        return jsonify({"error": "Only one rk-stock media item may be primary."}), 400
    combined = preserved + incoming_media
    primary = requested_primary or next((item for item in preserved if isinstance(item, dict) and (item.get("is_primary") or item.get("is_main"))), combined[0] if combined else None)
    if primary:
        combined = [primary] + [item for item in combined if item is not primary]
    for position, item in enumerate(combined):
        item["position"] = position
        item["is_primary"] = item is primary
        item["is_main"] = item is primary
    updates["media"] = [item["url"] for item in combined]
    updates["rkStockMedia"] = incoming_media
    collection_ids = payload.get("collection_ids", [])
    if not isinstance(collection_ids, list) or any(not isinstance(value, str) or not ObjectId.is_valid(value) for value in collection_ids):
        return jsonify({"error": "collection_ids must contain valid collection IDs."}), 400
    if len(collection_ids) != len(set(collection_ids)):
        return jsonify({"error": "Duplicate collection references are not allowed."}), 400
    collections = list(database().collections.find({}))
    existing_ids = {str(collection["_id"]) for collection in collections}
    if set(collection_ids) - existing_ids:
        return jsonify({"error": "One or more collections do not exist."}), 400
    desired = set(collection_ids)
    updates["updatedAt"] = datetime.now(timezone.utc)
    product_snapshot = {key: product.get(key) for key in updates}
    collection_snapshots = {collection["_id"]: list(collection.get("productRefs") or []) for collection in collections}
    try:
        database().products.update_one({"_id": product["_id"]}, {"$set": updates})
        for collection in collections:
            references = list(collection.get("productRefs") or [])
            belongs = str(collection.get("_id")) in desired
            kept = [reference for reference in references if not isinstance(reference, dict) or str(reference.get("productId")) != str(product["_id"])]
            if belongs:
                kept.append({"productId": str(product["_id"]), "source": "rk-stock"})
            if kept != references:
                database().collections.update_one({"_id": collection["_id"]}, {"$set": {"productRefs": kept, "updatedAt": datetime.now(timezone.utc)}})
    except Exception:
        current_app.logger.exception("Catalog write failed; restoring the previous product and collection state")
        database().products.update_one({"_id": product["_id"]}, {"$set": product_snapshot})
        for collection_id, references in collection_snapshots.items():
            database().collections.update_one({"_id": collection_id}, {"$set": {"productRefs": references}})
        return jsonify({"error": "Catalog update failed and was rolled back."}), 500
    return jsonify({"status": "synced", "product_id": str(product["_id"]), "media_count": len(combined), "scopes": connection.get("scopes", [])}), 200
