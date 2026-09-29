import unittest

from app.blueprints.admin.routes import LOOKBOOK_DEFAULTS, _valid_lookbook_url
from app import create_app


class LookbookSettingsTests(unittest.TestCase):
    def test_active_defaults_are_complete_and_exclude_naqab(self):
        self.assertEqual(set(LOOKBOOK_DEFAULTS), {"Anamika", "Espiritu Libre", "Sandook", "Inaara", "Hastakala"})
        self.assertNotIn("Naqab", LOOKBOOK_DEFAULTS)
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


if __name__ == "__main__":
    unittest.main()
