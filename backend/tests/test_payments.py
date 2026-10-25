import hashlib
import hmac
import unittest

from app.payments import verify_payment_signature, verify_webhook_signature
from app.blueprints.payments.routes import _display_currency


class PaymentSignatureTests(unittest.TestCase):
    def test_display_currency_is_validated_without_changing_payment_currency(self):
        self.assertEqual(_display_currency("EUR"), "EUR")
        with self.assertRaises(ValueError):
            _display_currency("CAD")

    def test_payment_signature_accepts_the_expected_order_and_payment_pair(self):
        secret = "test_secret"
        message = "order_test|pay_test"
        signature = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
        self.assertTrue(verify_payment_signature("order_test", "pay_test", signature, secret))

    def test_payment_signature_rejects_tampering(self):
        self.assertFalse(verify_payment_signature("order_test", "pay_test", "wrong", "test_secret"))

    def test_webhook_signature_uses_the_raw_body(self):
        secret = "webhook_secret"
        body = b'{"event":"payment.captured"}'
        signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        self.assertTrue(verify_webhook_signature(body, signature, secret))
        self.assertFalse(verify_webhook_signature(body + b" ", signature, secret))


if __name__ == "__main__":
    unittest.main()
