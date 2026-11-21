"""All storage is in-memory and all Meta/SMTP requests are mocked."""
from datetime import timedelta
import hashlib
import hmac
import json
import unittest
from unittest.mock import Mock, patch

import mongomock
import requests
from bson import ObjectId
from cryptography.fernet import Fernet
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from app.extensions import limiter
from app.whatsapp import normalize_phone, notify, now, process_outbox, send, send_text
from app.whatsapp_routes import admin_bp, webhook_bp
from app.blueprints.auth.routes import auth_bp
from app.blueprints.catalog.routes import catalog_bp
from app.whatsapp_templates import EVENTS


class WhatsAppTests(unittest.TestCase):
    def setUp(self):
        self.db = mongomock.MongoClient(tz_aware=True).whatsapp_tests
        self.config = dict(TESTING=True, RATELIMIT_ENABLED=False,
            JWT_SECRET_KEY="test-signing-key-that-is-more-than-32-bytes",
            WHATSAPP_ENVIRONMENT="development", WHATSAPP_TEST_SEND_ENABLED=True,
            WHATSAPP_CANONICAL_URL="https://rashikapoor.co.in", WHATSAPP_MARKETING_ENABLED=False,
            WHATSAPP_ENABLED=True, WHATSAPP_API_VERSION="v26.0", WHATSAPP_PHONE_NUMBER_ID="12345",
            WHATSAPP_BUSINESS_ACCOUNT_ID="67890", WHATSAPP_ACCESS_TOKEN="private-access-token",
            WHATSAPP_APP_SECRET="private-app-secret", WHATSAPP_WEBHOOK_VERIFY_TOKEN="private-verify-token",
            WHATSAPP_APP_ID="123", WHATSAPP_BUSINESS_PORTFOLIO_ID="98765", WHATSAPP_OUTBOX_KEY=Fernet.generate_key().decode(),
            WHATSAPP_TEMPLATES={event: {"enabled": True, "approved": True,
                "components": [{"type": "BODY", "text": " ".join("{{" + str(i + 1) + "}}" for i in range(len(parameters)))}]}
                for event, (_, parameters) in EVENTS.items() if event != "test"})
        self.app = Flask(__name__)
        self.app.config.update(self.config)
        JWTManager(self.app)
        limiter.init_app(self.app)
        self.app.register_blueprint(webhook_bp, url_prefix="/api/webhooks")
        self.app.register_blueprint(admin_bp, url_prefix="/api/admin/integrations/whatsapp")
        self.app.register_blueprint(auth_bp, url_prefix="/api/auth")
        self.app.register_blueprint(catalog_bp, url_prefix="/api/catalog")
        self.client = self.app.test_client()
        self.db.integrations.insert_one({"_id": "whatsapp", "enabled": True})
        self.user = {"_id": ObjectId(), "phone": "+14155552671", "email": "customer@example.test", "whatsappNotifications": True, "role": "customer", "isActive": True}
        self.user["whatsappConsent"] = {"customerId": str(self.user["_id"]), "phone": self.user["phone"], "category": "transactional", "enabled": True, "timestamp": now(), "source": "fixture_explicit_consent"}
        self.db.users.insert_one(self.user)
        self.admin = {**self.user, "role": "admin"}
        with self.app.app_context():
            self.headers = {"Authorization": "Bearer " + create_access_token(identity=str(self.user["_id"]))}
        self.db_patch = patch("app.whatsapp_routes.database", return_value=self.db)
        self.db_patch.start(); self.addCleanup(self.db_patch.stop)
        self.auth_patch = patch("app.rbac.current_user", return_value=self.admin)
        self.auth_patch.start(); self.addCleanup(self.auth_patch.stop)
        self.view_auth_patch = patch("app.whatsapp_routes.current_user", return_value=self.admin)
        self.view_auth_patch.start(); self.addCleanup(self.view_auth_patch.stop)
        self.post = patch("app.whatsapp.requests.post")
        self.http = self.post.start(); self.addCleanup(self.post.stop)
        self.http.return_value = self.response(200, {"messages": [{"id": "wamid.TEST"}]})
        self.configure_catalogue()

    def confirmed_order(self):
        record = {"_id": ObjectId(), "customerId": self.user["_id"], "customerName": "Fixture Customer",
                  "shipping": {"phone": self.user["phone"]},
                  "createdAt": now(),
                  "orderNumber": "RK-1", "currency": "INR", "total": 1250, "amountPaise": 125000,
                  "paymentStatus": "paid", "paymentVerifiedAt": now(), "razorpayPaymentId": "pay_fixture",
                  "captureFulfillmentStatus": "completed",
                  "fulfillment": {"status": "confirmed"}}
        self.db.orders.insert_one(record)
        return record

    def otp_challenge(self, code="983271", purpose="signup"):
        from bcrypt import hashpw, gensalt
        challenge = {"_id": ObjectId(), "phone": self.user["phone"], "purpose": purpose,
                     "otpHash": hashpw(code.encode(), gensalt()).decode(), "otpExpiresAt": now() + timedelta(minutes=10), "otpAttempts": 0}
        self.db.otp_challenges.insert_one(challenge)
        from app.whatsapp_consent import record_consent
        audit = record_consent(self.db, self.app.config, None, self.user["phone"], True, "explicit_fixture_otp", category="authentication", update_user=False)
        self.db.whatsapp_consents.update_one({"_id": ObjectId(audit["consentId"])}, {"$set": {"challengeId": str(challenge["_id"])}})
        return challenge, {"challengeId": str(challenge["_id"]), "purpose": purpose, "consentId": audit["consentId"]}

    @staticmethod
    def response(status, body, headers=None):
        return Mock(status_code=status, json=Mock(return_value=body), headers=headers or {})

    def outbound(self, **kw):
        return send(self.db, self.app.config, kw.pop("recipient", self.user["phone"]), kw.pop("event", "payment_failure"),
                    kw.pop("parameters", {"reference": "RK-1", "status": "confirmed"}), kw.pop("key", "order:1"), **kw)

    def webhook(self, **values):
        value = {"metadata": {"phone_number_id": "12345"}, **values}
        return {"object": "whatsapp_business_account", "entry": [{"id": "67890", "changes": [{"field": "messages", "value": value}]}]}

    @staticmethod
    def provider_status(state, *, message_id="wamid.TEST", timestamp="1700000000", recipient_id="14155552671", **extra):
        return {"id": message_id, "status": state, "timestamp": str(timestamp), "recipient_id": recipient_id, **extra}

    def signed(self, payload):
        raw = json.dumps(payload).encode()
        signature = "sha256=" + hmac.new(self.config["WHATSAPP_APP_SECRET"].encode(), raw, hashlib.sha256).hexdigest()
        return self.client.post("/api/webhooks/whatsapp", data=raw, headers={"X-Hub-Signature-256": signature}, content_type="application/json")

    def test_verification_valid_and_invalid(self):
        path = "/api/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=123&hub.verify_token="
        good = self.client.get(path + self.config["WHATSAPP_WEBHOOK_VERIFY_TOKEN"])
        self.assertEqual(good.status_code, 200); self.assertEqual(good.data, b"123")
        self.assertEqual(self.client.get(path + "wrong").status_code, 403)
        self.assertEqual(self.client.get("/api/webhooks/whatsapp").status_code, 403)
        self.assertIsNotNone(self.db.integrations.find_one({"_id": "whatsapp"})["verifiedAt"])

    def test_signature_required_and_exact_raw_body(self):
        self.assertEqual(self.client.post("/api/webhooks/whatsapp", json=self.webhook()).status_code, 403)
        raw = b'{}'; sig = "sha256=" + hmac.new(b"private-app-secret", raw, hashlib.sha256).hexdigest()
        self.assertEqual(self.client.post("/api/webhooks/whatsapp", data=b'{} ', headers={"X-Hub-Signature-256": sig}).status_code, 403)
        self.assertEqual(self.signed(self.webhook()).status_code, 200)

    def test_malformed_payload_is_rejected(self):
        self.assertEqual(self.signed([]).status_code, 400)
        self.assertEqual(self.signed(self.webhook(messages="bad")).status_code, 400)

    def test_inbound_duplicate_saves_metadata_only(self):
        event = self.webhook(messages=[{"id": "wamid.IN", "from": "14155552671", "type": "text", "timestamp": str(int(now().timestamp())), "text": {"body": "sensitive customer text"}}])
        self.assertEqual(self.signed(event).status_code, 200)
        self.assertEqual(self.signed(event).status_code, 200)
        self.assertEqual(self.db.whatsapp_inbox.count_documents({}), 1)
        saved = str(list(self.db.whatsapp_inbox.find()))
        self.assertNotIn("sensitive customer text", saved); self.assertNotIn("14155552671", saved)

    def test_other_account_and_phone_ignored(self):
        event = self.webhook(messages=[{"id": "foreign", "from": "14155552671", "timestamp": "100"}])
        event["entry"][0]["id"] = "other"
        self.signed(event); self.assertEqual(self.db.whatsapp_inbox.count_documents({}), 0)
        event["entry"][0]["id"] = "67890"; event["entry"][0]["changes"][0]["value"]["metadata"]["phone_number_id"] = "other"
        self.signed(event); self.assertEqual(self.db.whatsapp_inbox.count_documents({}), 0)

    def test_delivery_read_failure_and_out_of_order(self):
        self.outbound()
        for state in ("delivered", "sent", "read", "failed", "delivered"):
            self.assertEqual(self.signed(self.webhook(statuses=[{"id": "wamid.TEST", "status": state}])).status_code, 200)
        saved = self.db.whatsapp_messages.find_one()
        self.assertEqual(saved["status"], "read")
        self.assertIn("deliveredAt", saved); self.assertIn("readAt", saved)
        self.assertEqual(self.db.whatsapp_events.count_documents({}), 4)

    def test_sent_status_uses_meta_timestamp_and_exact_message_id(self):
        self.outbound()
        response = self.signed(self.webhook(statuses=[self.provider_status("sent", timestamp="1700000001")]))
        self.assertEqual(response.status_code, 200)
        saved = self.db.whatsapp_messages.find_one()
        self.assertEqual(saved["providerId"], "wamid.TEST")
        self.assertEqual(saved["status"], "sent")
        self.assertEqual(saved["sentAt"].isoformat(), "2023-11-14T22:13:21+00:00")
        self.assertEqual(saved["statusHistory"][0]["id"], "wamid.TEST")
        self.assertEqual(saved["statusHistory"][0]["recipientId"], "***2671")
        self.assertEqual(saved["statusHistory"][0]["timestampSource"], "meta")

    def test_delivered_status_saves_timestamp_and_no_read_is_explicit(self):
        self.outbound()
        self.signed(self.webhook(statuses=[self.provider_status("delivered", timestamp="1700000010")]))
        saved = self.db.whatsapp_messages.find_one()
        self.assertEqual(saved["status"], "delivered")
        self.assertEqual(saved["deliveredAt"].isoformat(), "2023-11-14T22:13:30+00:00")
        result = self.client.get("/api/admin/integrations/whatsapp/messages", headers=self.headers)
        message = result.json["messages"][0]
        self.assertEqual(message["readReceiptStatus"], "not_received")
        self.assertEqual(message["deliveryReceiptStatus"], "received")
        self.assertNotIn("readAt", message)

    def test_read_status_proves_delivery_without_fabricating_delivery_time(self):
        self.outbound()
        self.signed(self.webhook(statuses=[self.provider_status("read", timestamp="1700000020")]))
        saved = self.db.whatsapp_messages.find_one()
        self.assertEqual(saved["status"], "read")
        self.assertEqual(saved["readAt"].isoformat(), "2023-11-14T22:13:40+00:00")
        self.assertNotIn("deliveredAt", saved)
        result = self.client.get("/api/admin/integrations/whatsapp/messages", headers=self.headers)
        message = result.json["messages"][0]
        self.assertEqual(message["readReceiptStatus"], "received")
        self.assertEqual(message["deliveryReceiptStatus"], "confirmed_by_read_receipt")

    def test_failed_status_persists_safe_error_details(self):
        self.outbound()
        self.signed(self.webhook(statuses=[self.provider_status("failed", timestamp="1700000030", errors=[{
            "code": 131026, "error_subcode": 42,
            "message": "private-access-token customer@example.test +14155552671",
            "error_data": {"details": "private-app-secret"},
        }])]))
        saved = self.db.whatsapp_messages.find_one()
        self.assertEqual(saved["status"], "failed")
        self.assertEqual(saved["failedAt"].isoformat(), "2023-11-14T22:13:50+00:00")
        self.assertEqual(saved["failureDetails"], {"kind": "delivery_failed", "errors": [{"kind": "delivery_failed", "description": "Meta could not deliver this message to the recipient.", "code": 131026, "subcode": 42}]})
        for private_value in ("private-access-token", "private-app-secret", "customer@example.test", "+14155552671"):
            self.assertNotIn(private_value, str(saved))

    def test_duplicate_status_callback_is_idempotent(self):
        self.outbound()
        payload = self.webhook(statuses=[self.provider_status("delivered", timestamp="1700000040")])
        self.assertEqual(self.signed(payload).status_code, 200)
        self.assertEqual(self.signed(payload).status_code, 200)
        saved = self.db.whatsapp_messages.find_one()
        self.assertEqual(saved["statusHistory"].__len__(), 1)
        self.assertEqual(self.db.whatsapp_events.count_documents({}), 1)

    def test_out_of_order_sent_after_delivered_does_not_downgrade(self):
        self.outbound()
        payload = self.webhook(statuses=[
            self.provider_status("delivered", timestamp="1700000050"),
            self.provider_status("sent", timestamp="1700000040"),
        ])
        self.assertEqual(self.signed(payload).status_code, 200)
        saved = self.db.whatsapp_messages.find_one()
        self.assertEqual(saved["status"], "delivered")
        self.assertEqual(saved["sentAt"].isoformat(), "2023-11-14T22:14:00+00:00")
        self.assertEqual(saved["deliveredAt"].isoformat(), "2023-11-14T22:14:10+00:00")

    def test_unknown_meta_message_id_does_not_mutate_another_outbound(self):
        self.outbound()
        response = self.signed(self.webhook(statuses=[self.provider_status("read", message_id="wamid.UNKNOWN")]))
        self.assertEqual(response.status_code, 200)
        saved = self.db.whatsapp_messages.find_one()
        self.assertEqual(saved["providerId"], "wamid.TEST")
        self.assertEqual(saved["status"], "accepted")
        self.assertNotIn("statusHistory", saved)
        unknown_event = self.db.whatsapp_events.find_one({"providerId": "wamid.UNKNOWN"})
        self.assertFalse(unknown_event["matched"])

    def test_multiple_statuses_in_one_payload_are_all_recorded(self):
        self.outbound()
        payload = self.webhook(statuses=[
            self.provider_status("sent", timestamp="1700000060"),
            self.provider_status("delivered", timestamp="1700000061"),
            self.provider_status("read", timestamp="1700000062"),
        ])
        self.assertEqual(self.signed(payload).status_code, 200)
        saved = self.db.whatsapp_messages.find_one()
        self.assertEqual(saved["status"], "read")
        self.assertEqual({item["status"] for item in saved["statusHistory"]}, {"sent", "delivered", "read"})
        self.assertEqual(self.db.whatsapp_events.count_documents({}), 3)

    def test_read_callback_after_delivered_advances_and_keeps_both_timestamps(self):
        self.outbound()
        self.signed(self.webhook(statuses=[self.provider_status("delivered", timestamp="1700000070")]))
        self.signed(self.webhook(statuses=[self.provider_status("read", timestamp="1700000071")]))
        saved = self.db.whatsapp_messages.find_one()
        self.assertEqual(saved["status"], "read")
        self.assertEqual(saved["deliveredAt"].isoformat(), "2023-11-14T22:14:30+00:00")
        self.assertEqual(saved["readAt"].isoformat(), "2023-11-14T22:14:31+00:00")
        self.assertEqual(len(saved["statusHistory"]), 2)

    def test_failed_status_error_allowlist(self):
        self.outbound()
        self.signed(self.webhook(statuses=[{"id": "wamid.TEST", "status": "failed", "errors": [{"code": 131026, "message": "private-access-token +14155552671"}]}]))
        saved = self.db.whatsapp_messages.find_one()
        self.assertEqual(saved["error"], {"kind": "delivery_failed", "errors": [{"kind": "delivery_failed", "description": "Meta could not deliver this message to the recipient.", "code": 131026}]})
        self.assertIn("failedAt", saved)

    def test_webhook_before_send_response_uses_correlation(self):
        def respond(*args, **kwargs):
            correlation = kwargs["json"]["biz_opaque_callback_data"]
            self.signed(self.webhook(statuses=[{"id": "wamid.TEST", "status": "read", "biz_opaque_callback_data": correlation}]))
            return self.response(200, {"messages": [{"id": "wamid.TEST"}]})
        self.http.side_effect = respond
        self.outbound(); self.assertEqual(self.db.whatsapp_messages.find_one()["status"], "read")

    def test_outbound_success_and_duplicate(self):
        result = self.outbound()
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(self.outbound()["status"], "duplicate")
        self.assertEqual(self.http.call_count, 1)
        kwargs = self.http.call_args.kwargs
        self.assertEqual(kwargs["timeout"], (3.05, 10)); self.assertFalse(kwargs["allow_redirects"])
        self.assertEqual(kwargs["json"]["to"], "14155552671")

    def test_invalid_token_is_sanitized(self):
        self.http.return_value = self.response(401, {"error": {"code": 190, "message": "private-access-token customer@example.test"}})
        result = self.outbound()
        self.assertEqual(result["error"]["kind"], "invalid_credentials")
        self.assertNotIn("private-access-token", str(result)); self.assertEqual(self.http.call_count, 1)

    @patch("app.whatsapp.retry_sleep")
    def test_rate_limit_retries_are_bounded(self, sleep):
        self.http.return_value = self.response(429, {"error": {"code": 130429}}, {"Retry-After": "1"})
        self.assertEqual(self.outbound()["status"], "failed")
        self.assertEqual(self.http.call_count, 3); self.assertEqual(sleep.call_count, 2)

    def test_long_retry_after_does_not_block_worker(self):
        self.http.return_value = self.response(429, {"error": {"code": 4}}, {"Retry-After": "120"})
        self.assertEqual(self.outbound()["status"], "failed"); self.assertEqual(self.http.call_count, 1)

    def test_timeout_and_5xx_are_not_blindly_retried(self):
        self.http.side_effect = requests.Timeout("private-access-token")
        self.assertEqual(self.outbound()["status"], "unknown")
        self.assertEqual(self.outbound()["status"], "duplicate"); self.assertEqual(self.http.call_count, 1)
        self.http.side_effect = None; self.http.return_value = self.response(503, {"error": {"code": 2}})
        self.assertEqual(self.outbound(key="another")["status"], "unknown"); self.assertEqual(self.http.call_count, 2)

    def test_invalid_recipient_and_no_country_inference(self):
        for value in ("9876543210", "+123", "invalid", "+14155552671 ext 3"):
            with self.subTest(value=value):
                self.assertEqual(self.outbound(recipient=value)["reason"], "invalid_recipient")
        self.assertEqual(normalize_phone("00 44 20 7946 0018"), "+442079460018")
        self.http.assert_not_called()

    def test_both_enable_gates_required(self):
        self.app.config["WHATSAPP_ENABLED"] = False
        self.assertEqual(self.outbound()["reason"], "disabled")
        self.app.config["WHATSAPP_ENABLED"] = True
        self.db.integrations.update_one({"_id": "whatsapp"}, {"$set": {"enabled": False}})
        self.assertEqual(self.outbound()["reason"], "disabled"); self.http.assert_not_called()

    def test_missing_configuration_and_template_approval(self):
        self.app.config["WHATSAPP_API_VERSION"] = ""
        self.assertEqual(self.outbound()["reason"], "configuration_incomplete")
        self.app.config["WHATSAPP_API_VERSION"] = "v26.0"
        self.app.config["WHATSAPP_TEMPLATES"] = {}
        self.assertEqual(self.outbound()["reason"], "template_not_approved_or_enabled")
        self.http.assert_not_called()

    def test_authentication_template_otp_not_logged(self):
        _, context = self.otp_challenge()
        result = self.outbound(event="signup_otp", parameters={"code": "983271"}, auth_context=context)
        self.assertEqual(result["status"], "accepted")
        components = self.http.call_args.kwargs["json"]["template"]["components"]
        self.assertEqual(components[1]["sub_type"], "url")
        self.assertNotIn("983271", str(list(self.db.whatsapp_messages.find())))

    def test_queue_encrypted_deduplicated_and_processed(self):
        record = self.confirmed_order()
        with self.app.app_context():
            self.assertEqual(notify(self.db, "order_confirmation", record)["status"], "queued")
            self.assertEqual(notify(self.db, "order_confirmation", record)["status"], "duplicate")
        self.http.assert_not_called()
        queued = self.db.whatsapp_outbox.find_one()
        self.assertNotIn(self.user["phone"], str(queued)); self.assertNotIn("RK-1", str(queued))
        self.assertEqual(process_outbox(self.db, self.app.config), 1)
        self.assertNotIn("payload", self.db.whatsapp_outbox.find_one())
        self.assertEqual(process_outbox(self.db, self.app.config), 0)

    def test_worker_honors_revoked_consent(self):
        with self.app.app_context():
            notify(self.db, "order_confirmation", self.confirmed_order(), user=self.user)
        self.db.users.update_one({"_id": self.user["_id"]}, {"$set": {"whatsappNotifications": False}})
        process_outbox(self.db, self.app.config)
        self.http.assert_not_called(); self.assertEqual(self.db.whatsapp_outbox.find_one()["status"], "skipped")

    def test_expired_otp_and_interrupted_claim_not_processed(self):
        with self.app.app_context():
            from app.whatsapp import notify_auth_otp
            challenge, _ = self.otp_challenge()
            notify_auth_otp(self.db, "signup_otp", {"phone": self.user["phone"]}, "983271", challenge, "signup")
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 1)
        self.assertNotIn("983271", str(list(self.db.whatsapp_outbox.find())))
        self.db.whatsapp_outbox.update_one({}, {"$set": {"expiresAt": now() - timedelta(seconds=1)}})
        self.assertEqual(process_outbox(self.db, self.app.config), 0)
        self.db.whatsapp_outbox.update_one({}, {"$set": {"expiresAt": now() + timedelta(seconds=60), "status": "processing"}})
        self.assertEqual(process_outbox(self.db, self.app.config), 0)

    def test_text_requires_consent_and_fresh_customer_window(self):
        config = self.app.config
        self.assertEqual(send_text(self.db, config, self.user["phone"], "Hello", "text")["reason"], "no_consent")
        self.assertEqual(send_text(self.db, config, self.user["phone"], "Hello", "text", consent=True)["reason"], "service_window_closed")
        self.signed(self.webhook(messages=[{"id": "wamid.IN", "from": "14155552671", "type": "text", "timestamp": str(int(now().timestamp()))}]))
        self.assertEqual(send_text(self.db, config, self.user["phone"], "Hello", "text", consent=True)["status"], "accepted")

    def test_admin_authorization_all_operations(self):
        for role in ("customer", "staff"):
            with patch("app.rbac.current_user", return_value={**self.user, "role": role}):
                for path, method in (("", "get"), ("", "patch"), ("/messages", "get"), ("/test-send", "post"), ("/test-connection", "post"), ("/test-window", "post"), ("/test-message", "post"), ("/lifecycle-update", "post"), ("/template-status", "post")):
                    result = getattr(self.client, method)("/api/admin/integrations/whatsapp" + path, headers=self.headers, json={})
                    self.assertEqual(result.status_code, 403)
        self.assertEqual(self.client.get("/api/admin/integrations/whatsapp").status_code, 401)

    def test_safe_admin_status_configuration_and_logs(self):
        self.outbound()
        status = self.client.get("/api/admin/integrations/whatsapp", headers=self.headers)
        logs = self.client.get("/api/admin/integrations/whatsapp/messages?status=accepted&type=payment_failure", headers=self.headers)
        self.assertEqual(status.status_code, 200); self.assertEqual(logs.status_code, 200)
        body = status.get_data(as_text=True) + logs.get_data(as_text=True)
        for secret in ("private-access-token", "private-app-secret", "private-verify-token", self.config["WHATSAPP_OUTBOX_KEY"], self.user["phone"]):
            self.assertNotIn(secret, body)
        self.assertEqual(logs.json["messages"][0]["recipient"], "***2671")
        self.assertNotIn("recipientHash", logs.json["messages"][0])
        self.assertEqual(status.headers["Cache-Control"], "no-store")
        bad = self.client.patch("/api/admin/integrations/whatsapp", headers=self.headers, json={"WHATSAPP_ACCESS_TOKEN": "bad"})
        self.assertEqual(bad.status_code, 400)

    def test_test_send_confirmation_and_idempotency(self):
        self.configure_catalogue()
        self.app.config["WHATSAPP_ENABLED"] = False
        self.db.integrations.update_one({"_id": "whatsapp"}, {"$set": {"enabled": False}})
        self.app.config["WHATSAPP_TEMPLATES"]["order_confirmation"]["enabled"] = False
        path = "/api/admin/integrations/whatsapp/test-send"
        self.assertEqual(self.client.post(path, headers=self.headers, json={}).status_code, 400)
        body = {"recipient": self.user["phone"], "event": "order_confirmation", "templateName": "rk_order_confirmation",
                "language": "en_US", "parameters": {"body_1": "Fixture", "body_2": "RK-123", "body_3": "Nov 14", "body_4": "INR 1"},
                "confirmed": True, "requestId": "test-request-123456"}
        self.assertEqual(self.client.post(path, headers=self.headers, json=body).json["status"], "accepted")
        self.assertEqual(self.client.post(path, headers=self.headers, json=body).json["status"], "duplicate")
        self.assertEqual(self.http.call_count, 1)
        sent = self.http.call_args.kwargs["json"]
        self.assertEqual(sent["template"]["name"], "rk_order_confirmation")
        self.assertEqual([item["text"] for item in sent["template"]["components"][0]["parameters"]], ["Fixture", "RK-123", "Nov 14", "INR 1"])
        message = self.db.whatsapp_messages.find_one()
        self.assertTrue(message["testSend"]); self.assertIsNone(message.get("orderId"))
        self.assertFalse(message.get("status") == "failed")
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 0)
        with self.app.app_context():
            order_result = notify(self.db, "order_confirmation", self.confirmed_order())
        self.assertEqual(order_result["status"], "skipped")
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 0)
        self.signed(self.webhook(statuses=[self.provider_status("read", timestamp="1700000020")]))
        updated = self.db.whatsapp_messages.find_one({"_id": message["_id"]})
        self.assertEqual(updated["status"], "read"); self.assertIn("readAt", updated)

    def test_approved_disabled_mapping_is_test_eligible_but_not_automated(self):
        from app.whatsapp_routes import safe_status
        self.configure_catalogue()
        self.app.config["WHATSAPP_ENABLED"] = False
        self.db.integrations.update_one({"_id": "whatsapp"}, {"$set": {"enabled": False}})
        self.app.config["WHATSAPP_TEMPLATES"]["order_confirmation"]["enabled"] = False
        with self.app.app_context():
            status = safe_status(self.db)
        item = status["templates"]["order_confirmation"]
        self.assertTrue(item["approved"])
        self.assertTrue(item["eligibleForTesting"])
        self.assertFalse(item["mappingEnabled"])
        self.assertFalse(item["eligibleForAutomation"])
        self.assertFalse(status["enabled"])
        self.assertFalse(status["environmentEnabled"])
        self.assertFalse(status["marketingEnabled"])

    def test_one_off_test_component_fields_cover_header_body_and_dynamic_url_button(self):
        from app.whatsapp import _test_template_components
        from app.whatsapp_templates import test_parameter_fields
        template = {"parameters": ["customer_name", "order_number"], "components": [
            {"type": "HEADER", "format": "TEXT", "text": "Hello {{1}}"},
            {"type": "BODY", "text": "Order {{1}} is ready: {{2}}"},
            {"type": "BUTTONS", "buttons": [{"type": "URL", "text": "View order", "url": "https://rashikapoor.co.in/orders/{{1}}"}]},
        ]}
        fields = test_parameter_fields(template)
        self.assertEqual([field["key"] for field in fields], ["header_1", "body_1", "body_2", "button_0_1"])
        self.assertEqual(_test_template_components(template, {"header_1": "Fixture", "body_1": "Fixture", "body_2": "RK-1", "button_0_1": "public-order-id"}), [
            {"type": "header", "parameters": [{"type": "text", "text": "Fixture"}]},
            {"type": "body", "parameters": [{"type": "text", "text": "Fixture"}, {"type": "text", "text": "RK-1"}]},
            {"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": "public-order-id"}]},
        ])
        self.assertIsNone(_test_template_components(template, {"header_1": "Fixture"}))

    def test_pending_unknown_and_wrong_language_templates_cannot_be_tested(self):
        self.configure_catalogue()
        path = "/api/admin/integrations/whatsapp/test-send"
        base = {"recipient": self.user["phone"], "event": "order_confirmation", "templateName": "rk_order_confirmation",
                "language": "en_US", "parameters": {"body_1": "Fixture", "body_2": "RK-1", "body_3": "Date", "body_4": "Total"},
                "confirmed": True, "requestId": "not-approved-template-123456"}
        key = "rk_order_confirmation:en_US"
        self.db.whatsapp_template_status.update_one({"_id": key}, {"$set": {"status": "PENDING"}})
        self.assertEqual(self.client.post(path, headers=self.headers, json=base).status_code, 409)
        self.db.whatsapp_template_status.update_one({"_id": key}, {"$set": {"status": "MISSING_OR_UNKNOWN"}})
        self.assertEqual(self.client.post(path, headers=self.headers, json=base).status_code, 409)
        self.assertEqual(self.client.post(path, headers=self.headers, json={**base, "event": "unknown", "templateName": "unknown", "requestId": "unknown-template-123456"}).status_code, 400)
        self.assertEqual(self.client.post(path, headers=self.headers, json={**base, "language": "en_GB", "requestId": "wrong-language-template-123456"}).status_code, 400)
        self.http.assert_not_called()

    def test_test_template_endpoint_requires_canonical_e164_recipient(self):
        self.configure_catalogue()
        body = {"recipient": self.user["phone"], "event": "order_confirmation", "templateName": "rk_order_confirmation", "language": "en_US",
                "parameters": {"body_1": "Fixture", "body_2": "RK-1", "body_3": "Date", "body_4": "Total"},
                "confirmed": True, "requestId": "strict-e164-test-123456"}
        for invalid in ("0014155552671", "+1 (415) 555-2671", "14155552671"):
            result = self.client.post("/api/admin/integrations/whatsapp/test-send", headers=self.headers, json={**body, "recipient": invalid})
            self.assertEqual(result.status_code, 400)
        self.http.assert_not_called()

    def test_admin_rate_limit_enforced(self):
        self.app.config["RATELIMIT_ENABLED"] = True
        # Limiter reads this flag on init, so enable its runtime flag for this test.
        previous = limiter.enabled
        app = Flask("whatsapp-rate-test")
        app.config.update(self.config, RATELIMIT_ENABLED=True, RATELIMIT_STORAGE_URI="memory://")
        JWTManager(app)
        limiter.init_app(app)
        app.register_blueprint(admin_bp, url_prefix="/api/admin/integrations/whatsapp")
        client = app.test_client()
        try:
            limiter.reset()
            path = "/api/admin/integrations/whatsapp/test-send"
            results = [client.post(path if index % 2 == 0 else "/api/admin/integrations/whatsapp/test-message", headers=self.headers, json={}) for index in range(4)]
            self.assertEqual(results[-1].status_code, 429)
        finally:
            limiter.enabled = previous

    def test_connection_check_reads_subscription_without_sending(self):
        response = Mock(); response.json.return_value = {"data": [{"whatsapp_business_api_data": {"id": "123"}}]}
        with patch("app.whatsapp_routes.requests.get", return_value=response):
            result = self.client.post("/api/admin/integrations/whatsapp/test-connection", headers=self.headers)
        self.assertEqual(result.json["subscriptionStatus"], "subscribed"); self.http.assert_not_called()

    def test_recovery_otp_queue_independent_of_email(self):
        with patch("app.blueprints.auth.routes._database", return_value=self.db), patch("app.blueprints.auth.routes._send_otp_email") as email:
            result = self.client.post("/api/auth/forgot-password/request-otp", json={"identifier": self.user["email"], "whatsappOtpConsent": True})
        self.assertEqual(result.status_code, 202); email.assert_called_once()
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 1)
        self.http.assert_not_called()

    def test_order_email_independent_and_whatsapp_db_failure_isolated(self):
        from app.order_confirmation import send_order_confirmation
        from test_order_confirmation import sample_order, seed_completed_capture
        order = sample_order(); order.update(customerId=self.user["_id"], shipping={"phone": self.user["phone"]}, fulfillment={"status": "confirmed"}, paymentVerifiedAt=now())
        seed_completed_capture(self.db, order)
        self.db.orders.insert_one(order)
        with self.app.app_context(), patch("app.order_confirmation.send_html_email", return_value={"id": "email-1"}) as email, patch("app.whatsapp.enabled", side_effect=RuntimeError("database failure")):
            self.assertTrue(send_order_confirmation(self.db, order, self.app.config, self.app.logger))
        email.assert_called_once()
        self.assertEqual(self.db.orders.find_one({"_id": order["_id"]})["confirmationEmail"]["status"], "sent")

    def test_order_whatsapp_queued_even_when_email_fails(self):
        from app.order_confirmation import send_order_confirmation
        from test_order_confirmation import sample_order, seed_completed_capture
        order = sample_order(); order.update(customerId=self.user["_id"], shipping={"phone": self.user["phone"]}, fulfillment={"status": "confirmed"}, paymentVerifiedAt=now())
        seed_completed_capture(self.db, order)
        self.db.orders.insert_one(order)
        with self.app.app_context(), patch("app.order_confirmation.send_html_email", side_effect=RuntimeError("smtp unavailable")):
            self.assertFalse(send_order_confirmation(self.db, order, self.app.config, self.app.logger))
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 2)

    def test_paid_checkout_survives_whatsapp_storage_failure(self):
        from app.blueprints.payments.routes import _fulfil_paid_order
        from test_order_confirmation import sample_order
        order = sample_order()
        order.update(customerId=self.user["_id"], paymentStatus="pending", items=[])
        self.db.orders.insert_one(order)
        with self.app.app_context(), patch("app.order_confirmation.send_html_email", return_value={"id": "email-1"}), patch("app.whatsapp.enabled", side_effect=RuntimeError("whatsapp unavailable")):
            saved, changed = _fulfil_paid_order(self.db, order, "pay_mock", "test")
        self.assertTrue(changed)
        self.assertEqual(saved["paymentStatus"], "paid")
        self.assertEqual(self.db.orders.find_one({"_id": order["_id"]})["confirmationEmail"]["status"], "sent")

    def test_signup_otp_requires_explicit_one_time_consent(self):
        payload = {"firstName": "Test", "lastName": "Customer", "username": "fixture_signup", "email": "signup@example.test",
                   "phone": "+442079460018", "dob": "1990-12-10", "gender": "female", "region": "europe", "password": "test-password"}
        with patch("app.blueprints.auth.routes._database", return_value=self.db), patch("app.blueprints.auth.routes._send_otp_email"):
            self.assertEqual(self.client.post("/api/auth/signup/request-otp", json=payload).status_code, 202)
            self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 0)
            payload["whatsappOtpConsent"] = True
            self.assertEqual(self.client.post("/api/auth/signup/request-otp", json=payload).status_code, 202)
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 1)
        self.assertEqual(process_outbox(self.db, self.app.config), 1)
        self.assertEqual(self.http.call_args.kwargs["json"]["template"]["name"], "rk_authentication_otp")

    def test_manual_custom_status_and_refund_notification_keep_payment_unchanged(self):
        custom = {"_id": ObjectId(), "customerId": self.user["_id"], "email": self.user["email"], "status": "new"}
        order = {"_id": ObjectId(), "customerId": self.user["_id"], "email": self.user["email"], "paymentStatus": "paid", "orderNumber": "RK-REFUND"}
        self.db.custom_order_requests.insert_one(custom); self.db.orders.insert_one(order)
        path = "/api/admin/integrations/whatsapp/lifecycle-update"
        with patch("app.mail.send_html_email") as email:
            for _ in range(2):
                response = self.client.post(path, headers=self.headers, json={"action": "custom_order_status", "recordId": str(custom["_id"]), "status": "in_progress", "confirmed": True})
                self.assertEqual(response.status_code, 200)
            self.assertEqual(email.call_count, 1)
            response = self.client.post(path, headers=self.headers, json={"action": "refund_initiated", "recordId": str(order["_id"]), "confirmed": True})
            self.assertEqual(response.status_code, 200)
        self.assertEqual(self.db.custom_order_requests.find_one()["status"], "in_progress")
        saved = self.db.orders.find_one()
        self.assertEqual(saved["paymentStatus"], "paid"); self.assertIn("refundNotification", saved)
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 2)
        self.http.assert_not_called()

    def test_manual_update_email_failure_does_not_remove_queued_whatsapp(self):
        record = {"_id": ObjectId(), "customerId": self.user["_id"], "email": self.user["email"], "status": "new"}
        self.db.custom_order_requests.insert_one(record)
        with patch("app.mail.send_html_email", side_effect=RuntimeError("smtp unavailable")):
            result = self.client.post("/api/admin/integrations/whatsapp/lifecycle-update", headers=self.headers,
                                      json={"action": "custom_order_status", "recordId": str(record["_id"]), "status": "quoted", "confirmed": True})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json["email"], "failed"); self.assertEqual(result.json["whatsapp"]["status"], "queued")

    def test_custom_request_never_adopts_anonymous_email_as_consent(self):
        product = {"_id": ObjectId(), "name": "Fixture piece"}
        payload = {"productId": str(product["_id"]), "name": "Fixture Customer", "email": self.user["email"], "phone": self.user["phone"]}
        with patch("app.blueprints.catalog.routes.database", return_value=self.db), patch("app.blueprints.catalog.routes.product_document", return_value=product), patch("app.blueprints.catalog.routes.sync_product_variants", return_value=product), patch("app.blueprints.catalog.routes.product_is_runway", return_value=True), patch("app.blueprints.catalog.routes._send_custom_order_emails") as email:
            result = self.client.post("/api/catalog/custom-order-requests", json=payload)
            self.assertEqual(result.status_code, 201)
            self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 0)
            result = self.client.post("/api/catalog/custom-order-requests", headers=self.headers, json=payload)
            self.assertEqual(result.status_code, 201)
            self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 1)
            self.assertEqual(email.call_count, 2)

    def test_tracking_template_includes_saved_tracking_information(self):
        record = {"_id": ObjectId(), "customerId": self.user["_id"], "orderNumber": "RK-TRACK", "customerName": "Fixture Customer", "shipping": {"phone": self.user["phone"]},
                  "fulfillment": {"status": "shipped", "shippedAt": now(), "courier": "Fixture Courier", "trackingNumber": "TRACK-1", "trackingUrl": "https://example.test/track"}}
        self.db.orders.insert_one(record)
        with self.app.app_context():
            notify(self.db, "tracking_update", record)
        process_outbox(self.db, self.app.config)
        values = self.http.call_args.kwargs["json"]["template"]["components"][0]["parameters"]
        self.assertEqual(len(values), 4)
        self.assertEqual("TRACK-1", values[3]["text"])

    def test_logs_paginate_and_validate_filters(self):
        for index in range(51):
            self.db.whatsapp_messages.insert_one({"_id": str(index), "recipient": "***2671", "status": "accepted", "createdAt": now()})
        path = "/api/admin/integrations/whatsapp/messages"
        first = self.client.get(path, headers=self.headers)
        self.assertEqual(len(first.json["messages"]), 50); self.assertTrue(first.json["hasMore"])
        second = self.client.get(path + "?page=2", headers=self.headers)
        self.assertEqual(len(second.json["messages"]), 1); self.assertFalse(second.json["hasMore"])
        self.assertEqual(self.client.get(path + "?status=bogus", headers=self.headers).status_code, 400)
        self.assertEqual(self.client.get(path + "?type=bogus", headers=self.headers).status_code, 400)

    def test_admin_cannot_bypass_environment_enable_gate(self):
        self.app.config["WHATSAPP_ENABLED"] = False
        response = self.client.patch("/api/admin/integrations/whatsapp", headers=self.headers, json={"enabled": True})
        self.assertEqual(response.status_code, 409)
        response = self.client.patch("/api/admin/integrations/whatsapp", headers=self.headers, json={"enabled": False})
        self.assertEqual(response.status_code, 200); self.assertFalse(response.json["enabled"])

    def test_template_environment_overrides_preserve_category_and_parameter_order(self):
        from app.whatsapp_templates import registry
        config = {"WHATSAPP_TEMPLATES": json.dumps({"signup_otp": {"name": "approved_auth", "language": "en_GB", "enabled": True, "approved": True, "category": "MARKETING"}})}
        entry = registry(config)["signup_otp"]
        self.assertEqual(entry["name"], ""); self.assertEqual(entry["category"], "AUTHENTICATION")
        self.assertFalse(entry["approved"])
        self.assertEqual(entry["parameters"], ["code"])
        self.assertFalse(registry({"WHATSAPP_TEMPLATES": "invalid json"})["signup_otp"]["enabled"])

    def text_test(self, **changes):
        body = {"recipient": self.user["phone"], "message": "Fixture message\nKeep exactly this text.",
                "confirmed": True, "requestId": "text-test-request-123456"}
        return self.client.post("/api/admin/integrations/whatsapp/test-message", headers=self.headers, json={**body, **changes})

    def incoming(self, *, age=0, mid="wamid.WINDOW", phone="14155552671"):
        return self.signed(self.webhook(messages=[{"id": mid, "from": phone, "type": "text",
            "timestamp": str(int((now() - timedelta(seconds=age)).timestamp())), "text": {"body": "not retained"}}]))

    def test_local_text_tool_works_with_automated_messaging_off(self):
        self.app.config["WHATSAPP_ENABLED"] = False
        self.db.integrations.update_one({"_id": "whatsapp"}, {"$set": {"enabled": False}})
        self.incoming()
        result = self.text_test()
        self.assertEqual(result.status_code, 200); self.assertEqual(result.json["httpStatus"], 200)
        payload = self.http.call_args.kwargs["json"]
        self.assertEqual(payload["type"], "text")
        self.assertEqual(payload["text"]["body"], "Fixture message\nKeep exactly this text.")
        saved = self.db.whatsapp_messages.find_one()
        self.assertTrue(saved["testSend"]); self.assertEqual(saved["httpStatus"], 200)
        self.assertEqual(saved["providerId"], "wamid.TEST")
        self.assertNotIn("Fixture message", str(saved))
        self.assertFalse(self.app.config["WHATSAPP_ENABLED"])
        self.assertFalse(self.db.integrations.find_one()["enabled"])
        self.assertEqual(self.text_test().json["status"], "duplicate"); self.assertEqual(self.http.call_count, 1)

    def test_no_window_and_exactly_expired_window_cannot_be_bypassed_by_payload(self):
        self.assertEqual(self.text_test(windowOpen=True).status_code, 409)
        self.assertIn("must first message", self.text_test().json["explanation"])
        self.incoming(age=86400)
        self.assertEqual(self.text_test(windowOpen=True, lastIncomingAt=now().isoformat()).status_code, 409)
        self.http.assert_not_called()

    def test_invalid_signature_other_recipient_and_legacy_metadata_do_not_open_window(self):
        event = self.webhook(messages=[{"id": "unsigned", "from": "14155552671", "type": "text", "timestamp": str(int(now().timestamp()))}])
        self.client.post("/api/webhooks/whatsapp", json=event)
        self.incoming(phone="442079460018")
        from app.whatsapp import fingerprint
        self.db.whatsapp_inbox.insert_one({"_id": "legacy-unscoped", "recipientHash": fingerprint(self.user["phone"], self.app.config), "receivedAt": now()})
        self.assertEqual(self.text_test().status_code, 409); self.http.assert_not_called()

    def test_window_uses_latest_verified_inbound_and_current_phone_scope(self):
        self.incoming(age=90000, mid="older")
        self.incoming(age=60, mid="newer")
        self.incoming(age=500, mid="out-of-order")
        result = self.client.post("/api/admin/integrations/whatsapp/test-window", headers=self.headers, json={"recipient": self.user["phone"]})
        self.assertTrue(result.json["open"]); self.assertTrue(result.json["validRecipient"])
        self.assertEqual(result.json["recipient"], self.user["phone"])
        expected = self.db.whatsapp_inbox.find_one({"_id": hashlib.sha256(b"newer").hexdigest()})["receivedAt"]
        self.assertEqual(result.json["lastIncomingAt"], expected.isoformat().replace("+00:00", "Z"))
        self.app.config["WHATSAPP_PHONE_NUMBER_ID"] = "different"
        self.assertEqual(self.text_test().status_code, 409); self.http.assert_not_called()

    def test_service_window_rechecked_at_send_after_preflight(self):
        self.incoming()
        check = self.client.post("/api/admin/integrations/whatsapp/test-window", headers=self.headers, json={"recipient": self.user["phone"]})
        self.assertTrue(check.json["open"])
        self.db.whatsapp_inbox.update_many({}, {"$set": {"receivedAt": now() - timedelta(hours=25)}})
        self.assertEqual(self.text_test().status_code, 409); self.http.assert_not_called()

    def test_local_gate_and_production_guard_apply_to_both_modes(self):
        self.incoming()
        for environment, gate in (("development", False), ("production", True), (None, True)):
            self.app.config.update(WHATSAPP_ENVIRONMENT=environment, WHATSAPP_TEST_SEND_ENABLED=gate)
            self.assertEqual(self.text_test().status_code, 403)
            result = self.client.post("/api/admin/integrations/whatsapp/test-send", headers=self.headers,
                json={"recipient": self.user["phone"], "confirmed": True, "recipientConsentVerified": True,
                      "requestId": "template-test-request-123456"})
            self.assertEqual(result.status_code, 403)
        self.http.assert_not_called()

    def test_missing_consent_invalid_recipient_and_text_length_are_rejected(self):
        self.incoming()
        for changes in ({"confirmed": False}, {"confirmed": "true"}, {"recipient": "+123"}, {"recipient": "4155552671"},
                        {"message": ""}, {"message": "   "}, {"message": None}, {"message": ["hello"]}, {"message": "x" * 4097}):
            with self.subTest(changes=list(changes)):
                self.assertEqual(self.text_test(**changes).status_code, 400)
        self.http.assert_not_called()
        self.assertEqual(self.text_test(message="😀" * 4096).status_code, 200)

    def test_test_text_errors_include_safe_meta_status_code_and_subcode(self):
        self.incoming()
        self.http.return_value = self.response(401, {"error": {"code": 190, "error_subcode": 463,
            "message": "private-access-token private-app-secret customer@example.test"}})
        result = self.text_test()
        self.assertEqual(result.status_code, 502)
        self.assertEqual(result.json["error"], {"kind": "invalid_credentials", "code": 190, "subcode": 463, "httpStatus": 401, "description": "Meta access token is invalid or expired."})
        self.assertEqual(result.json["httpStatus"], 401)
        self.assertEqual(self.db.whatsapp_messages.find_one()["status"], "failed")
        for secret in ("private-access-token", "private-app-secret", "customer@example.test"):
            self.assertNotIn(secret, result.get_data(as_text=True))

    def test_template_test_preserves_approval_and_parameter_validation_with_automation_off(self):
        self.configure_catalogue()
        self.app.config["WHATSAPP_ENABLED"] = False
        self.app.config["WHATSAPP_TEMPLATES"]["order_confirmation"]["enabled"] = False
        body = {"recipient": self.user["phone"], "event": "order_confirmation", "templateName": "rk_order_confirmation", "language": "en_US",
                "confirmed": True, "requestId": "template-test-request-123456", "parameters": {}}
        path = "/api/admin/integrations/whatsapp/test-send"
        self.assertEqual(self.client.post(path, headers=self.headers, json=body).status_code, 409)
        body["parameters"] = {"body_1": "Fixture", "body_2": "RK-1", "body_3": "Date", "body_4": "Total"}
        self.assertEqual(self.client.post(path, headers=self.headers, json=body).status_code, 200)

    def test_callback_is_environment_aware_and_never_falls_back_to_production_locally(self):
        from app.whatsapp import callback_configuration
        local = {"WHATSAPP_ENVIRONMENT": "development"}
        self.assertEqual(callback_configuration(local), {"environment": "development", "callbackUrl": ""})
        for url in ("javascript:alert(1)", "https://example.test/wrong", "https://example.test/api/webhooks/whatsapp?secret=bad"):
            self.assertEqual(callback_configuration({**local, "WHATSAPP_DEVELOPMENT_CALLBACK_URL": url})["callbackUrl"], "")
        local["WHATSAPP_DEVELOPMENT_CALLBACK_URL"] = "https://fixture-tunnel.example/api/webhooks/whatsapp"
        self.assertEqual(callback_configuration(local)["callbackUrl"], local["WHATSAPP_DEVELOPMENT_CALLBACK_URL"])
        local["WHATSAPP_ENVIRONMENT"] = "production"
        self.assertEqual(callback_configuration(local)["callbackUrl"], "https://rashikapoor.co.in/api/webhooks/whatsapp")

    def test_real_config_classes_default_test_gate_off_and_production_cannot_use_it(self):
        import os
        import runpy
        from app.whatsapp import test_send_enabled as gate
        with patch.dict(os.environ, {
            "WHATSAPP_ENVIRONMENT": "production",
            "WHATSAPP_TEST_SEND_ENABLED": "true",
            "WHATSAPP_ENABLED": "true",
            "WHATSAPP_DEVELOPMENT_CALLBACK_URL": "https://local.example/api/webhooks/whatsapp",
        }, clear=True):
            config = runpy.run_path("app/config.py")
        production = config["ProductionConfig"]
        self.assertEqual(production.WHATSAPP_ENVIRONMENT, "production")
        self.assertFalse(production.WHATSAPP_TEST_SEND_ENABLED)
        self.assertFalse(production.WHATSAPP_ENABLED)
        self.assertFalse(gate({"WHATSAPP_ENVIRONMENT": production.WHATSAPP_ENVIRONMENT, "WHATSAPP_TEST_SEND_ENABLED": True}))
        from app.whatsapp import callback_configuration
        self.assertEqual(callback_configuration({
            "WHATSAPP_ENVIRONMENT": production.WHATSAPP_ENVIRONMENT,
            "WHATSAPP_DEVELOPMENT_CALLBACK_URL": "https://local.example/api/webhooks/whatsapp",
        }), {"environment": "production", "callbackUrl": "https://rashikapoor.co.in/api/webhooks/whatsapp"})

    def test_development_test_send_requires_explicit_gate_and_automated_gate_is_independent(self):
        import os
        import runpy
        from app.whatsapp import enabled, test_send_enabled as gate
        for gate_value, expected in (("false", False), ("true", True)):
            with patch.dict(os.environ, {
                "WHATSAPP_ENVIRONMENT": " DEVELOPMENT ",
                "WHATSAPP_TEST_SEND_ENABLED": gate_value,
                "WHATSAPP_ENABLED": "false",
            }, clear=True):
                config = runpy.run_path("app/config.py")["DevelopmentConfig"]
            self.assertEqual(config.WHATSAPP_ENVIRONMENT, "development")
            self.assertEqual(gate({
                "WHATSAPP_ENVIRONMENT": config.WHATSAPP_ENVIRONMENT,
                "WHATSAPP_TEST_SEND_ENABLED": config.WHATSAPP_TEST_SEND_ENABLED,
            }), expected)
            db = Mock()
            db.integrations.find_one.return_value = {"enabled": True}
            self.assertFalse(enabled(db, {"WHATSAPP_ENABLED": config.WHATSAPP_ENABLED}))

    def test_missing_or_invalid_whatsapp_environment_fails_closed_to_production(self):
        import os
        import runpy
        for value in (None, "staging", "", "dev"):
            env = {"WHATSAPP_TEST_SEND_ENABLED": "true", "WHATSAPP_ENABLED": "false"}
            if value is not None:
                env["WHATSAPP_ENVIRONMENT"] = value
            with patch.dict(os.environ, env, clear=True):
                config = runpy.run_path("app/config.py")["BaseConfig"]
            self.assertEqual(config.WHATSAPP_ENVIRONMENT, "production")

    def test_text_retry_stops_if_the_service_window_expires_during_backoff(self):
        self.http.return_value = self.response(429, {"error": {"code": 130429}})
        with patch("app.whatsapp.customer_window", side_effect=[{"open": True}, {"open": True}, {"open": False}]), patch("app.whatsapp.retry_sleep"):
            response = self.text_test()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json["reason"], "service_window_closed")
        self.assertEqual(self.http.call_count, 1)

    def test_unset_configuration_defaults_both_sending_gates_off(self):
        import os
        import runpy
        # Load just the config file with synthetic empty environment, without
        # importing the app factory or loading any local environment files.
        with patch.dict(os.environ, {}, clear=True):
            config = runpy.run_path("app/config.py")
        self.assertFalse(config["BaseConfig"].WHATSAPP_ENABLED)
        self.assertFalse(config["BaseConfig"].WHATSAPP_TEST_SEND_ENABLED)
        self.assertEqual(config["BaseConfig"].WHATSAPP_ENVIRONMENT, "production")
        self.assertEqual(config["BaseConfig"].WHATSAPP_DEVELOPMENT_CALLBACK_URL, "")


    def test_checkout_api_reuses_active_profile_consent_without_creating_a_new_grant_or_queueing(self):
        from app.blueprints.payments.routes import payments_bp
        self.app.register_blueprint(payments_bp, url_prefix="/api/payments")
        with patch("app.blueprints.payments.routes.database", return_value=self.db), patch("app.blueprints.payments.routes.current_user", return_value=self.user), patch("app.blueprints.payments.routes.authenticated_user_id", return_value=self.user["_id"]), patch("app.blueprints.payments.routes.is_configured", return_value=True), patch("app.blueprints.payments.routes.ensure_catalog_seed"), patch("app.blueprints.payments.routes._checkout_items", return_value=([], 1250)), patch("app.blueprints.payments.routes._normalise_shipping", return_value={"phone": self.user["phone"]}), patch("app.blueprints.payments.routes.razorpay_api_request", return_value={"id": "order_fixture"}):
            response = self.client.post("/api/payments/razorpay/order", headers=self.headers, json={"checkoutAttemptId": "consent-checkout-fixture", "whatsappTransactionalConsent": True})
        self.assertEqual(response.status_code, 201)
        order = self.db.orders.find_one({"checkoutAttemptId": "consent-checkout-fixture"})
        self.assertEqual(order["whatsappConsent"]["orderId"], str(order["_id"]))
        self.assertEqual(order["whatsappConsent"]["source"], "fixture_explicit_consent")
        self.assertEqual(order["paymentStatus"], "order_created")
        self.assertEqual(self.db.whatsapp_consents.count_documents({}), 0)
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 0)
        self.http.assert_not_called()

    def test_duplicate_template_status_event_cannot_overwrite_a_later_status_refresh(self):
        self.configure_catalogue()
        event = {"object": "whatsapp_business_account", "entry": [{"id": "67890", "changes": [{"field": "message_template_status_update", "value": {"message_template_name": "rk_order_confirmation", "message_template_language": "en_US", "event": "PAUSED"}}]}]}
        self.assertEqual(self.signed(event).status_code, 200)
        key = "rk_order_confirmation:en_US"
        self.assertEqual(self.db.whatsapp_template_status.find_one({"_id": key})["status"], "PAUSED")
        self.db.whatsapp_template_status.update_one({"_id": key}, {"$set": {"status": "APPROVED", "source": "meta_api_read"}})
        self.signed(event)
        self.assertEqual(self.db.whatsapp_template_status.find_one({"_id": key})["status"], "APPROVED")

    def test_queued_mapping_changes_do_not_substitute_a_different_template(self):
        with self.app.app_context():
            self.assertEqual(notify(self.db, "order_confirmation", self.confirmed_order())["status"], "queued")
        self.app.config["WHATSAPP_TEMPLATES"]["order_confirmation"]["name"] = "unrelated_approved_template"
        process_outbox(self.db, self.app.config)
        self.http.assert_not_called()
        self.assertEqual(self.db.whatsapp_outbox.find_one()["status"], "invalid_payload")

    def test_worker_rechecks_consent_after_meta_rate_limit_backoff(self):
        with self.app.app_context():
            notify(self.db, "order_confirmation", self.confirmed_order())
        self.http.return_value = self.response(429, {"error": {"code": 130429}})
        def revoke(_):
            self.db.users.update_one({"_id": self.user["_id"]}, {"$set": {"whatsappNotifications": False}})
        with patch("app.whatsapp.retry_sleep", side_effect=revoke):
            process_outbox(self.db, self.app.config)
        self.assertEqual(self.http.call_count, 1)
        self.assertEqual(self.db.whatsapp_messages.find_one()["error"]["kind"], "no_consent")

    def test_admin_notifications_use_admin_consent_not_customer_checkout_consent(self):
        from app.whatsapp import notify_admins
        from app.whatsapp_consent import record_consent
        admin = {"_id": ObjectId(), "role": "admin", "phone": "+442079460018", "isActive": True}
        self.db.users.insert_one(admin)
        record_consent(self.db, self.app.config, admin["_id"], admin["phone"], True, "authenticated_profile")
        order = self.confirmed_order()
        order["whatsappConsent"] = record_consent(self.db, self.app.config, self.user["_id"], self.user["phone"], True, "checkout", order_id=order["_id"], update_user=False)
        self.db.orders.update_one({"_id": order["_id"]}, {"$set": {"whatsappConsent": order["whatsappConsent"]}})
        with self.app.app_context():
            notify_admins(self.db, order, "order_received")
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 1)
        process_outbox(self.db, self.app.config)
        self.assertEqual(self.http.call_args.kwargs["json"]["to"], "442079460018")

    def test_profile_withdrawal_blocks_older_order_consent_even_for_a_different_checkout_number(self):
        from app.whatsapp_consent import record_consent, consent_phone
        order = self.confirmed_order()
        order["whatsappConsent"] = record_consent(self.db, self.app.config, self.user["_id"], "+442079460018", True, "checkout", order_id=order["_id"], update_user=False)
        self.assertEqual(consent_phone(self.db, self.app.config, self.user, order), "+442079460018")
        record_consent(self.db, self.app.config, self.user["_id"], self.user["phone"], False, "authenticated_profile")
        user = self.db.users.find_one({"_id": self.user["_id"]})
        self.assertIsNone(consent_phone(self.db, self.app.config, user, order))

    def configure_catalogue(self, include_auth=True):
        from app.whatsapp_catalogue import CATALOGUE, EVENT_CATALOGUE
        from app.whatsapp_definitions import definition_components
        self.app.config["WHATSAPP_TEMPLATES"] = {**self.app.config["WHATSAPP_TEMPLATES"], **{
            event: {"catalogue": name, "name": name, "language": "en_US", "category": CATALOGUE[name]["category"],
                    "parameters": CATALOGUE[name]["parameters"], "parameterTypes": CATALOGUE[name]["parameterTypes"],
                    "enabled": True, "approvalStatus": "APPROVED"}
            for event, name in EVENT_CATALOGUE.items() if include_auth or CATALOGUE[name]["category"] == "UTILITY"
        }}
        from app.whatsapp_routes import refresh_template_observations
        from app.whatsapp_templates import registry
        rows = [{"name": name, "language": spec["language"], "category": spec["category"], "status": "APPROVED",
                 "components": definition_components(spec)} for name, spec in CATALOGUE.items()]
        rows += [{"name": item["name"], "language": item["language"], "category": item["category"], "status": "APPROVED", "components": item["components"]}
                 for item in registry(self.app.config).values() if not item["catalogue"]]
        with patch("app.whatsapp_routes.requests.get", return_value=self.response(200, {"data": rows})):
            refresh_template_observations(self.db, self.app.config)

    def assert_catalogue_utility(self, event, expected_name, ordered_keys):
        self.configure_catalogue()
        self.app.config["WHATSAPP_ENABLED"] = False
        params = {key: "fixture-" + key for key in reversed(ordered_keys)}
        result = send(self.db, self.app.config, self.user["phone"], event, params, "catalogue:" + event, test_send=True, consent=True)
        self.assertEqual(result["status"], "accepted")
        payload = self.http.call_args.kwargs["json"]["template"]
        self.assertEqual(payload["name"], expected_name)
        self.assertEqual(payload["language"], {"code": "en_US"})
        self.assertEqual([p["text"] for p in payload["components"][0]["parameters"]], [params[key] for key in ordered_keys])
        self.assertEqual(self.db.whatsapp_inbox.count_documents({}), 0)  # No service window needed.

    def test_catalogue_order_confirmation_payload(self):
        self.assert_catalogue_utility("order_confirmation", "rk_order_confirmation", ["customer_name", "order_number", "order_date", "order_total"])

    def test_catalogue_payment_confirmation_payload(self):
        self.assert_catalogue_utility("payment_confirmation", "rk_payment_confirmation", ["customer_name", "order_number", "paid_amount", "payment_reference"])

    def test_catalogue_order_shipped_payload(self):
        self.assert_catalogue_utility("shipped", "rk_order_shipped", ["customer_name", "order_number", "courier_name", "tracking_id"])

    def test_catalogue_out_for_delivery_payload(self):
        self.assert_catalogue_utility("out_for_delivery", "rk_out_for_delivery", ["customer_name", "order_number", "courier_name", "tracking_id"])

    def test_catalogue_delivered_payload(self):
        self.assert_catalogue_utility("delivered", "rk_order_delivered", ["customer_name", "order_number", "delivered_on"])

    def test_catalogue_cancelled_payload(self):
        self.assert_catalogue_utility("cancelled", "rk_order_cancelled", ["customer_name", "order_number", "cancellation_reference"])

    def test_catalogue_refund_payload(self):
        self.assert_catalogue_utility("refund_completed", "rk_refund_processed", ["customer_name", "order_number", "refund_amount", "refund_reference"])

    def test_catalogue_authentication_uses_same_code_in_body_and_copy_button(self):
        from app.whatsapp import notify_auth_otp
        self.configure_catalogue()
        challenge, _ = self.otp_challenge()
        with self.app.app_context():
            self.assertEqual(notify_auth_otp(self.db, "signup_otp", {"phone": self.user["phone"]}, "983271", challenge, "signup")["status"], "queued")
        queued = self.db.whatsapp_outbox.find_one()
        self.assertLess(abs((queued["expiresAt"] - challenge["otpExpiresAt"]).total_seconds()), 1)
        self.assertNotIn("983271", str(queued))
        process_outbox(self.db, self.app.config)
        template = self.http.call_args.kwargs["json"]["template"]
        self.assertEqual(template["name"], "rk_authentication_otp")
        self.assertEqual(template["components"], [
            {"type": "body", "parameters": [{"type": "text", "text": "983271"}]},
            {"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": "983271"}]}])
        self.assertNotIn("983271", str(list(self.db.whatsapp_messages.find())))
        self.assertEqual(self.db.whatsapp_consents.find_one()["category"], "authentication")

    def test_new_catalogue_is_unsubmitted_and_all_legacy_mappings_survive(self):
        from app.whatsapp_templates import registry
        mappings = registry({"WHATSAPP_TEMPLATES": {}})
        self.assertEqual(set(mappings), set(EVENTS))
        self.assertEqual(len(mappings), 29)  # Existing mappings plus manual checkout and ledger events.
        self.assertTrue(all(not t["approved"] and not t["enabled"] for t in mappings.values()))
        self.assertEqual(mappings["signup_otp"]["name"], "rk_authentication_otp")
        legacy = registry({"WHATSAPP_TEMPLATES": {"shipped": {"name": "existing_approved", "language": "en_GB", "approved": True, "enabled": True}}})
        self.assertEqual(legacy["shipped"]["parameters"], ["reference", "status", "tracking"])
        self.assertEqual(legacy["shipped"]["name"], "existing_approved")
        self.assertFalse(legacy["shipped"]["approved"])  # Legacy schema is preserved, but cannot attest to real Meta approval.

    def test_catalogue_schema_mismatches_and_unapproved_states_cannot_send(self):
        from app.whatsapp_templates import registry
        self.configure_catalogue()
        original = dict(self.app.config["WHATSAPP_TEMPLATES"]["shipped"])
        for change in ({"name": "unrelated"}, {"language": "en_GB"}, {"category": "MARKETING"},
                       {"parameters": list(reversed(original["parameters"]))}, {"parameterTypes": ["otp"] * 4},
                       {"approvalStatus": "PENDING"}, {"approvalStatus": "REJECTED"}, {"enabled": False}):
            self.app.config["WHATSAPP_TEMPLATES"]["shipped"] = {**original, **change}
            self.assertFalse(registry(self.app.config)["shipped"]["approved"] and registry(self.app.config)["shipped"]["enabled"])
        self.http.assert_not_called()

    def test_template_status_refresh_is_read_only_and_revocation_blocks_sends(self):
        self.configure_catalogue()
        response = self.response(200, {"data": [{"name": "rk_order_confirmation", "language": "en_US", "category": "UTILITY", "status": "PAUSED"}]})
        with patch("app.whatsapp_routes.requests.get", return_value=response) as get:
            result = self.client.post("/api/admin/integrations/whatsapp/template-status", headers=self.headers)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json["templates"]["order_confirmation"]["observedStatus"], "PAUSED")
        self.assertFalse(result.json["templates"]["order_confirmation"]["approved"])
        get.assert_called_once(); self.http.assert_not_called()
        result = send(self.db, self.app.config, self.user["phone"], "order_confirmation", {"customer_name": "Fixture", "order_number": "RK", "order_total": "INR 1.00"}, "revoked", test_send=True, consent=True)
        self.assertEqual(result["reason"], "template_not_approved_or_enabled")

    def test_template_status_error_never_exposes_provider_response(self):
        with patch("app.whatsapp_routes.requests.get", side_effect=requests.HTTPError("private-access-token")):
            response = self.client.post("/api/admin/integrations/whatsapp/template-status", headers=self.headers)
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("private-access-token", response.get_data(as_text=True))

    def test_meta_template_status_pagination_and_exact_pending_reconciliation(self):
        from app.whatsapp_definitions import definitions, definition_components
        from app.whatsapp_templates import template_registry, meta_status
        spec = definitions(self.app.config)["rk_new_collection_drop"]
        meta_components = [
            {"type": "HEADER", "format": "TEXT", "text": "A New Collection Has Arrived"},
            {"type": "BODY", "text": "Hello {{1}},\n\nA new expression of Rashi Kapoor has arrived."},
            {"type": "FOOTER", "text": "Rashi Kapoor Official"},
            {"type": "BUTTONS", "buttons": [{"type": "URL", "text": "Visit website", "url": "https://rashikapoor.co.in/"}]},
        ]
        page_one = self.response(200, {"data": [{"name": spec["name"], "language": spec["language"], "status": "PENDING", "category": "MARKETING", "components": meta_components}],
            "paging": {"next": "https://graph.facebook.com/next", "cursors": {"after": "cursor-page-two"}}})
        page_two = self.response(200, {"data": [{"name": "meta_only_template", "language": "en_US", "status": "APPROVED", "category": "UTILITY", "components": []}]})
        with patch("app.whatsapp_routes.requests.get", side_effect=[page_one, page_two]) as get:
            response = self.client.post("/api/admin/integrations/whatsapp/template-status", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(get.call_count, 2)
        self.assertEqual(get.call_args_list[1].kwargs["params"]["after"], "cursor-page-two")
        cached = self.db.whatsapp_template_status.find_one({"_id": "rk_new_collection_drop:en_US"})
        self.assertEqual(cached["status"], "PENDING")
        self.assertEqual(cached["evidenceState"], "found")
        self.assertEqual(cached["businessAccountId"], self.config["WHATSAPP_BUSINESS_ACCOUNT_ID"])
        self.assertFalse(cached["componentsVerified"])
        self.assertEqual(cached["metaComponents"][2]["text"], "Rashi Kapoor Official")
        self.assertEqual(cached["metaComponents"][3]["buttons"][0]["text"], "Visit website")
        self.assertEqual(template_registry(self.db, self.app.config)["new_collection_drop"]["observedStatus"], "PENDING")
        self.assertFalse(template_registry(self.db, self.app.config)["new_collection_drop"]["approved"])
        self.assertEqual(self.db.whatsapp_template_status.find_one({"_id": "meta_only_template:en_US"})["evidenceState"], "found_not_locally_mapped")
        self.assertEqual(meta_status("PENDING"), "PENDING")
        for status in ("APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED", "IN_APPEAL", "PENDING_DELETION", "DELETED", "LIMIT_EXCEEDED", "ARCHIVED"):
            self.assertEqual(meta_status(status), status)
        self.assertEqual(meta_status("UNRECOGNIZED"), "MISSING_OR_UNKNOWN")

    def test_integration_template_approved_status_is_independent_of_pending_quality(self):
        from app.whatsapp_templates import LOCAL_TEST_TEMPLATE, template_registry
        self.local_registered_template()
        row = {**LOCAL_TEST_TEMPLATE, "status": "APPROVED", "quality_score": {"score": "UNKNOWN"}}
        with patch("app.whatsapp_routes.requests.get", return_value=self.response(200, {"data": [row]})) as get:
            result = self.client.post("/api/admin/integrations/whatsapp/template-status", headers=self.headers)
        self.assertEqual(result.status_code, 200)
        template = result.json["templates"]["test"]
        self.assertEqual(template["name"], "3p_direct_integration_test_template")
        self.assertEqual(template["templateGroup"], "Integration Test")
        self.assertEqual(template["observedStatus"], "APPROVED")
        self.assertEqual(template["qualityRating"], "UNKNOWN")
        self.assertTrue(template["approved"])
        self.assertTrue(template["componentsVerified"])
        self.assertTrue(template["eligibleForTesting"])
        self.assertIn("quality_score", get.call_args.kwargs["params"]["fields"])
        stored = self.db.whatsapp_template_status.find_one({"_id": "3p_direct_integration_test_template:en_US"})
        self.assertEqual(stored["status"], "APPROVED")
        self.assertEqual(stored["qualityRating"], "UNKNOWN")
        self.assertEqual(template_registry(self.db, self.app.config)["test"]["observedStatus"], "APPROVED")

    def test_integration_approval_survives_read_failure_and_quality_never_changes_status(self):
        from app.whatsapp_templates import LOCAL_TEST_TEMPLATE, template_registry
        self.local_registered_template()
        row = {**LOCAL_TEST_TEMPLATE, "status": "APPROVED", "quality_score": {"score": "UNKNOWN"}}
        with patch("app.whatsapp_routes.requests.get", return_value=self.response(200, {"data": [row]})):
            self.client.post("/api/admin/integrations/whatsapp/template-status", headers=self.headers)
        with patch("app.whatsapp_routes.requests.get", side_effect=requests.HTTPError("temporary read failure")):
            failed = self.client.post("/api/admin/integrations/whatsapp/template-status", headers=self.headers)
        self.assertEqual(failed.status_code, 502)
        shown = failed.json["status"]["templates"]["test"]
        self.assertEqual(shown["observedStatus"], "APPROVED")
        self.assertEqual(shown["qualityRating"], "UNKNOWN")
        self.assertTrue(shown["statusStale"])
        self.assertFalse(shown["approved"])
        cached = self.db.whatsapp_template_status.find_one({"_id": "3p_direct_integration_test_template:en_US"})
        self.assertEqual(cached["status"], "APPROVED")
        self.assertEqual(cached["qualityRating"], "UNKNOWN")
        self.assertEqual(template_registry(self.db, self.app.config)["test"]["observedStatus"], "APPROVED")

    def test_three_known_missing_entries_are_explained_as_local_drafts(self):
        from app.whatsapp_routes import safe_status
        self.local_registered_template()
        config = self.app.config["WHATSAPP_TEMPLATES"]
        config["signup_otp"] = {"catalogue": "rk_authentication_otp", "name": "rk_authentication_otp", "language": "en_US", "category": "AUTHENTICATION", "parameters": ["code"], "parameterTypes": ["otp"], "approvalStatus": "NOT_SUBMITTED", "enabled": False}
        config["exclusive_offer"] = {"catalogue": "rk_exclusive_offer", "name": "rk_exclusive_offer", "language": "en_US", "category": "MARKETING", "parameters": ["first_name", "offer_description", "coupon_code", "expiry_date"], "parameterTypes": ["text"] * 4, "approvalStatus": "NOT_SUBMITTED", "enabled": False}
        config["admin_notification"] = {"name": "rk_admin_notification", "language": "en_US", "category": "UTILITY", "parameters": ["reference", "status"], "approvalStatus": "NOT_SUBMITTED", "enabled": False}
        for name in ("rk_authentication_otp", "rk_exclusive_offer", "rk_admin_notification"):
            self.db.whatsapp_template_status.update_one({"_id": name + ":en_US"}, {"$set": {"name": name, "language": "en_US", "status": "MISSING_OR_UNKNOWN", "category": "UNKNOWN", "presentInMeta": False, "evidenceState": "absent_from_complete_inventory", "businessAccountId": self.config["WHATSAPP_BUSINESS_ACCOUNT_ID"], "source": "meta_api_read"}}, upsert=True)
        self.db.whatsapp_template_status.update_one({"_id": "rk_test:en"}, {"$set": {"name": "rk_test", "language": "en", "status": "PENDING", "category": "MARKETING", "presentInMeta": True, "evidenceState": "found_not_locally_mapped", "businessAccountId": self.config["WHATSAPP_BUSINESS_ACCOUNT_ID"], "source": "meta_api_read"}}, upsert=True)
        with self.app.app_context():
            status = safe_status(self.db)
        missing = {row["name"]: row for row in status["catalogue"].values() if row.get("localDraft")}
        self.assertTrue(missing["rk_authentication_otp"]["draftExplanation"].startswith("Local Authentication draft"))
        self.assertIn("coupon", missing["rk_exclusive_offer"]["draftExplanation"])
        admin_draft = status["templates"]["admin_notification"]
        self.assertTrue(admin_draft["localDraft"])
        self.assertIn("Internal-only", admin_draft["draftExplanation"])
        self.assertNotIn("admin_notification", status["catalogue"])
        self.assertNotIn("rk_test", [row["name"] for row in status["templates"].values()])
        self.assertEqual(status["unmappedTemplates"][0]["name"], "rk_test")
        self.assertEqual(status["unmappedTemplates"][0]["language"], "en")
        self.assertEqual(status["unmappedTemplates"][0]["category"], "MARKETING")

    def test_unmapped_meta_template_cannot_be_sent_by_local_test_transport(self):
        result = send(self.db, self.app.config, self.user["phone"], "rk_test", {}, "unmapped-rk-test", test_send=True, consent=True)
        self.assertEqual(result["reason"], "invalid_test_type")
        self.http.assert_not_called()

    def test_complete_inventory_distinguishes_absent_draft_from_api_failure_and_marks_cached_status_stale(self):
        from app.whatsapp import now
        from app.whatsapp_templates import template_registry
        self.db.whatsapp_template_status.delete_one({"_id": "rk_new_collection_drop:en_US"})
        with patch("app.whatsapp_routes.requests.get", return_value=self.response(200, {"data": []})):
            first = self.client.post("/api/admin/integrations/whatsapp/template-status", headers=self.headers)
        self.assertEqual(first.status_code, 200)
        missing = self.db.whatsapp_template_status.find_one({"_id": "rk_new_collection_drop:en_US"})
        self.assertEqual(missing["status"], "MISSING_OR_UNKNOWN")
        self.assertEqual(missing["evidenceState"], "local_definition_not_found_in_complete_inventory")
        checked_at = now()
        self.db.whatsapp_template_status.update_one({"_id": missing["_id"]}, {"$set": {
            "status": "PENDING", "evidenceState": "found", "presentInMeta": True,
            "businessAccountId": self.config["WHATSAPP_BUSINESS_ACCOUNT_ID"], "checkedAt": checked_at,
            "source": "meta_api_read", "category": "MARKETING", "componentsVerified": False,
        }})
        stored_checked_at = self.db.whatsapp_template_status.find_one({"_id": missing["_id"]})["checkedAt"]
        with patch("app.whatsapp_routes.requests.get", side_effect=requests.HTTPError("sanitized provider outage")):
            failed = self.client.post("/api/admin/integrations/whatsapp/template-status", headers=self.headers)
        self.assertEqual(failed.status_code, 502)
        self.assertEqual(failed.json["status"]["templates"]["new_collection_drop"]["observedStatus"], "PENDING")
        self.assertTrue(failed.json["status"]["templates"]["new_collection_drop"]["statusStale"])
        preserved = self.db.whatsapp_template_status.find_one({"_id": missing["_id"]})
        self.assertEqual(preserved["status"], "PENDING")
        self.assertEqual(preserved["checkedAt"], stored_checked_at)
        self.assertEqual(template_registry(self.db, self.app.config)["new_collection_drop"]["approved"], False)
        self.assertEqual(failed.json["status"]["templateStatusSync"]["lastError"], "meta_inventory_unavailable_or_incomplete")

    def test_incomplete_meta_pagination_does_not_mark_templates_missing(self):
        from app.whatsapp_routes import refresh_template_observations
        self.db.whatsapp_template_status.update_one({"_id": "rk_new_collection_drop:en_US"}, {"$set": {"status": "PENDING", "category": "MARKETING", "source": "meta_api_read", "businessAccountId": self.config["WHATSAPP_BUSINESS_ACCOUNT_ID"], "checkedAt": now(), "presentInMeta": True}})
        page = self.response(200, {"data": [], "paging": {"next": "https://graph.facebook.com/next", "cursors": {}}})
        with patch("app.whatsapp_routes.requests.get", return_value=page):
            with self.assertRaises(ValueError):
                refresh_template_observations(self.db, self.app.config)
        cached = self.db.whatsapp_template_status.find_one({"_id": "rk_new_collection_drop:en_US"})
        self.assertEqual(cached["status"], "PENDING")
        self.assertEqual(self.db.integrations.find_one({"_id": "whatsapp"})["templateStatusSync"]["lastError"], "meta_inventory_unavailable_or_incomplete")

    def test_pending_collection_template_can_preview_but_campaign_authorization_is_blocked(self):
        from app.whatsapp_campaigns import preview_campaign, authorize_campaign
        self.configure_extended("new_collection_drop", "rk_new_collection_drop", status="PENDING")
        payload = self.marketing_fixture()
        with patch("app.whatsapp_campaigns.destination_reachable", return_value=True):
            preview, _ = preview_campaign(self.db, self.app.config, payload)
            self.assertEqual(preview["template"]["observedStatus"], "PENDING")
            self.assertFalse(preview["canAuthorize"])
            self.assertIn("template_not_approved_or_enabled", preview["disabledReasons"])
            with self.assertRaisesRegex(ValueError, "campaign_not_eligible"):
                authorize_campaign(self.db, self.app.config, {**payload, "confirmed": True, "previewDigest": preview["previewDigest"], "requestId": "pending-campaign-123456"}, self.admin["_id"])
        self.assertEqual(self.db.whatsapp_campaigns.count_documents({}), 0)

    def test_pending_collection_campaign_can_be_saved_as_a_non_sending_draft(self):
        self.configure_extended("new_collection_drop", "rk_new_collection_drop", status="PENDING")
        payload = self.marketing_fixture()
        payload["requestId"] = "collection-draft-request-123456"
        response = self.client.post("/api/admin/integrations/whatsapp/campaigns/drafts", headers=self.headers, json=payload)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json["status"], "draft")
        self.assertEqual(response.json["templateStatus"], "PENDING")
        saved = self.db.whatsapp_campaign_drafts.find_one({"_id": response.json["draftId"]})
        self.assertEqual(saved["status"], "draft")
        self.assertEqual(saved["data"]["destinationPath"], "/collections/database-collection")
        self.assertNotIn("recipientIds", saved)
        self.assertNotIn(self.user["phone"], str(saved))
        repeated = self.client.post("/api/admin/integrations/whatsapp/campaigns/drafts", headers=self.headers, json=payload)
        self.assertEqual(repeated.status_code, 201)
        self.assertEqual(repeated.json["draftId"], response.json["draftId"])
        offer = {**payload, "event": "exclusive_offer", "requestId": "offer-draft-request-123456"}
        self.assertEqual(self.client.post("/api/admin/integrations/whatsapp/campaigns/drafts", headers=self.headers, json=offer).status_code, 409)
        self.assertEqual(self.db.whatsapp_campaign_drafts.count_documents({}), 1)

    def test_campaign_options_excludes_coupon_offer_and_reports_why(self):
        response = self.client.get("/api/admin/integrations/whatsapp/campaigns/options", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertIn("new_collection_drop", response.json["templates"])
        self.assertNotIn("exclusive_offer", response.json["templates"])
        self.assertEqual(response.json["unavailableTemplates"]["exclusive_offer"]["reason"], "coupon_integration_unavailable")

    def test_boolean_preference_without_consent_metadata_is_not_permission(self):
        self.db.users.update_one({"_id": self.user["_id"]}, {"$unset": {"whatsappConsent": ""}})
        with self.app.app_context():
            result = notify(self.db, "order_confirmation", self.confirmed_order())
        self.assertEqual(result["reason"], "missing_or_withdrawn_consent")
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 0)

    def test_verified_stop_blocks_both_tests_and_queued_notifications_without_retaining_text(self):
        with self.app.app_context():
            notify(self.db, "order_confirmation", self.confirmed_order())
        stop = self.webhook(messages=[{"id": "stop-1", "from": "14155552671", "type": "text", "timestamp": str(int(now().timestamp())), "text": {"body": "STOP"}}])
        self.assertEqual(self.signed(stop).status_code, 200)
        self.assertFalse(self.db.users.find_one({"_id": self.user["_id"]})["whatsappNotifications"])
        self.assertEqual(self.outbound()["reason"], "recipient_opted_out")
        self.assertEqual(send_text(self.db, self.app.config, self.user["phone"], "fixture", "stop-text", consent=True, test_send=True)["reason"], "recipient_opted_out")
        process_outbox(self.db, self.app.config); self.http.assert_not_called()
        self.assertNotIn("STOP", str(list(self.db.whatsapp_inbox.find())))
        from app.whatsapp_consent import record_consent
        record_consent(self.db, self.app.config, self.user["_id"], self.user["phone"], True, "authenticated_profile")
        self.signed(stop)  # Duplicate old STOP cannot revoke freshly granted consent.
        self.assertTrue(self.db.users.find_one({"_id": self.user["_id"]})["whatsappNotifications"])

    def test_optout_processing_resumes_after_partial_webhook_database_failure(self):
        stop = self.webhook(messages=[{"id": "stop-resume", "from": "14155552671", "type": "text", "timestamp": str(int(now().timestamp())), "text": {"body": "unsubscribe"}}])
        with patch("app.whatsapp_routes.withdraw_from_inbound", side_effect=RuntimeError("storage unavailable")):
            with self.assertRaises(RuntimeError):
                self.signed(stop)
        self.assertEqual(self.signed(stop).status_code, 200)
        self.assertFalse(self.db.users.find_one({"_id": self.user["_id"]})["whatsappNotifications"])

    def test_otp_requires_explicit_operation_request_and_consumed_or_superseded_codes_do_not_send(self):
        from app.whatsapp import notify_auth_otp
        with patch("app.blueprints.auth.routes._database", return_value=self.db), patch("app.blueprints.auth.routes._send_otp_email"):
            self.client.post("/api/auth/forgot-password/request-otp", json={"identifier": self.user["email"]})
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 0)
        challenge, _ = self.otp_challenge()
        with self.app.app_context():
            notify_auth_otp(self.db, "signup_otp", {"phone": self.user["phone"]}, "983271", challenge, "signup")
        self.db.otp_challenges.delete_one({"_id": challenge["_id"]})
        process_outbox(self.db, self.app.config); self.http.assert_not_called()

    def test_auth_code_expiry_attempt_limit_and_one_time_consumption(self):
        from app.blueprints.auth.routes import _consume_otp
        challenge, _ = self.otp_challenge()
        self.db.otp_challenges.update_one({"_id": challenge["_id"]}, {"$set": {"otpExpiresAt": now() - timedelta(seconds=1)}})
        self.assertIsNone(_consume_otp(self.db.otp_challenges, challenge, "983271", now()))
        challenge, _ = self.otp_challenge()
        for _ in range(5):
            self.assertIsNone(_consume_otp(self.db.otp_challenges, challenge, "111111", now()))
        self.assertIsNone(_consume_otp(self.db.otp_challenges, challenge, "983271", now()))
        challenge, _ = self.otp_challenge()
        self.assertIsNotNone(_consume_otp(self.db.otp_challenges, challenge, "983271", now()))
        self.assertIsNone(_consume_otp(self.db.otp_challenges, challenge, "983271", now()))

    def test_otp_request_rate_limit(self):
        app = Flask("otp-rate-fixture")
        app.config.update(self.config, RATELIMIT_ENABLED=True, RATELIMIT_STORAGE_URI="memory://")
        previous = limiter.enabled
        JWTManager(app); limiter.init_app(app); app.register_blueprint(auth_bp, url_prefix="/api/auth")
        try:
            limiter.reset()
            with patch("app.blueprints.auth.routes._database", return_value=self.db), patch("app.blueprints.auth.routes._send_otp_email"):
                results = [app.test_client().post("/api/auth/forgot-password/request-otp", json={"identifier": "absent@example.test"}) for _ in range(6)]
            self.assertEqual(results[-1].status_code, 429)
        finally:
            limiter.enabled = previous

    def test_unconfirmed_orders_pending_payments_and_manual_refunds_never_queue_catalogue_events(self):
        self.configure_catalogue()
        order = self.confirmed_order()
        with self.app.app_context():
            for state in ("order_placed", "awaiting_confirmation", "cancelled"):
                bad = {**order, "fulfillment": {"status": state}}
                self.db.orders.update_one({"_id": order["_id"]}, {"$set": {"fulfillment": bad["fulfillment"]}})
                self.assertEqual(notify(self.db, "order_confirmation", bad)["reason"], "business_event_not_confirmed")
            for state in ("pending", "failed", "order_created"):
                self.db.orders.update_one({"_id": order["_id"]}, {"$set": {"paymentStatus": state}})
                self.assertEqual(notify(self.db, "payment_confirmation", {**order, "paymentStatus": state})["reason"], "business_event_not_confirmed")
            self.db.orders.update_one({"_id": order["_id"]}, {"$set": {"paymentStatus": "paid", "fulfillment": {"status": "shipped"}}})
            self.assertEqual(notify(self.db, "shipped", {**order, "fulfillment": {"status": "shipped"}})["reason"], "shipment_not_recorded")
            self.assertEqual(notify(self.db, "refund_completed", {**order, "paymentStatus": "refunded"})["reason"], "business_event_not_confirmed")
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 0)

    def test_recorded_delivery_event_and_order_confirmation_are_idempotent(self):
        from app.order_fulfillment import send_status_notification
        self.configure_catalogue()
        order = self.confirmed_order()
        with self.app.app_context(), patch("app.order_fulfillment.send_html_email"):
            self.assertEqual(notify(self.db, "order_confirmation", order)["status"], "queued")
            send_status_notification(self.db, order, "confirmed")
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 1)
        order["fulfillment"] = {"status": "delivered", "deliveredAt": now()}
        self.db.orders.update_one({"_id": order["_id"]}, {"$set": {"fulfillment": order["fulfillment"]}})
        with self.app.app_context():
            self.assertEqual(notify(self.db, "delivered", order)["status"], "queued")
            self.assertEqual(notify(self.db, "delivered", order)["status"], "duplicate")

    def test_signed_processed_refund_uses_actual_amount_reference_and_deduplicates(self):
        from app.blueprints.payments.routes import razorpay_webhook_bp
        self.app.register_blueprint(razorpay_webhook_bp, url_prefix="/api/webhooks")
        self.app.config["RAZORPAY_WEBHOOK_SECRET"] = "fixture-refund-secret"
        self.configure_catalogue(); order = self.confirmed_order()
        def post_refund(event_id, state="processed", amount=12345):
            body = {"id": event_id, "event": "refund.processed", "payload": {"refund": {"entity": {"id": "rfnd_fixture", "payment_id": "pay_fixture", "status": state, "amount": amount, "currency": "INR"}}}}
            raw = json.dumps(body).encode()
            sig = hmac.new(b"fixture-refund-secret", raw, hashlib.sha256).hexdigest()
            with patch("app.blueprints.payments.routes.database", return_value=self.db):
                return self.client.post("/api/webhooks/razorpay", data=raw, headers={"X-Razorpay-Signature": sig}, content_type="application/json")
        self.assertFalse(post_refund("bad", "pending").json["handled"])
        self.assertTrue(post_refund("refund-a").json["handled"])
        self.assertTrue(post_refund("refund-b").json["handled"])
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 1)
        self.assertEqual(len(self.db.orders.find_one({"_id": order["_id"]})["refunds"]), 1)
        process_outbox(self.db, self.app.config)
        values = self.http.call_args.kwargs["json"]["template"]["components"][0]["parameters"]
        self.assertEqual([v["text"] for v in values], ["Fixture Customer", "RK-1", "INR 123.45", "rfnd_fixture"])

    def test_checkout_consent_is_order_scoped_and_profile_withdrawal_still_blocks_it(self):
        from app.whatsapp_consent import record_consent
        order = self.confirmed_order()
        consent = record_consent(self.db, self.app.config, self.user["_id"], self.user["phone"], True, "checkout", order_id=order["_id"], update_user=False)
        order["whatsappConsent"] = consent
        self.db.orders.update_one({"_id": order["_id"]}, {"$set": {"whatsappConsent": consent}})
        with self.app.app_context():
            self.assertEqual(notify(self.db, "order_confirmation", order)["status"], "queued")
        record_consent(self.db, self.app.config, self.user["_id"], self.user["phone"], False, "authenticated_profile")
        process_outbox(self.db, self.app.config); self.http.assert_not_called()
        audit = self.db.whatsapp_consents.find_one({"source": "checkout"})
        for key in ("customerId", "phone", "category", "enabled", "timestamp", "source", "orderId"):
            self.assertIn(key, audit)

    def test_order_recipient_prefers_saved_shipping_and_explicit_order_consent(self):
        from app.whatsapp_consent import record_consent
        order = self.confirmed_order()
        phone = "+442079460018"
        consent = record_consent(self.db, self.app.config, self.user["_id"], phone, True, "checkout", order_id=order["_id"], update_user=False)
        self.db.orders.update_one({"_id": order["_id"]}, {"$set": {"shipping.phone": phone, "phone": self.user["phone"], "whatsappConsent": consent}})
        # Caller-supplied contact and customer fields are not authoritative.
        with self.app.app_context():
            result = notify(self.db, "order_confirmation", {**order, "customerId": ObjectId(), "shipping": {"phone": "+123"}})
        self.assertEqual(result["status"], "queued")
        process_outbox(self.db, self.app.config)
        self.assertEqual(self.http.call_args.kwargs["json"]["to"], "442079460018")
        self.assertEqual(self.db.whatsapp_order_events.find_one()["contactSource"], "shipping.phone")

    def test_order_missing_invalid_and_unconsented_phone_are_safely_audited(self):
        for phone, expected in ((None, "missing_phone"), ("9876543210", "invalid_recipient"), ("+442079460018", "missing_or_withdrawn_consent")):
            order = self.confirmed_order()
            self.db.orders.update_one({"_id": order["_id"]}, {"$set": {"shipping": {"phone": phone}}})
            with self.app.app_context():
                result = notify(self.db, "order_confirmation", order)
            self.assertEqual(result["reason"], expected)
            audit = self.db.whatsapp_order_events.find_one({"orderId": str(order["_id"])})
            self.assertEqual(audit["status"], "not_eligible")
            self.assertEqual(audit["reason"], expected)
        self.http.assert_not_called()
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 0)

    def test_profile_fallback_needs_verified_contact_and_never_uses_an_admin(self):
        from app.whatsapp_orders import order_contact
        order = self.confirmed_order()
        order.pop("shipping")
        self.assertEqual(order_contact(self.db, self.app.config, order, self.user)["reason"], "missing_phone")
        self.incoming()
        self.assertEqual(order_contact(self.db, self.app.config, order, self.user)["source"], "verified_profile_contact")
        unknown = {**order, "customerId": ObjectId()}
        self.db.orders.insert_one({**unknown, "_id": ObjectId()})
        self.assertEqual(order_contact(self.db, self.app.config, unknown, None)["reason"], "missing_phone")

    def register_staff_order_routes(self):
        from app.blueprints.orders.routes import staff_orders_bp
        self.app.register_blueprint(staff_orders_bp, url_prefix="/api/staff/orders")
        db_patch = patch("app.blueprints.orders.routes.database", return_value=self.db)
        db_patch.start(); self.addCleanup(db_patch.stop)
        user_patch = patch("app.blueprints.orders.routes.current_user", return_value=self.admin)
        user_patch.start(); self.addCleanup(user_patch.stop)
        prepare = patch("app.blueprints.orders.routes._prepare")
        prepare.start(); self.addCleanup(prepare.stop)
        email = patch("app.order_fulfillment.send_html_email", return_value={"id": "fixture-email"})
        email.start(); self.addCleanup(email.stop)

    def test_staff_shipped_without_awb_then_tracking_added_queues_once_per_shipment(self):
        self.register_staff_order_routes()
        order = self.confirmed_order()
        self.db.orders.update_one({"_id": order["_id"]}, {"$set": {"fulfillment.status": "packed"}})
        path = f"/api/staff/orders/{order['_id']}"
        result = self.client.patch(path + "/fulfillment", headers=self.headers, json={"status": "shipped", "courier": "Fixture Courier"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 0)
        self.assertEqual(result.json["order"]["whatsapp"]["activity"][0]["reason"], "shipment_not_recorded")
        details = {"courier": "Fixture Courier", "trackingNumber": "AWB-001", "trackingUrl": "https://courier.example/track/AWB-001", "shippedAt": "2026-01-01T10:00:00Z"}
        for _ in range(2):
            result = self.client.patch(path + "/shipment", headers=self.headers, json=details)
            self.assertEqual(result.status_code, 200)
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 1)
        self.assertEqual(result.json["order"]["fulfillment"]["shippedAt"], details["shippedAt"])
        self.assertEqual(result.json["order"]["whatsapp"]["number"], "***" + self.user["phone"][-4:])
        # URL-only changes do not resend; a legitimate replacement AWB or courier does.
        self.client.patch(path + "/shipment", headers=self.headers, json={**details, "trackingUrl": "https://courier.example/updated"})
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 1)
        self.client.patch(path + "/shipment", headers=self.headers, json={**details, "trackingNumber": "AWB-002"})
        self.client.patch(path + "/shipment", headers=self.headers, json={**details, "trackingNumber": "AWB-002", "courier": "Replacement Courier"})
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 3)
        process_outbox(self.db, self.app.config)
        self.assertEqual(self.http.call_count, 1)  # Older queued shipment identities are skipped.
        payload = self.http.call_args.kwargs["json"]["template"]
        self.assertEqual(payload["name"], "rk_order_shipped")
        self.assertEqual([item["text"] for item in payload["components"][0]["parameters"]], ["Fixture Customer", "RK-1", "Replacement Courier", "AWB-002"])

    def test_staff_lifecycle_routes_persist_before_queue_and_unchanged_save_does_not_duplicate(self):
        self.register_staff_order_routes()
        order = self.confirmed_order()
        self.db.orders.update_one({"_id": order["_id"]}, {"$set": {"fulfillment.status": "awaiting_confirmation"}})
        path = f"/api/staff/orders/{order['_id']}/fulfillment"
        for state in ("confirmed", "processing", "packed", "shipped", "out_for_delivery", "delivered"):
            body = {"status": state, "courier": "Fixture Courier", "trackingNumber": "AWB-123"}
            response = self.client.patch(path, headers=self.headers, json=body)
            self.assertEqual(response.status_code, 200, response.json)
            self.assertEqual(self.db.orders.find_one({"_id": order["_id"]})["fulfillment"]["status"], state)
            before = self.db.whatsapp_outbox.count_documents({})
            self.assertEqual(self.client.patch(path, headers=self.headers, json=body).status_code, 400)
            self.assertEqual(self.db.whatsapp_outbox.count_documents({}), before)
        events = {item["event"] for item in self.db.whatsapp_order_events.find()}
        self.assertTrue({"order_accepted", "processing", "packed", "shipped", "out_for_delivery", "delivered"}.issubset(events))
        self.http.assert_not_called()

    def test_staff_cancellation_and_notification_failure_do_not_rollback_order(self):
        self.register_staff_order_routes()
        order = self.confirmed_order()
        with patch("app.whatsapp._enqueue_notification", side_effect=RuntimeError("fixture unavailable")):
            response = self.client.patch(f"/api/staff/orders/{order['_id']}/fulfillment", headers=self.headers, json={"status": "cancelled"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.db.orders.find_one({"_id": order["_id"]})["fulfillment"]["status"], "cancelled")
        audit = self.db.whatsapp_order_events.find_one({"event": "cancelled"})
        self.assertEqual(audit["reason"], "notification_unavailable")

    def test_required_utility_template_needs_actual_mocked_meta_evidence(self):
        order = self.confirmed_order()
        self.db.whatsapp_template_status.delete_many({})
        self.app.config["WHATSAPP_TEMPLATES"]["order_confirmation"].update(approved=True, approvalStatus="APPROVED")
        with self.app.app_context():
            result = notify(self.db, "order_confirmation", order)
        self.assertEqual(result["reason"], "template_not_approved_or_enabled")
        self.assertEqual(self.db.whatsapp_order_events.find_one()["status"], "waiting_for_approved_template")
        self.http.assert_not_called()

    def test_automation_environment_and_admin_switch_both_guard_actual_staff_updates(self):
        self.register_staff_order_routes()
        for environment_gate, admin_gate in ((False, True), (True, False)):
            order = self.confirmed_order()
            self.app.config["WHATSAPP_ENABLED"] = environment_gate
            self.db.integrations.update_one({"_id": "whatsapp"}, {"$set": {"enabled": admin_gate}})
            response = self.client.patch(f"/api/staff/orders/{order['_id']}/fulfillment", headers=self.headers, json={"status": "cancelled"})
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json["order"]["whatsapp"]["automationEnabled"])
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 0)
        self.http.assert_not_called()

    def test_order_activity_joins_real_delivery_read_and_safe_failure_information(self):
        from app.whatsapp_orders import order_whatsapp_activity
        order = self.confirmed_order()
        with self.app.app_context():
            notify(self.db, "order_confirmation", order)
        process_outbox(self.db, self.app.config)
        self.signed(self.webhook(statuses=[self.provider_status("delivered"), self.provider_status("read", timestamp="1700000010")]))
        activity = order_whatsapp_activity(self.db, self.app.config, order)
        self.assertEqual(activity["activity"][0]["status"], "read")
        self.assertIsNotNone(activity["activity"][0]["readAt"])
        self.assertNotIn("private-app-secret", str(activity))
        self.assertNotIn("payload", str(activity))

    def test_order_rate_limit_retries_survive_worker_restart_with_backoff(self):
        order = self.confirmed_order()
        with self.app.app_context():
            notify(self.db, "order_confirmation", order)
        self.http.return_value = self.response(429, {"error": {"code": 130429}}, {"Retry-After": "120"})
        self.assertEqual(process_outbox(self.db, self.app.config), 1)
        pending = self.db.whatsapp_outbox.find_one()
        self.assertEqual(pending["status"], "pending")
        self.assertEqual(pending["retryCount"], 1)
        self.assertIn("payload", pending)
        self.assertEqual(process_outbox(self.db, self.app.config), 0)
        self.http.return_value = self.response(200, {"messages": [{"id": "wamid.RETRIED"}]})
        self.assertGreaterEqual((pending["nextAttemptAt"] - pending["claimedAt"]).total_seconds(), 120)
        with patch("app.whatsapp.now", return_value=now() + timedelta(seconds=121)):
            self.assertEqual(process_outbox(self.db, self.app.config), 1)
        self.assertEqual(self.db.whatsapp_messages.count_documents({}), 1)
        self.assertEqual(self.db.whatsapp_messages.find_one()["status"], "accepted")
        self.assertNotIn("payload", self.db.whatsapp_outbox.find_one())
        self.assertEqual(self.http.call_count, 2)
        self.assertEqual(process_outbox(self.db, self.app.config), 0)

    def test_unknown_provider_outcome_is_not_scheduled_for_automatic_retry(self):
        from app.whatsapp_orders import order_whatsapp_activity
        order = self.confirmed_order()
        with self.app.app_context():
            notify(self.db, "order_confirmation", order)
        self.http.side_effect = requests.Timeout("fixture")
        process_outbox(self.db, self.app.config)
        self.assertEqual(self.db.whatsapp_outbox.find_one()["status"], "unknown")
        self.assertNotIn("payload", self.db.whatsapp_outbox.find_one())
        self.assertEqual(process_outbox(self.db, self.app.config), 0)
        self.assertEqual(self.http.call_count, 1)
        self.db.whatsapp_messages.delete_many({})  # Model a crash before a definitive provider outcome was logged.
        self.db.whatsapp_outbox.update_one({}, {"$set": {"status": "held", "reason": "operator_reconciliation_required"}})
        activity = order_whatsapp_activity(self.db, self.app.config, order)["activity"][0]
        self.assertEqual(activity["status"], "unknown")
        self.assertEqual(activity["reason"], "operator_reconciliation_required")

    def test_durable_rate_limit_retry_budget_is_bounded(self):
        with self.app.app_context():
            notify(self.db, "order_confirmation", self.confirmed_order())
        self.http.return_value = self.response(429, {"error": {"code": 130429}}, {"Retry-After": "120"})
        start = now()
        for seconds in (0, 121, 242):
            with patch("app.whatsapp.now", return_value=start + timedelta(seconds=seconds)):
                self.assertEqual(process_outbox(self.db, self.app.config), 1)
        final = self.db.whatsapp_outbox.find_one()
        self.assertEqual(final["status"], "failed")
        self.assertNotIn("payload", final)
        self.assertEqual(self.http.call_count, 3)
        self.assertEqual(self.db.whatsapp_messages.count_documents({}), 1)

    def test_staff_notification_suppression_is_audited_and_order_activity_is_protected(self):
        self.register_staff_order_routes()
        order = self.confirmed_order()
        path = f"/api/staff/orders/{order['_id']}"
        response = self.client.patch(path + "/fulfillment", headers=self.headers, json={"status": "cancelled", "sendCustomerNotification": False})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["order"]["whatsapp"]["activity"][0]["reason"], "staff_notifications_disabled")
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 0)
        self.assertEqual(self.client.get(path).status_code, 401)
        with patch("app.rbac.current_user", return_value=self.user):
            self.assertEqual(self.client.get(path, headers=self.headers).status_code, 403)

    def configure_extended(self, event, name, status="APPROVED", components=None):
        from app.whatsapp_definitions import definitions, definition_components
        from app.whatsapp_routes import refresh_template_observations
        spec = definitions(self.app.config)[name]
        self.app.config["WHATSAPP_TEMPLATES"][event] = {"catalogue": name, "name": name, "language": "en_US", "category": spec["category"],
            "parameters": spec["parameters"], "parameterTypes": spec["parameterTypes"], "enabled": True}
        row = {"name": name, "language": "en_US", "category": spec["category"], "status": status,
               "components": definition_components(spec) if components is None else components}
        with patch("app.whatsapp_routes.requests.get", return_value=self.response(200, {"data": [row]})):
            refresh_template_observations(self.db, self.app.config)
        return spec

    def marketing_fixture(self):
        from app.whatsapp_marketing_consent import record_marketing_consent
        self.db.users.update_one({"_id": self.user["_id"]}, {"$set": {"firstName": "Fixture", "dob": "1990-01-01", "gender": "female", "username": "fixture"}})
        record_marketing_consent(self.db, self.app.config, self.user["_id"], self.user["phone"], True, "authenticated_profile", timestamp=now() - timedelta(minutes=1))
        collection = {"_id": ObjectId(), "name": "Actual Database Collection", "slug": "database-collection", "status": "active", "isActive": True}
        self.db.collections.insert_one(collection)
        return {"event": "new_collection_drop", "collectionId": str(collection["_id"]), "audience": "all_marketing_consent", "description": "Reviewed campaign notes", "expiresAt": (now() + timedelta(days=2)).isoformat()}

    def test_login_otp_channel_uses_one_existing_challenge_code_and_copy_button(self):
        self.configure_extended("login_otp", "rk_authentication_otp")
        self.db.users.update_one({"_id": self.user["_id"]}, {"$set": {"emailVerified": False}})
        payload = {"email": self.user["email"], "otpChannel": "both", "whatsappOtpConsent": True}
        with patch("app.blueprints.auth.routes._database", return_value=self.db), patch("app.blueprints.auth.routes._send_otp_email") as email, patch("app.blueprints.auth.routes.secrets.randbelow", return_value=123456):
            requested = self.client.post("/api/auth/request-otp", json=payload)
            self.assertEqual(requested.status_code, 202)
            self.assertEqual(email.call_args.args[1], "123456")
            self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 1)
            self.assertNotIn("123456", str(self.db.whatsapp_outbox.find_one()))
            process_outbox(self.db, self.app.config)
            template = self.http.call_args.kwargs["json"]["template"]
            self.assertEqual(template["name"], "rk_authentication_otp")
            self.assertEqual(template["language"], {"code": "en_US"})
            self.assertEqual(template["components"][0]["parameters"], [{"type": "text", "text": "123456"}])
            self.assertEqual(template["components"][1], {"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": "123456"}]})
            self.assertNotIn("123456", str(self.db.whatsapp_messages.find_one()))
            self.assertEqual(self.client.post("/api/auth/verify-otp", json={"email": self.user["email"], "otp": "123456"}).status_code, 200)
            self.assertFalse(self.db.users.find_one({"_id": self.user["_id"]})["emailVerified"])
            self.assertEqual(self.client.post("/api/auth/verify-otp", json={"email": self.user["email"], "otp": "123456"}).status_code, 400)

    def test_whatsapp_signup_code_does_not_verify_email_or_grant_domain_staff_role(self):
        from bcrypt import hashpw, gensalt
        challenge = {"email": "unverified@rashikapoorofficial.com", "purpose": "signup", "username": "unverified.fixture", "displayName": "Fixture Customer", "phone": self.user["phone"],
            "otpChannel": "whatsapp", "passwordHash": hashpw(b"fixture-password", gensalt()).decode(), "otpHash": hashpw(b"123456", gensalt()).decode(), "otpExpiresAt": now() + timedelta(minutes=10), "otpAttempts": 0}
        self.db.otp_challenges.insert_one(challenge)
        with patch("app.blueprints.auth.routes._database", return_value=self.db):
            response = self.client.post("/api/auth/signup/verify-otp", json={"email": challenge["email"], "otp": "123456"})
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json["user"]["emailVerified"])
        self.assertEqual(response.json["user"]["role"], "customer")

    def test_whatsapp_only_otp_never_silently_sends_email_when_disabled(self):
        self.app.config["WHATSAPP_ENABLED"] = False
        with patch("app.blueprints.auth.routes._database", return_value=self.db), patch("app.blueprints.auth.routes._send_otp_email") as email:
            response = self.client.post("/api/auth/request-otp", json={"email": self.user["email"], "otpChannel": "whatsapp", "whatsappOtpConsent": True})
            self.assertEqual(response.status_code, 400)
            email.assert_not_called()
            self.assertNotIn("otpHash", self.db.users.find_one({"_id": self.user["_id"]}))
            self.assertEqual(self.client.post("/api/auth/request-otp", json={"email": self.user["email"], "otpChannel": "email"}).status_code, 202)
            self.assertEqual(email.call_count, 1)
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 0)

    def test_authentication_component_contract_and_real_approval_are_required(self):
        from app.whatsapp_definitions import definitions
        from app.whatsapp_templates import template_registry
        spec = self.configure_extended("login_otp", "rk_authentication_otp", components=[{"type": "BODY", "text": "Ordinary OTP {{1}}"}])
        self.assertEqual(spec["category"], "AUTHENTICATION")
        self.assertEqual(spec["submissionComponents"][0], {"type": "BODY", "add_security_recommendation": True})
        self.assertEqual(spec["submissionComponents"][1]["code_expiration_minutes"], 10)
        self.assertEqual(spec["submissionComponents"][2]["buttons"][0]["otp_type"], "COPY_CODE")
        self.assertFalse(template_registry(self.db, self.app.config)["login_otp"]["approved"])
        self.assertEqual(definitions(self.app.config)["rk_authentication_otp"]["parameters"], ["code"])

    def test_marketing_definitions_preserve_exact_supplied_copy_and_ordered_variables(self):
        from app.whatsapp_definitions import definitions, definition_components
        catalogue = definitions(self.app.config)
        expected = {
            "rk_new_collection_drop": ("A New Collection Has Arrived", "Hello {{1}},\nA new expression of Rashi Kapoor has arrived.\nDiscover {{2}}, our latest collection, thoughtfully curated and now available to explore.\nExplore the collection and discover pieces that speak to your style.", ["first_name", "collection_name"], "Explore Collection"),
            "rk_exclusive_offer": ("A Special Offer for You", "Hello {{1}},\nA little something from Rashi Kapoor.\nEnjoy {{2}} on your next purchase with code {{3}}.\nOffer valid until {{4}}, subject to the applicable terms.\nExplore our collections and discover something you'll love.", ["first_name", "offer_description", "coupon_code", "expiry_date"], "Shop Now"),
        }
        for name, (header, body, parameters, label) in expected.items():
            spec = catalogue[name]
            self.assertEqual(spec["category"], "MARKETING")
            self.assertEqual(spec["language"], "en_US")
            self.assertEqual(spec["parameters"], parameters)
            self.assertEqual(definition_components(spec), [
                {"type": "HEADER", "format": "TEXT", "text": header}, {"type": "BODY", "text": body},
                {"type": "FOOTER", "text": "Rashi Kapoor"},
                {"type": "BUTTONS", "buttons": [{"type": "URL", "text": label, "url": "https://rashikapoor.co.in/{{1}}"}]},
            ])

    def test_marketing_consent_is_separate_and_checkout_decline_does_not_withdraw_it(self):
        from app.whatsapp_marketing_consent import record_marketing_consent, marketing_phone
        self.assertIsNone(marketing_phone(self.db, self.app.config, self.user))  # Transactional preference is insufficient.
        grant = record_marketing_consent(self.db, self.app.config, self.user["_id"], self.user["phone"], True, "authenticated_profile")
        for field in ("customerId", "phone", "category", "enabled", "timestamp", "source", "policyVersion", "withdrawnAt"):
            self.assertIn(field, grant)
        record_marketing_consent(self.db, self.app.config, self.user["_id"], self.user["phone"], False, "checkout", update_user=False)
        user = self.db.users.find_one({"_id": self.user["_id"]})
        self.assertEqual(marketing_phone(self.db, self.app.config, user), self.user["phone"])
        transactional = dict(user["whatsappConsent"])
        record_marketing_consent(self.db, self.app.config, self.user["_id"], self.user["phone"], False, "authenticated_profile")
        user = self.db.users.find_one({"_id": self.user["_id"]})
        self.assertIsNone(marketing_phone(self.db, self.app.config, user))
        self.assertEqual(user["whatsappConsent"], transactional)
        self.assertIsNotNone(user["whatsappMarketingConsent"]["withdrawnAt"])

    def test_marketing_unsubscribe_and_global_stop_preserve_category_boundaries(self):
        from app.whatsapp_marketing_consent import record_marketing_consent, marketing_phone
        from app.whatsapp_consent import opted_out
        self.marketing_fixture()
        payload = self.webhook(messages=[{"id": "wamid.MARKETING_STOP", "from": "14155552671", "timestamp": str(int(now().timestamp())), "type": "text", "text": {"body": "STOP MARKETING"}}])
        self.signed(payload)
        user = self.db.users.find_one({"_id": self.user["_id"]})
        self.assertIsNone(marketing_phone(self.db, self.app.config, user))
        self.assertTrue(user["whatsappNotifications"])
        self.assertFalse(opted_out(self.db, self.app.config, self.user["phone"]))
        record_marketing_consent(self.db, self.app.config, self.user["_id"], self.user["phone"], True, "authenticated_profile")
        self.signed(payload)  # A processed duplicate must not revoke fresh consent.
        self.assertIsNotNone(marketing_phone(self.db, self.app.config, self.db.users.find_one({"_id": self.user["_id"]})))
        from app.whatsapp_consent import withdraw_from_inbound
        withdraw_from_inbound(self.db, self.app.config, self.user["phone"], now() + timedelta(seconds=1))
        self.assertTrue(opted_out(self.db, self.app.config, self.user["phone"]))
        self.assertIsNone(marketing_phone(self.db, self.app.config, self.db.users.find_one({"_id": self.user["_id"]})))

    def test_campaign_audience_uses_marketing_consent_and_actual_collection_identity(self):
        from app.whatsapp_campaigns import campaign_data, eligible_audience, collection_path
        payload = self.marketing_fixture()
        other = {"_id": ObjectId(), "role": "customer", "firstName": "Unconsented", "phone": "+442079460018", "isActive": True, "whatsappNotifications": True}
        self.db.users.insert_one(other)
        data = campaign_data(self.db, self.app.config, payload)
        recipients, excluded = eligible_audience(self.db, self.app.config, data)
        self.assertEqual([item["userId"] for item in recipients], [str(self.user["_id"])])
        self.assertEqual(excluded["no_active_marketing_consent"], 1)
        self.db.orders.insert_one({"customerId": self.user["_id"], "items": [{"collectionSlug": "database-collection"}]})
        data["audience"] = "collection_customers"
        self.assertEqual(len(eligible_audience(self.db, self.app.config, data)[0]), 1)
        self.assertEqual(collection_path({"slug": "aakaar"}), "/aakaar/collection")
        self.assertEqual(collection_path({"slug": "lfw-fixture", "collectionType": "runway"}), "/collections/lakme")
        self.assertEqual(data["destinationUrl"], "https://rashikapoor.co.in/collections/database-collection")
        with self.assertRaises(ValueError):
            collection_path({"slug": "../private"})

    def test_campaign_preview_gate_authorization_and_existing_outbox_button_payload(self):
        from app.whatsapp_campaigns import preview_campaign, authorize_campaign
        self.configure_extended("new_collection_drop", "rk_new_collection_drop")
        payload = self.marketing_fixture()
        with patch("app.whatsapp_campaigns.destination_reachable", return_value=True):
            preview, _ = preview_campaign(self.db, self.app.config, payload)
            self.assertFalse(preview["canAuthorize"])
            self.app.config["WHATSAPP_MARKETING_ENABLED"] = True
            preview, _ = preview_campaign(self.db, self.app.config, payload)
            self.assertTrue(preview["canAuthorize"])
            self.assertIn("Actual Database Collection", preview["samples"][0]["body"])
            authorized = {**payload, "previewDigest": preview["previewDigest"], "requestId": "campaign-request-123456", "confirmed": True}
            with self.assertRaises(ValueError):
                authorize_campaign(self.db, self.app.config, {**authorized, "confirmed": False}, self.admin["_id"])
            result = authorize_campaign(self.db, self.app.config, authorized, self.admin["_id"])
            self.assertEqual(authorize_campaign(self.db, self.app.config, authorized, self.admin["_id"])["campaignId"], result["campaignId"])
        with self.app.app_context():
            process_outbox(self.db, self.app.config)
            process_outbox(self.db, self.app.config)
        self.assertEqual(self.http.call_count, 1)
        self.assertEqual(self.db.whatsapp_campaigns.count_documents({}), 1)
        template = self.http.call_args.kwargs["json"]["template"]
        self.assertEqual(template["name"], "rk_new_collection_drop")
        self.assertEqual([item["text"] for item in template["components"][0]["parameters"]], ["Fixture", "Actual Database Collection"])
        self.assertEqual(template["components"][1]["parameters"], [{"type": "text", "text": "collections/database-collection"}])
        self.assertNotIn(self.user["phone"], str(list(self.db.whatsapp_campaigns.find())))

    def test_offer_uses_verified_coupon_adapter_and_actual_expiry_or_fails_closed(self):
        from app.whatsapp_campaigns import campaign_data, body_parameters
        payload = self.marketing_fixture()
        payload.update(event="exclusive_offer", collectionId=None, couponId="actual-coupon")
        with self.assertRaisesRegex(ValueError, "coupon_integration_unavailable"):
            campaign_data(self.db, self.app.config, payload)
        coupon = {"id": "actual-coupon", "code": "ACTUAL20", "description": "20% off eligible items", "expiresAt": now() + timedelta(days=3)}
        with patch("app.whatsapp_campaigns.load_valid_coupon", return_value=coupon):
            data = campaign_data(self.db, self.app.config, payload)
            self.assertEqual(data["destinationUrl"], "https://rashikapoor.co.in/collections")
            self.assertEqual(list(body_parameters(data, {"firstName": "Fixture"})), ["first_name", "offer_description", "coupon_code", "expiry_date"])
            self.assertEqual(data["coupon_code"], "ACTUAL20")
            with self.assertRaisesRegex(ValueError, "coupon_expiry_or_details_invalid"):
                campaign_data(self.db, self.app.config, {**payload, "expiresAt": (now() + timedelta(days=4)).isoformat()})

    def test_transactional_button_versions_are_separate_and_resolve_persisted_order(self):
        from app.whatsapp_definitions import definitions, definition_components
        originals = definitions(self.app.config)
        spec = self.configure_extended("order_confirmation", "rk_order_confirmation_v2")
        self.assertEqual(originals["rk_order_confirmation"].get("buttons", []), [])
        self.assertEqual(spec["versionOf"], "rk_order_confirmation")
        order = self.confirmed_order()
        with self.app.app_context():
            self.assertEqual(notify(self.db, "order_confirmation", order)["status"], "queued")
        process_outbox(self.db, self.app.config)
        template = self.http.call_args.kwargs["json"]["template"]
        self.assertEqual(template["name"], "rk_order_confirmation_v2")
        self.assertEqual(template["components"][1], {"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": str(order["_id"])}]})
        self.assertEqual(spec["buttons"][0]["url"], "https://rashikapoor.co.in/account/orders/{{1}}")
        missing_button = [item for item in definition_components(spec) if item["type"] != "BUTTONS"]
        self.configure_extended("order_confirmation", "rk_order_confirmation_v2", components=missing_button)
        another = self.confirmed_order()
        with self.app.app_context():
            self.assertEqual(notify(self.db, "order_confirmation", another)["reason"], "template_not_approved_or_enabled")

    def test_campaign_admin_endpoints_and_customer_order_links_remain_protected(self):
        self.register_staff_order_routes()
        from app.blueprints.orders.routes import customer_orders_bp
        self.app.register_blueprint(customer_orders_bp, url_prefix="/api/orders")
        for path, method in (("/campaigns/options", "get"), ("/campaigns/preview", "post"), ("/campaigns/drafts", "post"), ("/campaigns/authorize", "post"), ("/campaigns", "get")):
            with patch("app.rbac.current_user", return_value=self.user):
                response = getattr(self.client, method)("/api/admin/integrations/whatsapp" + path, headers=self.headers, json={})
                self.assertEqual(response.status_code, 403)
        order = self.confirmed_order()
        with patch("app.rbac.current_user", return_value=self.user), patch("app.blueprints.orders.routes.authenticated_user_id", return_value=ObjectId()):
            response = self.client.get(f"/api/orders/{order['_id']}", headers=self.headers)
            self.assertEqual(response.status_code, 404)

    def test_profile_marketing_withdrawal_preserves_transactional_consent_and_original_phone_binding(self):
        from app.whatsapp_marketing_consent import record_marketing_consent
        self.marketing_fixture()
        record_marketing_consent(self.db, self.app.config, self.user["_id"], "+442079460018", True, "checkout")
        before = self.db.users.find_one({"_id": self.user["_id"]})["whatsappConsent"]
        with patch("app.blueprints.auth.routes._database", return_value=self.db):
            response = self.client.put("/api/auth/profile", headers=self.headers, json={"language": "English", "whatsappMarketingNotifications": True})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json["user"]["whatsappMarketingPhone"], "+442079460018")
            response = self.client.put("/api/auth/profile", headers=self.headers, json={"whatsappMarketingNotifications": False})
            self.assertEqual(response.status_code, 200)
        saved = self.db.users.find_one({"_id": self.user["_id"]})
        self.assertEqual(saved["whatsappConsent"], before)
        self.assertTrue(saved["whatsappNotifications"])
        self.assertFalse(saved["whatsappMarketingNotifications"])
        self.assertEqual(saved["whatsappMarketingConsent"]["phone"], "+442079460018")
        self.assertIsNotNone(saved["whatsappMarketingConsent"]["withdrawnAt"])

    def test_checkout_marketing_choice_is_separate_from_transactional_order_consent(self):
        from app.blueprints.payments.routes import payments_bp
        self.app.config.update(RAZORPAY_KEY_ID="rzp_test_fixture", RAZORPAY_KEY_SECRET="fixture-secret", RAZORPAY_MODE="test")
        self.app.register_blueprint(payments_bp, url_prefix="/api/payments")
        shipping = {"fullName": "Fixture Customer", "phone": "+442079460018", "line1": "Fixture Street", "city": "London", "state": "London", "postalCode": "SW1A1AA", "country": "United Kingdom"}
        payload = {"checkoutAttemptId": "marketing-checkout-1", "shipping": shipping, "cart": [], "whatsappTransactionalConsent": False, "whatsappMarketingConsent": True}
        with patch("app.blueprints.payments.routes.database", return_value=self.db), patch("app.blueprints.payments.routes.current_user", return_value=self.user), patch("app.blueprints.payments.routes.ensure_catalog_seed"), patch("app.blueprints.payments.routes._checkout_items", return_value=([], 100)), patch("app.blueprints.payments.routes.razorpay_api_request", return_value={"id": "order_fixture_marketing"}):
            response = self.client.post("/api/payments/razorpay/order", headers=self.headers, json=payload)
        self.assertEqual(response.status_code, 201, response.json)
        order = self.db.orders.find_one({"checkoutAttemptId": payload["checkoutAttemptId"]})
        self.assertFalse(order["whatsappConsent"]["enabled"])
        self.assertTrue(order["whatsappMarketingConsent"]["enabled"])
        self.assertEqual(order["whatsappMarketingConsent"]["phone"], shipping["phone"])
        self.assertTrue(self.db.users.find_one({"_id": self.user["_id"]})["whatsappMarketingNotifications"])
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 0)

    def test_campaign_withdrawal_and_preview_changes_block_future_dispatch(self):
        from app.whatsapp_campaigns import preview_campaign, authorize_campaign
        from app.whatsapp_marketing_consent import record_marketing_consent
        self.configure_extended("new_collection_drop", "rk_new_collection_drop")
        payload = self.marketing_fixture(); self.app.config["WHATSAPP_MARKETING_ENABLED"] = True
        with patch("app.whatsapp_campaigns.destination_reachable", return_value=True):
            preview, _ = preview_campaign(self.db, self.app.config, payload)
            authorized = {**payload, "confirmed": True, "previewDigest": preview["previewDigest"], "requestId": "campaign-withdraw-123456"}
            with self.assertRaisesRegex(ValueError, "confirm_current_campaign_preview"):
                authorize_campaign(self.db, self.app.config, {**authorized, "description": "Changed after preview"}, self.admin["_id"])
            with self.assertRaisesRegex(ValueError, "confirm_current_campaign_preview"):
                authorize_campaign(self.db, self.app.config, {**authorized, "scheduledAt": (now() + timedelta(hours=1)).isoformat()}, self.admin["_id"])
            authorize_campaign(self.db, self.app.config, authorized, self.admin["_id"])
        record_marketing_consent(self.db, self.app.config, self.user["_id"], self.user["phone"], False, "authenticated_profile")
        with self.app.app_context():
            process_outbox(self.db, self.app.config)
        self.http.assert_not_called()
        self.assertEqual(self.db.whatsapp_outbox.count_documents({}), 0)

    def test_marketing_and_production_gates_cannot_be_bypassed_by_local_test_flag(self):
        from app.config import ProductionConfig
        from app.whatsapp_campaigns import marketing_enabled
        self.assertFalse(ProductionConfig.WHATSAPP_ENABLED)
        self.assertFalse(ProductionConfig.WHATSAPP_TEST_SEND_ENABLED)
        self.assertFalse(ProductionConfig.WHATSAPP_MARKETING_ENABLED)
        self.configure_extended("new_collection_drop", "rk_new_collection_drop")
        self.assertFalse(marketing_enabled(self.db, self.app.config))
        result = send(self.db, self.app.config, self.user["phone"], "new_collection_drop", {"first_name": "Fixture", "collection_name": "Fixture"}, "forbidden-marketing-test", test_send=True, consent=True)
        self.assertEqual(result["reason"], "invalid_test_type")
        self.http.assert_not_called()

    def local_registered_template(self):
        from copy import deepcopy
        from app.whatsapp_templates import LOCAL_TEST_TEMPLATE
        entry = {**deepcopy(LOCAL_TEST_TEMPLATE), "enabled": True, "parameters": [], "parameterTypes": []}
        self.app.config["WHATSAPP_TEMPLATES"] = {"test": entry}
        self.app.config["WHATSAPP_ENABLED"] = False
        return entry

    def test_registered_static_template_contract_and_operator_approval_cannot_bypass_meta(self):
        from copy import deepcopy
        from app.whatsapp_templates import registry, template_registry
        entry = self.local_registered_template()
        self.assertEqual(entry["name"], "3p_direct_integration_test_template")
        self.assertEqual(entry["language"], "en_US")
        self.assertEqual(entry["category"], "UTILITY")
        self.assertEqual(entry["components"], [
            {"type": "HEADER", "format": "TEXT", "text": "Integration Test"},
            {"type": "BODY", "text": "Welcome! This is a test message from the WhatsApp Business Platform. You have successfully configured your WhatsApp Business account and completed onboarding. You can now start sending messages to your customers."},
            {"type": "FOOTER", "text": "WhatsApp Business Platform"},
        ])
        entry.update(approved=True, approvalStatus="APPROVED")
        self.db.whatsapp_template_status.delete_one({"_id": "3p_direct_integration_test_template:en_US"})
        self.assertFalse(template_registry(self.db, self.app.config)["test"]["approved"])
        for mutation in ({"language": "en_GB"}, {"parameters": ["invented"]},
                         {"components": entry["components"] + [{"type": "BUTTONS", "buttons": []}]}):
            changed = deepcopy(entry); changed.update(mutation)
            self.assertFalse(registry({**self.app.config, "WHATSAPP_TEMPLATES": {"test": changed}})["test"]["configured"])
        self.assertFalse(registry({**self.app.config, "WHATSAPP_ENVIRONMENT": "production"})["test"]["approved"])

    def test_development_default_restores_exact_integration_template_without_enabling_mapping(self):
        from app.whatsapp_templates import LOCAL_TEST_TEMPLATE, registry
        template = registry({"WHATSAPP_ENVIRONMENT": "development", "WHATSAPP_TEMPLATES": {}})["test"]
        self.assertEqual(template["name"], "3p_direct_integration_test_template")
        self.assertEqual(template["language"], "en_US")
        self.assertEqual(template["category"], "UTILITY")
        self.assertEqual(template["components"], LOCAL_TEST_TEMPLATE["components"])
        self.assertFalse(template["enabled"])
        self.assertFalse(template["approved"])
        self.assertFalse(registry({"WHATSAPP_ENVIRONMENT": "production", "WHATSAPP_TEMPLATES": {}})["test"]["name"] == LOCAL_TEST_TEMPLATE["name"])

    def test_registered_static_template_meta_refresh_allows_consented_test_outside_window(self):
        entry = self.local_registered_template()
        with patch("app.whatsapp_routes.requests.get", return_value=self.response(200, {"data": [{**entry, "status": "APPROVED"}]})) as get:
            refreshed = self.client.post("/api/admin/integrations/whatsapp/template-status", headers=self.headers)
        self.assertTrue(refreshed.json["templates"]["test"]["approved"])
        self.assertTrue(refreshed.json["templates"]["test"]["componentsVerified"])
        self.assertIn("components", get.call_args.kwargs["params"]["fields"])
        payload = {"recipient": self.user["phone"], "event": "test", "templateName": "3p_direct_integration_test_template",
                   "language": "en_US", "parameters": {}, "confirmed": True, "requestId": "registered-template-test-123456"}
        path = "/api/admin/integrations/whatsapp/test-send"
        self.assertEqual(self.db.whatsapp_inbox.count_documents({}), 0)
        self.assertEqual(self.client.post(path, headers=self.headers, json={**payload, "confirmed": False}).status_code, 400)
        self.http.assert_not_called()
        result = self.client.post(path, headers=self.headers, json=payload)
        self.assertEqual(result.status_code, 200)
        request_template = self.http.call_args.kwargs["json"]["template"]
        self.assertEqual(request_template, {"name": "3p_direct_integration_test_template", "language": {"code": "en_US"}, "components": []})
        self.assertEqual(self.http.call_args.args[0], "https://graph.facebook.com/v26.0/12345/messages")
        self.assertFalse(self.app.config["WHATSAPP_ENABLED"])
        self.assertEqual(self.outbound()["reason"], "disabled")

    def test_registered_template_unapproved_or_changed_components_remain_blocked(self):
        from app.whatsapp_templates import template_registry
        entry = self.local_registered_template()
        for state, components in (("PENDING", entry["components"]), ("APPROVED", [])):
            with patch("app.whatsapp_routes.requests.get", return_value=self.response(200, {"data": [{**entry, "status": state, "components": components}]})):
                self.client.post("/api/admin/integrations/whatsapp/template-status", headers=self.headers)
            self.assertFalse(template_registry(self.db, self.app.config)["test"]["approved"])
            self.assertEqual(send(self.db, self.app.config, self.user["phone"], "test", {}, "blocked-static", test_send=True, consent=True)["reason"], "template_not_approved_or_enabled")
        self.http.assert_not_called()

if __name__ == "__main__":
    unittest.main()
