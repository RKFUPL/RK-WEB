import os
from datetime import timedelta


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
    RATELIMIT_DEFAULT = "200 per hour"
    RATELIMIT_STORAGE_URI = os.getenv("RATELIMIT_STORAGE_URI", "memory://")
    STOCK_INTEGRATION_BOOTSTRAP_SECRET = os.getenv("STOCK_INTEGRATION_BOOTSTRAP_SECRET", "")
    STOCK_INTEGRATION_CLIENT_ID = os.getenv("STOCK_INTEGRATION_CLIENT_ID", "rk-stock-linesheets")
    STOCK_INTEGRATION_CATALOG_WRITE_ENABLED = os.getenv("STOCK_INTEGRATION_CATALOG_WRITE_ENABLED", "false").lower() == "true"
    STOCK_INTEGRATION_CLOUDINARY_HOST = os.getenv("STOCK_INTEGRATION_CLOUDINARY_HOST", "res.cloudinary.com").strip().lower()
    STOCK_CATALOG_SYNC_URL = os.getenv("STOCK_CATALOG_SYNC_URL", "").strip()
    STOCK_CREDENTIAL_SYNC_URL = os.getenv("STOCK_CREDENTIAL_SYNC_URL", "")
    STOCK_CREDENTIAL_SYNC_SECRET = os.getenv("STOCK_CREDENTIAL_SYNC_SECRET", "")
    CREDENTIAL_SYNC_HANDOFF_SECRET = os.getenv("CREDENTIAL_SYNC_HANDOFF_SECRET", os.getenv("STOCK_CREDENTIAL_SYNC_HANDOFF_SECRET", ""))
    CREDENTIAL_SYNC_HANDOFF_TTL_SECONDS = int(os.getenv("CREDENTIAL_SYNC_HANDOFF_TTL_SECONDS", os.getenv("STOCK_CREDENTIAL_SYNC_HANDOFF_TTL", "60")))
    STOCK_CREDENTIAL_SYNC_HANDOFF_SECRET = CREDENTIAL_SYNC_HANDOFF_SECRET
    STOCK_CREDENTIAL_SYNC_HANDOFF_TTL = CREDENTIAL_SYNC_HANDOFF_TTL_SECONDS
    AUTH_SESSION_DAYS = int(os.getenv("AUTH_SESSION_DAYS", "30"))
    SHARED_SESSION_COOKIE_NAME = os.getenv("SHARED_SESSION_COOKIE_NAME", "rk_shared_session")
    SHARED_SESSION_COOKIE_DOMAIN = os.getenv("SHARED_SESSION_COOKIE_DOMAIN", ".rashikapoor.co.in")
    SHARED_SESSION_COOKIE_SECURE = os.getenv("SHARED_SESSION_COOKIE_SECURE", "true").lower() == "true"
    SHARED_SESSION_COOKIE_SAMESITE = os.getenv("SHARED_SESSION_COOKIE_SAMESITE", "Lax")
    SHARED_SESSION_INTERNAL_SECRET = os.getenv("SHARED_SESSION_INTERNAL_SECRET", "")
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
    env = os.getenv("FLASK_ENV", "development").lower()
    if env == "production":
        return ProductionConfig
    return DevelopmentConfig
