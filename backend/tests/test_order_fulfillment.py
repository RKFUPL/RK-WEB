from datetime import datetime, timezone
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from bson import ObjectId
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from app.blueprints.orders.routes import customer_orders_bp, staff_orders_bp
from app.order_fulfillment import (
    OrderTransitionError,
    canonical_payment_status,
    normalisation_updates,
    order_view,
    shipment_fields,
    valid_next_statuses,
    validate_transition,
)


class TrackingOrders:
    def __init__(self):
        self.query = None

    def find_one(self, query):
        self.query = query
        return None


class OrderFulfillmentTests(unittest.TestCase):
    def test_existing_paid_order_without_fulfillment_migrates_to_confirmed(self):
        now = datetime(2026, 8, 17, tzinfo=timezone.utc)
        updates = normalisation_updates({
            "_id": ObjectId(), "paymentStatus": "paid", "status": "confirmed", "createdAt": now, "paymentVerifiedAt": now,
        })
        self.assertEqual(updates["payment"]["status"], "paid")
        self.assertEqual(updates["fulfillment"]["status"], "confirmed")
        self.assertEqual([event["status"] for event in updates["timeline"]], ["order_placed", "payment_confirmed", "confirmed"])

    def test_existing_shipment_fields_are_preserved(self):
        updates = normalisation_updates({
            "_id": ObjectId(), "paymentStatus": "paid", "status": "shipped", "courier": "Courier One", "trackingNumber": "TRACK-123", "trackingUrl": "https://courier.example/track/TRACK-123",
        })
        self.assertEqual(updates["fulfillment"]["courier"], "Courier One")
        self.assertEqual(updates["fulfillment"]["trackingNumber"], "TRACK-123")

    def test_invalid_transition_is_rejected(self):
        order = {"status": "processing", "paymentStatus": "paid"}
        with self.assertRaises(OrderTransitionError):
            validate_transition(order, "delivered")
        self.assertEqual(validate_transition(order, "packed"), ("processing", "packed"))

    def test_unpaid_order_cannot_be_confirmed(self):
        order = {"status": "order_placed", "paymentStatus": "pending"}
        with self.assertRaises(OrderTransitionError):
            validate_transition(order, "confirmed")
        self.assertEqual(valid_next_statuses(order), ["cancelled"])

    def test_shipment_requires_courier_and_tracking_number(self):
        with self.assertRaises(OrderTransitionError):
            shipment_fields({"courier": "Courier One"})
        shipment = shipment_fields({"courier": "Courier One", "trackingNumber": "TRACK-123", "trackingUrl": "https://courier.example/track/TRACK-123"})
        self.assertEqual(shipment["trackingNumber"], "TRACK-123")
        with self.assertRaises(OrderTransitionError):
            shipment_fields({"courier": "Courier One", "trackingNumber": "TRACK-123", "trackingUrl": "javascript:alert(1)"})

    def test_customer_order_view_hides_private_gateway_ids(self):
        order = {
            "_id": ObjectId(), "orderNumber": "RK-1", "items": [], "total": 100, "createdAt": datetime.now(timezone.utc),
            "paymentStatus": "paid", "razorpayOrderId": "order_secret", "razorpayPaymentId": "pay_secret", "status": "confirmed", "timeline": [],
        }
        customer = order_view(order)
        staff = order_view(order, include_private_payment=True)
        self.assertNotIn("razorpayOrderId", customer["payment"])
        self.assertEqual(staff["payment"]["razorpayOrderId"], "order_secret")
        self.assertEqual(canonical_payment_status(order), "paid")


class CustomerOrderAuthorizationTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.config.update(TESTING=True, JWT_SECRET_KEY="test-secret-key-that-is-at-least-32-bytes")
        JWTManager(app)
        app.register_blueprint(customer_orders_bp, url_prefix="/api/orders")
        app.register_blueprint(staff_orders_bp, url_prefix="/api/staff/orders")
        self.customer_id = ObjectId()
        with app.app_context():
            token = create_access_token(identity=str(self.customer_id))
        self.client = app.test_client()
        self.headers = {"Authorization": f"Bearer {token}"}

    def test_customer_detail_query_is_always_scoped_to_current_customer(self):
        tracking_orders = TrackingOrders()
        customer = {"_id": self.customer_id, "role": "customer", "isActive": True}
        order_id = ObjectId()
        database = SimpleNamespace(orders=tracking_orders)
        with patch("app.rbac.current_user", return_value=customer), patch("app.blueprints.orders.routes.database", return_value=database), patch("app.blueprints.orders.routes._prepare"):
            response = self.client.get(f"/api/orders/{order_id}", headers=self.headers)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(tracking_orders.query, {"_id": order_id, "customerId": self.customer_id})

    def test_staff_without_orders_permission_cannot_use_shipment_api(self):
        staff = {"_id": ObjectId(), "role": "staff", "isActive": True, "permissions": []}
        with patch("app.rbac.current_user", return_value=staff):
            response = self.client.get("/api/staff/orders", headers=self.headers)
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
