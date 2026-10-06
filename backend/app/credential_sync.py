"""RK-WEB-owned identity links and metadata-only credential sync outbox.

This module never stores password material. A password is accepted only as an
in-memory argument for one immediate provisioning request to the future
RK-STOCK receiver.
"""
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from bson import ObjectId
from flask import current_app
import jwt


OPERATIONAL_ROLES = {"admin", "staff"}
EVENT_TYPES = {"USER_CREATED", "PASSWORD_CHANGED", "PASSWORD_RESET", "USERNAME_CHANGED", "EMAIL_CHANGED", "ROLE_CHANGED", "STATUS_CHANGED"}
PASSWORD_EVENTS = {"USER_CREATED", "PASSWORD_CHANGED", "PASSWORD_RESET"}
METADATA_KEYS = {"email", "username", "role", "is_active", "credential_version", "profile_version"}


def ensure_indexes(db) -> None:
    db.user_identity_links.create_index("rk_web_user_id", unique=True, name="identity_link_web_user")
    db.user_identity_links.create_index("rk_stock_user_id", unique=True, sparse=True, name="identity_link_stock_user")
    db.credential_sync_outbox.create_index([("event_type", 1), ("source_user_id", 1), ("target_system", 1), ("credential_version", 1), ("profile_version", 1)], unique=True, name="credential_event_idempotency")
    db.credential_sync_outbox.create_index([("status", 1), ("next_attempt_at", 1)], name="credential_outbox_retry")
    if hasattr(db, "credential_sync_consumptions"):
        db.credential_sync_consumptions.create_index("event_id", unique=True, name="credential_consumption_event")
        db.credential_sync_consumptions.create_index("jti", unique=True, name="credential_consumption_jti")


def consume_handoff(db, claims: dict, *, event_type: str, source_system: str, target_system: str) -> bool:
    """Atomically record metadata for a successful handoff; never stores the token or password."""
    record = {
        "event_id": claims["event_id"], "jti": claims["jti"], "source_system": source_system,
        "target_system": target_system, "source_user_id": claims["source_user_id"],
        "target_user_id": claims["target_user_id"], "credential_version": claims["credential_version"],
        "event_type": event_type, "consumed_at": datetime.now(timezone.utc),
    }
    try:
        db.credential_sync_consumptions.insert_one(record)
        return True
    except Exception:
        return False


def eligible(user: dict | None) -> bool:
    return bool(user and user.get("role", "customer") in OPERATIONAL_ROLES)


def credential_version(user: dict | None) -> int:
    try:
        return max(0, int((user or {}).get("credentialVersion", 0)))
    except (TypeError, ValueError):
        return 0


def next_credential_version(user: dict | None) -> int:
    return credential_version(user) + 1


def ensure_identity_link(db, user: dict, *, stock_user_id=None, status="pending") -> dict | None:
    if not hasattr(db, "user_identity_links"):
        return None
    if not eligible(user):
        return None
    now = datetime.now(timezone.utc)
    web_id = user["_id"]
    link_id = f"rk-web:{web_id}"
    db.user_identity_links.update_one(
        {"_id": link_id},
        {"$set": {"rk_web_user_id": web_id, "email": user.get("email"), "username": user.get("username"), "status": status, "updated_at": now}, "$setOnInsert": {"event_id": secrets.token_hex(16), "created_at": now}},
        upsert=True,
    )
    if stock_user_id is not None:
        db.user_identity_links.update_one({"_id": link_id}, {"$set": {"rk_stock_user_id": stock_user_id}})
    return db.user_identity_links.find_one({"_id": link_id})


def queue_event(db, event_type: str, user: dict, *, metadata: dict | None = None, version: int | None = None, profile_version: int | None = None, target_user_id=None, force: bool = False) -> dict | None:
    if not hasattr(db, "credential_sync_outbox"):
        return None
    if event_type not in EVENT_TYPES or (not eligible(user) and not force):
        return None
    now = datetime.now(timezone.utc)
    version = credential_version(user) if version is None else int(version)
    source_user_id = str(user["_id"])
    profile_version = credential_version(user) if profile_version is None else int(profile_version)
    target_system = "rk-stock"
    event_id = hashlib.sha256(f"{event_type}:{source_user_id}:{target_system}:{version}:{profile_version}".encode()).hexdigest()
    safe_metadata = {key: value for key, value in (metadata or {}).items() if key in METADATA_KEYS}
    safe_metadata.update({"email": user.get("email"), "username": user.get("username"), "role": user.get("role", "customer"), "is_active": user.get("isActive", True), "credential_version": version, "profile_version": profile_version})
    document = {
        "_id": event_id, "event_id": event_id, "event_type": event_type,
        "source_system": "rk-web", "target_system": target_system, "source_user_id": source_user_id,
        "target_user_id": str(target_user_id) if target_user_id is not None else None,
        "credential_version": version, "profile_version": profile_version, "payload_metadata": safe_metadata,
        "status": "PENDING", "attempts": 0, "next_attempt_at": now,
        "last_error": None, "created_at": now, "updated_at": now,
    }
    db.credential_sync_outbox.update_one({"_id": event_id}, {"$setOnInsert": document}, upsert=True)
    return db.credential_sync_outbox.find_one({"_id": event_id})


def _mark(db, event_id: str, status: str, error: str | None = None) -> None:
    now = datetime.now(timezone.utc)
    update = {"status": status, "last_error": error, "updated_at": now}
    if status == "COMPLETED":
        update["completed_at"] = now
    db.credential_sync_outbox.update_one({"_id": event_id}, {"$set": update, "$inc": {"attempts": 1}})


def _handoff(event: dict, password: str) -> str | None:
    secret = str(current_app.config.get("CREDENTIAL_SYNC_HANDOFF_SECRET") or "")
    if not secret:
        return None
    now = int(datetime.now(timezone.utc).timestamp())
    payload = {"iss": "rk-web", "aud": "rk-stock", "event_id": event["event_id"], "event_type": event["event_type"], "source_user_id": event["source_user_id"], "target_user_id": event.get("target_user_id"), "credential_version": event["credential_version"], "profile_version": event.get("profile_version"), "iat": now, "exp": now + max(1, int(current_app.config.get("CREDENTIAL_SYNC_HANDOFF_TTL_SECONDS", 60))), "jti": secrets.token_urlsafe(24)}
    return jwt.encode(payload, secret, algorithm="HS256")


def verify_handoff(token: str, *, expected_event: dict, issuer: str = "rk-stock", audience: str = "rk-web") -> dict:
    """Verify the standard HS256 handoff claims for a future inbound receiver."""
    secret = str(current_app.config.get("CREDENTIAL_SYNC_HANDOFF_SECRET") or "")
    if not secret or not isinstance(token, str) or not token:
        raise ValueError("handoff_invalid")
    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"], issuer=issuer, audience=audience, options={"require": ["iss", "aud", "event_id", "event_type", "source_user_id", "target_user_id", "credential_version", "iat", "exp", "jti"]}, leeway=5)
    except jwt.PyJWTError as exc:
        raise ValueError("handoff_invalid") from exc
    for key in ("event_id", "event_type", "source_user_id", "target_user_id", "credential_version", "profile_version"):
        if str(claims.get(key)) != str(expected_event.get(key)):
            raise ValueError("handoff_binding_mismatch")
    return claims


def attempt_provision(db, event: dict, *, password: str | None = None) -> bool:
    """Attempt one non-persistent handoff; missing receiver config stays pending."""
    base_url = str(current_app.config.get("STOCK_CREDENTIAL_SYNC_URL") or "").strip().rstrip("/")
    service_secret = str(current_app.config.get("STOCK_CREDENTIAL_SYNC_SECRET") or "")
    if not base_url or not service_secret:
        _mark(db, event["_id"], "PENDING", "receiver_not_configured")
        return False
    if not password and event["event_type"] in PASSWORD_EVENTS:
        _mark(db, event["_id"], "PENDING", "credential_reprovision_required")
        return False
    endpoint = "/api/internal/auth/provision-credential" if password else "/api/internal/users/provision"
    if not current_app.debug and not base_url.startswith("https://"):
        _mark(db, event["_id"], "PENDING", "https_required")
        return False
    body = {"event_id": event["event_id"], "event_type": event["event_type"], "source_system": "rk-web", "target_system": "rk-stock", "source_user_id": event["source_user_id"], "target_user_id": event.get("target_user_id"), "credential_version": event["credential_version"], "profile_version": event.get("profile_version"), "payload_metadata": event["payload_metadata"]}
    if password:
        handoff = _handoff(event, password)
        if not handoff:
            _mark(db, event["_id"], "PENDING", "handoff_not_configured")
            return False
        body["credential_handoff"] = handoff
        body["password"] = password
    request = Request(base_url + endpoint, data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {service_secret}", "X-Credential-Sync-Scope": "credential:sync", "Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=5) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError("receiver_http_error")
            result = json.loads(response.read().decode() or "{}")
            if result.get("event_id") != event["event_id"] or result.get("event_type") != event["event_type"] or result.get("status") not in {"APPLIED", "ALREADY_APPLIED", "STALE"}:
                raise RuntimeError("invalid_receiver_response")
        _mark(db, event["_id"], "COMPLETED")
        return True
    except (HTTPError, URLError, TimeoutError, RuntimeError):
        _mark(db, event["_id"], "PENDING", "receiver_unavailable")
        return False


def sync_event(db, event_type: str, user: dict, *, password: str | None = None, version: int | None = None, metadata: dict | None = None, force: bool = False) -> dict | None:
    event = queue_event(db, event_type, user, metadata=metadata, version=version, force=force)
    if event:
        ensure_identity_link(db, user)
        try:
            attempt_provision(db, event, password=password)
        except Exception:
            # Synchronization is secondary; local authentication/mutations must
            # remain successful when the receiver or transport is unavailable.
            _mark(db, event["_id"], "PENDING", "receiver_unavailable")
    return event


def retry_pending(db, limit: int = 20) -> int:
    """Retry metadata/profile events only; password events require fresh input."""
    now = datetime.now(timezone.utc)
    events = db.credential_sync_outbox.find({"status": "PENDING", "next_attempt_at": {"$lte": now}}).limit(limit)
    completed = 0
    for event in events:
        if event.get("event_type") in {"PASSWORD_CHANGED", "PASSWORD_RESET", "USER_CREATED"}:
            _mark(db, event["_id"], "PENDING", "credential_reprovision_required")
            continue
        if attempt_provision(db, event):
            completed += 1
    return completed
