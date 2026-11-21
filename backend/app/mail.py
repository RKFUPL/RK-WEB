"""Centralized, redacted mail-provider primitives.

Credentials are deliberately read from backend environment configuration only;
this module never returns or logs secret values.
"""
import smtplib
import ssl
import re
from email.message import EmailMessage
from datetime import datetime, timezone

from flask import current_app


SENDERS = {
    "otp": "otp@rashikapoorofficial.com",
    "orders": "orders@rashikapoorofficial.com",
    "logistics": "logistics@rashikapoorofficial.com",
}

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class EmailDeliveryUnknown(RuntimeError):
    """Submission began, but its outcome cannot be safely retried automatically."""


class EmailPartialSubmission(EmailDeliveryUnknown):
    def __init__(self, submission):
        super().__init__("SMTP partially submitted; customer recipient refused")
        self.submission = submission


def _security_mode(value: object) -> str:
    normalized = str(value or "starttls").strip().lower()
    if normalized in {"ssl", "smtps", "ssl/tls"}:
        return "ssl"
    if normalized in {"starttls", "tls", "ttl", "true"}:
        return "starttls"
    raise ValueError("Invalid SMTP security configuration")


def _configured() -> dict:
    host = current_app.config.get("SMTP_HOST") or current_app.config.get("ZOHO_SMTP_HOST", "smtppro.zoho.com")
    port = current_app.config.get("SMTP_PORT") or current_app.config.get("ZOHO_SMTP_PORT", 587)
    security = current_app.config.get("SMTP_SECURE") or current_app.config.get("ZOHO_SMTP_SECURITY", "starttls")
    username = current_app.config.get("SMTP_USERNAME") or current_app.config.get("ZOHO_SMTP_USERNAME")
    password = current_app.config.get("SMTP_PASSWORD") or current_app.config.get("ZOHO_SMTP_PASSWORD")
    return {
        "provider": "Zoho Mail",
        "mailbox": current_app.config.get("ZOHO_MAILBOX", "rk@rashikapoorofficial.com"),
        "smtpHost": host,
        "smtpPort": int(port),
        "security": _security_mode(security),
        "usernameConfigured": bool(username),
        "passwordConfigured": bool(password),
        "oauthClientConfigured": bool(current_app.config.get("ZOHO_CLIENT_ID") and current_app.config.get("ZOHO_CLIENT_SECRET")),
        "oauthRefreshConfigured": bool(current_app.config.get("ZOHO_REFRESH_TOKEN")),
    }


def validate_recipient(value: object) -> str:
    recipient = str(value or "").strip()
    if len(recipient) > 254 or not EMAIL_PATTERN.fullmatch(recipient):
        raise ValueError("A valid recipient email is required.")
    return recipient


def safe_status(stored: dict | None = None) -> dict:
    stored = stored or {}
    config = _configured()
    status = str(stored.get("status") or stored.get("state") or "not_connected").lower().replace(" ", "_")
    status = {"connection_error": "error", "ready_to_connect": "not_connected", "configuration_incomplete": "not_connected"}.get(status, status)
    if status not in {"connected", "not_connected", "disconnected", "error"}:
        status = "not_connected"
    return {
        "provider": "zoho",
        "provider_name": config["provider"],
        "status": status,
        "smtp": {"host": config["smtpHost"], "port": config["smtpPort"], "security": config["security"].upper()},
        "mailbox": config["mailbox"],
        "senders": dict(SENDERS),
        "username_configured": config["usernameConfigured"],
        "password_configured": config["passwordConfigured"],
        "connected_at": _iso(stored.get("connected_at") or stored.get("connectedAt")),
        "verified_at": _iso(stored.get("verified_at") or stored.get("lastTested")),
        "last_test_at": _iso(stored.get("last_test_at") or stored.get("lastTested")),
        "last_error": stored.get("last_error") or stored.get("lastError"),
        "transport": "smtp",
        "verification_scope": "SMTP authentication only; this does not confirm message submission or delivery.",
        "oauth_used_for_delivery": False,
        "last_submission": {k: _iso((stored.get("last_submission") or {}).get(k)) for k in ("status", "reason", "timestamp")},
        "smtp_authentication_next_action": "Check the backend SMTP username and Zoho app password, mailbox access and configured Zoho region. OAuth connection state does not authenticate SMTP.",
    }


def _iso(value):
    return value.isoformat() if isinstance(value, datetime) else value


def _smtp_diagnostic(stage: str, outcome: str, config: dict, error=None) -> None:
    """Emit only non-secret SMTP troubleshooting metadata."""
    smtp_code = getattr(error, "smtp_code", None) if error else None
    current_app.logger.warning(
        "[ZOHO_SMTP_CONNECT] stage=%s outcome=%s provider=%s host_configured=%s port=%s security=%s username_configured=%s password_configured=%s password_length=%s exception_class=%s smtp_code=%s",
        stage,
        outcome,
        config["provider"],
        bool(config["smtpHost"]),
        config["smtpPort"],
        config["security"].upper(),
        config["usernameConfigured"],
        config["passwordConfigured"],
        len(current_app.config.get("SMTP_PASSWORD") or current_app.config.get("ZOHO_SMTP_PASSWORD") or ""),
        type(error).__name__ if error else None,
        smtp_code,
    )


def test_smtp_connection() -> dict:
    config = _configured()
    host, port = config["smtpHost"], config["smtpPort"]
    username = current_app.config.get("SMTP_USERNAME") or current_app.config.get("ZOHO_SMTP_USERNAME")
    password = current_app.config.get("SMTP_PASSWORD") or current_app.config.get("ZOHO_SMTP_PASSWORD")
    if not username or not password:
        raise ValueError("SMTP configuration is incomplete")
    connection = None
    stage = "DNS/connect"
    try:
        if config["security"] == "ssl":
            connection = smtplib.SMTP_SSL(host, port, timeout=10, context=ssl.create_default_context())
        else:
            connection = smtplib.SMTP(host, port, timeout=10)
            stage = "STARTTLS"
            connection.ehlo()
            connection.starttls(context=ssl.create_default_context())
            connection.ehlo()
        stage = "authentication"
        try:
            connection.login(username, password)
        finally:
            connection.quit()
    except smtplib.SMTPAuthenticationError as error:
        _smtp_diagnostic(stage, "failed", config, error)
        raise RuntimeError("Zoho Mail SMTP authentication failed") from error
    except smtplib.SMTPException as error:
        _smtp_diagnostic(stage, "failed", config, error)
        raise RuntimeError("Zoho Mail SMTP protocol negotiation failed") from error
    except OSError as error:
        _smtp_diagnostic(stage, "failed", config, error)
        raise RuntimeError("Unable to reach the Zoho Mail SMTP server") from error
    _smtp_diagnostic("authentication", "succeeded", config)
    return {"provider": "Zoho Mail", "mailbox": config["mailbox"], "testedAt": datetime.now(timezone.utc).isoformat()}


def _smtp_connection():
    config = _configured()
    if config["security"] == "ssl":
        connection = smtplib.SMTP_SSL(config["smtpHost"], config["smtpPort"], timeout=10, context=ssl.create_default_context())
    else:
        connection = smtplib.SMTP(config["smtpHost"], config["smtpPort"], timeout=10)
        connection.ehlo()
        connection.starttls(context=ssl.create_default_context())
        connection.ehlo()
    username = current_app.config.get("SMTP_USERNAME") or current_app.config.get("ZOHO_SMTP_USERNAME")
    password = current_app.config.get("SMTP_PASSWORD") or current_app.config.get("ZOHO_SMTP_PASSWORD")
    connection.login(username, password)
    return connection


def send_test_email(recipient: str, sender_key: str) -> dict:
    if sender_key not in SENDERS:
        raise ValueError("Unapproved sender identity")
    recipient = validate_recipient(recipient)
    message = EmailMessage()
    message["From"] = SENDERS[sender_key]
    message["To"] = recipient
    message["Subject"] = "Rashi Kapoor Zoho Mail integration test"
    message.set_content("This is a test message from the RK-WEB Zoho Mail integration.")
    connection = None
    try:
        connection = _smtp_connection()
        connection.send_message(message)
    except smtplib.SMTPSenderRefused as error:
        raise RuntimeError("SMTP sender address rejected") from error
    except smtplib.SMTPRecipientsRefused as error:
        raise RuntimeError("SMTP recipient address rejected") from error
    except smtplib.SMTPAuthenticationError as error:
        raise RuntimeError("Zoho Mail SMTP authentication failed") from error
    except smtplib.SMTPException as error:
        raise RuntimeError("SMTP test message failed") from error
    except OSError as error:
        raise RuntimeError("Unable to reach the Zoho Mail SMTP server") from error
    finally:
        if connection:
            try:
                connection.quit()
            except smtplib.SMTPException:
                pass
    return {"provider": "Zoho Mail", "sender": SENDERS[sender_key], "sentAt": datetime.now(timezone.utc).isoformat()}


def send_html_email(
    *,
    sender: str,
    recipients: list[str] | tuple[str, ...],
    subject: str,
    html: str,
    bcc: list[str] | tuple[str, ...] | None = None,
    reply_to: list[str] | tuple[str, ...] | None = None,
    text: str | None = None,
    attachments: list[tuple[str, bytes, str]] | None = None,
) -> dict:
    """Send an application email through the configured Zoho SMTP mailbox."""
    to = [validate_recipient(value) for value in recipients if str(value or "").strip()]
    if not to:
        raise ValueError("At least one recipient email is required.")
    message = EmailMessage()
    message["From"] = sender
    message["To"] = ", ".join(to)
    other = []
    if bcc:
        other = [validate_recipient(value) for value in bcc if str(value or "").strip()]
        message["Bcc"] = ", ".join(other)
    if reply_to:
        message["Reply-To"] = ", ".join(validate_recipient(value) for value in reply_to if str(value or "").strip())
    message["Subject"] = subject
    message.set_content(text or "This message contains HTML content.")
    message.add_alternative(html, subtype="html")
    for filename, content, content_type in attachments or []:
        maintype, subtype = content_type.split("/", 1)
        message.add_attachment(content, maintype=maintype, subtype=subtype, filename=filename)
    connection = None
    submission_started = False
    try:
        connection = _smtp_connection()
        submission_started = True
        refusals = connection.send_message(message)
        refused = {str(value).casefold() for value in refusals} if isinstance(refusals, dict) else set()
        customers = {value.casefold() for value in to}
        others = {value.casefold() for value in other} - customers
        submission = {"customerAccepted": len(customers - refused), "customerRefused": len(customers & refused),
                      "otherAccepted": len(others - refused), "otherRefused": len(others & refused)}
        if submission["customerRefused"]:
            if submission["customerAccepted"] or submission["otherAccepted"]:
                raise EmailPartialSubmission(submission)
            raise RuntimeError("SMTP recipient address rejected")
    except smtplib.SMTPSenderRefused as error:
        raise RuntimeError("SMTP sender address rejected") from error
    except smtplib.SMTPRecipientsRefused as error:
        raise RuntimeError("SMTP recipient address rejected") from error
    except smtplib.SMTPAuthenticationError as error:
        raise RuntimeError("Zoho Mail SMTP authentication failed") from error
    except smtplib.SMTPServerDisconnected as error:
        if submission_started:
            raise EmailDeliveryUnknown("SMTP submission outcome requires reconciliation") from error
        raise RuntimeError("Unable to reach the Zoho Mail SMTP server") from error
    except smtplib.SMTPDataError as error:
        raise RuntimeError("SMTP data rejected") from error
    except smtplib.SMTPException as error:
        raise RuntimeError("Zoho Mail message delivery failed") from error
    except OSError as error:
        if submission_started:
            raise EmailDeliveryUnknown("SMTP submission outcome requires reconciliation") from error
        raise RuntimeError("Unable to reach the Zoho Mail SMTP server") from error
    finally:
        if connection:
            try:
                connection.quit()
            except (smtplib.SMTPException, OSError):
                # QUIT failure cannot undo a completed DATA acknowledgement.
                pass
    return {"provider": "Zoho Mail", "id": message.get("Message-ID", ""), "submission": submission,
            "reason": "smtp_other_recipient_refused" if submission["otherRefused"] else None}


def send_otp(recipient: str, otp: str, purpose: str = "verification") -> None:
    send_html_email(
        sender=SENDERS["otp"],
        recipients=[recipient],
        subject=f"Your Rashi Kapoor {purpose} code",
        html=f"<p>Your one-time verification code is <strong>{otp}</strong>.</p><p>This code expires in 10 minutes.</p>",
        text=f"Your one-time verification code is {otp}. This code expires in 10 minutes.",
    )
