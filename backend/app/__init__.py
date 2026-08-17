from pathlib import Path
import os

from flask import Flask, request
from flask import send_file
from dotenv import load_dotenv

# Resolve the backend environment from the application location rather than
# the caller's working directory. This keeps local `flask --app wsgi:app run`
# launches consistent whether they start from the repository root or backend/.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# The local development environment can expose a dead placeholder proxy. It
# prevents Resend from reaching its API even though the backend is healthy.
for _proxy_name in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'):
    if os.getenv(_proxy_name, '').lower() == 'http://127.0.0.1:9':
        os.environ.pop(_proxy_name, None)

from .blueprints.auth.routes import auth_bp
from .blueprints.health.routes import health_bp
from .blueprints.admin.routes import admin_bp
from .blueprints.analytics.routes import analytics_bp, storefront_activity_bp
from .blueprints.catalog.routes import catalog_bp
from .blueprints.payments.routes import payments_bp, razorpay_webhook_bp
from .blueprints.orders.routes import customer_orders_bp, staff_orders_bp
from .feedback import feedback_bp, ensure_feedback_indexes
from .returns import returns_bp
from .blueprints.staff.routes import staff_bp
from .config import get_config
from .extensions import cors, jwt, limiter, mail, mongo


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(get_config())

    frontend_url = app.config.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    # Keep the production allowlist explicit because authentication uses
    # credentials. Local origins remain available for development.
    allowed_origins = {
        "https://physihome.shop",
        "https://www.physihome.shop",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5000",
    }
    if frontend_url:
        allowed_origins.add(frontend_url)
    configured_frontends = app.config.get("FRONTEND_URLS", "")
    allowed_origins.update(origin.strip().rstrip("/") for origin in str(configured_frontends).split(",") if origin.strip())
    cors.init_app(
        app,
        resources={r"/api/*": {"origins": list(allowed_origins)}},
        supports_credentials=True,
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Accept", "Content-Type", "Authorization", "X-RK-Visitor-ID"],
        automatic_options=True,
    )
    jwt.init_app(app)
    # Treat malformed, expired, or differently-signed browser tokens as an
    # unauthenticated session. This lets the frontend clear only that token
    # and ask the user to sign in again instead of exposing Flask-JWT's 422.
    @jwt.invalid_token_loader
    def invalid_token(reason: str):
        return {"error": "Authentication token is invalid."}, 401

    @jwt.expired_token_loader
    def expired_token(_jwt_header, _jwt_payload):
        return {"error": "Authentication token has expired."}, 401

    @jwt.unauthorized_loader
    def missing_token(reason: str):
        return {"error": "Authentication required."}, 401

    limiter.init_app(app)
    mail.init_app(app)
    mongo.init_app(app)

    @app.before_request
    def maintain_feedback_data():
        # The deployed app does not run a separate cron process. TTL indexes
        # provide the database-side cleanup, while feedback requests perform
        # an immediate cleanup for installations whose Mongo TTL monitor is
        # delayed.
        if request.path.startswith("/api/feedback/"):
            try:
                ensure_feedback_indexes(mongo.db)
                from .feedback import cleanup_feedback
                cleanup_feedback(mongo.db)
            except Exception:
                app.logger.exception("Unable to maintain feedback expiry data")

    @jwt.token_in_blocklist_loader
    def token_is_revoked(_jwt_header, jwt_payload):
        db = mongo.db or mongo.cx[app.config["MONGO_DBNAME"]]
        return db.revoked_tokens.find_one({"jti": jwt_payload.get("jti")}, {"_id": 1}) is not None

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(analytics_bp, url_prefix="/api/analytics")
    # A neutral first-party URL avoids privacy filters that block paths named
    # `analytics`, which can otherwise make incognito visits vanish silently.
    app.register_blueprint(storefront_activity_bp, url_prefix="/api/storefront")
    app.register_blueprint(catalog_bp, url_prefix="/api/catalog")
    app.register_blueprint(payments_bp, url_prefix="/api/payments")
    app.register_blueprint(razorpay_webhook_bp, url_prefix="/api/webhooks")
    app.register_blueprint(customer_orders_bp, url_prefix="/api/orders")
    app.register_blueprint(staff_orders_bp, url_prefix="/api/staff/orders")
    app.register_blueprint(feedback_bp, url_prefix="/api/feedback")
    app.register_blueprint(returns_bp, url_prefix="/api/returns")
    app.register_blueprint(staff_bp, url_prefix="/api/staff")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")

    @app.get("/")
    def index() -> tuple[dict[str, str], int]:
        return {"status": "ok", "service": "rashi-kapoor-api"}, 200

    @app.get("/favicon.ico")
    def favicon():
        repo_root = Path(__file__).resolve().parents[2]
        favicon_path = repo_root / "frontend" / "public" / "RK_LOGOMARK.svg"
        return send_file(favicon_path, mimetype="image/svg+xml")

    return app
