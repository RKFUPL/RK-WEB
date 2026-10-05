import hashlib
import hmac
import secrets
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit
from bson import ObjectId

from flask import Blueprint, current_app, jsonify, request

from ...rbac import database
from ...time_utils import json_value


integrations_bp = Blueprint("integrations", __name__)


def _bearer_token():
    value = request.headers.get("Authorization", "")
    return value[7:] if value.startswith("Bearer ") else ""


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


def _configured_scopes():
    scopes = ["connection:status"]
    if current_app.config.get("STOCK_INTEGRATION_CATALOG_WRITE_ENABLED"):
        scopes.append("catalog:write")
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
        url = str(item.get("secure_url") or item.get("url") or "").strip()
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname != approved_host or parsed.username or parsed.password or parsed.fragment:
            return None, "Media URLs must use the approved HTTPS Cloudinary host."
        public_id = str(item.get("public_id") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./-]{0,254}", public_id) or ".." in public_id:
            return None, "Every rk-stock media item requires a valid public_id."
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
            "source": "rk-stock", "position": position,
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
    image_urls = [item for item in product.get("media") or [] if isinstance(item, str) and item.strip()]
    media = [{"url": url, "position": position, "is_primary": position == 0, "source": "rk-web"} for position, url in enumerate(image_urls)]
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
    for key, maximum, required in (("sku", 100, True), ("name", 200, True), ("product_code", 100, False), ("colour", 100, False), ("category", 100, False), ("description", 5000, False), ("currency", 3, False)):
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
