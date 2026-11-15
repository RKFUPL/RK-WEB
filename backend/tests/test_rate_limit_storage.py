from types import SimpleNamespace
from unittest.mock import patch

import dns.resolver
from flask import Flask
from flask_limiter import Limiter
from limits.storage.mongodb import MongoDBStorage, MongoDBStorageBase
from pymongo import MongoClient


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
        client = storage.storage
        try:
            assert isinstance(client, MongoClient)
        finally:
            client.close()

    assert ("_mongodb._tcp.cluster.example.test", "SRV") in dns_queries
    assert ("cluster.example.test", "TXT") in dns_queries
