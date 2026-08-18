"""Secure customer return-shipment forms and return records."""

from datetime import datetime, timezone
import hashlib
import html
import secrets

import resend
from flask import Blueprint, current_app, jsonify, request
from pymongo import ReturnDocument

from .rbac import database
from .time_utils import isoformat_utc


returns_bp = Blueprint("returns", __name__)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def return_url(token: str) -> str:
    return f"{current_app.config.get('FRONTEND_URL', 'http://localhost:3000').rstrip('/')}/returns/{token}"


def create_return_request(db, order: dict, reason: str, accepted_by: dict | None = None) -> tuple[dict, str]:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    record = {
        "orderId": order["_id"],
        "customerId": order.get("customerId"),
        "orderNumber": order.get("orderNumber"),
        "status": "accepted",
        "reason": str(reason or "").strip()[:1000],
        "tokenHash": _hash(token),
        "createdAt": now,
        "acceptedAt": now,
        "acceptedBy": accepted_by.get("_id") if accepted_by else None,
        "shipment": None,
        "submittedAt": None,
    }
    db.returns.update_one({"orderId": order["_id"], "status": {"$ne": "submitted"}}, {"$setOnInsert": record}, upsert=True)
    return db.returns.find_one({"tokenHash": record["tokenHash"]}) or record, token


def _record(db, token: str) -> dict | None:
    if not token or len(token) > 128:
        return None
    return db.returns.find_one({"tokenHash": _hash(token), "status": "accepted", "submittedAt": None})


def _send_return_submission(record: dict, shipment: dict) -> None:
    api_key = current_app.config.get("RESEND_API_KEY")
    if not api_key:
        return
    resend.api_key = api_key
    resend.Emails.send({
        "from": f'{current_app.config["EMAIL_FROM_NAME"]} <{current_app.config["EMAIL_FROM"]}>',
        "to": ["operations@chemo.in"],
        "subject": f"RK return shipment submitted — {html.escape(str(record.get('orderNumber') or 'Order'))}",
        "html": f"<div style='font-family:Arial,sans-serif;background:#f8f5ef;padding:28px'><h1 style='font-family:Georgia,serif;font-weight:400'>Return shipment details</h1><p>Order: <strong>{html.escape(str(record.get('orderNumber') or ''))}</strong></p><p>Courier: {html.escape(shipment['courier'])}<br>LR number: {html.escape(shipment['lrNumber'])}<br>Dispatch date: {html.escape(shipment.get('dispatchDate') or '—')}<br>Note: {html.escape(shipment.get('note') or '—')}</p></div>",
    })


def send_return_accepted(db, order: dict, token: str, customer_note: str = "") -> None:
    api_key = current_app.config.get("RESEND_API_KEY")
    email = str(order.get("email") or "").strip().lower()
    if not api_key or not email:
        return
    resend.api_key = api_key
    link = return_url(token)
    note = f"<p>{html.escape(customer_note)}</p>" if customer_note else ""
    key = "return:accepted"
    claimed = db.orders.update_one({"_id": order["_id"], "notificationKeys": {"$ne": key}}, {"$addToSet": {"notificationKeys": key}})
    if claimed.modified_count != 1:
        return
    resend.Emails.send({
        "from": f'{current_app.config["EMAIL_FROM_NAME"]} <{current_app.config["EMAIL_FROM"]}>',
        "to": [email],
        "subject": f"Your RK return request has been accepted — {order.get('orderNumber', '')}",
        "html": f"<div style='font-family:Arial,sans-serif;background:#f8f5ef;padding:32px;color:#27221d'><p style='letter-spacing:.28em;text-transform:uppercase;font-size:11px'>RASHI KAPOOR</p><h1 style='font-family:Georgia,serif;font-weight:400'>Your return request has been accepted.</h1><p>Dear {html.escape(str(order.get('customerName') or 'Customer'))},</p><p>Please use the secure link below to provide the courier name and LR number for your return shipment.</p>{note}<p><a href='{html.escape(link, quote=True)}'>Submit return shipment details</a></p><p>Yours sincerely,<br>The Rashi Kapoor Team</p></div>",
    })


@returns_bp.get("/<token>")
def get_return_form(token: str):
    record = _record(database(), token)
    if not record:
        return jsonify({"error": "This return link is invalid or has already been used."}), 410
    return jsonify({"return": {"orderNumber": record.get("orderNumber"), "reason": record.get("reason"), "acceptedAt": isoformat_utc(record.get("acceptedAt"))}}), 200


@returns_bp.post("/<token>")
def submit_return_form(token: str):
    db = database()
    record = _record(db, token)
    if not record:
        return jsonify({"error": "This return link is invalid or has already been used."}), 410
    payload = request.get_json(silent=True) or {}
    courier = str(payload.get("courier") or "").strip()[:100]
    lr_number = str(payload.get("lrNumber") or "").strip()[:160]
    if not courier or not lr_number:
        return jsonify({"error": "Courier name and LR number are required."}), 400
    shipment = {"courier": courier, "lrNumber": lr_number, "dispatchDate": str(payload.get("dispatchDate") or "").strip()[:20], "note": str(payload.get("note") or "").strip()[:1000]}
    now = datetime.now(timezone.utc)
    updated = db.returns.find_one_and_update({"_id": record["_id"], "status": "accepted", "submittedAt": None}, {"$set": {"status": "submitted", "shipment": shipment, "submittedAt": now}}, return_document=ReturnDocument.AFTER)
    if not updated:
        return jsonify({"error": "This return shipment has already been submitted."}), 409
    db.orders.update_one({"_id": record["orderId"]}, {"$set": {"returnRequest.status": "shipment_submitted", "returnRequest.shipment": shipment, "returnRequest.submittedAt": now}})
    try:
        _send_return_submission(updated, shipment)
    except Exception:
        current_app.logger.exception("Unable to send return shipment notification")
    return jsonify({"submitted": True}), 201
