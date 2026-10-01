import hashlib
import hmac
import secrets
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request

from ...rbac import database


integrations_bp = Blueprint("integrations", __name__)


def _bearer_token():
    value = request.headers.get("Authorization", "")
    return value[7:] if value.startswith("Bearer ") else ""


def _token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _connection_for_token():
    token = _bearer_token()
    if not token:
        return None
    return database().service_connections.find_one({"service": "stock_linesheets", "tokenHash": _token_hash(token), "active": True, "revokedAt": {"$exists": False}})


@integrations_bp.post("/stock/connect")
def connect_stock():
    configured_secret = str(current_app.config.get("STOCK_INTEGRATION_BOOTSTRAP_SECRET") or "")
    supplied_secret = _bearer_token()
    payload = request.get_json(silent=True) or {}
    client_id = str(payload.get("client_id") or "").strip()
    expected_client = str(current_app.config.get("STOCK_INTEGRATION_CLIENT_ID") or "rk-stock-linesheets")
    if not configured_secret:
        return jsonify({"error": "Stock integration provisioning is not configured."}), 503
    if not supplied_secret or not hmac.compare_digest(supplied_secret, configured_secret) or client_id != expected_client:
        return jsonify({"error": "Service credential rejected."}), 401
    now = datetime.now(timezone.utc)
    token_hash = _token_hash(supplied_secret)
    existing = database().service_connections.find_one({"_id": f"stock_linesheets:{client_id}", "tokenHash": token_hash, "active": True, "revokedAt": {"$exists": False}})
    if existing:
        database().service_connections.update_one({"_id": existing["_id"]}, {"$set": {"lastSeenAt": now}})
        return jsonify({"status": "connected", "connection_id": existing["connectionId"], "client_id": client_id, "scopes": existing.get("scopes", [])}), 200
    connection_id = secrets.token_hex(16)
    # One document per configured client makes credential rotation atomic: the
    # old token hash and the new hash can never both be active.
    database().service_connections.update_one(
        {"_id": f"stock_linesheets:{client_id}"},
        {"$set": {"connectionId": connection_id, "service": "stock_linesheets", "clientId": client_id, "tokenHash": token_hash, "scopes": ["connection:status"], "active": True, "createdAt": now, "lastSeenAt": now}, "$unset": {"revokedAt": "", "revokedReason": ""}},
        upsert=True,
    )
    return jsonify({"status": "connected", "connection_id": connection_id, "client_id": client_id, "issued_at": now.isoformat(), "scopes": ["connection:status"]}), 201


@integrations_bp.get("/stock/status")
def stock_status():
    connection = _connection_for_token()
    if not connection:
        return jsonify({"error": "Service credential rejected."}), 401
    now = datetime.now(timezone.utc)
    return jsonify({"status": "connected", "service": "rk-web", "client_id": connection["clientId"], "connection_id": connection["connectionId"], "checked_at": now.isoformat(), "scopes": connection.get("scopes", [])}), 200


@integrations_bp.post("/stock/disconnect")
def disconnect_stock():
    connection = _connection_for_token()
    if not connection:
        return jsonify({"error": "Service credential rejected."}), 401
    now = datetime.now(timezone.utc)
    database().service_connections.update_one({"_id": connection["_id"], "active": True}, {"$set": {"active": False, "revokedAt": now, "revokedReason": "disconnected"}})
    return jsonify({"status": "disconnected", "revoked_at": now.isoformat()}), 200
