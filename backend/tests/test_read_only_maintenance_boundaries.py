import ast
from pathlib import Path

import pytest

from app.config import validate_database_maintenance_target


APP = Path(__file__).resolve().parents[1] / "app"


def _function(path: Path, name: str) -> ast.FunctionDef:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name)


def _called_names(function: ast.FunctionDef) -> set[str]:
    names = set()
    for node in ast.walk(function):
        if not isinstance(node, ast.Call):
            continue
        if isinstance(node.func, ast.Name):
            names.add(node.func.id)
        elif isinstance(node.func, ast.Attribute):
            names.add(node.func.attr)
    return names


def test_public_catalog_get_handlers_do_not_initialize_or_persist_catalog_data():
    routes = APP / "blueprints" / "catalog" / "routes.py"
    forbidden = {"ensure_catalog_indexes", "ensure_catalog_seed", "ensure_catalog_seed_once", "sync_product_variants"}
    for name in ("storefront_runway", "storefront_collection", "storefront_product"):
        assert _called_names(_function(routes, name)).isdisjoint(forbidden)


def test_staff_get_handlers_do_not_initialize_or_persist_catalog_data():
    routes = APP / "blueprints" / "staff" / "routes.py"
    forbidden = {"ensure_catalog_indexes", "ensure_catalog_seed", "ensure_catalog_seed_once", "sync_product_variants"}
    for name in ("get_collection", "list_resources", "get_product_variant", "dashboard"):
        assert _called_names(_function(routes, name)).isdisjoint(forbidden)


def test_application_factory_does_not_run_database_maintenance_or_swallow_failures():
    factory = _function(APP / "__init__.py", "create_app")
    direct_calls = _called_names(factory)
    # Maintenance calls are nested inside the explicit Flask CLI command, not
    # executed while constructing the application.
    nested = next(node for node in factory.body if isinstance(node, ast.FunctionDef) and node.name == "database_maintenance")
    factory_without_cli = ast.FunctionDef(
        name=factory.name,
        args=factory.args,
        body=[node for node in factory.body if node is not nested],
        decorator_list=[],
    )
    assert _called_names(factory_without_cli).isdisjoint({
        "ensure_catalog_indexes", "ensure_catalog_seed", "ensure_dashboard_indexes",
        "ensure_feedback_indexes", "ensure_credential_sync_indexes", "ensure_catalog_sync_indexes",
    })
    assert {"ensure_catalog_indexes", "ensure_catalog_seed", "ensure_feedback_indexes"}.issubset(_called_names(nested))
    assert "ensure_catalog_seed" in direct_calls


def test_read_only_variant_projection_has_no_update_call():
    function = _function(APP / "product_variants.py", "product_with_computed_variants")
    assert "update_one" not in _called_names(function)


def test_maintenance_target_validation_accepts_matching_uri_and_rejects_mismatch():
    config = {"MONGO_URI": "mongodb://example.invalid/approved", "MONGO_DBNAME": "approved"}
    assert validate_database_maintenance_target(config, "approved") == "approved"
    with pytest.raises(RuntimeError, match="URI database"):
        validate_database_maintenance_target({**config, "MONGO_URI": "mongodb://example.invalid/other"}, "approved")
