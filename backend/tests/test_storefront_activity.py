from types import SimpleNamespace
from unittest.mock import patch

import mongomock
from flask import Flask

from app.blueprints.analytics.routes import storefront_activity_bp


def test_storefront_activity_accepts_post_and_rejects_get():
    client = mongomock.MongoClient()
    database = SimpleNamespace(
        users=client.db.users,
        analytics_events=client.db.analytics_events,
    )
    app = Flask(__name__)
    app.config.update(TESTING=True)
    app.register_blueprint(storefront_activity_bp, url_prefix="/api/storefront")
    payload = {
        "event": "page_view",
        "visitorId": "visitor_12345678",
        "sessionId": "session_12345678",
        "path": "/collections",
        "source": "direct",
        "properties": {},
    }

    with patch("app.blueprints.analytics.routes.database", return_value=database):
        post_response = app.test_client().post("/api/storefront/activity", json=payload)
        get_response = app.test_client().get("/api/storefront/activity")

    assert post_response.status_code == 202
    assert post_response.get_json() == {"recorded": True}
    assert database.analytics_events.count_documents({"event": "page_view"}) == 1
    assert get_response.status_code == 405
