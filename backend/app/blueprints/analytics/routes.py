import re
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from ...extensions import limiter
from ...rbac import database

analytics_bp = Blueprint("analytics", __name__)

EVENT_NAMES = {
    "page_view",
    "product_view",
    "wishlist_add",
    "add_to_bag",
    "checkout_started",
}
TRAFFIC_SOURCES = {"direct", "search", "social", "email", "referral"}
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


def _safe_text(value: object, maximum: int) -> str:
    return str(value or "").strip()[:maximum]


@analytics_bp.post("/events")
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

    raw_properties = payload.get("properties") if isinstance(payload.get("properties"), dict) else {}
    properties = {}
    for key in ("productId", "productName", "currency"):
        if raw_properties.get(key) is not None:
            properties[key] = _safe_text(raw_properties[key], 160)
    for key in ("quantity", "value"):
        value = raw_properties.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            properties[key] = max(0, value)

    database().analytics_events.insert_one({
        "event": event_name,
        "visitorId": visitor_id,
        "sessionId": session_id,
        "path": path,
        "source": source,
        "properties": properties,
        "createdAt": datetime.now(timezone.utc),
    })
    return jsonify({"recorded": True}), 202
