import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

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
        orders = SimpleNamespace(
            update_one=MagicMock(return_value=SimpleNamespace(modified_count=1)),
            find_one=MagicMock(return_value={"confirmationEmail": {"status": "sent"}}),
        )
        users = SimpleNamespace(find=MagicMock(return_value=[{"email": "admin@example.com", "role": "admin", "isActive": True}]))
        database = SimpleNamespace(orders=orders, users=users)
        config = {
            "RESEND_API_KEY": "re_test",
            "EMAIL_FROM_NAME": "Rashi Kapoor",
            "EMAIL_FROM": "orders@example.com",
            "ORDER_CONFIRMATION_BCC": "",
        }
        logger = MagicMock()
        with patch("app.order_confirmation.resend.Emails.send", return_value={"id": "email_123"}) as send:
            self.assertTrue(send_order_confirmation(database, order, config, logger))
        payload = send.call_args.args[0]
        self.assertEqual(payload["to"], ["customer@example.com"])
        self.assertEqual(payload["bcc"], ["operations@chemo.in", "admin@example.com"])
        self.assertNotIn("customer@example.com", payload["bcc"])
        self.assertIn("AK-CK45-IVORY", payload["html"])
        self.assertEqual(orders.update_one.call_count, 2)

    def test_email_failure_is_retryable_and_does_not_mutate_payment_state(self):
        order = sample_order()
        orders = SimpleNamespace(
            update_one=MagicMock(return_value=SimpleNamespace(modified_count=1)),
            find_one=MagicMock(return_value={"confirmationEmail": {"status": "failed"}}),
        )
        database = SimpleNamespace(orders=orders, users=SimpleNamespace(find=MagicMock(return_value=[])))
        logger = MagicMock()
        with patch("app.order_confirmation.resend.Emails.send", side_effect=RuntimeError("temporary outage")):
            sent = send_order_confirmation(database, order, {
                "RESEND_API_KEY": "re_test", "EMAIL_FROM_NAME": "Rashi Kapoor", "EMAIL_FROM": "orders@example.com", "ORDER_CONFIRMATION_BCC": "",
            }, logger)
        self.assertFalse(sent)
        failure_update = orders.update_one.call_args_list[-1].args[1]
        self.assertEqual(failure_update["$set"]["confirmationEmail.status"], "failed")
        self.assertNotIn("paymentStatus", failure_update["$set"])


if __name__ == "__main__":
    unittest.main()
