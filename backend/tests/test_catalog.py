import unittest

from bson import ObjectId

from app.catalog import collection_hero, is_excluded_collection, product_view


class CatalogTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
