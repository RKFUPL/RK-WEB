"""Exact local contracts, persisted values, and provider/consent gates. No live sends."""
from copy import deepcopy
from datetime import timedelta
import re

import pytest

from test_whatsapp_remediation import case
from test_whatsapp_order_mode import order_case
from app.whatsapp_catalogue import CATALOGUE, EVENT_CATALOGUE, STATUS_UPDATE_EVENTS
from app.whatsapp_definitions import definition_components
from app.whatsapp_events import event_values
from app.whatsapp_templates import registry, template_registry
from app.whatsapp import notify, now, process_outbox

PLACED_BODY = "Dear {{1}},\n\nThank you for placing your order with Rashi Kapoor.\n\nWe have received your order {{2}} for {{3}}.\n\nOrder total: ₹{{4}}\n\nYour order is now awaiting review by our team. Payment has not yet been collected. Our team will contact you to confirm availability and arrange payment.\n\nWe will keep you updated here as your order progresses."
STATUS_BODY = "Dear {{1}},\n\nThere is an update on your Rashi Kapoor order {{2}}.\n\n{{3}}\n\nPayment status: {{4}}\n\nOrder total: ₹{{5}}\n\nAmount received: ₹{{6}}\n\nBalance due: ₹{{7}}\n\nThank you for choosing Rashi Kapoor. We will keep you informed as your order progresses."


@pytest.mark.parametrize("name,header,body,parameters", [
    ("rk_order_placed", "Order Received", PLACED_BODY, ["customer_name", "order_number", "items_summary", "order_total"]),
    ("rk_order_status_update", "Order Update", STATUS_BODY, ["customer_name", "order_number", "update_message", "payment_status", "order_total", "amount_received", "balance_due"]),
])
def test_exact_component_contracts(name, header, body, parameters):
    spec = CATALOGUE[name]
    assert spec["name"] == name and spec["language"] == "en_US" and spec["category"] == "UTILITY"
    assert spec["parameters"] == parameters and spec["parameterTypes"] == ["text"] * len(parameters)
    assert definition_components(spec) == [{"type": "HEADER", "format": "TEXT", "text": header},
        {"type": "BODY", "text": body}, {"type": "FOOTER", "text": "Rashi Kapoor Official"}]
    assert sorted(set(map(int, re.findall(r"\{\{(\d+)\}\}", body)))) == list(range(1, len(parameters) + 1))


def test_new_mapping_defaults_are_disabled_and_old_defaults_are_retained():
    templates = registry({})
    assert templates["order_placed"]["parameters"] == CATALOGUE["rk_order_placed"]["parameters"]
    assert templates["processing"]["parameters"] == CATALOGUE["rk_order_status_update"]["parameters"]
    for event in ["order_placed", "order_accepted", "order_rejected", "processing", "packed", "advance_payment_received", "part_payment_received", "payment_received"]:
        assert not templates[event]["enabled"] and not templates[event]["approved"]
    assert set(STATUS_UPDATE_EVENTS) == {"order_accepted", "order_rejected", "processing", "packed", "shipped", "out_for_delivery", "delivered", "advance_payment_received", "part_payment_received", "payment_received", "cancelled", "refund_completed"}
    assert EVENT_CATALOGUE["shipped"] == "rk_order_shipped"
    assert EVENT_CATALOGUE["delivered"] == "rk_order_delivered"
    assert EVENT_CATALOGUE["order_confirmation"] == "rk_order_confirmation"
    assert "order_confirmation" not in CATALOGUE["rk_order_status_update"]["events"]


def manual_order(c):
    order = deepcopy(c.order)
    order.update(paymentGateway="manual", paymentStatus="pending", payment={"gateway": "manual", "status": "pending"},
                 paymentTransactions=[], items=[{"name": "Ivory Lehenga", "quantity": 2}, {"name": "Silk Set", "quantity": 1}])
    order["fulfillment"] = {"status": "order_placed"}
    c.db.orders.replace_one({"_id": order["_id"]}, order)
    return order


def test_initial_values_use_items_and_numeric_rupee_value(order_case):
    order = manual_order(order_case)
    values = event_values("order_placed", order)
    assert values["items_summary"] == "Ivory Lehenga x 2, Silk Set x 1"
    assert values["order_total"] == "1,250.00"  # The body already contains the rupee symbol.
    with pytest.raises(ValueError):
        event_values("order_confirmation", order)


def test_unobserved_new_contracts_are_visible_as_local_drafts(order_case):
    c = order_case
    for name in ["rk_order_placed", "rk_order_status_update"]:
        c.db.whatsapp_template_status.delete_one({"_id": name + ":en_US"})
    result = c.client.get("/api/admin/integrations/whatsapp", headers=c.headers)
    assert result.status_code == 200
    for name in ["rk_order_placed", "rk_order_status_update"]:
        draft = result.json["catalogue"][name]
        assert draft["localDraft"] is True
        assert draft["observedStatus"] == "MISSING_OR_UNKNOWN"
        assert not draft["componentsVerified"] and not draft["enabled"]
        assert "approval has not been verified" in draft["draftExplanation"]


def test_payment_values_recompute_from_ledger_not_cached_totals(order_case):
    order = manual_order(order_case)
    first = {"id": "first-receipt", "event": "advance_payment_received", "amountPaise": 10000, "receivedPaise": 999999, "balancePaise": 0}
    second = {"id": "second-receipt", "event": "part_payment_received", "amountPaise": 20000}
    order.update(paymentTransactions=[first, second], amountReceived=99999, balanceDue=0, whatsappPayment=second)
    values = event_values("part_payment_received", order)
    assert values["payment_status"] == "Partial" and values["order_total"] == "1,250.00"
    assert values["amount_received"] == "300.00" and values["balance_due"] == "950.00"
    assert "INR 200.00" in values["update_message"]


def test_payment_event_respects_due_date_and_requires_manual_gateway(order_case):
    order = manual_order(order_case)
    receipt = {"id": "due-receipt", "event": "part_payment_received", "amountPaise": 10000}
    order.update(paymentTransactions=[receipt], whatsappPayment=receipt, paymentDueAt=now() - timedelta(days=1))
    assert event_values("part_payment_received", order)["payment_status"] == "Overdue"
    order.update(paymentGateway="razorpay", payment={"gateway": "razorpay", "status": "paid"})
    with pytest.raises(ValueError, match="payment_transaction_not_recorded"):
        event_values("part_payment_received", order)


@pytest.mark.parametrize("event,state", [("order_accepted", "confirmed"), ("order_rejected", "cancelled"), ("processing", "processing"), ("packed", "packed")])
def test_status_labels_require_actual_persisted_state(order_case, event, state):
    order = manual_order(order_case)
    with pytest.raises(ValueError):
        event_values(event, order)
    order["fulfillment"]["status"] = state
    order["availabilityDecision"] = {"status": "accepted" if event == "order_accepted" else "rejected"}
    if event == "order_rejected":
        order["availabilityDecision"]["reason"] = "requested_size_unavailable"
    values = event_values(event, order)
    assert values["update_message"] and values["payment_status"] == "Pending"


@pytest.mark.parametrize("event", ["shipped", "out_for_delivery", "delivered"])
def test_explicit_status_mapping_preserves_verified_shipment_contract(order_case, event):
    c = order_case
    c.configure_extended(event, "rk_order_status_update")
    c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": {"fulfillment": {"status": event, "courier": "Verified courier", "trackingNumber": "SAVED-AWB", "shippedAt": now(), "deliveredAt": now()}}})
    with c.app.app_context():
        assert notify(c.db, event, {**c.order, "fulfillment": {"trackingNumber": "UNTRUSTED"}})["status"] == "queued"
        assert notify(c.db, event, c.order)["status"] == "duplicate"
    assert process_outbox(c.db, c.app.config) == 1
    template = c.http.call_args.kwargs["json"]["template"]
    assert template["name"] == "rk_order_status_update"
    parameters = template["components"][0]["parameters"]
    assert len(parameters) == 7
    assert "Verified courier" in parameters[2]["text"] and "SAVED-AWB" in parameters[2]["text"]
    assert "UNTRUSTED" not in str(parameters)


@pytest.mark.parametrize("problem", ["missing", "pending", "wrong_components", "wrong_language", "wrong_category", "stale", "disabled", "consent", "stop"])
def test_local_draft_and_ineligible_evidence_never_queue(order_case, problem):
    c = order_case
    order = manual_order(c)
    c.configure_extended("order_placed", "rk_order_placed")
    query = {"_id": "rk_order_placed:en_US"}
    if problem == "missing": c.db.whatsapp_template_status.delete_one(query)
    elif problem == "pending": c.db.whatsapp_template_status.update_one(query, {"$set": {"status": "PENDING"}})
    elif problem == "wrong_components": c.db.whatsapp_template_status.update_one(query, {"$set": {"componentSignature": "old-contract"}})
    elif problem == "wrong_language": c.db.whatsapp_template_status.update_one(query, {"$set": {"language": "en_GB"}})
    elif problem == "wrong_category": c.db.whatsapp_template_status.update_one(query, {"$set": {"category": "MARKETING"}})
    elif problem == "stale": c.db.whatsapp_template_status.update_one(query, {"$set": {"checkedAt": now() - timedelta(days=2)}})
    elif problem == "disabled": c.app.config["WHATSAPP_TEMPLATES"]["order_placed"]["enabled"] = False
    elif problem == "consent": c.db.orders.update_one({"_id": order["_id"]}, {"$unset": {"whatsappConsent": ""}})
    else:
        from app.whatsapp import fingerprint
        c.db.whatsapp_optouts.update_one({"_id": fingerprint(c.user["phone"], c.app.config)}, {"$set": {"active": True}}, upsert=True)
    with c.app.app_context():
        assert notify(c.db, "order_placed", order)["status"] == "skipped"
    assert c.db.whatsapp_outbox.count_documents({}) == 0
    c.http.assert_not_called()


# Component signatures from the base branch; existing approved contracts must not drift.
LEGACY_COMPONENT_SIGNATURES = {'rk_authentication_otp': '10e776acb5b0dd500e1fc4f6117bbebcf4172251342c68997d10359de3360be8', 'rk_order_confirmation': '90af87932c4b9641e0cae67bf0e206d7177886d18fc26ba3263d50b7936d0a2c', 'rk_payment_confirmation': '53d324abdc8099aa92dda033ef2f893175d1ad4fb5583da4203ba3bef008fc84', 'rk_order_shipped': '2bc314cc163f903419647c3c4d4c1cb887a295595aa905afe0b696c8984c05d1', 'rk_out_for_delivery': '0379a39219651e7f20d322d6428bae856340dbc25a5828dbf7358c0a932cc748', 'rk_order_delivered': 'f1d4df5203cac14d4f892e5da170223b501ff688248248776d9cd6a14c0bc423', 'rk_order_cancelled': '0d24bcdc7964e39b24a616e98079fea69575ff31f5f2f181e7c5fd2d2d15bd14', 'rk_refund_processed': '2f9119afc465fc5a1b12871d5d3504e989a4267b6dac2eaae884241451761e5b'}

def test_existing_template_components_remain_unchanged():
    from app.whatsapp_templates import component_signature
    for name, signature in LEGACY_COMPONENT_SIGNATURES.items():
        assert component_signature(definition_components(CATALOGUE[name])) == signature, name
