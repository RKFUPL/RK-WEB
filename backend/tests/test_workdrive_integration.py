import json
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from cryptography.fernet import Fernet
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from app.blueprints.admin.routes import admin_bp
from app.extensions import limiter
from app import workdrive
from app.workdrive import WorkDriveDownload, WorkDriveUnavailable


class SettingsCollection:
    def find_one(self, _query):
        return {
            "_id": "store",
            "lookbookUrls": {
                "Aakaar": "https://workdrive.zoho.in/file/aakaarlookbook123",
                "Hastakala": "https://workdrive.zoho.in/file/hastakala123",
            },
            "lookbookCoverUrls": {
                "Aakaar": "https://workdrive.zoho.in/file/aakaarcover123",
            },
        }


class WorkDriveIntegrationTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.config.update(TESTING=True, JWT_SECRET_KEY="test-secret-key-that-is-at-least-32-bytes", RATELIMIT_ENABLED=False)
        JWTManager(app)
        limiter.init_app(app)
        app.register_blueprint(admin_bp, url_prefix="/api/admin")
        self.app = app
        self.client = app.test_client()
        with app.app_context():
            token = create_access_token(identity="000000000000000000000001")
        self.headers = {"Authorization": f"Bearer {token}"}
        self.admin = {"_id": "admin", "role": "admin", "isActive": True}
        self.customer = {"_id": "customer", "role": "customer", "isActive": True}
        self.database = SimpleNamespace(admin_settings=SettingsCollection())
        self.status = {
            "provider": "zoho_workdrive",
            "status": "not_connected",
            "configured": {"client_id": True, "client_secret": True, "refresh_token": True},
            "last_token_refresh_at": None,
            "last_file_retrieval_at": None,
            "last_error_category": None,
        }

    def context(self, user=None):
        return (
            patch("app.rbac.current_user", return_value=user or self.admin),
            patch("app.blueprints.admin.routes.database", return_value=self.database),
            patch("app.blueprints.admin.routes.workdrive_status", return_value=dict(self.status)),
        )

    def assert_no_secrets(self, response):
        body = json.dumps(response.get_json()).lower()
        for forbidden in ("private-access-token", "client-secret-value", "refresh-token-value", "zoho-oauthtoken", "authorization: bearer"):
            self.assertNotIn(forbidden, body)

    def test_admin_status_is_safe_and_lists_only_configured_assets(self):
        auth, database, status = self.context()
        with auth, database, status:
            response = self.client.get("/api/admin/integrations/workdrive", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()["integration"]
        self.assertEqual(payload["status"], "not_connected")
        self.assertEqual({item["key"] for item in payload["approved_assets"]}, {"Aakaar:cover", "Aakaar:lookbook", "Hastakala:lookbook"})
        self.assert_no_secrets(response)

    def test_unauthenticated_and_non_admin_requests_are_rejected(self):
        unauthenticated = self.client.get("/api/admin/integrations/workdrive")
        auth, database, status = self.context(self.customer)
        with auth, database, status:
            non_admin = self.client.post("/api/admin/integrations/workdrive/test-connection", headers=self.headers)
        self.assertEqual(unauthenticated.status_code, 401)
        self.assertEqual(non_admin.status_code, 403)

    def test_oauth_start_is_admin_only_and_returns_authorization_url(self):
        auth, database, status = self.context(self.customer)
        with auth, database, status:
            forbidden = self.client.post("/api/admin/integrations/workdrive/oauth/start", headers=self.headers)
        self.assertEqual(forbidden.status_code, 403)

        auth, database, status = self.context()
        with auth, database, status, patch("app.blueprints.admin.routes.current_user", return_value=self.admin), patch("app.blueprints.admin.routes.begin_workdrive_oauth", return_value="https://accounts.zoho.in/oauth/v2/auth?safe=1"):
            response = self.client.post("/api/admin/integrations/workdrive/oauth/start", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["authorization_url"], "https://accounts.zoho.in/oauth/v2/auth?safe=1")

    def test_oauth_callback_uses_state_flow_and_returns_safe_redirect(self):
        auth, database, status = self.context()
        with database, patch("app.blueprints.admin.routes.complete_workdrive_oauth") as complete:
            response = self.client.get("/api/admin/integrations/workdrive/oauth/callback?state=safe-state&code=safe-code")
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.location.endswith("/admin/integrations/workdrive?oauth=connected"))
        complete.assert_called_once_with(self.database, "safe-state", "safe-code")
        self.assertNotIn("safe-code", response.location)

    def test_connection_success_and_failure_are_sanitized(self):
        auth, database, status = self.context()
        with auth, database, status, patch("app.blueprints.admin.routes.test_workdrive_connection"):
            success = self.client.post("/api/admin/integrations/workdrive/test-connection", headers=self.headers)
        self.assertEqual(success.status_code, 200)

        self.status.update(status="error", last_error_category="permission_denied")
        auth, database, status = self.context()
        with auth, database, status, patch("app.blueprints.admin.routes.test_workdrive_connection", side_effect=WorkDriveUnavailable("private provider response", "permission_denied")):
            failure = self.client.post("/api/admin/integrations/workdrive/test-connection", headers=self.headers)
        self.assertEqual(failure.status_code, 400)
        self.assertEqual(failure.get_json()["error_kind"], "permission_denied")
        self.assertNotIn("private provider response", failure.get_data(as_text=True))
        self.assert_no_secrets(failure)

    def test_file_access_success_failure_and_unapproved_input(self):
        upstream = MagicMock()
        upstream.status_code = 200
        upstream.headers = {"Content-Type": "image/jpeg"}
        auth, database, status = self.context()
        with auth, database, status, patch("app.blueprints.admin.routes.download_file", return_value=WorkDriveDownload(upstream, "aakaarcover123")) as download:
            success = self.client.post("/api/admin/integrations/workdrive/test-file", json={"asset": "Aakaar:cover"}, headers=self.headers)
        self.assertEqual(success.status_code, 200)
        self.assertEqual(success.get_json()["result"], {"status": 200, "content_type": "image/jpeg"})
        download.assert_called_once_with("https://workdrive.zoho.in/file/aakaarcover123", self.database, prefer_preview=True)

        auth, database, status = self.context()
        with auth, database, status, patch("app.blueprints.admin.routes.download_file") as download:
            rejected = self.client.post("/api/admin/integrations/workdrive/test-file", json={"asset": "attacker-file-id"}, headers=self.headers)
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(rejected.get_json()["error_kind"], "unapproved_file")
        download.assert_not_called()

        self.status.update(status="error", last_error_category="file_not_found")
        auth, database, status = self.context()
        with auth, database, status, patch("app.blueprints.admin.routes.download_file", side_effect=WorkDriveUnavailable("private", "permission_denied")):
            failure = self.client.post("/api/admin/integrations/workdrive/test-file", json={"asset": "Aakaar:lookbook"}, headers=self.headers)
        self.assertEqual(failure.status_code, 400)
        self.assertEqual(failure.get_json()["error_kind"], "permission_denied")
        self.assertNotIn("private", failure.get_data(as_text=True))


class WorkDriveOAuthTests(unittest.TestCase):
    def setUp(self):
        workdrive._token = None
        workdrive._status.update(last_token_refresh_at=None, last_file_retrieval_at=None, last_error_category=None)
        self.environment = patch.dict("os.environ", {
            "ZOHO_WORKDRIVE_CLIENT_ID": "client-id",
            "ZOHO_WORKDRIVE_CLIENT_SECRET": "client-secret",
            "ZOHO_WORKDRIVE_REFRESH_TOKEN": "refresh-token",
        }, clear=False)

    def test_oauth_refresh_success_uses_workdrive_specific_credentials(self):
        response = MagicMock()
        response.json.return_value = {"access_token": "private-access-token", "expires_in": 3600}
        with self.environment, patch("app.workdrive.requests.post", return_value=response) as post:
            token = workdrive._access_token(force_refresh=True)
        self.assertEqual(token, "private-access-token")
        self.assertEqual(post.call_args.args[0], "https://accounts.zoho.in/oauth/v2/token")
        self.assertEqual(set(post.call_args.kwargs["data"]), {"refresh_token", "client_id", "client_secret", "grant_type"})
        self.assertEqual(post.call_args.kwargs["data"]["grant_type"], "refresh_token")

    def test_oauth_configuration_validates_exact_callback_path(self):
        environment = patch.dict("os.environ", {
            "ZOHO_WORKDRIVE_CLIENT_ID": "client-id",
            "ZOHO_WORKDRIVE_CLIENT_SECRET": "client-secret",
            "ZOHO_WORKDRIVE_REDIRECT_URI": "http://localhost:3000/api/admin/integrations/workdrive/oauth/callback",
            "ZOHO_WORKDRIVE_TOKEN_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii"),
        }, clear=False)
        with environment:
            configured = workdrive.oauth_configuration()
        self.assertTrue(configured["redirect_uri"])
        self.assertTrue(configured["redirect_uri_valid"])

        with patch.dict("os.environ", {"ZOHO_WORKDRIVE_REDIRECT_URI": "http://localhost:3000/wrong"}, clear=False):
            self.assertFalse(workdrive.oauth_configuration()["redirect_uri_valid"])

    def test_oauth_refresh_failure_exposes_only_safe_category(self):
        response = MagicMock()
        response.json.return_value = {"error": "invalid_scope", "provider_detail": "must stay private"}
        with self.environment, patch("app.workdrive.requests.post", return_value=response):
            with self.assertRaises(WorkDriveUnavailable) as caught:
                workdrive._access_token(force_refresh=True)
        self.assertEqual(caught.exception.category, "permission_denied")
        self.assertNotIn("provider_detail", str(caught.exception))

    def test_external_share_download_uses_verified_zoho_preview_image(self):
        share_id = "063dad8186a865231e618d65da727a6dcb1cc1729623dbf26ba222ae8b3e865d"
        permalink = f"https://workdrive.zohoexternal.in/external/{share_id}"
        share_response = MagicMock(ok=True, text='<meta property="og:image" content="https://previewengine.zohoexternal.in/image.jpg">')
        preview_response = MagicMock(ok=True, status_code=200, headers={"Content-Type": "image/jpeg"})
        with patch("app.workdrive.requests.get", side_effect=[share_response, preview_response]) as get:
            result = workdrive.download_file(permalink)
        self.assertIs(result.response, preview_response)
        self.assertEqual(result.file_id, share_id)
        self.assertEqual(get.call_args_list[0].args[0], permalink)
        self.assertEqual(get.call_args_list[1].args[0], "https://previewengine.zohoexternal.in/image.jpg")

    def test_private_download_uses_metadata_provided_regional_url(self):
        metadata = MagicMock(ok=True, status_code=200)
        metadata.json.return_value = {"data": {"attributes": {
            "download_url": "https://download-accl.zoho.in/v1/workdrive/download/file123?x=1",
        }}}
        binary = MagicMock(ok=True, status_code=200, headers={"Content-Type": "image/jpeg"})
        oauth = MagicMock()
        oauth.json.return_value = {"access_token": "access-token", "expires_in": 3600}
        with self.environment, patch("app.workdrive.requests.post", return_value=oauth), patch("app.workdrive.requests.get", side_effect=[metadata, binary]) as get:
            result = workdrive.download_file("https://workdrive.zoho.in/file/file123")
        self.assertIs(result.response, binary)
        self.assertEqual(get.call_args_list[0].args[0], "https://www.zohoapis.in/workdrive/api/v1/files/file123")
        self.assertEqual(get.call_args_list[1].args[0], "https://download-accl.zoho.in/v1/workdrive/download/file123?x=1")
        self.assertTrue(get.call_args_list[1].kwargs["headers"]["Authorization"].startswith("Zoho-oauthtoken "))

    def test_private_cover_uses_only_the_trusted_preview_host(self):
        metadata = MagicMock(ok=True, status_code=200)
        metadata.json.return_value = {"data": {"attributes": {
            "preview_data_url": "https://previewengine-accl.zoho.in/preview/file123?x=1",
        }}}
        image = MagicMock(ok=True, status_code=200, headers={"Content-Type": "image/jpeg"})
        oauth = MagicMock()
        oauth.json.return_value = {"access_token": "access-token", "expires_in": 3600}
        with self.environment, patch("app.workdrive.requests.post", return_value=oauth), patch("app.workdrive.requests.get", side_effect=[metadata, image]) as get:
            result = workdrive.download_file("https://workdrive.zoho.in/file/file123", prefer_preview=True)
        self.assertIs(result.response, image)
        self.assertEqual(get.call_args_list[0].args[0], "https://www.zohoapis.in/workdrive/api/v1/files/file123/previewinfo")
        self.assertEqual(get.call_args_list[1].args[0], "https://previewengine-accl.zoho.in/preview/file123?x=1")
        self.assertTrue(get.call_args_list[1].kwargs["headers"]["Authorization"].startswith("Zoho-oauthtoken "))

    def test_private_cover_rejects_an_untrusted_preview_host(self):
        metadata = MagicMock(ok=True, status_code=200)
        metadata.json.return_value = {"data": {"attributes": {"preview_data_url": "https://example.com/preview.jpg"}}}
        oauth = MagicMock()
        oauth.json.return_value = {"access_token": "access-token", "expires_in": 3600}
        with self.environment, patch("app.workdrive.requests.post", return_value=oauth), patch("app.workdrive.requests.get", return_value=metadata) as get:
            with self.assertRaises(WorkDriveUnavailable) as caught:
                workdrive.download_file("https://workdrive.zoho.in/file/file123", prefer_preview=True)
        self.assertEqual(caught.exception.category, "unsupported_response")
        self.assertEqual(get.call_count, 1)

    def test_external_share_rejects_untrusted_preview_host(self):
        permalink = "https://workdrive.zohoexternal.in/external/063dad8186a865231e618d65da727a6dcb1cc1729623dbf26ba222ae8b3e865d"
        response = MagicMock(ok=True, text='<meta property="og:image" content="https://example.com/image.jpg">')
        with patch("app.workdrive.requests.get", return_value=response):
            with self.assertRaises(WorkDriveUnavailable) as caught:
                workdrive.download_file(permalink)
        self.assertEqual(caught.exception.category, "unsupported_response")

    def test_invalid_oauth_state_is_rejected_before_token_exchange(self):
        states = MagicMock()
        states.find_one_and_delete.return_value = None
        db = SimpleNamespace(oauth_states=states)
        with patch("app.workdrive.requests.post") as post:
            with self.assertRaises(WorkDriveUnavailable) as caught:
                workdrive.complete_oauth(db, "invalid-state", "authorization-code")
        self.assertEqual(caught.exception.category, "invalid_state")
        post.assert_not_called()

    def test_oauth_callback_stores_only_encrypted_refresh_token(self):
        key = Fernet.generate_key().decode("ascii")
        states = MagicMock()
        states.find_one_and_delete.return_value = {"userId": "admin-id", "expiresAt": datetime.now(timezone.utc)}
        integrations = MagicMock()
        db = SimpleNamespace(oauth_states=states, integrations=integrations)
        response = MagicMock()
        response.json.return_value = {"refresh_token": "private-refresh-token", "access_token": "private-access-token"}
        environment = patch.dict("os.environ", {
            "ZOHO_WORKDRIVE_CLIENT_ID": "client-id",
            "ZOHO_WORKDRIVE_CLIENT_SECRET": "client-secret",
            "ZOHO_WORKDRIVE_REDIRECT_URI": "http://localhost:3000/api/admin/integrations/workdrive/oauth/callback",
            "ZOHO_WORKDRIVE_TOKEN_ENCRYPTION_KEY": key,
        }, clear=False)
        with environment, patch("app.workdrive.requests.post", return_value=response):
            workdrive.complete_oauth(db, "valid-state", "authorization-code")
        stored = integrations.update_one.call_args.args[1]["$set"]
        self.assertNotIn("private-refresh-token", json.dumps(stored, default=str))
        self.assertNotIn("private-access-token", json.dumps(stored, default=str))
        self.assertEqual(Fernet(key.encode("ascii")).decrypt(stored["encryptedRefreshToken"].encode("ascii")).decode("utf-8"), "private-refresh-token")

    def test_encrypted_callback_token_is_preferred_for_subsequent_requests(self):
        key = Fernet.generate_key().decode("ascii")
        encrypted = Fernet(key).encrypt(b"stored-refresh-token").decode("ascii")
        db = SimpleNamespace(integrations=SimpleNamespace(find_one=lambda *_args, **_kwargs: {"encryptedRefreshToken": encrypted}))
        with patch.dict("os.environ", {"ZOHO_WORKDRIVE_TOKEN_ENCRYPTION_KEY": key, "ZOHO_WORKDRIVE_REFRESH_TOKEN": "stale-env-token"}, clear=False):
            self.assertEqual(workdrive._refresh_token(db), "stored-refresh-token")


if __name__ == "__main__":
    unittest.main()
