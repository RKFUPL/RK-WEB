"""Shared inventory rules for catalogue, staff, and checkout flows.

Products have two deliberately different inventory modes:

* ``legacy`` uses the existing product-level ``stock`` field.
* ``size`` uses the explicit ``sizeInventoryConfigured`` flag and the
  per-size quantities.

The explicit flag is important. An absent size array is not the same thing as
an intentionally configured array whose quantities are all zero.
"""

from __future__ import annotations

from collections.abc import Iterable


STANDARD_SIZES = ("XS", "S", "M", "L", "XL")
DEFAULT_CUSTOM_SIZE_FIELDS = (
    "Bust",
    "Waist",
    "Hip",
    "Shoulder",
    "Armhole",
    "Sleeve Length",
    "Height",
    "Blouse/Top Length",
    "Bottom Length",
    "Inseam",
)


def size_label(value: object) -> str:
    return str(value or "").strip().upper()[:20]


def inventory_mode(product: dict) -> str:
    """Return the canonical inventory mode for a product.

    ``sizeInventoryConfigured`` is the current field. The two older fields
    are read only as backwards-compatible fallbacks so existing documents are
    not accidentally converted to size-managed products.
    """
    if "sizeInventoryConfigured" in product:
        return "size" if bool(product.get("sizeInventoryConfigured")) else "legacy"
    if "sizeSystemEnabled" in product:
        return "size" if bool(product.get("sizeSystemEnabled")) else "legacy"
    return "size" if isinstance(product.get("sizeInventory"), (list, dict)) and bool(product.get("sizeInventory")) else "legacy"


def has_size_system(product: dict) -> bool:
    return inventory_mode(product) == "size"


def normalise_size_inventory(value: object, *, default_enabled: bool = True) -> list[dict]:
    """Normalize staff/frontend payloads to [{size, stock, enabled}]."""
    entries: list[dict] = []
    source: Iterable = value.values() if isinstance(value, dict) else value if isinstance(value, list) else []
    for raw in source:
        if isinstance(raw, str):
            raw = {"size": raw, "stock": 0}
        if not isinstance(raw, dict):
            continue
        label = size_label(raw.get("size") or raw.get("label") or raw.get("name"))
        if not label or any(item["size"] == label for item in entries):
            continue
        try:
            stock = int(raw.get("stock", 0))
        except (TypeError, ValueError):
            stock = -1
        if stock < 0:
            raise ValueError("Size quantities cannot be negative.")
        entries.append({"size": label, "stock": stock, "enabled": bool(raw.get("enabled", default_enabled))})
    return entries


def default_size_inventory() -> list[dict]:
    return [{"size": size, "stock": 0, "enabled": True} for size in STANDARD_SIZES]


def product_size_inventory(product: dict) -> list[dict]:
    if not has_size_system(product):
        return []
    return normalise_size_inventory(product.get("sizeInventory"))


def total_size_stock(product: dict) -> int:
    return sum(int(item.get("stock") or 0) for item in product_size_inventory(product) if item.get("enabled", True))


def stock_for_size(product: dict, size: object) -> int | None:
    label = size_label(size)
    for item in product_size_inventory(product):
        if item["size"] == label and item.get("enabled", True):
            return int(item.get("stock") or 0)
    return None


def custom_size_fields(product: dict) -> list[str]:
    config = product.get("customSizeConfig")
    if not isinstance(config, dict):
        attributes = product.get("attributes") if isinstance(product.get("attributes"), dict) else {}
        config = attributes.get("customSizeConfig") if isinstance(attributes.get("customSizeConfig"), dict) else {}
    fields = config.get("fields") if isinstance(config.get("fields"), list) else DEFAULT_CUSTOM_SIZE_FIELDS if has_size_system(product) or str(product.get("availability") or "").lower() == "custom_order" else []
    return [str(field).strip()[:50] for field in fields if str(field).strip()][:16]


def validate_custom_size(product: dict, value: object) -> dict | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("Custom measurements must be an object.")
    unit = str(value.get("unit") or "cm").strip().lower()
    if unit not in {"cm", "in"}:
        raise ValueError("Custom measurements must use cm or in.")
    measurements = value.get("measurements")
    if not isinstance(measurements, dict):
        raise ValueError("Enter the requested custom measurements.")
    fields = custom_size_fields(product)
    if fields and any(not str(measurements.get(field) or "").strip() for field in fields):
        raise ValueError("Complete every required custom measurement.")
    cleaned = {}
    for key, raw in measurements.items():
        label = str(key).strip()[:50]
        text = str(raw or "").strip()[:40]
        if not label or not text:
            continue
        try:
            number = float(text)
        except ValueError:
            raise ValueError("Custom measurements must be numeric.")
        if number <= 0 or number > 500:
            raise ValueError("Custom measurements must be between 0 and 500.")
        cleaned[label] = text
    if fields and len(cleaned) < len(fields):
        raise ValueError("Complete every required custom measurement.")
    if not cleaned:
        raise ValueError("Enter at least one custom measurement.")
    return {"unit": unit, "measurements": cleaned}
