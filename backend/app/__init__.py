from pathlib import Path
import os

from flask import Flask
from flask import send_file
from dotenv import load_dotenv

load_dotenv()

# The local development environment can expose a dead placeholder proxy. It
# prevents Resend from reaching its API even though the backend is healthy.
for _proxy_name in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'):
    if os.getenv(_proxy_name, '').lower() == 'http://127.0.0.1:9':
        os.environ.pop(_proxy_name, None)

from .blueprints.auth.routes import auth_bp
from .blueprints.health.routes import health_bp
from .blueprints.admin.routes import admin_bp
from .blueprints.analytics.routes import analytics_bp, storefront_activity_bp
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
    cors.init_app(
        app,
        resources={r"/api/*": {"origins": list(allowed_origins)}},
        supports_credentials=True,
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
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

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(analytics_bp, url_prefix="/api/analytics")
    # A neutral first-party URL avoids privacy filters that block paths named
    # `analytics`, which can otherwise make incognito visits vanish silently.
    app.register_blueprint(storefront_activity_bp, url_prefix="/api/storefront")
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
