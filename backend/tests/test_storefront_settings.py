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
        self.assertEqual(response.get_json(), {"settings": {"colourSwatches": {}, "whatsappNumber": "918879597878", "razorpayEnabled": True}})
        self.assertTrue(SETTINGS_DEFAULTS["showStorefrontForex"])

    def test_public_forex_display_reflects_persisted_disabled_value(self):
        database = SimpleNamespace(admin_settings=mongomock.MongoClient().db.admin_settings)
        database.admin_settings.insert_one({"_id": "store", "showStorefrontForex": False, "supportEmail": "private@example.com"})
        with patch("app.blueprints.admin.routes.database", return_value=database):
            response = self.public_app().test_client().get("/api/storefront-settings")
        self.assertEqual(response.get_json(), {"settings": {"colourSwatches": {}, "whatsappNumber": "918879597878", "razorpayEnabled": True}})

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

    def test_whatsapp_contact_is_validated_persisted_and_published_without_private_settings(self):
        client = mongomock.MongoClient()
        db = SimpleNamespace(users=client.db.users, auth_sessions=client.db.auth_sessions,
                             admin_settings=client.db.admin_settings, analytics_events=client.db.analytics_events)
        user_id = ObjectId()
        db.users.insert_one({"_id": user_id, "role": "admin", "isActive": True})
        app = self.public_app()
        app.config.update(TESTING=True, JWT_SECRET_KEY="test-secret-key-that-is-at-least-32-bytes")
        JWTManager(app)
        app.register_blueprint(admin_bp, url_prefix="/api/admin")
        with app.app_context():
            headers = {"Authorization": f"Bearer {create_access_token(identity=str(user_id))}"}
        with patch("app.rbac.database", return_value=db), patch("app.blueprints.admin.routes.database", return_value=db):
            for value, expected in [("+91 90000 00000", "919000000000"), ("", "")]:
                response = app.test_client().put("/api/admin/settings", json={**SETTINGS_DEFAULTS, "whatsappNumber": value}, headers=headers)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(db.admin_settings.find_one({"_id": "store"})["whatsappNumber"], expected)
                self.assertEqual(app.test_client().get("/api/storefront-settings").get_json(), {"settings": {"colourSwatches": {}, "whatsappNumber": expected, "razorpayEnabled": True}})
            for invalid in ["javascript:alert(1)", "123", "0" * 10, "1234567890123456"]:
                response = app.test_client().put("/api/admin/settings", json={**SETTINGS_DEFAULTS, "whatsappNumber": invalid}, headers=headers)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(db.admin_settings.find_one({"_id": "store"})["whatsappNumber"], "")


if __name__ == "__main__":
    unittest.main()
