import unittest

from bson import ObjectId

from app.catalog import NORMAL_COLLECTIONS, PRODUCT_SEEDS, collection_hero, is_excluded_collection, product_view
from app.inventory import DEFAULT_CUSTOM_SIZE_FIELDS, custom_size_fields, validate_custom_size


class CatalogTests(unittest.TestCase):
    def test_normal_collection_seed_order_matches_the_storefront_sequence(self):
        self.assertEqual([collection["name"] for collection in NORMAL_COLLECTIONS], ["Hastakala", "Inaara", "Anamika", "Naqab", "Sandook"])

    def test_aakaar_is_excluded_without_deleting_its_data(self):
        self.assertTrue(is_excluded_collection({"name": "Aakaar", "slug": "aakaar-insights"}))
        self.assertFalse(is_excluded_collection({"name": "Anamika", "slug": "collections-of-anamika"}))

    def test_product_view_preserves_central_identity_and_availability(self):
        product_id = ObjectId()
        view = product_view({"_id": product_id, "name": "Dummy Anamika", "sku": "ANAMIKA-001", "price": 120000, "stock": 5, "availability": "in_stock"})
        self.assertEqual(view["id"], str(product_id))
        self.assertEqual(view["availability"], "in_stock")
        self.assertEqual(view["pricing"]["baseCurrency"], "INR")
        self.assertEqual(view["pricing"]["fxBufferPercent"], 5)

    def test_product_view_keeps_legacy_stock_when_size_inventory_is_not_configured(self):
        view = product_view({"_id": ObjectId(), "name": "Legacy piece", "stock": 5, "availability": "in_stock", "sizeInventory": []})
        self.assertEqual(view["stock"], 5)
        self.assertFalse(view["sizeInventoryConfigured"])
        self.assertEqual(view["sizeInventory"], [])

    def test_product_view_uses_only_configured_size_quantities(self):
        view = product_view({
            "_id": ObjectId(), "name": "Sized piece", "stock": 6, "availability": "in_stock",
            "sizeInventoryConfigured": True,
            "sizeInventory": [
                {"size": "XS", "stock": 2, "enabled": True},
                {"size": "S", "stock": 0, "enabled": True},
                {"size": "M", "stock": 3, "enabled": True},
                {"size": "L", "stock": 1, "enabled": True},
                {"size": "XL", "stock": 0, "enabled": True},
            ],
        })
        self.assertEqual(view["stock"], 6)
        self.assertTrue(view["sizeInventoryConfigured"])
        self.assertEqual([entry["size"] for entry in view["sizeInventory"]], ["XS", "S", "M", "L", "XL"])

    def test_size_managed_products_get_the_generic_custom_measurement_form(self):
        product = {"sizeInventoryConfigured": True, "sizeInventory": []}
        self.assertEqual(custom_size_fields(product), list(DEFAULT_CUSTOM_SIZE_FIELDS))
        measurements = {field: "35" for field in DEFAULT_CUSTOM_SIZE_FIELDS}
        self.assertEqual(validate_custom_size(product, {"unit": "in", "measurements": measurements})["measurements"], measurements)

    def test_custom_order_products_require_the_generic_measurement_set(self):
        product = {"availability": "custom_order", "sizeInventoryConfigured": False}
        measurements = {field: "35" for field in DEFAULT_CUSTOM_SIZE_FIELDS}
        self.assertEqual(len(custom_size_fields(product)), len(DEFAULT_CUSTOM_SIZE_FIELDS))
        with self.assertRaises(ValueError):
            validate_custom_size(product, {"unit": "cm", "measurements": {"Bust": "35"}})
        self.assertIsNotNone(validate_custom_size(product, {"unit": "cm", "measurements": measurements}))

    def test_legacy_collection_image_is_normalized_to_reusable_hero(self):
        hero = collection_hero({"heroImage": "https://example.com/hero.jpg"})
        self.assertEqual(hero["type"], "image")
        self.assertEqual(hero["image"], "https://example.com/hero.jpg")
        self.assertEqual(hero["poster"], "https://example.com/hero.jpg")
        self.assertEqual(hero["layout"], "media_dominant")

    def test_video_hero_configuration_is_preserved(self):
        hero = collection_hero({"hero": {"type": "video", "video": "https://example.com/film.mp4", "poster": "https://example.com/poster.jpg", "layout": "full_bleed"}})
        self.assertEqual(hero["type"], "video")
        self.assertEqual(hero["video"], "https://example.com/film.mp4")
        self.assertEqual(hero["layout"], "full_bleed")

    def test_real_product_seeds_keep_the_requested_collection_and_media(self):
        seeds = {seed["name"]: seed for seed in PRODUCT_SEEDS}
        self.assertEqual(seeds["173 - Hot Pink"]["collectionSlug"], "collections-of-hasthkala")
        self.assertEqual(seeds["186 - Ivory"]["collectionSlug"], "collections-of-inaara")
        self.assertEqual(seeds["173 - Hot Pink"]["sku"], "HK-173-HP")
        self.assertEqual(seeds["186 - Ivory"]["sku"], "IA-186-IV")
        for seed_name in ("173 - Hot Pink", "186 - Ivory"):
            self.assertGreaterEqual(seeds[seed_name]["price"], 100000)
            self.assertLessEqual(seeds[seed_name]["price"], 150000)
        self.assertEqual(len(seeds["173 - Hot Pink"]["media"]), 5)
        self.assertEqual(len(seeds["186 - Ivory"]["media"]), 2)


if __name__ == "__main__":
    unittest.main()
