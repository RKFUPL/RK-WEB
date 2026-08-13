"""Central collection/product catalogue helpers.

Collections contain only product references plus display order. Product data
always lives in the products collection so Admin, Staff, inventory, orders,
quotes, and the storefront resolve the same record.
"""
from datetime import datetime, timezone

from bson import ObjectId
from pymongo.errors import OperationFailure


EXCLUDED_COLLECTION_SLUGS = {"aakaar", "aakaar-insights", "collections-of-aakaar"}
PRODUCT_AVAILABILITY = {"in_stock", "custom_order", "sold_out"}
FX_BUFFER_PERCENT = 5

NORMAL_COLLECTIONS = (
    {
        "name": "Anamika",
        "slug": "collections-of-anamika",
        "description": "A refined story shaped by movement, texture, and modern occasion dressing.",
        "heroImage": "https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305156/Rashi_Kapoor3092_stukqt.jpg",
        "dummyPrice": 120000,
        "dummyStock": 5,
        "dummyAvailability": "in_stock",
    },
    {
        "name": "Hastakala",
        "slug": "collections-of-hasthkala",
        "description": "Craft-led silhouettes with a more artisanal, hand-finished mood.",
        "heroImage": "https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304857/Hasthkalare_hhljut.jpg",
        "dummyPrice": 95000,
        "dummyStock": 0,
        "dummyAvailability": "sold_out",
    },
    {
        "name": "Inaara",
        "slug": "collections-of-inaara",
        "description": "A luminous edit with fluid lines and softer, celebratory energy.",
        "heroImage": "https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305219/RASHI_KAPOOR_-_27-3-240879_xr10ue.jpg",
        "dummyPrice": 150000,
        "dummyStock": 0,
        "dummyAvailability": "custom_order",
    },
    {
        "name": "Naqab",
        "slug": "collections-of-naqab",
        "description": "A dramatic chapter built around veiled layers and evening presence.",
        "heroImage": "https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304902/Naqab_2_re_qdu1xs.jpg",
        "dummyPrice": 110000,
        "dummyStock": 3,
        "dummyAvailability": "in_stock",
    },
    {
        "name": "Sandook",
        "slug": "collections-of-sandook",
        "description": "A heritage-leaning story with a treasured, heirloom-like mood.",
        "heroImage": "https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305276/Rashi_Kapoor_22-03-20220063_nwo7of.jpg",
        "dummyPrice": 125000,
        "dummyStock": 1,
        "dummyAvailability": "in_stock",
    },
)


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


def is_excluded_collection(collection: dict | None = None, slug: str = "") -> bool:
    collection = collection or {}
    candidate_slug = str(slug or collection.get("slug") or "").strip().lower()
    candidate_name = str(collection.get("name") or "").strip().lower()
    return candidate_slug in EXCLUDED_COLLECTION_SLUGS or candidate_name == "aakaar"


def ensure_catalog_seed(db) -> None:
    """Idempotently create the five normal collections and one dummy each."""
    now = datetime.now(timezone.utc)
    db.collections.create_index("slug")
    db.products.create_index("sku")
    try:
        db.products.create_index("seedKey", unique=True, sparse=True)
    except OperationFailure as error:
        # Older deployments can already have this key indexed with different
        # options. Seeding remains idempotent via seedKey even without changing
        # that existing index in place.
        if error.code not in {85, 86}:
            raise

    for position, seed in enumerate(NORMAL_COLLECTIONS, start=1):
        collection = db.collections.find_one({"slug": seed["slug"]})
        if not collection:
            result = db.collections.insert_one({
                "name": seed["name"],
                "slug": seed["slug"],
                "status": "collection",
                "description": seed["description"],
                "heroImage": seed["heroImage"],
                "displayOrder": position,
                "productRefs": [],
                "createdAt": now,
                "updatedAt": now,
                "isActive": True,
                "seeded": True,
            })
            collection = db.collections.find_one({"_id": result.inserted_id})
        elif collection.get("displayOrder") is None:
            db.collections.update_one({"_id": collection["_id"]}, {"$set": {"displayOrder": position}})
            collection["displayOrder"] = position
        needs_initial_relationship = not collection.get("catalogSeedVersion")

        seed_key = f"dummy:{seed['slug']}"
        product = db.products.find_one({"seedKey": seed_key})
        if not product:
            sku_root = seed["name"].upper().replace(" ", "-")
            result = db.products.insert_one({
                "name": f"Dummy {seed['name']}",
                "sku": f"{sku_root}-001",
                "price": seed["dummyPrice"],
                "currency": "INR",
                "stock": seed["dummyStock"],
                "availability": seed["dummyAvailability"],
                "status": "active",
                "description": "Placeholder product record. Replace these fields when the real product is ready.",
                "category": "",
                "media": [],
                "attributes": {
                    "sizes": [],
                    "colors": [],
                    "fabric": "",
                    "occasion": "",
                    "gender": "",
                    "material": "",
                    "customizationInformation": "",
                },
                "seedKey": seed_key,
                "isDummy": True,
                "isActive": True,
                "createdAt": now,
                "updatedAt": now,
            })
            product = db.products.find_one({"_id": result.inserted_id})

        refs = collection.get("productRefs") or []
        if needs_initial_relationship:
            update = {"$set": {"updatedAt": now, "catalogSeedVersion": 1}}
            if not any(ref.get("productId") == product["_id"] for ref in refs if isinstance(ref, dict)):
                update["$push"] = {"productRefs": {"productId": product["_id"], "displayOrder": 1}}
            db.collections.update_one({"_id": collection["_id"]}, update)


def collection_document(db, slug: str) -> dict | None:
    collection = db.collections.find_one({"slug": slug})
    return None if is_excluded_collection(collection, slug) else collection


def collection_product_documents(db, collection: dict) -> list[tuple[dict, int]]:
    refs = [ref for ref in (collection.get("productRefs") or []) if isinstance(ref, dict) and isinstance(ref.get("productId"), ObjectId)]
    refs.sort(key=lambda ref: (int(ref.get("displayOrder", 0)), str(ref["productId"])))
    product_ids = [ref["productId"] for ref in refs]
    products = {product["_id"]: product for product in db.products.find({"_id": {"$in": product_ids}})} if product_ids else {}
    return [(products[ref["productId"]], int(ref.get("displayOrder", 0))) for ref in refs if ref["productId"] in products]


def product_view(product: dict, *, display_order: int | None = None) -> dict:
    result = {
        "id": str(product["_id"]),
        "name": product.get("name"),
        "sku": product.get("sku"),
        "status": product.get("status", "draft"),
        "availability": product.get("availability") or ("sold_out" if int(product.get("stock") or 0) <= 0 else "in_stock"),
        "price": product.get("price"),
        "currency": "INR",
        "stock": product.get("stock"),
        "category": product.get("category"),
        "description": product.get("description"),
        "media": _json_value(product.get("media") or []),
        "attributes": _json_value(product.get("attributes") or {}),
        "isDummy": bool(product.get("isDummy")),
        "createdAt": _json_value(product.get("createdAt")),
        "updatedAt": _json_value(product.get("updatedAt")),
        "pricing": {
            "baseCurrency": "INR",
            "basePrice": product.get("price"),
            "fxBufferPercent": FX_BUFFER_PERCENT,
        },
    }
    if display_order is not None:
        result["displayOrder"] = display_order
    return result


def collection_view(db, collection: dict, *, include_products: bool = True) -> dict:
    product_pairs = collection_product_documents(db, collection)
    result = {
        "id": str(collection["_id"]),
        "name": collection.get("name"),
        "slug": collection.get("slug"),
        "status": collection.get("status", "collection"),
        "description": collection.get("description"),
        "heroImage": collection.get("heroImage"),
        "createdAt": _json_value(collection.get("createdAt")),
        "updatedAt": _json_value(collection.get("updatedAt")),
        "productCount": len(product_pairs),
    }
    if include_products:
        result["products"] = [product_view(product, display_order=order) for product, order in product_pairs]
    return result


def managed_collections(db) -> list[dict]:
    ensure_catalog_seed(db)
    collections = [collection for collection in db.collections.find({}) if not is_excluded_collection(collection)]
    return sorted(collections, key=lambda collection: (int(collection.get("displayOrder", 9999)), str(collection.get("createdAt") or ""), str(collection.get("_id"))))


def product_collection_ids(db, product_id: ObjectId) -> list[str]:
    collections = db.collections.find({"productRefs.productId": product_id}, {"_id": 1, "slug": 1, "name": 1})
    return [str(collection["_id"]) for collection in collections if not is_excluded_collection(collection)]


def add_product_reference(db, collection: dict, product_id: ObjectId, display_order: int | None = None) -> bool:
    refs = collection.get("productRefs") or []
    if any(ref.get("productId") == product_id for ref in refs if isinstance(ref, dict)):
        return False
    order = display_order if display_order is not None else max([int(ref.get("displayOrder", 0)) for ref in refs if isinstance(ref, dict)] or [0]) + 1
    db.collections.update_one(
        {"_id": collection["_id"]},
        {"$push": {"productRefs": {"productId": product_id, "displayOrder": order}}, "$set": {"updatedAt": datetime.now(timezone.utc)}},
    )
    return True


def remove_product_reference(db, collection: dict, product_id: ObjectId) -> None:
    db.collections.update_one(
        {"_id": collection["_id"]},
        {"$pull": {"productRefs": {"productId": product_id}}, "$set": {"updatedAt": datetime.now(timezone.utc)}},
    )


def update_product_order(db, collection: dict, product_id: ObjectId, display_order: int) -> bool:
    result = db.collections.update_one(
        {"_id": collection["_id"], "productRefs.productId": product_id},
        {"$set": {"productRefs.$.displayOrder": display_order, "updatedAt": datetime.now(timezone.utc)}},
    )
    return bool(result.matched_count)
