"""Current-account Meta contracts; isolated Mongo and mocked provider transport."""
from copy import deepcopy
from datetime import timedelta
import json
import re
from unittest.mock import patch

import pytest

from test_whatsapp_remediation import case
from test_whatsapp_order_mode import order_case
from app.whatsapp import notify, now, process_outbox
from app.whatsapp_catalogue import CATALOGUE, EVENT_CATALOGUE
from app.whatsapp_definitions import definition_components, order_button_parameters
from app.whatsapp_events import event_values, template_event_values
from app.whatsapp_mapping_plan import CANDIDATE_ORDER_MAPPINGS, plan_order_template_mappings
from app.whatsapp_routes import refresh_template_observations
from app.whatsapp_templates import component_signature, registry, template_registry

# Independent fixtures copied from the scoped 2026-11-20 Meta observations.
META_BODIES = {
    "rk_processing": "Dear {{1}},\n\nYour Rashi Kapoor order {{2}} is now being prepared.\n\nOur team is carefully processing your order, and we will notify you once it progresses to the next stage.\n\nThank you for shopping with Rashi Kapoor.",
    "rk_packed": "Dear {{1}},\n\nYour Rashi Kapoor order {{2}} has been packed and is ready for dispatch.\n\nWe will share the courier and tracking information once your parcel has been handed over to the delivery partner.\n\nThank you for choosing Rashi Kapoor.",
    "order_received": "Dear {{1}},\n\nThank you for placing your order with Rashi Kapoor.\n\nWe have received your order {{2}} for {{3}}.\n\nOrder total: \u20b9{{4}}\n\nYour order is now awaiting review by our team. Payment has not yet been collected. Our team will contact you to confirm availability and arrange payment.\n\nWe will keep you updated here as your order progresses.Hello",
    "order_and_payment_update": "Dear {{1}},\n\nThere is an update on your Rashi Kapoor order {{2}}.\n{{3}}.\n\nPayment status: {{4}}\n\nOrder total: \u20b9{{5}}\n\nAmount received: \u20b9{{6}}\n\nBalance due: \u20b9{{7}}\n\nThank you for choosing Rashi Kapoor. We will keep you informed as your order progresses.",
}
HEADERS = {"rk_processing": "Order Being Prepared", "rk_packed": "Your Order Has Been Packed", "order_received": "Order Received", "order_and_payment_update": "Order Update"}
PARAMETERS = {
    "rk_processing": ["customer_name", "order_number"],
    "rk_packed": ["customer_name", "order_number"],
    "order_received": ["customer_name", "order_number", "items_summary", "order_total"],
    "order_and_payment_update": ["customer_name", "order_number", "update_message", "payment_status", "order_total", "amount_received", "balance_due"],
}


def meta_components(name):
    result = [{"type": "HEADER", "format": "TEXT", "text": HEADERS[name]},
              {"type": "BODY", "text": META_BODIES[name]},
              {"type": "FOOTER", "text": "Rashi Kapoor Official"}]
    if name == "rk_processing":
        result.append({"type": "BUTTONS", "buttons": [{"type": "URL", "text": "Visit website", "url": "https://rashikapoor.co.in/"}]})
    return result


def approve(c, event, name, components=None):
    c.app.config["WHATSAPP_TEMPLATES"][event] = {"catalogue": name, "name": name, "language": "en_US", "category": "UTILITY", "enabled": True}
    row = {"name": name, "language": "en_US", "category": "UTILITY", "status": "APPROVED", "components": components or meta_components(name)}
    with patch("app.whatsapp_routes.requests.get", return_value=c.response(200, {"data": [row]})):
        refresh_template_observations(c.db, c.app.config)


def saved_order(c, event):
    order = deepcopy(c.order)
    order.update(paymentGateway="manual", paymentStatus="pending", payment={"gateway": "manual", "status": "pending"},
                 paymentTransactions=[], amountReceived=999999, balanceDue=0,
                 items=[{"name": "Fixture couture", "quantity": 2, "requiresAvailabilityConfirmation": True}],
                 inventoryReservation="reserved", inventoryReservationClaimToken="fixture-availability-confirmed")
    order.pop("razorpayPaymentId", None); order.pop("paymentVerifiedAt", None)
    state = {"order_accepted": "confirmed", "order_rejected": "cancelled"}.get(event, event)
    order["fulfillment"] = {"status": state if event in {"order_placed", "order_accepted", "order_rejected", "processing", "packed"} else "confirmed"}
    if event in {"order_accepted", "order_rejected"}:
        order["availabilityDecision"] = {"status": "accepted" if event == "order_accepted" else "rejected"}
    if event in {"advance_payment_received", "part_payment_received", "payment_received"}:
        first = {"id": "receipt-first", "event": "advance_payment_received", "amountPaise": 10000, "timestamp": now()}
        ledger = [first]
        if event != "advance_payment_received":
            ledger.append({"id": "receipt-second", "event": event, "amountPaise": 115000 if event == "payment_received" else 20000, "timestamp": now()})
        order.update(paymentTransactions=ledger, whatsappPayment=ledger[-1])
    c.db.orders.replace_one({"_id": order["_id"]}, order)
    return order


@pytest.mark.parametrize("name", META_BODIES)
def test_exact_meta_contracts_counts_order_and_static_buttons(name):
    spec = CATALOGUE[name]
    assert definition_components(spec) == meta_components(name)
    assert spec["parameters"] == PARAMETERS[name]
    assert sorted(set(map(int, re.findall(r"\{\{(\d+)\}\}", spec["body"])))) == list(range(1, len(PARAMETERS[name]) + 1))
    assert spec["category"] == "UTILITY" and spec["language"] == "en_US"
    assert order_button_parameters({"buttonParameters": []}, {}) == {}


@pytest.mark.parametrize("event,name", CANDIDATE_ORDER_MAPPINGS.items())
def test_each_lifecycle_mapping_dispatches_saved_order_values_once(order_case, event, name):
    c = order_case; approve(c, event, name); order = saved_order(c, event)
    if name == "order_received":
        template = template_registry(c.db, c.app.config)[event]
        assert template["observedStatus"] == "APPROVED" and template["componentsVerified"]
        assert template["activationBlock"] == "meta_body_correction_required"
        assert not template["enabled"] and not template["approved"]
        values = template_event_values(event, order, template)
        assert [values[key] for key in PARAMETERS[name]][2:] == ["Fixture couture x 2", "1,250.00"]
        with c.app.app_context():
            assert notify(c.db, event, order)["reason"] == "template_not_approved_or_enabled"
        assert c.db.whatsapp_outbox.count_documents({}) == 0
        c.http.assert_not_called()
        return
    with c.app.app_context():
        assert notify(c.db, event, {**order, "customerName": "UNTRUSTED", "total": 1})["status"] == "queued"
        assert notify(c.db, event, order)["status"] == "duplicate"
    assert process_outbox(c.db, c.app.config) == 1
    c.http.assert_called_once()
    template = c.http.call_args.kwargs["json"]["template"]
    assert template["name"] == name and template["language"] == {"code": "en_US"}
    assert len(template["components"]) == 1  # Static website button needs no dynamic send component.
    values = [parameter["text"] for parameter in template["components"][0]["parameters"]]
    assert values[:2] == [order["customerName"], order["orderNumber"]]
    assert len(values) == len(PARAMETERS[name]) and "UNTRUSTED" not in str(values)
    if name == "order_and_payment_update":
        assert not values[2].endswith(".")
        assert values[4] == "1,250.00"
        assert values[5:] == ({"advance_payment_received": ["100.00", "1,150.00"], "part_payment_received": ["300.00", "950.00"], "payment_received": ["1,250.00", "0.00"]}.get(event, ["0.00", "1,250.00"]))
        assert values[3] == ("Paid" if event == "payment_received" else "Partial" if event in {"advance_payment_received", "part_payment_received"} else "Pending")


@pytest.mark.parametrize("event,name", CANDIDATE_ORDER_MAPPINGS.items())
@pytest.mark.parametrize("problem", ["missing", "stale", "pending", "disabled", "wrong_account", "wrong_language", "wrong_category", "wrong_signature", "consent", "stop"])
def test_every_mapping_fails_closed_without_approval_and_consent(order_case, event, name, problem):
    c = order_case; approve(c, event, name); order = saved_order(c, event); query = {"_id": name + ":en_US"}
    changes = {"stale": {"checkedAt": now() - timedelta(days=2)}, "pending": {"status": "PENDING"},
               "wrong_account": {"businessAccountId": "other-account"}, "wrong_language": {"language": "en_GB"},
               "wrong_category": {"category": "MARKETING"}, "wrong_signature": {"componentSignature": "different-contract"}}
    if problem == "missing": c.db.whatsapp_template_status.delete_one(query)
    elif problem == "disabled": c.app.config["WHATSAPP_TEMPLATES"][event]["enabled"] = False
    elif problem == "consent": c.db.orders.update_one({"_id": order["_id"]}, {"$unset": {"whatsappConsent": ""}})
    elif problem == "stop":
        from app.whatsapp import fingerprint
        c.db.whatsapp_optouts.update_one({"_id": fingerprint(c.user["phone"], c.app.config)}, {"$set": {"active": True}}, upsert=True)
    else: c.db.whatsapp_template_status.update_one(query, {"$set": changes[problem]})
    with c.app.app_context(): assert notify(c.db, event, order)["status"] == "skipped"
    assert c.db.whatsapp_outbox.count_documents({}) == 0
    c.http.assert_not_called()


@pytest.mark.parametrize("part", ["header", "body", "footer", "button", "button_url"])
def test_exact_meta_component_changes_prevent_verification(order_case, part):
    c = order_case; components = meta_components("rk_processing")
    if part in {"header", "body", "footer"}: components[{"header": 0, "body": 1, "footer": 2}[part]]["text"] += " "
    elif part == "button": components.pop()
    else: components[-1]["buttons"][0]["url"] = "https://other.example/"
    approve(c, "processing", "rk_processing", components)
    template = template_registry(c.db, c.app.config)["processing"]
    assert not template["approved"] and not template["componentsVerified"]


def test_acceptance_and_receipt_claims_require_actual_persisted_authority(order_case):
    c = order_case; order = saved_order(c, "order_placed")
    with pytest.raises(ValueError): event_values("order_confirmation", order)
    with pytest.raises(ValueError): event_values("order_accepted", order)
    with pytest.raises(ValueError): event_values("payment_received", order)
    order["fulfillment"]["status"] = "confirmed"
    with pytest.raises(ValueError, match="acceptance_not_recorded"): event_values("order_accepted", order)
    receipt = {"id": "partial-is-not-final", "event": "payment_received", "amountPaise": 10000}
    order.update(paymentTransactions=[receipt], whatsappPayment=receipt)
    with pytest.raises(ValueError, match="payment_event_ledger_mismatch"): event_values("payment_received", order)
    receipt["event"] = "part_payment_received"; receipt["amountPaise"] = 125000
    with pytest.raises(ValueError, match="payment_event_ledger_mismatch"): event_values("part_payment_received", order)


def test_alias_punctuation_does_not_modify_original_status_contract(order_case):
    order = saved_order(order_case, "order_accepted")
    original = template_event_values("order_accepted", order, {"catalogue": "rk_order_status_update"})
    alias = template_event_values("order_accepted", order, {"catalogue": "order_and_payment_update"})
    assert original["update_message"] == "Your order has been accepted by our team."
    assert alias["update_message"] == "Your order has been accepted by our team"


@pytest.mark.parametrize("event,name", [("order_placed", "order_received"), ("order_accepted", "order_and_payment_update")])
def test_rupee_contracts_cannot_mislabel_foreign_currency_orders(order_case, event, name):
    order = saved_order(order_case, event); order["currency"] = "USD"
    with pytest.raises(ValueError, match="template_requires_inr_order"):
        template_event_values(event, order, {"catalogue": name})


def test_advance_partial_and_final_receipts_keep_separate_notification_identities(order_case):
    from app.manual_payments import record_payment
    c = order_case
    approve(c, "advance_payment_received", "order_and_payment_update")
    for event in ["part_payment_received", "payment_received"]:
        c.app.config["WHATSAPP_TEMPLATES"][event] = deepcopy(c.app.config["WHATSAPP_TEMPLATES"]["advance_payment_received"])
    order = saved_order(c, "order_placed")
    with c.app.app_context(), patch("app.order_fulfillment.send_html_email", return_value={}):
        for index, payload in enumerate([{"action": "advance", "amount": 100}, {"amount": 200}, {"action": "remaining"}]):
            receipt = {"transactionId": "mapping-receipt-" + str(index), "method": "cash", **payload}
            order = record_payment(c.db, order, c.admin, receipt)
            with pytest.raises(ValueError): record_payment(c.db, order, c.admin, receipt)
            assert notify(c.db, order["paymentTransactions"][-1]["event"], {**order, "whatsappPayment": order["paymentTransactions"][-1]})["status"] == "duplicate"
    assert c.db.whatsapp_outbox.count_documents({}) == 3
    assert process_outbox(c.db, c.app.config) == 3
    assert c.http.call_count == 3
    rows = [call.kwargs["json"]["template"]["components"][0]["parameters"] for call in c.http.call_args_list]
    assert [[entry["text"] for entry in row][3:] for row in rows] == [
        ["Partial", "1,250.00", "100.00", "1,150.00"],
        ["Partial", "1,250.00", "300.00", "950.00"],
        ["Paid", "1,250.00", "1,250.00", "0.00"],
    ]


@pytest.mark.parametrize("event,name", CANDIDATE_ORDER_MAPPINGS.items())
@pytest.mark.parametrize("problem", ["stale", "disabled", "components"])
def test_worker_rechecks_each_new_contract_before_dispatch(order_case, event, name, problem):
    c = order_case; approve(c, event, name); order = saved_order(c, event)
    if name == "order_received":
        with c.app.app_context(): assert notify(c.db, event, order)["reason"] == "template_not_approved_or_enabled"
        assert c.db.whatsapp_outbox.count_documents({}) == 0
        c.http.assert_not_called()
        return
    with c.app.app_context(): assert notify(c.db, event, order)["status"] == "queued"
    if problem == "disabled": c.app.config["WHATSAPP_TEMPLATES"][event]["enabled"] = False
    else:
        fields = {"checkedAt": now() - timedelta(days=2)} if problem == "stale" else {"componentSignature": "revoked-contract"}
        c.db.whatsapp_template_status.update_one({"_id": name + ":en_US"}, {"$set": fields})
    assert process_outbox(c.db, c.app.config) == 1
    c.http.assert_not_called()


def seed_unmapped_observations(c):
    for name in META_BODIES:
        c.db.whatsapp_template_status.replace_one({"_id": name + ":en_US"}, {
            "_id": name + ":en_US", "name": name, "language": "en_US", "category": "UTILITY", "status": "APPROVED",
            "businessAccountId": c.app.config["WHATSAPP_BUSINESS_ACCOUNT_ID"], "checkedAt": now(), "source": "meta_api_read",
            "presentInMeta": True, "metaComponents": meta_components(name), "componentsVerified": False,
            "componentSignature": None, "evidenceState": "found_not_locally_mapped"}, upsert=True)


def test_additive_plan_preserves_existing_entries_and_never_grants_cached_approval(order_case):
    c = order_case; seed_unmapped_observations(c)
    config = {**c.app.config, "WHATSAPP_TEMPLATES": json.dumps({"order_confirmation": {"catalogue": "rk_order_confirmation", "category": "UTILITY", "enabled": True}, "exclusive_offer": {"enabled": False}})}
    original = deepcopy(config); plan = plan_order_template_mappings(c.db, config)
    assert config == original and not plan["configurationWritten"]
    assert all(check["compatible"] for check in plan["checks"] if check["event"] != "order_placed")
    blocked = next(check for check in plan["checks"] if check["event"] == "order_placed")
    assert not blocked["compatible"] and blocked["activationStatus"] == "BLOCKED"
    assert "order_placed" not in plan["proposedMappings"]
    assert all(not plan["proposedMappings"][event]["enabled"] for event in CANDIDATE_ORDER_MAPPINGS if event != "order_placed")
    assert plan["proposedMappings"]["order_confirmation"] == json.loads(config["WHATSAPP_TEMPLATES"])["order_confirmation"]
    assert plan["proposedMappings"]["exclusive_offer"] == {"enabled": False}
    assert next(check for check in plan["checks"] if check["event"] == "order_placed")["contentWarning"]
    proposed = {**config, "WHATSAPP_TEMPLATES": plan["proposedMappings"]}
    assert not template_registry(c.db, proposed)["processing"]["approved"]
    assert c.db.whatsapp_template_status.find_one({"_id": "rk_processing:en_US"})["componentsVerified"] is False


@pytest.mark.parametrize("problem", ["stale", "future", "wrong_account", "unapproved", "wrong_components", "wrong_language", "wrong_category", "missing", "disabled_existing"])
def test_mapping_plan_never_enables_unverified_or_existing_disabled_entries(order_case, problem):
    c = order_case; seed_unmapped_observations(c); config = {**c.app.config, "WHATSAPP_TEMPLATES": {}}
    changes = {"stale": {"checkedAt": now() - timedelta(days=2)}, "future": {"checkedAt": now() + timedelta(hours=1)},
               "wrong_account": {"businessAccountId": "other-account"}, "unapproved": {"status": "PENDING"},
               "wrong_components": {"metaComponents": []}, "wrong_language": {"language": "en"}, "wrong_category": {"category": "MARKETING"}}
    if problem == "missing": c.db.whatsapp_template_status.delete_one({"_id": "rk_processing:en_US"})
    elif problem == "disabled_existing": config["WHATSAPP_TEMPLATES"]["processing"] = {"enabled": False}
    else: c.db.whatsapp_template_status.update_one({"_id": "rk_processing:en_US"}, {"$set": changes[problem]})
    plan = plan_order_template_mappings(c.db, config)
    assert not next(check for check in plan["checks"] if check["event"] == "processing")["compatible"]
    assert plan["proposedMappings"].get("processing", {}).get("enabled") is not True


@pytest.mark.parametrize("name,language,category", [("rk_test", "en", "MARKETING"), ("3p_direct_integration_test_template", "en_US", "UTILITY")])
def test_marketing_and_integration_templates_cannot_become_order_aliases(order_case, name, language, category):
    c = order_case
    c.app.config["WHATSAPP_TEMPLATES"]["processing"] = {"catalogue": "rk_processing", "name": name, "language": language, "category": category, "enabled": True}
    assert not registry(c.app.config)["processing"]["configured"]
    order = saved_order(c, "processing")
    with c.app.app_context(): assert notify(c.db, "processing", order)["status"] == "skipped"
    c.http.assert_not_called()


def test_new_contracts_do_not_replace_legacy_event_defaults_or_enable_unmapped_templates():
    assert EVENT_CATALOGUE["order_confirmation"] == "rk_order_confirmation"
    assert EVENT_CATALOGUE["shipped"] == "rk_order_shipped"
    assert EVENT_CATALOGUE["delivered"] == "rk_order_delivered"
    assert EVENT_CATALOGUE["cancelled"] == "rk_order_cancelled"
    assert EVENT_CATALOGUE["refund_completed"] == "rk_refund_processed"
    assert "rk_test" not in CATALOGUE and "3p_direct_integration_test_template" not in CATALOGUE
    assert all(not mapping["enabled"] and not mapping["approved"] for mapping in registry({}).values())


def test_bad_body_stays_byte_exact_and_cannot_be_enabled_by_operator_opt_in(order_case):
    c = order_case; seed_unmapped_observations(c)
    config = {**c.app.config, "WHATSAPP_TEMPLATES": {}}
    plan = plan_order_template_mappings(c.db, config, enable_events=set(CANDIDATE_ORDER_MAPPINGS))
    assert "order_placed" not in plan["proposedMappings"]
    assert all(mapping["enabled"] for mapping in plan["proposedMappings"].values())
    check = next(row for row in plan["checks"] if row["event"] == "order_placed")
    assert check["activationStatus"] == "BLOCKED" and check["reason"] == "meta_body_correction_required"
    assert check["componentSignature"] == "01fad496a131a8752da5e6c9cfe68de15de15e767dc969e957d5192e97ffc1c6"
    components = definition_components(CATALOGUE["order_received"])
    assert components[1] == {"type": "BODY", "text": META_BODIES["order_received"]}
    assert components[1]["text"].endswith("progresses.Hello")
    assert components[2] == {"type": "FOOTER", "text": "Rashi Kapoor Official"}
    assert not any(component["type"] == "BUTTONS" for component in components)


def test_corrected_meta_copy_requires_separate_reviewed_contract_update(order_case):
    c = order_case; corrected = meta_components("order_received")
    corrected[1]["text"] = corrected[1]["text"].removesuffix("Hello")
    approve(c, "order_placed", "order_received", corrected)
    template = template_registry(c.db, c.app.config)["order_placed"]
    assert template["activationBlock"] == "meta_body_correction_required"
    assert not template["componentsVerified"] and not template["approved"] and not template["enabled"]
    assert component_signature(definition_components(CATALOGUE["order_received"])) == "01fad496a131a8752da5e6c9cfe68de15de15e767dc969e957d5192e97ffc1c6"


def test_operator_opt_in_does_not_accept_marketing_or_unknown_events(order_case):
    with pytest.raises(ValueError, match="unsupported_transactional_activation_event"):
        plan_order_template_mappings(order_case.db, order_case.app.config, enable_events={"new_collection_drop"})


def test_legacy_mapping_cannot_bypass_block_by_omitting_catalogue(order_case):
    c = order_case; approve(c, "order_placed", "order_received")
    mapping = c.app.config["WHATSAPP_TEMPLATES"]["order_placed"]
    mapping.pop("catalogue")
    mapping["components"] = meta_components("order_received")
    template = template_registry(c.db, c.app.config)["order_placed"]
    assert template["activationBlock"] == "meta_body_correction_required"
    assert not template["enabled"] and not template["approved"]


def test_block_stops_previously_queued_order_received_jobs(order_case, monkeypatch):
    c = order_case
    with monkeypatch.context() as patcher:
        patcher.setitem(CATALOGUE["order_received"], "activationBlock", None)
        approve(c, "order_placed", "order_received")
        order = saved_order(c, "order_placed")
        with c.app.app_context(): assert notify(c.db, "order_placed", order)["status"] == "queued"
    assert process_outbox(c.db, c.app.config) == 1
    c.http.assert_not_called()


def test_manual_utility_test_cannot_bypass_bad_body_block(order_case):
    from app.whatsapp import send
    c = order_case; approve(c, "order_placed", "order_received")
    c.app.config.update(WHATSAPP_PRODUCTION_TEST_SEND_ENABLED=True,
                        WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT=(now() + timedelta(hours=2)).isoformat())
    result = send(c.db, c.app.config, c.user["phone"], "order_placed", {}, "blocked-template-test",
                  test_send=True, production_test=True, consent=True,
                  test_parameters={"body_1": "Customer", "body_2": "RK-1", "body_3": "Piece x 1", "body_4": "1250.00"})
    assert result["reason"] == "template_not_approved_or_enabled"
    c.http.assert_not_called()
