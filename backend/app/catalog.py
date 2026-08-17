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
COLLECTION_HERO_TYPES = {"image", "video"}
COLLECTION_HERO_LAYOUTS = {"full_bleed", "editorial_split", "media_dominant"}
FX_BUFFER_PERCENT = 5

NORMAL_COLLECTIONS = (
    {
        "name": "Anamika",
        "slug": "collections-of-anamika",
        "description": "A refined story shaped by movement, texture, and modern occasion dressing.",
        "heroImage": "https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305156/Rashi_Kapoor3092_stukqt.jpg",
        "heroLayout": "full_bleed",
        "dummyPrice": 120000,
        "dummyStock": 5,
        "dummyAvailability": "in_stock",
    },
    {
        "name": "Hastakala",
        "slug": "collections-of-hasthkala",
        "description": "Craft-led silhouettes with a more artisanal, hand-finished mood.",
        "heroImage": "https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304857/Hasthkalare_hhljut.jpg",
        "heroLayout": "editorial_split",
        "dummyPrice": 95000,
        "dummyStock": 0,
        "dummyAvailability": "sold_out",
    },
    {
        "name": "Inaara",
        "slug": "collections-of-inaara",
        "description": "A luminous edit with fluid lines and softer, celebratory energy.",
        "heroImage": "https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305219/RASHI_KAPOOR_-_27-3-240879_xr10ue.jpg",
        "heroLayout": "media_dominant",
        "dummyPrice": 150000,
        "dummyStock": 0,
        "dummyAvailability": "custom_order",
    },
    {
        "name": "Naqab",
        "slug": "collections-of-naqab",
        "description": "A dramatic chapter built around veiled layers and evening presence.",
        "heroImage": "https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304902/Naqab_2_re_qdu1xs.jpg",
        "heroLayout": "full_bleed",
        "dummyPrice": 110000,
        "dummyStock": 3,
        "dummyAvailability": "in_stock",
    },
    {
        "name": "Sandook",
        "slug": "collections-of-sandook",
        "description": "A heritage-leaning story with a treasured, heirloom-like mood.",
        "heroImage": "https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305276/Rashi_Kapoor_22-03-20220063_nwo7of.jpg",
        "heroLayout": "editorial_split",
        "dummyPrice": 125000,
        "dummyStock": 1,
        "dummyAvailability": "in_stock",
    },
)

# These are real storefront records, not frontend-only fixtures.  The
# deliberately blank commercial fields are editable later from Admin/Staff;
# custom_order keeps an unknown inventory quantity from being presented as
# available stock while still allowing a request to be added to the bag.
PRODUCT_SEEDS = (
    {
        "seedKey": "rk:product:173-hot-pink",
        "collectionSlug": "collections-of-hasthkala",
        "name": "173 - Hot Pink",
        "color": "Hot Pink",
        "sku": "HK-173-HP",
        "price": 125000,
        "media": [
            "https://res.cloudinary.com/fm1bwbrd/image/upload/v1786797342/H17_2259_l1kc3d.jpg",
            "https://res.cloudinary.com/fm1bwbrd/image/upload/v1786797342/H17_2247_yxjefq.jpg",
            "https://res.cloudinary.com/fm1bwbrd/image/upload/v1786797338/H17_2262_olhyyp.jpg",
            "https://res.cloudinary.com/fm1bwbrd/image/upload/v1786797337/H17_2252_wion4m.jpg",
            "https://res.cloudinary.com/fm1bwbrd/image/upload/v1786797336/H17_2255_ajqtxo.jpg",
        ],
    },
    {
        "seedKey": "rk:product:186-ivory",
        "collectionSlug": "collections-of-inaara",
        "name": "186 - Ivory",
        "color": "Ivory",
        "sku": "IA-186-IV",
        "price": 140000,
        "media": [
            "https://res.cloudinary.com/fm1bwbrd/image/upload/v1786797999/RASHI_KAPOOR_-_27-3-249931_compressed_hzbntg.jpg",
            "https://res.cloudinary.com/fm1bwbrd/image/upload/v1786797975/RASHI_KAPOOR_-_27-3-249893_compressed_rfwr3p.jpg",
        ],
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


def collection_hero(collection: dict) -> dict:
    """Return a normalized, backwards-compatible hero configuration."""
    configured = collection.get("hero") if isinstance(collection.get("hero"), dict) else {}
    fallback_image = str(configured.get("image") or collection.get("heroImage") or "").strip()
    hero_type = str(configured.get("type") or "image").lower()
    layout = str(configured.get("layout") or "media_dominant").lower()
    return {
        "type": hero_type if hero_type in COLLECTION_HERO_TYPES else "image",
        "image": fallback_image,
        "video": str(configured.get("video") or "").strip(),
        "poster": str(configured.get("poster") or fallback_image).strip(),
        "mobileImage": str(configured.get("mobileImage") or "").strip(),
        "mobileVideo": str(configured.get("mobileVideo") or "").strip(),
        "layout": layout if layout in COLLECTION_HERO_LAYOUTS else "media_dominant",
        "label": str(configured.get("label") or "The Collection").strip(),
        "ctaLabel": str(configured.get("ctaLabel") or "Explore Collection").strip(),
    }


def ensure_catalog_seed(db) -> None:
    """Idempotently create normal collections, fixtures, and real seed products."""
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
            hero = {
                "type": "image",
                "image": seed["heroImage"],
                "video": "",
                "poster": seed["heroImage"],
                "mobileImage": "",
                "mobileVideo": "",
                "layout": seed["heroLayout"],
                "label": "The Collection",
                "ctaLabel": "Explore Collection",
            }
            result = db.collections.insert_one({
                "name": seed["name"],
                "slug": seed["slug"],
                "status": "collection",
                "description": seed["description"],
                "heroImage": seed["heroImage"],
                "hero": hero,
                "displayOrder": position,
                "productRefs": [],
                "createdAt": now,
                "updatedAt": now,
                "isActive": True,
                "seeded": True,
            })
            collection = db.collections.find_one({"_id": result.inserted_id})
        else:
            collection_updates = {}
            if collection.get("displayOrder") is None:
                collection_updates["displayOrder"] = position
            if not isinstance(collection.get("hero"), dict):
                collection_updates["hero"] = {
                    "type": "image",
                    "image": collection.get("heroImage") or seed["heroImage"],
                    "video": "",
                    "poster": collection.get("heroImage") or seed["heroImage"],
                    "mobileImage": "",
                    "mobileVideo": "",
                    "layout": seed["heroLayout"],
                    "label": "The Collection",
                    "ctaLabel": "Explore Collection",
                }
            if collection_updates:
                db.collections.update_one({"_id": collection["_id"]}, {"$set": collection_updates})
                collection.update(collection_updates)
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

    for seed in PRODUCT_SEEDS:
        product = db.products.find_one({"seedKey": seed["seedKey"]})
        if not product:
            result = db.products.insert_one({
                "name": seed["name"],
                "sku": seed["sku"],
                "price": seed["price"],
                "currency": "INR",
                "stock": 0,
                "availability": "custom_order",
                "status": "active",
                "description": "",
                "category": "",
                "media": seed["media"],
                "attributes": {
                    "sizes": [],
                    "colors": [seed["color"]],
                    "fabric": "",
                    "occasion": "",
                    "gender": "",
                    "material": "",
                    "customizationInformation": "",
                },
                "seedKey": seed["seedKey"],
                "isDummy": False,
                "isActive": True,
                "createdAt": now,
                "updatedAt": now,
            })
            product = db.products.find_one({"_id": result.inserted_id})

        # Older local databases were seeded before SKU/pricing was requested.
        # Backfill only blank values so later staff/admin edits remain intact.
        seed_updates = {}
        if not str(product.get("sku") or "").strip():
            seed_updates["sku"] = seed["sku"]
        if product.get("price") in (None, 0):
            seed_updates["price"] = seed["price"]
        if product.get("stock") is None and product.get("availability") in {"custom_order", "sold_out"}:
            seed_updates["stock"] = 0
        if seed_updates:
            seed_updates["updatedAt"] = now
            db.products.update_one({"_id": product["_id"]}, {"$set": seed_updates})
            product.update(seed_updates)

        collection = db.collections.find_one({"slug": seed["collectionSlug"]})
        if not collection or not product:
            continue
        refs = collection.get("productRefs") or []
        if not any(ref.get("productId") == product["_id"] for ref in refs if isinstance(ref, dict)):
            next_order = max([int(ref.get("displayOrder", 0)) for ref in refs if isinstance(ref, dict)] or [0]) + 1
            db.collections.update_one(
                {"_id": collection["_id"]},
                {"$push": {"productRefs": {"productId": product["_id"], "displayOrder": next_order}}, "$set": {"updatedAt": now}},
            )


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
        "slug": product.get("slug") or str(product["_id"]),
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
    if result["price"] is None:
        result.pop("price")
        result["pricing"].pop("basePrice")
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
        "hero": collection_hero(collection),
        "season": collection.get("season"),
        "year": collection.get("year"),
        "designerNote": collection.get("designerNote"),
        "collectionNumber": collection.get("collectionNumber"),
        "location": collection.get("location"),
        "campaignInformation": collection.get("campaignInformation"),
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
