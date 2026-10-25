from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app import rbac
from app.blueprints.auth import routes as auth_routes


def test_rbac_database_uses_initialized_database_without_truth_testing():
    configured = SimpleNamespace(config={"MONGO_DBNAME": "configured"})
    database = MagicMock(name="initialized_database")
    mongo = SimpleNamespace(db=database, cx=MagicMock())

    with patch.object(rbac, "mongo", mongo), patch.object(rbac, "current_app", configured):
        assert rbac.database() is database

    mongo.cx.__getitem__.assert_not_called()


def test_rbac_database_uses_configured_fallback_when_database_is_none():
    configured = SimpleNamespace(config={"MONGO_DBNAME": "configured"})
    fallback = MagicMock(name="configured_database")
    mongo = SimpleNamespace(db=None, cx={"configured": fallback})

    with patch.object(rbac, "mongo", mongo), patch.object(rbac, "current_app", configured):
        assert rbac.database() is fallback


def test_auth_database_uses_initialized_database_without_truth_testing():
    configured = SimpleNamespace(config={"MONGO_DBNAME": "configured"})
    database = MagicMock(name="initialized_database")
    mongo = SimpleNamespace(db=database, cx=MagicMock())

    with patch.object(auth_routes, "mongo", mongo), patch.object(auth_routes, "current_app", configured):
        assert auth_routes._database() is database

    mongo.cx.__getitem__.assert_not_called()


def test_auth_database_uses_configured_fallback_when_database_is_none():
    configured = SimpleNamespace(config={"MONGO_DBNAME": "configured"})
    fallback = MagicMock(name="configured_database")
    mongo = SimpleNamespace(db=None, cx={"configured": fallback})

    with patch.object(auth_routes, "mongo", mongo), patch.object(auth_routes, "current_app", configured):
        assert auth_routes._database() is fallback
