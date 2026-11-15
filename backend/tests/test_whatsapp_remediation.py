"""Fault/replay, deployment and operations regressions. All provider sends mocked."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import mongomock
import pytest
from pymongo.errors import AutoReconnect, DuplicateKeyError, OperationFailure

import test_whatsapp as fixtures
from app.whatsapp import now, process_outbox, recover_outbox, notify
from app.whatsapp_routes import _record_status
from app.whatsapp_storage import ensure_indexes, index_problems
from app.whatsapp_templates import registry, template_registry
from app.whatsapp_ops import register_commands


@pytest.fixture
def case():
    instance = fixtures.WhatsAppTests(methodName="runTest")
    instance.setUp()
    try:
        yield instance
    finally:
        instance.doCleanups()


def test_replay_repairs_a_legacy_partial_projection(case):
    case.outbound()
    event = case.provider_status("read")
    _record_status(case.db, case.app.config, event)
    case.db.whatsapp_messages.update_one({}, {"$set": {"status": "accepted"}})
    _record_status(case.db, case.app.config, event)
    saved = case.db.whatsapp_messages.find_one()
    assert saved["status"] == "read"
    assert len(saved["statusHistory"]) == 1 and saved["readAt"]


def test_crash_after_atomic_projection_before_event_metadata_is_replay_safe(case):
    case.outbound()
    real = case.db.whatsapp_events.update_one
    def crash(query, update, **kwargs):
        if update.get("$set", {}).get("matched") is True:
            raise AutoReconnect("synthetic crash")
        return real(query, update, **kwargs)
    with patch.object(case.db.whatsapp_events, "update_one", side_effect=crash):
        with pytest.raises(AutoReconnect):
            _record_status(case.db, case.app.config, case.provider_status("read"))
    _record_status(case.db, case.app.config, case.provider_status("read"))
    saved = case.db.whatsapp_messages.find_one()
    assert saved["status"] == "read" and len(saved["statusHistory"]) == 1
    assert case.db.whatsapp_events.find_one()["matched"] is True


def test_crash_before_projection_then_replay_commits_all_milestones(case):
    case.outbound()
    with patch.object(case.db.whatsapp_messages, "update_one", side_effect=AutoReconnect("synthetic crash")):
        with pytest.raises(AutoReconnect):
            _record_status(case.db, case.app.config, case.provider_status("delivered"))
    saved = case.db.whatsapp_messages.find_one()
    assert "statusHistory" not in saved and "deliveredAt" not in saved
    _record_status(case.db, case.app.config, case.provider_status("delivered"))
    saved = case.db.whatsapp_messages.find_one()
    assert saved["status"] == "delivered" and saved["deliveredAt"] and len(saved["statusHistory"]) == 1


def test_concurrent_duplicate_out_of_order_statuses_keep_read_and_failure_evidence(case):
    case.outbound()
    events = [case.provider_status(state, timestamp=str(1700000000 + i))
              for i, state in enumerate(("sent", "delivered", "read", "failed"))]
    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(lambda event: _record_status(case.db, case.app.config, event), events * 4))
    saved = case.db.whatsapp_messages.find_one()
    assert saved["status"] == "read" and saved["readAt"] and saved["deliveredAt"]
    assert saved["failedAt"] and saved["failureDetails"]
    assert saved["error"] is None and len(saved["statusHistory"]) == 4


def test_http_response_preserves_acceptance_when_webhook_wins_race(case):
    def respond(*args, **kwargs):
        correlation = kwargs["json"]["biz_opaque_callback_data"]
        _record_status(case.db, case.app.config, case.provider_status("read"), correlation)
        return case.response(200, {"messages": [{"id": "wamid.TEST"}]})
    case.http.side_effect = respond
    case.outbound()
    saved = case.db.whatsapp_messages.find_one()
    assert saved["status"] == "read" and saved["acceptedAt"] and saved["readAt"]
    assert saved["apiResponse"] == {"status": "accepted", "httpStatus": 200, "providerId": "wamid.TEST"}


@pytest.mark.parametrize("event", ["processing", "packed", "payment_failure", "return_status", "admin_notification"])
def test_legacy_flags_never_supply_provider_approval(event):
    config = {"WHATSAPP_ENVIRONMENT": "development", "WHATSAPP_TEMPLATES": {event: {"enabled": True, "approved": True}}}
    item = template_registry(mongomock.MongoClient().audit, config)[event]
    assert item["requiresMetaApproval"] is True
    assert item["approved"] is False and item["approvalSource"] == "unconfirmed"


@pytest.mark.parametrize("mutation", [
    {"name": "other"}, {"language": "en_GB"}, {"category": "MARKETING"},
    {"status": "PENDING"}, {"status": "REJECTED"}, {"status": "PAUSED"},
    {"status": "DISABLED"}, {"status": "MISSING_OR_UNKNOWN"},
    {"checkedAt": now() - timedelta(hours=25)}, {"source": "backend_confirmation"},
    {"componentSignature": "different"}, {"businessAccountId": "other"},
])
def test_exact_current_approval_is_required_for_every_contract(case, mutation):
    item = registry(case.app.config)["processing"]
    key = item["name"] + ":" + item["language"]
    case.db.whatsapp_template_status.update_one({"_id": key}, {"$set": mutation})
    assert template_registry(case.db, case.app.config)["processing"]["approved"] is False


def test_original_approval_cannot_approve_button_version(case):
    config = dict(case.app.config["WHATSAPP_TEMPLATES"]["order_confirmation"])
    config.update(catalogue="rk_order_confirmation_v2", name="rk_order_confirmation_v2", enabled=True)
    case.app.config["WHATSAPP_TEMPLATES"]["order_confirmation"] = config
    assert template_registry(case.db, case.app.config)["order_confirmation"]["approved"] is False


def test_indexes_are_additive_idempotent_unique_and_keep_retention():
    db = mongomock.MongoClient().audit
    db.whatsapp_messages.insert_one({"_id": "saved", "providerId": "wamid.saved"})
    db.whatsapp_consents.insert_one({"_id": "consent", "timestamp": now() - timedelta(days=365)})
    ensure_indexes(db); ensure_indexes(db)
    assert index_problems(db) == []
    assert db.whatsapp_messages.count_documents({}) == 1 and db.whatsapp_consents.count_documents({}) == 1
    with pytest.raises(DuplicateKeyError):
        db.whatsapp_messages.insert_one({"_id": "duplicate", "providerId": "wamid.saved"})
    assert all("expireAfterSeconds" not in info for info in db.whatsapp_messages.index_information().values())
    assert all("expireAfterSeconds" not in info for info in db.whatsapp_consents.index_information().values())
    assert db.whatsapp_inbox.index_information()["receivedAt_1"]["expireAfterSeconds"] == 30 * 86400
    assert db.whatsapp_outbox.index_information()["expiresAt_1"]["expireAfterSeconds"] == 0


def test_existing_duplicate_provider_ids_block_index_creation_without_deleting_records():
    db = mongomock.MongoClient().audit
    db.whatsapp_messages.insert_many([{"providerId": "wamid.same"}, {"providerId": "wamid.same"}])
    with pytest.raises(ValueError, match="duplicate_provider_ids"):
        ensure_indexes(db)
    assert db.whatsapp_messages.count_documents({}) == 2
    assert len(db.whatsapp_messages.index_information()) == 1


def test_existing_retention_conflict_is_not_silently_migrated():
    db = mongomock.MongoClient().audit
    db.whatsapp_inbox.create_index("receivedAt", expireAfterSeconds=60)
    with pytest.raises(ValueError, match="index_definition_conflict|retention_index_conflict"):
        ensure_indexes(db)
    assert db.whatsapp_inbox.index_information()["receivedAt_1"]["expireAfterSeconds"] == 60


def test_new_ttl_indexes_refuse_to_expire_existing_records_without_retention_review():
    db = mongomock.MongoClient().audit
    db.whatsapp_inbox.insert_one({"receivedAt": now() - timedelta(days=31)})
    with pytest.raises(ValueError, match="expired_records_require_retention_review"):
        ensure_indexes(db)
    assert db.whatsapp_inbox.count_documents({}) == 1
    assert len(db.whatsapp_inbox.index_information()) == 1


def test_index_read_failure_is_reported_without_driver_secrets():
    db = mongomock.MongoClient().audit
    with patch.object(db.whatsapp_messages, "index_information", side_effect=OperationFailure("synthetic private credential")):
        assert index_problems(db) == ["indexes_unavailable"]


def queued(case):
    record = case.confirmed_order()
    with case.app.app_context():
        result = notify(case.db, "processing", record)
    assert result["status"] == "queued"
    case.db.whatsapp_outbox.update_one({}, {"$set": {"status": "processing", "claimToken": "old",
        "claimedAt": now() - timedelta(minutes=10), "leaseUntil": now() - timedelta(seconds=1)}})
    return result["correlationId"]


def test_expired_pre_dispatch_claim_can_resume_once(case):
    queued(case)
    assert recover_outbox(case.db, case.app.config) == 1
    assert case.db.whatsapp_outbox.find_one()["status"] == "pending"
    assert process_outbox(case.db, case.app.config) == 1
    assert process_outbox(case.db, case.app.config) == 0
    assert case.http.call_count == 1


@pytest.mark.parametrize("outcome", ["sending", "unknown", "failed"])
def test_uncertain_dispatch_claim_is_held_and_never_auto_replayed(case, outcome):
    key = queued(case)
    case.db.whatsapp_messages.insert_one({"_id": key, "status": outcome})
    recover_outbox(case.db, case.app.config)
    assert case.db.whatsapp_outbox.find_one()["status"] == "held"
    assert process_outbox(case.db, case.app.config) == 0
    case.http.assert_not_called()


def test_legacy_processing_claim_without_fencing_proof_is_held(case):
    queued(case)
    case.db.whatsapp_outbox.update_one({}, {"$unset": {"claimToken": "", "leaseUntil": ""}})
    recover_outbox(case.db, case.app.config)
    assert case.db.whatsapp_outbox.find_one()["status"] == "held"
    case.http.assert_not_called()


def test_pending_job_with_existing_unknown_dispatch_is_held_instead_of_replayed(case):
    key = queued(case)
    case.db.whatsapp_outbox.update_one({}, {"$set": {"status": "pending"}, "$unset": {"claimToken": "", "leaseUntil": ""}})
    case.db.whatsapp_messages.insert_one({"_id": key, "status": "unknown"})
    process_outbox(case.db, case.app.config)
    assert case.db.whatsapp_outbox.find_one()["status"] == "held"
    case.http.assert_not_called()


def test_stale_worker_cannot_send_retry_or_overwrite_new_claim(case):
    queued(case)
    def rejection(*args, **kwargs):
        case.db.whatsapp_outbox.update_one({}, {"$set": {"claimToken": "replacement"}})
        return case.response(429, {"error": {"code": 130429}})
    case.http.side_effect = rejection
    with patch("app.whatsapp.time.sleep"):
        process_outbox(case.db, case.app.config)
    assert case.http.call_count == 1
    assert case.db.whatsapp_outbox.find_one()["claimToken"] == "replacement"


def test_rejection_containing_a_meta_id_is_uncertain_and_never_rate_retried(case):
    queued(case)
    case.http.return_value = case.response(429, {"messages": [{"id": "wamid.uncertain"}], "error": {"code": 130429}})
    process_outbox(case.db, case.app.config)
    saved = case.db.whatsapp_messages.find_one()
    assert saved["status"] == "unknown" and saved["providerId"] == "wamid.uncertain"
    assert saved["apiResponse"]["status"] == "unknown" and "acceptedAt" not in saved
    assert case.db.whatsapp_outbox.find_one()["status"] == "unknown"
    assert process_outbox(case.db, case.app.config) == 0 and case.http.call_count == 1
    _record_status(case.db, case.app.config, case.provider_status("read", message_id="wamid.uncertain"))
    assert case.db.whatsapp_messages.find_one()["status"] == "read"


@pytest.mark.parametrize("http_status", [200, 500])
def test_success_or_server_error_with_rate_code_cannot_trigger_retry(case, http_status):
    queued(case)
    case.http.return_value = case.response(http_status, {"error": {"code": 130429}})
    process_outbox(case.db, case.app.config)
    assert case.db.whatsapp_outbox.find_one()["status"] == "unknown"
    assert case.http.call_count == 1


def test_graceful_stop_does_not_claim_a_new_job(case):
    queued(case)
    process_outbox(case.db, case.app.config, stop_requested=lambda: True)
    assert case.db.whatsapp_outbox.find_one()["status"] == "pending"
    case.http.assert_not_called()


def cli(case):
    case.app.config.update(MONGO_DBNAME="whatsapp_tests", MONGO_URI="mongodb://localhost/whatsapp_tests", WHATSAPP_EXPECTED_DATABASE="whatsapp_tests")
    register_commands(case.app, SimpleNamespace(db=case.db, cx=None))
    return case.app.test_cli_runner()


def test_worker_cli_fails_closed_on_missing_indexes_and_disabled_mode_never_opens_db(case):
    runner = cli(case)
    result = runner.invoke(args=["whatsapp-worker"])
    assert result.exit_code != 0 and "indexes" in result.output
    case.http.assert_not_called()
    case.app.config["WHATSAPP_ENABLED"] = False
    with patch("app.whatsapp_ops.guarded_database", side_effect=AssertionError("must not open DB")):
        result = runner.invoke(args=["whatsapp-worker"])
    assert result.exit_code == 0 and '"processed": 0' in result.output


def test_index_cli_requires_target_and_off_gates_and_never_runs_catalog_maintenance(case):
    runner = cli(case)
    result = runner.invoke(args=["whatsapp-indexes", "--database", "whatsapp_tests", "--apply"])
    assert result.exit_code != 0
    case.app.config.update(WHATSAPP_ENABLED=False, WHATSAPP_TEST_SEND_ENABLED=False, WHATSAPP_MARKETING_ENABLED=False)
    result = runner.invoke(args=["whatsapp-indexes", "--database", "wrong", "--apply"])
    assert result.exit_code != 0 and "match" in result.output
    result = runner.invoke(args=["whatsapp-indexes", "--database", "whatsapp_tests", "--apply"])
    assert result.exit_code == 0, result.output
    assert index_problems(case.db) == [] and "products" not in case.db.list_collection_names()


def test_docker_context_excludes_nested_credentials_and_private_artifacts(tmp_path):
    root = Path(__file__).resolve().parents[2]
    spec = spec_from_file_location("context_audit", root / "scripts/audit_release_context.py")
    module = module_from_spec(spec); spec.loader.exec_module(module)
    matcher = module.DockerIgnore((root / ".dockerignore").read_text())
    forbidden = ["backend/.env", "backend/.env.local", "frontend/.env.production", "deep/a/.dev.vars", "deep/a/key.pem",
                 "backend/instance/private/customer.jpg", "frontend/test-results/trace.zip", "dump/db.bson"]
    for relative in forbidden:
        path = tmp_path / relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_text("synthetic fixture")
        assert matcher.ignored(relative), relative
    (tmp_path / "backend/.env.example").write_text("WHATSAPP_ACCESS_TOKEN=\n")
    files = list(module.context_files(tmp_path, matcher))
    assert files == ["backend/.env.example"]
    assert module.scan(tmp_path, files) == []


def test_context_audit_redacts_a_secret_finding(tmp_path):
    root = Path(__file__).resolve().parents[2]
    spec = spec_from_file_location("context_audit", root / "scripts/audit_release_context.py")
    module = module_from_spec(spec); spec.loader.exec_module(module)
    secret = "synthetic-value-that-must-never-be-rendered"
    (tmp_path / "config.txt").write_text(secret)
    finding = module.scan(tmp_path, ["config.txt"], [secret])
    assert finding == [{"file": "config.txt", "rule": "known_local_secret"}]
    assert secret not in str(finding)


def test_provider_audit_reads_only_and_does_not_conflate_callback_with_waba_membership(case):
    from app.whatsapp_provider import audit_provider
    from app.whatsapp_templates import LOCAL_TEST_TEMPLATE
    from app.whatsapp import CALLBACK
    responses = [
        case.response(200, {"data": [{**LOCAL_TEST_TEMPLATE, "status": "APPROVED"}]}),
        case.response(200, {"data": []}),
        case.response(200, {"data": [{"id": "12345", "quality_rating": "GREEN"}]}),
        case.response(200, {"data": [{"object": "whatsapp_business_account", "active": True, "callback_url": CALLBACK, "fields": [{"name": "messages"}]}]}),
    ]
    with patch("app.whatsapp_provider.requests.get", side_effect=responses) as get:
        result = audit_provider(case.app.config, app_access_token="synthetic-app-access-token")
    assert get.call_count == 4
    assert result["appWebhook"]["productionCallback"] and result["appWebhook"]["messagesField"]
    assert result["wabaSubscription"]["configuredAppSubscribed"] is False
    case.http.assert_not_called()


def test_provider_failure_never_erases_cached_approval_or_prints_tokens(case):
    from app.whatsapp_routes import refresh_template_observations
    import requests
    before = case.db.whatsapp_template_status.find_one({"_id": "rk_order_confirmation:en_US"})
    with patch("app.whatsapp_provider.requests.get", side_effect=requests.HTTPError("synthetic confidential provider error")):
        with pytest.raises(requests.HTTPError):
            refresh_template_observations(case.db, case.app.config)
    after = case.db.whatsapp_template_status.find_one({"_id": before["_id"]})
    assert before == after
    assert case.db.integrations.find_one({"_id": "whatsapp"})["templateStatusSync"]["lastError"] == "meta_inventory_unavailable_or_incomplete"


def test_enabled_worker_database_disconnect_is_sanitized(case):
    runner = cli(case)
    with patch("app.whatsapp_ops.guarded_database", side_effect=AutoReconnect("synthetic-secret-in-driver-error")):
        result = runner.invoke(args=["whatsapp-worker"])
    assert result.exit_code != 0 and "database unavailable" in result.output
    assert "synthetic-secret-in-driver-error" not in result.output
    case.http.assert_not_called()


def test_worker_signal_finishes_current_batch_and_restores_signal_handler(case):
    import signal
    runner = cli(case)
    ensure_indexes(case.db)
    original = signal.getsignal(signal.SIGTERM)
    def complete_active_job(*args, **kwargs):
        signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
        assert kwargs["stop_requested"]() is True
        return 1
    with patch("app.whatsapp_ops.process_outbox", side_effect=complete_active_job):
        result = runner.invoke(args=["whatsapp-worker"])
    assert result.exit_code == 0 and '"status": "stopped"' in result.output
    assert signal.getsignal(signal.SIGTERM) == original


def test_forwarding_headers_are_ignored_until_server_side_overwrite_is_verified():
    from app.extensions import resolved_client_address
    for header in ("203.0.113.44", "203.0.113.44, 198.51.100.20", "not-an-ip", ""):
        assert resolved_client_address({}, "10.4.2.11", header) == ("10.4.2.11", "direct_peer")
    assert resolved_client_address({}, "198.51.100.20", "203.0.113.44") == ("198.51.100.20", "direct_peer")
    assert resolved_client_address({}, None, "203.0.113.44") == ("unknown", "invalid_peer")


def test_distinct_visitors_get_distinct_rate_limit_buckets_and_spoofed_headers_are_ignored():
    from flask import Flask
    from app.extensions import limiter
    app = Flask("rate_limit_identity")
    app.config.update(TESTING=True, SECRET_KEY="test-rate-limit-secret",
                      RATELIMIT_ENABLED=True, RATELIMIT_STORAGE_URI="memory://", RATELIMIT_DEFAULT=None)
    limiter.init_app(app)

    @app.get("/sensitive")
    @limiter.limit("2 per hour")
    def sensitive():
        return "ok"

    client = app.test_client()
    for visitor in ("198.51.100.1", "198.51.100.2", "198.51.100.3"):
        for _ in range(2):
            response = client.get("/sensitive", environ_base={"REMOTE_ADDR": visitor}, headers={"X-Forwarded-For": "203.0.113.200"})
            assert response.status_code == 200
        response = client.get("/sensitive", environ_base={"REMOTE_ADDR": visitor}, headers={"X-Forwarded-For": "203.0.113.200"})
        assert response.status_code == 429


def test_spoofed_custom_header_cannot_split_or_bypass_the_next_peer_bucket():
    from flask import Flask
    from app.extensions import limiter
    app = Flask("trusted_rate_limit_identity")
    app.config.update(TESTING=True, SECRET_KEY="test-rate-limit-secret",
                      RATELIMIT_ENABLED=True, RATELIMIT_STORAGE_URI="memory://", RATELIMIT_DEFAULT=None)
    limiter.init_app(app)

    @app.get("/sensitive")
    @limiter.limit("1 per hour")
    def sensitive():
        return "ok"

    client = app.test_client()
    peer = {"REMOTE_ADDR": "10.0.0.2"}
    assert client.get("/sensitive", environ_base=peer, headers={"X-RK-Verified-Client-IP": "198.51.100.1"}).status_code == 200
    assert client.get("/sensitive", environ_base=peer, headers={"X-RK-Verified-Client-IP": "198.51.100.2"}).status_code == 429
    assert client.get("/sensitive", environ_base=peer, headers={"X-Forwarded-For": "203.0.113.5", "CF-Connecting-IP": "198.51.100.3"}).status_code == 429
    assert client.get("/sensitive", environ_base={"REMOTE_ADDR": "203.0.113.9"}, headers={"X-RK-Verified-Client-IP": "198.51.100.1"}).status_code == 200
