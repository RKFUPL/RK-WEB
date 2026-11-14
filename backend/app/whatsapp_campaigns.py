"""Explicitly authorized marketing plans; materialize through the existing outbox."""
import hashlib
import json
import re
from datetime import datetime, timedelta

import requests
from bson import ObjectId
from pymongo import ReturnDocument

from .catalog import is_excluded_collection, is_runway_collection, collection_product_count
from .time_utils import as_utc_datetime
from .whatsapp_definitions import canonical_origin
from .whatsapp_templates import template_registry, component_signature
from .whatsapp_marketing_consent import marketing_phone
from .whatsapp_events import business_date

MARKETING_EVENTS = {"new_collection_drop", "exclusive_offer"}


def campaign_timestamp(value):
    if isinstance(value, str):
        try:
            if len(value) > 64:
                return None
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if value.tzinfo is None:
                return None
        except ValueError:
            return None
    return as_utc_datetime(value)


def marketing_enabled(db, config):
    from .whatsapp import enabled
    return config.get("WHATSAPP_MARKETING_ENABLED") is True and enabled(db, config)


def verified_coupon_options(db, config):
    # RK-WEB has no coupon redemption/validation provider in this checkout.
    # Do not infer coupon validity from arbitrary database documents or text.
    return []


def load_valid_coupon(db, config, coupon_id):
    raise ValueError("coupon_integration_unavailable")


def public_collection(collection):
    return bool(collection and not is_excluded_collection(collection) and collection.get("status") != "archived" and collection.get("isActive") is not False)


def collection_path(collection):
    if not public_collection(collection):
        raise ValueError("collection_unavailable")
    slug = str(collection.get("slug") or "")
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
        raise ValueError("invalid_collection_slug")
    if slug == "aakaar":
        return "/aakaar/collection"
    return "/collections/lakme" if is_runway_collection(collection) else "/collections/" + slug


def collection_options(db):
    return [{"id": str(item["_id"]), "name": item.get("name"), "slug": item.get("slug"), "path": collection_path(item), "productCount": collection_product_count(db, item)}
            for item in db.collections.find({}) if public_collection(item)]


def destination_reachable(url):
    # Only call with the canonical origin + a server-resolved public route.
    try:
        response = requests.get(url, timeout=(3.05, 10), allow_redirects=False, stream=True)
        status = response.status_code
        response.close()
        return status == 200
    except requests.RequestException:
        return False


def campaign_data(db, config, payload):
    from .whatsapp import now
    event = payload.get("event")
    if event not in MARKETING_EVENTS:
        raise ValueError("invalid_marketing_template")
    origin = canonical_origin(config)
    collection_id = payload.get("collectionId")
    collection = db.collections.find_one({"_id": ObjectId(collection_id)}) if ObjectId.is_valid(str(collection_id)) else None
    if event == "new_collection_drop" or collection_id:
        if not public_collection(collection):
            raise ValueError("collection_unavailable")
        path = collection_path(collection)
    else:
        path = "/collections"
    expiry = campaign_timestamp(payload.get("expiresAt"))
    if not expiry or expiry <= now():
        raise ValueError("campaign_expiry_required")
    audience = payload.get("audience")
    if audience not in {"all_marketing_consent", "collection_customers"} or audience == "collection_customers" and not collection:
        raise ValueError("invalid_campaign_audience")
    data = {"event": event, "collectionId": str(collection["_id"]) if collection else None,
            "collection_name": str((collection or {}).get("name") or "").strip(), "collectionSlug": (collection or {}).get("slug"),
            "destinationPath": path, "destinationUrl": origin + path, "expiresAt": expiry,
            "audience": audience, "description": str(payload.get("description") or "").strip()[:2000], "couponId": None}
    if event == "exclusive_offer":
        coupon = load_valid_coupon(db, config, payload.get("couponId"))
        coupon_expiry = campaign_timestamp(coupon.get("expiresAt"))
        if not coupon.get("code") or not coupon.get("description") or not coupon_expiry or expiry > coupon_expiry:
            raise ValueError("coupon_expiry_or_details_invalid")
        data.update(couponId=str(coupon["id"]), coupon_code=coupon["code"], offer_description=coupon["description"], expiry_date=business_date(expiry))
    return data


def body_parameters(data, user):
    name = str(user.get("firstName") or "").strip()
    if not name:
        raise ValueError("missing_customer_first_name")
    values = {"first_name": name, **data}
    keys = ["first_name", "collection_name"] if data["event"] == "new_collection_drop" else ["first_name", "offer_description", "coupon_code", "expiry_date"]
    result = {key: values[key] for key in keys}
    if any(not isinstance(value, str) or not value.strip() or len(value) > 500 for value in result.values()):
        raise ValueError("invalid_campaign_variables")
    return result


def eligible_audience(db, config, data):
    customers = None
    if data["audience"] == "collection_customers":
        customers = {str(order.get("customerId")) for order in db.orders.find({"$or": [
            {"items.collectionSlug": data["collectionSlug"]}, {"items.collectionId": data["collectionId"]}]})}
    recipients, excluded, phones = [], {}, set()
    for user in db.users.find({"role": "customer", "isActive": {"$ne": False}}).sort("_id", 1):
        if customers is not None and str(user["_id"]) not in customers:
            continue
        phone = marketing_phone(db, config, user)
        reason = "no_active_marketing_consent" if not phone else "duplicate_number" if phone in phones else None
        try:
            params = body_parameters(data, user) if not reason else {}
        except ValueError:
            reason = "missing_or_invalid_variables"
        if reason:
            excluded[reason] = excluded.get(reason, 0) + 1
            continue
        phones.add(phone)
        recipients.append({"userId": str(user["_id"]), "phone": phone, "parameters": params})
    if len(recipients) > 5000:
        raise ValueError("audience_limit_exceeded")
    return recipients, excluded


def preview_campaign(db, config, payload, *, probe=True):
    from .whatsapp import fingerprint
    data = campaign_data(db, config, payload)
    recipients, excluded = eligible_audience(db, config, data)
    template = template_registry(db, config).get(data["event"], {})
    bindings = [{"userId": item["userId"], "phoneHash": fingerprint(item["phone"], config), "parameters": item["parameters"]} for item in recipients]
    schedule = campaign_timestamp(payload.get("scheduledAt"))
    if payload.get("scheduledAt") and not schedule:
        raise ValueError("invalid_campaign_schedule")
    digest_data = {"data": data, "scheduledAt": schedule, "bindings": bindings, "template": {key: template.get(key) for key in ("name", "language", "category", "components", "parameters", "enabled", "approved")}}
    digest = hashlib.sha256(json.dumps(digest_data, sort_keys=True, default=str).encode()).hexdigest()
    samples = []
    for recipient in recipients[:3]:
        body = next((item.get("text", "") for item in template.get("components", []) if item["type"] == "BODY"), "")
        for index, key in enumerate(template.get("parameters", []), 1):
            body = body.replace("{{" + str(index) + "}}", recipient["parameters"][key])
        samples.append({"recipient": "***" + recipient["phone"][-4:], "variables": recipient["parameters"], "body": body})
    reachable = destination_reachable(data["destinationUrl"]) if probe else True
    reasons = ([] if recipients else ["no_eligible_recipients"]) + ([] if template.get("enabled") and template.get("approved") else ["template_not_approved_or_enabled"]) + ([] if marketing_enabled(db, config) else ["marketing_automation_disabled"]) + ([] if reachable else ["public_destination_unavailable"])
    return {"data": data, "template": template, "recipientCount": len(recipients), "excluded": excluded, "samples": samples,
            "previewDigest": digest, "disabledReasons": reasons, "canAuthorize": not reasons,
            "destinationUrl": data["destinationUrl"], "destinationReachable": reachable}, recipients


def save_campaign_draft(db, config, payload, actor_id):
    """Save a local collection-launch draft without creating recipients or sends."""
    from .whatsapp import now
    if payload.get("event") != "new_collection_drop":
        raise ValueError("coupon_integration_unavailable" if payload.get("event") == "exclusive_offer" else "invalid_marketing_template")
    request_id = payload.get("requestId")
    if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9-]{16,80}", request_id):
        raise ValueError("campaign_request_id_required")
    data = campaign_data(db, config, payload)
    scheduled = campaign_timestamp(payload.get("scheduledAt"))
    if payload.get("scheduledAt") and (not scheduled or scheduled < now() - timedelta(minutes=1) or scheduled >= data["expiresAt"]):
        raise ValueError("invalid_campaign_schedule")
    template = template_registry(db, config)["new_collection_drop"]
    identity = hashlib.sha256((str(actor_id) + ":draft:" + request_id).encode()).hexdigest()
    data_digest = hashlib.sha256(json.dumps({"data": data, "scheduledAt": scheduled}, sort_keys=True, default=str).encode()).hexdigest()
    draft = {"status": "draft", "data": data, "scheduledAt": scheduled,
             "templateName": template["name"], "templateLanguage": template["language"],
             "templateStatus": template.get("observedStatus", "MISSING_OR_UNKNOWN"),
             "templateSignature": component_signature(template["components"]),
             "dataDigest": data_digest,
             "createdBy": str(actor_id), "createdAt": now()}
    db.whatsapp_campaign_drafts.update_one({"_id": identity}, {"$setOnInsert": draft}, upsert=True)
    saved = db.whatsapp_campaign_drafts.find_one({"_id": identity}) or {}
    if saved.get("dataDigest") != data_digest or saved.get("templateName") != template["name"]:
        raise ValueError("campaign_request_id_reused")
    return {"draftId": identity, "status": "draft", "templateStatus": draft["templateStatus"],
            "destinationUrl": data["destinationUrl"], "scheduledAt": scheduled}


def authorize_campaign(db, config, payload, actor_id):
    from .whatsapp import now, fingerprint
    preview, recipients = preview_campaign(db, config, payload)
    if payload.get("confirmed") is not True or payload.get("previewDigest") != preview["previewDigest"]:
        raise ValueError("confirm_current_campaign_preview")
    if not preview["canAuthorize"]:
        raise ValueError("campaign_not_eligible")
    scheduled = campaign_timestamp(payload.get("scheduledAt")) or now()
    if payload.get("scheduledAt") and not campaign_timestamp(payload["scheduledAt"]):
        raise ValueError("invalid_campaign_schedule")
    if scheduled < now() - timedelta(minutes=1) or scheduled >= preview["data"]["expiresAt"]:
        raise ValueError("invalid_campaign_schedule")
    request_id = payload.get("requestId")
    if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9-]{16,80}", request_id):
        raise ValueError("campaign_request_id_required")
    identity = hashlib.sha256((str(actor_id) + ":" + request_id).encode()).hexdigest()
    db.whatsapp_campaigns.update_one({"_id": identity}, {"$setOnInsert": {"status": "scheduled", "data": preview["data"], "recipientIds": [item["userId"] for item in recipients],
        "previewDigest": preview["previewDigest"], "templateSignature": component_signature(preview["template"]["components"]),
        "recipientBindings": {item["userId"]: {"phoneHash": fingerprint(item["phone"], config), "variablesSignature": component_signature(item["parameters"])} for item in recipients},
        "templateName": preview["template"]["name"], "authorizedBy": str(actor_id), "authorizedAt": now(), "scheduledAt": scheduled, "cursor": 0, "createdAt": now()}}, upsert=True)
    saved = db.whatsapp_campaigns.find_one({"_id": identity}) or {}
    if saved.get("previewDigest") != preview["previewDigest"]:
        raise ValueError("campaign_request_id_reused")
    return {"campaignId": identity, "status": saved["status"], "recipientCount": len(saved["recipientIds"]), "scheduledAt": saved["scheduledAt"]}


def _campaign_values(db, config, campaign):
    data = campaign["data"]
    payload = {"event": data["event"], "collectionId": data["collectionId"], "couponId": data["couponId"], "audience": data["audience"], "expiresAt": data["expiresAt"], "description": data["description"]}
    current = campaign_data(db, config, payload)
    if current != data:
        raise ValueError("campaign_content_or_destination_changed")
    template = template_registry(db, config)[data["event"]]
    if template["name"] != campaign["templateName"] or component_signature(template["components"]) != campaign["templateSignature"] or not template["enabled"] or not template["approved"]:
        raise ValueError("campaign_template_changed")
    return data


def valid_campaign_delivery(db, config, context, event, phone, parameters, buttons):
    from .whatsapp import fingerprint, now
    if not marketing_enabled(db, config) or not isinstance(context, dict):
        return False
    campaign = db.whatsapp_campaigns.find_one({"_id": context.get("campaignId")}) or {}
    if (campaign.get("status") not in {"scheduled", "materializing", "queued"} or not campaign.get("authorizedAt") or not campaign.get("authorizedBy")
            or not campaign_timestamp(campaign.get("scheduledAt")) or campaign_timestamp(campaign["scheduledAt"]) > now()
            or not re.fullmatch(r"[a-f0-9]{64}", str(campaign.get("previewDigest", ""))) or context.get("userId") not in campaign.get("recipientIds", [])):
        return False
    try:
        data = _campaign_values(db, config, campaign)
        user = db.users.find_one({"_id": ObjectId(context["userId"])})
        binding = campaign.get("recipientBindings", {}).get(context["userId"], {})
        return bool(binding.get("phoneHash") == fingerprint(phone, config) and binding.get("variablesSignature") == component_signature(parameters)
                    and event == data["event"] and marketing_phone(db, config, user) == phone and body_parameters(data, user) == parameters and buttons == {"destination_path": data["destinationPath"].lstrip("/")})
    except (ValueError, KeyError, TypeError):
        return False


def materialize_campaigns(db, config, limit=50):
    from .whatsapp import now, _enqueue_notification
    if not marketing_enabled(db, config):
        return 0
    # A stale materialization claim can resume: this stage only inserts stable
    # outbox IDs; it never calls Meta or resets unknown provider outcomes.
    db.whatsapp_campaigns.update_many({"status": "materializing", "claimedAt": {"$lt": now() - timedelta(minutes=5)}}, {"$set": {"status": "scheduled"}})
    campaign = db.whatsapp_campaigns.find_one_and_update({"status": "scheduled", "scheduledAt": {"$lte": now()}}, {"$set": {"status": "materializing", "claimedAt": now()}}, sort=[("scheduledAt", 1)], return_document=ReturnDocument.AFTER)
    if not campaign:
        return 0
    processed = 0
    try:
        data = _campaign_values(db, config, campaign)
        for identity in campaign["recipientIds"][campaign["cursor"]:campaign["cursor"] + limit]:
            user = db.users.find_one({"_id": ObjectId(identity)})
            if marketing_phone(db, config, user):
                context = {"campaignId": campaign["_id"], "userId": identity}
                result = _enqueue_notification(db, data["event"], {}, key=f"campaign:{campaign['_id']}:{identity}", parameters=body_parameters(data, user), user=user,
                    campaign_context=context, button_parameters={"destination_path": data["destinationPath"].lstrip("/")})
                if result["status"] not in {"queued", "duplicate", "skipped"}:
                    raise ValueError("campaign_queue_unavailable")
            processed += 1
        cursor = campaign["cursor"] + processed
        db.whatsapp_campaigns.update_one({"_id": campaign["_id"]}, {"$set": {"cursor": cursor, "status": "queued" if cursor >= len(campaign["recipientIds"]) else "scheduled"}})
    except (ValueError, KeyError, TypeError):
        db.whatsapp_campaigns.update_one({"_id": campaign["_id"]}, {"$set": {"status": "held", "reason": "campaign_content_consent_or_approval_changed"}})
    return processed
