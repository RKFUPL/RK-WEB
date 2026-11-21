from types import SimpleNamespace
from unittest.mock import patch
from unittest.mock import Mock, MagicMock
from pathlib import Path
import subprocess
import sys
import inspect
from datetime import datetime, timedelta, timezone

import pytest

import dns.resolver
from flask import Flask
from flask_limiter import Limiter
from limits.storage.mongodb import MongoDBStorage, MongoDBStorageBase
from pymongo import MongoClient
from limits.storage import storage_from_string
from app.rate_limit_storage import ShutdownSafeMongoDBStorage


def test_mongodb_srv_rate_limit_storage_initializes_with_dns_resolver():
    app = Flask("mongodb_srv_rate_limit_storage")
    app.config.update(
        TESTING=True,
        RATELIMIT_ENABLED=True,
        RATELIMIT_DEFAULT=None,
        RATELIMIT_STORAGE_URI="mongodb+srv://cluster.example.test/ratelimit",
    )
    limiter = Limiter(key_func=lambda: "test", default_limits=[])
    dns_queries = []

    class Target:
        def to_text(self, **_kwargs):
            return "node.cluster.example.test"

    class SRVAnswer(list):
        rrset = SimpleNamespace(ttl=60)

    srv_answer = SRVAnswer([SimpleNamespace(target=Target(), port=27017)])

    def resolve(name, record_type, **_kwargs):
        dns_queries.append((name, record_type))
        if record_type == "SRV":
            return srv_answer
        if record_type == "TXT":
            raise dns.resolver.NoAnswer
        raise AssertionError(f"unexpected DNS record type: {record_type}")

    # Flask-Limiter initializes storage lazily. Force its MongoClient creation,
    # while avoiding a network connection or index writes to any database.
    with patch("dns.resolver.resolve", side_effect=resolve), patch.object(
        MongoDBStorageBase, "_MongoDBStorageBase__initialize_database", lambda _self: None
    ):
        limiter.init_app(app)
        storage = limiter._storage
        assert isinstance(storage, MongoDBStorage)
        assert isinstance(storage, ShutdownSafeMongoDBStorage)
        client = storage.storage
        try:
            assert isinstance(client, MongoClient)
        finally:
            client.close()

    assert ("_mongodb._tcp.cluster.example.test", "SRV") in dns_queries
    assert ("cluster.example.test", "TXT") in dns_queries


@pytest.mark.parametrize("scheme", ["mongodb", "mongodb+srv"])
def test_unused_mongodb_cleanup_never_creates_a_client(scheme):
    storage = storage_from_string(f"{scheme}://unused.example.test/limits")
    assert isinstance(storage, ShutdownSafeMongoDBStorage)
    with patch.object(storage, "_init_mongo_client", side_effect=AssertionError("cleanup must not connect")) as create:
        storage.__del__()
        create.assert_not_called()
    assert storage._storage is None


def test_cleanup_closes_only_an_existing_client_once():
    storage = storage_from_string("mongodb://unused.example.test/limits")
    client = Mock()
    storage._storage = client
    with patch.object(storage, "_init_mongo_client", side_effect=AssertionError("cleanup must not connect")):
        storage.__del__()
        storage.__del__()
    client.close.assert_called_once_with()
    assert storage._storage is None


def test_cleanup_handles_incomplete_initialization_without_creating_a_client():
    storage = object.__new__(ShutdownSafeMongoDBStorage)
    storage.__del__()


def test_unused_cli_limiter_exits_without_dns_or_shutdown_warnings():
    # A real process exit exercises module teardown, where the upstream
    # destructor raised ConfigurationError despite dnspython being installed.
    program = """
from flask import Flask
from flask_limiter import Limiter
from unittest.mock import patch
from app.rate_limit_storage import ShutdownSafeMongoDBStorage
app = Flask('short_lived_cli')
app.config['RATELIMIT_STORAGE_URI'] = 'mongodb+srv://unused.example.test/limits'
with patch.object(ShutdownSafeMongoDBStorage, '_init_mongo_client', side_effect=AssertionError('unexpected connection')):
    limiter = Limiter(key_func=lambda: 'fixture', default_limits=[])
    limiter.init_app(app)
    assert isinstance(limiter._storage, ShutdownSafeMongoDBStorage)
    assert limiter._storage._storage is None
"""
    result = subprocess.run([sys.executable, "-c", program], cwd=Path(__file__).resolve().parents[1],
                            capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""


def test_mongodb_http_limits_keep_enforcing_the_configured_limit():
    app = Flask("mongodb_http_limits")
    app.config.update(TESTING=True, RATELIMIT_STORAGE_URI="mongodb://unused.example.test/limits")
    limiter = Limiter(key_func=lambda: "fixture", default_limits=[])
    # Mock only the driver boundary: mongomock does not implement the $$NOW
    # aggregation expression used by limits 5.8.0's actual MongoDB incr method.
    driver = MagicMock()
    counters = driver.__getitem__.return_value.__getitem__.return_value
    counters.find_one_and_update.side_effect = [{"count": 1}, {"count": 2}]
    counters.find_one.return_value = {"count": 2, "expireAt": datetime.now(timezone.utc) + timedelta(minutes=1)}
    # limits wraps inherited storage methods when each subclass is created.
    assert inspect.unwrap(ShutdownSafeMongoDBStorage.incr) is inspect.unwrap(MongoDBStorage.incr)
    with patch.object(ShutdownSafeMongoDBStorage, "_init_mongo_client", return_value=driver) as create:
        limiter.init_app(app)

        @app.get("/limited")
        @limiter.limit("1 per minute")
        def limited():
            return "ok"

        client = app.test_client()
        assert client.get("/limited").status_code == 200
        assert client.get("/limited").status_code == 429
        create.assert_called_once()
        assert counters.find_one_and_update.call_count == 2
        limiter._storage.__del__()
        driver.close.assert_called_once_with()
