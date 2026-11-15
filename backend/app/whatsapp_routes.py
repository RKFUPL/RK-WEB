"""Public authenticated webhooks and admin-only WhatsApp operations."""
import hashlib
import hmac
import json
import re
import html
from datetime import datetime, timezone

import requests
from flask import Blueprint, current_app, jsonify, request
from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from .extensions import limiter
from .rbac import current_user, database, requireAdmin
from .time_utils import json_value
from .whatsapp import automation_enabled, order_notifications_enabled
from .whatsapp_templates import template_registry, components_match, component_signature, meta_status, test_parameter_fields, observation_is_stale
from .whatsapp_consent import withdraw_from_inbound
from .whatsapp_marketing_consent import withdraw_marketing_from_inbound
from .whatsapp_catalogue import CATALOGUE
from .whatsapp_definitions import definitions, definition_components, canonical_origin
from .whatsapp import (configuration_errors, fingerprint, now, registry, send, send_text, notify, notify_admins,
                       test_send_enabled, template_test_enabled, production_test_state, production_test_block,
                       callback_configuration, customer_window, CUSTOMER_MESSAGE_TYPES, normalize_phone)

webhook_bp = Blueprint("whatsapp_webhook", __name__)
admin_bp = Blueprint("whatsapp_admin", __name__)
FIELDS = {"messages", "account_update", "account_alerts", "phone_number_quality_update", "phone_number_name_update", "message_template_status_update", "message_template_quality_update"}

_INTEGRATION_TEMPLATE = "3p_direct_integration_test_template"
_DRAFT_EXPLANATIONS = {
    "rk_authentication_otp": "Local Authentication draft. Meta previously denied Authentication-template creation for this WABA; this was not submitted and is not an approval status.",
    "rk_exclusive_offer": "Local Marketing draft blocked until checkout has an integrated, validated coupon and promotion system; it was not submitted.",
    "rk_admin_notification": "Internal-only notification draft. It is excluded from the customer-facing template catalogue and was not submitted.",
}
_TRANSACTIONAL_EVENTS = {"order_confirmation", "payment_confirmation", "shipped", "out_for_delivery", "delivered", "cancelled", "refund_completed"}


def _template_group(name, category, event=None):
    if name == _INTEGRATION_TEMPLATE or event == "test":
        return "Integration Test"
    if category == "AUTHENTICATION":
        return "Authentication"
    if category == "MARKETING":
        return "Marketing"
    if event == "admin_notification" or name == "rk_admin_notification":
        return "Internal only"
    if event in _TRANSACTIONAL_EVENTS or name in {"rk_" + item for item in _TRANSACTIONAL_EVENTS} or name.startswith(("rk_order_", "rk_payment_", "rk_refund_")):
        return "Transactional"
    return "Optional lifecycle drafts"


def _quality_rating(value):
    """Return Meta's independent quality score without treating it as status."""
    score = value.get("score") if isinstance(value, dict) else value
    return score if isinstance(score, str) and score in {"GREEN", "YELLOW", "RED", "UNKNOWN"} else None


def _state(db, **values):
    db.integrations.update_one({"_id": "whatsapp"}, {"$set": values}, upsert=True)


def _safe_template_components(value):
    """Keep the exact component contract while dropping provider examples."""
    if not isinstance(value, list) or len(value) > 20:
        return []
    def clean(item, depth=0):
        if depth > 8:
            return None
        if isinstance(item, dict):
            return {key: clean(child, depth + 1) for key, child in item.items()
                    if key != "example" and isinstance(key, str) and len(key) <= 100}
        if isinstance(item, list):
            return [clean(child, depth + 1) for child in item[:100]]
        if isinstance(item, str):
            return item[:5000]
        if item is None or isinstance(item, (bool, int, float)):
            return item
        return None
    return [clean(item) for item in value if isinstance(item, dict)]


def safe_status(db):
    config = current_app.config
    state = db.integrations.find_one({"_id": "whatsapp"}) or {}
    missing = configuration_errors(config)
    templates = template_registry(db, config)
    for event, item in templates.items():
        ready = item["approved"] and not missing
        item["mappingEnabled"] = bool(item.get("enabled"))
        test_fields = test_parameter_fields(item) if item.get("componentsVerified") else None
        item["testParameterFields"] = test_fields or []
        item["eligibleForTesting"] = bool(ready and test_fields is not None and item["category"] == "UTILITY"
            and item.get("requiresMetaApproval") is True and item.get("approvalSource") == "meta_api_read"
            and not item.get("statusStale") and template_test_enabled(config))
        item["eligibleForAutomation"] = bool(item["enabled"] and ready and automation_enabled(db, config, event)
            and (item["category"] != "MARKETING" or config.get("WHATSAPP_MARKETING_ENABLED") is True))
    catalogue = {}
    mapped_by_key = {}
    for item in templates.values():
        if item.get("name") and item.get("language"):
            mapped_by_key[(item["name"], item["language"])] = item
    for name, spec in definitions(config).items():
        components = definition_components(spec)
        observed = db.whatsapp_template_status.find_one({"_id": name + ":" + spec["language"]}) or {}
        mapping = mapped_by_key.get((name, spec["language"]))
        same_account = bool(observed and observed.get("businessAccountId") == str(config.get("WHATSAPP_BUSINESS_ACCOUNT_ID") or ""))
        sync = state.get("templateStatusSync") or {}
        stale = observation_is_stale(observed, sync, config.get("WHATSAPP_BUSINESS_ACCOUNT_ID"))
        local_draft = bool(observed and observed.get("presentInMeta") is False and spec.get("approvalStatus") == "NOT_SUBMITTED")
        catalogue[name] = {**spec, "components": components, "observedStatus": observed.get("status", "MISSING_OR_UNKNOWN"),
                           "metaComponents": observed.get("metaComponents", []),
                           "componentMismatches": observed.get("mismatches", []),
                           "componentsVerified": bool(same_account and not stale and observed.get("componentSignature") == component_signature(components) and observed.get("componentsVerified") is True),
                           "approvalCheckedAt": observed.get("checkedAt"), "statusEvidence": observed.get("evidenceState", "not_checked"),
                           "statusStale": stale, "presentInMeta": observed.get("presentInMeta"),
                           "qualityRating": observed.get("qualityRating"),
                           "locallyMapped": bool(mapping and mapping.get("configured")),
                           "mappingEnabled": bool(mapping and mapping.get("enabled")),
                           "localDraft": local_draft,
                           "draftExplanation": _DRAFT_EXPLANATIONS.get(name, "Local definition is absent from the last complete Meta inventory and has not been submitted." if local_draft else None),
                           "templateGroup": _template_group(name, spec["category"], (spec.get("events") or [None])[0]),
                           "enabled": bool(mapping and mapping.get("enabled"))}
    sync = state.get("templateStatusSync") or {}
    unmapped = list(db.whatsapp_template_status.find({"businessAccountId": str(config.get("WHATSAPP_BUSINESS_ACCOUNT_ID") or ""),
        "evidenceState": "found_not_locally_mapped"}, {"_id": 0, "name": 1, "language": 1, "status": 1,
        "category": 1, "checkedAt": 1, "evidenceState": 1, "qualityRating": 1}).limit(100))
    return {"enabled": config.get("WHATSAPP_ENABLED") is True and state.get("enabled") is True,
            "orderNotificationsEnabled": order_notifications_enabled(db, config),
            "orderNotificationsEnvironmentEnabled": config.get("WHATSAPP_ORDER_NOTIFICATIONS_ENABLED") is True,
            "orderNotificationsAdminEnabled": state.get("orderNotificationsEnabled") is True,
            "environmentEnabled": config.get("WHATSAPP_ENABLED") is True,
            "configured": not missing, "missing": missing,
            "phoneNumberId": config.get("WHATSAPP_PHONE_NUMBER_ID", ""),
            "businessPhoneNumber": state.get("businessPhoneNumber", ""),
            "businessAccountId": config.get("WHATSAPP_BUSINESS_ACCOUNT_ID", ""),
            "apiVersion": config.get("WHATSAPP_API_VERSION", ""),
            "testSendEnabled": test_send_enabled(config), **callback_configuration(config),
            "productionTest": production_test_state(config),
            **{k: state.get(k) for k in ("verifiedAt", "lastWebhook", "lastApiSuccess", "lastError", "subscriptionStatus", "subscriptionCheckedAt")},
            "templates": templates, "catalogue": catalogue, "unmappedTemplates": unmapped,
            "templateStatusSync": sync, "marketingEnabled": config.get("WHATSAPP_MARKETING_ENABLED") is True}


@webhook_bp.get("/whatsapp")
@limiter.exempt
def verify():
    expected = current_app.config.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "")
    supplied = request.args.get("hub.verify_token", "")
    challenge = request.args.get("hub.challenge", "")
    if not expected or request.args.get("hub.mode") != "subscribe" or not challenge or len(challenge) > 512 or not hmac.compare_digest(str(expected).encode(), supplied.encode()):
        return "Forbidden", 403
    _state(database(), verifiedAt=now())
    return challenge, 200, {"Content-Type": "text/plain", "Cache-Control": "no-store"}


def _identifier(value):
    return value if isinstance(value, str) and len(value) <= 250 else ""


_STATUS_RANK = {"sending": -1, "unknown": 0, "accepted": 0, "sent": 1, "failed": 2, "delivered": 3, "read": 4}


def _status_timestamp(value):
    """Parse Meta's Unix-seconds timestamp without trusting arbitrary input."""
    raw = str(value).strip() if isinstance(value, (str, int)) and not isinstance(value, bool) else ""
    if not re.fullmatch(r"[0-9]{1,12}", raw):
        return None
    try:
        return datetime.fromtimestamp(int(raw), timezone.utc)
    except (ValueError, OverflowError, OSError):
        return None


def _safe_status_errors(errors):
    """Keep stable Meta error codes only; discard free text that may contain PII."""
    if not isinstance(errors, list):
        return []
    safe = []
    for error in errors[:5]:
        if not isinstance(error, dict):
            continue
        item = {"kind": "delivery_failed"}
        code = error.get("code")
        subcode = error.get("error_subcode")
        if isinstance(code, int) and not isinstance(code, bool) and 0 <= code <= 2_147_483_647:
            item["code"] = code
        if isinstance(subcode, int) and not isinstance(subcode, bool) and 0 <= subcode <= 2_147_483_647:
            item["subcode"] = subcode
        safe.append(item)
    return safe


def _record_status(db, config, status, correlation=None):
    mid, state = _identifier(status.get("id")), status.get("status")
    if not mid or state not in {"sent", "delivered", "read", "failed"}:
        return

    received_at = now()
    raw_timestamp = status.get("timestamp")
    timestamp_text = str(raw_timestamp).strip()[:32] if isinstance(raw_timestamp, (str, int)) and not isinstance(raw_timestamp, bool) else ""
    provider_timestamp = _status_timestamp(raw_timestamp)
    event_timestamp = provider_timestamp or received_at
    recipient_id = status.get("recipient_id")
    recipient_id = recipient_id if isinstance(recipient_id, str) and re.fullmatch(r"[1-9][0-9]{6,14}", recipient_id) else ""
    recipient_hash = fingerprint("+" + recipient_id, config) if recipient_id else ""
    safe_errors = _safe_status_errors(status.get("errors"))
    event_identity = json.dumps([mid, state, timestamp_text, recipient_hash, safe_errors], separators=(",", ":"), sort_keys=True)
    event_id = hashlib.sha256(event_identity.encode()).hexdigest()
    masked_recipient = "***" + recipient_id[-4:] if recipient_id else None
    history_entry = {
        "eventId": event_id, "id": mid, "status": state,
        "timestamp": event_timestamp, "timestampSource": "meta" if provider_timestamp else "received",
        "receivedAt": received_at, "recipientId": masked_recipient, "errors": safe_errors,
    }
    db.whatsapp_events.update_one({"_id": event_id}, {"$setOnInsert": {
        "type": state, "status": state, "providerId": mid, "timestamp": event_timestamp,
        "timestampSource": history_entry["timestampSource"], "recipientId": masked_recipient,
        "errors": safe_errors, "receivedAt": received_at, "matched": False,
    }}, upsert=True)

    # Prefer Meta's exact wamid. The opaque correlation is only a recovery path
    # for the narrow race where a signed status arrives before the send response
    # has saved that wamid on its still-sending record.
    message = db.whatsapp_messages.find_one({"providerId": mid})
    match_by_correlation = False
    if message is None and isinstance(correlation, str) and re.fullmatch(r"[a-f0-9]{64}", correlation):
        message = db.whatsapp_messages.find_one({
            "_id": correlation, "status": "sending",
            "$or": [{"providerId": {"$exists": False}}, {"providerId": None}],
        })
        match_by_correlation = message is not None
    if not message:
        return
    if recipient_hash and message.get("recipientHash") and not hmac.compare_digest(recipient_hash, str(message["recipientHash"])):
        return

    message_query = {"_id": message["_id"]}
    if recipient_hash and message.get("recipientHash"):
        message_query["recipientHash"] = message["recipientHash"]
    if match_by_correlation:
        message_query["$or"] = [{"providerId": {"$exists": False}}, {"providerId": None}, {"providerId": mid}]
    else:
        message_query["providerId"] = mid

    failure_details = {"kind": "delivery_failed", "errors": safe_errors}
    # One document update commits history, milestones and monotonic projection
    # together. Replay also repairs records left partial by the old handler.
    history = {"$ifNull": ["$statusHistory", []]}
    fresh = {"$eq": [{"$in": [event_id, {"$ifNull": ["$statusHistory.eventId", []]}]}, False]}
    current_rank = {"$switch": {"branches": [
        {"case": {"$eq": ["$status", name]}, "then": rank}
        for name, rank in _STATUS_RANK.items()
    ], "default": -1}}
    advance = {"$gte": [_STATUS_RANK[state], current_rank]}
    timestamp_field = state + "At"
    earliest = {"$cond": [{"$or": [
        {"$eq": [{"$ifNull": ["$" + timestamp_field, None]}, None]},
        {"$gt": ["$" + timestamp_field, event_timestamp]},
    ]}, {"$literal": event_timestamp}, "$" + timestamp_field]}
    values = {
        "providerId": {"$literal": mid}, "updatedAt": {"$literal": received_at},
        "statusHistory": {"$cond": [fresh, {"$concatArrays": [history, {"$literal": [history_entry]}]}, history]},
        timestamp_field: earliest,
        "status": {"$cond": [advance, state, "$status"]},
        "error": {"$cond": [advance, {"$literal": failure_details if state == "failed" else None}, {"$ifNull": ["$error", None]}]},
    }
    if state == "failed":
        values["failureDetails"] = {"$literal": failure_details}
    applied = db.whatsapp_messages.update_one(message_query, [{"$set": values}])
    if applied.matched_count:
        db.whatsapp_events.update_one({"_id": event_id}, {"$set": {"matched": True, "messageRecordId": str(message["_id"])}})


def _receive(db, payload):
    config = current_app.config
    if not isinstance(payload, dict) or payload.get("object") != "whatsapp_business_account" or not isinstance(payload.get("entry"), list):
        raise ValueError("invalid_payload")
    for entry in payload["entry"]:
        if not isinstance(entry, dict) or str(entry.get("id")) != str(config.get("WHATSAPP_BUSINESS_ACCOUNT_ID")):
            continue
        if not isinstance(entry.get("changes", []), list):
            raise ValueError("invalid_changes")
        for change in entry.get("changes", []):
            if not isinstance(change, dict):
                raise ValueError("invalid_change")
            value = change.get("value", {})
            field = change.get("field")
            if field not in FIELDS or not isinstance(value, dict):
                continue
            if field != "messages":
                # Store event identity/type, never raw account or phone details.
                event_id = hashlib.sha256(json.dumps(change, sort_keys=True).encode()).hexdigest()
                db.whatsapp_events.update_one({"_id": event_id}, {"$setOnInsert": {"type": field, "receivedAt": now(), "processed": False}}, upsert=True)
                event_record = db.whatsapp_events.find_one({"_id": event_id})
                if field == "message_template_status_update" and not event_record.get("processed"):
                    name, language, state = value.get("message_template_name"), value.get("message_template_language"), value.get("event")
                    if isinstance(name, str) and re.fullmatch(r"[a-z0-9_]{1,512}", name) and isinstance(language, str) and re.fullmatch(r"[a-z]{2,3}(?:_[A-Z]{2})?", language):
                        # Approval events require a fresh account read; a stale
                        # APPROVED webhook must not resurrect a revoked mapping.
                        state = state if state in {"REJECTED", "PAUSED", "DISABLED", "DELETED", "PENDING"} else "PENDING_CONFIRMATION"
                        db.whatsapp_template_status.update_one({"_id": name + ":" + language}, {"$set": {"status": state, "checkedAt": now(), "source": "signed_webhook"}}, upsert=True)
                    db.whatsapp_events.update_one({"_id": event_id}, {"$set": {"processed": True}})
                continue
            metadata = value.get("metadata") or {}
            if not isinstance(metadata, dict) or str(metadata.get("phone_number_id")) != str(config.get("WHATSAPP_PHONE_NUMBER_ID")):
                continue
            messages, statuses = value.get("messages", []), value.get("statuses", [])
            if not isinstance(messages, list) or not isinstance(statuses, list):
                raise ValueError("invalid_events")
            for message in messages:
                if not isinstance(message, dict):
                    raise ValueError("invalid_message")
                mid, sender = _identifier(message.get("id")), _identifier(message.get("from"))
                if not mid or not re.fullmatch(r"[1-9][0-9]{6,14}", sender):
                    continue
                # Provider timestamps prevent a replay opening a new 24h window.
                from datetime import datetime, timezone
                try:
                    received = datetime.fromtimestamp(int(message.get("timestamp", "0")), timezone.utc)
                    received = min(received, now())
                except (ValueError, TypeError, OverflowError, OSError):
                    continue
                kind = message.get("type") if message.get("type") in CUSTOMER_MESSAGE_TYPES else "other"
                text = message.get("text") or {}
                command = str(text.get("body", "")).strip().casefold() if isinstance(text, dict) else ""
                is_optout = kind == "text" and command in {"stop", "stopall", "unsubscribe", "cancel", "end", "quit"}
                interactive = message.get("interactive") or {}
                reply = interactive.get("button_reply") or {} if isinstance(interactive, dict) else {}
                marketing_optout = command in {"stop marketing", "unsubscribe marketing"} or (isinstance(reply, dict) and reply.get("id") == "whatsapp_marketing_unsubscribe")
                inbox_id = hashlib.sha256(mid.encode()).hexdigest()
                db.whatsapp_inbox.update_one({"_id": inbox_id}, {"$setOnInsert": {
                    "recipientHash": fingerprint("+" + sender, config), "type": kind, "receivedAt": received,
                    "verified": True, "phoneNumberId": str(config["WHATSAPP_PHONE_NUMBER_ID"]),
                    "businessAccountId": str(config["WHATSAPP_BUSINESS_ACCOUNT_ID"]),
                    "optout": is_optout, "optoutProcessed": False,
                    "marketingOptout": bool(marketing_optout), "marketingOptoutProcessed": False,
                }}, upsert=True)
                saved = db.whatsapp_inbox.find_one({"_id": inbox_id})
                if saved.get("optout") and not saved.get("optoutProcessed"):
                    withdraw_from_inbound(db, config, "+" + sender, saved["receivedAt"])
                    db.whatsapp_inbox.update_one({"_id": inbox_id}, {"$set": {"optoutProcessed": True}})
                if saved.get("marketingOptout") and not saved.get("marketingOptoutProcessed"):
                    withdraw_marketing_from_inbound(db, config, "+" + sender, saved["receivedAt"])
                    db.whatsapp_inbox.update_one({"_id": inbox_id}, {"$set": {"marketingOptoutProcessed": True}})
            for status in statuses:
                if not isinstance(status, dict):
                    raise ValueError("invalid_status")
                _record_status(db, config, status, status.get("biz_opaque_callback_data"))


@webhook_bp.post("/whatsapp")
@limiter.exempt
def receive():
    if request.content_length is not None and request.content_length > 1_048_576:
        return jsonify(error="Payload too large"), 413
    # Limit reads even for a request without Content-Length.
    raw = request.stream.read(1_048_577)
    if len(raw) > 1_048_576:
        return jsonify(error="Payload too large"), 413
    secret = current_app.config.get("WHATSAPP_APP_SECRET", "")
    signature = request.headers.get("X-Hub-Signature-256", "")
    expected = "sha256=" + hmac.new(str(secret).encode(), raw, hashlib.sha256).hexdigest()
    if not secret or not hmac.compare_digest(expected.encode(), signature.encode()):
        return jsonify(error="Invalid signature"), 403
    db = database()
    try:
        _receive(db, json.loads(raw))
    except (ValueError, TypeError):
        return jsonify(error="Invalid webhook payload"), 400
    # Database failures propagate as non-2xx so Meta can redeliver.
    _state(db, lastWebhook=now())
    return jsonify(received=True), 200


@admin_bp.after_request
def private(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@admin_bp.get("")
@requireAdmin
def status():
    return jsonify(json_value(safe_status(database())))


@admin_bp.patch("")
@requireAdmin
@limiter.limit("10 per minute")
def configure():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or set(payload) not in ({"enabled"}, {"orderNotificationsEnabled"}) or not isinstance(next(iter(payload.values())), bool):
        return jsonify(error="Only one boolean enabled or orderNotificationsEnabled value is accepted."), 400
    key = next(iter(payload))
    gate = "WHATSAPP_ORDER_NOTIFICATIONS_ENABLED" if key == "orderNotificationsEnabled" else "WHATSAPP_ENABLED"
    if payload[key] and (current_app.config.get(gate) is not True or configuration_errors(current_app.config)):
        return jsonify(error="Complete backend configuration and enable the environment gate first."), 409
    _state(database(), **{key: payload[key]}, updatedAt=now(), updatedBy=str(current_user()["_id"]))
    return jsonify(json_value(safe_status(database())))


@admin_bp.post("/test-connection")
@requireAdmin
@limiter.limit("5 per minute")
def test_connection():
    config, db = current_app.config, database()
    if configuration_errors(config):
        return jsonify(error="Backend configuration is incomplete."), 409
    try:
        base = f"https://graph.facebook.com/{config['WHATSAPP_API_VERSION']}"
        headers = {"Authorization": "Bearer " + config["WHATSAPP_ACCESS_TOKEN"]}
        phone = requests.get(f"{base}/{config['WHATSAPP_PHONE_NUMBER_ID']}", headers=headers, timeout=(3.05, 10), allow_redirects=False)
        phone.raise_for_status()
        phone_data = phone.json()
        display_phone_number = phone_data.get("display_phone_number", "") if isinstance(phone_data, dict) else ""
        if not isinstance(display_phone_number, str) or len(display_phone_number) > 40:
            display_phone_number = ""
        subscribed = requests.get(f"{base}/{config['WHATSAPP_BUSINESS_ACCOUNT_ID']}/subscribed_apps", headers=headers, timeout=(3.05, 10), allow_redirects=False)
        subscribed.raise_for_status()
        data = subscribed.json()["data"]
        if not isinstance(data, list):
            raise ValueError()
        attached = any(str((item.get("whatsapp_business_api_data") or {}).get("id")) == str(config["WHATSAPP_APP_ID"]) for item in data if isinstance(item, dict))
        _state(db, lastApiSuccess=now(), lastError=None, businessPhoneNumber=display_phone_number,
               subscriptionStatus="subscribed" if attached else "not_subscribed", subscriptionCheckedAt=now())
        return jsonify(json_value(safe_status(db)))
    except (requests.RequestException, ValueError, KeyError, TypeError):
        _state(db, lastError={"kind": "connection_check_failed"}, subscriptionStatus="unknown", subscriptionCheckedAt=now())
        return jsonify(error="Meta connection check failed. Check credentials, IDs and permissions."), 502


@admin_bp.post("/test-send")
@requireAdmin
@limiter.shared_limit("3 per minute; 10 per hour", scope="whatsapp-test-sends")
def test_send():
    payload = request.get_json(silent=True)
    if (not isinstance(payload, dict) or payload.get("confirmed") is not True
            or not re.fullmatch(r"[A-Za-z0-9-]{16,80}", str(payload.get("requestId", "")))):
        return jsonify(error="Confirm this one-off test and provide a request ID."), 400
    production_test = current_app.config.get("WHATSAPP_ENVIRONMENT") == "production"
    if production_test:
        if payload.get("recipientConsentVerified") is not True:
            return jsonify(error="Confirm that you verified the recipient provided this number and agreed to receive WhatsApp messages from this business."), 400
        blocked = production_test_block(current_app.config, payload.get("recipient"))
        if blocked:
            return _test_response({"status": "skipped", "reason": blocked})
    elif not test_send_enabled(current_app.config):
        return _test_response({"status": "skipped", "reason": "test_send_disabled"})
    config, db = current_app.config, database()
    event = payload.get("event")
    item = template_registry(db, config).get(event) if isinstance(event, str) else None
    if (not item or item["category"] != "UTILITY" or item.get("name") != payload.get("templateName")
            or item.get("language") != payload.get("language")):
        return jsonify(error="Select an exact configured Utility template name and language."), 400
    fields = test_parameter_fields(item) if item.get("componentsVerified") else None
    if (not item.get("approved") or item.get("statusStale") or item.get("approvalSource") != "meta_api_read"
            or not item.get("componentsVerified") or fields is None):
        return _test_response({"status": "skipped", "reason": "template_not_approved_or_enabled"})
    try:
        normalized_recipient = normalize_phone(payload.get("recipient"))
    except ValueError:
        return _test_response({"status": "skipped", "reason": "invalid_recipient"})
    if payload.get("recipient") != normalized_recipient or not re.fullmatch(r"\+[1-9][0-9]{6,14}", normalized_recipient):
        return _test_response({"status": "skipped", "reason": "invalid_recipient"})
    if production_test:
        actor_id = str(current_user()["_id"])
        recipient_hash = fingerprint(normalized_recipient, config)
        audit_id = f"production-test-consent:{actor_id}:{payload['requestId']}:{recipient_hash}"
        db.whatsapp_admin_audit.update_one({"_id": audit_id}, {"$setOnInsert": {
            "action": "production_template_test_consent_attestation",
            "actorId": actor_id,
            "requestId": payload["requestId"],
            "recipientHash": recipient_hash,
            "recipientMasked": "***" + normalized_recipient[-4:],
            "operatorVerifiedNumberAndWhatsAppConsent": True,
            "consentEvidenceType": "operator_attestation_not_system_verified",
            "recordedAt": now(),
        }}, upsert=True)
    result = send(db, config, payload.get("recipient"), event, {},
                  f"test:{current_user()['_id']}:{payload['requestId']}", test_send=True, consent=True,
                  test_parameters=payload.get("parameters"), production_test=production_test)
    return _test_response(result)


def _test_response(result):
    explanations = {
        "test_send_disabled": "Local test sending is off. Enable WHATSAPP_TEST_SEND_ENABLED only in the development backend.",
        "no_consent": "Confirm that this recipient consented before sending.",
        "service_window_closed": "The 24-hour service window is closed. The recipient must first message this business, or use an approved template.",
        "invalid_recipient": "Enter a valid international phone number with its country code.",
        "invalid_text": "Enter a message containing 1 to 4096 characters, including at least one non-whitespace character.",
        "configuration_incomplete": "Complete the backend Meta API configuration before testing.",
        "template_not_approved_or_enabled": "A test requires this exact Utility template to be currently approved by Meta with verified components. Automated mapping enablement is not required.",
        "missing_template_parameters": "Required template parameters are missing or invalid.",
        "recipient_opted_out": "This recipient has opted out. Obtain fresh consent through the account preferences before sending.",
        "production_test_disabled": "Restricted production template testing is off.",
        "production_test_unsafe_gates": "Production testing requires automated, marketing and development sending gates to remain off.",
        "production_test_recipient_invalid": "Enter one valid normalized E.164 recipient number.",
        "production_test_expiry_invalid": "Configure an explicit ISO 8601 UTC production test expiry in the backend.",
        "production_test_expired": "Restricted production template testing has expired.",
        "production_test_expiry_too_far": "The production test expiry must be no more than 24 hours from the current UTC time.",
    }
    if result.get("reason") in explanations:
        result = {**result, "explanation": explanations[result["reason"]]}
    status_code = 200 if result["status"] in {"accepted", "duplicate"} else 502
    if result.get("reason"):
        status_code = 403 if result["reason"] == "test_send_disabled" or result["reason"].startswith("production_test_") else 400 if result["reason"] in {"no_consent", "invalid_recipient", "invalid_text"} else 409
    if (result.get("error") or {}).get("kind") == "rate_limited":
        status_code = 429
    return jsonify(json_value(result)), status_code


@admin_bp.post("/template-status")
@requireAdmin
@limiter.limit("5 per minute")
def refresh_template_status():
    """Read Meta status only; never submit, approve, enable, or send templates."""
    config, db = current_app.config, database()
    if configuration_errors(config):
        return jsonify(error="Backend configuration is incomplete."), 409
    try:
        refresh_template_observations(db, config)
    except (requests.RequestException, ValueError, TypeError, AttributeError):
        return jsonify(error="Unable to read a complete Meta template inventory. Previous verified statuses are retained and marked stale.",
                       status=json_value(safe_status(db))), 502
    return jsonify(json_value(safe_status(db)))


def refresh_template_observations(db, config):
    """Refresh provider evidence only; never mutate template configuration."""
    started = now()
    previous_sync = (db.integrations.find_one({"_id": "whatsapp"}) or {}).get("templateStatusSync") or {}
    _state(db, templateStatusSync={"lastAttemptAt": started, "lastSuccessAt": previous_sync.get("lastSuccessAt"),
                                  "lastError": None, "outcome": "in_progress"})
    from .whatsapp_provider import read_inventory
    try:
        observed, pages_read = read_inventory(config)
    except (requests.RequestException, ValueError, TypeError, AttributeError):
        _state(db, templateStatusSync={"lastAttemptAt": started, "lastSuccessAt": previous_sync.get("lastSuccessAt"),
                                      "lastError": "meta_inventory_unavailable_or_incomplete", "outcome": "failed"})
        raise
    known = {}
    for name, spec in definitions(config).items():
        expected = {**spec, "components": definition_components(spec), "requiresMetaApproval": True}
        known[(name, spec["language"])] = expected
    for template in registry(config).values():
        if not template.get("name") or not template.get("language"):
            continue
        key = (template["name"], template["language"])
        if key in known:
            # Preserve the exact local component contract when the registry
            # event mapping and submission definition refer to the same name.
            known[key]["requiresMetaApproval"] = True
        else:
            known[key] = template

    checked = now()
    account_id = str(config.get("WHATSAPP_BUSINESS_ACCOUNT_ID") or "")
    for key, template in known.items():
        name, language = key
        row = observed.get(key)
        previous = db.whatsapp_template_status.find_one({"_id": name + ":" + language}) or {}
        status = meta_status(row.get("status")) if row else "MISSING_OR_UNKNOWN"
        present = row is not None
        exact_components = bool(row and template.get("requiresMetaApproval")
                                and components_match(template.get("components", []), row.get("components")))
        if row and (status == "MISSING_OR_UNKNOWN" or row.get("category") not in {"UTILITY", "AUTHENTICATION", "MARKETING"}):
            evidence = "found_with_unknown_provider_status_or_category"
        elif present:
            evidence = "found"
        elif not previous and template.get("approvalStatus") == "NOT_SUBMITTED":
            evidence = "local_definition_not_found_in_complete_inventory"
        else:
            evidence = "absent_from_complete_inventory"
        db.whatsapp_template_status.update_one({"_id": name + ":" + language}, {"$set": {
            "name": name, "language": language, "status": status,
            "category": row.get("category") if row and row.get("category") in {"UTILITY", "AUTHENTICATION", "MARKETING"} else "UNKNOWN",
            "qualityRating": _quality_rating(row.get("quality_score")) if row else None,
            "presentInMeta": present, "evidenceState": evidence, "businessAccountId": account_id,
            "componentsVerified": exact_components,
            "componentSignature": component_signature(template.get("components", [])) if exact_components else None,
            "components": template.get("components", []) if exact_components else [],
            "metaComponents": _safe_template_components(row.get("components")) if row else [],
            "mismatches": [] if exact_components else (["component_definition_mismatch"] if present else ["not_found_in_complete_inventory"]),
            "checkedAt": checked, "source": "meta_api_read"}}, upsert=True)

    for key, row in observed.items():
        if key in known:
            continue
        db.whatsapp_template_status.update_one({"_id": key[0] + ":" + key[1]}, {"$set": {
            "name": key[0], "language": key[1], "status": meta_status(row.get("status")),
            "category": row.get("category") if row.get("category") in {"UTILITY", "AUTHENTICATION", "MARKETING"} else "UNKNOWN",
            "qualityRating": _quality_rating(row.get("quality_score")),
            "presentInMeta": True, "evidenceState": "found_not_locally_mapped", "businessAccountId": account_id,
            "componentsVerified": False, "componentSignature": None, "components": [],
            "metaComponents": _safe_template_components(row.get("components")), "mismatches": [],
            "checkedAt": checked, "source": "meta_api_read"}}, upsert=True)
    _state(db, templateStatusSync={"lastAttemptAt": started, "lastSuccessAt": checked,
                                  "lastError": None, "outcome": "complete", "pagesRead": pages_read,
                                  "recordsRead": len(observed)})


@admin_bp.post("/test-window")
@requireAdmin
@limiter.limit("30 per minute")
def test_window():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Provide a recipient phone number."), 400
    try:
        result = customer_window(database(), current_app.config, payload.get("recipient"))
    except ValueError:
        return jsonify(validRecipient=False, open=False, error="Enter a valid international phone number."), 400
    return jsonify(json_value({**result, "testSendEnabled": test_send_enabled(current_app.config)}))


@admin_bp.post("/test-message")
@requireAdmin
@limiter.shared_limit("3 per minute; 10 per hour", scope="whatsapp-test-sends")
def test_message():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not re.fullmatch(r"[A-Za-z0-9-]{16,80}", str(payload.get("requestId", ""))):
        return jsonify(error="Provide a test request ID."), 400
    if not test_send_enabled(current_app.config):
        return _test_response({"status": "skipped", "reason": "test_send_disabled"})
    if payload.get("confirmed") is not True:
        return _test_response({"status": "skipped", "reason": "no_consent"})
    message = payload.get("message")
    if not isinstance(message, str) or not message.strip() or len(message) > 4096:
        return _test_response({"status": "skipped", "reason": "invalid_text"})
    result = send_text(database(), current_app.config, payload.get("recipient"), message,
                       f"test-text:{current_user()['_id']}:{payload['requestId']}", consent=True, test_send=True)
    return _test_response(result)


@admin_bp.get("/messages")
@requireAdmin
def logs():
    query = {}
    state, kind = request.args.get("status"), request.args.get("type")
    from .whatsapp import STATUSES
    if state:
        if state not in STATUSES:
            return jsonify(error="Invalid status filter"), 400
        query["status"] = state
    if kind:
        if kind not in {*registry(current_app.config), "text"}:
            return jsonify(error="Invalid type filter"), 400
        query["type"] = kind
    try:
        page = max(1, min(10000, int(request.args.get("page", "1"))))
    except ValueError:
        return jsonify(error="Invalid page"), 400
    projection = {k: 1 for k in ("recipient", "type", "template", "orderId", "status", "createdAt", "acceptedAt", "sentAt", "deliveredAt", "readAt", "failedAt", "error", "failureDetails", "statusHistory", "providerId", "httpStatus", "testSend", "attempts")}
    records = list(database().whatsapp_messages.find(query, projection).sort("createdAt", -1).skip((page - 1) * 50).limit(51))
    for record in records:
        if record.get("readAt") or record.get("status") == "read":
            record["readReceiptStatus"] = "received"
        elif record.get("status") in {"accepted", "sent", "delivered"} or any(record.get(field) for field in ("acceptedAt", "sentAt", "deliveredAt")):
            record["readReceiptStatus"] = "not_received"
        else:
            record["readReceiptStatus"] = "unknown"
        if record.get("deliveredAt"):
            record["deliveryReceiptStatus"] = "received"
        elif record.get("readAt") or record.get("status") == "read":
            record["deliveryReceiptStatus"] = "confirmed_by_read_receipt"
        elif record.get("status") == "failed":
            record["deliveryReceiptStatus"] = "unknown"
        elif record.get("status") in {"accepted", "sent"} or record.get("acceptedAt") or record.get("sentAt"):
            record["deliveryReceiptStatus"] = "not_received"
        else:
            record["deliveryReceiptStatus"] = "unknown"
    return jsonify(json_value({"messages": records[:50], "page": page, "hasMore": len(records) > 50}))


@admin_bp.get("/campaigns/options")
@requireAdmin
def campaign_options():
    from .whatsapp_campaigns import collection_options, verified_coupon_options, marketing_enabled
    config, db = current_app.config, database()
    try:
        origin = canonical_origin(config)
    except ValueError:
        origin = None
    templates = {event: value for event, value in template_registry(db, config).items()
                 if value["category"] == "MARKETING" and event != "exclusive_offer"}
    exclusive = template_registry(db, config).get("exclusive_offer")
    return jsonify(json_value({"collections": collection_options(db), "coupons": verified_coupon_options(db, config),
        "couponIntegrationAvailable": False, "canonicalOrigin": origin, "marketingEnabled": marketing_enabled(db, config),
        "templates": templates, "unavailableTemplates": ({"exclusive_offer": {"name": exclusive["name"],
            "language": exclusive["language"], "category": exclusive["category"],
            "reason": "coupon_integration_unavailable"}} if exclusive else {})}))


@admin_bp.post("/campaigns/preview")
@requireAdmin
@limiter.limit("10 per minute")
def campaign_preview():
    from .whatsapp_campaigns import preview_campaign
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Provide a campaign definition."), 400
    try:
        preview, _ = preview_campaign(database(), current_app.config, payload)
        return jsonify(json_value(preview))
    except ValueError as error:
        return jsonify(error=str(error)), 400


@admin_bp.post("/campaigns/drafts")
@requireAdmin
@limiter.limit("20 per minute")
def campaign_draft():
    from .whatsapp_campaigns import save_campaign_draft
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Provide a campaign draft definition."), 400
    try:
        result = save_campaign_draft(database(), current_app.config, payload, current_user()["_id"])
        return jsonify(json_value(result)), 201
    except ValueError as error:
        return jsonify(error=str(error)), 409


@admin_bp.post("/campaigns/authorize")
@requireAdmin
@limiter.limit("3 per minute")
def campaign_authorize():
    from .whatsapp_campaigns import authorize_campaign
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Provide the confirmed current preview."), 400
    try:
        result = authorize_campaign(database(), current_app.config, payload, current_user()["_id"])
        return jsonify(json_value(result)), 202
    except ValueError as error:
        return jsonify(error=str(error)), 409


@admin_bp.get("/campaigns")
@requireAdmin
def campaign_list():
    records = database().whatsapp_campaigns.find({}, {"data.event": 1, "status": 1, "createdAt": 1, "scheduledAt": 1, "cursor": 1, "reason": 1}).sort("createdAt", -1).limit(50)
    return jsonify(json_value({"campaigns": list(records)}))


@admin_bp.post("/lifecycle-update")
@requireAdmin
@limiter.limit("10 per minute")
def lifecycle_update():
    """Manual business events absent from the original storefront workflows.

    A refund initiation is an operator assertion about an external refund,
    never a payment gateway call or a financial status transition.
    """
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or payload.get("confirmed") is not True or not ObjectId.is_valid(str(payload.get("recordId", ""))):
        return jsonify(error="Confirm the update and provide a valid record ID."), 400
    action = payload.get("action")
    db = database()
    identity = ObjectId(payload["recordId"])
    if action == "custom_order_status":
        state = payload.get("status")
        if state not in {"in_review", "quoted", "confirmed", "in_progress", "completed", "cancelled"}:
            return jsonify(error="Invalid custom order status."), 400
        collection = db.custom_order_requests
        record = collection.find_one({"_id": identity})
        if not record:
            return jsonify(error="Custom order request not found."), 404
        collection.update_one({"_id": identity}, {"$set": {"status": state, "updatedAt": now()}})
    elif action == "refund_initiated":
        collection = db.orders
        record = collection.find_one({"_id": identity})
        if not record:
            return jsonify(error="Order not found."), 404
        if record.get("paymentStatus") != "paid":
            return jsonify(error="Refund initiation requires a paid order."), 409
        state = "refund initiated externally"
        collection.update_one({"_id": identity, "refundNotification.initiatedAt": {"$exists": False}},
                              {"$set": {"refundNotification.initiatedAt": now(), "refundNotification.recordedBy": str(current_user()["_id"])}})
    else:
        return jsonify(error="Invalid lifecycle action."), 400
    event_key = f"{action}:{identity}:{state}"
    reference = str(record.get("orderNumber") or identity)
    result = notify(db, action, record, key=event_key, parameters={"reference": reference, "status": state.replace("_", " ")})
    notify_admins(db, record, event_key)
    # The existing app had no email for these two manual events. Use the
    # same Zoho service and separate claims; neither channel gates the other.
    try:
        db.whatsapp_manual_events.insert_one({"_id": event_key, "actorId": str(current_user()["_id"]), "createdAt": now(), "emailStatus": "sending"})
    except DuplicateKeyError:
        return jsonify(updated=True, whatsapp=result, email="already_attempted")
    from .mail import SENDERS, send_html_email, validate_recipient
    email_status = "skipped"
    try:
        email = validate_recipient(record.get("email"))
        send_html_email(sender=SENDERS["logistics" if action == "refund_initiated" else "orders"], recipients=[email],
                        subject=f"RK update - {reference}",
                        html=f"<p>Your RK request {html.escape(reference)}: {html.escape(state.replace('_', ' '))}.</p>")
        email_status = "sent"
    except ValueError:
        pass
    except Exception:
        email_status = "failed"
        current_app.logger.warning("Lifecycle email notification unavailable")
    db.whatsapp_manual_events.update_one({"_id": event_key}, {"$set": {"emailStatus": email_status}})
    return jsonify(updated=True, whatsapp=result, email=email_status)
