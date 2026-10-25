import unittest
from types import SimpleNamespace
from unittest.mock import patch

import mongomock
from bson import ObjectId
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from app.blueprints.admin.routes import SETTINGS_DEFAULTS, admin_bp, storefront_lookbooks_bp


class StorefrontSettingsTests(unittest.TestCase):
    def public_app(self):
        app = Flask(__name__)
        app.register_blueprint(storefront_lookbooks_bp, url_prefix="/api")
        return app

    def test_public_response_omits_private_forex_controls(self):
        database = SimpleNamespace(admin_settings=mongomock.MongoClient().db.admin_settings)
        with patch("app.blueprints.admin.routes.database", return_value=database):
            response = self.public_app().test_client().get("/api/storefront-settings")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"settings": {"colourSwatches": {}}})
        self.assertTrue(SETTINGS_DEFAULTS["showStorefrontForex"])

    def test_public_forex_display_reflects_persisted_disabled_value(self):
        database = SimpleNamespace(admin_settings=mongomock.MongoClient().db.admin_settings)
        database.admin_settings.insert_one({"_id": "store", "showStorefrontForex": False, "supportEmail": "private@example.com"})
        with patch("app.blueprints.admin.routes.database", return_value=database):
            response = self.public_app().test_client().get("/api/storefront-settings")
        self.assertEqual(response.get_json(), {"settings": {"colourSwatches": {}}})

    def test_settings_mutation_requires_admin_authentication(self):
        app = Flask(__name__)
        app.config.update(TESTING=True, JWT_SECRET_KEY="test-secret-key-that-is-at-least-32-bytes")
        JWTManager(app)
        app.register_blueprint(admin_bp, url_prefix="/api/admin")
        response = app.test_client().put("/api/admin/settings", json={"showStorefrontForex": False})
        self.assertEqual(response.status_code, 401)

    def test_admin_can_persist_forex_display_setting(self):
        client = mongomock.MongoClient()
        database = SimpleNamespace(
            users=client.db.users,
            auth_sessions=client.db.auth_sessions,
            admin_settings=client.db.admin_settings,
            analytics_events=client.db.analytics_events,
        )
        user_id = ObjectId()
        database.users.insert_one({"_id": user_id, "role": "admin", "isActive": True})
        app = Flask(__name__)
        app.config.update(TESTING=True, JWT_SECRET_KEY="test-secret-key-that-is-at-least-32-bytes")
        JWTManager(app)
        app.register_blueprint(admin_bp, url_prefix="/api/admin")
        with app.app_context():
            token = create_access_token(identity=str(user_id))
        payload = {
            **SETTINGS_DEFAULTS,
            "showStorefrontForex": False,
        }
        headers = {"Authorization": f"Bearer {token}"}
        with patch("app.rbac.database", return_value=database), patch("app.blueprints.admin.routes.database", return_value=database):
            response = app.test_client().put("/api/admin/settings", json=payload, headers=headers)
            read_back = app.test_client().get("/api/admin/settings", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.get_json()["settings"]["showStorefrontForex"])
        self.assertFalse(read_back.get_json()["settings"]["showStorefrontForex"])
        self.assertFalse(database.admin_settings.find_one({"_id": "store"})["showStorefrontForex"])


if __name__ == "__main__":
    unittest.main()
