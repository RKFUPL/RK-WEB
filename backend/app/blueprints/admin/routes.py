from datetime import datetime, timedelta, timezone
import re
import secrets
from urllib.parse import urlparse

from bcrypt import gensalt, hashpw
from bson import ObjectId
from flask import Blueprint, jsonify, request
from pymongo.errors import OperationFailure

from ...rbac import ROLES, STAFF_PERMISSIONS, current_user, database, effective_permissions, requireAdmin
from ...dashboard_metrics import build_dashboard
from ...order_fulfillment import migrate_legacy_orders
from ...time_utils import json_value as serialize_json_value
from ...mail import SENDERS, safe_status, send_test_email, test_smtp_connection, validate_recipient
from ...credential_sync import next_credential_version, sync_event


def _password_hash(password: str) -> str:
    return hashpw(password.encode(), gensalt()).decode()

admin_bp = Blueprint("admin", __name__)
storefront_lookbooks_bp = Blueprint("storefront_lookbooks", __name__)


@admin_bp.get("/integrations/email")
@requireAdmin
def email_integration_status():
    stored = database().integrations.find_one({"_id": "zoho_mail"}) or {}
    return jsonify({"integration": safe_status(stored)}), 200


def _email_state(status: str, **values) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "provider": "zoho",
        "status": status,
        "mailbox": safe_status()["mailbox"],
        "smtp": safe_status()["smtp"],
        "senders": dict(SENDERS),
        "updated_at": now,
        **values,
    }


def _email_error(message: str, status_code: int = 400):
    values = _email_state("error", last_error=message, last_test_at=datetime.now(timezone.utc))
    database().integrations.update_one({"_id": "zoho_mail"}, {"$set": values}, upsert=True)
    return jsonify({"ok": False, "error": message, "integration": safe_status(values)}), status_code


def _safe_connection_error(error: RuntimeError) -> str:
    messages = {
        "Zoho Mail is not the selected mail provider",
        "Zoho Mail SMTP authentication failed",
        "Unable to reach the Zoho Mail SMTP server",
        "Zoho Mail SMTP protocol negotiation failed",
    }
    return str(error) if str(error) in messages else "Unable to connect to Zoho Mail. Check the local SMTP configuration."


def _safe_delivery_error(error: RuntimeError) -> str:
    messages = {
        "Zoho Mail SMTP authentication failed",
        "Unable to reach the Zoho Mail SMTP server",
        "SMTP sender address rejected",
        "SMTP recipient address rejected",
        "SMTP test message failed",
    }
    return str(error) if str(error) in messages else "Unable to send the test email through Zoho Mail."


@admin_bp.post("/integrations/email/test-connection")
@requireAdmin
def email_integration_test():
    try:
        result = test_smtp_connection()
        tested_at = result["testedAt"]
        values = _email_state("connected", verified_at=tested_at, last_test_at=tested_at, last_error=None)
        database().integrations.update_one({"_id": "zoho_mail"}, {"$set": values}, upsert=True)
        return jsonify({"ok": True, "integration": safe_status(values)}), 200
    except ValueError:
        return _email_error("Zoho Mail configuration is incomplete.")
    except RuntimeError as error:
        return _email_error(_safe_connection_error(error))


@admin_bp.post("/integrations/email/connect")
@requireAdmin
def email_integration_connect():
    try:
        result = test_smtp_connection()
        tested_at = result["testedAt"]
        values = _email_state("connected", connected_at=tested_at, verified_at=tested_at, last_test_at=tested_at, last_error=None)
        database().integrations.update_one({"_id": "zoho_mail"}, {"$set": values}, upsert=True)
        return jsonify({"ok": True, "integration": safe_status(values)}), 200
    except ValueError:
        return _email_error("Zoho Mail configuration is incomplete.")
    except RuntimeError as error:
        return _email_error(_safe_connection_error(error))


@admin_bp.post("/integrations/email/disconnect")
@requireAdmin
def email_integration_disconnect():
    values = _email_state("disconnected", connected_at=None, verified_at=None, last_error=None)
    database().integrations.update_one({"_id": "zoho_mail"}, {"$set": values}, upsert=True)
    return jsonify({"ok": True, "integration": safe_status(values)}), 200


@admin_bp.post("/integrations/email/test-email")
@admin_bp.post("/integrations/email/test-send")
@requireAdmin
def email_integration_test_email():
    payload = request.get_json(silent=True) or {}
    sender = str(payload.get("sender") or "").strip()
    try:
        recipient = validate_recipient(payload.get("recipient"))
        if sender not in SENDERS:
            raise ValueError("An approved sender identity is required.")
        send_test_email(recipient, sender)
    except ValueError as error:
        message = "An approved sender identity is required." if sender not in SENDERS else str(error)
        return jsonify({"ok": False, "error": message}), 400
    except RuntimeError as error:
        return jsonify({"ok": False, "error": _safe_delivery_error(error)}), 400
    return jsonify({"ok": True}), 200
_dashboard_indexes_ready = False

SETTINGS_DEFAULTS = {
    "storeName": "Rashi Kapoor",
    "supportEmail": "",
    "currency": "INR",
    "timezone": "Asia/Kolkata",
    "orderPrefix": "RK",
    "lowStockThreshold": 5,
    "analyticsRetentionDays": 365,
    "emailNotifications": True,
    "orderNotifications": True,
    "lowStockNotifications": True,
    "courierOptions": [],
}

LOOKBOOK_DEFAULTS = {
    "Anamika": "https://lookbook.rashikapoor.co.in/catalog/anamika",
    "Espiritu Libre": "https://lookbook.rashikapoor.co.in/catalog/espiritu-libre",
    "Sandook": "https://lookbook.rashikapoor.co.in/catalog/sandook?page=1",
    "Inaara": "https://lookbook.rashikapoor.co.in/catalog/inaara",
    "Hastakala": "https://lookbook.rashikapoor.co.in/catalog/hastakala",
}

RESOURCE_COLLECTIONS = {
    "products": "products",
    "inventory": "products",
    "orders": "orders",
    "quotes": "quotes",
    "collections": "collections",
    "customers": "users",
    "marketing": "marketing_campaigns",
}


def _index_key_pairs(keys) -> list[tuple[str, int]]:
    if isinstance(keys, str):
        return [(keys, 1)]
    return [(str(field), int(direction)) for field, direction in keys]


def _ensure_index(collection, keys, name: str) -> None:
    """Create an index unless an equivalent key pattern already exists.

    MongoDB rejects creating the same key pattern under a new name. Older
    deployments used generated names, so dashboard startup must reuse those
    indexes instead of failing every authenticated dashboard request.
    """
    expected_keys = _index_key_pairs(keys)
    for index in collection.list_indexes():
        if _index_key_pairs(list(index.get("key", {}).items())) == expected_keys:
            return

    try:
        collection.create_index(keys, name=name)
    except OperationFailure as error:
        # A concurrent process may have created the equivalent index after the
        # check above. Re-check only this known duplicate-index condition.
        if error.code != 85:
            raise
        for index in collection.list_indexes():
            if _index_key_pairs(list(index.get("key", {}).items())) == expected_keys:
                return
        raise


def _ensure_dashboard_indexes(db) -> None:
    global _dashboard_indexes_ready
    if _dashboard_indexes_ready:
        return
    _ensure_index(db.analytics_events, [("event", 1), ("createdAt", -1)], "admin_analytics_event_created")
    _ensure_index(db.analytics_events, [("visitorId", 1), ("createdAt", -1)], "admin_analytics_visitor_created")
    _ensure_index(db.analytics_events, [("event", 1), ("visitorId", 1), ("createdAt", -1)], "admin_analytics_event_visitor_created")
    _ensure_index(db.orders, [("createdAt", -1), ("status", 1)], "admin_orders_created_status")
    _ensure_index(db.orders, [("payment.status", 1), ("createdAt", -1)], "admin_orders_payment_created")
    _ensure_index(db.orders, [("fulfillment.status", 1), ("createdAt", -1)], "admin_orders_fulfillment_created")
    _ensure_index(db.users, [("createdAt", -1), ("role", 1)], "admin_users_created_role")
    _ensure_index(db.products, "stock", "admin_products_stock")
    _ensure_index(db.reviews, "createdAt", "admin_reviews_created")
    _dashboard_indexes_ready = True


def ensure_dashboard_indexes(db) -> None:
    """Prepare dashboard indexes during app startup, not the first page load."""
    _ensure_dashboard_indexes(db)
    migrate_legacy_orders(db)


def _user_view(user: dict) -> dict:
    return {
        "id": str(user["_id"]),
        "email": user.get("email"),
        "username": user.get("username"),
        "displayName": user.get("displayName"),
        "role": user.get("role", "customer"),
        "permissions": effective_permissions(user),
        "assignedStaffId": str(user["assignedStaffId"]) if user.get("assignedStaffId") else None,
        "phone": user.get("phone"),
        "isActive": user.get("isActive", True),
        "emailVerified": user.get("emailVerified", False),
        "createdAt": serialize_json_value(user.get("createdAt")),
        "updatedAt": serialize_json_value(user.get("updatedAt")),
        "lastLoginAt": serialize_json_value(user.get("lastLoginAt")),
    }


def _user_admin_audit(action: str, target: dict, **metadata) -> None:
    actor = current_user() or {}
    database().user_admin_logs.insert_one({
        "actorUserId": actor.get("_id"),
        "actorEmail": actor.get("email"),
        "action": action,
        "targetUserId": target.get("_id"),
        "targetEmail": target.get("email"),
        "metadata": metadata,
        "timestamp": datetime.now(timezone.utc),
    })


def _document_view(document: dict) -> dict:
    hidden = {"passwordHash", "otpHash", "otpExpiresAt", "otpAttempts"}
    result = {"id": str(document.get("_id"))}
    for key, value in document.items():
        if key == "_id" or key in hidden:
            continue
        result[key] = serialize_json_value(value)
    return result


def _settings(db) -> dict:
    stored = db.admin_settings.find_one({"_id": "store"}) or {}
    return {**SETTINGS_DEFAULTS, **{key: value for key, value in stored.items() if key not in {"_id", "updatedAt", "updatedBy"}}}


def _lookbooks(db) -> dict[str, str]:
    stored = db.admin_settings.find_one({"_id": "store"}) or {}
    saved = stored.get("lookbookUrls") if isinstance(stored.get("lookbookUrls"), dict) else {}
    return {name: str(saved.get(name) or default) for name, default in LOOKBOOK_DEFAULTS.items()}


def _valid_lookbook_url(value: object) -> bool:
    if value == "":
        return True
    parsed = urlparse(str(value).strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc) and not parsed.username and not parsed.password


def _number(value: object, default: float = 0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _integer(value: object, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


@admin_bp.route("/users", methods=["GET", "POST"])
@requireAdmin
def list_users():
    db = database()
    if request.method == "GET":
        users = db.users.find({}).sort("createdAt", -1)
        return jsonify({"users": [_user_view(user) for user in users]}), 200

    payload = request.get_json(silent=True) or {}
    first_name = str(payload.get("firstName") or payload.get("name") or "").strip()
    last_name = str(payload.get("lastName") or "").strip()
    username = str(payload.get("username") or "").strip()
    email = str(payload.get("email") or "").strip().lower()
    role = str(payload.get("role") or "staff").strip().lower()
    password = payload.get("password")
    active = payload.get("isActive", True)
    if not first_name or not username or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return jsonify({"error": "Name, username, and a valid email are required."}), 400
    if role not in ROLES:
        return jsonify({"error": "Role must be customer, staff, or admin."}), 400
    if not isinstance(password, str) or len(password) < 8:
        return jsonify({"error": "Temporary password must be at least 8 characters."}), 400
    if not isinstance(active, bool):
        return jsonify({"error": "isActive must be boolean."}), 400
    if db.users.find_one({"$or": [{"email": email}, {"username": {"$regex": f"^{re.escape(username)}$", "$options": "i"}}]}):
        return jsonify({"error": "A user with that email or username already exists."}), 409
    now = datetime.now(timezone.utc)
    document = {
        "firstName": first_name,
        "lastName": last_name,
        "displayName": " ".join(filter(None, (first_name, last_name))),
        "username": username,
        "email": email,
        "passwordHash": _password_hash(password),
        "role": role,
        "permissions": [],
        "isActive": active,
        "emailVerified": True,
        "mustChangePassword": True,
        "credentialVersion": 1,
        "createdAt": now,
        "updatedAt": now,
    }
    document["_id"] = db.users.insert_one(document).inserted_id
    sync_event(db, "USER_CREATED", document, password=password)
    _user_admin_audit("user_created", document, role=role, active=active)
    return jsonify({"user": _user_view(document)}), 201


@admin_bp.get("/dashboard")
@requireAdmin
def dashboard_metrics():
    db = database()
    _ensure_dashboard_indexes(db)
    current_visitor_id = str(request.headers.get("X-RK-Visitor-ID", "")).strip()[:128]
    viewer = current_user() or {}
    viewer_name = str(
        " ".join(filter(None, (viewer.get("firstName"), viewer.get("lastName"))))
        or viewer.get("displayName")
        or viewer.get("username")
        or "Admin"
    ).strip()
    dashboard = build_dashboard(
        db,
        request.args.get("period", "7d"),
        current_visitor_id=current_visitor_id,
    )
    # The authenticated dashboard browser is an internal live session. Keep it
    # visible without counting it as storefront customer traffic.
    dashboard["internalSession"] = {
        "name": viewer_name,
        "role": str(viewer.get("role") or "admin"),
        "online": True,
        "currentDevice": True,
    }
    return jsonify(dashboard), 200


@admin_bp.get("/resources/<resource>")
@requireAdmin
def list_resources(resource: str):
    collection_name = RESOURCE_COLLECTIONS.get(resource)
    if not collection_name:
        return jsonify({"error": "Unsupported admin resource."}), 404
    query = {"role": "customer"} if resource == "customers" else {}
    projection = {"passwordHash": 0, "otpHash": 0, "otpExpiresAt": 0, "otpAttempts": 0}
    documents = database()[collection_name].find(query, projection).sort("createdAt", -1).limit(100)
    return jsonify({"items": [_document_view(document) for document in documents]}), 200


@admin_bp.post("/quick-create/<kind>")
@requireAdmin
def quick_create(kind: str):
    payload = request.get_json(silent=True) or {}
    db = database()
    now = datetime.now(timezone.utc)
    actor = current_user()
    common = {"createdAt": now, "updatedAt": now, "createdBy": actor["_id"]}

    if kind == "product":
        name = str(payload.get("name") or "").strip()
        sku = str(payload.get("sku") or "").strip().upper()
        status = str(payload.get("status") or "draft").lower()
        if not name or not sku:
            return jsonify({"error": "Product name and SKU are required."}), 400
        if db.products.find_one({"sku": sku}):
            return jsonify({"error": "That SKU already exists."}), 409
        price = _number(payload.get("price"), -1)
        stock = _integer(payload.get("stock"), -1)
        if price < 0 or stock < 0 or status not in {"draft", "active", "archived"}:
            return jsonify({"error": "Price and stock must be zero or greater."}), 400
        # Inventory is operational data; it must not decide customer-facing
        # purchaseability. New products start explicitly ACTIVE/in stock.
        document = {**common, "name": name, "sku": sku, "price": price, "stock": stock, "lowStockThreshold": _integer(payload.get("lowStockThreshold"), _settings(db)["lowStockThreshold"]), "status": status, "availability": "in_stock", "currency": "INR", "category": "", "description": "", "media": [], "attributes": {}, "isActive": True}
        result = db.products.insert_one(document)
        resource = "products"
    elif kind == "order":
        customer_name = str(payload.get("customerName") or "").strip()
        email = str(payload.get("email") or "").strip().lower()
        total = _number(payload.get("total"), -1)
        status = str(payload.get("status") or "pending").lower()
        if not customer_name or "@" not in email or total < 0 or status not in {"pending", "confirmed", "processing", "fulfilled"}:
            return jsonify({"error": "Customer name, valid email, and order total are required."}), 400
        prefix = re.sub(r"[^A-Za-z0-9]", "", str(_settings(db)["orderPrefix"]))[:8] or "RK"
        order_number = str(payload.get("orderNumber") or "").strip().upper() or f"{prefix}-{now:%Y%m%d}-{secrets.token_hex(2).upper()}"
        if db.orders.find_one({"orderNumber": order_number}):
            return jsonify({"error": "That order number already exists."}), 409
        document = {**common, "orderNumber": order_number, "customerName": customer_name, "email": email, "total": total, "currency": "INR", "status": status, "items": []}
        result = db.orders.insert_one(document)
        resource = "orders"
    elif kind == "customer":
        full_name = str(payload.get("fullName") or "").strip()
        email = str(payload.get("email") or "").strip().lower()
        phone = str(payload.get("phone") or "").strip()
        if not full_name or "@" not in email or not re.fullmatch(r"\+?[0-9\s().-]{7,20}", phone):
            return jsonify({"error": "Full name, valid email, and phone number are required."}), 400
        if db.users.find_one({"email": email}):
            return jsonify({"error": "That email is already registered."}), 409
        parts = full_name.split(maxsplit=1)
        document = {**common, "email": email, "displayName": full_name, "firstName": parts[0], "lastName": parts[1] if len(parts) > 1 else "", "phone": phone, "role": "customer", "isActive": True, "emailVerified": False, "invitePending": True}
        result = db.users.insert_one(document)
        resource = "customers"
    elif kind == "collection":
        name = str(payload.get("name") or "").strip()
        slug = re.sub(r"[^a-z0-9]+", "-", str(payload.get("slug") or name).strip().lower()).strip("-")
        status = str(payload.get("status") or "draft").lower()
        if not name or not slug or status not in {"draft", "active", "archived"}:
            return jsonify({"error": "Collection name is required."}), 400
        if db.collections.find_one({"slug": slug}):
            return jsonify({"error": "That collection slug already exists."}), 409
        document = {**common, "name": name, "slug": slug, "status": status, "isActive": True}
        result = db.collections.insert_one(document)
        resource = "collections"
    elif kind == "campaign":
        name = str(payload.get("name") or "").strip()
        channel = str(payload.get("channel") or "email").strip().lower()
        status = str(payload.get("status") or "draft").lower()
        if not name or channel not in {"email", "social", "sms", "whatsapp"} or status not in {"draft", "scheduled", "active", "completed"}:
            return jsonify({"error": "Campaign name and a valid channel are required."}), 400
        document = {**common, "name": name, "channel": channel, "status": status}
        result = db.marketing_campaigns.insert_one(document)
        resource = "marketing"
    else:
        return jsonify({"error": "Unsupported quick-create action."}), 404

    document["_id"] = result.inserted_id
    return jsonify({"resource": resource, "item": _document_view(document)}), 201


@admin_bp.get("/settings")
@requireAdmin
def get_settings():
    return jsonify({"settings": _settings(database())}), 200


@storefront_lookbooks_bp.get("/lookbooks")
def get_public_lookbooks():
    return jsonify({"lookbooks": _lookbooks(database())}), 200


@admin_bp.get("/lookbooks")
@requireAdmin
def get_lookbooks():
    return jsonify({"lookbooks": _lookbooks(database())}), 200


@admin_bp.put("/lookbooks")
@requireAdmin
def update_lookbooks():
    payload = request.get_json(silent=True) or {}
    submitted = payload.get("lookbooks")
    if not isinstance(submitted, dict) or set(submitted) != set(LOOKBOOK_DEFAULTS):
        return jsonify({"error": "All active lookbook names are required, and unknown names are not allowed."}), 400
    urls: dict[str, str] = {}
    for name in LOOKBOOK_DEFAULTS:
        value = str(submitted.get(name) or "").strip()
        if not _valid_lookbook_url(value):
            return jsonify({"error": f"{name} must be a valid HTTP or HTTPS URL, or blank to disable it."}), 400
        urls[name] = value
    nonblank = [url for url in urls.values() if url]
    if len(nonblank) != len(set(nonblank)):
        return jsonify({"error": "Each enabled lookbook must have a unique destination URL."}), 400
    actor = current_user()
    database().admin_settings.update_one({"_id": "store"}, {"$set": {"lookbookUrls": urls, "updatedAt": datetime.now(timezone.utc), "updatedBy": actor["_id"]}}, upsert=True)
    return jsonify({"lookbooks": _lookbooks(database())}), 200


@admin_bp.put("/settings")
@requireAdmin
def update_settings():
    payload = request.get_json(silent=True) or {}
    store_name = str(payload.get("storeName") or "").strip()
    support_email = str(payload.get("supportEmail") or "").strip().lower()
    currency = str(payload.get("currency") or "INR").upper()
    timezone_name = str(payload.get("timezone") or "Asia/Kolkata").strip()
    prefix = re.sub(r"[^A-Za-z0-9]", "", str(payload.get("orderPrefix") or "RK"))[:8].upper()
    low_stock = _integer(payload.get("lowStockThreshold"), -1)
    retention = _integer(payload.get("analyticsRetentionDays"), -1)
    courier_options = payload.get("courierOptions", [])
    if not store_name or (support_email and "@" not in support_email):
        return jsonify({"error": "Store name is required, and support email must be valid when provided."}), 400
    if currency not in {"INR", "USD", "EUR", "GBP"} or timezone_name not in {"Asia/Kolkata", "UTC", "Europe/London", "America/New_York"} or not prefix or low_stock < 0 or retention not in {30, 90, 180, 365, 730}:
        return jsonify({"error": "One or more settings values are invalid."}), 400
    if not isinstance(courier_options, list) or len(courier_options) > 30:
        return jsonify({"error": "Courier options must be a list of up to 30 names."}), 400
    couriers = []
    for option in courier_options:
        courier = str(option or "").strip()[:100]
        if courier and courier.lower() not in {existing.lower() for existing in couriers}:
            couriers.append(courier)
    settings = {
        "storeName": store_name,
        "supportEmail": support_email,
        "currency": currency,
        "timezone": timezone_name,
        "orderPrefix": prefix,
        "lowStockThreshold": low_stock,
        "analyticsRetentionDays": retention,
        "emailNotifications": bool(payload.get("emailNotifications")),
        "orderNotifications": bool(payload.get("orderNotifications")),
        "lowStockNotifications": bool(payload.get("lowStockNotifications")),
        "courierOptions": couriers,
    }
    actor = current_user()
    database().admin_settings.update_one({"_id": "store"}, {"$set": {**settings, "updatedAt": datetime.now(timezone.utc), "updatedBy": actor["_id"]}}, upsert=True)
    database().analytics_events.delete_many({"createdAt": {"$lt": datetime.now(timezone.utc) - timedelta(days=retention)}})
    return jsonify({"settings": settings}), 200


@admin_bp.patch("/users/<user_id>/role")
@requireAdmin
def change_role(user_id: str):
    if not ObjectId.is_valid(user_id):
        return jsonify({"error": "Invalid user id."}), 400
    payload = request.get_json(silent=True) or {}
    new_role = payload.get("role")
    if new_role not in ROLES:
        return jsonify({"error": "Role must be customer, staff, or admin."}), 400

    users = database().users
    target_id = ObjectId(user_id)
    target = users.find_one({"_id": target_id})
    if not target:
        return jsonify({"error": "User not found."}), 404
    previous_role = target.get("role", "customer")
    if previous_role == new_role:
        return jsonify({"user": _user_view(target)}), 200
    if previous_role == "admin" and new_role != "admin" and users.count_documents({"role": "admin", "isActive": {"$ne": False}}) <= 1:
        return jsonify({"error": "The last remaining admin cannot be demoted."}), 409

    now = datetime.now(timezone.utc)
    users.update_one({"_id": target_id}, {"$set": {"role": new_role, "updatedAt": now}})
    actor = current_user()
    database().role_change_logs.insert_one({
        "changedBy": actor["_id"],
        "user": target_id,
        "previousRole": previous_role,
        "newRole": new_role,
        "timestamp": now,
    })
    target = users.find_one({"_id": target_id})
    sync_event(database(), "ROLE_CHANGED", target, version=target.get("credentialVersion", 0), metadata={"previous_role": previous_role}, force=True)
    _user_admin_audit("user_role_changed", target, previousRole=previous_role, newRole=new_role)
    return jsonify({"user": _user_view(target)}), 200


@admin_bp.patch("/users/<user_id>/permissions")
@requireAdmin
def change_permissions(user_id: str):
    if not ObjectId.is_valid(user_id):
        return jsonify({"error": "Invalid user id."}), 400
    payload = request.get_json(silent=True) or {}
    permissions = payload.get("permissions")
    if not isinstance(permissions, list) or any(permission not in STAFF_PERMISSIONS for permission in permissions):
        return jsonify({"error": "Permissions must be a valid capability list."}), 400
    target_id = ObjectId(user_id)
    users = database().users
    target = users.find_one({"_id": target_id})
    if not target or target.get("role") != "staff":
        return jsonify({"error": "Permissions can only be assigned to staff users."}), 400
    canonical = [permission for permission in STAFF_PERMISSIONS if permission in permissions]
    now = datetime.now(timezone.utc)
    actor = current_user()
    users.update_one({"_id": target_id}, {"$set": {"permissions": canonical, "updatedAt": now}})
    database().permission_change_logs.insert_one({"changedBy": actor["_id"], "user": target_id, "permissions": canonical, "timestamp": now})
    return jsonify({"user": _user_view(users.find_one({"_id": target_id}))}), 200


@admin_bp.patch("/customers/<customer_id>/assignment")
@requireAdmin
def assign_customer(customer_id: str):
    if not ObjectId.is_valid(customer_id):
        return jsonify({"error": "Invalid customer id."}), 400
    payload = request.get_json(silent=True) or {}
    staff_id = payload.get("staffId")
    users = database().users
    customer_object_id = ObjectId(customer_id)
    customer = users.find_one({"_id": customer_object_id, "role": "customer"})
    if not customer:
        return jsonify({"error": "Customer not found."}), 404
    assigned_staff_id = None
    if staff_id:
        if not ObjectId.is_valid(str(staff_id)):
            return jsonify({"error": "Invalid staff id."}), 400
        assigned_staff_id = ObjectId(str(staff_id))
        staff = users.find_one({"_id": assigned_staff_id, "role": "staff", "isActive": {"$ne": False}})
        if not staff:
            return jsonify({"error": "Choose an active staff member."}), 400
    now = datetime.now(timezone.utc)
    actor = current_user()
    update = {"$set": {"updatedAt": now}}
    if assigned_staff_id:
        update["$set"]["assignedStaffId"] = assigned_staff_id
    else:
        update["$unset"] = {"assignedStaffId": ""}
    users.update_one({"_id": customer_object_id}, update)
    database().customer_assignment_logs.insert_one({"changedBy": actor["_id"], "customer": customer_object_id, "assignedStaffId": assigned_staff_id, "timestamp": now})
    return jsonify({"user": _user_view(users.find_one({"_id": customer_object_id}))}), 200


@admin_bp.patch("/users/<user_id>/status")
@requireAdmin
def change_status(user_id: str):
    if not ObjectId.is_valid(user_id):
        return jsonify({"error": "Invalid user id."}), 400
    active = (request.get_json(silent=True) or {}).get("isActive")
    if not isinstance(active, bool):
        return jsonify({"error": "isActive must be boolean."}), 400
    users = database().users
    target = users.find_one({"_id": ObjectId(user_id)})
    if not target:
        return jsonify({"error": "User not found."}), 404
    if target.get("role", "customer") == "admin" and not active and users.count_documents({"role": "admin", "isActive": {"$ne": False}}) <= 1:
        return jsonify({"error": "The last remaining admin cannot be deactivated."}), 409
    users.update_one({"_id": target["_id"]}, {"$set": {"isActive": active, "updatedAt": datetime.now(timezone.utc)}})
    if not active:
        database().auth_sessions.update_many({"userId": target["_id"], "revokedAt": None}, {"$set": {"revokedAt": datetime.now(timezone.utc)}})
    updated = users.find_one({"_id": target["_id"]})
    sync_event(database(), "STATUS_CHANGED", updated, version=updated.get("credentialVersion", 0), force=target.get("role") in {"admin", "staff"})
    _user_admin_audit("user_activated" if active else "user_deactivated", updated)
    return jsonify({"user": _user_view(updated)}), 200


@admin_bp.patch("/users/<user_id>/password")
@requireAdmin
def change_password(user_id: str):
    if not ObjectId.is_valid(user_id):
        return jsonify({"error": "Invalid user id."}), 400
    password = (request.get_json(silent=True) or {}).get("password")
    if not isinstance(password, str) or len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters."}), 400

    users = database().users
    target = users.find_one({"_id": ObjectId(user_id)})
    if not target:
        return jsonify({"error": "User not found."}), 404
    if target.get("role", "customer") not in {"staff", "admin"}:
        return jsonify({"error": "Only staff and admin passwords can be updated here."}), 400

    now = datetime.now(timezone.utc)
    version = next_credential_version(target)
    users.update_one({"_id": target["_id"]}, {"$set": {"passwordHash": _password_hash(password), "mustChangePassword": True, "credentialVersion": version, "updatedAt": now}})
    database().auth_sessions.update_many({"userId": target["_id"], "revokedAt": None}, {"$set": {"revokedAt": now}})
    _user_admin_audit("admin_password_reset", target)
    target["credentialVersion"] = version
    sync_event(database(), "PASSWORD_RESET", target, password=password, version=version)
    return jsonify({"message": "Password updated successfully."}), 200
