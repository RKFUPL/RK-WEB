"""Central collection/product catalogue helpers.

Collections contain only product references plus display order. Product data
always lives in the products collection so Admin, Staff, inventory, orders,
quotes, and the storefront resolve the same record.
"""
from datetime import datetime, timezone

from bson import ObjectId
from pymongo.errors import OperationFailure

from .inventory import has_size_system, product_size_inventory, total_size_stock
from .time_utils import json_value as serialize_json_value


EXCLUDED_COLLECTION_SLUGS = {"aakaar", "aakaar-insights", "collections-of-aakaar"}
PRODUCT_AVAILABILITY = {"in_stock", "custom_order", "sold_out"}
COLLECTION_HERO_TYPES = {"image", "video"}
COLLECTION_HERO_LAYOUTS = {"full_bleed", "editorial_split", "media_dominant"}
FX_BUFFER_PERCENT = 5

NORMAL_COLLECTION_ORDER = ("Aakaar", "Hastakala", "Inaara", "Anamika", "Naqab", "Sandook")
_NORMAL_COLLECTION_RANK = {name.lower(): index for index, name in enumerate(NORMAL_COLLECTION_ORDER)}

_NORMAL_COLLECTIONS = (
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

NORMAL_COLLECTIONS = tuple(sorted(_NORMAL_COLLECTIONS, key=lambda collection: _NORMAL_COLLECTION_RANK.get(collection["name"].lower(), len(NORMAL_COLLECTION_ORDER))))

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
    return serialize_json_value(value)


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

    # Preserve the legacy numeric stock as explicitly unallocated stock. Do
    # not invent per-size quantities during migration; staff can allocate the
    # quantity to XS/S/M/L/XL when the product is ready for size inventory.
    # The explicit configuration flag is backfilled from the old flag only;
    # missing size data always remains legacy inventory.
    for product in db.products.find({}, {"stock": 1, "sizeInventory": 1, "sizeSystemEnabled": 1, "sizeInventoryConfigured": 1, "unallocatedStock": 1}):
        try:
            legacy_stock = max(0, int(product.get("stock") or 0))
        except (TypeError, ValueError):
            legacy_stock = 0
        size_inventory = product.get("sizeInventory") if isinstance(product.get("sizeInventory"), list) else []
        allocated = sum(max(0, int(item.get("stock") or 0)) for item in size_inventory if isinstance(item, dict))
        configured = bool(product.get("sizeInventoryConfigured")) if "sizeInventoryConfigured" in product else bool(product.get("sizeSystemEnabled")) if "sizeSystemEnabled" in product else bool(size_inventory)
        updates = {
            "sizeInventoryConfigured": configured,
            "sizeSystemEnabled": configured,
        }
        if configured:
            # Configured stock is derived from the size quantities. Never
            # overwrite the existing product stock during migration; only
            # preserve the remainder for the admin to allocate explicitly.
            updates["unallocatedStock"] = max(0, legacy_stock - allocated) if "unallocatedStock" not in product else max(0, int(product.get("unallocatedStock") or 0))
        else:
            updates["unallocatedStock"] = legacy_stock
        if all(product.get(key) == value for key, value in updates.items()):
            continue
        db.products.update_one(
            {"_id": product["_id"]},
            {"$set": updates},
        )

    # Collection entries are references, not a second product store. Convert
    # older string references to ObjectIds and remove only references whose
    # product was actually deleted. This prevents a stale collection entry
    # from producing a product URL that can never resolve.
    for collection in db.collections.find({}, {"productRefs": 1}):
        refs = collection.get("productRefs") or []
        normalized_refs = []
        changed = False
        for ref in refs:
            if not isinstance(ref, dict):
                changed = True
                continue
            raw_product_id = ref.get("productId")
            product_id = raw_product_id if isinstance(raw_product_id, ObjectId) else ObjectId(str(raw_product_id)) if ObjectId.is_valid(str(raw_product_id or "")) else None
            if not product_id or not db.products.find_one({"_id": product_id}, {"_id": 1}):
                changed = True
                continue
            if product_id != raw_product_id:
                changed = True
            normalized_refs.append({**ref, "productId": product_id})
        if changed:
            db.collections.update_one({"_id": collection["_id"]}, {"$set": {"productRefs": normalized_refs}})

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
            if collection.get("displayOrder") != position:
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
                "unallocatedStock": seed["dummyStock"],
                "sizeInventoryConfigured": False,
                "sizeSystemEnabled": False,
                "sizeInventory": [],
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
                "unallocatedStock": 0,
                "sizeInventoryConfigured": False,
                "sizeSystemEnabled": False,
                "sizeInventory": [],
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


def product_document(db, identifier: str) -> dict | None:
    """Resolve the canonical public product id, with slug compatibility."""
    filters = {"status": {"$ne": "archived"}, "isActive": {"$ne": False}}
    if ObjectId.is_valid(identifier):
        product = db.products.find_one({"_id": ObjectId(identifier), **filters})
        if product:
            return product
    return db.products.find_one({"slug": str(identifier).strip(), **filters})


def collection_product_documents(db, collection: dict) -> list[tuple[dict, int]]:
    refs = [ref for ref in (collection.get("productRefs") or []) if isinstance(ref, dict) and isinstance(ref.get("productId"), ObjectId)]
    refs.sort(key=lambda ref: (int(ref.get("displayOrder", 0)), str(ref["productId"])))
    product_ids = [ref["productId"] for ref in refs]
    products = {product["_id"]: product for product in db.products.find({"_id": {"$in": product_ids}})} if product_ids else {}
    return [(products[ref["productId"]], int(ref.get("displayOrder", 0))) for ref in refs if ref["productId"] in products]


def product_view(product: dict, *, display_order: int | None = None, media_limit: int | None = None) -> dict:
    configured = has_size_system(product)
    size_inventory = product_size_inventory(product) if configured else []
    public_attributes = _json_value(product.get("attributes") or {})
    if size_inventory and isinstance(public_attributes, dict) and not public_attributes.get("sizes"):
        public_attributes["sizes"] = [item["size"] for item in size_inventory if item.get("enabled", True)]
    public_stock = total_size_stock(product) if configured else product.get("stock")
    stored_availability = str(product.get("availability") or "").lower()
    if stored_availability not in PRODUCT_AVAILABILITY:
        stored_availability = "in_stock" if int(public_stock or 0) > 0 else "sold_out"
    # A zero legacy stock is genuinely sold out; the regression was treating
    # *missing size data* as zero. Legacy products with stock remain in stock.
    public_availability = "sold_out" if stored_availability == "in_stock" and int(public_stock or 0) <= 0 else stored_availability
    result = {
        "id": str(product["_id"]),
        "publicId": str(product["_id"]),
        "name": product.get("name"),
        "sku": product.get("sku"),
        "slug": product.get("slug") or str(product["_id"]),
        "status": product.get("status", "draft"),
        "availability": public_availability,
        "price": product.get("price"),
        "currency": "INR",
        "stock": public_stock,
        "sizeSystemEnabled": configured,
        "sizeInventoryConfigured": configured,
        "sizeInventory": _json_value(size_inventory),
        "unallocatedStock": int(product.get("unallocatedStock") or 0),
        "customSizeConfig": _json_value(product.get("customSizeConfig") or {}),
        "category": product.get("category"),
        "description": product.get("description"),
        "media": _json_value(product.get("media") or [])[:media_limit] if media_limit is not None else _json_value(product.get("media") or []),
        "attributes": public_attributes,
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


def collection_view(db, collection: dict, *, include_products: bool = True, product_media_limit: int | None = None) -> dict:
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
        result["products"] = [product_view(product, display_order=order, media_limit=product_media_limit) for product, order in product_pairs]
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
