from pathlib import Path

from flask import Flask
from flask import send_file
from dotenv import load_dotenv

load_dotenv()

from .blueprints.auth.routes import auth_bp
from .blueprints.health.routes import health_bp
from .config import get_config
from .extensions import cors, jwt, limiter, mail, mongo


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(get_config())

    cors.init_app(app)
    jwt.init_app(app)
    limiter.init_app(app)
    mail.init_app(app)
    mongo.init_app(app)

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(auth_bp, url_prefix="/api/auth")

    @app.get("/")
    def index() -> tuple[dict[str, str], int]:
        return {"status": "ok", "service": "rashi-kapoor-api"}, 200

    @app.get("/favicon.ico")
    def favicon():
        repo_root = Path(__file__).resolve().parents[2]
        favicon_path = repo_root / "frontend" / "public" / "RK_LOGOMARK.svg"
        return send_file(favicon_path, mimetype="image/svg+xml")

    return app
