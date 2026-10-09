import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from flask import Flask

from app.blueprints.admin.routes import LOOKBOOK_COVER_DEFAULTS, LOOKBOOK_DEFAULTS, _valid_lookbook_url, storefront_lookbooks_bp
from app.workdrive import WorkDriveDownload, WorkDriveUnavailable, external_share_id_from_permalink, file_id_from_permalink
from app import create_app


class LookbookSettingsTests(unittest.TestCase):
    def test_active_defaults_are_complete_and_exclude_naqab(self):
        self.assertEqual(set(LOOKBOOK_DEFAULTS), {"Aakaar", "Anamika", "Espiritu Libre", "Sandook", "Inaara", "Hastakala"})
        self.assertEqual(set(LOOKBOOK_COVER_DEFAULTS), set(LOOKBOOK_DEFAULTS))
        self.assertNotIn("Naqab", LOOKBOOK_DEFAULTS)
        self.assertEqual(LOOKBOOK_COVER_DEFAULTS["Aakaar"], "https://workdrive.zoho.in/file/45kaa867c2b2ac8014d029e0d6cef5b83bf22")
        self.assertEqual(LOOKBOOK_DEFAULTS["Aakaar"], "https://workdrive.zoho.in/file/45kaa5bb2ec1299cc4455a639950850e76546")
        self.assertEqual(LOOKBOOK_DEFAULTS["Hastakala"], "https://workdrive.zoho.in/file/gl0sa74334f9a5230420a9bb10250c4055028")
        self.assertEqual(LOOKBOOK_DEFAULTS["Sandook"], "https://lookbook.rashikapoor.co.in/catalog/sandook?page=1")

    def test_url_validation_allows_http_https_and_blank_only(self):
        for value in ("", "https://lookbook.rashikapoor.co.in/catalog/sandook?page=1", "http://example.com"):
            with self.subTest(value=value):
                self.assertTrue(_valid_lookbook_url(value))
        for value in ("javascript:alert(1)", "//example.com", "not-a-url", "https://user:password@example.com"):
            with self.subTest(value=value):
                self.assertFalse(_valid_lookbook_url(value))

    def test_admin_endpoint_requires_authentication(self):
        response = create_app().test_client().get("/api/admin/lookbooks")
        self.assertEqual(response.status_code, 401)

    def test_public_response_includes_aakaar_cover_and_destination(self):
        class Settings:
            @staticmethod
            def find_one(_query):
                return {}

        app = Flask(__name__)
        app.register_blueprint(storefront_lookbooks_bp, url_prefix="/api")
        with patch("app.blueprints.admin.routes.database", return_value=type("DB", (), {"admin_settings": Settings()})()):
            payload = app.test_client().get("/api/lookbooks").get_json()

        self.assertEqual(payload["lookbookCovers"]["Aakaar"], LOOKBOOK_COVER_DEFAULTS["Aakaar"])
        self.assertEqual(payload["lookbooks"]["Aakaar"], LOOKBOOK_DEFAULTS["Aakaar"])
        self.assertEqual(payload["lookbookCoverAssetUrls"]["Aakaar"], "/api/lookbooks/aakaar/cover")
        self.assertEqual(payload["lookbookAssetUrls"]["Aakaar"], "/api/lookbooks/aakaar/file")

    def test_workdrive_permalink_parser_is_restricted_to_india_file_links(self):
        self.assertEqual(file_id_from_permalink(LOOKBOOK_COVER_DEFAULTS["Aakaar"]), "45kaa867c2b2ac8014d029e0d6cef5b83bf22")
        self.assertIsNone(file_id_from_permalink("https://example.com/file/45kaa867c2b2ac8014d029e0d6cef5b83bf22"))
        self.assertIsNone(file_id_from_permalink("https://workdrive.zoho.in/folder/45kaa867c2b2ac8014d029e0d6cef5b83bf22"))

    def test_external_share_parser_accepts_only_zoho_external_links(self):
        share_id = "063dad8186a865231e618d65da727a6dcb1cc1729623dbf26ba222ae8b3e865d"
        self.assertEqual(external_share_id_from_permalink(f"https://workdrive.zohoexternal.in/external/{share_id}"), share_id)
        self.assertEqual(external_share_id_from_permalink("https://workdrive.zohoexternal.in/file/gl0sa74334f9a5230420a9bb10250c4055028"), "gl0sa74334f9a5230420a9bb10250c4055028")
        self.assertIsNone(external_share_id_from_permalink(f"https://example.com/external/{share_id}"))

    def test_public_response_proxies_configured_external_cover(self):
        external_cover = "https://workdrive.zohoexternal.in/external/063dad8186a865231e618d65da727a6dcb1cc1729623dbf26ba222ae8b3e865d"

        class Settings:
            @staticmethod
            def find_one(_query):
                return {"lookbookCoverUrls": {"Aakaar": external_cover}}

        app = Flask(__name__)
        app.register_blueprint(storefront_lookbooks_bp, url_prefix="/api")
        with patch("app.blueprints.admin.routes.database", return_value=type("DB", (), {"admin_settings": Settings()})()):
            payload = app.test_client().get("/api/lookbooks").get_json()

        self.assertEqual(payload["lookbookCovers"]["Aakaar"], external_cover)
        self.assertEqual(payload["lookbookCoverAssetUrls"]["Aakaar"], "/api/lookbooks/aakaar/cover")

    def test_public_cover_streams_only_configured_lookbook_asset(self):
        class Settings:
            @staticmethod
            def find_one(_query):
                return {}

        upstream = MagicMock()
        upstream.headers = {"Content-Type": "image/jpeg"}
        upstream.iter_content.return_value = iter([b"image-bytes"])
        app = Flask(__name__)
        app.register_blueprint(storefront_lookbooks_bp, url_prefix="/api")
        db = type("DB", (), {"admin_settings": Settings()})()
        with patch("app.blueprints.admin.routes.database", return_value=db), patch(
            "app.blueprints.admin.routes.download_file",
            return_value=WorkDriveDownload(upstream, "45kaa867c2b2ac8014d029e0d6cef5b83bf22"),
        ) as download:
            response = app.test_client().get("/api/lookbooks/aakaar/cover")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, b"image-bytes")
        self.assertEqual(response.content_type, "image/jpeg")
        download.assert_called_once_with(LOOKBOOK_COVER_DEFAULTS["Aakaar"], db, prefer_preview=True)

    def test_public_asset_route_rejects_unknown_names_without_downloading(self):
        app = Flask(__name__)
        app.register_blueprint(storefront_lookbooks_bp, url_prefix="/api")
        with patch("app.blueprints.admin.routes.download_file") as download:
            response = app.test_client().get("/api/lookbooks/not-configured/file")
        self.assertEqual(response.status_code, 404)
        download.assert_not_called()

    def test_public_asset_route_returns_safe_503_when_provider_auth_fails(self):
        class Settings:
            @staticmethod
            def find_one(_query):
                return {}

        app = Flask(__name__)
        app.register_blueprint(storefront_lookbooks_bp, url_prefix="/api")
        db = type("DB", (), {"admin_settings": Settings()})()
        with patch("app.blueprints.admin.routes.database", return_value=db), patch("app.blueprints.admin.routes.download_file", side_effect=WorkDriveUnavailable("private", "authentication_failed")):
            response = app.test_client().get("/api/lookbooks/aakaar/cover")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json(), {"error": "Lookbook asset is temporarily unavailable."})

    def test_lookbook_covers_wait_for_the_authoritative_api_response(self):
        source = (Path(__file__).resolve().parents[2] / "frontend" / "app" / "rk-lookbooks" / "page.tsx").read_text(encoding="utf-8")
        self.assertNotIn("featuredCollection.image", source)
        self.assertNotIn("coverByTitle", source)
        self.assertNotIn("collectionPages", source)
        self.assertIn("const [coversLoaded, setCoversLoaded] = useState(false);", source)
        self.assertIn("coversLoaded ? managedCovers[lookbook.title] : undefined", source)
        self.assertIn("showNeutralCoverFallback", source)

    def test_active_aakaar_collection_route_reuses_the_featured_hero_and_scrolls_to_products(self):
        root = Path(__file__).resolve().parents[2] / "frontend" / "components"
        page = (root / "collections" / "collection-detail-page.tsx").read_text(encoding="utf-8")
        hero = (root / "home" / "featured-collection.tsx").read_text(encoding="utf-8")
        self.assertIn('title="AAKAAR"', page)
        self.assertIn('eyebrow="WELCOME TO OUR NEWEST COLLECTION OF"', page)
        self.assertIn('introAboveTitle', page)
        self.assertIn('onCtaClick={scrollToProducts}', page)
        self.assertIn("const isAakaar = slug === 'aakaar';", page)
        self.assertIn("name: isAakaar ? 'Aakaar' : managedCollection.name", page)
        self.assertIn('id="collection-products"', (root / "collections" / "storefront-collection-products.tsx").read_text(encoding="utf-8"))
        self.assertIn('scrollIntoView({ behavior: \'smooth\', block: \'start\' })', page)
        self.assertIn('secondaryHref={lookbookHref || undefined}', page)
        self.assertIn("fetch(`${apiBaseUrl}/api/lookbooks`", page)
        self.assertIn("type FeaturedCollectionProps", hero)
        self.assertIn("onCtaClick", hero)
        self.assertIn("secondaryHref", hero)
        self.assertIn("introAboveTitle", hero)


if __name__ == "__main__":
    unittest.main()
