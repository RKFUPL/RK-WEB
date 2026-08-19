import unittest
from datetime import datetime, timezone

from bson import ObjectId

from app.catalog import ANAMIKA_PRODUCT_SEEDS, NORMAL_COLLECTIONS, PRODUCT_SEEDS, _product_seed_document, collection_hero, is_excluded_collection, is_runway_collection, product_view
from app.inventory import DEFAULT_CUSTOM_SIZE_FIELDS, STANDARD_SIZES, custom_size_fields, validate_custom_size


class CatalogTests(unittest.TestCase):
    def test_normal_collection_seed_order_matches_the_storefront_sequence(self):
        self.assertEqual([collection["name"] for collection in NORMAL_COLLECTIONS], ["Hastakala", "Inaara", "Anamika", "Naqab", "Sandook"])
        anamika = next(collection for collection in NORMAL_COLLECTIONS if collection["name"] == "Anamika")
        self.assertTrue(anamika["taxInclusive"])

    def test_aakaar_is_excluded_without_deleting_its_data(self):
        self.assertTrue(is_excluded_collection({"name": "Aakaar", "slug": "aakaar-insights"}))
        self.assertFalse(is_excluded_collection({"name": "Anamika", "slug": "collections-of-anamika"}))

    def test_runway_identity_is_collection_driven(self):
        self.assertTrue(is_runway_collection({"collectionType": "runway", "name": "Espiritu Libre @LFW"}))
        self.assertTrue(is_runway_collection({"name": "Runway"}))
        self.assertTrue(is_runway_collection({"slug": "the-runway-exclusive"}))
        self.assertFalse(is_runway_collection({"name": "Anamika", "slug": "collections-of-anamika"}))

    def test_product_view_preserves_central_identity_and_availability(self):
        product_id = ObjectId()
        view = product_view({"_id": product_id, "name": "Dummy Anamika", "sku": "ANAMIKA-001", "price": 120000, "stock": 5, "availability": "in_stock"})
        self.assertEqual(view["id"], str(product_id))
        self.assertEqual(view["availability"], "in_stock")
        self.assertEqual(view["pricing"]["baseCurrency"], "INR")
        self.assertEqual(view["pricing"]["fxBufferPercent"], 5)

    def test_product_view_exposes_gst_inclusive_mrp_metadata(self):
        view = product_view({"_id": ObjectId(), "name": "Anamika piece", "price": 85000, "stock": 0, "availability": "sold_out", "mrpIncludesGst": True})
        self.assertTrue(view["taxInclusive"])
        self.assertTrue(view["mrpIncludesGst"])

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

    def test_custom_size_configuration_can_explicitly_disable_measurements(self):
        product = {"sizeInventoryConfigured": True, "customSizeConfig": {"enabled": False}}
        self.assertEqual(custom_size_fields(product), [])

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

    def test_anamika_seed_contains_every_approved_product_and_omits_ck_42(self):
        expected_codes = [
            "CK-45", "CK-05", "CK-55", "CK-56 A", "CK-44", "CK-27", "CK-36", "CK-17",
            "CK-49", "CK-50", "CK-51", "CK-53", "CK-10A", "CK-64", "CK-63", "CK-62",
        ]
        self.assertEqual([seed["name"] for seed in ANAMIKA_PRODUCT_SEEDS], expected_codes)
        self.assertNotIn("CK-42", expected_codes)
        self.assertEqual([seed["displayOrder"] for seed in ANAMIKA_PRODUCT_SEEDS], list(range(1, 17)))
        self.assertEqual(len({seed["seedKey"] for seed in ANAMIKA_PRODUCT_SEEDS}), 16)
        self.assertEqual(len({seed["slug"] for seed in ANAMIKA_PRODUCT_SEEDS}), 16)

    def test_anamika_seed_prices_and_colours_match_the_line_sheets(self):
        expected = {
            "CK-45": (85000, ["BLACK", "IVORY"]),
            "CK-05": (78000, ["BLACK", "BERRY"]),
            "CK-55": (98000, ["IVORY"]),
            "CK-56 A": (78000, ["BLACK", "ASH GREY"]),
            "CK-44": (88000, ["BLACK", "DUSTY IVORY", "TEAL"]),
            "CK-27": (78000, ["IVORY", "ASH GREY"]),
            "CK-36": (78000, ["DUSTY IVORY", "BLACK", "ASH BLUE"]),
            "CK-17": (158000, ["LILAC"]),
            "CK-49": (88000, ["IVORY"]),
            "CK-50": (128000, ["POWDER PINK"]),
            "CK-51": (138000, ["ASH BLUE"]),
            "CK-53": (68000, ["DUSTY IVORY", "ASH BLUE", "BLACK"]),
            "CK-10A": (148000, ["LILAC"]),
            "CK-64": (85000, ["Taupe", "Ash grey"]),
            "CK-63": (98000, ["Ivory"]),
            "CK-62": (85000, ["Ivory"]),
        }
        self.assertEqual(
            {seed["name"]: (seed["price"], seed["colors"]) for seed in ANAMIKA_PRODUCT_SEEDS},
            expected,
        )

    def test_every_anamika_seed_builds_a_complete_sellable_product_record(self):
        now = datetime.now(timezone.utc)
        for seed in ANAMIKA_PRODUCT_SEEDS:
            with self.subTest(product=seed["name"]):
                self.assertEqual(seed["collectionSlug"], "collections-of-anamika")
                self.assertEqual(seed["name"], seed["sku"])
                self.assertTrue(seed["description"].strip())
                self.assertNotIn("placeholder", seed["description"].lower())
                self.assertTrue(seed["colors"])
                self.assertGreater(seed["price"], 0)
                self.assertEqual(seed["sizes"], list(STANDARD_SIZES))
                document = _product_seed_document(seed, now)
                self.assertEqual(document["name"], seed["name"])
                self.assertEqual(document["description"], seed["description"])
                self.assertEqual(document["attributes"]["colors"], seed["colors"])
                self.assertEqual(document["attributes"]["sizes"], list(STANDARD_SIZES))
                self.assertEqual([item["size"] for item in document["sizeInventory"]], list(STANDARD_SIZES))
                self.assertTrue(all(item["enabled"] and item["stock"] == 0 for item in document["sizeInventory"]))
                self.assertTrue(document["sizeInventoryConfigured"])
                self.assertTrue(document["taxInclusive"])
                self.assertTrue(document["mrpIncludesGst"])
                self.assertEqual(document["availability"], "sold_out")
                self.assertEqual(document["category"], "Couture")
                self.assertEqual(document["media"], [])
                self.assertTrue(document["customSizeConfig"]["enabled"])

    def test_ck_56_a_keeps_the_owner_approved_temporary_description(self):
        seed = next(seed for seed in ANAMIKA_PRODUCT_SEEDS if seed["name"] == "CK-56 A")
        self.assertEqual(seed["description"], "ana work, box pleat detailing on p")


if __name__ == "__main__":
    unittest.main()
