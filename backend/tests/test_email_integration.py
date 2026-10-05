import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from app.blueprints.admin.routes import admin_bp


class MemoryCollection:
    def __init__(self):
        self.document = None

    def find_one(self, query):
        if self.document and self.document.get("_id") == query.get("_id"):
            return dict(self.document)
        return None

    def update_one(self, query, update, upsert=False):
        self.document = {**(self.document or {}), **query, **update.get("$set", {})}
        return SimpleNamespace()


class EmailIntegrationEndpointTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.config.update(
            TESTING=True,
            JWT_SECRET_KEY="test-secret-key-that-is-at-least-32-bytes",
            MAIL_PROVIDER="zoho",
            ZOHO_MAILBOX="rk@rashikapoorofficial.com",
            ZOHO_SMTP_HOST="smtp.zoho.com",
            ZOHO_SMTP_PORT=587,
            ZOHO_SMTP_SECURITY="starttls",
            ZOHO_SMTP_USERNAME="configured-user",
            ZOHO_SMTP_PASSWORD="do-not-return-this-password",
        )
        JWTManager(app)
        app.register_blueprint(admin_bp, url_prefix="/api/admin")
        self.app = app
        self.client = app.test_client()
        with app.app_context():
            token = create_access_token(identity="000000000000000000000001")
        self.headers = {"Authorization": f"Bearer {token}"}
        self.admin = {"_id": "admin", "role": "admin", "isActive": True}
        self.customer = {"_id": "customer", "role": "customer", "isActive": True}
        self.integrations = MemoryCollection()
        self.database = SimpleNamespace(integrations=self.integrations)

    def context(self, user=None):
        return (
            patch("app.rbac.current_user", return_value=user or self.admin),
            patch("app.blueprints.admin.routes.database", return_value=self.database),
        )

    def assert_no_secrets(self, response):
        body = json.dumps(response.get_json()).lower()
        self.assertNotIn("do-not-return-this-password", body)
        self.assertNotIn("smtp_password", body)
        self.assertNotIn("refresh_token", body)
        self.assertNotIn("client_secret", body)

    def test_admin_can_read_safe_status(self):
        auth, database = self.context()
        with auth, database:
            response = self.client.get("/api/admin/integrations/email", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["integration"]["provider"], "zoho")
        self.assertTrue(response.get_json()["integration"]["password_configured"])
        self.assert_no_secrets(response)

    def test_non_admin_cannot_read_or_send(self):
        auth, database = self.context(self.customer)
        with auth, database:
            status = self.client.get("/api/admin/integrations/email", headers=self.headers)
            send = self.client.post("/api/admin/integrations/email/test-send", json={"recipient": "test@example.com", "sender": "otp"}, headers=self.headers)
        self.assertEqual(status.status_code, 403)
        self.assertEqual(send.status_code, 403)

    @patch("app.blueprints.admin.routes.test_smtp_connection", return_value={"testedAt": "2026-10-05T10:00:00+00:00"})
    def test_admin_can_connect_and_test_connection(self, smtp_test):
        auth, database = self.context()
        with auth, database:
            connected = self.client.post("/api/admin/integrations/email/connect", headers=self.headers)
            tested = self.client.post("/api/admin/integrations/email/test-connection", headers=self.headers)
        self.assertEqual(connected.status_code, 200)
        self.assertEqual(tested.status_code, 200)
        self.assertEqual(self.integrations.document["status"], "connected")
        self.assertEqual(smtp_test.call_count, 2)
        self.assert_no_secrets(connected)

    @patch("app.blueprints.admin.routes.test_smtp_connection", side_effect=RuntimeError("provider detail must stay private"))
    def test_invalid_credentials_return_safe_error(self, _smtp_test):
        auth, database = self.context()
        with auth, database:
            response = self.client.post("/api/admin/integrations/email/connect", headers=self.headers)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "Unable to connect to Zoho Mail. Check the local SMTP configuration.")
        self.assertNotIn("provider detail", response.get_data(as_text=True))

    @patch("app.blueprints.admin.routes.send_test_email")
    def test_admin_can_send_with_approved_sender(self, send):
        auth, database = self.context()
        with auth, database:
            response = self.client.post("/api/admin/integrations/email/test-send", json={"recipient": "test@example.com", "sender": "otp"}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        send.assert_called_once_with("test@example.com", "otp")

    @patch("app.blueprints.admin.routes.send_test_email")
    def test_arbitrary_sender_and_invalid_recipient_are_rejected(self, send):
        auth, database = self.context()
        with auth, database:
            sender_response = self.client.post("/api/admin/integrations/email/test-send", json={"recipient": "test@example.com", "sender": "attacker@example.com"}, headers=self.headers)
            recipient_response = self.client.post("/api/admin/integrations/email/test-send", json={"recipient": "not-an-email", "sender": "otp"}, headers=self.headers)
        self.assertEqual(sender_response.status_code, 400)
        self.assertEqual(recipient_response.status_code, 400)
        send.assert_not_called()

    def test_disconnect_changes_only_connection_state(self):
        self.integrations.document = {"_id": "zoho_mail", "status": "connected"}
        auth, database = self.context()
        with auth, database:
            response = self.client.post("/api/admin/integrations/email/disconnect", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["integration"]["status"], "disconnected")


if __name__ == "__main__":
    unittest.main()
