"""Service calls must authorize current persisted state, even without routes."""
from copy import deepcopy
from unittest.mock import patch
from bson import ObjectId
import mongomock
from flask import Flask

from app.order_fulfillment import send_status_notification


def test_direct_status_service_rejects_stale_and_unrecorded_lifecycle():
    db=mongomock.MongoClient().test
    order={"_id":ObjectId(),"paymentGateway":"manual","payment":{"gateway":"manual","status":"pending"},
           "fulfillment":{"status":"order_placed"},"status":"order_placed","email":"synthetic@example.test",
           "total":100,"items":[],"timeline":[]}
    db.orders.insert_one(order)
    stale=deepcopy(order);stale["fulfillment"]["status"]="processing"
    with Flask("notification-lifecycle-test").app_context(),patch("app.order_fulfillment.send_html_email") as smtp,patch("app.order_fulfillment.notify") as whatsapp:
        send_status_notification(db,stale,"processing")
    smtp.assert_not_called();whatsapp.assert_not_called()
    assert not db.order_notification_activity.find_one({"status":"accepted"})


def test_concurrent_lifecycle_change_defeats_email_claim():
    from app.notification_activity import claim_email
    db=mongomock.MongoClient().test
    order={"_id":ObjectId(),"paymentGateway":"manual","fulfillment":{"status":"processing"}}
    db.orders.insert_one(order)
    db.orders.update_one({"_id":order["_id"]},{"$set":{"fulfillment.status":"cancelled"}})
    assert claim_email(db,order["_id"],"processing","fulfillment:processing",snapshot=order) is None
    assert not db.order_notification_activity.find_one()
