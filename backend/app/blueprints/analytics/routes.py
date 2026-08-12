import re
from datetime import datetime, timezone

from bson import ObjectId
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from ...extensions import limiter
from ...rbac import database

analytics_bp = Blueprint("analytics", __name__)
storefront_activity_bp = Blueprint("storefront_activity", __name__)

EVENT_NAMES = {
    "page_view",
    "product_view",
    "wishlist_add",
    "add_to_bag",
    "checkout_started",
    "presence",
}
TRAFFIC_SOURCES = {"direct", "search", "social", "email", "referral"}
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


def _safe_text(value: object, maximum: int) -> str:
    return str(value or "").strip()[:maximum]


def _client_device(user_agent: str) -> str:
    agent = user_agent.lower()
    if any(token in agent for token in ("ipad", "tablet", "kindle")):
        return "tablet"
    if any(token in agent for token in ("mobile", "iphone", "android")):
        return "mobile"
    return "desktop"


def _client_browser(user_agent: str) -> str:
    agent = user_agent.lower()
    if "edg/" in agent:
        return "Edge"
    if "opr/" in agent or "opera" in agent:
        return "Opera"
    if "firefox/" in agent:
        return "Firefox"
    if "chrome/" in agent or "crios/" in agent:
        return "Chrome"
    if "safari/" in agent and "chrome/" not in agent:
        return "Safari"
    return "Other"


def _client_os(user_agent: str) -> str:
    agent = user_agent.lower()
    if "windows" in agent:
        return "Windows"
    if "mac os" in agent or "macintosh" in agent:
        return "macOS"
    if "android" in agent:
        return "Android"
    if "iphone" in agent or "ipad" in agent or "ios" in agent:
        return "iOS"
    if "linux" in agent:
        return "Linux"
    return "Other"


@analytics_bp.post("/events")
@storefront_activity_bp.post("/activity")
@limiter.limit("120 per minute")
def record_event():
    payload = request.get_json(silent=True) or {}
    event_name = _safe_text(payload.get("event"), 40)
    visitor_id = _safe_text(payload.get("visitorId"), 128)
    session_id = _safe_text(payload.get("sessionId"), 128)
    path = _safe_text(payload.get("path"), 500).split("?", 1)[0]
    source = _safe_text(payload.get("source"), 20).lower()

    if event_name not in EVENT_NAMES:
        return jsonify({"error": "Unsupported analytics event."}), 400
    if not ID_PATTERN.fullmatch(visitor_id) or not ID_PATTERN.fullmatch(session_id):
        return jsonify({"error": "Invalid anonymous analytics identifier."}), 400
    if not path.startswith("/"):
        return jsonify({"error": "A valid page path is required."}), 400
    if source not in TRAFFIC_SOURCES:
        source = "direct"

    user_agent = _safe_text(request.user_agent.string, 300)
    referrer = _safe_text(request.referrer, 500)
    signed_in_user = None
    try:
        verify_jwt_in_request(optional=True)
        identity = get_jwt_identity()
        if identity and ObjectId.is_valid(identity):
            signed_in_user = database().users.find_one(
                {"_id": ObjectId(identity)},
                {"displayName": 1, "firstName": 1, "lastName": 1, "role": 1},
            )
    except Exception:
        # Analytics must never prevent a storefront page from loading.
        signed_in_user = None

    customer_name = ""
    if signed_in_user:
        # Internal accounts must never be recorded as storefront customers or
        # traffic visitors. Their admin/staff dashboard activity is separate
        # from customer analytics.
        if signed_in_user.get("role") in {"admin", "staff"}:
            return jsonify({"recorded": True}), 202
        customer_name = _safe_text(
            " ".join(filter(None, (signed_in_user.get("firstName"), signed_in_user.get("lastName"))))
            or signed_in_user.get("displayName")
            or "Signed-in customer",
            120,
        )

    raw_properties = payload.get("properties") if isinstance(payload.get("properties"), dict) else {}
    properties = {}
    for key in ("productId", "productName", "currency", "pageTitle"):
        if raw_properties.get(key) is not None:
            properties[key] = _safe_text(raw_properties[key], 200)
    for key in ("quantity", "value"):
        value = raw_properties.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            properties[key] = max(0, value)

    database().analytics_events.insert_one({
        "event": event_name,
        "visitorId": visitor_id,
        "sessionId": session_id,
        "userId": signed_in_user["_id"] if signed_in_user else None,
        "customerName": customer_name or None,
        "path": path,
        "source": source,
        "device": _client_device(user_agent),
        "browser": _client_browser(user_agent),
        "os": _client_os(user_agent),
        "referrer": referrer,
        "properties": properties,
        "createdAt": datetime.now(timezone.utc),
    })
    return jsonify({"recorded": True}), 202
