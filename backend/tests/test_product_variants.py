import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from bson import ObjectId

from app.blueprints.payments.routes import _checkout_items
from app.catalog import product_view
from app.inventory import DEFAULT_CUSTOM_SIZE_FIELDS, STANDARD_SIZES
from app.product_variants import (
    build_product_variants,
    collection_sku_prefix,
    make_variant_sku,
    product_has_visible_variants,
)


ANAMIKA = {"_id": ObjectId(), "name": "Anamika", "slug": "collections-of-anamika", "collectionType": "standard"}


def product_with_variants(*, statuses=("active", "active"), stocks=(0, 0)):
    product = {
        "_id": ObjectId(),
        "name": "CK-45",
        "sku": "CK-45",
        "price": 85000,
        "status": "active",
        "isActive": True,
        "availability": "in_stock",
        "media": ["https://example.com/black-1.jpg", "https://example.com/black-2.jpg"],
        "attributes": {"colors": ["BLACK", "IVORY"], "sizes": list(STANDARD_SIZES)},
        "sizeInventoryConfigured": True,
        "sizeInventory": [{"size": size, "stock": 0, "enabled": True} for size in STANDARD_SIZES],
        "customSizeConfig": {"enabled": True, "fields": list(DEFAULT_CUSTOM_SIZE_FIELDS)},
    }
    product.update(build_product_variants(product, [ANAMIKA]))
    for index, variant in enumerate(product["variants"]):
        variant["status"] = statuses[index]
        variant["stock"] = stocks[index]
        variant["sizeInventory"][0]["stock"] = stocks[index]
    return product


class VariantDatabase:
    def __init__(self, product):
        self.product = product
        self.products = SimpleNamespace(
            find_one=MagicMock(side_effect=lambda *_args, **_kwargs: self.product),
            update_one=MagicMock(return_value=SimpleNamespace(modified_count=1)),
        )
        self.collections = SimpleNamespace(find=MagicMock(return_value=[ANAMIKA]))


class ProductVariantTests(unittest.TestCase):
    def test_collection_prefixes_are_central_and_skus_are_normalised(self):
        self.assertEqual(collection_sku_prefix({"name": "Hastakala"}), "HK")
        self.assertEqual(collection_sku_prefix(ANAMIKA), "AK")
        self.assertEqual(collection_sku_prefix({"collectionType": "runway", "name": "Espiritu Libre @LFW"}), "RW")
        self.assertEqual(make_variant_sku("AK", "CK-45", "Ash Grey"), "AK-CK45-ASH-GREY")

    def test_multiple_colours_create_distinct_skus_and_galleries(self):
        product = product_with_variants()
        black, ivory = product["variants"]
        self.assertEqual([black["sku"], ivory["sku"]], ["AK-CK45-BLACK", "AK-CK45-IVORY"])
        self.assertEqual(black["images"], product["media"])
        self.assertEqual(ivory["images"], [])
        self.assertIsNot(black["images"], ivory["images"])

    def test_active_zero_inventory_is_purchasable_and_keeps_all_sizes(self):
        product = product_with_variants(statuses=("active", "inactive"), stocks=(0, 10))
        view = product_view(product)
        self.assertEqual(view["availability"], "in_stock")
        self.assertEqual(view["variants"][0]["status"], "active")
        self.assertEqual(view["variants"][0]["stock"], 0)
        self.assertEqual(view["variants"][0]["sizes"], list(STANDARD_SIZES))
        self.assertTrue(all(item["enabled"] for item in view["variants"][0]["sizeInventory"]))

    def test_inactive_inventory_remains_visible_but_is_sold_out(self):
        product = product_with_variants(statuses=("inactive", "remove"), stocks=(10, 10))
        view = product_view(product)
        self.assertEqual(view["availability"], "sold_out")
        self.assertEqual(len(view["variants"]), 1)
        self.assertEqual(view["variants"][0]["status"], "inactive")
        self.assertEqual(view["variants"][0]["stock"], 10)

    def test_remove_is_hidden_and_all_removed_parent_is_not_discoverable(self):
        product = product_with_variants(statuses=("remove", "remove"))
        self.assertFalse(product_has_visible_variants(product))
        self.assertEqual(product_view(product)["variants"], [])

    def test_checkout_accepts_active_zero_stock_and_uses_server_variant_snapshot(self):
        product = product_with_variants(statuses=("active", "inactive"), stocks=(0, 10))
        db = VariantDatabase(product)
        black = product["variants"][0]
        items, subtotal = _checkout_items(db, [{
            "productId": str(product["_id"]),
            "variantId": black["id"],
            "sku": black["sku"],
            "quantity": 2,
            "size": "M",
            "purchaseMode": "standard_size",
        }])
        self.assertEqual(subtotal, 170000)
        self.assertEqual(items[0]["sku"], "AK-CK45-BLACK")
        self.assertEqual(items[0]["colour"], "BLACK")
        self.assertEqual(items[0]["image"], "https://example.com/black-1.jpg")
        self.assertEqual(items[0]["unitPrice"], 85000)

    def test_checkout_rejects_inactive_variant_even_with_inventory(self):
        product = product_with_variants(statuses=("active", "inactive"), stocks=(0, 10))
        db = VariantDatabase(product)
        ivory = product["variants"][1]
        with self.assertRaisesRegex(ValueError, "sold out"):
            _checkout_items(db, [{"productId": str(product["_id"]), "variantId": ivory["id"], "sku": ivory["sku"], "quantity": 1, "size": "S"}])

    def test_checkout_rejects_tampered_sku(self):
        product = product_with_variants()
        db = VariantDatabase(product)
        black = product["variants"][0]
        with self.assertRaisesRegex(ValueError, "SKU does not match"):
            _checkout_items(db, [{"productId": str(product["_id"]), "variantId": black["id"], "sku": "AK-CK45-IVORY", "quantity": 1, "size": "S"}])

    def test_custom_measurements_are_preserved_individually(self):
        product = product_with_variants()
        db = VariantDatabase(product)
        black = product["variants"][0]
        measurements = {field: str(30 + index) for index, field in enumerate(DEFAULT_CUSTOM_SIZE_FIELDS)}
        items, _ = _checkout_items(db, [{
            "productId": str(product["_id"]),
            "variantId": black["id"],
            "sku": black["sku"],
            "quantity": 1,
            "purchaseMode": "custom_size",
            "customSize": {"unit": "in", "measurements": measurements},
        }])
        self.assertEqual(items[0]["customSize"], {"unit": "in", "measurements": measurements})


if __name__ == "__main__":
    unittest.main()
