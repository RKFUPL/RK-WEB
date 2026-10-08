from flask import Blueprint, current_app

from ...extensions import mongo

health_bp = Blueprint("health", __name__)


@health_bp.get("/health")
def health() -> tuple[dict[str, str], int]:
    database = mongo.db if mongo.db is not None else mongo.cx[current_app.config["MONGO_DBNAME"]]
    return {"status": "ok", "service": "rashi-kapoor-api", "database_name": str(database.name)}, 200
