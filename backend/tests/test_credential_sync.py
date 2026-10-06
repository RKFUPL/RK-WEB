import hashlib
import time
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from bson import ObjectId
from flask import Flask

from app.credential_sync import ensure_identity_link, ensure_indexes, sync_event
from app.credential_sync import verify_handoff
import jwt


class Collection:
    def __init__(self):
        self.documents = {}
        self.indexes = []

    def create_index(self, *args, **kwargs):
        self.indexes.append((args, kwargs))

    def find_one(self, query):
        return next((value for value in self.documents.values() if all(value.get(key) == expected for key, expected in query.items())), None)

    def update_one(self, query, update, upsert=False):
        current = self.find_one(query)
        if not current and upsert:
            current = dict(update.get("$setOnInsert", {}))
            current.update({key: value for key, value in query.items() if not key.startswith("$")})
            self.documents[current.get("_id", str(len(self.documents)))] = current
        if current:
            current.update(update.get("$set", {}))
            for key, value in update.get("$inc", {}).items():
                current[key] = current.get(key, 0) + value


class Database:
    def __init__(self):
        self.user_identity_links = Collection()
        self.credential_sync_outbox = Collection()


class CredentialSyncTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, DEBUG=True, STOCK_CREDENTIAL_SYNC_URL="", STOCK_CREDENTIAL_SYNC_SECRET="", CREDENTIAL_SYNC_HANDOFF_SECRET="")
        self.database = Database()
        self.user = {"_id": ObjectId(), "email": "staff@example.com", "username": "staff", "role": "staff", "isActive": True, "credentialVersion": 4, "passwordHash": "must-never-be-copied"}

    def test_indexes_and_identity_link_are_idempotent(self):
        ensure_indexes(self.database)
        ensure_identity_link(self.database, self.user)
        ensure_identity_link(self.database, self.user)
        self.assertEqual(len(self.database.user_identity_links.documents), 1)
        self.assertTrue(any(item[1].get("name") == "identity_link_web_user" for item in self.database.user_identity_links.indexes))

    def test_outbox_contains_metadata_only_and_duplicate_event_is_idempotent(self):
        with self.app.app_context():
            first = sync_event(self.database, "PASSWORD_CHANGED", self.user, password="temporary-in-memory-only", version=5)
            second = sync_event(self.database, "PASSWORD_CHANGED", self.user, password="another-in-memory-value", version=5)
        self.assertEqual(first["event_id"], second["event_id"])
        self.assertEqual(len(self.database.credential_sync_outbox.documents), 1)
        document_text = str(first)
        self.assertNotIn("temporary-in-memory-only", document_text)
        self.assertNotIn("another-in-memory-value", document_text)
        self.assertNotIn("passwordHash", document_text)
        self.assertEqual(first["status"], "PENDING")
        self.assertEqual(first["last_error"], "receiver_not_configured")

    @patch("app.credential_sync.urlopen")
    def test_receiver_success_marks_event_complete_without_persisting_password(self, urlopen):
        response = MagicMock()
        response.status = 200
        event_id = hashlib.sha256(f"PASSWORD_CHANGED:{self.user['_id']}:rk-stock:5:4".encode()).hexdigest()
        response.read.return_value = ('{"event_id": "' + event_id + '", "event_type": "PASSWORD_CHANGED", "status": "APPLIED", "applied": true, "credential_version": 5}').encode()
        response.__enter__.return_value = response
        urlopen.return_value = response
        self.app.config.update(STOCK_CREDENTIAL_SYNC_URL="http://127.0.0.1:5999", STOCK_CREDENTIAL_SYNC_SECRET="service-secret", CREDENTIAL_SYNC_HANDOFF_SECRET="handoff-secret")
        with self.app.app_context():
            event = sync_event(self.database, "PASSWORD_CHANGED", self.user, password="temporary-in-memory-only", version=5)
        stored = self.database.credential_sync_outbox.find_one({"_id": event["_id"]})
        self.assertEqual(stored["status"], "COMPLETED")
        self.assertNotIn("temporary-in-memory-only", str(stored))
        self.assertNotIn("passwordHash", str(stored))

    def test_handoff_claims_are_standard_hs256_and_bound(self):
        self.app.config["CREDENTIAL_SYNC_HANDOFF_SECRET"] = "handoff-secret-at-least-32-bytes-long"
        self.app.config["CREDENTIAL_SYNC_HANDOFF_TTL_SECONDS"] = 60
        with self.app.app_context():
            event = sync_event(self.database, "PASSWORD_CHANGED", self.user, password="temporary", version=5)
        request = MagicMock()
        with patch("app.credential_sync.urlopen", return_value=request):
            request.status = 200
            request.read.return_value = ('{"event_id":"%s","event_type":"PASSWORD_CHANGED","status":"APPLIED","applied":true}' % event["event_id"]).encode()
            request.__enter__.return_value = request
            with self.app.app_context():
                sync_event(self.database, "PASSWORD_CHANGED", self.user, password="temporary", version=6)
        # Generate a representative token using the same public verification contract.
        now = int(time.time())
        token = jwt.encode({"iss": "rk-stock", "aud": "rk-web", "event_id": "e", "event_type": "PASSWORD_CHANGED", "source_user_id": "s", "target_user_id": "t", "credential_version": 1, "profile_version": 1, "iat": now, "exp": now + 60, "jti": "j"}, self.app.config["CREDENTIAL_SYNC_HANDOFF_SECRET"], algorithm="HS256")
        with self.app.app_context():
            claims = verify_handoff(token, expected_event={"event_id": "e", "event_type": "PASSWORD_CHANGED", "source_user_id": "s", "target_user_id": "t", "credential_version": 1, "profile_version": 1}, issuer="rk-stock", audience="rk-web")
        self.assertEqual(claims["jti"], "j")
        with self.assertRaises(ValueError):
            with self.app.app_context():
                verify_handoff(token, expected_event={"event_id": "wrong", "event_type": "PASSWORD_CHANGED", "source_user_id": "s", "target_user_id": "t", "credential_version": 1, "profile_version": 1}, issuer="rk-stock", audience="rk-web")

    def test_outbox_sensitive_field_scan(self):
        with self.app.app_context():
            event = sync_event(self.database, "PASSWORD_CHANGED", self.user, password="never-persist-this", version=5)
        serialized = str(event).lower()
        for value in ("never-persist-this", "passwordhash", "credential_handoff", "jwt", "secret"):
            self.assertNotIn(value, serialized)


if __name__ == "__main__":
    unittest.main()
