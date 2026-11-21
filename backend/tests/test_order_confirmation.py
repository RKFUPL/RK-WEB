import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import mongomock
import smtplib

from bson import ObjectId

from app.order_confirmation import confirmation_bcc_recipients, render_order_confirmation, send_order_confirmation


def sample_order():
    return {
        "_id": ObjectId(),
        "orderNumber": "RK-20260820-TEST01",
        "customerName": "Rashi Customer",
        "email": "customer@example.com",
        "phone": "+91 99999 99999",
        "createdAt": datetime(2026, 8, 20, 8, 30, tzinfo=timezone.utc),
        "paymentStatus": "paid",
        "payment": {"status": "paid", "gateway": "razorpay", "razorpayPaymentId": "pay_test"},
        "items": [
            {
                "productId": str(ObjectId()), "productCode": "CK-45", "name": "CK-45",
                "variantId": "colour:ivory", "sku": "AK-CK45-IVORY", "collection": "Anamika", "colour": "IVORY",
                "size": "M", "quantity": 1, "unitPrice": 85000, "lineTotal": 85000,
                "image": "https://res.cloudinary.com/example/image/upload/ck45-ivory.jpg",
            },
            {
                "productId": str(ObjectId()), "productCode": "CK-05", "name": "CK-05",
                "variantId": "colour:berry", "sku": "AK-CK05-BERRY", "collection": "Anamika", "colour": "BERRY",
                "quantity": 1, "unitPrice": 78000, "lineTotal": 78000,
                "image": "https://res.cloudinary.com/example/image/upload/ck05-berry.jpg",
                "purchaseMode": "custom_size",
                "customSize": {"unit": "in", "measurements": {"Bust": "34", "Waist": "28", "Hip": "38", "Shoulder": "14.5"}},
            },
        ],
        "shipping": {
            "fullName": "Rashi Customer", "phone": "+91 99999 99999", "line1": "12 Couture Lane", "line2": "Near Studio",
            "city": "Mumbai", "state": "Maharashtra", "postalCode": "400001", "country": "India",
        },
        "subtotal": 163000,
        "shippingCharge": 0,
        "tax": 0,
        "total": 163000,
        "confirmationEmail": {"status": "pending", "attempts": 0},
    }


def seed_completed_capture(database, order):
    """Give paid-order notification tests authoritative inventory evidence."""
    from app.inventory_operations import capture_operation_id

    capture_id = order["payment"]["razorpayPaymentId"]
    claim_token = "test-capture-claim"
    order["captureFulfillmentStatus"] = "completed"
    order["captureClaimToken"] = claim_token
    order["paymentVerifiedAt"] = datetime.now(timezone.utc)
    order["fulfillment"] = {"status": "confirmed"}
    for index, item in enumerate(order["items"]):
        product_id = ObjectId(item["productId"])
        operation_id = capture_operation_id(order["_id"], capture_id, index)
        quantity = int(item["quantity"])
        database.products.insert_one({
            "_id": product_id,
            "inventoryOperationMarkers": [{
            "operationId": operation_id,
                "orderId": str(order["_id"]),
                "captureId": str(capture_id),
                "itemIndex": index,
                "quantity": quantity,
                "operationType": "capture_deduction",
                "state": "applied",
                "claimToken": claim_token,
                "stockDelta": -quantity,
            }],
        })


class OrderConfirmationTests(unittest.TestCase):
    def test_email_contains_every_variant_measurement_address_and_total(self):
        markup = render_order_confirmation(sample_order())
        for expected in (
            "RK-20260820-TEST01", "AK-CK45-IVORY", "AK-CK05-BERRY", "Anamika", "IVORY", "BERRY",
            "Size: M", "Bust", "34 in", "Waist", "28 in", "Hip", "38 in", "Shoulder", "14.5 in",
            "12 Couture Lane", "Near Studio", "Mumbai", "Maharashtra", "400001", "India", "+91 99999 99999",
            "163,000", "ck45-ivory.jpg", "ck05-berry.jpg",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, markup)

    def test_bcc_uses_active_authorized_staff_and_never_customers(self):
        users = [
            {"email": "admin@example.com", "role": "admin", "isActive": True},
            {"email": "orders@example.com", "role": "staff", "isActive": True, "permissions": ["orders:manage"]},
            {"email": "catalog@example.com", "role": "staff", "isActive": True, "permissions": ["products:manage"]},
            {"email": "inactive@example.com", "role": "admin", "isActive": False},
            {"email": "customer@example.com", "role": "customer", "isActive": True},
        ]
        database = SimpleNamespace(users=SimpleNamespace(find=MagicMock(return_value=users)))
        recipients = confirmation_bcc_recipients(database)
        self.assertIn("operations@chemo.in", recipients)
        self.assertIn("admin@example.com", recipients)
        self.assertIn("orders@example.com", recipients)
        self.assertNotIn("catalog@example.com", recipients)
        self.assertNotIn("inactive@example.com", recipients)
        self.assertNotIn("customer@example.com", recipients)

    def test_provider_receives_customer_to_and_backend_only_bcc(self):
        order = sample_order()
        database = mongomock.MongoClient(tz_aware=True).confirmation_tests
        seed_completed_capture(database, order)
        database.orders.insert_one(order)
        database.users.insert_one({"email": "admin@example.com", "role": "admin", "isActive": True})
        config = {
            "ORDER_CONFIRMATION_BCC": "",
        }
        logger = MagicMock()
        with patch("app.order_confirmation.send_html_email", return_value={"id": "email_123"}) as send:
            self.assertTrue(send_order_confirmation(database, order, config, logger))
        payload = send.call_args.kwargs
        self.assertEqual(payload["recipients"], ["customer@example.com"])
        self.assertEqual(payload["bcc"], ["operations@chemo.in", "admin@example.com"])
        self.assertNotIn("customer@example.com", payload["bcc"])
        self.assertIn("AK-CK45-IVORY", payload["html"])
        saved = database.orders.find_one({"_id": order["_id"]})
        self.assertEqual(saved["confirmationEmail"]["status"], "sent")
        self.assertEqual(saved["confirmationEmail"]["attempts"], 1)

    def test_email_failure_is_retryable_and_does_not_mutate_payment_state(self):
        order = sample_order()
        database = mongomock.MongoClient(tz_aware=True).confirmation_tests
        seed_completed_capture(database, order)
        database.orders.insert_one(order)
        logger = MagicMock()
        with patch("app.order_confirmation.send_html_email", side_effect=smtplib.SMTPAuthenticationError(535, b"isolated rejection")):
            sent = send_order_confirmation(database, order, {
                "ORDER_CONFIRMATION_BCC": "",
            }, logger)
        self.assertFalse(sent)
        saved = database.orders.find_one({"_id": order["_id"]})
        self.assertEqual(saved["confirmationEmail"]["status"], "failed")
        self.assertEqual(saved["paymentStatus"], order["paymentStatus"])
        self.assertEqual(saved["payment"], order["payment"])
        with patch("app.order_confirmation.send_html_email", return_value={}):
            self.assertTrue(send_order_confirmation(database, saved, {}, logger))
        self.assertEqual(database.orders.find_one({"_id": order["_id"]})["confirmationEmail"]["attempts"], 2)


if __name__ == "__main__":
    unittest.main()
