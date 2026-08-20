from datetime import datetime, timedelta, timezone
import re
import secrets

from bcrypt import gensalt, hashpw
from bson import ObjectId
from flask import Blueprint, jsonify, request

from ...rbac import ROLES, STAFF_PERMISSIONS, current_user, database, effective_permissions, requireAdmin
from ...dashboard_metrics import build_dashboard
from ...order_fulfillment import migrate_legacy_orders
from ...time_utils import json_value as serialize_json_value


def _password_hash(password: str) -> str:
    return hashpw(password.encode(), gensalt()).decode()

admin_bp = Blueprint("admin", __name__)
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

RESOURCE_COLLECTIONS = {
    "products": "products",
    "inventory": "products",
    "orders": "orders",
    "quotes": "quotes",
    "collections": "collections",
    "customers": "users",
    "marketing": "marketing_campaigns",
}


def _ensure_dashboard_indexes(db) -> None:
    global _dashboard_indexes_ready
    if _dashboard_indexes_ready:
        return
    db.analytics_events.create_index([("event", 1), ("createdAt", -1)])
    db.analytics_events.create_index([("visitorId", 1), ("createdAt", -1)])
    db.orders.create_index([("createdAt", -1), ("status", 1)])
    db.users.create_index([("createdAt", -1), ("role", 1)])
    db.products.create_index("stock")
    db.reviews.create_index("createdAt")
    retention = _integer(_settings(db).get("analyticsRetentionDays"), 365)
    db.analytics_events.delete_many({"createdAt": {"$lt": datetime.now(timezone.utc) - timedelta(days=retention)}})
    _dashboard_indexes_ready = True


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
    }


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


@admin_bp.get("/users")
@requireAdmin
def list_users():
    users = database().users.find({"role": {"$in": ["staff", "admin"]}}).sort("createdAt", -1)
    return jsonify({"users": [_user_view(user) for user in users]}), 200


@admin_bp.get("/dashboard")
@requireAdmin
def dashboard_metrics():
    db = database()
    migrate_legacy_orders(db)
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
    return jsonify({"user": _user_view(users.find_one({"_id": target["_id"]}))}), 200


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

    users.update_one({"_id": target["_id"]}, {"$set": {"passwordHash": _password_hash(password), "updatedAt": datetime.now(timezone.utc)}})
    return jsonify({"message": "Password updated successfully."}), 200
