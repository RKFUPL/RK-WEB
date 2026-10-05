import unittest
from types import SimpleNamespace
from unittest.mock import patch

from bson import ObjectId
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from bcrypt import checkpw, hashpw, gensalt
from datetime import datetime, timedelta, timezone

from app.blueprints.auth.routes import auth_bp
from app.extensions import limiter


class MemoryCollection:
    def __init__(self):
        self.documents = []

    @staticmethod
    def _matches(document, query):
        if "$or" in query and not any(MemoryCollection._matches(document, branch) for branch in query["$or"]):
            return False
        return all(
            document.get(key) != value["$ne"] if isinstance(value, dict) and "$ne" in value
            else document.get(key) == value
            for key, value in query.items() if key != "$or"
        )

    def find_one(self, query):
        return next((document for document in self.documents if self._matches(document, query)), None)

    def insert_one(self, document):
        stored = {**document, "_id": document.get("_id", ObjectId())}
        self.documents.append(stored)
        return SimpleNamespace(inserted_id=stored["_id"])

    def replace_one(self, query, document, upsert=False):
        current = self.find_one(query)
        if current:
            stored = {**document, "_id": current["_id"]}
            self.documents[self.documents.index(current)] = stored
        elif upsert:
            self.insert_one(document)

    def update_one(self, query, update):
        current = self.find_one(query)
        if not current:
            return
        current.update(update.get("$set", {}))
        for key, amount in update.get("$inc", {}).items():
            current[key] = current.get(key, 0) + amount

    def delete_one(self, query):
        current = self.find_one(query)
        if current:
            self.documents.remove(current)


class SignupFlowTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.config.update(TESTING=True, JWT_SECRET_KEY="test-secret-key-that-is-at-least-32-bytes", RATELIMIT_ENABLED=False, SHARED_SESSION_COOKIE_NAME="rk_shared_session", SHARED_SESSION_COOKIE_DOMAIN="", SHARED_SESSION_INTERNAL_SECRET="test-only-internal-secret", AUTH_SESSION_DAYS=30, JWT_COOKIE_SECURE=False)
        JWTManager(app)
        limiter.init_app(app)
        app.register_blueprint(auth_bp, url_prefix="/api/auth")
        self.app = app
        self.client = app.test_client()
        self.user_id = ObjectId()
        with app.app_context():
            token = create_access_token(identity=str(self.user_id))
        self.headers = {"Authorization": f"Bearer {token}"}
        self.database = SimpleNamespace(users=MemoryCollection(), otp_challenges=MemoryCollection(), profile_update_logs=MemoryCollection(), auth_sessions=MemoryCollection())

    def test_required_profile_data_survives_otp_and_no_user_exists_before_verification(self):
        sent = {}
        payload = {
            "firstName": "Ada",
            "lastName": "Lovelace",
            "username": "ada.l",
            "email": "ada@example.com",
            "phone": "+91 99999 00000",
            "dob": "1990-12-10",
            "gender": "female",
            "region": "asia-india",
            "password": "secure-password",
        }
        with patch("app.blueprints.auth.routes._database", return_value=self.database), patch("app.blueprints.auth.routes._send_otp_email", side_effect=lambda email, otp, purpose="verification": sent.update(email=email, otp=otp)):
            requested = self.client.post("/api/auth/signup/request-otp", json=payload)
            self.assertEqual(requested.status_code, 202)
            self.assertEqual(self.database.users.documents, [])
            challenge = self.database.otp_challenges.find_one({"email": payload["email"], "purpose": "signup"})
            self.assertEqual(challenge["dob"], payload["dob"])
            self.assertEqual(challenge["gender"], payload["gender"])

            verified = self.client.post("/api/auth/signup/verify-otp", json={"email": payload["email"], "otp": sent["otp"]})
            self.assertEqual(verified.status_code, 201)
            user = self.database.users.find_one({"email": payload["email"]})
            self.assertEqual(user["firstName"], payload["firstName"])
            self.assertEqual(user["lastName"], payload["lastName"])
            self.assertEqual(user["dob"], payload["dob"])
            self.assertEqual(user["gender"], payload["gender"])

    def test_password_is_not_stored_or_changed_until_otp_verification(self):
        sent = {}
        user = {"_id": self.user_id, "email": "member@example.com", "role": "customer", "isActive": True}
        self.database.users.documents.append(user)
        new_password = "a-new-secure-password"
        with patch("app.rbac.current_user", return_value=user), patch("app.blueprints.auth.routes._database", return_value=self.database), patch("app.blueprints.auth.routes._send_otp_email", side_effect=lambda email, otp, purpose="verification": sent.update(email=email, otp=otp)):
            requested = self.client.post("/api/auth/profile/password/request", headers=self.headers, json={"password": new_password, "confirmPassword": new_password})
            self.assertEqual(requested.status_code, 202)
            challenge = self.database.otp_challenges.find_one({"userId": self.user_id, "purpose": "password-change"})
            self.assertNotIn("passwordHash", challenge)
            self.assertNotIn("passwordHash", user)

            verified = self.client.post("/api/auth/profile/password/verify", headers=self.headers, json={"otp": sent["otp"], "password": new_password, "confirmPassword": new_password})
            self.assertEqual(verified.status_code, 200)
            self.assertTrue(checkpw(new_password.encode(), user["passwordHash"].encode()))
            self.assertIsNone(self.database.otp_challenges.find_one({"userId": self.user_id, "purpose": "password-change"}))

    def test_login_shared_session_rolls_and_logout_revokes_it(self):
        user = {"_id": self.user_id, "email": "staff@example.com", "username": "staff", "displayName": "Staff User", "passwordHash": hashpw(b"safe-password", gensalt()).decode(), "role": "staff", "isActive": True}
        self.database.users.documents.append(user)
        with patch("app.blueprints.auth.routes._database", return_value=self.database), patch("app.rbac.database", return_value=self.database):
            login = self.client.post("/api/auth/login", json={"identifier": "staff@example.com", "password": "safe-password"})
            assert login.status_code == 200
            session = self.database.auth_sessions.documents[0]
            original_expiry = session["expiresAt"]
            session["expiresAt"] = datetime.now(timezone.utc) + timedelta(minutes=1)
            shared = self.client.get("/api/auth/shared/me", headers={"X-RK-Shared-Auth": "test-only-internal-secret"})
            assert shared.status_code == 200
            assert shared.json["user"]["id"] == str(self.user_id)
            assert session["expiresAt"] > original_expiry - timedelta(days=1)
            logout = self.client.post("/api/auth/logout", headers={"Authorization": f"Bearer {login.json['accessToken']}"})
            assert logout.status_code == 200
            assert self.client.get("/api/auth/shared/me", headers={"X-RK-Shared-Auth": "test-only-internal-secret"}).status_code == 401

    def test_expired_and_inactive_shared_sessions_are_rejected(self):
        user = {"_id": self.user_id, "email": "staff@example.com", "role": "staff", "isActive": True}
        self.database.users.documents.append(user)
        with patch("app.blueprints.auth.routes._database", return_value=self.database), self.app.app_context():
            token, _ = __import__("app.blueprints.auth.routes", fromlist=["_create_shared_session"])._create_shared_session(self.user_id)
            self.client.set_cookie("rk_shared_session", token)
            self.database.auth_sessions.documents[0]["expiresAt"] = datetime.now(timezone.utc) - timedelta(seconds=1)
            assert self.client.get("/api/auth/shared/me", headers={"X-RK-Shared-Auth": "test-only-internal-secret"}).status_code == 401
            self.database.auth_sessions.documents[0]["expiresAt"] = datetime.now(timezone.utc) + timedelta(days=1)
            user["isActive"] = False
            assert self.client.get("/api/auth/shared/me", headers={"X-RK-Shared-Auth": "test-only-internal-secret"}).status_code == 401

    def test_staff_cannot_change_own_password_with_shared_session(self):
        user = {"_id": self.user_id, "email": "staff@example.com", "role": "staff", "isActive": True}
        self.database.users.documents.append(user)
        with patch("app.blueprints.auth.routes._database", return_value=self.database), patch("app.rbac.database", return_value=self.database), self.app.app_context():
            token, _ = __import__("app.blueprints.auth.routes", fromlist=["_create_shared_session"])._create_shared_session(self.user_id)
            self.client.set_cookie("rk_shared_session", token)
            response = self.client.post("/api/auth/profile/password/request", json={"password": "new-password", "confirmPassword": "new-password"})
            assert response.status_code == 403

    def test_production_like_cookie_attributes_are_cross_subdomain_safe(self):
        self.app.config.update(SHARED_SESSION_COOKIE_DOMAIN=".rashikapoor.test", JWT_COOKIE_SECURE=True)
        user = {"_id": self.user_id, "email": "admin@example.com", "username": "admin", "displayName": "Admin User", "passwordHash": hashpw(b"safe-password", gensalt()).decode(), "role": "admin", "isActive": True}
        self.database.users.documents.append(user)
        with patch("app.blueprints.auth.routes._database", return_value=self.database):
            response = self.client.post("/api/auth/login", json={"identifier": "admin@example.com", "password": "safe-password"})
        cookie_header = next(value for value in response.headers.getlist("Set-Cookie") if value.startswith("rk_shared_session="))
        assert "Domain=rashikapoor.test" in cookie_header
        assert "Secure" in cookie_header
        assert "HttpOnly" in cookie_header
        assert "SameSite=Lax" in cookie_header
        assert "Max-Age=2592000" in cookie_header


if __name__ == "__main__":
    unittest.main()
