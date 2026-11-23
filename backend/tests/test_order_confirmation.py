import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import mongomock
import smtplib

from bson import ObjectId

from app.blueprints.payments.routes import _checkout_items
from app.catalog import public_variant_primary_image
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


def media_product():
    return {
        "_id": ObjectId(), "name": "Two-colour piece", "status": "active", "isActive": True,
        "price": 1200, "sku": "HK-CK184", "productCode": "CK184", "attributes": {"colors": ["RED", "BLUE"]},
        "variants": [
            {"id": "colour:red", "colour": "RED", "sku": "HK-CK184-RED", "status": "active", "images": [], "sizeInventory": []},
            {"id": "colour:blue", "colour": "BLUE", "sku": "HK-CK184-BLUE", "status": "active", "images": [], "sizeInventory": []},
        ],
        "catalogMedia": [
            {"media_id": "red-secondary", "provider": "zoho_workdrive", "variant_id": "colour:red", "permalink": "https://workdrive.zoho.in/file/red-secondary", "position": 0},
            {"media_id": "red-primary", "provider": "zoho_workdrive", "variant_id": "colour:red", "permalink": "https://workdrive.zoho.in/file/red-primary", "position": 1, "is_primary": True},
            {"media_id": "blue-primary", "provider": "cloudinary", "variant_id": "colour:blue", "secure_url": "https://res.cloudinary.com/example/image/upload/blue.jpg", "position": 0, "is_primary": True},
        ],
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
    def test_checkout_snapshots_only_the_selected_public_primary_image(self):
        product = media_product()
        database = mongomock.MongoClient().email_media_tests
        database.products.insert_one(product)
        with patch("app.blueprints.payments.routes.sync_product_variants", return_value=product):
            red, _ = _checkout_items(database, [{"productId": str(product["_id"]), "variantId": "colour:red", "sku": "HK-CK184-RED", "size": "M", "quantity": 1, "image": "https://attacker.example/private.jpg"}])
            blue, _ = _checkout_items(database, [{"productId": str(product["_id"]), "variantId": "colour:blue", "sku": "HK-CK184-BLUE", "size": "M", "quantity": 1}])
        self.assertIn(f"/api/catalog/products/{product['_id']}/media/red-primary?v=", red[0]["image"])
        self.assertTrue(red[0]["image"].startswith("https://rashikapoor.co.in/"))
        self.assertNotIn("red-secondary", red[0]["image"])
        self.assertNotIn("workdrive.zoho.in", red[0]["image"])
        self.assertNotIn("attacker.example", red[0]["image"])
        self.assertEqual(blue[0]["image"], "https://res.cloudinary.com/example/image/upload/blue.jpg")
        self.assertNotIn("blue", red[0]["image"])
        self.assertIn("red-primary", render_order_confirmation({**sample_order(), "items": red}))

    def test_historical_missing_image_uses_only_current_public_matching_variant(self):
        product = media_product()
        database = mongomock.MongoClient().email_media_tests
        database.products.insert_one(product)
        item = {**sample_order()["items"][0], "productId": str(product["_id"]), "variantId": "colour:red", "image": "https://workdrive.zoho.in/file/private"}
        order = {**sample_order(), "items": [item]}
        with patch("app.workdrive.download_file") as download:
            markup = render_order_confirmation(order, database=database)
            download.assert_not_called()
        self.assertIn(f"https://rashikapoor.co.in/api/catalog/products/{product['_id']}/media/red-primary?v=", markup)
        self.assertNotIn("workdrive.zoho.in", markup)
        self.assertNotIn("blue.jpg", markup)
        self.assertIn("width='116' height='150'", markup)
        self.assertIn("rk-item-image", markup)

        for changes in ({"status": "archived"}, {"isActive": False}, {"variants.0.status": "inactive"}):
            database.products.update_one({"_id": product["_id"]}, {"$set": changes})
            hidden = render_order_confirmation(order, database=database)
            self.assertIn("Product image unavailable", hidden)
            self.assertNotIn("red-primary", hidden)
            database.products.replace_one({"_id": product["_id"]}, product)

        item["variantId"] = "colour:missing"
        self.assertIn("Product image unavailable", render_order_confirmation(order, database=database))

    def test_public_image_falls_back_to_shared_parent_only_without_colour_galleries(self):
        product = media_product()
        product["catalogMedia"] = [entry for entry in product["catalogMedia"] if entry["variant_id"] == "colour:red"]
        self.assertEqual(public_variant_primary_image(product, "colour:blue"), "")
        product["catalogMedia"] = []
        product["media"] = ["https://res.cloudinary.com/example/image/upload/shared.jpg"]
        self.assertEqual(public_variant_primary_image(product, "colour:blue"), product["media"][0])

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
