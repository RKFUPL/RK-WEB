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
    }


def _iso(value):
    return value.isoformat() if isinstance(value, datetime) else value


def _require_zoho_provider() -> None:
    if str(current_app.config.get("MAIL_PROVIDER") or "").strip().lower() != "zoho":
        raise RuntimeError("Zoho Mail is not the selected mail provider")


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
    _require_zoho_provider()
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
    _require_zoho_provider()
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


def send_otp(recipient: str, otp: str, purpose: str = "verification") -> None:
    """Send OTP through the selected provider; Resend remains explicit fallback."""
    if current_app.config.get("MAIL_PROVIDER", "resend").lower() != "zoho":
        import resend
        api_key = current_app.config.get("RESEND_API_KEY")
        if not api_key:
            raise RuntimeError("Configured mail provider is unavailable")
        resend.api_key = api_key
        resend.Emails.send({"from": f'{current_app.config["EMAIL_FROM_NAME"]} <{current_app.config["EMAIL_FROM"]}>', "to": [recipient], "subject": f"Your Rashi Kapoor {purpose} code", "html": f"<p>Your one-time verification code is <strong>{otp}</strong>.</p><p>This code expires in 10 minutes.</p>"})
        return
    message = EmailMessage()
    message["From"] = SENDERS["otp"]
    message["To"] = recipient
    message["Subject"] = f"Your Rashi Kapoor {purpose} code"
    message.set_content(f"Your one-time verification code is {otp}. This code expires in 10 minutes.")
    connection = None
    try:
        connection = _smtp_connection()
        connection.send_message(message)
    except (OSError, smtplib.SMTPException) as error:
        raise RuntimeError("OTP email delivery failed") from error
    finally:
        if connection:
            try:
                connection.quit()
            except smtplib.SMTPException:
                pass
