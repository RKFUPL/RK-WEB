from datetime import datetime, timezone
import re
import secrets

from bson import ObjectId
from flask import Blueprint, jsonify, request

from ...rbac import current_user, database, effective_permissions, requireStaff

staff_bp = Blueprint("staff", __name__)

RESOURCE_PERMISSIONS = {
    "products": "products:manage",
    "inventory": "inventory:manage",
    "quotes": "quotes:manage",
    "orders": "orders:manage",
    "customers": "customers:manage",
}
RESOURCE_COLLECTIONS = {
    "products": "products",
    "inventory": "products",
    "quotes": "quotes",
    "orders": "orders",
    "customers": "users",
}
PRODUCT_STATUSES = {"draft", "active", "archived"}
ORDER_STATUSES = {"pending", "confirmed", "processing", "fulfilled", "cancelled"}
QUOTE_STATUSES = {"draft", "sent", "accepted", "rejected", "converted"}


def _number(value: object, default: float = -1) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _integer(value: object, default: int = -1) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _json_value(value):
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, list):
        return [_json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    return value


def _document_view(document: dict) -> dict:
    hidden = {"passwordHash", "otpHash", "otpExpiresAt", "otpAttempts"}
    return {
        ("id" if key == "_id" else key): _json_value(value)
        for key, value in document.items()
        if key not in hidden
    }


def _permission_error(resource: str):
    permission = RESOURCE_PERMISSIONS.get(resource)
    if not permission:
        return jsonify({"error": "Unsupported staff resource."}), 404
    if permission not in effective_permissions(current_user()):
        return jsonify({"error": "You do not have permission to perform this action."}), 403
    return None


def _valid_id(value: str):
    return ObjectId(value) if ObjectId.is_valid(value) else None


def _customer_scope(user: dict) -> dict:
    if user.get("role") == "admin":
        return {"role": "customer"}
    return {"role": "customer", "assignedStaffId": user["_id"]}


def _customer_access(customer_id: ObjectId, user: dict) -> dict:
    return {"_id": customer_id, **_customer_scope(user)}


@staff_bp.get("/dashboard")
@requireStaff
def dashboard():
    user = current_user()
    permissions = effective_permissions(user)
    db = database()
    counts = {}
    if "products:manage" in permissions:
        counts["products"] = db.products.count_documents({})
    if "inventory:manage" in permissions:
        counts["lowStock"] = db.products.count_documents({"stock": {"$lte": 5}})
    if "quotes:manage" in permissions:
        counts["quotes"] = db.quotes.count_documents({"status": {"$ne": "converted"}})
    if "orders:manage" in permissions:
        counts["orders"] = db.orders.count_documents({"status": {"$nin": ["fulfilled", "cancelled"]}})
    if "customers:manage" in permissions:
        counts["customers"] = db.users.count_documents(_customer_scope(user))
    return jsonify({"dashboard": "staff", "permissions": permissions, "counts": counts}), 200


@staff_bp.get("/resources/<resource>")
@requireStaff
def list_resources(resource: str):
    denied = _permission_error(resource)
    if denied:
        return denied
    db = database()
    query = _customer_scope(current_user()) if resource == "customers" else {}
    search = str(request.args.get("q") or "").strip()
    if search:
        escaped = re.escape(search[:80])
        fields = ["displayName", "email", "username"] if resource == "customers" else ["name", "sku", "orderNumber", "quoteNumber", "customerName", "email"]
        query = {**query, "$or": [{field: {"$regex": escaped, "$options": "i"}} for field in fields]}
    projection = {"passwordHash": 0, "otpHash": 0, "otpExpiresAt": 0, "otpAttempts": 0}
    documents = database()[RESOURCE_COLLECTIONS[resource]].find(query, projection).sort("createdAt", -1).limit(200)
    return jsonify({"items": [_document_view(document) for document in documents]}), 200


@staff_bp.post("/resources/<resource>")
@requireStaff
def create_resource(resource: str):
    denied = _permission_error(resource)
    if denied:
        return denied
    payload = request.get_json(silent=True) or {}
    db = database()
    actor = current_user()
    now = datetime.now(timezone.utc)
    common = {"createdAt": now, "updatedAt": now, "createdBy": actor["_id"], "updatedBy": actor["_id"]}

    if resource == "products":
        name = str(payload.get("name") or "").strip()
        sku = str(payload.get("sku") or "").strip().upper()
        price = _number(payload.get("price"))
        stock = _integer(payload.get("stock"), 0)
        status = str(payload.get("status") or "draft").lower()
        if not name or not sku or price < 0 or stock < 0 or status not in PRODUCT_STATUSES:
            return jsonify({"error": "Product name, unique SKU, non-negative price and stock, and a valid status are required."}), 400
        if db.products.find_one({"sku": sku}):
            return jsonify({"error": "That SKU already exists."}), 409
        document = {**common, "name": name, "sku": sku, "price": price, "stock": stock, "status": status, "currency": "INR", "description": str(payload.get("description") or "").strip(), "media": [], "attributes": {}, "isActive": status != "archived"}
        collection = db.products
    elif resource == "orders":
        customer_name = str(payload.get("customerName") or "").strip()
        email = str(payload.get("email") or "").strip().lower()
        total = _number(payload.get("total"))
        status = str(payload.get("status") or "pending").lower()
        if not customer_name or "@" not in email or total < 0 or status not in ORDER_STATUSES:
            return jsonify({"error": "Customer name, valid email, non-negative total, and a valid status are required."}), 400
        order_number = str(payload.get("orderNumber") or "").strip().upper() or f"RK-{now:%Y%m%d}-{secrets.token_hex(2).upper()}"
        if db.orders.find_one({"orderNumber": order_number}):
            return jsonify({"error": "That order number already exists."}), 409
        document = {**common, "orderNumber": order_number, "customerName": customer_name, "email": email, "total": total, "currency": "INR", "status": status, "items": payload.get("items") if isinstance(payload.get("items"), list) else []}
        collection = db.orders
    elif resource == "quotes":
        customer_name = str(payload.get("customerName") or "").strip()
        email = str(payload.get("email") or "").strip().lower()
        total = _number(payload.get("total"))
        status = str(payload.get("status") or "draft").lower()
        if not customer_name or "@" not in email or total < 0 or status not in QUOTE_STATUSES - {"converted"}:
            return jsonify({"error": "Customer name, valid email, non-negative total, and a valid quote status are required."}), 400
        quote_number = str(payload.get("quoteNumber") or "").strip().upper() or f"Q-{now:%Y%m%d}-{secrets.token_hex(2).upper()}"
        if db.quotes.find_one({"quoteNumber": quote_number}):
            return jsonify({"error": "That quote number already exists."}), 409
        document = {**common, "quoteNumber": quote_number, "customerName": customer_name, "email": email, "total": total, "currency": "INR", "status": status, "items": payload.get("items") if isinstance(payload.get("items"), list) else [], "notes": str(payload.get("notes") or "").strip()}
        collection = db.quotes
    elif resource == "customers":
        display_name = str(payload.get("displayName") or payload.get("fullName") or "").strip()
        email = str(payload.get("email") or "").strip().lower()
        phone = str(payload.get("phone") or "").strip()
        if not display_name or "@" not in email or not re.fullmatch(r"\+?[0-9\s().-]{7,20}", phone):
            return jsonify({"error": "Customer name, valid email, and phone number are required."}), 400
        if db.users.find_one({"email": email}):
            return jsonify({"error": "That email is already registered."}), 409
        first_name, _, last_name = display_name.partition(" ")
        assigned_staff_id = actor["_id"] if actor.get("role") == "staff" else None
        document = {**common, "displayName": display_name, "firstName": first_name, "lastName": last_name, "email": email, "phone": phone, "role": "customer", "isActive": True, "emailVerified": False, "invitePending": True, "assignedStaffId": assigned_staff_id}
        collection = db.users
    else:
        return jsonify({"error": "Inventory records are adjusted from an existing product."}), 400

    result = collection.insert_one(document)
    document["_id"] = result.inserted_id
    return jsonify({"item": _document_view(document)}), 201


@staff_bp.patch("/resources/<resource>/<resource_id>")
@requireStaff
def update_resource(resource: str, resource_id: str):
    denied = _permission_error(resource)
    if denied:
        return denied
    object_id = _valid_id(resource_id)
    if not object_id:
        return jsonify({"error": "Invalid resource id."}), 400
    payload = request.get_json(silent=True) or {}
    db = database()
    actor = current_user()
    now = datetime.now(timezone.utc)
    collection = db[RESOURCE_COLLECTIONS[resource]]
    query = _customer_access(object_id, actor) if resource == "customers" else {"_id": object_id}
    current = collection.find_one(query)
    if not current:
        return jsonify({"error": "Resource not found."}), 404
    updates = {"updatedAt": now, "updatedBy": actor["_id"]}

    if resource == "products":
        for key in ("name", "description"):
            if key in payload:
                updates[key] = str(payload.get(key) or "").strip()
        if "sku" in payload:
            sku = str(payload.get("sku") or "").strip().upper()
            if not sku or db.products.find_one({"sku": sku, "_id": {"$ne": object_id}}):
                return jsonify({"error": "A unique SKU is required."}), 409
            updates["sku"] = sku
        if "price" in payload:
            price = _number(payload.get("price"))
            if price < 0:
                return jsonify({"error": "Price cannot be negative."}), 400
            updates["price"] = price
        if "status" in payload:
            status = str(payload.get("status") or "").lower()
            if status not in PRODUCT_STATUSES:
                return jsonify({"error": "Invalid product status."}), 400
            updates.update({"status": status, "isActive": status != "archived"})
        if "media" in payload:
            media = payload.get("media")
            if not isinstance(media, list) or len(media) > 12 or any(not isinstance(item, str) or len(item) > 2048 for item in media):
                return jsonify({"error": "Product media must contain up to 12 valid URLs."}), 400
            updates["media"] = media
        if "attributes" in payload:
            if not isinstance(payload.get("attributes"), dict):
                return jsonify({"error": "Product attributes must be an object."}), 400
            updates["attributes"] = payload["attributes"]
    elif resource == "inventory":
        before = _integer(current.get("stock"), 0)
        after = _integer(payload.get("stock")) if "stock" in payload else before + _integer(payload.get("adjustment"), 0)
        if after < 0:
            return jsonify({"error": "Stock cannot be negative."}), 400
        updates["stock"] = after
        db.inventory_adjustments.insert_one({"productId": object_id, "before": before, "after": after, "adjustment": after - before, "reason": str(payload.get("reason") or "Manual adjustment").strip()[:240], "createdAt": now, "createdBy": actor["_id"]})
    elif resource == "orders":
        if "status" in payload:
            status = str(payload.get("status") or "").lower()
            if status not in ORDER_STATUSES:
                return jsonify({"error": "Invalid order status."}), 400
            updates["status"] = status
        for key in ("customerName", "email"):
            if key in payload:
                updates[key] = str(payload.get(key) or "").strip().lower() if key == "email" else str(payload.get(key) or "").strip()
        if "total" in payload:
            total = _number(payload.get("total"))
            if total < 0:
                return jsonify({"error": "Order total cannot be negative."}), 400
            updates["total"] = total
    elif resource == "quotes":
        if current.get("status") == "converted":
            return jsonify({"error": "Converted quotes cannot be edited."}), 409
        if "status" in payload:
            status = str(payload.get("status") or "").lower()
            if status not in QUOTE_STATUSES - {"converted"}:
                return jsonify({"error": "Invalid quote status."}), 400
            updates["status"] = status
        for key in ("customerName", "email", "notes"):
            if key in payload:
                updates[key] = str(payload.get(key) or "").strip().lower() if key == "email" else str(payload.get(key) or "").strip()
        if "total" in payload:
            total = _number(payload.get("total"))
            if total < 0:
                return jsonify({"error": "Quote total cannot be negative."}), 400
            updates["total"] = total
    elif resource == "customers":
        if "displayName" in payload:
            display_name = str(payload.get("displayName") or "").strip()
            if not display_name:
                return jsonify({"error": "Customer name is required."}), 400
            first_name, _, last_name = display_name.partition(" ")
            updates.update({"displayName": display_name, "firstName": first_name, "lastName": last_name})
        if "phone" in payload:
            phone = str(payload.get("phone") or "").strip()
            if not re.fullmatch(r"\+?[0-9\s().-]{7,20}", phone):
                return jsonify({"error": "Enter a valid phone number."}), 400
            updates["phone"] = phone
        if "region" in payload:
            region = str(payload.get("region") or "").strip().lower()
            if region not in {"asia-india", "us", "europe", "anywhere-else"}:
                return jsonify({"error": "Choose a valid region."}), 400
            updates["region"] = region
        if "gender" in payload:
            gender = str(payload.get("gender") or "").strip().lower()
            if gender not in {"male", "female", "prefer-not-to-say"}:
                return jsonify({"error": "Choose a valid gender option."}), 400
            updates["gender"] = gender
        if "dob" in payload:
            try:
                dob = datetime.strptime(str(payload.get("dob") or ""), "%Y-%m-%d").date()
            except ValueError:
                return jsonify({"error": "Enter a valid date of birth."}), 400
            today = now.date()
            if dob >= today or dob.year < today.year - 120:
                return jsonify({"error": "Enter a valid date of birth."}), 400
            updates["dob"] = dob.isoformat()
        if "email" in payload:
            email = str(payload.get("email") or "").strip().lower()
            if "@" not in email or db.users.find_one({"email": email, "_id": {"$ne": object_id}}):
                return jsonify({"error": "A unique valid email is required."}), 409
            updates["email"] = email

    collection.update_one(query, {"$set": updates})
    return jsonify({"item": _document_view(collection.find_one({"_id": object_id}, {"passwordHash": 0}))}), 200


@staff_bp.post("/quotes/<quote_id>/convert")
@requireStaff
def convert_quote(quote_id: str):
    denied = _permission_error("quotes") or _permission_error("orders")
    if denied:
        return denied
    object_id = _valid_id(quote_id)
    if not object_id:
        return jsonify({"error": "Invalid quote id."}), 400
    db = database()
    quote = db.quotes.find_one({"_id": object_id})
    if not quote:
        return jsonify({"error": "Quote not found."}), 404
    if quote.get("status") == "converted":
        return jsonify({"error": "This quote has already been converted."}), 409
    actor = current_user()
    now = datetime.now(timezone.utc)
    order_number = f"RK-{now:%Y%m%d}-{secrets.token_hex(2).upper()}"
    order = {"orderNumber": order_number, "customerName": quote.get("customerName"), "email": quote.get("email"), "total": quote.get("total", 0), "currency": quote.get("currency", "INR"), "status": "confirmed", "items": quote.get("items", []), "quoteId": object_id, "createdAt": now, "updatedAt": now, "createdBy": actor["_id"], "updatedBy": actor["_id"]}
    order_id = db.orders.insert_one(order).inserted_id
    db.quotes.update_one({"_id": object_id}, {"$set": {"status": "converted", "orderId": order_id, "convertedAt": now, "updatedAt": now, "updatedBy": actor["_id"]}})
    order["_id"] = order_id
    return jsonify({"item": _document_view(order)}), 201
