"""Canonical colour-variant rules shared by catalogue, staff, and checkout.

The product document remains the source of shared editorial information. Each
entry in ``variants`` is an independently purchasable colour SKU with its own
media, price, size inventory, and explicit storefront status.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from bson import ObjectId

from .inventory import STANDARD_SIZES, normalise_size_inventory


VARIANT_STATUSES = ("active", "inactive", "remove")
VARIANT_SCHEMA_VERSION = 1

# This is the only collection-to-SKU mapping. Frontend clients consume the
# generated SKU and never recreate a prefix themselves.
COLLECTION_SKU_PREFIXES = {
    "hastakala": "HK",
    "hasthkala": "HK",
    "anamika": "AK",
    "runway": "RW",
    "espiritu-libre-lfw": "RW",
    "lakme": "RW",
    "inaara": "IA",
    "naqab": "NQ",
    "sandook": "SK",
    "aakaar": "AA",
}


def _slug(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")


def _is_runway_collection(collection: dict) -> bool:
    values = (
        collection.get("collectionType"),
        collection.get("name"),
        collection.get("slug"),
        collection.get("status"),
    )
    tokens = [_slug(value).split("-") for value in values]
    return any("runway" in value or "lfw" in value for value in tokens) or any("espiritu" in value and "libre" in value for value in tokens)


def collection_sku_prefix(collection: dict | None) -> str:
    collection = collection or {}
    if _is_runway_collection(collection):
        return "RW"
    candidates = [
        _slug(collection.get("name")),
        _slug(collection.get("slug")).removeprefix("collections-of-"),
        _slug(collection.get("collectionType")),
    ]
    for candidate in candidates:
        if candidate in COLLECTION_SKU_PREFIXES:
            return COLLECTION_SKU_PREFIXES[candidate]
        for key, prefix in COLLECTION_SKU_PREFIXES.items():
            if key and key in candidate.split("-"):
                return prefix
    words = [word for word in re.split(r"[^A-Za-z0-9]+", str(collection.get("name") or "")) if word]
    fallback = "".join(word[0] for word in words[:3]).upper()
    return fallback or "RK"


def product_code(product: dict) -> str:
    explicit = str(product.get("productCode") or "").strip()
    if explicit:
        source = explicit
    else:
        name = str(product.get("name") or "").strip()
        source = name.split(" - ", 1)[0] if " - " in name else name or str(product.get("sku") or "")
    return re.sub(r"[^A-Za-z0-9]+", "", source).upper() or "PRODUCT"


def colour_slug(colour: object) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", str(colour or "").strip().upper()).strip("-") or "DEFAULT"


def make_variant_sku(prefix: str, code: str, colour: object) -> str:
    return f"{prefix.upper()}-{re.sub(r'[^A-Z0-9]+', '', code.upper())}-{colour_slug(colour)}"


def _product_colours(product: dict) -> list[str]:
    attributes = product.get("attributes") if isinstance(product.get("attributes"), dict) else {}
    source = attributes.get("colors") if isinstance(attributes.get("colors"), list) else [attributes.get("color")]
    result = []
    for value in source:
        colour = str(value or "").strip()
        if colour and colour.lower() not in {item.lower() for item in result}:
            result.append(colour)
    return result or [""]


def _variant_status(value: object, fallback: str = "active") -> str:
    status = str(value or fallback).strip().lower()
    return status if status in VARIANT_STATUSES else fallback


def _availability_status(status: object) -> str:
    """Expose admin-controlled selling state without reading inventory."""
    return "NO_STOCK" if _variant_status(status) != "active" else "IN_STOCK"


def _legacy_status(product: dict) -> str:
    # Legacy inventory/availability fields are not authoritative for the new
    # variant model. A migrated variant starts ACTIVE; Admin can explicitly
    # change it to INACTIVE or REMOVE afterwards.
    return "active"


def _variant_sizes(value: object) -> tuple[list[str], list[dict]]:
    try:
        supplied = normalise_size_inventory(value)
    except ValueError:
        supplied = []
    by_size = {entry["size"]: entry for entry in supplied}
    inventory = [
        {
            "size": size,
            "stock": max(0, int(by_size.get(size, {}).get("stock") or 0)),
            # Every standard size remains selectable. Stock does not control
            # storefront visibility or purchasing status.
            "enabled": True,
        }
        for size in STANDARD_SIZES
    ]
    return list(STANDARD_SIZES), inventory


def _images(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if isinstance(item, str) and str(item).strip()][:12]


def build_product_variants(product: dict, collections: list[dict] | tuple[dict, ...] = ()) -> dict:
    """Return canonical variant fields without mutating ``product``."""
    collection = next((item for item in collections if _is_runway_collection(item)), None) or (collections[0] if collections else {})
    prefix = collection_sku_prefix(collection)
    code = product_code(product)
    existing = [dict(item) for item in product.get("variants", []) if isinstance(item, dict)] if isinstance(product.get("variants"), list) else []
    colours = _product_colours(product)

    if existing:
        existing_slugs = {colour_slug(item.get("colour") or item.get("color")) for item in existing}
        sources = [*existing]
        sources.extend({"colour": colour} for colour in colours if colour_slug(colour) not in existing_slugs)
        generated = False
    else:
        sources = [{"colour": colour} for colour in colours]
        generated = True

    parent_media = _images(product.get("media"))
    parent_size_inventory = product.get("sizeInventory")
    default_status = _legacy_status(product)
    variants = []
    used_ids: set[str] = set()
    for index, raw in enumerate(sources):
        colour = str(raw.get("colour") or raw.get("color") or "").strip()
        slug = colour_slug(colour)
        identifier = str(raw.get("id") or f"colour:{slug.lower()}").strip()[:120]
        if not identifier or identifier in used_ids:
            identifier = f"colour:{slug.lower()}:{index + 1}"
        used_ids.add(identifier)
        sizes, size_inventory = _variant_sizes(raw.get("sizeInventory") if "sizeInventory" in raw else parent_size_inventory)
        raw_price = raw.get("price", product.get("price"))
        try:
            price = round(float(raw_price), 2) if raw_price is not None else None
        except (TypeError, ValueError):
            price = None
        images = _images(raw.get("images") if "images" in raw else raw.get("media"))
        if generated and index == 0 and not images:
            # Legacy common media is migrated to one concrete colour only; it
            # is never copied across every colour variant.
            images = parent_media
        explicit_availability = str(raw.get("availabilityStatus") or "").strip().upper()
        variant_status = _variant_status(raw.get("status"), "inactive" if explicit_availability == "NO_STOCK" else default_status)
        variants.append({
            "id": identifier,
            "sku": make_variant_sku(prefix, code, colour),
            "colour": colour,
            "colourSlug": slug.lower(),
            "images": images,
            "status": variant_status,
            "availabilityStatus": _availability_status(variant_status),
            "price": price,
            "currency": "INR",
            "stock": sum(int(entry.get("stock") or 0) for entry in size_inventory),
            "sizes": sizes,
            "sizeInventory": size_inventory,
            "metadata": dict(raw.get("metadata") or {}) if isinstance(raw.get("metadata"), dict) else {},
        })
    return {
        "productCode": code,
        "skuPrefix": prefix,
        "variantSchemaVersion": VARIANT_SCHEMA_VERSION,
        "variants": variants,
    }


def sync_product_variants(database, product: dict | ObjectId, *, force: bool = False) -> dict | None:
    """Create/reconcile variants and return the current product document."""
    document = database.products.find_one({"_id": product}) if isinstance(product, ObjectId) else product
    if not document:
        return None
    collections = list(database.collections.find(
        {"productRefs.productId": document["_id"]},
        {"name": 1, "slug": 1, "collectionType": 1, "status": 1},
    ))
    fields = build_product_variants(document, collections)
    changed = force or any(document.get(key) != value for key, value in fields.items())
    if changed:
        fields["updatedAt"] = datetime.now(timezone.utc)
        database.products.update_one({"_id": document["_id"]}, {"$set": fields})
        document = {**document, **fields}
    return document


def all_variants(product: dict) -> list[dict]:
    return [dict(item) for item in product.get("variants", []) if isinstance(item, dict)] if isinstance(product.get("variants"), list) else []


def visible_variants(product: dict) -> list[dict]:
    return [item for item in all_variants(product) if _variant_status(item.get("status")) != "remove"]


def active_variants(product: dict) -> list[dict]:
    return [item for item in visible_variants(product) if _variant_status(item.get("status")) == "active"]


def product_has_visible_variants(product: dict) -> bool:
    variants = all_variants(product)
    return bool(visible_variants(product)) if variants else True


def find_variant(product: dict, variant_id: object) -> dict | None:
    identifier = str(variant_id or "").strip()
    return next((item for item in all_variants(product) if str(item.get("id") or "") == identifier), None)


def public_variant_view(variant: dict, *, media_limit: int | None = None) -> dict:
    images = _images(variant.get("images"))
    if media_limit is not None:
        images = images[:media_limit]
    return {
        "id": str(variant.get("id") or ""),
        "sku": str(variant.get("sku") or ""),
        "colour": str(variant.get("colour") or ""),
        "colourSlug": str(variant.get("colourSlug") or ""),
        "images": images,
        "status": _variant_status(variant.get("status")),
        "availabilityStatus": _availability_status(variant.get("status")),
        "price": variant.get("price"),
        "currency": "INR",
        "stock": max(0, int(variant.get("stock") or 0)),
        "sizes": list(STANDARD_SIZES),
        "sizeInventory": _variant_sizes(variant.get("sizeInventory"))[1],
        "metadata": dict(variant.get("metadata") or {}) if isinstance(variant.get("metadata"), dict) else {},
    }
