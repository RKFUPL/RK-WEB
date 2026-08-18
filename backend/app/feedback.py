"""Tokenised, expiring customer feedback for delivered orders."""

from datetime import datetime, timedelta, timezone
import hashlib
import html
import secrets

import resend
from bson import ObjectId
from flask import Blueprint, current_app, jsonify, request

from .rbac import database
from .time_utils import as_utc_datetime, isoformat_utc


feedback_bp = Blueprint("feedback", __name__)
FEEDBACK_TTL = timedelta(days=30)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def feedback_url(token: str) -> str:
    return f"{current_app.config.get('FRONTEND_URL', 'http://localhost:3000').rstrip('/')}/feedback/{token}"


def cleanup_feedback(db, now: datetime | None = None) -> int:
    current = now or datetime.now(timezone.utc)
    expired = list(db.feedback_tokens.find({"expiresAt": {"$lte": current}}, {"tokenHash": 1}))
    hashes = [row.get("tokenHash") for row in expired if row.get("tokenHash")]
    if hashes:
        db.feedback.delete_many({"tokenHash": {"$in": hashes}})
    result = db.feedback_tokens.delete_many({"expiresAt": {"$lte": current}})
    return int(result.deleted_count)


def create_feedback_token(db, order: dict, delivered_at: object | None = None) -> str:
    now = as_utc_datetime(delivered_at) or datetime.now(timezone.utc)
    token = secrets.token_urlsafe(32)
    db.feedback_tokens.insert_one({
        "tokenHash": _hash(token),
        "orderId": order["_id"],
        "customerId": order.get("customerId"),
        "orderNumber": str(order.get("orderNumber") or ""),
        "items": [{"productId": item.get("productId"), "name": item.get("name"), "sku": item.get("sku")} for item in order.get("items", []) if isinstance(item, dict)],
        "createdAt": now,
        "expiresAt": now + FEEDBACK_TTL,
        "submittedAt": None,
    })
    return token


def _token_record(db, token: str) -> dict | None:
    if not token or len(token) > 128:
        return None
    cleanup_feedback(db)
    return db.feedback_tokens.find_one({"tokenHash": _hash(token), "expiresAt": {"$gt": datetime.now(timezone.utc)}, "submittedAt": None})


def _context(record: dict) -> dict:
    return {"orderNumber": record.get("orderNumber"), "items": record.get("items") or [], "expiresAt": isoformat_utc(record.get("expiresAt"))}


def _rating(payload: dict, key: str) -> int | None:
    value = payload.get(key)
    if value in (None, ""):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{key} must be between 1 and 5.")
    if parsed < 1 or parsed > 5:
        raise ValueError(f"{key} must be between 1 and 5.")
    return parsed


def _send_feedback_email(record: dict, feedback: dict) -> None:
    api_key = current_app.config.get("RESEND_API_KEY")
    if not api_key:
        return
    ratings = "<br>".join(f"{html.escape(key)}: {value}/5" for key, value in feedback.get("ratings", {}).items() if value is not None)
    answers = "<br>".join(f"{html.escape(key)}: {html.escape(str(value))}" for key, value in feedback.get("answers", {}).items() if value not in (None, ""))
    products = ", ".join(html.escape(str(item.get("name") or item.get("sku") or "Product")) for item in record.get("items", []))
    resend.api_key = api_key
    resend.Emails.send({
        "from": f'{current_app.config["EMAIL_FROM_NAME"]} <{current_app.config["EMAIL_FROM"]}>',
        "to": ["operations@chemo.in"],
        "subject": f"RK customer feedback — {html.escape(str(record.get('orderNumber') or 'Order'))}",
        "html": f"<div style='font-family:Arial,sans-serif;background:#f8f5ef;padding:28px'><h1 style='font-family:Georgia,serif;font-weight:400'>Customer feedback</h1><p><strong>Order:</strong> {html.escape(str(record.get('orderNumber') or ''))}<br><strong>Customer:</strong> {html.escape(str(feedback.get('customerName') or 'Customer'))}<br><strong>Email:</strong> {html.escape(str(feedback.get('email') or ''))}<br><strong>Products:</strong> {products}</p><p><strong>Ratings</strong><br>{ratings}</p><p><strong>Answers</strong><br>{answers}</p></div>",
    })


@feedback_bp.get("/<token>")
def get_feedback(token: str):
    record = _token_record(database(), token)
    if not record:
        return jsonify({"error": "This feedback link is invalid, expired, or already used."}), 410
    return jsonify({"feedback": _context(record)}), 200


@feedback_bp.post("/<token>")
def submit_feedback(token: str):
    db = database()
    record = _token_record(db, token)
    if not record:
        return jsonify({"error": "This feedback link is invalid, expired, or already used."}), 410
    payload = request.get_json(silent=True) or {}
    try:
        ratings = {key: _rating(payload, key) for key in ("overall", "product", "fit", "delivery")}
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    if not any(value is not None for value in ratings.values()):
        return jsonify({"error": "Please provide at least one rating."}), 400
    answers = {key: str(payload.get(key) or "").strip()[:1000] for key in ("loved", "improve", "wouldPurchase", "comments")}
    now = datetime.now(timezone.utc)
    order = db.orders.find_one({"_id": record["orderId"]}) or {}
    feedback = {
        "tokenHash": record["tokenHash"],
        "orderId": record["orderId"],
        "customerId": record.get("customerId"),
        "orderNumber": record.get("orderNumber"),
        "customerName": str(order.get("customerName") or payload.get("customerName") or "").strip()[:120],
        "email": str(order.get("email") or payload.get("email") or "").strip()[:160].lower(),
        "ratings": ratings,
        "answers": answers,
        "itemFeedback": payload.get("itemFeedback") if isinstance(payload.get("itemFeedback"), list) else [],
        "submittedAt": now,
        "expiresAt": record.get("expiresAt"),
    }
    try:
        inserted = db.feedback.insert_one(feedback)
    except Exception:
        return jsonify({"error": "Feedback could not be submitted. Please try again."}), 409
    updated = db.feedback_tokens.update_one({"_id": record["_id"], "submittedAt": None}, {"$set": {"submittedAt": now}})
    if updated.modified_count != 1:
        db.feedback.delete_one({"_id": inserted.inserted_id})
        return jsonify({"error": "This feedback link has already been used."}), 409
    try:
        _send_feedback_email(record, feedback)
    except Exception:
        current_app.logger.exception("Unable to send feedback notification")
    return jsonify({"submitted": True}), 201


def ensure_feedback_indexes(db) -> None:
    db.feedback_tokens.create_index("tokenHash", unique=True)
    db.feedback_tokens.create_index("expiresAt", expireAfterSeconds=0)
    db.feedback.create_index([("orderId", 1), ("submittedAt", -1)])
    db.feedback.create_index("expiresAt", expireAfterSeconds=0)
