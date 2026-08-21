from datetime import datetime, timezone
import re
import secrets

from bson import ObjectId
from flask import Blueprint, jsonify, request

from ...catalog import (
    COLLECTION_HERO_LAYOUTS,
    COLLECTION_HERO_TYPES,
    PRODUCT_AVAILABILITY,
    add_product_reference,
    collection_document,
    collection_hero,
    collection_view,
    ensure_catalog_seed,
    ensure_catalog_seed_once,
    managed_collections,
    product_collection_ids,
    product_view,
    remove_product_reference,
    update_product_order,
)
from ...order_fulfillment import RETURN_FULFILLMENT_STATUSES, actor_view, migrate_legacy_orders, timeline_event
from ...inventory import default_size_inventory, has_size_system, normalise_size_inventory, total_size_stock
from ...product_variants import VARIANT_STATUSES, find_variant, sync_product_variants
from ...rbac import current_user, database, effective_permissions, requireStaff
from ...time_utils import json_value as serialize_json_value

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
ORDER_STATUSES = {"pending", "order_placed"}
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
    return serialize_json_value(value)


def _document_view(document: dict, resource: str | None = None) -> dict:
    if resource == "inventory":
        return {
            "id": str(document.get("_id")),
            "name": _json_value(document.get("name")),
            "sku": _json_value(document.get("sku")),
            "stock": _json_value(document.get("stock")),
            "availability": _json_value(document.get("availability")),
            "status": _json_value(document.get("status")),
        }
    if resource == "products":
        variants = []
        for variant in document.get("variants") or []:
            if not isinstance(variant, dict):
                continue
            images = variant.get("images") if isinstance(variant.get("images"), list) else []
            variants.append({
                "id": _json_value(variant.get("id")),
                "sku": _json_value(variant.get("sku")),
                "colour": _json_value(variant.get("colour")),
                "status": _json_value(variant.get("status")),
                "availabilityStatus": _json_value(variant.get("availabilityStatus")),
                "stock": _json_value(variant.get("stock")),
                "sizeInventory": _json_value(variant.get("sizeInventory") or []),
                # The listing only needs a lazy thumbnail. Full image arrays
                # are fetched by the Manage images action on demand.
                "images": [_json_value(images[0])] if images else [],
            })
        attributes = document.get("attributes") if isinstance(document.get("attributes"), dict) else {}
        media = document.get("media") if isinstance(document.get("media"), list) else []
        return {
            "id": str(document.get("_id")),
            "name": _json_value(document.get("name")),
            "sku": _json_value(document.get("sku")),
            "price": _json_value(document.get("price")),
            "stock": _json_value(document.get("stock")),
            "status": _json_value(document.get("status")),
            "availability": _json_value(document.get("availability")),
            "category": _json_value(document.get("category")),
            "description": _json_value(document.get("description")),
            "sizeInventory": _json_value(document.get("sizeInventory") or []),
            "sizeInventoryConfigured": bool(document.get("sizeInventoryConfigured")),
            "sizeSystemEnabled": bool(document.get("sizeSystemEnabled")),
            "attributes": {key: _json_value(attributes[key]) for key in ("sizes", "colors", "color") if key in attributes},
            "media": [_json_value(media[0])] if media else [],
            "variants": variants,
        }
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


def _collection_permission_error(*required: str):
    permissions = set(effective_permissions(current_user()))
    if not permissions.intersection(required):
        return jsonify({"error": "You do not have permission to manage collections."}), 403
    return None


def _valid_id(value: str):
    return ObjectId(value) if ObjectId.is_valid(value) else None


def _customer_scope(user: dict) -> dict:
    if user.get("role") == "admin":
        return {"role": "customer"}
    return {"role": "customer", "assignedStaffId": user["_id"]}


def _customer_access(customer_id: ObjectId, user: dict) -> dict:
    return {"_id": customer_id, **_customer_scope(user)}


def _management_collection_payload(db, collection: dict) -> dict:
    detail = collection_view(db, collection)
    assigned_ids = {product["id"] for product in detail["products"]}
    all_products = list(db.products.find({}).sort("createdAt", -1).limit(200))
    available_products = [product_view(product) for product in all_products if str(product["_id"]) not in assigned_ids]
    for product in detail["products"]:
        product["collectionIds"] = product_collection_ids(db, ObjectId(product["id"]))
    return {
        "collection": detail,
        "availableProducts": available_products,
        "allCollections": [collection_view(db, item, include_products=False) for item in managed_collections(db)],
        "permissions": effective_permissions(current_user()),
    }


@staff_bp.get("/collections")
@requireStaff
def list_collections():
    denied = _collection_permission_error("products:manage", "inventory:manage")
    if denied:
        return denied
    db = database()
    return jsonify({
        "collections": [collection_view(db, collection, include_products=False) for collection in managed_collections(db)],
        "permissions": effective_permissions(current_user()),
    }), 200


@staff_bp.get("/collections/<slug>")
@requireStaff
def get_collection(slug: str):
    denied = _collection_permission_error("products:manage", "inventory:manage")
    if denied:
        return denied
    db = database()
    ensure_catalog_seed(db)
    collection = collection_document(db, slug)
    if not collection:
        return jsonify({"error": "Collection not found."}), 404
    return jsonify(_management_collection_payload(db, collection)), 200


@staff_bp.patch("/collections/<slug>")
@requireStaff
def update_collection(slug: str):
    denied = _collection_permission_error("products:manage")
    if denied:
        return denied
    db = database()
    ensure_catalog_seed(db)
    collection = collection_document(db, slug)
    if not collection:
        return jsonify({"error": "Collection not found."}), 404
    payload = request.get_json(silent=True) or {}
    updates = {"updatedAt": datetime.now(timezone.utc), "updatedBy": current_user()["_id"]}
    if "name" in payload:
        name = str(payload.get("name") or "").strip()
        if not name:
            return jsonify({"error": "Collection name is required."}), 400
        updates["name"] = name
    if "status" in payload:
        status = str(payload.get("status") or "").strip().lower()
        if status not in {"collection", "draft", "active", "archived"}:
            return jsonify({"error": "Choose a valid collection status."}), 400
        updates["status"] = status
    if "collectionType" in payload:
        collection_type = str(payload.get("collectionType") or "standard").strip().lower()
        if collection_type not in {"standard", "runway"}:
            return jsonify({"error": "Collection type must be standard or runway."}), 400
        updates["collectionType"] = collection_type
    if "taxInclusive" in payload:
        updates["taxInclusive"] = bool(payload.get("taxInclusive"))
    for key in ("description", "heroImage"):
        if key in payload:
            value = str(payload.get(key) or "").strip()
            if key == "heroImage" and value and not value.startswith(("https://", "/")):
                return jsonify({"error": "Hero image must be an HTTPS or local URL."}), 400
            updates[key] = value
    if "hero" in payload:
        hero_payload = payload.get("hero")
        if not isinstance(hero_payload, dict):
            return jsonify({"error": "Hero configuration must be an object."}), 400
        hero = collection_hero(collection)
        for key in ("type", "image", "video", "poster", "mobileImage", "mobileVideo", "layout", "label", "ctaLabel"):
            if key in hero_payload:
                hero[key] = str(hero_payload.get(key) or "").strip()
        hero["type"] = hero["type"].lower()
        hero["layout"] = hero["layout"].lower()
        if hero["type"] not in COLLECTION_HERO_TYPES:
            return jsonify({"error": "Hero type must be image or video."}), 400
        if hero["layout"] not in COLLECTION_HERO_LAYOUTS:
            return jsonify({"error": "Choose a valid hero layout."}), 400
        for key in ("image", "video", "poster", "mobileImage", "mobileVideo"):
            if hero[key] and not hero[key].startswith(("https://", "/")):
                return jsonify({"error": f"Hero {key} must be an HTTPS or local URL."}), 400
        if hero["type"] == "image" and not hero["image"]:
            return jsonify({"error": "An image hero requires a desktop image."}), 400
        if hero["type"] == "video" and not hero["video"]:
            return jsonify({"error": "A video hero requires a desktop video."}), 400
        updates["hero"] = hero
        updates["heroImage"] = hero["image"] or hero["poster"]
    for key in ("season", "designerNote", "collectionNumber", "location", "campaignInformation"):
        if key in payload:
            updates[key] = str(payload.get(key) or "").strip()
    if "year" in payload:
        year = _integer(payload.get("year"), 0) if payload.get("year") not in (None, "") else None
        if year is not None and (year < 1900 or year > 2200):
            return jsonify({"error": "Enter a valid four-digit collection year."}), 400
        updates["year"] = year
    db.collections.update_one({"_id": collection["_id"]}, {"$set": updates})
    return jsonify(_management_collection_payload(db, db.collections.find_one({"_id": collection["_id"]}))), 200


@staff_bp.post("/collections/<slug>/products")
@requireStaff
def assign_collection_product(slug: str):
    denied = _collection_permission_error("products:manage")
    if denied:
        return denied
    db = database()
    ensure_catalog_seed(db)
    collection = collection_document(db, slug)
    product_id = _valid_id(str((request.get_json(silent=True) or {}).get("productId") or ""))
    if not collection:
        return jsonify({"error": "Collection not found."}), 404
    if not product_id or not db.products.find_one({"_id": product_id}):
        return jsonify({"error": "Product not found."}), 404
    add_product_reference(db, collection, product_id)
    sync_product_variants(db, product_id, force=True)
    return jsonify(_management_collection_payload(db, db.collections.find_one({"_id": collection["_id"]}))), 200


@staff_bp.delete("/collections/<slug>/products/<product_id>")
@requireStaff
def unassign_collection_product(slug: str, product_id: str):
    denied = _collection_permission_error("products:manage")
    if denied:
        return denied
    db = database()
    collection = collection_document(db, slug)
    object_id = _valid_id(product_id)
    if not collection:
        return jsonify({"error": "Collection not found."}), 404
    if not object_id:
        return jsonify({"error": "Invalid product id."}), 400
    remove_product_reference(db, collection, object_id)
    return jsonify(_management_collection_payload(db, db.collections.find_one({"_id": collection["_id"]}))), 200


@staff_bp.patch("/collections/<slug>/products/<product_id>")
@requireStaff
def reorder_collection_product(slug: str, product_id: str):
    denied = _collection_permission_error("products:manage")
    if denied:
        return denied
    db = database()
    collection = collection_document(db, slug)
    object_id = _valid_id(product_id)
    display_order = _integer((request.get_json(silent=True) or {}).get("displayOrder"), -1)
    if not collection:
        return jsonify({"error": "Collection not found."}), 404
    if not object_id or display_order < 0:
        return jsonify({"error": "A valid product and non-negative display order are required."}), 400
    if not update_product_order(db, collection, object_id, display_order):
        return jsonify({"error": "Product is not assigned to this collection."}), 404
    return jsonify(_management_collection_payload(db, db.collections.find_one({"_id": collection["_id"]}))), 200


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
        migrate_legacy_orders(db)
        fulfillment_counts = {
            status: db.orders.count_documents({"fulfillment.status": status})
            for status in ("order_placed", "confirmed", "processing", "packed", "shipped", "out_for_delivery", "delivered", "return_requested", "returned", "refunded")
        }
        fulfillment_counts["returns"] = sum(fulfillment_counts.get(status, 0) for status in RETURN_FULFILLMENT_STATUSES)
        counts["orders"] = sum(fulfillment_counts.get(status, 0) for status in ("order_placed", "confirmed", "processing", "packed", "shipped", "out_for_delivery"))
        counts["fulfillment"] = fulfillment_counts
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
    if resource in {"products", "inventory"}:
        ensure_catalog_seed_once(db)
    query = _customer_scope(current_user()) if resource == "customers" else {}
    # Archived products are the persisted form of a dashboard deletion. They
    # remain available for historical references, but must not repopulate the
    # active Products or Inventory workspaces after a reload.
    if resource in {"products", "inventory"}:
        query["status"] = {"$ne": "archived"}
    search = str(request.args.get("q") or "").strip()
    if search:
        escaped = re.escape(search[:80])
        fields = ["displayName", "email", "username"] if resource == "customers" else ["name", "sku", "variants.sku", "variants.colour", "orderNumber", "quoteNumber", "customerName", "email"]
        query = {**query, "$or": [{field: {"$regex": escaped, "$options": "i"}} for field in fields]}
    page = max(1, _integer(request.args.get("page"), 1))
    page_size = min(100, max(1, _integer(request.args.get("limit"), 100)))
    if resource == "inventory":
        projection = {"_id": 1, "name": 1, "sku": 1, "stock": 1, "availability": 1, "status": 1, "createdAt": 1}
    elif resource == "products":
        projection = {
            "_id": 1, "name": 1, "sku": 1, "price": 1, "stock": 1, "status": 1, "availability": 1,
            "category": 1, "description": 1, "sizeInventory": 1, "sizeInventoryConfigured": 1,
            "sizeSystemEnabled": 1, "attributes.sizes": 1, "attributes.colors": 1, "attributes.color": 1,
            "media": {"$slice": 1}, "variants.id": 1, "variants.sku": 1, "variants.colour": 1,
            "variants.status": 1, "variants.availabilityStatus": 1, "variants.stock": 1,
            "variants.sizeInventory": 1, "variants.images": {"$slice": 1}, "createdAt": 1,
        }
    else:
        projection = {"passwordHash": 0, "otpHash": 0, "otpExpiresAt": 0, "otpAttempts": 0}
    collection = db[RESOURCE_COLLECTIONS[resource]]
    total = collection.count_documents(query)
    documents = list(collection.find(query, projection).sort("createdAt", -1).skip((page - 1) * page_size).limit(page_size))
    if resource in {"products", "inventory"} and documents:
        product_ids = [document["_id"] for document in documents]
        collection_names: dict[ObjectId, list[str]] = {product_id: [] for product_id in product_ids}
        for collection in db.collections.find({"productRefs.productId": {"$in": product_ids}}, {"name": 1, "productRefs": 1}):
            name = str(collection.get("name") or "").strip()
            if not name:
                continue
            for reference in collection.get("productRefs") or []:
                if isinstance(reference, dict) and reference.get("productId") in collection_names:
                    collection_names[reference["productId"]].append(name)
        viewed = []
        for document in documents:
            names = sorted(set(collection_names.get(document["_id"], [])), key=str.casefold)
            item = _document_view(document, resource)
            item["collections"] = names
            item["collection"] = ", ".join(names)
            viewed.append(item)
        return jsonify({"items": viewed, "page": page, "pageSize": page_size, "total": total, "hasMore": page * page_size < total}), 200
    return jsonify({"items": [_document_view(document, resource) for document in documents], "page": page, "pageSize": page_size, "total": total, "hasMore": page * page_size < total}), 200


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
        # Selling state is explicit. A zero opening quantity must not silently
        # create an INACTIVE/SOLD OUT colour variant.
        availability = str(payload.get("availability") or "in_stock").lower()
        if not name or not sku or price < 0 or stock < 0 or status not in PRODUCT_STATUSES:
            return jsonify({"error": "Product name, unique SKU, non-negative price and stock, and a valid status are required."}), 400
        if availability not in PRODUCT_AVAILABILITY:
            return jsonify({"error": "Choose In Stock, Custom Order, or Sold Out availability."}), 400
        raw_size_inventory = payload.get("sizeInventory")
        try:
            size_inventory = normalise_size_inventory(raw_size_inventory) if raw_size_inventory is not None else []
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        size_enabled = bool(payload.get("sizeInventoryConfigured")) or bool(payload.get("sizeSystemEnabled")) or bool(size_inventory)
        if size_enabled and not size_inventory:
            size_inventory = default_size_inventory()
        allocated_stock = total_size_stock({"sizeInventory": size_inventory, "sizeInventoryConfigured": True}) if size_enabled else 0
        if size_enabled:
            # Configured stock is derived from the size quantities. The old
            # product-level stock is only used by legacy products.
            if "stock" in payload and stock != allocated_stock:
                return jsonify({"error": "For size-managed products, total stock must equal the size allocation."}), 400
            total_stock = allocated_stock
            unallocated_stock = 0
        else:
            total_stock = stock
            unallocated_stock = stock
        if db.products.find_one({"sku": sku}):
            return jsonify({"error": "That SKU already exists."}), 409
        media = payload.get("media") if isinstance(payload.get("media"), list) else []
        attributes = payload.get("attributes") if isinstance(payload.get("attributes"), dict) else {}
        tax_inclusive = bool(payload.get("taxInclusive") or payload.get("mrpIncludesGst"))
        document = {**common, "name": name, "sku": sku, "price": price, "taxInclusive": tax_inclusive, "mrpIncludesGst": tax_inclusive, "stock": total_stock, "unallocatedStock": unallocated_stock, "sizeInventoryConfigured": size_enabled, "sizeSystemEnabled": size_enabled, "sizeInventory": size_inventory, "status": status, "availability": availability, "currency": "INR", "category": str(payload.get("category") or "").strip(), "description": str(payload.get("description") or "").strip(), "media": media[:12], "attributes": attributes, "isActive": status != "archived"}
        if isinstance(payload.get("customSizeConfig"), dict):
            document["customSizeConfig"] = payload["customSizeConfig"]
        collection = db.products
    elif resource == "orders":
        customer_name = str(payload.get("customerName") or "").strip()
        email = str(payload.get("email") or "").strip().lower()
        total = _number(payload.get("total"))
        status = str(payload.get("status") or "order_placed").lower()
        if not customer_name or "@" not in email or total < 0 or status not in ORDER_STATUSES:
            return jsonify({"error": "Customer name, valid email, non-negative total, and a valid status are required."}), 400
        order_number = str(payload.get("orderNumber") or "").strip().upper() or f"RK-{now:%Y%m%d}-{secrets.token_hex(2).upper()}"
        if db.orders.find_one({"orderNumber": order_number}):
            return jsonify({"error": "That order number already exists."}), 409
        document = {
            **common,
            "orderNumber": order_number,
            "customerName": customer_name,
            "email": email,
            "total": total,
            "currency": "INR",
            "status": "order_placed",
            "paymentStatus": "pending",
            "payment": {"status": "pending", "gateway": "manual"},
            "fulfillmentStatus": "order_placed",
            "fulfillment": {"status": "order_placed", "courier": "", "trackingNumber": "", "trackingUrl": "", "shippedAt": None, "deliveredAt": None},
            "timeline": [timeline_event("order_placed", now, actor_view("staff", actor), "Order created by the RK team.")],
            "items": payload.get("items") if isinstance(payload.get("items"), list) else [],
        }
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
    if resource == "products":
        document = sync_product_variants(db, document) or document
    return jsonify({"item": _document_view(document, "products" if resource == "products" else resource)}), 201


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
            if sku and db.products.find_one({"sku": sku, "_id": {"$ne": object_id}}):
                return jsonify({"error": "That SKU already exists."}), 409
            updates["sku"] = sku
        if "price" in payload:
            raw_price = payload.get("price")
            price = None if raw_price is None or str(raw_price).strip() == "" else _number(raw_price)
            if price is not None and price < 0:
                return jsonify({"error": "Price cannot be negative."}), 400
            updates["price"] = price
        if "taxInclusive" in payload or "mrpIncludesGst" in payload:
            raw_tax_inclusive = payload.get("taxInclusive") if "taxInclusive" in payload else payload.get("mrpIncludesGst")
            tax_inclusive = bool(raw_tax_inclusive)
            updates.update({"taxInclusive": tax_inclusive, "mrpIncludesGst": tax_inclusive})
        if "status" in payload:
            status = str(payload.get("status") or "").lower()
            if status not in PRODUCT_STATUSES:
                return jsonify({"error": "Invalid product status."}), 400
            updates.update({"status": status, "isActive": status != "archived"})
        if "availability" in payload:
            availability = str(payload.get("availability") or "").lower()
            if availability not in PRODUCT_AVAILABILITY:
                return jsonify({"error": "Choose In Stock, Custom Order, or Sold Out availability."}), 400
            updates["availability"] = availability
        stock_changed = False
        size_inventory_changed = False
        before_stock = _integer(current.get("stock"), 0)
        after_stock = before_stock
        current_configured = has_size_system(current)
        current_size_inventory = normalise_size_inventory(current.get("sizeInventory"))
        size_inventory = current_size_inventory
        configured = current_configured

        if "sizeInventoryConfigured" in payload:
            configured = bool(payload.get("sizeInventoryConfigured"))
        elif "sizeSystemEnabled" in payload:
            configured = bool(payload.get("sizeSystemEnabled"))
        elif "sizeInventory" in payload:
            configured = bool(payload.get("sizeInventory"))

        if any(key in payload for key in ("sizeInventory", "sizeInventoryConfigured", "sizeSystemEnabled")):
            try:
                size_inventory = normalise_size_inventory(payload.get("sizeInventory")) if configured else []
            except ValueError as error:
                return jsonify({"error": str(error)}), 400
            if configured and not size_inventory:
                size_inventory = default_size_inventory()
            allocated = total_size_stock({"sizeInventory": size_inventory, "sizeInventoryConfigured": configured}) if configured else 0
            if configured and not current_configured and before_stock > 0 and allocated != before_stock:
                return jsonify({"error": f"Allocate all {before_stock} legacy units before saving size inventory."}), 400
            size_inventory_changed = size_inventory != current_size_inventory or configured != current_configured
            updates.update({
                "sizeInventory": size_inventory,
                "sizeInventoryConfigured": configured,
                "sizeSystemEnabled": configured,
                "unallocatedStock": 0 if configured else before_stock,
                "stock": allocated if configured else before_stock,
            })
            after_stock = allocated if configured else before_stock
            stock_changed = after_stock != before_stock

        if "stock" in payload:
            raw_stock = payload.get("stock")
            requested_stock = before_stock if raw_stock is None or str(raw_stock).strip() == "" else _integer(raw_stock)
            if requested_stock < 0:
                return jsonify({"error": "Stock cannot be negative."}), 400
            if configured:
                allocated = total_size_stock({"sizeInventory": size_inventory, "sizeInventoryConfigured": True})
                if requested_stock != allocated:
                    return jsonify({"error": "For size-managed products, total stock is derived from the size allocation."}), 400
                after_stock = allocated
                updates["unallocatedStock"] = 0
            else:
                after_stock = requested_stock
                updates["unallocatedStock"] = after_stock
            updates["stock"] = after_stock
            stock_changed = stock_changed or after_stock != before_stock

        availability_changed = "availability" in updates and updates["availability"] != current.get("availability")
        # Changing a merchandising state must not erase valid stock. A
        # product can be marked sold out/custom order temporarily and later
        # returned to stock without losing its legacy or size allocation.
        reason = str(payload.get("reason") or payload.get("changeReason") or "").strip()[:240]
        if (stock_changed or availability_changed or size_inventory_changed) and not reason:
            return jsonify({"error": "Enter a reason for changing availability or quantity."}), 400
        if stock_changed or availability_changed or size_inventory_changed:
            db.inventory_adjustments.insert_one({
                "productId": object_id,
                "before": before_stock,
                "after": after_stock,
                "adjustment": after_stock - before_stock,
                "beforeAvailability": current.get("availability"),
                "afterAvailability": updates.get("availability", current.get("availability")),
                "beforeSizeInventory": current_size_inventory,
                "afterSizeInventory": size_inventory,
                "reason": reason,
                "changeType": "size_inventory" if size_inventory_changed else "availability_and_stock" if stock_changed and availability_changed else "availability" if availability_changed else "stock",
                "createdAt": now,
                "createdBy": actor["_id"],
            })
        if "category" in payload:
            updates["category"] = str(payload.get("category") or "").strip()
        if "media" in payload:
            media = payload.get("media")
            if not isinstance(media, list) or len(media) > 12 or any(not isinstance(item, str) or len(item) > 2048 for item in media):
                return jsonify({"error": "Product media must contain up to 12 valid URLs."}), 400
            updates["media"] = media
        if "attributes" in payload:
            if not isinstance(payload.get("attributes"), dict):
                return jsonify({"error": "Product attributes must be an object."}), 400
            updates["attributes"] = payload["attributes"]
        if "customSizeConfig" in payload:
            if payload["customSizeConfig"] is not None and not isinstance(payload["customSizeConfig"], dict):
                return jsonify({"error": "Custom size configuration must be an object."}), 400
            updates["customSizeConfig"] = payload["customSizeConfig"] or {}
    elif resource == "inventory":
        if has_size_system(current):
            return jsonify({"error": "This product uses size inventory. Update the XS–XL quantities from the product editor."}), 400
        before = _integer(current.get("stock"), 0)
        if "adjustment" in payload and _integer(payload.get("adjustment"), 0) == 0:
            return jsonify({"error": "A non-zero inventory adjustment is required."}), 400
        after = _integer(payload.get("stock")) if "stock" in payload else max(0, before + _integer(payload.get("adjustment"), 0))
        reason = str(payload.get("reason") or "").strip()[:240]
        if not reason:
            return jsonify({"error": "Enter a reason for the inventory change."}), 400
        updates["stock"] = after
        db.inventory_adjustments.insert_one({"productId": object_id, "before": before, "after": after, "adjustment": after - before, "reason": reason, "createdAt": now, "createdBy": actor["_id"]})
    elif resource == "orders":
        if "status" in payload:
            return jsonify({"error": "Use the fulfillment actions to change order status."}), 400
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
    updated_document = collection.find_one({"_id": object_id}, {"passwordHash": 0})
    if resource == "products":
        updated_document = sync_product_variants(db, updated_document, force=any(key in updates for key in {"name", "sku", "attributes", "media", "price"})) or updated_document
    return jsonify({"item": _document_view(updated_document, "products" if resource == "products" else resource)}), 200


@staff_bp.get("/products/<product_id>/variants/<path:variant_id>")
@requireStaff
def get_product_variant(product_id: str, variant_id: str):
    """Load full image metadata only when an administrator opens Manage images."""
    denied = _permission_error("products")
    if denied:
        return denied
    object_id = _valid_id(product_id)
    if not object_id:
        return jsonify({"error": "Invalid product id."}), 400
    product = database().products.find_one({"_id": object_id})
    if not product:
        return jsonify({"error": "Product not found."}), 404
    selected = find_variant(product, variant_id)
    if not selected:
        product = sync_product_variants(database(), product) or product
        selected = find_variant(product, variant_id)
    if not selected:
        return jsonify({"error": "Variant not found."}), 404
    return jsonify({"id": str(selected.get("id") or variant_id), "sku": selected.get("sku"), "images": [str(image).strip() for image in (selected.get("images") or []) if str(image).strip()]}), 200


@staff_bp.patch("/products/<product_id>/variants/<path:variant_id>")
@requireStaff
def update_product_variant(product_id: str, variant_id: str):
    denied = _permission_error("products")
    if denied:
        return denied
    object_id = _valid_id(product_id)
    if not object_id:
        return jsonify({"error": "Invalid product id."}), 400
    db = database()
    product = db.products.find_one({"_id": object_id})
    if not product:
        return jsonify({"error": "Product not found."}), 404
    product = sync_product_variants(db, product) or product
    selected = find_variant(product, variant_id)
    if not selected:
        return jsonify({"error": "Variant not found."}), 404

    payload = request.get_json(silent=True) or {}
    variants = [dict(item) for item in product.get("variants", []) if isinstance(item, dict)]
    index = next(index for index, item in enumerate(variants) if str(item.get("id") or "") == str(selected.get("id") or ""))
    updated_variant = dict(variants[index])
    if "status" in payload:
        status = str(payload.get("status") or "").strip().lower()
        if status not in VARIANT_STATUSES:
            return jsonify({"error": "Choose ACTIVE, INACTIVE, or REMOVE."}), 400
        updated_variant["status"] = status
    if "availabilityStatus" in payload:
        availability_status = str(payload.get("availabilityStatus") or "").strip().upper()
        if availability_status not in {"IN_STOCK", "NO_STOCK"}:
            return jsonify({"error": "Choose IN_STOCK or NO_STOCK availability."}), 400
        updated_variant["status"] = "active" if availability_status == "IN_STOCK" else "inactive"
    if "images" in payload:
        images = payload.get("images")
        if not isinstance(images, list) or len(images) > 12 or any(not isinstance(item, str) or len(item) > 2048 for item in images):
            return jsonify({"error": "Variant images must contain up to 12 valid URLs."}), 400
        updated_variant["images"] = [item.strip() for item in images if item.strip()]
    if "price" in payload:
        price = _number(payload.get("price"))
        if price < 0:
            return jsonify({"error": "Variant price cannot be negative."}), 400
        updated_variant["price"] = price
    if "sizeInventory" in payload:
        try:
            updated_variant["sizeInventory"] = normalise_size_inventory(payload.get("sizeInventory"))
        except ValueError as error:
            return jsonify({"error": str(error)}), 400

    if updated_variant == variants[index]:
        return jsonify({"item": _document_view(product, "products")}), 200
    variants[index] = updated_variant
    now = datetime.now(timezone.utc)
    actor = current_user()
    db.products.update_one({"_id": object_id}, {"$set": {"variants": variants, "updatedAt": now, "updatedBy": actor["_id"]}})
    if updated_variant.get("status") != selected.get("status"):
        db.variant_status_history.insert_one({
            "productId": object_id,
            "variantId": str(selected.get("id") or ""),
            "sku": str(selected.get("sku") or ""),
            "before": selected.get("status"),
            "after": updated_variant.get("status"),
            "createdAt": now,
            "createdBy": actor["_id"],
        })
    current = sync_product_variants(db, db.products.find_one({"_id": object_id}), force=True)
    return jsonify({"item": _document_view(current, "products")}), 200


@staff_bp.delete("/resources/products/<product_id>")
@requireStaff
def delete_product(product_id: str):
    """Permanently remove a product while preserving historical order snapshots."""
    denied = _permission_error("products")
    if denied:
        return denied
    object_id = _valid_id(product_id)
    if not object_id:
        return jsonify({"error": "Invalid product id."}), 400
    db = database()
    product = db.products.find_one({"_id": object_id}, {"name": 1, "sku": 1, "seedKey": 1})
    if not product:
        return jsonify({"error": "Product not found."}), 404

    db.catalog_deletions.update_one(
        {"_id": f"product:{object_id}"},
        {"$set": {
            "productId": object_id,
            "seedKey": product.get("seedKey"),
            "sku": product.get("sku"),
            "deletedAt": datetime.now(timezone.utc),
            "deletedBy": current_user()["_id"],
        }},
        upsert=True,
    )
    db.products.delete_one({"_id": object_id})
    # Remove catalogue references and product-specific operational history.
    # Order documents intentionally remain untouched because they contain
    # immutable product/SKU snapshots for customer and finance records.
    db.collections.update_many(
        {"productRefs.productId": object_id},
        {"$pull": {"productRefs": {"productId": object_id}}},
    )
    db.inventory_adjustments.delete_many({"productId": object_id})
    db.variant_status_history.delete_many({"productId": object_id})
    return jsonify({"message": "Product permanently deleted.", "productId": str(object_id)}), 200


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
    order = {
        "orderNumber": order_number,
        "customerName": quote.get("customerName"),
        "email": quote.get("email"),
        "total": quote.get("total", 0),
        "currency": quote.get("currency", "INR"),
        "status": "order_placed",
        "paymentStatus": "pending",
        "payment": {"status": "pending", "gateway": "manual"},
        "fulfillmentStatus": "order_placed",
        "fulfillment": {"status": "order_placed", "courier": "", "trackingNumber": "", "trackingUrl": "", "shippedAt": None, "deliveredAt": None},
        "timeline": [timeline_event("order_placed", now, actor_view("staff", actor), "Order created from an accepted quote.")],
        "items": quote.get("items", []),
        "quoteId": object_id,
        "createdAt": now,
        "updatedAt": now,
        "createdBy": actor["_id"],
        "updatedBy": actor["_id"],
    }
    order_id = db.orders.insert_one(order).inserted_id
    db.quotes.update_one({"_id": object_id}, {"$set": {"status": "converted", "orderId": order_id, "convertedAt": now, "updatedAt": now, "updatedBy": actor["_id"]}})
    order["_id"] = order_id
    return jsonify({"item": _document_view(order)}), 201
