"""Central collection/product catalogue helpers.

Collections contain only product references plus display order. Product data
always lives in the products collection so Admin, Staff, inventory, orders,
quotes, and the storefront resolve the same record.
"""
from datetime import datetime, timezone
from threading import Lock

from bson import ObjectId
from pymongo.errors import OperationFailure

from .inventory import DEFAULT_CUSTOM_SIZE_FIELDS, STANDARD_SIZES, has_size_system, product_size_inventory, total_size_stock
from .product_variants import (
    VARIANT_SCHEMA_VERSION,
    build_product_variants,
    product_has_visible_variants,
    public_variant_view,
    sync_product_variants,
    visible_variants,
)
from .time_utils import json_value as serialize_json_value


EXCLUDED_COLLECTION_SLUGS = {"aakaar", "aakaar-insights", "collections-of-aakaar"}
PRODUCT_AVAILABILITY = {"in_stock", "custom_order", "sold_out"}
VARIANT_STATUS_MIGRATION = "all-current-variants-active-v1"
COLLECTION_HERO_TYPES = {"image", "video"}
COLLECTION_HERO_LAYOUTS = {"full_bleed", "editorial_split", "media_dominant"}
FX_BUFFER_PERCENT = 5

_catalog_seed_lock = Lock()
_catalog_seeded_database_keys: set[tuple[int, str]] = set()

STOREFRONT_COLLECTION_PROJECTION = {
    "_id": 1,
    "name": 1,
    "slug": 1,
    "status": 1,
    "collectionType": 1,
    "taxInclusive": 1,
    "description": 1,
    "heroImage": 1,
    "hero": 1,
    "season": 1,
    "year": 1,
    "designerNote": 1,
    "collectionNumber": 1,
    "location": 1,
    "campaignInformation": 1,
    "createdAt": 1,
    "updatedAt": 1,
    "productRefs": 1,
}

STOREFRONT_PRODUCT_PROJECTION = {
    "_id": 1,
    "name": 1,
    "sku": 1,
    "slug": 1,
    "status": 1,
    "availability": 1,
    "price": 1,
    "taxInclusive": 1,
    "mrpIncludesGst": 1,
    "stock": 1,
    "sizeSystemEnabled": 1,
    "sizeInventoryConfigured": 1,
    "sizeInventory": 1,
    "unallocatedStock": 1,
    "category": 1,
    "media": {"$slice": 2},
    "attributes.sizes": 1,
    "attributes.colors": 1,
    "attributes.color": 1,
    "productCode": 1,
    "skuPrefix": 1,
    "variantSchemaVersion": 1,
    "variants": 1,
    "isDummy": 1,
    "isActive": 1,
}

NORMAL_COLLECTION_ORDER = ("Aakaar", "Hastakala", "Inaara", "Anamika", "Naqab", "Sandook")
_NORMAL_COLLECTION_RANK = {name.lower(): index for index, name in enumerate(NORMAL_COLLECTION_ORDER)}

_NORMAL_COLLECTIONS = (
    {
        "name": "Anamika",
        "slug": "collections-of-anamika",
        "description": "A refined story shaped by movement, texture, and modern occasion dressing.",
        "heroImage": "https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305156/Rashi_Kapoor3092_stukqt.jpg",
        "heroLayout": "full_bleed",
        "taxInclusive": True,
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
CORE_PRODUCT_SEEDS = (
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

# Product data transcribed from the supplied Anamika line sheets. CK-42 is
# intentionally omitted at the owner's request. The CK-56 A description is
# deliberately the visible source fragment so it can be replaced in the
# product record when the final copy is available.
ANAMIKA_PRODUCT_SEEDS = (
    {
        "seedKey": "rk:anamika:ck-45",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 1,
        "name": "CK-45",
        "sku": "CK-45",
        "slug": "ck-45",
        "description": "DRAPED SARI WITH A UNIQUE FLOWERS APPLIQUE BORDER SHEDDED IN CRYSTALS GLASS BEADS WITH OVERLAY CAPE TEAMED A HEAVY BLOUSE TO MATCH BORDER AND PANT SET",
        "colors": ["BLACK", "IVORY"],
        "price": 85000,
    },
    {
        "seedKey": "rk:anamika:ck-05",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 2,
        "name": "CK-05",
        "sku": "CK-05",
        "slug": "ck-05",
        "description": "DRAPED SAREE WITH HEAVY CRYSTAL AND BEADED EMBROIDERED BLOUSE TEAMED WITH LACEY PANTS",
        "colors": ["BLACK", "BERRY"],
        "price": 78000,
    },
    {
        "seedKey": "rk:anamika:ck-55",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 3,
        "name": "CK-55",
        "sku": "CK-55",
        "slug": "ck-55",
        "description": "DRAPE SAREE WITH HEAVY BORDER TEAMED WITH HEAVY EMBROIDERY BLOUSE ALONG WITH SHEER OVERLAY CAPE.",
        "colors": ["IVORY"],
        "price": 98000,
    },
    {
        "seedKey": "rk:anamika:ck-56-a",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 4,
        "name": "CK-56 A",
        "sku": "CK-56 A",
        "slug": "ck-56-a",
        "description": "ana work, box pleat detailing on p",
        "colors": ["BLACK", "ASH GREY"],
        "price": 78000,
    },
    {
        "seedKey": "rk:anamika:ck-44",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 5,
        "name": "CK-44",
        "sku": "CK-44",
        "slug": "ck-44",
        "description": "DRAPE SAREE WITH HEAVY CRYSTAL AND SEQUINS BORDER WITH HEAVY BLOUSE WITH PANTS SET",
        "colors": ["BLACK", "DUSTY IVORY", "TEAL"],
        "price": 88000,
    },
    {
        "seedKey": "rk:anamika:ck-27",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 6,
        "name": "CK-27",
        "sku": "CK-27",
        "slug": "ck-27",
        "description": "DRAPE SAREE WITH HEAVY CRYSTAL BORDER WITH HEAVILY EMBLISHED BUSTIER TEAMED WITH PANTS",
        "colors": ["IVORY", "ASH GREY"],
        "price": 78000,
    },
    {
        "seedKey": "rk:anamika:ck-36",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 7,
        "name": "CK-36",
        "sku": "CK-36",
        "slug": "ck-36",
        "description": "DRAPED SARI WITH A GLASS BEADS,CRYSTALS AND OSTRICH FEATHER BORDER TEAMED WITH A HEAVILY EMBROIDERED BLOUSE AND PANT SET",
        "colors": ["DUSTY IVORY", "BLACK", "ASH BLUE"],
        "price": 78000,
    },
    {
        "seedKey": "rk:anamika:ck-17",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 8,
        "name": "CK-17",
        "sku": "CK-17",
        "slug": "ck-17",
        "description": "HEAVY EMBROIDERED VICTORIAN LONG JACKET WITH DRAPPED SAREE WITH A MATCHING BORDER AND BUSTIER",
        "colors": ["LILAC"],
        "price": 158000,
    },
    {
        "seedKey": "rk:anamika:ck-49",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 9,
        "name": "CK-49",
        "sku": "CK-49",
        "slug": "ck-49",
        "description": "HEAVY EMBROIDERED BUSTIER TEAMED WITH CUTDANA EMBROIDERY SHARARA WITH FREE FLOWING LONG CAPE",
        "colors": ["IVORY"],
        "price": 88000,
    },
    {
        "seedKey": "rk:anamika:ck-50",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 10,
        "name": "CK-50",
        "sku": "CK-50",
        "slug": "ck-50",
        "description": "HEAVY EMBROIDERED SLEEVELESS KURTA WITH EMBROIDERED SHARARA WITH DUPPATTA",
        "colors": ["POWDER PINK"],
        "price": 128000,
    },
    {
        "seedKey": "rk:anamika:ck-51",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 11,
        "name": "CK-51",
        "sku": "CK-51",
        "slug": "ck-51",
        "description": "HEAVY EMBROIDERED SLEEVELESS KURTA WITH EMBROIDERED SHARARA WITH DUPPATTA",
        "colors": ["ASH BLUE"],
        "price": 138000,
    },
    {
        "seedKey": "rk:anamika:ck-53",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 12,
        "name": "CK-53",
        "sku": "CK-53",
        "slug": "ck-53",
        "description": "DRAPED GOWN ALONG WITH A HEAVY EMBROIDEY CAPE AND PEARL BORDER ALL AROUND",
        "colors": ["DUSTY IVORY", "ASH BLUE", "BLACK"],
        "price": 68000,
    },
    {
        "seedKey": "rk:anamika:ck-10a",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 13,
        "name": "CK-10A",
        "sku": "CK-10A",
        "slug": "ck-10a",
        "description": "HEAVY PEARL SHARARA WITH A HEAVILY BORDER TEAMED WITH HEAVY JACKET WITH FLOWER EMBROIDERY AND BRATTLE TO GO",
        "colors": ["LILAC"],
        "price": 148000,
    },
    {
        "seedKey": "rk:anamika:ck-64",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 14,
        "name": "CK-64",
        "sku": "CK-64",
        "slug": "ck-64",
        "description": "TAUPE HEAVILY EMBROIDERED JACKET WITH BRALETTE TEAMED WITH BOX PLEAT PALLAZO",
        "colors": ["Taupe", "Ash grey"],
        "price": 85000,
    },
    {
        "seedKey": "rk:anamika:ck-63",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 15,
        "name": "CK-63",
        "sku": "CK-63",
        "slug": "ck-63",
        "description": "HEAVY EMBROIDERED JACKET WITH INTRICATE FLORAL PATTERNS WITH DELICATE WORK ON BRALETTE TEAMED UP WITH GRACEFUL PLEATED PALLAZO",
        "colors": ["Ivory"],
        "price": 98000,
    },
    {
        "seedKey": "rk:anamika:ck-62",
        "collectionSlug": "collections-of-anamika",
        "displayOrder": 16,
        "name": "CK-62",
        "sku": "CK-62",
        "slug": "ck-62",
        "description": "A HEAVILY EMBROIDERED JACKET WITH INTRICATE WORK PAIRED WITH EMBLISED BRALETTE WITH STATEMENT DRAPE SKIRT",
        "colors": ["Ivory"],
        "price": 85000,
    },
)

ANAMIKA_PRODUCT_SEEDS = tuple(
    {
        **seed,
        "sizes": list(STANDARD_SIZES),
        "stock": 0,
        "availability": "sold_out",
        "taxInclusive": True,
        "mrpIncludesGst": True,
        "category": "Couture",
        "media": [],
        "customSizeConfig": {
            "enabled": True,
            "fields": list(DEFAULT_CUSTOM_SIZE_FIELDS),
            "label": "Want a custom size?",
            "unit": "in",
        },
    }
    for seed in ANAMIKA_PRODUCT_SEEDS
)

PRODUCT_SEEDS = CORE_PRODUCT_SEEDS + ANAMIKA_PRODUCT_SEEDS


def _product_seed_document(seed: dict, now: datetime) -> dict:
    """Build one canonical product document from a catalogue seed."""
    sizes = [str(size).strip().upper() for size in seed.get("sizes", []) if str(size).strip()]
    colors = [str(color).strip() for color in seed.get("colors", []) if str(color).strip()]
    if not colors and str(seed.get("color") or "").strip():
        colors = [str(seed["color"]).strip()]
    size_inventory = [{"size": size, "stock": 0, "enabled": True} for size in sizes]
    size_configured = bool(size_inventory)
    stock = max(0, int(seed.get("stock") or 0))
    tax_inclusive = bool(seed.get("taxInclusive") or seed.get("mrpIncludesGst"))
    document = {
        "name": seed["name"],
        "sku": seed["sku"],
        "price": seed["price"],
        "currency": "INR",
        "stock": sum(item["stock"] for item in size_inventory) if size_configured else stock,
        "unallocatedStock": 0 if size_configured else stock,
        "sizeInventoryConfigured": size_configured,
        "sizeSystemEnabled": size_configured,
        "sizeInventory": size_inventory,
        "availability": str(seed.get("availability") or "custom_order"),
        "status": "active",
        "description": str(seed.get("description") or ""),
        "category": str(seed.get("category") or ""),
        "media": list(seed.get("media") or []),
        "attributes": {
            "sizes": sizes,
            "colors": colors,
            "fabric": "",
            "occasion": "",
            "gender": "",
            "material": "",
            "customizationInformation": "",
        },
        "seedKey": seed["seedKey"],
        "taxInclusive": tax_inclusive,
        "mrpIncludesGst": tax_inclusive,
        "isDummy": False,
        "isActive": True,
        "createdAt": now,
        "updatedAt": now,
    }
    if str(seed.get("slug") or "").strip():
        document["slug"] = str(seed["slug"]).strip()
    if isinstance(seed.get("customSizeConfig"), dict):
        document["customSizeConfig"] = {
            **seed["customSizeConfig"],
            "fields": list(seed["customSizeConfig"].get("fields") or []),
        }
    if seed.get("collectionSlug") == "collections-of-anamika":
        document["anamikaSeedVersion"] = 1
    collection_hint = {"slug": seed.get("collectionSlug"), "name": str(seed.get("collectionSlug") or "").removeprefix("collections-of-")}
    document.update(build_product_variants(document, [collection_hint]))
    return document


def _json_value(value):
    return serialize_json_value(value)


def is_excluded_collection(collection: dict | None = None, slug: str = "") -> bool:
    collection = collection or {}
    candidate_slug = str(slug or collection.get("slug") or "").strip().lower()
    candidate_name = str(collection.get("name") or "").strip().lower()
    return candidate_slug in EXCLUDED_COLLECTION_SLUGS or candidate_name == "aakaar"


def is_runway_collection(collection: dict | None) -> bool:
    """Return whether a collection is explicitly identified as Runway."""
    collection = collection or {}
    for value in (collection.get("collectionType"), collection.get("name"), collection.get("slug"), collection.get("status")):
        tokens = str(value or "").strip().lower().replace("_", "-").replace(" ", "-").split("-")
        if "runway" in tokens:
            return True
    return False


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
        db.products.create_index("variants.sku", unique=True, sparse=True)
    except OperationFailure:
        # Existing catalogues are reconciled below. A conflicting historical
        # index or duplicate should not prevent the storefront from starting.
        pass
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
                "taxInclusive": bool(seed.get("taxInclusive")),
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
            if "taxInclusive" in seed and collection.get("taxInclusive") != bool(seed["taxInclusive"]):
                collection_updates["taxInclusive"] = bool(seed["taxInclusive"])
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
        is_anamika_seed = seed.get("collectionSlug") == "collections-of-anamika"
        product = db.products.find_one({"seedKey": seed["seedKey"]})
        if not product and is_anamika_seed:
            # Adopt an existing matching SKU instead of creating a duplicate if
            # this catalogue was entered manually before the seed was deployed.
            product = db.products.find_one({"sku": seed["sku"]})
        if not product:
            result = db.products.insert_one(_product_seed_document(seed, now))
            product = db.products.find_one({"_id": result.inserted_id})

        seed_updates = {}
        if is_anamika_seed and int(product.get("anamikaSeedVersion") or 0) < 1:
            # Apply the source-of-truth data once. The version guard preserves
            # later edits made through Admin/Staff, including the temporary
            # CK-56 A description supplied by the owner.
            seeded_document = _product_seed_document(seed, now)
            seed_updates = {key: value for key, value in seeded_document.items() if key != "createdAt"}
        else:
            # Older local databases were seeded before SKU/pricing was
            # requested. Backfill only blank values so staff edits survive.
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
            display_order = int(seed.get("displayOrder") or next_order)
            db.collections.update_one(
                {"_id": collection["_id"]},
                {"$push": {"productRefs": {"productId": product["_id"], "displayOrder": display_order}}, "$set": {"updatedAt": now}},
            )

    # Once the real Anamika catalogue exists, retire only its seeded dummy and
    # remove that one relationship. Other products and collection edits remain
    # untouched.
    anamika_collection = db.collections.find_one({"slug": "collections-of-anamika"})
    anamika_dummy = db.products.find_one({"seedKey": "dummy:collections-of-anamika", "isDummy": True})
    if anamika_collection and anamika_dummy:
        db.collections.update_one(
            {"_id": anamika_collection["_id"]},
            {
                "$pull": {"productRefs": {"productId": anamika_dummy["_id"]}},
                "$set": {"anamikaProductSeedVersion": 1, "updatedAt": now},
            },
        )
        db.products.update_one(
            {"_id": anamika_dummy["_id"]},
            {"$set": {"status": "archived", "isActive": False, "updatedAt": now}},
        )

    # Backfill the nested colour-SKU architecture once for every existing
    # product. Subsequent Admin/Staff changes reconcile an individual product.
    for product in db.products.find({
        "status": {"$ne": "archived"},
        "$or": [
            {"variantSchemaVersion": {"$ne": VARIANT_SCHEMA_VERSION}},
            {"variants": {"$exists": False}},
        ],
    }):
        sync_product_variants(db, product)

    # One-time correction for the current catalogue: legacy zero-inventory
    # records were previously represented as sold_out. Preserve every stock
    # quantity, but make the explicit variant status ACTIVE unless an Admin
    # had already marked that variant REMOVE. The marker prevents this
    # compatibility migration from undoing future Admin INACTIVE changes.
    if not db.catalog_migrations.find_one({"_id": VARIANT_STATUS_MIGRATION}):
        for product in db.products.find({"status": {"$ne": "archived"}}):
            variants = [dict(item) for item in product.get("variants", []) if isinstance(item, dict)]
            if not variants:
                continue
            changed = False
            has_visible_variant = False
            for variant in variants:
                if str(variant.get("status") or "").lower() != "remove":
                    has_visible_variant = True
                    if variant.get("status") != "active":
                        variant["status"] = "active"
                        changed = True
            if has_visible_variant and product.get("availability") != "in_stock":
                changed = True
            if changed:
                db.products.update_one(
                    {"_id": product["_id"]},
                    {"$set": {"variants": variants, "availability": "in_stock", "updatedAt": now}},
                )
        db.catalog_migrations.update_one(
            {"_id": VARIANT_STATUS_MIGRATION},
            {"$set": {"completedAt": now}},
            upsert=True,
        )


def ensure_catalog_seed_once(db) -> None:
    """Run the compatibility seed at most once for each live DB handle.

    The seed is retained for older deployments and local databases, but it is
    not request work. PyMongo already reuses the application-level client;
    this guard keeps the public collection endpoint from recreating indexes,
    scanning products, and normalising references on every visit.
    """
    database_key = (id(getattr(db, "client", db)), str(getattr(db, "name", "")))
    if database_key in _catalog_seeded_database_keys:
        return
    with _catalog_seed_lock:
        if database_key in _catalog_seeded_database_keys:
            return
        ensure_catalog_seed(db)
        _catalog_seeded_database_keys.add(database_key)


def collection_document(db, slug: str, projection: dict | None = None) -> dict | None:
    collection = db.collections.find_one({"slug": slug}, projection) if projection is not None else db.collections.find_one({"slug": slug})
    return None if is_excluded_collection(collection, slug) else collection


def product_document(db, identifier: str) -> dict | None:
    """Resolve the canonical public product id, with slug compatibility."""
    filters = {"status": {"$ne": "archived"}, "isActive": {"$ne": False}}
    if ObjectId.is_valid(identifier):
        product = db.products.find_one({"_id": ObjectId(identifier), **filters})
        if product:
            return product
    return db.products.find_one({"slug": str(identifier).strip(), **filters})


def product_is_runway(db, product_id: ObjectId) -> bool:
    """Resolve Runway eligibility from collection membership, never product copy."""
    collections = db.collections.find(
        {"productRefs.productId": product_id},
        {"collectionType": 1, "name": 1, "slug": 1, "status": 1},
    )
    return any(is_runway_collection(collection) for collection in collections)


def collection_product_documents(db, collection: dict, projection: dict | None = None) -> list[tuple[dict, int]]:
    refs = [ref for ref in (collection.get("productRefs") or []) if isinstance(ref, dict) and isinstance(ref.get("productId"), ObjectId)]
    refs.sort(key=lambda ref: (int(ref.get("displayOrder", 0)), str(ref["productId"])))
    product_ids = [ref["productId"] for ref in refs]
    products = {product["_id"]: product for product in db.products.find({"_id": {"$in": product_ids}}, projection)} if product_ids else {}
    return [(products[ref["productId"]], int(ref.get("displayOrder", 0))) for ref in refs if ref["productId"] in products]


def product_view(product: dict, *, display_order: int | None = None, media_limit: int | None = None) -> dict:
    public_variants = [public_variant_view(variant, media_limit=media_limit) for variant in visible_variants(product)]
    selected_variant = next((variant for variant in public_variants if variant["status"] == "active"), None) or (public_variants[0] if public_variants else None)
    configured = bool(selected_variant) or has_size_system(product)
    size_inventory = selected_variant["sizeInventory"] if selected_variant else product_size_inventory(product) if configured else []
    public_attributes = _json_value(product.get("attributes") or {})
    if size_inventory and isinstance(public_attributes, dict) and not public_attributes.get("sizes"):
        public_attributes["sizes"] = [item["size"] for item in size_inventory if item.get("enabled", True)]
    if public_variants and isinstance(public_attributes, dict):
        public_attributes["colors"] = [variant["colour"] for variant in public_variants if variant["colour"]]
    public_stock = selected_variant["stock"] if selected_variant else total_size_stock(product) if configured else product.get("stock")
    stored_availability = str(product.get("availability") or "in_stock").lower()
    # Explicit variant status controls merchandising. Inventory never silently
    # turns an ACTIVE variant into SOLD OUT.
    public_availability = "in_stock" if any(variant["status"] == "active" for variant in public_variants) else "sold_out" if public_variants else stored_availability if stored_availability in PRODUCT_AVAILABILITY else "in_stock"
    tax_inclusive = bool(product.get("taxInclusive") or product.get("mrpIncludesGst"))
    selected_price = selected_variant.get("price") if selected_variant else product.get("price")
    selected_media = selected_variant.get("images") if selected_variant else _json_value(product.get("media") or [])
    result = {
        "id": str(product["_id"]),
        "publicId": str(product["_id"]),
        "name": product.get("name"),
        "productCode": product.get("productCode") or product.get("sku"),
        "parentSku": product.get("sku"),
        "skuPrefix": product.get("skuPrefix"),
        "sku": selected_variant.get("sku") if selected_variant else product.get("sku"),
        "slug": product.get("slug") or str(product["_id"]),
        "status": product.get("status", "draft"),
        "availability": public_availability,
        "price": selected_price,
        "taxInclusive": tax_inclusive,
        "mrpIncludesGst": tax_inclusive,
        "currency": "INR",
        "stock": public_stock,
        "sizeSystemEnabled": configured,
        "sizeInventoryConfigured": configured,
        "sizeInventory": _json_value(size_inventory),
        "unallocatedStock": int(product.get("unallocatedStock") or 0),
        "customSizeConfig": _json_value(product.get("customSizeConfig") or {}),
        "category": product.get("category"),
        "description": product.get("description"),
        "media": selected_media[:media_limit] if media_limit is not None else selected_media,
        "variants": public_variants,
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


def product_card_view(product: dict, *, display_order: int | None = None, media_limit: int = 2) -> dict:
    """Return only the fields needed by the public collection product grid."""
    result = product_view(product, display_order=display_order, media_limit=media_limit)
    for key in ("publicId", "customSizeConfig", "description", "createdAt", "updatedAt", "pricing"):
        result.pop(key, None)
    attributes = result.get("attributes")
    if isinstance(attributes, dict):
        result["attributes"] = {
            key: attributes[key]
            for key in ("sizes", "colors", "color")
            if key in attributes
        }
    return result


def collection_view(
    db,
    collection: dict,
    *,
    include_products: bool = True,
    product_media_limit: int | None = None,
    product_cards: bool = False,
) -> dict:
    product_projection = STOREFRONT_PRODUCT_PROJECTION if product_cards else None
    product_pairs = [
        (product, order)
        for product, order in collection_product_documents(db, collection, product_projection)
        if product.get("status") != "archived" and product.get("isActive") is not False and product_has_visible_variants(product)
    ]
    result = {
        "id": str(collection["_id"]),
        "name": collection.get("name"),
        "slug": collection.get("slug"),
        "status": collection.get("status", "collection"),
        "collectionType": collection.get("collectionType", "standard"),
        "taxInclusive": bool(collection.get("taxInclusive")),
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
        view = product_card_view if product_cards else product_view
        media_limit = product_media_limit if product_media_limit is not None else 2 if product_cards else None
        result["products"] = [
            view(product, display_order=order, media_limit=media_limit)
            for product, order in product_pairs
        ]
        if result["taxInclusive"]:
            for product in result["products"]:
                product["taxInclusive"] = True
                product["mrpIncludesGst"] = True
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
