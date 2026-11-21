"""Saved rejection evidence only; isolated MongoMock and mocked Meta transport."""
from copy import deepcopy

import pytest

from test_whatsapp_remediation import case
from test_whatsapp_order_mode import order_case
from test_meta_order_mappings import approve, saved_order, meta_components, PARAMETERS
from app.whatsapp import notify, process_outbox
from app.whatsapp_events import event_values, template_event_values
from app.whatsapp_catalogue import CATALOGUE
from app.whatsapp_definitions import definition_components


REASONS = [
    ("requested_size_unavailable", "Requested size unavailable"),
    ("fabric_or_material_unavailable", "Fabric or material unavailable"),
    ("production_or_fulfilment_limitation", "Production/fulfilment limitation"),
    ("other", "Other"),
]


@pytest.mark.parametrize("reason,label", REASONS)
@pytest.mark.parametrize("explanation", [None, "The selected fabric cannot be sourced."])
def test_saved_rejection_reason_and_optional_explanation(order_case, reason, label, explanation):
    order = saved_order(order_case, "order_rejected")
    if reason == "other" and explanation is None:
        explanation = "A bespoke production constraint."
    order["availabilityDecision"].update(reason=reason, explanation=explanation)
    order["internalNote"] = "INTERNAL ONLY"
    order["timeline"] = [{"note": "UNTRUSTED TIMELINE"}]
    original = deepcopy(order)
    values = event_values("order_rejected", order)
    expected = f"Order status: REJECTED. Reason: {label}."
    if explanation:
        expected += " Additional details: " + explanation
    assert values["update_message"] == expected
    assert [values[k] for k in ("payment_status", "order_total", "amount_received", "balance_due")] == [
        "Pending", "1,250.00", "0.00", "1,250.00"]
    assert order == original  # Value building does not mutate or enqueue anything.


@pytest.mark.parametrize("decision", [None, {}, [], {"status": "accepted", "reason": "other", "explanation": "Saved"},
    {"status": "rejected"}, {"status": "rejected", "reason": "unsupported"},
    {"status": "rejected", "reason": []}, {"status": "rejected", "reason": "other"},
    {"status": "rejected", "reason": "other", "explanation": " \n\t\x00 "},
    {"status": "rejected", "reason": "other", "explanation": {"note": "invalid"}}])
def test_incomplete_evidence_fails_closed_before_queueing(order_case, decision):
    c = order_case
    approve(c, "order_rejected", "order_and_payment_update")
    order = saved_order(c, "order_rejected")
    order["availabilityDecision"] = decision
    c.db.orders.replace_one({"_id": order["_id"]}, order)
    with pytest.raises(ValueError):
        event_values("order_rejected", order)
    with c.app.app_context():
        assert notify(c.db, "order_rejected", order)["status"] == "skipped"
    assert c.db.whatsapp_outbox.count_documents({}) == 0
    c.http.assert_not_called()


def test_rejection_requires_actual_lifecycle_and_sanitizes_saved_explanation(order_case):
    order = saved_order(order_case, "order_rejected")
    order["availabilityDecision"].update(reason="other", explanation=" \nSaved\t\x00 explanation " + "x" * 600)
    message = event_values("order_rejected", order)["update_message"]
    details = message.split("Additional details: ")[1]
    assert details.startswith("Saved explanation ") and len(details) == 500
    assert not any(ord(char) < 32 or ord(char) == 127 for char in details)
    order["fulfillment"]["status"] = "confirmed"
    with pytest.raises(ValueError, match="order_state_not_recorded"):
        event_values("order_rejected", order)


def test_approved_contract_and_existing_notification_identity_are_unchanged(order_case):
    c = order_case
    approve(c, "order_rejected", "order_and_payment_update")
    order = saved_order(c, "order_rejected")
    assert definition_components(CATALOGUE["order_and_payment_update"]) == meta_components("order_and_payment_update")
    assert PARAMETERS["order_and_payment_update"] == ["customer_name", "order_number", "update_message",
        "payment_status", "order_total", "amount_received", "balance_due"]
    with c.app.app_context():
        # Caller-supplied decision cannot replace persisted evidence.
        supplied = {**order, "availabilityDecision": {"status": "rejected", "reason": "other", "explanation": "FORGED"}}
        assert notify(c.db, "order_rejected", supplied)["status"] == "queued"
    assert process_outbox(c.db, c.app.config) == 1
    parameters = c.http.call_args.kwargs["json"]["template"]["components"][0]["parameters"]
    assert len(parameters) == 7
    assert parameters[2]["text"] == "Order status: REJECTED. Reason: Requested size unavailable"
    with c.app.app_context():
        assert notify(c.db, "order_rejected", order)["status"] == "duplicate"
    assert process_outbox(c.db, c.app.config) == 0
    assert c.db.whatsapp_outbox.count_documents({}) == 1
    c.http.assert_called_once()


def test_acceptance_copy_is_unchanged(order_case):
    order = saved_order(order_case, "order_accepted")
    assert event_values("order_accepted", order)["update_message"] == "Your order has been accepted by our team."
    assert template_event_values("order_accepted", order, {"catalogue": "order_and_payment_update"})["update_message"] == "Your order has been accepted by our team"
