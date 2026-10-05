import unittest
from unittest.mock import MagicMock, patch

from flask import Flask

from app.mail import SENDERS, _security_mode, safe_status, send_otp, send_test_email, test_smtp_connection as check_smtp_connection


class MailProviderSelectionTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(
            MAIL_PROVIDER="zoho",
            ZOHO_SMTP_HOST="smtp.test.invalid",
            ZOHO_SMTP_PORT=587,
            ZOHO_SMTP_SECURITY="starttls",
            ZOHO_SMTP_USERNAME="configured-user",
            ZOHO_SMTP_PASSWORD="configured-password",
            EMAIL_FROM_NAME="Rashi Kapoor",
            EMAIL_FROM="legacy@example.invalid",
            RESEND_API_KEY="configured-resend-key",
        )

    @patch("app.mail._smtp_connection")
    def test_zoho_otp_uses_approved_sender(self, connection_factory):
        connection = MagicMock()
        connection_factory.return_value = connection
        with self.app.app_context():
            send_otp("recipient@example.invalid", "000000")
        message = connection.send_message.call_args.args[0]
        self.assertEqual(message["From"], SENDERS["otp"])
        self.assertEqual(message["From"], "otp@rashikapoorofficial.com")

    @patch("resend.Emails.send")
    def test_resend_is_used_only_when_explicitly_selected(self, resend_send):
        self.app.config["MAIL_PROVIDER"] = "resend"
        with self.app.app_context():
            send_otp("recipient@example.invalid", "000000")
        payload = resend_send.call_args.args[0]
        self.assertIn("legacy@example.invalid", payload["from"])

    @patch("resend.Emails.send")
    def test_zoho_failure_does_not_fall_back_to_resend(self, resend_send):
        with patch("app.mail._smtp_connection", side_effect=RuntimeError("unavailable")):
            with self.app.app_context(), self.assertRaises(RuntimeError):
                send_otp("recipient@example.invalid", "000000")
        resend_send.assert_not_called()

    def test_missing_zoho_configuration_is_safe(self):
        self.app.config["ZOHO_SMTP_PASSWORD"] = ""
        with self.app.app_context(), self.assertRaisesRegex(ValueError, "configuration is incomplete"):
            check_smtp_connection()

    def test_tls_alias_means_starttls_for_zoho_submission(self):
        self.assertEqual(_security_mode("TLS"), "starttls")
        self.assertEqual(_security_mode("STARTTLS"), "starttls")

    @patch("app.mail.smtplib.SMTP_SSL")
    @patch("app.mail.smtplib.SMTP")
    def test_starttls_connection_uses_smtp_and_starttls(self, smtp_factory, smtp_ssl_factory):
        connection = MagicMock()
        smtp_factory.return_value = connection
        with self.app.app_context():
            result = check_smtp_connection()
        self.assertEqual(result["provider"], "Zoho Mail")
        smtp_factory.assert_called_once()
        smtp_ssl_factory.assert_not_called()
        connection.starttls.assert_called_once()
        connection.login.assert_called_once_with("configured-user", "configured-password")

    @patch("app.mail.smtplib.SMTP")
    @patch("app.mail.smtplib.SMTP_SSL")
    def test_ssl_connection_uses_implicit_ssl_without_starttls(self, smtp_ssl_factory, smtp_factory):
        self.app.config.update(
            SMTP_HOST="smtppro.zoho.in",
            SMTP_PORT=465,
            SMTP_SECURE="SSL",
            SMTP_USERNAME="configured-user",
            SMTP_PASSWORD="configured-password",
        )
        connection = MagicMock()
        smtp_ssl_factory.return_value = connection
        with self.app.app_context():
            result = check_smtp_connection()
        self.assertEqual(result["provider"], "Zoho Mail")
        smtp_ssl_factory.assert_called_once()
        smtp_factory.assert_not_called()
        connection.starttls.assert_not_called()
        connection.login.assert_called_once_with("configured-user", "configured-password")

    def test_safe_status_reports_effective_india_ssl_configuration(self):
        self.app.config.update(
            SMTP_HOST="smtppro.zoho.in",
            SMTP_PORT=465,
            SMTP_SECURE="SSL",
            SMTP_USERNAME="rk@rashikapoorofficial.com",
            SMTP_PASSWORD="configured-password",
        )
        with self.app.app_context():
            status = safe_status()
        self.assertEqual(status["provider"], "zoho")
        self.assertEqual(status["smtp"], {"host": "smtppro.zoho.in", "port": 465, "security": "SSL"})
        self.assertTrue(status["username_configured"])
        self.assertTrue(status["password_configured"])
        self.assertNotIn("configured-password", str(status))

    @patch("app.mail.smtplib.SMTP", side_effect=OSError("network unavailable"))
    def test_smtp_connection_failure_is_classified(self, _smtp_factory):
        with self.app.app_context(), self.assertRaisesRegex(RuntimeError, "Unable to reach"):
            check_smtp_connection()

    @patch("app.mail.smtplib.SMTP")
    def test_starttls_failure_is_classified(self, smtp_factory):
        connection = MagicMock()
        connection.starttls.side_effect = __import__("smtplib").SMTPException("tls failed")
        smtp_factory.return_value = connection
        with self.app.app_context(), self.assertRaisesRegex(RuntimeError, "protocol negotiation"):
            check_smtp_connection()

    @patch("app.mail.smtplib.SMTP")
    def test_authentication_failure_is_classified(self, smtp_factory):
        connection = MagicMock()
        connection.login.side_effect = __import__("smtplib").SMTPAuthenticationError(535, b"authentication failed")
        smtp_factory.return_value = connection
        with self.app.app_context(), self.assertRaisesRegex(RuntimeError, "authentication failed"):
            check_smtp_connection()

    @patch("app.mail._smtp_connection")
    def test_sender_rejection_is_classified(self, connection_factory):
        connection = MagicMock()
        connection.send_message.side_effect = __import__("smtplib").SMTPSenderRefused(553, b"sender rejected", "otp@rashikapoorofficial.com")
        connection_factory.return_value = connection
        with self.app.app_context(), self.assertRaisesRegex(RuntimeError, "sender address rejected"):
            send_test_email("recipient@example.invalid", "otp")


if __name__ == "__main__":
    unittest.main()
