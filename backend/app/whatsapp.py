"""Official Cloud API transport. Never persist message bodies, OTPs or raw errors.

Atomic Mongo _id claims provide at-most-once attempts across workers. Ambiguous
network failures are held for operator reconciliation, never blindly retried.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import re
import time
import json
from uuid import uuid4

import phonenumbers
import requests
from cryptography.fernet import Fernet, InvalidToken
from bson import ObjectId
from flask import current_app, has_app_context
from pymongo.errors import DuplicateKeyError
from pymongo import ReturnDocument
from urllib.parse import urlsplit

from .whatsapp_templates import registry, template_registry, test_parameter_fields
from .whatsapp_consent import consent_phone, opted_out, record_consent
from .whatsapp_events import ORDER_EVENTS, event_values
from .time_utils import as_utc_datetime

CALLBACK = "https://rashikapoor.co.in/api/webhooks/whatsapp"
STATUSES = ("sending", "accepted", "sent", "delivered", "read", "failed", "unknown", "skipped")
CUSTOMER_MESSAGE_TYPES = {"text", "image", "audio", "video", "document", "button", "interactive", "location", "contacts", "reaction", "sticker"}


def now():
    return datetime.now(timezone.utc)


def normalize_phone(value):
    # Require an explicit country code; never infer India from a bare number.
    value = str(value or "").strip()
    if value.startswith("00"):
        value = "+" + value[2:]
    if not value.startswith("+") or len(value) > 40:
        raise ValueError("invalid_recipient")
    try:
        number = phonenumbers.parse(value, None)
        if not phonenumbers.is_valid_number(number) or number.extension:
            raise ValueError("invalid_recipient")
        return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)
    except phonenumbers.NumberParseException:
        raise ValueError("invalid_recipient") from None


def fingerprint(value, config):
    return hmac.new(str(config["WHATSAPP_APP_SECRET"]).encode(), value.encode(), hashlib.sha256).hexdigest()


def configuration_errors(config):
    missing = [key for key in ("WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "WHATSAPP_APP_ID") if not config.get(key)]
    try:
        Fernet(str(config.get("WHATSAPP_OUTBOX_KEY", "")).encode())
    except (ValueError, TypeError):
        missing.append("WHATSAPP_OUTBOX_KEY")
    for key in ("WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID"):
        if not re.fullmatch(r"[0-9]{1,40}", str(config.get(key, ""))):
            missing.append(key)
    if not re.fullmatch(r"v[0-9]{1,3}\.0", str(config.get("WHATSAPP_API_VERSION", ""))):
        missing.append("WHATSAPP_API_VERSION")
    return missing


def enabled(db, config):
    return config.get("WHATSAPP_ENABLED") is True and (db.integrations.find_one({"_id": "whatsapp"}) or {}).get("enabled") is True


def order_notifications_enabled(db, config):
    return (config.get("WHATSAPP_ORDER_NOTIFICATIONS_ENABLED") is True
            and (db.integrations.find_one({"_id": "whatsapp"}) or {}).get("orderNotificationsEnabled") is True)


def automation_enabled(db, config, event=None):
    from .whatsapp_orders import ORDER_ONLY_EVENTS
    return enabled(db, config) or (order_notifications_enabled(db, config)
                                  and (event is None or event in ORDER_ONLY_EVENTS))


def test_send_enabled(config):
    return config.get("WHATSAPP_ENVIRONMENT") == "development" and config.get("WHATSAPP_TEST_SEND_ENABLED") is True


def production_test_state(config):
    """Admin-only state for a temporary production Utility-template test window."""
    expiry = config.get("WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT")
    expires = None
    try:
        if not isinstance(expiry, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)", expiry):
            raise ValueError()
        expires = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
    except ValueError:
        pass
    checked_at = now()
    reason = None
    if config.get("WHATSAPP_ENVIRONMENT") != "production" or config.get("WHATSAPP_PRODUCTION_TEST_SEND_ENABLED") is not True:
        reason = "production_test_disabled"
    elif any(config.get(key) is not False for key in ("WHATSAPP_ENABLED", "WHATSAPP_MARKETING_ENABLED", "WHATSAPP_TEST_SEND_ENABLED")):
        reason = "production_test_unsafe_gates"
    elif expires is None:
        reason = "production_test_expiry_invalid"
    elif expires <= checked_at:
        reason = "production_test_expired"
    elif expires > checked_at + timedelta(hours=24):
        reason = "production_test_expiry_too_far"
    return {"enabled": reason is None, "expiresAt": expires.isoformat() if expires else None, "reason": reason}


def production_test_block(config, recipient):
    state = production_test_state(config)
    if not state["enabled"]:
        return state["reason"]
    try:
        normalized = normalize_phone(recipient)
    except ValueError:
        return "invalid_recipient"
    if not isinstance(recipient, str) or not re.fullmatch(r"\+[1-9][0-9]{6,14}", recipient) or normalized != recipient:
        return "invalid_recipient"
    return None


def template_test_enabled(config):
    return test_send_enabled(config) or production_test_state(config)["enabled"]


def callback_configuration(config):
    if config.get("WHATSAPP_ENVIRONMENT") != "development":
        return {"environment": "production", "callbackUrl": CALLBACK}
    url = str(config.get("WHATSAPP_DEVELOPMENT_CALLBACK_URL") or "").strip()
    try:
        parsed = urlsplit(url)
        valid = parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password
        valid = valid and parsed.path == "/api/webhooks/whatsapp" and not parsed.query and not parsed.fragment
    except ValueError:
        valid = False
    return {"environment": "development", "callbackUrl": url if valid else ""}


def customer_window(db, config, recipient):
    phone = normalize_phone(recipient)
    checked = now()
    latest = None
    if all(config.get(k) for k in ("WHATSAPP_APP_SECRET", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID")):
        message = db.whatsapp_inbox.find_one({
            "recipientHash": fingerprint(phone, config), "verified": True,
            "type": {"$in": list(CUSTOMER_MESSAGE_TYPES)},
            "phoneNumberId": str(config["WHATSAPP_PHONE_NUMBER_ID"]),
            "businessAccountId": str(config["WHATSAPP_BUSINESS_ACCOUNT_ID"]),
            "receivedAt": {"$lte": checked},
        }, sort=[("receivedAt", -1)])
        latest = as_utc_datetime(message.get("receivedAt")) if message else None
    expires = latest + timedelta(hours=24) if latest else None
    return {"recipient": phone, "validRecipient": True, "open": bool(expires and expires > checked),
            "lastIncomingAt": latest, "expiresAt": expires, "checkedAt": checked}


def _safe_id(value):
    return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.=:/+-]{1,250}", value) else None


def _provider_error(body, status):
    error = body.get("error", {}) if isinstance(body, dict) else {}
    code = error.get("code") if isinstance(error, dict) else None
    code = code if isinstance(code, int) else None
    subcode = error.get("error_subcode") if isinstance(error, dict) else None
    kind = "invalid_credentials" if code == 190 or status == 401 else "rate_limited" if status == 429 or code in {4, 80007, 130429, 131048, 131056} else "provider_rejected"
    from .whatsapp_diagnostics import error_description
    return {"kind": kind, "code": code, "subcode": subcode if isinstance(subcode, int) else None, "httpStatus": status, "description": error_description(code)}


def _test_template_components(template, supplied):
    fields = test_parameter_fields(template)
    if fields is None or not isinstance(supplied, dict) or set(supplied) != {field["key"] for field in fields}:
        return None
    if any(not isinstance(supplied[field["key"]], str) or not supplied[field["key"]].strip()
           or len(supplied[field["key"]]) > 500 for field in fields):
        return None
    result = []
    components = template.get("components", [])
    for component in components:
        kind = component.get("type")
        if kind in {"HEADER", "BODY"}:
            key = kind.lower()
            numbers = sorted(field["number"] for field in fields if field["component"] == key)
            if numbers:
                result.append({"type": key, "parameters": [
                    {"type": "text", "text": supplied[f"{key}_{number}"]} for number in numbers
                ]})
        elif kind == "BUTTONS":
            for index, button in enumerate(component.get("buttons", [])):
                numbers = sorted(field["number"] for field in fields
                                 if field["component"] == "button" and field["index"] == index)
                if numbers:
                    result.append({"type": "button", "sub_type": "url", "index": str(index),
                                   "parameters": [{"type": "text", "text": supplied[f"button_{index}_{number}"]}
                                                  for number in numbers]})
    return result


def send(db, config, recipient, event, parameters, key, *, order_id=None, text=None, test_send=False, consent=False, auth_context=None, consent_check=None, allow_rate_limit_retry=False, button_parameters=None, campaign_context=None, test_parameters=None, production_test=False, order_notification=False):
    """Internal-only transport; callers must enforce consent. No arbitrary send API."""
    if production_test and (not test_send or text is not None or test_parameters is None):
        return {"status": "skipped", "reason": "invalid_test_type"}
    if test_send:
        if production_test:
            blocked = production_test_block(config, recipient)
            if blocked:
                return {"status": "skipped", "reason": blocked}
        elif not test_send_enabled(config):
            return {"status": "skipped", "reason": "test_send_disabled"}
        if consent is not True:
            return {"status": "skipped", "reason": "no_consent"}
        if event != "text" and (event not in registry(config) or registry(config)[event]["category"] != "UTILITY"):
            return {"status": "skipped", "reason": "invalid_test_type"}
    elif not automation_enabled(db, config, event) or (not enabled(db, config) and not (order_notification and order_id and consent_check and text is None)):
        return {"status": "skipped", "reason": "disabled"}
    if configuration_errors(config):
        return {"status": "skipped", "reason": "configuration_incomplete"}
    try:
        phone = normalize_phone(recipient)
    except ValueError:
        return {"status": "skipped", "reason": "invalid_recipient"}
    template = template_registry(db, config).get(event)
    if order_notification and (not template or template.get("category") != "UTILITY" or event not in template.get("definitionEvents", [])):
        return {"status": "skipped", "reason": "invalid_order_template"}
    if test_send and text is None and (not template or template.get("category") != "UTILITY"
            or template.get("requiresMetaApproval") is not True
            or template.get("approvalSource") != "meta_api_read"
            or template.get("statusStale") or not template.get("componentsVerified")):
        return {"status": "skipped", "reason": "template_not_approved_or_enabled"}
    marketing = bool(template and template["category"] == "MARKETING")
    if marketing:
        from .whatsapp_campaigns import marketing_enabled, valid_campaign_delivery
        from .whatsapp_marketing_consent import marketing_suppressed
        if not marketing_enabled(db, config) or not valid_campaign_delivery(db, config, campaign_context, event, phone, parameters, button_parameters or {}):
            return {"status": "skipped", "reason": "marketing_not_authorized_or_suppressed"}
        suppressed = marketing_suppressed(db, config, phone)
    else:
        suppressed = opted_out(db, config, phone)
    if suppressed:
        return {"status": "skipped", "reason": "recipient_opted_out"}
    if text is None and (not template or not template["approved"] or (not test_send and not template["enabled"])):
        return {"status": "skipped", "reason": "template_not_approved_or_enabled"}
    if text is None and template["category"] == "AUTHENTICATION" and not valid_auth_delivery(db, auth_context or {}, event, (parameters or {}).get("code", ""), phone):
        return {"status": "skipped", "reason": "otp_unrequested_or_expired"}
    if not isinstance(key, str) or not key or len(key) > 512:
        return {"status": "skipped", "reason": "invalid_correlation_key"}
    phone_hash = fingerprint(phone, config)
    if text is not None:
        if not isinstance(text, str) or not text.strip() or len(text) > 4096:
            return {"status": "skipped", "reason": "invalid_text"}
        if not customer_window(db, config, phone)["open"]:
            return {"status": "skipped", "reason": "service_window_closed"}
        content = {"type": "text", "text": {"body": text}}
    else:
        if test_parameters is not None:
            components = _test_template_components(template, test_parameters)
            if components is None:
                return {"status": "skipped", "reason": "missing_template_parameters"}
            content = {"type": "template", "template": {"name": template["name"],
                       "language": {"code": template["language"]}, "components": components}}
            parameters = {}
        else:
            if (not isinstance(parameters, dict) or set(parameters) != set(template["parameters"])
                    or any(not isinstance(parameters[p], str) or not parameters[p].strip() or len(parameters[p]) > 500 for p in template["parameters"])
                    or (template["category"] == "AUTHENTICATION" and not re.fullmatch(r"[0-9]{6}", parameters.get("code", "")))):
                return {"status": "skipped", "reason": "missing_template_parameters"}
            values = [{"type": "text", "text": str(parameters[p])} for p in template["parameters"]]
            components = [{"type": "body", "parameters": values}] if values else []
            if template["category"] == "AUTHENTICATION":
                components.append({"type": "button", "sub_type": "url", "index": "0", "parameters": values})
            button_parameters = button_parameters or {}
            if set(button_parameters) != set(template["buttonParameters"]):
                return {"status": "skipped", "reason": "invalid_button_parameters"}
            for index, parameter in enumerate(template["buttonParameters"]):
                suffix = button_parameters[parameter]
                if not isinstance(suffix, str) or not suffix or len(suffix) > 500:
                    return {"status": "skipped", "reason": "invalid_button_parameters"}
                if parameter == "order_id" and (suffix != str(order_id) or not ObjectId.is_valid(suffix)):
                    return {"status": "skipped", "reason": "invalid_button_parameters"}
                components.append({"type": "button", "sub_type": "url", "index": str(index), "parameters": [{"type": "text", "text": suffix}]})
            content = {"type": "template", "template": {"name": template["name"], "language": {"code": template["language"]}, "components": components}}
    if production_test:
        from .whatsapp_checks import production_provider_block
        blocked = production_provider_block(db, config, manual_utility_test=True, template=template, recipient=phone)
        if blocked:
            return {"status": "skipped", "reason": blocked}
    if consent_check is not None and not consent_check():
        return {"status": "skipped", "reason": "no_consent"}
    correlation = hashlib.sha256((key + ":" + phone_hash).encode()).hexdigest()
    record = {"_id": correlation, "recipient": "***" + phone[-4:], "recipientHash": phone_hash,
              "type": event if text is None else "text", "template": template["name"] if text is None else None,
              "orderId": str(order_id) if order_id else None, "status": "sending", "createdAt": now(), "attempts": 0,
              "testSend": bool(test_send), "productionTestSend": bool(production_test)}
    from .whatsapp_checks import scope_key
    record['_providerScope'] = scope_key(config)
    if order_id and ObjectId.is_valid(str(order_id)):
        linked_order = db.orders.find_one({"_id": ObjectId(str(order_id))}) or {}
        record.update(orderNumber=linked_order.get("orderNumber"), customerId=str(linked_order.get("customerId") or ""),
                      recipientSource=linked_order.get("whatsappRecipientSource", "legacy_order_contact"))
    try:
        db.whatsapp_messages.insert_one(record)
    except DuplicateKeyError:
        previous = db.whatsapp_messages.find_one({"_id": correlation}) or {}
        reclaimed = None
        if allow_rate_limit_retry and previous.get("status") == "failed" and (previous.get("error") or {}).get("kind") == "rate_limited" and not previous.get("providerId"):
            reclaimed = db.whatsapp_messages.find_one_and_update(
                {"_id": correlation, "status": "failed", "error.kind": "rate_limited", "providerId": {"$exists": False}},
                {"$set": {"status": "sending"}, "$unset": {"failedAt": "", "error": ""}}, return_document=ReturnDocument.AFTER)
        if not reclaimed:
            return {"status": "duplicate", "correlationId": correlation, "previousStatus": previous.get("status"),
                    **{k: previous.get(k) for k in ("providerId", "httpStatus", "error")}}
    payload = {"messaging_product": "whatsapp", "recipient_type": "individual", "to": phone[1:], "biz_opaque_callback_data": correlation, **content}
    result = {"status": "unknown", "httpStatus": None, "error": {"kind": "network_ambiguous"}}
    for attempt in range(3):
        # A short Retry-After can cross the window boundary. Recheck for every
        # actual request, including retries, rather than trusting preflight.
        blocked = production_test_block(config, recipient) if production_test else ("test_send_disabled" if test_send and not test_send_enabled(config) else None)
        if not test_send and (not automation_enabled(db, config, event) or (not enabled(db, config) and not (order_notification and order_id and consent_check and text is None))):
            blocked = "disabled"
        if marketing:
            if not marketing_enabled(db, config) or not valid_campaign_delivery(db, config, campaign_context, event, phone, parameters, button_parameters):
                blocked = "marketing_not_authorized_or_suppressed"
        elif opted_out(db, config, phone):
            blocked = "recipient_opted_out"
        if consent_check is not None and not consent_check():
            blocked = "no_consent"
        latest_template = template_registry(db, config).get(event, {})
        if text is None and (not latest_template.get("approved") or (not test_send and not latest_template.get("enabled"))
                             or (test_send and (latest_template.get("category") != "UTILITY" or latest_template.get("statusStale") or not latest_template.get("componentsVerified")))
                             or any(latest_template.get(k) != template.get(k) for k in ("name", "language", "category", "parameters", "components", "requiresMetaApproval"))):
            blocked = "template_not_approved_or_enabled"
        if text is None and template["category"] == "AUTHENTICATION" and not valid_auth_delivery(db, auth_context or {}, event, parameters["code"], phone):
            blocked = "otp_unrequested_or_expired"
        if not blocked and text is not None and not customer_window(db, config, phone)["open"]:
            blocked = "service_window_closed"
        if blocked:
            result = {"status": "failed", "reason": blocked, "error": {"kind": blocked}, "httpStatus": result.get("httpStatus")}
            break
        db.whatsapp_messages.update_one({"_id": correlation}, {"$inc": {"attempts": 1}})
        try:
            if production_test:
                from .whatsapp_checks import production_provider_block
                blocked = production_test_block(config, recipient) or production_provider_block(db, config, manual_utility_test=True, template=latest_template, recipient=phone)
                if blocked:
                    result = {"status": "failed", "reason": blocked, "error": {"kind": blocked}, "httpStatus": result.get("httpStatus")}
                    break
            if not test_send and (not automation_enabled(db, config, event)
                    or (not enabled(db, config) and not (order_notification and order_id and consent_check and text is None))
                    or (consent_check is not None and not consent_check())):
                result = {"status": "failed", "reason": "automation_or_consent_changed", "error": {"kind": "automation_or_consent_changed"}, "httpStatus": result.get("httpStatus")}
                break
            response = requests.post(
                f"https://graph.facebook.com/{config['WHATSAPP_API_VERSION']}/{config['WHATSAPP_PHONE_NUMBER_ID']}/messages",
                headers={"Authorization": "Bearer " + config["WHATSAPP_ACCESS_TOKEN"]},
                json=payload, timeout=(3.05, 10), allow_redirects=False,
            )
            result["httpStatus"] = response.status_code
            body = response.json()
            if not isinstance(body, dict):
                raise ValueError("invalid_response")
            messages = body.get("messages") or []
            message_id = _safe_id(messages[0].get("id")) if isinstance(messages, list) and messages and isinstance(messages[0], dict) else None
            if 200 <= response.status_code < 300 and message_id and not body.get("error"):
                result = {"status": "accepted", "providerId": message_id, "acceptedAt": now(), "error": None, "httpStatus": response.status_code}
                db.integrations.update_one({"_id": "whatsapp"}, {"$set": {"lastApiSuccess": now(), "lastError": None}}, upsert=True)
                break
            error = _provider_error(body, response.status_code)
            if error["kind"] == "rate_limited" and not 400 <= response.status_code < 500:
                error = {**error, "kind": "provider_rejected"}
            # Only retry explicit rate-limit rejections, never a timeout/5xx
            # where Meta may already have accepted the message.
            if error["kind"] == "rate_limited" and not message_id and attempt < 2:
                retry = response.headers.get("Retry-After", "")
                delay = int(retry) if str(retry).isdigit() else 2 ** attempt
                if delay <= 5:
                    time.sleep(max(1, delay))
                    continue
            ambiguous = bool(message_id) or response.status_code >= 500 or (200 <= response.status_code < 300)
            result = {"status": "unknown" if ambiguous else "failed", "error": error, "httpStatus": response.status_code}
            if message_id:
                result["providerId"] = message_id
            if error["kind"] == "rate_limited":
                retry_header = str(response.headers.get("Retry-After", ""))
                if retry_header.isdigit() and len(retry_header) <= 9:
                    result["retryAfterSeconds"] = min(86400, int(retry_header))
            break
        except (requests.RequestException, ValueError):
            break
    result["updatedAt"] = now()
    if result["status"] == "failed":
        result["failedAt"] = now()
    # A webhook can beat the HTTP response. Do not regress delivered/read.
    db.whatsapp_messages.update_one({"_id": correlation, "status": "sending"}, {"$set": result})
    if result.get("providerId"):
        # The signed webhook may have advanced status before this HTTP response.
        # Preserve API acceptance evidence without resetting delivery/read state.
        api_response = {"status": result["status"], "httpStatus": result["httpStatus"], "providerId": result["providerId"]}
        if result.get("error"):
            api_response["error"] = result["error"]
        metadata = {"$set": {"providerId": result["providerId"], "httpStatus": result["httpStatus"], "apiResponse": api_response}}
        if result.get("acceptedAt"):
            metadata["$min"] = {"acceptedAt": result["acceptedAt"]}
        db.whatsapp_messages.update_one({"_id": correlation, "$or": [
            {"providerId": {"$exists": False}}, {"providerId": None}, {"providerId": result["providerId"]},
        ]}, metadata)
    if result.get("error"):
        db.integrations.update_one({"_id": "whatsapp"}, {"$set": {"lastError": result["error"]}}, upsert=True)
    return {**result, "correlationId": correlation}


def send_text(db, config, recipient, body, key, *, consent=False, test_send=False):
    if consent is not True:
        return {"status": "skipped", "reason": "no_consent"}
    return send(db, config, recipient, "text", {}, key, text=body, test_send=test_send, consent=consent)


def auth_challenge(db, context):
    identity = context.get("challengeId")
    if not ObjectId.is_valid(str(identity)):
        return None
    collection = db.users if context.get("purpose") == "login" else db.otp_challenges
    query = {"_id": ObjectId(identity)}
    if context.get("purpose") != "login":
        query["purpose"] = context.get("purpose")
    return collection.find_one(query)


def valid_auth_code(db, context, code):
    from bcrypt import checkpw
    if not isinstance(context, dict) or not isinstance(code, str):
        return False
    challenge = auth_challenge(db, context)
    expiry = as_utc_datetime((challenge or {}).get("otpExpiresAt"))
    try:
        return bool(challenge and expiry and expiry > now() and challenge.get("otpAttempts", 0) < 5
                    and checkpw(code.encode(), challenge["otpHash"].encode()))
    except (ValueError, TypeError, KeyError):
        return False


def valid_auth_delivery(db, context, event, code, phone):
    if not isinstance(context, dict):
        return False
    purpose = {"signup_otp": "signup", "login_otp": "login", "forgot_password_otp": "forgot-password"}.get(event)
    if not purpose or context.get("purpose") != purpose or not ObjectId.is_valid(context.get("consentId")):
        return False
    audit = db.whatsapp_consents.find_one({"_id": ObjectId(context["consentId"])}) or {}
    return bool(audit.get("enabled") is True and audit.get("category") == "authentication"
                and audit.get("phone") == phone and audit.get("challengeId") == context.get("challengeId")
                and valid_auth_code(db, context, code))


def notify_auth_otp(db, event, user, code, challenge, purpose):
    try:
        return _notify_auth_otp(db, event, user, code, challenge, purpose)
    except Exception:
        current_app.logger.warning("WhatsApp authentication notification unavailable")
        return {"status": "unavailable"}


def _notify_auth_otp(db, event, user, code, challenge, purpose):
    """Called only after an explicit WhatsApp OTP request in the auth service."""
    context = {"challengeId": str(challenge["_id"]), "purpose": purpose}
    if not valid_auth_code(db, context, code):
        return {"status": "skipped", "reason": "otp_expired_or_consumed"}
    consent = record_consent(db, current_app.config, user.get("_id"), user.get("phone"), True,
                             "explicit_" + purpose + "_otp", category="authentication", update_user=False)
    context["consentId"] = consent["consentId"]
    db.whatsapp_consents.update_one({"_id": ObjectId(consent["consentId"])}, {"$set": {"challengeId": context["challengeId"], "purpose": purpose}})
    return notify(db, event, {}, key=f"{event}:{context['challengeId']}:{challenge['otpHash']}",
                  parameters={"code": code}, user=user, auth_context=context)


def notify(db, event, record, *, key=None, parameters=None, user=None, auth_context=None):
    from .whatsapp_orders import ORDER_NOTIFICATIONS, notify_order_whatsapp
    if event in ORDER_NOTIFICATIONS or event == "tracking_update":
        return notify_order_whatsapp(db, record.get("_id"), "shipped" if event == "tracking_update" else event,
                                     {"refundId": (record.get("whatsappRefund") or {}).get("id"), "transactionId": (record.get("whatsappPayment") or {}).get("id")})
    return _enqueue_notification(db, event, record, key=key, parameters=parameters, user=user, auth_context=auth_context)


def _enqueue_notification(db, event, record, *, key=None, parameters=None, user=None, auth_context=None, business_event_key=None, campaign_context=None, button_parameters=None):
    """Independent best-effort channel: no exception can break email/checkout."""
    if not has_app_context():
        return {"status": "skipped", "reason": "disabled"}
    try:
        if not automation_enabled(db, current_app.config, event):
            return {"status": "skipped", "reason": "disabled"}
        if not enabled(db, current_app.config) and (not business_event_key or not record.get("_id")):
            return {"status": "skipped", "reason": "order_event_required"}
        if user is None:
            identity = record.get("customerId")
            if isinstance(identity, str) and ObjectId.is_valid(identity):
                identity = ObjectId(identity)
            user = db.users.find_one({"_id": identity}) if identity else None
        config = current_app.config
        is_otp = event in {"signup_otp", "login_otp", "forgot_password_otp"}
        if is_otp:
            if not auth_context or not user or not valid_auth_code(db, auth_context, (parameters or {}).get("code", "")):
                return {"status": "skipped", "reason": "otp_unrequested_or_expired"}
            phone = normalize_phone(user.get("phone"))
            if user.get("isActive", True) is False or opted_out(db, config, phone):
                return {"status": "skipped", "reason": "no_consent"}
        elif event in {"new_collection_drop", "exclusive_offer"}:
            from .whatsapp_campaigns import marketing_enabled
            from .whatsapp_marketing_consent import marketing_phone
            phone = marketing_phone(db, config, user)
            if not campaign_context or not phone or not marketing_enabled(db, config):
                return {"status": "skipped", "reason": "marketing_not_authorized_or_suppressed"}
        else:
            if business_event_key:
                from .whatsapp_orders import order_recipient
                recipient = order_recipient(db, config, record, user)
                phone = recipient["phone"] if not recipient["reason"] else None
            else:
                phone = consent_phone(db, config, user, {} if event == "admin_notification" else record)
            if not phone:
                return {"status": "skipped", "reason": "no_consent"}
        params = dict(parameters) if parameters is not None else {"reference": str(record.get("orderNumber") or record.get("_id") or ""), "status": event.replace("_", " ")}
        if event in {"shipped", "tracking_update"}:
            fulfillment = record.get("fulfillment") or {}
            params["tracking"] = "; ".join(str(fulfillment.get(k) or "Not provided") for k in ("courier", "trackingNumber", "trackingUrl"))[:500]
        if not automation_enabled(db, config, event) or configuration_errors(config):
            return {"status": "skipped", "reason": "disabled_or_configuration_incomplete"}
        template = template_registry(db, config).get(event)
        if not template or not template["approved"] or not template["enabled"]:
            return {"status": "skipped", "reason": "template_not_approved_or_enabled"}
        if event in ORDER_EVENTS:
            try:
                values = event_values(event, record)
            except ValueError:
                return {"status": "skipped", "reason": "business_event_not_confirmed"}
            if template.get("catalogue"):
                params = {p: values[p] for p in template["parameters"]}
        if business_event_key:
            from .whatsapp_definitions import order_button_parameters
            button_parameters = order_button_parameters(template, record)
        if set(params) != set(template["parameters"]) or any(not isinstance(params[p], str) or not params[p].strip() or len(params[p]) > 500 for p in template["parameters"]):
            return {"status": "skipped", "reason": "missing_template_parameters"}
        if event in {"new_collection_drop", "exclusive_offer"}:
            from .whatsapp_campaigns import valid_campaign_delivery
            if not valid_campaign_delivery(db, config, campaign_context, event, phone, params, button_parameters or {}):
                return {"status": "skipped", "reason": "marketing_not_authorized_or_suppressed"}
        event_key = key or f"{event}:{record.get('_id')}"
        queue_id = hashlib.sha256((event_key + ":" + fingerprint(phone, config)).encode()).hexdigest()
        # Encryption is necessary for deferred OTP delivery. Plaintext exists
        # only in process memory; remove encrypted payloads after processing.
        payload = {"recipient": phone, "event": event, "parameters": params, "key": event_key,
                   "order_id": str(record["_id"]) if record.get("_id") else None,
                   "userId": str(user["_id"]) if user and user.get("_id") else None,
                   "authContext": auth_context,
                   "mapping": {k: template[k] for k in ("name", "language", "category", "parameters", "components", "requiresMetaApproval")},
                   "businessEventKey": business_event_key,
                   "button_parameters": button_parameters or {}, "campaign_context": campaign_context,
                   "refundId": (record.get("whatsappRefund") or {}).get("id"),
                   "transactionId": (record.get("whatsappPayment") or {}).get("id")}
        encrypted = Fernet(config["WHATSAPP_OUTBOX_KEY"].encode()).encrypt(json.dumps(payload).encode()).decode()
        try:
            expiry = as_utc_datetime(auth_challenge(db, auth_context).get("otpExpiresAt")) if is_otp else now() + timedelta(days=1)
            db.whatsapp_outbox.insert_one({"_id": queue_id, "status": "pending", "payload": encrypted,
                                          "event": event, "orderNotification": bool(business_event_key),
                                          "createdAt": now(), "expiresAt": expiry})
        except DuplicateKeyError:
            return {"status": "duplicate", "correlationId": queue_id}
        return {"status": "queued", "correlationId": queue_id}
    except Exception:
        # Never include exception text: requests exceptions can embed tokens.
        current_app.logger.warning("WhatsApp notification unavailable")
        return {"status": "unavailable"}


def notify_admins(db, record, event_key):
    if not has_app_context() or current_app.config.get("WHATSAPP_ENABLED") is not True:
        return
    try:
        for user in db.users.find({"role": "admin", "isActive": {"$ne": False}, "whatsappNotifications": True}):
            notify(db, "admin_notification", record, key=f"admin:{event_key}:{record.get('_id')}:{user['_id']}",
                   parameters={"reference": str(record.get("orderNumber") or record.get("_id")), "status": event_key.replace("_", " ")}, user=user)
    except Exception:
        current_app.logger.warning("WhatsApp admin notification unavailable")


def ensure_indexes(db):
    from .whatsapp_storage import ensure_indexes as create_whatsapp_indexes
    create_whatsapp_indexes(db)


def recover_outbox(db, config, limit=50):
    """Resume only fenced, expired pre-dispatch claims. Never resend uncertainty."""
    lease_seconds = int(config.get("WHATSAPP_WORKER_LEASE_SECONDS", 300))
    checked = now()
    recovered = 0
    stale = {"status": "processing", "$or": [
        {"leaseUntil": {"$lte": checked}},
        {"leaseUntil": {"$exists": False}, "claimedAt": {"$lte": checked - timedelta(seconds=lease_seconds)}},
        {"leaseUntil": {"$exists": False}, "claimedAt": {"$exists": False}},
    ]}
    if not enabled(db, config) and order_notifications_enabled(db, config):
        from .whatsapp_orders import ORDER_ONLY_EVENTS
        stale.update(event={"$in": sorted(ORDER_ONLY_EVENTS)}, orderNotification=True)
    for item in db.whatsapp_outbox.find(stale).limit(limit):
        message = db.whatsapp_messages.find_one({"_id": item["_id"]})
        query = {"_id": item["_id"], "status": "processing", "claimToken": item.get("claimToken"),
                 "leaseUntil": item.get("leaseUntil"), "claimedAt": item.get("claimedAt")}
        if message:
            state = message.get("status")
            certain = state in {"accepted", "sent", "delivered", "read"}
            values = {"status": state if certain else "held", "reason": "provider_outcome_restored" if certain else "operator_reconciliation_required", "recoveredAt": checked}
        elif item.get("claimToken") and as_utc_datetime(item.get("expiresAt")) and as_utc_datetime(item["expiresAt"]) > checked:
            values = {"status": "pending", "reason": "pre_dispatch_claim_recovered", "recoveredAt": checked}
        else:
            values = {"status": "held", "reason": "operator_reconciliation_required", "recoveredAt": checked}
        changed = db.whatsapp_outbox.update_one(query, {"$set": values, "$unset": {"claimToken": "", "leaseUntil": ""}})
        recovered += changed.modified_count
    return recovered


def process_outbox(db, config, limit=50, *, stop_requested=None):
    """Bounded leased batch; SIGTERM finishes the active job before stopping."""
    if not automation_enabled(db, config) or configuration_errors(config):
        return 0
    recover_outbox(db, config, limit=limit)
    lease_seconds = int(config.get("WHATSAPP_WORKER_LEASE_SECONDS", 300))
    from .whatsapp_campaigns import materialize_campaigns, marketing_enabled
    if marketing_enabled(db, config):
        materialize_campaigns(db, config, limit=limit)
    processed = 0
    for _ in range(limit):
        if (stop_requested and stop_requested()) or not automation_enabled(db, config):
            break
        claim_token = uuid4().hex
        claim_query = {"status": "pending", "expiresAt": {"$gt": now()}, "$or": [{"nextAttemptAt": {"$exists": False}}, {"nextAttemptAt": {"$lte": now()}}]}
        if not enabled(db, config):
            from .whatsapp_orders import ORDER_ONLY_EVENTS
            claim_query.update(event={"$in": sorted(ORDER_ONLY_EVENTS)}, orderNotification=True)
        item = db.whatsapp_outbox.find_one_and_update(
            claim_query,
            {"$set": {"status": "processing", "claimedAt": now(), "claimToken": claim_token,
                      "leaseUntil": now() + timedelta(seconds=lease_seconds)}},
            sort=[("createdAt", 1)], return_document=ReturnDocument.AFTER,
        )
        if not item:
            break
        result = {}
        try:
            payload = json.loads(Fernet(config["WHATSAPP_OUTBOX_KEY"].encode()).decrypt(item["payload"].encode()))
            identity = payload.pop("userId")
            context = payload.pop("authContext", None)
            # Old OTP jobs without a live challenge/explicit request fail closed.
            payload.pop("oneTimeSignupConsent", None)
            refund_id = payload.pop("refundId", None)
            transaction_id = payload.pop("transactionId", None)
            mapping = payload.pop("mapping", None)
            business_key = payload.pop("businessEventKey", None)
            if not enabled(db, config):
                if (not automation_enabled(db, config, payload["event"]) or not business_key
                        or not payload.get("order_id") or payload["event"] != item.get("event")
                        or payload.get("campaign_context") or context):
                    raise ValueError("order_event_required")
            current_template = template_registry(db, config).get(payload["event"], {})
            if mapping != {k: current_template.get(k) for k in ("name", "language", "category", "parameters", "components", "requiresMetaApproval")}:
                raise ValueError("template_mapping_changed")
            user = db.users.find_one({"_id": ObjectId(identity)}) if identity else None
            if payload["event"] in {"signup_otp", "login_otp", "forgot_password_otp"}:
                audit = db.whatsapp_consents.find_one({"_id": ObjectId(context["consentId"])}) if context and ObjectId.is_valid(context.get("consentId")) else None
                valid = bool(audit and audit.get("enabled") is True and audit.get("category") == "authentication"
                             and audit.get("phone") == payload["recipient"] and valid_auth_code(db, context, payload["parameters"]["code"]))
                if identity and (not user or user.get("isActive", True) is False or normalize_phone(user.get("phone")) != payload["recipient"]):
                    valid = False
                payload["auth_context"] = context
            elif payload["event"] in {"new_collection_drop", "exclusive_offer"}:
                from .whatsapp_campaigns import valid_campaign_delivery
                valid = valid_campaign_delivery(db, config, payload.get("campaign_context"), payload["event"], payload["recipient"], payload["parameters"], payload.get("button_parameters", {}))
            else:
                record = {}
                if payload.get("order_id"):
                    record = db.orders.find_one({"_id": ObjectId(payload["order_id"])}) or db.custom_order_requests.find_one({"_id": ObjectId(payload["order_id"])}) or {}
                if payload["event"] == "admin_notification":
                    record = {}
                if business_key:
                    from .whatsapp_orders import order_recipient, business_event_key
                    recipient = order_recipient(db, config, record, user)
                    valid = not recipient["reason"] and recipient["phone"] == payload["recipient"]
                else:
                    valid = bool(consent_phone(db, config, user, record or {}) == payload["recipient"])
                if valid and payload["event"] in ORDER_EVENTS:
                    if transaction_id:
                        record["whatsappPayment"] = next((t for t in record.get("paymentTransactions", []) if t.get("id") == transaction_id), {})
                    if refund_id:
                        record["whatsappRefund"] = next((r for r in record.get("refunds", []) if r.get("id") == refund_id), {})
                    if business_key and business_event_key(record, payload["event"]) != business_key:
                        raise ValueError("business_event_changed")
                    values = event_values(payload["event"], record or {})
                    template = template_registry(db, config)[payload["event"]]
                    if template.get("catalogue"):
                        payload["parameters"] = {p: values[p] for p in template["parameters"]}
                    if business_key:
                        from .whatsapp_definitions import order_button_parameters
                        expected_buttons = order_button_parameters(template, record)
                        if payload.get("button_parameters", {}) != expected_buttons:
                            raise ValueError("button_destination_changed")
            if not valid or (not payload.get("campaign_context") and opted_out(db, config, payload["recipient"])):
                result = {"status": "skipped", "reason": "consent_or_event_changed"}
            else:
                def still_consented():
                    # Lease renewal and token comparison fence a stale worker,
                    # including every retry after provider backoff.
                    fenced = db.whatsapp_outbox.update_one(
                        {"_id": item["_id"], "status": "processing", "claimToken": claim_token,
                         "leaseUntil": {"$gt": now()}, "expiresAt": {"$gt": now()}},
                        {"$set": {"leaseUntil": now() + timedelta(seconds=lease_seconds)}},
                    )
                    if not fenced.matched_count:
                        return False
                    if payload.get("campaign_context"):
                        return valid_campaign_delivery(db, config, payload["campaign_context"], payload["event"], payload["recipient"], payload["parameters"], payload.get("button_parameters", {}))
                    latest_user = db.users.find_one({"_id": ObjectId(identity)}) if identity else None
                    if context:
                        return bool((not identity or latest_user and latest_user.get("isActive", True) is not False
                                     and normalize_phone(latest_user.get("phone")) == payload["recipient"])
                                    and valid_auth_delivery(db, context, payload["event"], payload["parameters"]["code"], payload["recipient"]))
                    latest_record = {}
                    if payload.get("order_id"):
                        latest_record = db.orders.find_one({"_id": ObjectId(payload["order_id"])}) or db.custom_order_requests.find_one({"_id": ObjectId(payload["order_id"])}) or {}
                    if payload["event"] == "admin_notification":
                        latest_record = {}
                    if business_key:
                        if transaction_id:
                            latest_record["whatsappPayment"] = next((t for t in latest_record.get("paymentTransactions", []) if t.get("id") == transaction_id), {})
                        if refund_id:
                            latest_record["whatsappRefund"] = next((r for r in latest_record.get("refunds", []) if r.get("id") == refund_id), {})
                        try:
                            latest_values = event_values(payload["event"], latest_record)
                            if current_template.get("catalogue") and payload["parameters"] != {p: latest_values[p] for p in current_template["parameters"]}:
                                return False
                            from .whatsapp_definitions import order_button_parameters
                            if payload.get("button_parameters", {}) != order_button_parameters(current_template, latest_record):
                                return False
                        except (ValueError, KeyError):
                            return False
                        recipient = order_recipient(db, config, latest_record, latest_user)
                        return not recipient["reason"] and recipient["phone"] == payload["recipient"] and business_event_key(latest_record, payload["event"]) == business_key
                    return consent_phone(db, config, latest_user, latest_record) == payload["recipient"]
                result = send(db, config, **payload, order_notification=bool(business_key), consent_check=still_consented, allow_rate_limit_retry=item.get("retryCount", 0) > 0)
            state = result["status"]
            if state == "duplicate":
                previous = result.get("previousStatus")
                if previous in {"accepted", "sent", "delivered", "read"}:
                    state = previous
                else:
                    state = "held"
                    result["reason"] = "operator_reconciliation_required"
            if state == "failed" and (result.get("error") or {}).get("kind") == "rate_limited" and item.get("retryCount", 0) < 2:
                delay = max((30, 120)[item.get("retryCount", 0)], result.get("retryAfterSeconds", 0))
                next_attempt = now() + timedelta(seconds=delay)
                if as_utc_datetime(item["expiresAt"]) > next_attempt:
                    db.whatsapp_outbox.update_one({"_id": item["_id"], "status": "processing", "claimToken": claim_token}, {"$set": {"status": "pending", "nextAttemptAt": next_attempt, "error": result["error"]}, "$inc": {"retryCount": 1}, "$unset": {"claimToken": "", "leaseUntil": ""}})
                    processed += 1
                    continue
        except (InvalidToken, ValueError, TypeError, KeyError):
            state = "invalid_payload"
            result = {"reason": "business_event_or_consent_changed"}
        except Exception:
            # Includes DB failures after an API request; never requeue blindly.
            state = "held"
            result = {"reason": "operator_reconciliation_required"}
        details = {"reason": result.get("reason"), "error": result.get("error")}
        db.whatsapp_outbox.update_one({"_id": item["_id"], "status": "processing", "claimToken": claim_token}, {"$set": {"status": state, "processedAt": now(), **details}, "$unset": {"payload": "", "nextAttemptAt": "", "claimToken": "", "leaseUntil": ""}})
        if has_app_context():
            current_app.logger.log(30 if state in {"held", "unknown", "invalid_payload"} else 20,
                                   json.dumps({"event": "whatsapp_job", "correlationId": item["_id"], "status": state, "reason": details["reason"]}))
        processed += 1
    return processed
