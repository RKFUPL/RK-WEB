"""Restricted production tests. In-memory DB and mocked Meta only."""
from datetime import timedelta
import os
import runpy
from pathlib import Path
from unittest.mock import patch

import pytest

import test_whatsapp as fixtures
from app.whatsapp import now, send, send_text, process_outbox, production_test_state, test_send_enabled as development_gate
from app.whatsapp_campaigns import marketing_enabled

PATH = "/api/admin/integrations/whatsapp/test-send"


@pytest.fixture
def case():
    instance = fixtures.WhatsAppTests(methodName="runTest")
    instance.setUp()
    instance.app.config.update(WHATSAPP_ENVIRONMENT="production", WHATSAPP_ENABLED=False,
        WHATSAPP_MARKETING_ENABLED=False, WHATSAPP_TEST_SEND_ENABLED=False,
        WHATSAPP_PRODUCTION_TEST_SEND_ENABLED=True,
        WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT=(now() + timedelta(hours=1)).isoformat())
    from app.whatsapp_checks import scope_key
    from app.whatsapp_health import normalize_health
    checked = now()
    health = normalize_health({'can_send_message': 'AVAILABLE', 'entities': [
        {'entity_type': kind, 'id': instance.app.config[key] if key else '99999', 'can_send_message': 'AVAILABLE'}
        for kind, key in [('PHONE_NUMBER', 'WHATSAPP_PHONE_NUMBER_ID'), ('WABA', 'WHATSAPP_BUSINESS_ACCOUNT_ID'), ('BUSINESS', 'WHATSAPP_BUSINESS_PORTFOLIO_ID'), ('APP', 'WHATSAPP_APP_ID')]]
    }, instance.app.config, checked)
    evidence = {
        "billing": {"key": "billing", "status": "NOT VERIFIED", "checkedAt": checked, "_scope": scope_key(instance.app.config), "evidence": health},
        "sender": {"key": "sender", "status": "VERIFIED", "checkedAt": now(), "_scope": scope_key(instance.app.config), "evidence": {"businessVerificationStatus": "VERIFIED", "codeVerificationStatus": "VERIFIED", "registration": "CONNECTED", "messagingLimitTier": "TIER_250"}},
    }
    instance.db.integrations.update_one({"_id": "whatsapp"}, {"$set": {"diagnosticChecks": evidence}})
    for mapping in instance.app.config["WHATSAPP_TEMPLATES"].values():
        mapping["enabled"] = False
    try:
        yield instance
    finally:
        instance.doCleanups()


def payload(case, **changes):
    return {"event": "order_confirmation", "templateName": "rk_order_confirmation", "language": "en_US",
            "recipient": case.user["phone"], "parameters": {"body_1": "Fixture", "body_2": "RK-1", "body_3": "2026-11-15", "body_4": "INR 1.00"},
            "confirmed": True, "recipientConsentVerified": True, "requestId": "restricted-production-test-123456", **changes}


def submit(case, **changes):
    return case.client.post(PATH, headers=case.headers, json=payload(case, **changes))


def test_allowed_utility_uses_shared_transport_logs_and_receipts_without_order_queue(case):
    result = submit(case)
    assert result.status_code == 200
    assert result.json["providerId"] == "wamid.TEST"
    assert case.http.call_args.args[0].endswith("/12345/messages")
    assert case.http.call_args.kwargs["json"]["to"] == case.user["phone"][1:]
    record = case.db.whatsapp_messages.find_one({})
    assert record["testSend"] is True and record["productionTestSend"] is True
    assert record["httpStatus"] == 200
    assert case.db.whatsapp_outbox.count_documents({}) == 0
    assert case.db.whatsapp_order_events.count_documents({}) == 0
    for status in ("delivered", "read"):
        assert case.signed(case.webhook(statuses=[case.provider_status(status)])).status_code == 200
    record = case.db.whatsapp_messages.find_one({})
    assert record["status"] == "read" and record["deliveredAt"] and record["readAt"]
    assert submit(case).json["status"] == "duplicate"
    assert case.http.call_count == 1


@pytest.mark.parametrize("recipient", ["14155552671", "+1 415 555 2671", "", None, "+123"])
def test_invalid_numbers_are_rejected(case, recipient):
    assert submit(case, recipient=recipient).status_code == 400
    case.http.assert_not_called()


@pytest.mark.parametrize("recipient,request_id", [("+14155552672", "recipient-us-1234567890"), ("+442079460018", "recipient-uk-1234567890")])
def test_each_manually_entered_normalized_e164_recipient_is_allowed_without_allowlist(case, recipient, request_id):
    result = submit(case, recipient=recipient, requestId=request_id)
    assert result.status_code == 200
    assert case.http.call_args.kwargs["json"]["to"] == recipient[1:]
    assert case.db.whatsapp_messages.find_one({"recipient": "***" + recipient[-4:]})["testSend"] is True


@pytest.mark.parametrize("key,value", [
    ("WHATSAPP_PRODUCTION_TEST_SEND_ENABLED", False),
    ("WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT", ""),
    ("WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT", "invalid"),
    ("WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT", "2099-01-01T00:00:00"),
    ("WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT", "2099-01-01T00:00:00Z"),
    ("WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT", "2099-01-01T05:30:00+05:30"),
    ("WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT", "2099-99-99T00:00:00Z"),
    ("WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT", "2020-01-01T00:00:00Z"),
    ("WHATSAPP_ENABLED", True), ("WHATSAPP_MARKETING_ENABLED", True), ("WHATSAPP_TEST_SEND_ENABLED", True),
])
def test_missing_invalid_expired_or_unsafe_configuration_is_closed(case, key, value):
    case.app.config[key] = value
    assert submit(case).status_code == 403
    case.http.assert_not_called()


def test_expiry_boundary_and_explicit_utc_z(case):
    moment = now()
    for offset, expected_status in ((timedelta(0), 403), (timedelta(hours=24), 200),
                                    (timedelta(hours=24) - timedelta(microseconds=1), 200),
                                    (timedelta(hours=24) + timedelta(microseconds=1), 403)):
        case.app.config["WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT"] = (moment + offset).isoformat().replace("+00:00", "Z")
        with patch("app.whatsapp.now", return_value=moment):
            assert submit(case).status_code == expected_status


def test_consent_attestation_is_audited_without_creating_consent_or_claiming_system_verification(case):
    result = submit(case)
    assert result.status_code == 200
    audit = case.db.whatsapp_admin_audit.find_one({"action": "production_template_test_consent_attestation"})
    assert audit["operatorVerifiedNumberAndWhatsAppConsent"] is True
    assert audit["consentEvidenceType"] == "operator_attestation_not_system_verified"
    assert audit["actorId"] == str(case.admin["_id"])
    assert audit["recipientMasked"] == "***2671"
    assert "phone" not in audit and "recipient" not in audit
    assert case.db.whatsapp_consents.count_documents({}) == 0


def test_signed_stop_opt_out_still_blocks_manual_production_recipient(case):
    from app.whatsapp import fingerprint
    case.db.whatsapp_optouts.insert_one({"_id": fingerprint(case.user["phone"], case.app.config), "active": True})
    result = submit(case)
    assert result.status_code == 409
    assert result.json["reason"] == "recipient_opted_out"
    case.http.assert_not_called()


def test_too_far_expiry_has_a_safe_explanation(case):
    case.app.config["WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT"] = "2099-01-01T00:00:00Z"
    result = submit(case)
    assert result.status_code == 403
    assert result.json["reason"] == "production_test_expiry_too_far"
    assert "no more than 24 hours" in result.json["explanation"]
    case.http.assert_not_called()


@pytest.mark.parametrize("event,name", [("new_collection_drop", "rk_new_collection_drop"), ("signup_otp", "rk_authentication_otp")])
def test_marketing_and_authentication_cannot_use_production_template_tests(case, event, name):
    assert submit(case, event=event, templateName=name).status_code == 400
    assert send(case.db, case.app.config, case.user["phone"], event, {}, "forbidden", test_send=True,
                production_test=True, test_parameters={}, consent=True)["status"] == "skipped"
    case.http.assert_not_called()


@pytest.mark.parametrize("change", [{"status": "PENDING"}, {"status": "REJECTED"}, {"componentsVerified": False},
                                    {"checkedAt": now() - timedelta(days=2)}, {"businessAccountId": "999"}])
def test_ineligible_template_evidence_cannot_send(case, change):
    case.db.whatsapp_template_status.update_one({"name": "rk_order_confirmation"}, {"$set": change})
    assert submit(case).status_code == 409
    case.http.assert_not_called()


def test_missing_template_evidence_and_exact_identity_and_parameters(case):
    assert submit(case, language="en_GB").status_code == 400
    assert submit(case, templateName="another_template").status_code == 400
    assert submit(case, parameters={}).status_code == 409
    case.db.whatsapp_template_status.delete_many({})  # In-memory test fixture only.
    assert submit(case).status_code == 409
    case.http.assert_not_called()


@pytest.mark.parametrize("mutation", ["expiry", "gate", "approval"])
def test_restrictions_rechecked_after_retry_backoff(case, mutation):
    case.http.return_value = case.response(429, {"error": {"code": 130429}}, {"Retry-After": "1"})
    def change(_):
        if mutation == "expiry":
            case.app.config["WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT"] = "2099-01-01T00:00:00Z"
        elif mutation == "gate":
            case.app.config["WHATSAPP_PRODUCTION_TEST_SEND_ENABLED"] = False
        else:
            case.db.whatsapp_template_status.update_one({"name": "rk_order_confirmation"}, {"$set": {"status": "PENDING"}})
    with patch("app.whatsapp.time.sleep", side_effect=change):
        assert submit(case).status_code in {403, 409}
    assert case.http.call_count == 1


def test_restrictions_rechecked_immediately_before_dispatch(case):
    original = case.db.whatsapp_messages.update_one
    def expire(*args, **kwargs):
        result = original(*args, **kwargs)
        case.app.config["WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT"] = "2020-01-01T00:00:00Z"
        return result
    with patch.object(case.db.whatsapp_messages, "update_one", side_effect=expire):
        assert submit(case).status_code == 403
    case.http.assert_not_called()


def test_free_text_and_automation_and_campaigns_stay_disabled(case):
    assert not development_gate(case.app.config)
    assert send_text(case.db, case.app.config, case.user["phone"], "fixture", "text", consent=True, test_send=True)["reason"] == "test_send_disabled"
    assert send(case.db, case.app.config, case.user["phone"], "text", {}, "text2", text="fixture", test_send=True,
                production_test=True, test_parameters={}, consent=True)["reason"] == "invalid_test_type"
    result = case.client.post("/api/admin/integrations/whatsapp/test-message", headers=case.headers,
        json={"recipient": case.user["phone"], "message": "fixture", "confirmed": True, "requestId": "restricted-free-text-123456"})
    assert result.status_code == 403
    assert case.outbound()["reason"] == "disabled"
    assert process_outbox(case.db, case.app.config) == 0
    assert not marketing_enabled(case.db, case.app.config)
    case.http.assert_not_called()


def test_consent_admin_authorization_and_rate_limit_retained(case):
    assert submit(case, confirmed=False).status_code == 400
    assert submit(case, recipientConsentVerified=False).status_code == 400
    case.admin["role"] = "customer"
    assert submit(case).status_code == 403
    case.admin["role"] = "admin"
    case.app.config["RATELIMIT_ENABLED"] = True
    # The same shared limiter applies to the production endpoint.
    from app.extensions import limiter
    from flask import Flask
    from flask_jwt_extended import JWTManager
    from app.whatsapp_routes import admin_bp
    previous = limiter.enabled
    app = Flask("restricted-production-rate-test")
    app.config.update(case.app.config, RATELIMIT_ENABLED=True, RATELIMIT_STORAGE_URI="memory://")
    JWTManager(app)
    limiter.init_app(app)
    app.register_blueprint(admin_bp, url_prefix="/api/admin/integrations/whatsapp")
    try:
        limiter.reset()
        results = [app.test_client().post(PATH, headers=case.headers, json=payload(case, requestId=f"restricted-rate-request-{i:016d}")) for i in range(4)]
        assert results[-1].status_code == 429
    finally:
        limiter.enabled = previous


def test_admin_status_separates_template_mode_from_development_free_text_gate(case):
    status = case.client.get("/api/admin/integrations/whatsapp", headers=case.headers).json
    assert status["testSendEnabled"] is False
    assert status["productionTest"]["enabled"] is True
    assert "recipient" not in status["productionTest"]
    assert status["templates"]["order_confirmation"]["eligibleForTesting"] is True
    assert status["templates"]["order_confirmation"]["eligibleForAutomation"] is False
    assert status["enabled"] is False and status["marketingEnabled"] is False


def test_real_config_defaults_off_and_old_production_gates_stay_hard_off():
    path = Path(__file__).parents[1] / "app" / "config.py"
    with patch.dict(os.environ, {}, clear=True):
        production = runpy.run_path(str(path))["ProductionConfig"]
        assert production.WHATSAPP_PRODUCTION_TEST_SEND_ENABLED is False
        assert production.WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT == ""
    with patch.dict(os.environ, {key: "true" for key in ("WHATSAPP_PRODUCTION_TEST_SEND_ENABLED", "WHATSAPP_ENABLED", "WHATSAPP_MARKETING_ENABLED", "WHATSAPP_TEST_SEND_ENABLED")}, clear=True):
        production = runpy.run_path(str(path))["ProductionConfig"]
        assert production.WHATSAPP_PRODUCTION_TEST_SEND_ENABLED is True
        assert production.WHATSAPP_ENABLED is False
        assert production.WHATSAPP_MARKETING_ENABLED is False
        assert production.WHATSAPP_TEST_SEND_ENABLED is False


def test_production_flag_cannot_enable_development_sending(case):
    case.app.config["WHATSAPP_ENVIRONMENT"] = "development"
    assert not production_test_state(case.app.config)["enabled"]
    assert submit(case).status_code == 403
    case.http.assert_not_called()


def test_explicit_integration_template_mapping_needs_real_component_evidence_in_production(case):
    from app.whatsapp_routes import refresh_template_observations
    entry = case.local_registered_template()
    entry["enabled"] = False
    with patch("app.whatsapp_routes.requests.get", return_value=case.response(200, {"data": [{**entry, "status": "APPROVED"}]})):
        refresh_template_observations(case.db, case.app.config)
    result = submit(case, event="test", templateName=entry["name"], parameters={})
    assert result.status_code == 200
    assert case.http.call_args.kwargs["json"]["template"] == {"name": entry["name"], "language": {"code": "en_US"}, "components": []}


def test_normal_disabled_release_preflight_rejects_an_enabled_temporary_mode(case):
    from app.whatsapp_ops import configuration_problems
    assert "WHATSAPP_PRODUCTION_TEST_SEND_ENABLED" in configuration_problems(case.app.config, production=True)
