import unittest
from datetime import datetime, timezone
from unittest.mock import ANY, MagicMock, patch

from bson import ObjectId
from flask import Flask

from app.catalog import AAKAAR_COLLECTION_SEED, AAKAAR_PRODUCT_SEEDS, ANAMIKA_PRODUCT_SEEDS, HASTAKALA_PRODUCT_SEEDS, NORMAL_COLLECTIONS, PRODUCT_SEEDS, _ensure_compatible_index, _product_seed_document, collection_hero, collection_view, ensure_catalog_seed, is_excluded_collection, is_runway_collection, product_card_view, product_view
from app.blueprints.catalog.routes import catalog_bp
from app.inventory import DEFAULT_CUSTOM_SIZE_FIELDS, STANDARD_SIZES, custom_size_fields, validate_custom_size
from app.workdrive import WorkDriveDownload


class CatalogTests(unittest.TestCase):
    def test_catalog_startup_does_not_create_legacy_seed_products(self):
        database = MagicMock()
        database.collections.find.return_value = []
        database.collections.find_one.return_value = None
        database.collections.insert_one.return_value.inserted_id = ObjectId()
        database.products.find.return_value = []
        database.catalog_migrations.find_one.return_value = {"_id": "all-current-variants-active-v1"}

        with patch("app.catalog.ensure_catalog_indexes"):
            ensure_catalog_seed(database)

        database.products.insert_one.assert_not_called()
        database.products.update_one.assert_not_called()

    def test_catalog_startup_preserves_existing_products_without_seed_overwrite(self):
        product_id = ObjectId()
        existing = {"_id": product_id, "name": "Existing product", "sku": "REAL-001", "stock": 4, "sizeInventory": []}
        database = MagicMock()
        database.collections.find.return_value = []
        database.collections.find_one.return_value = None
        database.collections.insert_one.return_value.inserted_id = ObjectId()
        database.products.find.return_value = [existing]
        database.catalog_migrations.find_one.return_value = {"_id": "all-current-variants-active-v1"}

        with patch("app.catalog.ensure_catalog_indexes"):
            ensure_catalog_seed(database)

        database.products.insert_one.assert_not_called()
        for call in database.products.update_one.call_args_list:
            update = call.args[1].get("$set", {})
            self.assertNotIn("name", update)
            self.assertNotIn("sku", update)
            self.assertNotIn("price", update)

    def test_storefront_collection_index_uses_managed_database_collections(self):
        app = Flask(__name__)
        app.register_blueprint(catalog_bp, url_prefix="/api/catalog")
        collection = {"_id": ObjectId(), "name": "Database Collection", "slug": "database-collection"}
        rendered = {"id": str(collection["_id"]), "name": collection["name"], "slug": collection["slug"], "productCount": 3}

        database = MagicMock()
        database.collections.find.return_value = [collection]
        with patch("app.blueprints.catalog.routes.database", return_value=database), \
             patch("app.blueprints.catalog.routes.collection_view", return_value=rendered) as view:
            response = app.test_client().get("/api/catalog/collections")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"collections": [rendered], "count": 1})
        view.assert_called_once_with(ANY, collection, include_products=False)

    def test_equivalent_named_index_is_reused_without_recreation(self):
        class ExistingIndexCollection:
            def __init__(self):
                self.created = []

            def index_information(self):
                return {"_id_": {"key": [("_id", 1)]}, "legacy_slug_lookup": {"key": [("slug", 1)]}}

            def create_index(self, keys, **options):
                self.created.append((keys, options))
                return options.get("name")

        collection = ExistingIndexCollection()
        name = _ensure_compatible_index(collection, "slug", "catalog_collection_slug")
        self.assertEqual(name, "legacy_slug_lookup")
        self.assertEqual(collection.created, [])

    def test_collection_uses_current_product_media_and_reference_order(self):
        first_id, second_id = ObjectId(), ObjectId()
        products = [
            {"_id": first_id, "name": "First", "sku": "ONE", "status": "active", "isActive": True, "availability": "in_stock", "media": ["https://example.com/current-one.jpg"]},
            {"_id": second_id, "name": "Second", "sku": "TWO", "status": "active", "isActive": True, "availability": "in_stock", "media": ["https://example.com/current-two.jpg"]},
        ]

        class Products:
            def find(self, *_args, **_kwargs):
                return products

        collection = {"_id": ObjectId(), "name": "Aakaar", "slug": "aakaar", "productRefs": [{"productId": first_id, "displayOrder": 20}, {"productId": second_id, "displayOrder": 10}]}
        payload = collection_view(type("DB", (), {"products": Products()})(), collection)
        self.assertEqual([product["name"] for product in payload["products"]], ["Second", "First"])
        self.assertEqual(payload["products"][0]["media"], ["https://example.com/current-two.jpg"])

    def test_product_media_falls_back_from_empty_variant_to_structured_cloudinary(self):
        product = {
            "_id": ObjectId(), "name": "Synced product", "sku": "SYNC-1", "status": "active", "isActive": True,
            "variants": [{"id": "one", "sku": "SYNC-1-A", "colour": "Ivory", "status": "active", "images": []}],
            "catalogMedia": [{
                "media_id": "cloud-1", "provider": "cloudinary", "owner_system": "rk-stock",
                "public_id": "rk/cloud-1", "secure_url": "https://res.cloudinary.com/rk/image/upload/cloud-1.jpg",
                "position": 0, "is_primary": True,
            }],
        }

        payload = product_card_view(product)

        self.assertEqual(payload["media"], ["https://res.cloudinary.com/rk/image/upload/cloud-1.jpg"])
        self.assertEqual(payload["catalogMedia"][0]["provider"], "cloudinary")
        self.assertEqual(payload["catalogMedia"][0]["owner_system"], "rk-stock")

    def test_workdrive_catalog_media_uses_product_bound_proxy_not_permalink(self):
        product_id = ObjectId()
        permalink = "https://workdrive.zoho.in/file/private123"
        payload = product_view({
            "_id": product_id, "name": "WorkDrive product", "sku": "WD-1", "status": "active", "isActive": True,
            "catalogMedia": [{
                "media_id": "wd-1", "provider": "zoho_workdrive", "owner_system": "rk-stock",
                "permalink": permalink, "position": 0, "is_primary": True,
            }],
        })

        expected = f"/api/catalog/products/{product_id}/media/wd-1"
        self.assertEqual(payload["media"], [expected])
        self.assertEqual(payload["catalogMedia"][0]["renderUrl"], expected)
        self.assertNotIn(permalink, payload["media"])

    def test_product_media_proxy_downloads_only_media_attached_to_product(self):
        app = Flask(__name__)
        app.register_blueprint(catalog_bp, url_prefix="/api/catalog")
        product_id = ObjectId()
        product = {
            "_id": product_id, "status": "active", "isActive": True,
            "catalogMedia": [{
                "media_id": "wd-1", "provider": "zoho_workdrive", "type": "image",
                "permalink": "https://workdrive.zoho.in/file/private123",
            }],
        }
        upstream = MagicMock()
        upstream.headers = {"Content-Type": "image/jpeg"}
        upstream.iter_content.return_value = [b"image-bytes"]
        database = MagicMock()

        with patch("app.blueprints.catalog.routes.database", return_value=database), \
             patch("app.blueprints.catalog.routes.product_document", return_value=product), \
             patch("app.blueprints.catalog.routes.download_file", return_value=WorkDriveDownload(upstream, "private123")) as download:
            response = app.test_client().get(f"/api/catalog/products/{product_id}/media/wd-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content_type, "image/jpeg")
        self.assertEqual(response.data, b"image-bytes")
        self.assertEqual(response.headers["Cache-Control"], "private, max-age=300")
        download.assert_called_once_with("https://workdrive.zoho.in/file/private123", database, prefer_preview=True)

        with patch("app.blueprints.catalog.routes.database", return_value=database), \
             patch("app.blueprints.catalog.routes.product_document", return_value=product), \
             patch("app.blueprints.catalog.routes.download_file") as download:
            missing = app.test_client().get(f"/api/catalog/products/{product_id}/media/not-attached")
        self.assertEqual(missing.status_code, 404)
        download.assert_not_called()

    def test_normal_collection_seed_order_matches_the_storefront_sequence(self):
        self.assertEqual([collection["name"] for collection in NORMAL_COLLECTIONS], ["Hastakala", "Inaara", "Anamika", "Naqab", "Sandook"])
        anamika = next(collection for collection in NORMAL_COLLECTIONS if collection["name"] == "Anamika")
        self.assertTrue(anamika["taxInclusive"])

    def test_aakaar_catalog_is_public_while_legacy_aakaar_pages_remain_excluded(self):
        self.assertFalse(is_excluded_collection(AAKAAR_COLLECTION_SEED))
        self.assertTrue(is_excluded_collection({"name": "Aakaar", "slug": "aakaar-insights"}))
        self.assertTrue(is_excluded_collection({"name": "Aakaar", "slug": "collections-of-aakaar"}))
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

    def test_hastakala_seed_contains_the_seven_requested_products(self):
        expected_codes = ["CK-155-A", "CK-155", "CK-171", "CK-172", "CK-173", "CK-184", "CK-186"]
        self.assertEqual([seed["name"] for seed in HASTAKALA_PRODUCT_SEEDS], expected_codes)
        self.assertEqual([seed["displayOrder"] for seed in HASTAKALA_PRODUCT_SEEDS], list(range(1, 8)))
        self.assertEqual(len({seed["seedKey"] for seed in HASTAKALA_PRODUCT_SEEDS}), 7)
        self.assertEqual(len({seed["slug"] for seed in HASTAKALA_PRODUCT_SEEDS}), 7)
        self.assertEqual(sum(len(seed["colors"]) for seed in HASTAKALA_PRODUCT_SEEDS), 24)
        self.assertTrue(all(seed["collectionSlug"] == "collections-of-hasthkala" for seed in HASTAKALA_PRODUCT_SEEDS))

    def test_aakaar_seed_contains_the_twenty_requested_indian_products(self):
        expected_names = [
            "Aarohi", "Ananya", "Avani", "Charvi", "Devika", "Eshani", "Ira", "Kavya",
            "Lavanya", "Malvika", "Mrinalini", "Nandini", "Padma", "Rajeshwari", "Ruhika",
            "Sharanya", "Tarini", "Vaidehi", "Vasanti", "Yamini",
        ]
        self.assertEqual([seed["name"] for seed in AAKAAR_PRODUCT_SEEDS], expected_names)
        self.assertEqual([seed["styleCode"] for seed in AAKAAR_PRODUCT_SEEDS], [f"IND-{index:02d}" for index in range(1, 21)])
        self.assertTrue(all(seed["collectionSlug"] == "aakaar" for seed in AAKAAR_PRODUCT_SEEDS))
        self.assertTrue(all(seed["style"] == "Indian" for seed in AAKAAR_PRODUCT_SEEDS))
        self.assertEqual(sum(bool(seed["media"]) for seed in AAKAAR_PRODUCT_SEEDS), 3)
        self.assertTrue(all(seed["price"] is None and seed["colors"] == [] and seed["description"] == "" for seed in AAKAAR_PRODUCT_SEEDS))

    def test_aakaar_seed_documents_keep_only_the_supplied_preview_media(self):
        now = datetime.now(timezone.utc)
        for index, seed in enumerate(AAKAAR_PRODUCT_SEEDS):
            with self.subTest(product=seed["name"]):
                document = _product_seed_document(seed, now)
                self.assertEqual(document["styleCode"], f"IND-{index + 1:02d}")
                self.assertEqual(document["style"], "Indian")
                self.assertEqual(document["price"], None)
                self.assertEqual(document["stock"], 0)
                self.assertEqual(document["availability"], "in_stock")
                self.assertEqual(document["description"], "")
                self.assertEqual(document["attributes"]["colors"], [])
                self.assertEqual(document["variants"], [])

    def test_hastakala_seed_prices_and_colours_match_the_brief(self):
        expected = {
            "CK-155-A": (135000, ["HOT PINK", "PURPLE", "ROYAL BLUE"]),
            "CK-155": (135000, ["RED"]),
            "CK-171": (118684, ["BOTTLE GREEN", "HOT PINK", "PURPLE", "RED", "ROYAL BLUE"]),
            "CK-172": (161004, ["BOTTLE GREEN", "HOT PINK", "PURPLE", "RED", "ROYAL BLUE"]),
            "CK-173": (150424, ["HOT PINK", "PURPLE", "RED", "ROYAL BLUE"]),
            "CK-184": (103684, ["BOTTLE GREEN", "RED"]),
            "CK-186": (108104, ["BOTTLE GREEN", "HOT PINK", "PURPLE", "ROYAL BLUE"]),
        }
        self.assertEqual(
            {seed["name"]: (seed["price"], seed["colors"]) for seed in HASTAKALA_PRODUCT_SEEDS},
            expected,
        )

    def test_hastakala_seed_builds_zero_stock_in_stock_products_without_media(self):
        now = datetime.now(timezone.utc)
        for seed in HASTAKALA_PRODUCT_SEEDS:
            with self.subTest(product=seed["name"]):
                document = _product_seed_document(seed, now)
                self.assertEqual(document["name"], seed["name"])
                self.assertEqual(document["sku"], seed["sku"])
                self.assertEqual(document["price"], seed["price"])
                self.assertEqual(document["description"], "")
                self.assertEqual(document["attributes"]["colors"], seed["colors"])
                self.assertEqual(document["attributes"]["sizes"], list(STANDARD_SIZES))
                self.assertEqual(document["media"], [])
                self.assertEqual(document["stock"], 0)
                self.assertEqual(document["availability"], "in_stock")
                self.assertTrue(document["sizeInventoryConfigured"])
                self.assertTrue(document["taxInclusive"])
                self.assertTrue(document["mrpIncludesGst"])
                self.assertEqual(len(document["variants"]), len(seed["colors"]))
                self.assertTrue(all(item["status"] == "active" for item in document["variants"]))
                self.assertTrue(all(item["availabilityStatus"] == "IN_STOCK" for item in document["variants"]))
                self.assertTrue(all(item["images"] == [] for item in document["variants"]))
                self.assertTrue(all(item["stock"] == 0 for item in document["variants"]))

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
