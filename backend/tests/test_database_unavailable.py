from unittest.mock import patch

from pymongo.errors import ServerSelectionTimeoutError

from app import create_app
from app.blueprints.catalog import routes as catalog_routes


def test_catalog_collections_returns_safe_503_when_database_is_unavailable(caplog):
    app = create_app()
    unavailable = ServerSelectionTimeoutError("test database unavailable")

    with patch.object(catalog_routes, "database", side_effect=unavailable):
        response = app.test_client().get("/api/catalog/collections")

    assert response.status_code == 503
    assert response.get_json() == {"error": "Database temporarily unavailable."}
    assert response.headers["Retry-After"] == "5"
    messages = [record.getMessage() for record in caplog.records]
    assert "MongoDB server selection failed during GET /api/catalog/collections (ServerSelectionTimeoutError)" in messages
    assert all("test database unavailable" not in message for message in messages)
