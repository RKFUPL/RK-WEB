"""Guarded operational commands; no provider writes and no implicit queue replay."""
import json
import signal
import threading
import os

import click
from pymongo.errors import PyMongoError

from .config import validate_database_maintenance_target
from .whatsapp import configuration_errors, automation_enabled, process_outbox
from .whatsapp_storage import ensure_indexes, index_problems


def guarded_database(app, mongo, expected=None):
    expected = expected or app.config.get("WHATSAPP_EXPECTED_DATABASE")
    try:
        target = validate_database_maintenance_target(app.config, expected)
    except RuntimeError:
        raise click.ClickException("Explicit WhatsApp database target must match DB_NAME and the Mongo URI path.") from None
    db = mongo.db if mongo.db is not None else mongo.cx[target]
    if str(db.name) != target:
        raise click.ClickException("Initialized database does not match the explicit target.")
    return db


def configuration_problems(config, production=False):
    problems = list(configuration_errors(config))
    try:
        lease = int(config.get("WHATSAPP_WORKER_LEASE_SECONDS", 300))
        if not 60 <= lease <= 3600:
            raise ValueError()
    except (TypeError, ValueError):
        problems.append("WHATSAPP_WORKER_LEASE_SECONDS")
    if production:
        if config.get("WHATSAPP_PRODUCTION_TEST_SEND_ENABLED", False) is not False:
            problems.append("WHATSAPP_PRODUCTION_TEST_SEND_ENABLED")
        if config.get("WHATSAPP_ORDER_NOTIFICATIONS_ENABLED", False) is not False:
            problems.append("WHATSAPP_ORDER_NOTIFICATIONS_ENABLED")
        if config.get("WHATSAPP_ENVIRONMENT") != "production":
            problems.append("WHATSAPP_ENVIRONMENT")
        for key in ("WHATSAPP_ENABLED", "WHATSAPP_TEST_SEND_ENABLED", "WHATSAPP_MARKETING_ENABLED"):
            if config.get(key) is not False:
                problems.append(key)
        if not str(config.get("RATELIMIT_STORAGE_URI") or "").startswith(("mongodb://", "mongodb+srv://", "redis://", "rediss://")):
            problems.append("RATELIMIT_STORAGE_URI")
        if config.get("WHATSAPP_CANONICAL_URL") != "https://rashikapoor.co.in":
            problems.append("WHATSAPP_CANONICAL_URL")
        try:
            validate_database_maintenance_target(config, config.get("WHATSAPP_EXPECTED_DATABASE"))
        except RuntimeError:
            problems.append("WHATSAPP_EXPECTED_DATABASE")
    return sorted(set(problems))


def emit(event, **values):
    click.echo(json.dumps({"event": event, **values}, default=str, sort_keys=True))


def register_commands(app, mongo):
    @app.cli.command("whatsapp-provider-audit")
    @click.option("--app-token-env", default=None, help="Optional environment-variable NAME containing an app access token, never the token value.")
    def provider(app_token_env):
        import requests
        from .whatsapp_provider import audit_provider
        if configuration_errors(app.config):
            raise click.ClickException("Backend Meta configuration is incomplete.")
        try:
            result = audit_provider(app.config, os.environ.get(app_token_env) if app_token_env else None)
            emit("whatsapp_provider_audit", **result)
        except (requests.RequestException, ValueError, TypeError, AttributeError):
            raise click.ClickException("Complete Meta inventory could not be read; no remote settings changed.") from None

    @app.cli.command("whatsapp-check")
    @click.option("--production", is_flag=True, help="Validate a disabled production rollout.")
    @click.option("--database", default=None, help="Also inspect indexes on this exact database.")
    def check(production, database):
        problems = configuration_problems(app.config, production)
        if database:
            try:
                problems.extend(index_problems(guarded_database(app, mongo, database)))
            except PyMongoError:
                problems.append("database_unavailable")
        emit("whatsapp_readiness", ready=not problems, problems=problems)
        if problems:
            raise click.ClickException("WhatsApp readiness checks failed; values are intentionally redacted.")

    @app.cli.command("whatsapp-indexes")
    @click.option("--database", required=True, help="Exact database name, checked against URI and DB_NAME.")
    @click.option("--apply", is_flag=True, help="Create additive indexes; never delete records or change TTL retention.")
    def indexes(database, apply):
        if app.config.get("WHATSAPP_PRODUCTION_TEST_SEND_ENABLED", False) is not False or app.config.get("WHATSAPP_ORDER_NOTIFICATIONS_ENABLED", False) is not False or any(app.config.get(k) is not False for k in ("WHATSAPP_ENABLED", "WHATSAPP_TEST_SEND_ENABLED", "WHATSAPP_MARKETING_ENABLED")):
            raise click.ClickException("All WhatsApp sending gates must be off for index maintenance.")
        try:
            db = guarded_database(app, mongo, database)
            if apply:
                version = db.client.server_info().get("version", "0")
                if int(version.split(".")[0]) < 5:
                    raise ValueError("mongodb_5_or_newer_required")
                ensure_indexes(db)
            problems = index_problems(db)
            emit("whatsapp_indexes", applied=apply, ready=not problems, problems=problems)
            if apply and problems:
                raise ValueError("index_verification_failed")
        except (PyMongoError, ValueError) as error:
            # Do not render driver exception text, URIs or duplicate values.
            kind = str(error) if isinstance(error, ValueError) and str(error).startswith(("duplicate_provider_ids", "index_definition_conflict", "retention_index_conflict", "expired_records_require_retention_review", "mongodb_5", "index_verification")) else type(error).__name__
            raise click.ClickException("WhatsApp index maintenance blocked: " + kind) from None

    @app.cli.command("whatsapp-template-refresh")
    @click.option("--database", default=None, help="Defaults to WHATSAPP_EXPECTED_DATABASE; must match the configured target.")
    def template_refresh(database):
        from .whatsapp_routes import refresh_template_observations
        import requests
        if configuration_errors(app.config):
            raise click.ClickException("Backend Meta configuration is incomplete.")
        try:
            db = guarded_database(app, mongo, database)
            refresh_template_observations(db, app.config)
            sync = (db.integrations.find_one({"_id": "whatsapp"}) or {}).get("templateStatusSync", {})
            emit("whatsapp_inventory_refreshed", pages=sync.get("pagesRead"), records=sync.get("recordsRead"), outcome=sync.get("outcome"))
        except (requests.RequestException, PyMongoError, ValueError, TypeError, AttributeError):
            raise click.ClickException("Meta inventory read/cache refresh failed; no messages were sent.") from None

    @app.cli.command("whatsapp-worker")
    def worker():
        if app.config.get("WHATSAPP_ENABLED") is not True and app.config.get("WHATSAPP_ORDER_NOTIFICATIONS_ENABLED") is not True:
            emit("whatsapp_worker", status="disabled", processed=0)
            return
        problems = configuration_problems(app.config)
        if problems:
            raise click.ClickException("Worker configuration incomplete: " + ", ".join(problems))
        stopped = threading.Event()
        previous = {}
        try:
            db = guarded_database(app, mongo)
            if not automation_enabled(db, app.config):
                emit("whatsapp_worker", status="disabled", processed=0)
                return
            missing = index_problems(db)
            if missing:
                raise click.ClickException("Worker blocked by unavailable/missing indexes: " + ", ".join(missing))
            if threading.current_thread() is threading.main_thread():
                for sig in (signal.SIGTERM, signal.SIGINT):
                    previous[sig] = signal.signal(sig, lambda *_: stopped.set())
            count = process_outbox(db, app.config, stop_requested=stopped.is_set)
            emit("whatsapp_worker", status="stopped" if stopped.is_set() else "complete", processed=count)
        except PyMongoError:
            raise click.ClickException("WhatsApp worker database unavailable; ambiguous claims require reconciliation.") from None
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)
