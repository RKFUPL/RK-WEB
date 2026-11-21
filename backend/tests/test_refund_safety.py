"""Financial authority and independent channel outcomes; no live DB/providers."""
from copy import deepcopy
from datetime import datetime, timezone
from unittest.mock import patch
import hashlib
import hmac
import json
import smtplib

import mongomock
import pytest
from bson import ObjectId
from flask import Flask

from app.manual_payments import payment_summary
from app.order_fulfillment import apply_transition, OrderTransitionError, order_view, valid_next_statuses, send_status_notification
from app.refund_evidence import record_provider_refund, verified_refunds
from app.whatsapp_events import event_values
from app.notification_activity import staff_channel_activity
from test_whatsapp_remediation import case
from test_whatsapp_order_mode import order_case


def paid_order():
    return {"_id": ObjectId(), "total": 1000, "amountPaise": 100000, "currency": "INR",
            "paymentGateway": "razorpay", "paymentStatus": "paid", "payment": {"gateway": "razorpay", "status": "paid"},
            "razorpayPaymentId": "pay_fixture", "paymentVerifiedAt": datetime.now(timezone.utc),
            "fulfillment": {"status": "cancelled"}, "status": "cancelled", "timeline": [{"status": "cancelled", "id": "cancel-fixture"}]}


def proof(reference="rfnd_fixture", amount=100000):
    return {"id": reference, "paymentId": "pay_fixture", "amountPaise": amount, "currency": "INR",
            "source": "razorpay_signed_webhook", "status": "processed", "processedAt": datetime.now(timezone.utc)}


@pytest.mark.parametrize("problem", ["unpaid", "no_refund", "unverified", "over_refund", "partial", "manual", "foreign_payment", "duplicate_proof"])
def test_invalid_refund_transition_changes_nothing(problem):
    order = paid_order()
    order["refunds"] = [proof()]
    if problem == "unpaid":
        order.pop("paymentVerifiedAt")
    elif problem == "no_refund":
        order["refunds"] = []
    elif problem == "unverified":
        order["refunds"][0]["source"] = "staff_status_change"
    elif problem == "over_refund":
        order["refunds"][0]["amountPaise"] = 100001
    elif problem == "partial":
        order["refunds"][0]["amountPaise"] = 100
    elif problem == "manual":
        order.update(paymentGateway="manual", paymentTransactions=[])
    elif problem == "foreign_payment":
        order["refunds"][0]["paymentId"] = "pay_unrelated"
    else:
        order["refunds"].append(deepcopy(order["refunds"][0]))
    db = mongomock.MongoClient().test
    db.orders.insert_one(order)
    before = db.orders.find_one()
    with pytest.raises(OrderTransitionError), patch("app.order_fulfillment.send_status_notification") as notification:
        apply_transition(db, order, "refunded", "staff", {"_id": ObjectId()}, {"refunds": [proof()]})
    assert db.orders.find_one() == before
    assert "refunded" not in valid_next_statuses(order)
    notification.assert_not_called()


def test_full_refund_status_update_never_requests_a_refund_message():
    order = paid_order(); order["refunds"] = [proof()]
    db = mongomock.MongoClient().test; db.orders.insert_one(order)
    with patch("app.order_fulfillment.notify") as notify, patch("app.order_fulfillment.send_html_email") as email:
        saved = apply_transition(db, order, "refunded", "staff", {"_id": ObjectId()}, {})
    assert saved["fulfillmentStatus"] == "refunded"
    notify.assert_not_called(); email.assert_not_called()
    assert db.order_notification_activity.count_documents({"status": "skipped", "reason": "refund_status_only"}) == 2


@pytest.mark.parametrize("received,closed,expected", [(0,False,"pending"),(400,False,"partial"),(1000,False,"paid"),(0,True,"pending"),(400,True,"partial"),(1000,True,"paid")])
def test_collection_and_collectible_balance_are_independent(received, closed, expected):
    order = {"total":1000,"paymentGateway":"manual","paymentTransactions":[{"amountPaise":received*100}] if received else [],
             "fulfillment":{"status":"cancelled" if closed else "confirmed"}}
    summary = payment_summary(order)
    assert summary["received"] == received
    assert summary["refunded"] == 0 and summary["status"] == expected
    assert summary["balanceDue"] == 1000-received
    assert summary["collectibleBalance"] == (0 if closed else 1000-received)


def test_bad_historical_refunded_label_does_not_create_money():
    order = {"_id":ObjectId(),"total":188004,"paymentGateway":"manual","paymentStatus":"refunded","paymentTransactions":[],"fulfillment":{"status":"refunded"}}
    view = order_view(order)
    assert view["fulfillmentStatus"] == "refunded"
    assert view["paymentStatus"] == "pending"
    assert view["paymentCollection"]["received"] == view["paymentCollection"]["refunded"] == 0
    assert view["paymentCollection"]["collectibleBalance"] == 0
    assert order_view(order, include_private_payment=True)["paymentCollection"]["evidenceIssue"] == "refund_evidence_missing"


def test_partial_full_and_duplicate_provider_refunds_preserve_totals():
    db = mongomock.MongoClient().test; order=paid_order(); db.orders.insert_one(order)
    first, saved_proof=record_provider_refund(db,order,proof("refund-a",40000))
    summary=payment_summary(first)
    assert summary["status"] == "partially_refunded" and summary["refunded"] == 400 and summary["received"] == 1000
    duplicate, _=record_provider_refund(db,first,proof("refund-a",40000))
    assert duplicate == first and len(duplicate["refunds"]) == 1
    with pytest.raises(ValueError):record_provider_refund(db,first,proof("refund-a",30000))
    with pytest.raises(ValueError):record_provider_refund(db,first,proof("refund-b",60001))
    final, _=record_provider_refund(db,first,proof("refund-b",60000))
    summary=payment_summary(final)
    assert summary["status"] == "refunded" and summary["refunded"] == 1000 and summary["netReceived"] == 0


def test_concurrent_refunds_cannot_spend_the_same_remaining_amount():
    db=mongomock.MongoClient().test;order=paid_order();db.orders.insert_one(order)
    real=db.orders.find_one_and_update;interleaved=False
    def race(query,update,**kwargs):
        nonlocal interleaved
        if not interleaved:
            interleaved=True
            record_provider_refund(db,order,proof("concurrent-refund",60000))
        return real(query,update,**kwargs)
    with patch.object(db.orders,"find_one_and_update",side_effect=race), pytest.raises(ValueError, match="exceed"):
        record_provider_refund(db,order,proof("original-refund",60000))
    assert len(db.orders.find_one()["refunds"]) == 1


@pytest.mark.parametrize("problem",["unpaid","not_refunded","unverified"])
def test_refund_business_contract_rejects_status_only_evidence(problem):
    order=paid_order();p=proof();order.update(refunds=[p],whatsappRefund=p)
    if problem=="unpaid":order.pop("paymentVerifiedAt")
    elif problem=="not_refunded":order.update(refunds=[],whatsappRefund={})
    else:p["source"]="manual_admin_action"
    with pytest.raises(ValueError):event_values("refund_completed",order)


def test_valid_persisted_refund_contract_uses_saved_amount():
    order=paid_order();p=proof(amount=40000);order.update(refunds=[p],whatsappRefund=p)
    values=event_values("refund_completed",order)
    assert values["refund_amount"] == "INR 400.00" and values["refund_reference"] == p["id"]


@pytest.mark.parametrize("problem",[None,"disabled","mismatch","consent"])
def test_rejection_outcomes_and_email_are_independent(order_case,problem):
    c=order_case
    c.app.config["WHATSAPP_TEMPLATES"]["order_rejected"]["enabled"] = problem != "disabled"
    order={**c.order,"paymentGateway":"manual","paymentTransactions":[],"fulfillment":{"status":"order_placed"}}
    if problem=="consent":order["whatsappConsent"]={**order["whatsappConsent"],"enabled":False}
    if problem=="mismatch":
        c.db.whatsapp_template_status.update_one({"_id":"rk_order_status_update:en_US"},{"$set":{"componentSignature":"wrong"}})
    c.db.orders.replace_one({"_id":order["_id"]},order)
    with c.app.app_context(), patch("app.order_fulfillment.send_html_email",side_effect=smtplib.SMTPAuthenticationError(535,b"private-server-details")):
        apply_transition(c.db,order,"cancelled","staff",c.admin,{"rejectionReason":"requested_size_unavailable"})
    assert c.db.order_notification_activity.find_one({"channel":"email"})["reason"] == "smtp_authentication_failed"
    assert "private-server-details" not in str(list(c.db.order_notification_activity.find()))
    if problem:
        assert c.db.whatsapp_outbox.count_documents({}) == 0
    else:
        assert c.db.whatsapp_outbox.count_documents({"event":"order_rejected"}) == 1
        from app.whatsapp import process_outbox
        assert process_outbox(c.db,c.app.config)==1
        assert c.http.call_count==1
    from app.whatsapp_orders import order_whatsapp_activity
    saved=c.db.orders.find_one({"_id":order["_id"]})
    activity=staff_channel_activity(c.db,saved,order_whatsapp_activity(c.db,c.app.config,saved))
    assert next(a for a in activity if a["channel"]=="email")["status"]=="failed"
    assert next(a for a in activity if a["channel"]=="whatsapp")["status"] == ("accepted" if problem is None else "skipped")


def test_signed_webhook_is_required_and_duplicate_events_do_not_repeat(order_case):
    c=order_case
    from app.blueprints.payments.routes import razorpay_webhook_bp
    c.app.register_blueprint(razorpay_webhook_bp,url_prefix="/api/webhooks")
    c.app.config["RAZORPAY_WEBHOOK_SECRET"]="isolated-webhook-secret"
    c.app.config["WHATSAPP_TEMPLATES"]["refund_completed"]["enabled"]=True
    def post(event,amount,signature=True):
        raw=json.dumps({"id":event,"event":"refund.processed","payload":{"refund":{"entity":{"id":"rfnd-isolated","payment_id":c.order["razorpayPaymentId"],"status":"processed","amount":amount,"currency":"INR"}}}}).encode()
        sig=hmac.new(b"isolated-webhook-secret",raw,hashlib.sha256).hexdigest() if signature else "invalid"
        with patch("app.blueprints.payments.routes.database",return_value=c.db),patch("app.order_fulfillment.send_html_email",return_value={}) as email:
            result=c.client.post("/api/webhooks/razorpay",data=raw,headers={"X-Razorpay-Signature":sig},content_type="application/json")
        return result,email
    assert post("invalid-sig",100,False)[0].status_code==400
    assert c.db.orders.find_one({"_id":c.order["_id"]}).get("refunds") is None
    first,email=post("valid-first",100)
    assert first.json["handled"] is True
    email.assert_called_once()
    assert post("valid-first",100)[0].json["duplicate"] is True
    assert post("same-ref-new-event",100)[0].json["handled"] is True
    assert len(c.db.orders.find_one({"_id":c.order["_id"]})["refunds"])==1
    assert c.db.whatsapp_outbox.count_documents({"event":"refund_completed"})==1
    assert post("changed-ref-content",101)[0].json["handled"] is False


@pytest.mark.parametrize("state", ["queued", "sending", "accepted", "sent", "delivered", "failed", "held"])
def test_channel_projection_retains_distinct_delivery_states(state):
    db=mongomock.MongoClient().test;order=paid_order()
    whatsapp={"activity":[{"event":"order_rejected","status":state,"reason":None}]}
    rows=staff_channel_activity(db,order,whatsapp)
    assert rows[0]["status"] == state and rows[0]["channel"] == "whatsapp"
    assert "recipient" not in rows[0] and "providerId" not in rows[0]


def test_customer_view_excludes_channel_failure_details():
    order=paid_order()
    order["timeline"]=[{"status":"cancelled","notifyCustomer":True,"notificationOutcomes":[{"channel":"email","reason":"smtp_authentication_failed"}],"internalNote":"staff-only"}]
    order["confirmationEmail"]={"status":"failed","error":"private-provider-response","providerId":"private-reference"}
    view=order_view(order)
    assert "notificationOutcomes" not in view["timeline"][0]
    assert "notificationLog" not in view and "notificationActivity" not in view
    assert "private-provider-response" not in str(view) and "private-reference" not in str(view)


def test_ambiguous_smtp_submission_is_held_and_never_automatically_retried(order_case):
    c=order_case
    c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": {"fulfillment.status": "packed"}})
    from app.mail import EmailDeliveryUnknown
    order=c.order
    with c.app.app_context(),patch("app.order_fulfillment.send_html_email",side_effect=EmailDeliveryUnknown("private SMTP result")) as email:
        send_status_notification(c.db,order,"packed")
        send_status_notification(c.db,order,"packed")
    assert email.call_count==1
    saved=c.db.order_notification_activity.find_one({"channel":"email"})
    assert saved["status"]=="held" and saved["reason"]=="smtp_submission_unknown"
    assert [entry["status"] for entry in saved["history"]]==["requested","sending","held"]


def test_refund_transition_is_fenced_against_evidence_removed_concurrently():
    db=mongomock.MongoClient().test;order=paid_order();order["refunds"]=[proof()];db.orders.insert_one(order)
    real=db.orders.find_one_and_update
    def remove_proof(query,update,**kwargs):
        db.orders.update_one({"_id":order["_id"]},{"$set":{"refunds":[]}})
        return real(query,update,**kwargs)
    from app.order_fulfillment import OrderTransitionConflict
    with patch.object(db.orders,"find_one_and_update",side_effect=remove_proof),pytest.raises(OrderTransitionConflict):
        apply_transition(db,order,"refunded","staff",{"_id":ObjectId()},{})
    assert db.orders.find_one()["fulfillment"]["status"]=="cancelled"


def test_database_failure_after_smtp_acceptance_does_not_release_email_claim(order_case):
    c=order_case;real=c.db.orders.update_one
    c.db.orders.update_one({"_id": c.order["_id"]}, {"$set": {"fulfillment.status": "packed"}})
    from pymongo.errors import AutoReconnect
    def fail_confirmation(query,update,**kwargs):
        if update.get("$push",{}).get("notificationLog",{}).get("status")=="sent":
            raise AutoReconnect("isolated lost database acknowledgement")
        return real(query,update,**kwargs)
    with c.app.app_context(),patch.object(c.db.orders,"update_one",side_effect=fail_confirmation),patch("app.order_fulfillment.send_html_email",return_value={}) as email:
        with pytest.raises(AutoReconnect):send_status_notification(c.db,c.order,"packed")
        send_status_notification(c.db,c.order,"packed")
    assert email.call_count==1
    assert "fulfillment:packed" in c.db.orders.find_one({"_id":c.order["_id"]})["notificationKeys"]


def test_closed_unpaid_order_is_not_overdue_collectible_debt():
    order={"total":1000,"paymentGateway":"manual","paymentTransactions":[],"paymentDueAt":datetime(2020,1,1,tzinfo=timezone.utc),"fulfillment":{"status":"cancelled"}}
    summary=payment_summary(order)
    assert summary["status"]=="pending" and summary["collectibleBalance"]==0 and summary["received"]==0


def test_staff_endpoint_cannot_bypass_evidence_or_normalize_invalid_order_first(order_case):
    c=order_case
    from app.blueprints.orders.routes import staff_orders_bp
    c.app.register_blueprint(staff_orders_bp,url_prefix="/api/staff/orders")
    legacy={"_id":ObjectId(),"status":"cancelled","total":1000,"paymentStatus":"pending","paymentGateway":"manual","paymentTransactions":[]}
    c.db.orders.insert_one(legacy)
    before=c.db.orders.find_one({"_id":legacy["_id"]})
    with patch("app.blueprints.orders.routes.database",return_value=c.db),patch("app.blueprints.orders.routes.current_user",return_value=c.admin):
        response=c.client.patch(f"/api/staff/orders/{legacy['_id']}/fulfillment",headers=c.headers,json={"status":"refunded","refunds":[proof()],"paymentStatus":"paid"})
    assert response.status_code==400
    assert c.db.orders.find_one({"_id":legacy["_id"]})==before
    assert c.db.whatsapp_outbox.count_documents({})==0
