import hashlib
import hmac
import secrets
from datetime import datetime, timezone

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
    return json_value({
        "id": product["_id"],
        "sku": product.get("sku"),
        "name": product.get("name"),
        "slug": product.get("slug"),
        "description": product.get("description"),
        "category": product.get("category"),
        "collection_ids": collection_map.get(product["_id"], []),
        "price": product.get("price"),
        "currency": product.get("currency") or "INR",
        "tax_inclusive": bool(product.get("taxInclusive") or product.get("mrpIncludesGst")),
        "status": product.get("status", "draft"),
        "active": product.get("isActive") is not False and product.get("status") != "archived",
        "images": product.get("media") if isinstance(product.get("media"), list) else [],
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
        database().service_connections.update_one({"_id": existing["_id"]}, {"$set": {"lastSeenAt": now}})
        return jsonify({"status": "connected", "connection_id": existing["connectionId"], "client_id": client_id, "scopes": existing.get("scopes", [])}), 200
    connection_id = secrets.token_hex(16)
    # One document per configured client makes credential rotation atomic: the
    # old token hash and the new hash can never both be active.
    database().service_connections.update_one(
        {"_id": f"stock_linesheets:{client_id}"},
        {"$set": {"connectionId": connection_id, "service": "stock_linesheets", "clientId": client_id, "tokenHash": token_hash, "scopes": ["connection:status"], "active": True, "createdAt": now, "lastSeenAt": now}, "$unset": {"revokedAt": "", "revokedReason": ""}},
        upsert=True,
    )
    return jsonify({"status": "connected", "connection_id": connection_id, "client_id": client_id, "issued_at": now.isoformat(), "scopes": ["connection:status"]}), 201


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
                collection_map.setdefault(reference["productId"], []).append(str(collection["_id"]))
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
