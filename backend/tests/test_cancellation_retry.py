"""Persisted cancellation retries; synthetic Mongo and mocked providers only."""
from copy import deepcopy
from unittest.mock import patch

import pytest

from test_whatsapp_remediation import case
from test_whatsapp_order_mode import order_case
from test_meta_order_mappings import approve
from app.order_fulfillment import apply_transition, send_status_notification
from app.whatsapp_catalogue import CATALOGUE
from app.whatsapp_definitions import definition_components
from app.whatsapp_events import event_values
from app.whatsapp_orders import notify_order_whatsapp
from app.whatsapp import process_outbox


def prepare(c, rejected=False):
    from app.blueprints.orders.routes import staff_orders_bp
    c.app.register_blueprint(staff_orders_bp, url_prefix="/api/staff/orders")
    approve(c, "cancelled", "rk_order_cancelled", definition_components(CATALOGUE["rk_order_cancelled"]))
    if rejected:
        c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": {
            "fulfillment.status": "order_placed", "fulfillmentStatus": "order_placed", "status": "order_placed"}})
    order = c.db.orders.find_one({"_id": c.order["_id"]})
    with c.app.app_context(), patch("app.order_fulfillment.send_status_notification"):
        return apply_transition(c.db, order, "cancelled", "staff", c.admin,
                                {"rejectionReason": "requested_size_unavailable"})


def retry(c, channel=None):
    payload = {"event": "cancelled"}
    if channel is not None:
        payload["channel"] = channel
    with patch("app.blueprints.orders.routes.database", return_value=c.db):
        return c.client.post(f"/api/staff/orders/{c.order['_id']}/notifications/retry", headers=c.headers, json=payload)


@pytest.mark.parametrize("rejected", [False, True])
def test_actual_transition_retries_original_reference_once_without_mutating_order(order_case, rejected):
    c = order_case; order = prepare(c, rejected)
    transition = order["timeline"][-1]
    assert transition["status"] == ("order_rejected" if rejected else "cancelled")
    assert event_values("cancelled", order)["cancellation_reference"] == transition["id"]
    c.app.config["WHATSAPP_TEMPLATES"]["cancelled"]["enabled"] = False
    with c.app.app_context():
        assert notify_order_whatsapp(c.db, order["_id"], "cancelled")["status"] == "skipped"
    assert c.db.whatsapp_messages.find_one({"type": "cancelled"})["attempts"] == 0
    c.app.config["WHATSAPP_TEMPLATES"]["cancelled"]["enabled"] = True
    with patch("app.order_fulfillment.send_html_email") as email:
        assert retry(c, "whatsapp").status_code == 200
        assert retry(c, "whatsapp").status_code == 200
        assert c.db.whatsapp_outbox.count_documents({}) == 1
        assert process_outbox(c.db, c.app.config) == 1
        assert retry(c, "whatsapp").status_code == 200
        assert process_outbox(c.db, c.app.config) == 0
    email.assert_not_called(); c.http.assert_called_once()
    params = c.http.call_args.kwargs["json"]["template"]["components"][0]["parameters"]
    assert params[2]["text"] == transition["id"]
    saved = c.db.orders.find_one({"_id": order["_id"]})
    assert saved["timeline"] == order["timeline"] and saved["fulfillment"] == order["fulfillment"]
    assert saved["status"] == "cancelled"


@pytest.mark.parametrize("change,reason", [
    ({"timeline": []}, "cancellation_reference_missing"),
    ({"timeline": [{"status": "cancelled"}]}, "cancellation_reference_missing"),
    ({"timeline": [{"status": "cancelled", "id": " "}]}, "cancellation_reference_missing"),
    ({"timeline": [{"status": "cancelled", "id": 12}]}, "cancellation_reference_missing"),
    ({"fulfillment.status": "processing"}, "cancellation_state_not_recorded"),
    ({"availabilityDecision.status": "accepted"}, "rejection_not_recorded"),
])
def test_invalid_or_stale_cancellation_fails_closed_with_safe_reason(order_case, change, reason):
    c = order_case; prepare(c, True)
    c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": change})
    with patch("app.order_fulfillment.send_html_email") as email:
        response = retry(c)
    assert response.status_code == 409 and response.json["reason"] == reason
    assert c.db.whatsapp_outbox.count_documents({}) == 0
    email.assert_not_called(); c.http.assert_not_called()
    assert "phone" not in str(response.json).lower()


def test_latest_missing_reference_cannot_fall_back_to_older_event(order_case):
    c = order_case; order = prepare(c)
    c.db.orders.update_one({"_id": order["_id"]}, {"$push": {"timeline": {"status": "cancelled"}}})
    assert retry(c).json["reason"] == "cancellation_reference_missing"


@pytest.mark.parametrize("status", [" Cancelled ", "cancelled"])
def test_canonical_legacy_status_uses_persisted_timeline_only(order_case, status):
    c = order_case; order = prepare(c)
    raw = deepcopy(order); raw.pop("fulfillment"); raw.pop("fulfillmentStatus"); raw["status"] = status
    assert event_values("cancelled", raw)["cancellation_reference"] == order["timeline"][-1]["id"]
    raw.pop("timeline")
    with pytest.raises(ValueError, match="cancellation_reference_missing"):
        event_values("cancelled", raw)


@pytest.mark.parametrize("original_event", ["cancelled", "order_rejected"])
def test_all_channel_retry_does_not_repeat_an_accepted_email(order_case, original_event):
    c = order_case; order = prepare(c, original_event == "order_rejected")
    with c.app.app_context(), patch("app.order_fulfillment.send_html_email", return_value={}) as email:
        send_status_notification(c.db, order, original_event)
        assert email.call_count == 1
        assert retry(c).status_code == 200
        assert retry(c).status_code == 200
        assert email.call_count == 1
    assert c.db.whatsapp_outbox.count_documents({"event": "cancelled"}) == 1


def test_retry_error_never_exposes_arbitrary_exception_text(order_case):
    c = order_case; prepare(c)
    with patch("app.whatsapp_events.event_values", side_effect=ValueError("sensitive fixture detail")):
        response = retry(c)
    assert response.status_code == 409 and response.json["reason"] == "business_event_not_confirmed"
    assert "sensitive" not in str(response.json)


@pytest.mark.parametrize("status", ["confirmed", "processing", "packed", "shipped", "delivered", "refunded"])
def test_newer_canonical_state_beats_stale_top_level_cancelled_badge(order_case, status):
    c = order_case; order = prepare(c, True)
    c.db.orders.update_one({"_id": order["_id"]}, {"$set": {"fulfillment.status": status}})
    response = retry(c, "whatsapp")
    assert response.status_code == 409 and response.json["reason"] == "cancellation_state_not_recorded"
    assert c.db.whatsapp_outbox.count_documents({}) == 0


@pytest.mark.parametrize("channel", ["email", [], {}, False])
def test_unknown_channel_fails_before_any_notification(order_case, channel):
    c = order_case; prepare(c)
    assert retry(c, channel).status_code == 400
    assert c.db.whatsapp_outbox.count_documents({}) == 0


@pytest.mark.parametrize("held", [False, True])
def test_cancellation_retry_cannot_bypass_rejection_email_claim(order_case, held):
    from app.notification_activity import claim_email
    c = order_case; order = prepare(c, True)
    assert claim_email(c.db, order["_id"], "order_rejected", "fulfillment:order_rejected")
    if held:
        c.db.order_notification_activity.update_one({"event": "order_rejected"}, {"$set": {"status": "held"}})
    with patch("app.order_fulfillment.send_html_email") as email:
        assert retry(c).status_code == 200
    email.assert_not_called()
