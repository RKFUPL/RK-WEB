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
    FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
    RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
    RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
    RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
    RAZORPAY_MODE = os.getenv("RAZORPAY_MODE", "test").strip().lower() or "test"
    RATELIMIT_DEFAULT = "200 per hour"
    RATELIMIT_STORAGE_URI = os.getenv("RATELIMIT_STORAGE_URI", "memory://")


class DevelopmentConfig(BaseConfig):
    DEBUG = True
    JWT_COOKIE_SECURE = False


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
