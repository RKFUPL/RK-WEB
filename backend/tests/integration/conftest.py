"""Strict opt-in fixtures for a real disposable MongoDB instance.

Never substitute MongoMock here. An unsafe target fails before a MongoClient
is created; an absent opt-in URI skips this suite during ordinary pytest runs.
"""
from __future__ import annotations

import ipaddress
import os
import re
from urllib.parse import unquote, urlsplit
from uuid import uuid4

import pytest
from pymongo import MongoClient
from pymongo.errors import PyMongoError


_DB_RE = re.compile(r"^rk_inventory_test_[a-z0-9][a-z0-9_-]{7,63}$")
_PRODUCTION_WORDS = ("prod", "production", "live", "primary")


def _safe_target(uri: str, allowed_host: str) -> tuple[str, str]:
    """Validate database AND host before creating a client or issuing a command."""
    if not isinstance(uri, str) or not uri.strip() or uri != uri.strip():
        raise ValueError("RK_INVENTORY_TEST_MONGODB_URI is required and must not contain surrounding whitespace")
    parsed = urlsplit(uri)
    if parsed.scheme not in {"mongodb", "mongodb+srv"} or not parsed.hostname:
        raise ValueError("The integration URI must use mongodb:// or mongodb+srv://")
    database_name = unquote(parsed.path.lstrip("/"))
    if not _DB_RE.fullmatch(database_name) or any(word in database_name.lower() for word in _PRODUCTION_WORDS):
        raise ValueError("The URI path must name a dedicated disposable rk_inventory_test_* database")
    host = parsed.hostname.rstrip(".").lower()
    if any(word in host for word in _PRODUCTION_WORDS):
        raise ValueError("Production-like MongoDB hosts are not allowed")
    try:
        loopback = ipaddress.ip_address(host).is_loopback
    except ValueError:
        loopback = host == "localhost"
    # Remote staging hosts require a second, exact host assertion. This stops a
    # production cluster URI from being accepted just because its DB path was
    # given a test-looking name.
    if not loopback and (not allowed_host or host != allowed_host.strip().lower().rstrip(".")):
        raise ValueError("A non-local host requires an exact RK_INVENTORY_TEST_ALLOWED_HOST match")
    if "," in (parsed.netloc.rsplit("@", 1)[-1].split("/", 1)[0]):
        raise ValueError("Multi-host URIs are not allowed for this disposable suite")
    return database_name, host


@pytest.fixture(scope="session")
def real_mongodb_target():
    uri = os.environ.get("RK_INVENTORY_TEST_MONGODB_URI")
    if not uri:
        pytest.skip("Opt-in real MongoDB suite: RK_INVENTORY_TEST_MONGODB_URI is unset")
    try:
        database_name, _host = _safe_target(
            uri, os.environ.get("RK_INVENTORY_TEST_ALLOWED_HOST", ""))
    except ValueError as error:
        pytest.fail(f"Unsafe real-MongoDB test target: {error}", pytrace=False)

    client = None
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000, connectTimeoutMS=5000,
                             appname="rk-inventory-integration-test", tz_aware=True)
        # Both commands are performed only after the local/name/host guard.
        client.admin.command("ping")
        hello = client.admin.command("hello")
        server = client.server_info()
        if not hello.get("ok") or not isinstance(server.get("version"), str):
            pytest.fail("The supplied endpoint did not prove a live MongoDB server", pytrace=False)
        database = client[database_name]
        if database.name != database_name:
            pytest.fail("Real MongoDB database identity verification failed", pytrace=False)
        print(f"Real MongoDB integration server version: {server['version']}")
        yield {"client": client, "db": database, "server_version": server["version"],
               "database_name": database_name, "_uri": uri}
    except PyMongoError:
        # Exception strings may contain host metadata; deliberately suppress
        # them so URI credentials or network details can never enter test logs.
        pytest.fail("Unable to prove connectivity to the explicitly designated disposable MongoDB target", pytrace=False)
    finally:
        if client is not None:
            client.close()


@pytest.fixture
def inventory_sandbox(real_mongodb_target):
    """Create uniquely keyed test records and clean only those exact records."""
    db = real_mongodb_target["db"]
    run_id = uuid4().hex
    order_ids: list[object] = []
    product_ids: list[object] = []
    user_ids: list[object] = []
    webhook_event_ids: list[str] = []

    def insert_order(document):
        document = {**document, "_inventoryTestRun": run_id}
        db.orders.insert_one(document)
        order_ids.append(document["_id"])
        return document

    def insert_product(document):
        document = {**document, "_inventoryTestRun": run_id}
        db.products.insert_one(document)
        product_ids.append(document["_id"])
        return document

    def track_webhook_event(event_id):
        webhook_event_ids.append(str(event_id))
        return event_id

    def track_user(user_id):
        user_ids.append(user_id)
        return user_id

    yield {**real_mongodb_target, "run_id": run_id, "insert_order": insert_order,
           "insert_product": insert_product, "track_webhook_event": track_webhook_event,
           "track_user": track_user}

    # No drop_database, delete_many({}), or collection-wide cleanup. Only IDs
    # inserted by this fixture are removed, even on a shared disposable test DB.
    if order_ids:
        db.orders.delete_many({"_id": {"$in": order_ids}, "_inventoryTestRun": run_id})
        order_strings = [str(value) for value in order_ids]
        db.inventory_operations.delete_many({"orderId": {"$in": order_strings}})
        db.payment_reconciliations.delete_many({"orderId": {"$in": order_strings}})
        db.whatsapp_order_events.delete_many({"orderId": {"$in": order_strings}})
        db.order_notification_activity.delete_many({"orderId": {"$in": order_ids + order_strings}})
    if webhook_event_ids:
        db.razorpay_webhook_events.delete_many({"eventId": {"$in": webhook_event_ids}})
    if user_ids:
        db.users.delete_many({"_id": {"$in": user_ids}})
    if product_ids:
        db.products.delete_many({"_id": {"$in": product_ids}, "_inventoryTestRun": run_id})
