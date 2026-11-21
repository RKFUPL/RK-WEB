"""Checkout consent policy and later order opt-in, with isolated Mongo and no provider sends."""
from datetime import datetime
from unittest.mock import patch

import pytest
from bson import ObjectId

from app.blueprints.admin.routes import SETTINGS_DEFAULTS
from app.whatsapp_consent import record_consent
from app.whatsapp_marketing_consent import record_marketing_consent
from test_manual_checkout import checkout, shop


def require_consent(shop, *, online=False):
    shop[0].admin_settings.update_one({"_id": "store"}, {"$set": {
        "requireWhatsappConsentForCheckout": True, "razorpayEnabled": online,
    }})


def test_setting_defaults_off_and_public_response_exposes_only_the_checkout_flag(shop):
    db, client, _, _, headers, _, _ = shop
    assert client.get("/api/admin/settings", headers=headers).json["settings"]["requireWhatsappConsentForCheckout"] is False
    public = client.get("/api/storefront-settings").json["settings"]
    assert public["requireWhatsappConsentForCheckout"] is False
    db.admin_settings.update_one({"_id": "store"}, {"$set": {"WHATSAPP_ACCESS_TOKEN": "private", "requireWhatsappConsentForCheckout": True}})
    public = client.get("/api/storefront-settings").json["settings"]
    assert public["requireWhatsappConsentForCheckout"] is True
    assert "WHATSAPP_ACCESS_TOKEN" not in public


def test_admin_enable_requires_boolean_and_separate_legal_acknowledgement(shop):
    db, client, _, _, headers, _, _ = shop
    base = {**SETTINGS_DEFAULTS, "razorpayEnabled": False}
    for invalid in ("true", 1, None):
        assert client.put("/api/admin/settings", headers=headers, json={**base, "requireWhatsappConsentForCheckout": invalid}).status_code == 400
    assert client.put("/api/admin/settings", headers=headers, json={**base, "requireWhatsappConsentForCheckout": True}).status_code == 400
    assert client.put("/api/admin/settings", headers=headers, json={**base, "requireWhatsappConsentForCheckout": True,
        "requireWhatsappConsentAcknowledged": "true"}).status_code == 400
    enabled = client.put("/api/admin/settings", headers=headers, json={**base, "requireWhatsappConsentForCheckout": True,
        "requireWhatsappConsentAcknowledged": True})
    assert enabled.status_code == 200
    assert db.admin_settings.find_one({"_id": "store"})["requireWhatsappConsentForCheckout"] is True
    assert "requireWhatsappConsentAcknowledged" not in db.admin_settings.find_one({"_id": "store"})
    other_change = {key: value for key, value in base.items() if key != "requireWhatsappConsentForCheckout"}
    other_change["supportEmail"] = "support@example.test"
    assert client.put("/api/admin/settings", headers=headers, json=other_change).status_code == 200
    assert db.admin_settings.find_one({"_id": "store"})["requireWhatsappConsentForCheckout"] is True
    assert client.put("/api/admin/settings", headers=headers, json={**base, "requireWhatsappConsentForCheckout": False}).status_code == 200
    assert db.admin_settings.find_one({"_id": "store"})["requireWhatsappConsentForCheckout"] is False


@pytest.mark.parametrize("online", [False, True])
@pytest.mark.parametrize("scenario", ["missing", "false", "missing_number", "invalid_number", "forged_setting"])
def test_mandatory_checkout_rejects_before_order_or_provider_side_effects(shop, online, scenario):
    db, client, user, _, headers, payload, _ = shop
    require_consent(shop, online=online)
    if scenario == "missing":
        payload.pop("whatsappTransactionalConsent")
    elif scenario in {"false", "forged_setting"}:
        payload["whatsappTransactionalConsent"] = False
    else:
        payload["whatsappTransactionalConsent"] = True
    if scenario == "missing_number":
        payload.pop("whatsappRecipient")
        user.pop("phone")
    elif scenario == "invalid_number":
        payload["whatsappRecipient"] = "123"
    elif scenario == "forged_setting":
        payload["requireWhatsappConsentForCheckout"] = False
    with patch("app.blueprints.payments.routes.razorpay_api_request", side_effect=AssertionError("provider must not be called")), \
         patch("app.blueprints.payments.routes.is_configured", side_effect=AssertionError("provider check must not run")):
        response = client.post("/api/payments/razorpay/order", headers=headers, json=payload)
    assert response.status_code == 400
    assert response.json["code"].startswith("whatsapp_")
    assert db.orders.count_documents({}) == 0
    assert db.whatsapp_consents.count_documents({}) == 0


def test_optional_checkout_and_voluntary_consent_remain_independent_of_marketing(shop):
    db, client, _, _, headers, payload, _ = shop
    declined = checkout(shop)
    assert declined["whatsappConsent"]["enabled"] is False
    assert db.whatsapp_consents.count_documents({}) == 0
    payload["checkoutAttemptId"] = "attempt-voluntary-002"
    payload["whatsappTransactionalConsent"] = True
    payload["whatsappMarketingConsent"] = False
    granted = checkout(shop)
    assert granted["whatsappConsent"]["enabled"] is True
    assert granted["whatsappMarketingConsent"]["enabled"] is False
    assert db.whatsapp_consents.count_documents({"category": "transactional", "enabled": True}) == 1


def test_saved_signup_consent_remains_valid_for_the_same_number_and_is_snapshotted_without_a_new_grant(shop):
    db, client, user, _, headers, payload, _ = shop
    require_consent(shop)
    saved = record_consent(db, client.application.config, user["_id"], "+14155552671", True, "signup")
    from app.blueprints.auth.routes import _public_user
    user = db.users.find_one({"_id": user["_id"]})
    with client.application.app_context(), patch("app.blueprints.auth.routes._database", return_value=db):
        profile = _public_user(user)
    assert profile["whatsappConsentValid"] is True
    assert profile["whatsappPhone"] == "+14155552671"

    payload["whatsappTransactionalConsent"] = True
    with patch("app.blueprints.payments.routes.current_user", return_value=user):
        response = client.post("/api/payments/razorpay/order", headers=headers, json=payload)
    assert response.status_code == 201, response.json
    order = db.orders.find_one({"checkoutAttemptId": payload["checkoutAttemptId"]})
    assert order["whatsappConsent"]["enabled"] is True
    assert order["whatsappConsent"]["source"] == "signup"
    assert order["whatsappConsent"]["orderId"] == str(order["_id"])
    assert order["whatsappConsent"]["timestamp"] == saved["timestamp"]
    assert db.whatsapp_consents.count_documents({"customerId": str(user["_id"]), "category": "transactional"}) == 1

    db.users.update_one({"_id": user["_id"]}, {"$set": {"whatsappPhone": "+442079460018"}})
    changed_user = db.users.find_one({"_id": user["_id"]})
    with client.application.app_context(), patch("app.blueprints.auth.routes._database", return_value=db):
        changed_profile = _public_user(changed_user)
    assert changed_profile["whatsappConsentValid"] is False


def test_optional_consent_with_invalid_number_fails_without_order_or_audit(shop):
    db, client, _, _, headers, payload, _ = shop
    payload["whatsappTransactionalConsent"] = True
    payload["whatsappRecipient"] = "123"
    response = client.post("/api/payments/razorpay/order", headers=headers, json=payload)
    assert response.status_code == 400
    assert response.json["code"] == "whatsapp_number_invalid"
    assert db.orders.count_documents({}) == 0
    assert db.whatsapp_consents.count_documents({}) == 0


def test_customer_can_explicitly_continue_without_any_whatsapp_number(shop):
    db, client, _, _, headers, payload, _ = shop
    payload.update(whatsappRecipient="", whatsappTransactionalConsent=False, whatsappMarketingConsent=False)
    response = client.post("/api/payments/razorpay/order", headers=headers, json=payload)
    assert response.status_code == 201
    order = db.orders.find_one({"checkoutAttemptId": payload["checkoutAttemptId"]})
    assert order["whatsappRecipient"] is None
    assert order["whatsappConsent"]["enabled"] is False
    assert db.whatsapp_consents.count_documents({}) == 0


def test_explicit_checkout_decline_does_not_reuse_saved_transactional_grant(shop):
    db, client, user, _, headers, payload, _ = shop
    record_consent(db, client.application.config, user["_id"], "+14155552671", True, "authenticated_profile")
    payload.update(whatsappRecipient="+14155552671", whatsappTransactionalConsent=False)
    response = client.post("/api/payments/razorpay/order", headers=headers, json=payload)
    assert response.status_code == 201
    order = db.orders.find_one({"checkoutAttemptId": payload["checkoutAttemptId"]})
    assert order["whatsappConsent"]["enabled"] is False
    assert order["whatsappConsent"]["status"] == "declined"
    assert db.users.find_one({"_id": user["_id"]})["whatsappConsent"]["enabled"] is True


def test_account_api_reports_current_marketing_preference_validity(shop):
    db, client, user, _, headers, _, _ = shop
    from app.blueprints.auth.routes import _public_user
    db.users.update_one({"_id": user["_id"]}, {"$set": {"role": "customer"}})
    user["role"] = "customer"
    record_marketing_consent(db, client.application.config, user["_id"], "+14155552671", True, "authenticated_profile")
    with patch("app.blueprints.auth.routes._database", return_value=db), client.application.app_context():
        assert _public_user(db.users.find_one({"_id": user["_id"]}))["whatsappMarketingConsentValid"] is True
    record_marketing_consent(db, client.application.config, user["_id"], "+14155552671", False, "authenticated_profile")
    with patch("app.blueprints.auth.routes._database", return_value=db), client.application.app_context():
        profile = _public_user(db.users.find_one({"_id": user["_id"]}))
    assert profile["whatsappMarketingConsentValid"] is False


def test_mandatory_manual_checkout_records_exact_consent_and_preserves_idempotency(shop):
    db, client, user, _, headers, payload, _ = shop
    require_consent(shop)
    payload["whatsappTransactionalConsent"] = True
    order = checkout(shop)
    consent = db.whatsapp_consents.find_one({"orderId": str(order["_id"]), "category": "transactional"})
    assert consent and consent["customerId"] == str(user["_id"])
    assert consent["phone"] == order["whatsappRecipient"] == "+14155552671"
    assert consent["enabled"] is True and consent["source"] == "checkout"
    assert isinstance(consent["timestamp"], datetime)
    assert consent["version"] == "transactional-v4"
    assert consent["text"] == "I agree to receive transactional WhatsApp updates, including order confirmations, payment updates, shipping and delivery notifications."
    assert order["whatsappConsent"]["consentId"] == str(consent["_id"])
    assert client.post("/api/payments/razorpay/order", headers=headers, json=payload).status_code == 200
    assert db.orders.count_documents({}) == 1 and db.whatsapp_consents.count_documents({}) == 1


def test_withdrawn_consent_cannot_reuse_a_mandatory_checkout_attempt(shop):
    db, client, user, _, headers, payload, _ = shop
    require_consent(shop)
    payload["whatsappTransactionalConsent"] = True
    checkout(shop)
    record_consent(db, client.application.config, user["_id"], "+14155552671", False, "authenticated_profile")
    response = client.post("/api/payments/razorpay/order", headers=headers, json=payload)
    assert response.status_code == 409
    assert "withdrawn" in response.json["error"]
    assert db.orders.count_documents({}) == 1


def test_mandatory_online_checkout_uses_same_validation_and_one_provider_order(shop):
    db, client, _, _, headers, payload, _ = shop
    require_consent(shop, online=True)
    payload["whatsappTransactionalConsent"] = True
    with patch("app.blueprints.payments.routes.is_configured", return_value=True), \
         patch("app.blueprints.payments.routes.razorpay_api_request", return_value={"id": "order_fixture"}) as provider:
        first = client.post("/api/payments/razorpay/order", headers=headers, json=payload)
        second = client.post("/api/payments/razorpay/order", headers=headers, json=payload)
    assert first.status_code == 201 and second.status_code == 200
    provider.assert_called_once()
    assert db.orders.count_documents({}) == 1 and db.whatsapp_consents.count_documents({}) == 1


def test_order_owner_can_reconsent_without_replaying_old_events_and_withdraw_later(shop):
    db, client, user, _, headers, payload, _ = shop
    user["role"] = "customer"
    db.users.update_one({"_id": user["_id"]}, {"$set": {"role": "customer"}})
    order = checkout(shop)
    old = order["whatsappConsent"]
    other_id = ObjectId()
    db.orders.insert_one({**order, "_id": other_id, "customerId": ObjectId()})
    route = f"/api/orders/{order['_id']}/whatsapp-consent"
    counts = (db.whatsapp_order_events.count_documents({}), db.whatsapp_outbox.count_documents({}))
    assert client.post(route, headers=headers, json={"whatsappTransactionalConsent": False}).status_code == 400
    assert client.post(route, headers=headers, json={"whatsappTransactionalConsent": True, "whatsappRecipient": "123"}).status_code == 400
    assert client.post(f"/api/orders/{other_id}/whatsapp-consent", headers=headers,
                       json={"whatsappTransactionalConsent": True, "whatsappRecipient": "+14155552671"}).status_code == 404
    assert db.whatsapp_consents.count_documents({}) == 0
    response = client.post(route, headers=headers, json={"whatsappTransactionalConsent": True,
                           "whatsappRecipient": "+14155552671"})
    assert response.status_code == 200, response.json
    updated = db.orders.find_one({"_id": order["_id"]})
    assert updated["whatsappConsent"]["source"] == "order_reconsent"
    assert updated["whatsappConsentHistory"] == [old]
    assert response.json["order"]["whatsappUpdates"] == {"number": "+14155552671", "enabled": True}
    assert db.whatsapp_consents.count_documents({"orderId": str(order["_id"]), "enabled": True}) == 1
    assert (db.whatsapp_order_events.count_documents({}), db.whatsapp_outbox.count_documents({})) == counts
    record_consent(db, client.application.config, user["_id"], "+14155552671", False, "authenticated_profile")
    detail = client.get(f"/api/orders/{order['_id']}", headers=headers)
    assert detail.status_code == 200
    assert detail.json["order"]["whatsappUpdates"]["enabled"] is False


def test_post_order_opt_in_accepts_an_order_without_an_existing_consent_snapshot(shop):
    db, client, user, _, headers, _, _ = shop
    user["role"] = "customer"
    db.users.update_one({"_id": user["_id"]}, {"$set": {"role": "customer"}})
    order = checkout(shop)
    db.orders.update_one({"_id": order["_id"]}, {"$unset": {"whatsappConsent": ""}})
    response = client.post(f"/api/orders/{order['_id']}/whatsapp-consent", headers=headers,
                           json={"whatsappTransactionalConsent": True, "whatsappRecipient": "+14155552671"})
    assert response.status_code == 200
    assert response.json["order"]["whatsappUpdates"]["enabled"] is True
    assert db.whatsapp_consents.count_documents({"orderId": str(order["_id"]), "enabled": True}) == 1
