import json
import os
from datetime import timedelta
from urllib.parse import unquote, urlsplit


def validate_database_maintenance_target(config, expected_database):
    """Fail closed unless the explicit target agrees with config and URI path."""
    configured = str(config.get("MONGO_DBNAME") or "").strip()
    expected = str(expected_database or "").strip()
    uri = str(config.get("MONGO_URI") or "").strip()
    if not expected or expected != configured:
        raise RuntimeError("Database maintenance target does not match the configured database")
    parsed = urlsplit(uri)
    if parsed.scheme not in {"mongodb", "mongodb+srv"} or not parsed.netloc:
        raise RuntimeError("MongoDB configuration is invalid for database maintenance")
    uri_database = unquote(parsed.path.lstrip("/"))
    if uri_database and uri_database != configured:
        raise RuntimeError("MongoDB URI database does not match the configured maintenance target")
    return configured


class BaseConfig:
    SECRET_KEY = os.getenv("SECRET_KEY", "change-me")
    MONGO_URI = os.getenv("MONGO_DB", os.getenv("MONGO_URI", "mongodb://localhost:27017/rashi_kapoor"))
    MONGO_DBNAME = os.getenv("DB_NAME", "rashi_kapoor")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-me-too")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(days=30)
    JWT_COOKIE_SECURE = True
    JWT_COOKIE_SAMESITE = "Lax"
    JWT_TOKEN_LOCATION = ["cookies", "headers"]
    EMAIL_FROM = os.getenv("EMAIL_FROM", "noreply@rashikapoor.com")
    EMAIL_FROM_NAME = os.getenv("EMAIL_FROM_NAME", "Rashi Kapoor")
    RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
    MAIL_PROVIDER = os.getenv("MAIL_PROVIDER", "resend").strip().lower()
    ORDER_CONFIRMATION_BCC = os.getenv("ORDER_CONFIRMATION_BCC", "")
    FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
    FRONTEND_URLS = os.getenv("FRONTEND_URLS", "")
    RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
    RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
    RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
    RAZORPAY_MODE = os.getenv("RAZORPAY_MODE", "test").strip().lower() or "test"
    try:
        PUBLIC_FX_RATES = json.loads(os.getenv("PUBLIC_FX_RATES", "{}"))
    except json.JSONDecodeError:
        PUBLIC_FX_RATES = {}
    FX_PROVIDER_URL = os.getenv("FX_PROVIDER_URL", "https://open.er-api.com/v6/latest/INR").strip()
    FX_CACHE_TTL_SECONDS = int(os.getenv("FX_CACHE_TTL_SECONDS", "21600"))
    TWELVE_DATA_API_KEY = os.getenv("TWELVE_DATA_API_KEY", "").strip()
    TWELVE_DATA_COMMERCIAL_USE_APPROVED = os.getenv("TWELVE_DATA_COMMERCIAL_USE_APPROVED", "false").strip().lower() == "true"
    RATELIMIT_DEFAULT = "200 per hour"
    RATELIMIT_STORAGE_URI = os.getenv("RATELIMIT_STORAGE_URI", "memory://")
    AUTH_SESSION_DAYS = int(os.getenv("AUTH_SESSION_DAYS", "30"))
    SHARED_SESSION_COOKIE_NAME = os.getenv("SHARED_SESSION_COOKIE_NAME", "rk_shared_session")
    SHARED_SESSION_COOKIE_DOMAIN = os.getenv("SHARED_SESSION_COOKIE_DOMAIN", ".rashikapoor.co.in")
    SHARED_SESSION_COOKIE_SECURE = os.getenv("SHARED_SESSION_COOKIE_SECURE", "true").lower() == "true"
    SHARED_SESSION_COOKIE_SAMESITE = os.getenv("SHARED_SESSION_COOKIE_SAMESITE", "Lax")
    ZOHO_MAILBOX = os.getenv("ZOHO_MAILBOX", "rk@rashikapoorofficial.com")
    # SMTP_* is the authoritative application configuration. ZOHO_SMTP_*
    # remains an input alias for existing local environments.
    SMTP_HOST = os.getenv("ZOHO_SMTP_HOST", os.getenv("SMTP_HOST", "smtppro.zoho.com"))
    SMTP_PORT = os.getenv("ZOHO_SMTP_PORT", os.getenv("SMTP_PORT", "587"))
    SMTP_SECURE = os.getenv("ZOHO_SMTP_SECURITY", os.getenv("SMTP_SECURE", "starttls"))
    SMTP_USERNAME = os.getenv("ZOHO_SMTP_USERNAME", os.getenv("SMTP_USERNAME", ""))
    SMTP_PASSWORD = os.getenv("ZOHO_SMTP_PASSWORD", os.getenv("SMTP_PASSWORD", ""))
    SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", os.getenv("EMAIL_FROM", "otp@rashikapoorofficial.com"))
    SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", os.getenv("EMAIL_FROM_NAME", "Rashi Kapoor"))
    ZOHO_SMTP_HOST = SMTP_HOST
    ZOHO_SMTP_PORT = SMTP_PORT
    ZOHO_SMTP_SECURITY = SMTP_SECURE
    ZOHO_SMTP_USERNAME = SMTP_USERNAME
    ZOHO_SMTP_PASSWORD = SMTP_PASSWORD
    ZOHO_CLIENT_ID = os.getenv("ZOHO_CLIENT_ID", "")
    ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET", "")
    ZOHO_REFRESH_TOKEN = os.getenv("ZOHO_REFRESH_TOKEN", "")


class DevelopmentConfig(BaseConfig):
    DEBUG = True
    JWT_COOKIE_SECURE = False
    SHARED_SESSION_COOKIE_DOMAIN = os.getenv("SHARED_SESSION_COOKIE_DOMAIN", "")
    SHARED_SESSION_COOKIE_SECURE = os.getenv("SHARED_SESSION_COOKIE_SECURE", "false").lower() == "true"


class ProductionConfig(BaseConfig):
    DEBUG = False

    # Keep this value in Render's environment permanently. Rotating it on
    # every deploy invalidates all tokens that are already in browsers.
    JWT_SECRET_KEY = os.environ["JWT_SECRET_KEY"] if os.getenv("JWT_SECRET_KEY") else BaseConfig.JWT_SECRET_KEY


def get_config() -> type[BaseConfig]:
    marker = next((os.getenv(name, "").strip().lower() for name in ("FLASK_ENV", "APP_ENV", "ENVIRONMENT") if os.getenv(name, "").strip()), "")
    if marker in {"production", "prod"}:
        return ProductionConfig
    if marker in {"development", "dev", "test", "testing"}:
        return DevelopmentConfig
    if marker:
        raise RuntimeError("Invalid application environment marker; use development or production")
    # Flask's local CLI and pytest are explicit non-production contexts. A
    # WSGI/Gunicorn launch without a marker is treated as production so a
    # deployment cannot silently inherit development defaults.
    if os.getenv("FLASK_RUN_FROM_CLI") or os.getenv("PYTEST_CURRENT_TEST"):
        return DevelopmentConfig
    return ProductionConfig


def validate_security_config(config) -> None:
    """Reject known placeholder signing keys in production without rotating keys."""
    if bool(config.get("DEBUG")):
        return
    placeholders = {"", "change-me", "change-me-too"}
    for name in ("SECRET_KEY", "JWT_SECRET_KEY"):
        value = str(config.get(name) or "").strip()
        if value in placeholders or len(value.encode("utf-8")) < 32:
            raise RuntimeError(f"{name} must be configured with at least 32 bytes for production")
