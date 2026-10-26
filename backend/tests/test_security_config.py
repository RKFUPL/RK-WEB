import pytest
from unittest.mock import patch

from app.config import DevelopmentConfig, ProductionConfig, get_config, validate_security_config


def test_development_allows_local_placeholder_keys():
    validate_security_config({"DEBUG": True, "SECRET_KEY": "change-me", "JWT_SECRET_KEY": "change-me-too"})


@pytest.mark.parametrize("key", ["SECRET_KEY", "JWT_SECRET_KEY"])
def test_production_rejects_placeholder_signing_keys(key):
    config = {"DEBUG": False, "SECRET_KEY": "s" * 32, "JWT_SECRET_KEY": "j" * 32}
    config[key] = "change-me" if key == "SECRET_KEY" else "change-me-too"
    with pytest.raises(RuntimeError, match=key):
        validate_security_config(config)


def test_production_accepts_explicit_signing_keys():
    validate_security_config({"DEBUG": False, "SECRET_KEY": "s" * 32, "JWT_SECRET_KEY": "j" * 32})


@pytest.mark.parametrize("marker", ["production", "prod"])
def test_production_marker_selects_production_config(marker):
    with patch.dict("os.environ", {"FLASK_ENV": marker}, clear=True):
        assert get_config() is ProductionConfig


@pytest.mark.parametrize("marker", ["development", "dev", "test", "testing"])
def test_development_markers_preserve_local_behavior(marker):
    with patch.dict("os.environ", {"FLASK_ENV": marker}, clear=True):
        assert get_config() is DevelopmentConfig


def test_missing_marker_is_development_only_for_cli_or_pytest():
    with patch.dict("os.environ", {"FLASK_RUN_FROM_CLI": "true"}, clear=True):
        assert get_config() is DevelopmentConfig
    with patch.dict("os.environ", {}, clear=True):
        assert get_config() is ProductionConfig


def test_invalid_marker_fails_closed():
    with patch.dict("os.environ", {"FLASK_ENV": "staging"}, clear=True), pytest.raises(RuntimeError, match="Invalid application environment marker"):
        get_config()


@pytest.mark.parametrize("name", ["SECRET_KEY", "JWT_SECRET_KEY"])
def test_production_rejects_weak_signing_keys(name):
    config = {"DEBUG": False, "SECRET_KEY": "s" * 32, "JWT_SECRET_KEY": "j" * 32}
    config[name] = "short"
    with pytest.raises(RuntimeError, match=name):
        validate_security_config(config)
