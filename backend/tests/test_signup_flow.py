import unittest
from types import SimpleNamespace
from unittest.mock import patch

from bson import ObjectId
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from bcrypt import checkpw

from app.blueprints.auth.routes import auth_bp
from app.extensions import limiter


class MemoryCollection:
    def __init__(self):
        self.documents = []

    @staticmethod
    def _matches(document, query):
        return all(document.get(key) == value for key, value in query.items())

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
        app.config.update(TESTING=True, JWT_SECRET_KEY="test-secret-key-that-is-at-least-32-bytes", RATELIMIT_ENABLED=False)
        JWTManager(app)
        limiter.init_app(app)
        app.register_blueprint(auth_bp, url_prefix="/api/auth")
        self.client = app.test_client()
        self.user_id = ObjectId()
        with app.app_context():
            token = create_access_token(identity=str(self.user_id))
        self.headers = {"Authorization": f"Bearer {token}"}
        self.database = SimpleNamespace(users=MemoryCollection(), otp_challenges=MemoryCollection(), profile_update_logs=MemoryCollection())

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


if __name__ == "__main__":
    unittest.main()
