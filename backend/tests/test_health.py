import unittest
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask

from app.blueprints.health.routes import health_bp


class HealthTests(unittest.TestCase):
    def test_health_reports_effective_database_name(self):
        app = Flask(__name__)
        app.config["MONGO_DBNAME"] = "RK_WEB_TEST_DB"
        app.register_blueprint(health_bp, url_prefix="/api")
        runtime_database = SimpleNamespace(name="RK_WEB_TEST_DB")
        with patch("app.blueprints.health.routes.mongo", SimpleNamespace(db=runtime_database, cx=None)):
            response = app.test_client().get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["database_name"], "RK_WEB_TEST_DB")


if __name__ == "__main__":
    unittest.main()
