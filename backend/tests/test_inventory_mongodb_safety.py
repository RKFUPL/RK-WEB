"""Pure URI-policy tests; these never create a MongoClient or contact a host."""
import pytest

from integration.conftest import _safe_target


def test_local_disposable_database_uri_is_accepted_without_connecting():
    name, host = _safe_target("mongodb://127.0.0.1:27018/rk_inventory_test_run123456", "")
    assert name == "rk_inventory_test_run123456"
    assert host == "127.0.0.1"


@pytest.mark.parametrize("name", ["rashi_kapoor", "production", "rk_inventory_test", "rk_inventory_prod_run123456"])
def test_production_or_non_disposable_database_names_are_rejected(name):
    with pytest.raises(ValueError):
        _safe_target(f"mongodb://localhost:27017/{name}", "")


def test_remote_target_requires_exact_explicit_host_allowlist():
    uri = "mongodb+srv://mongo-staging.example.test/rk_inventory_test_run123456"
    with pytest.raises(ValueError, match="exact RK_INVENTORY_TEST_ALLOWED_HOST"):
        _safe_target(uri, "")
    name, host = _safe_target(uri, "mongo-staging.example.test")
    assert name == "rk_inventory_test_run123456"
    assert host == "mongo-staging.example.test"


@pytest.mark.parametrize("host", ["mongo-production.example.test", "mongo-live.example.test"])
def test_production_like_host_is_rejected_even_when_allowlisted(host):
    uri = f"mongodb://{host}:27017/rk_inventory_test_run123456"
    with pytest.raises(ValueError, match="Production-like MongoDB hosts"):
        _safe_target(uri, host)


def test_multi_host_cluster_uri_is_rejected():
    with pytest.raises(ValueError, match="Multi-host"):
        _safe_target("mongodb://test-a.example.test:27017,test-b.example.test:27017/rk_inventory_test_run123456", "test-a.example.test")
