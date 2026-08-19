from datetime import datetime, timezone
import html
import re

import resend
from flask import Blueprint, current_app, jsonify, request

from ...catalog import (
    STOREFRONT_COLLECTION_PROJECTION,
    collection_document,
    collection_view,
    ensure_catalog_seed_once,
    is_excluded_collection,
    product_document,
    product_view,
)
from ...extensions import limiter
from ...rbac import database


catalog_bp = Blueprint("catalog", __name__)


def _request_text(value: object, maximum: int) -> str:
    return str(value or "").strip()[:maximum]


def _send_custom_order_emails(record: dict) -> None:
    api_key = current_app.config.get("RESEND_API_KEY")
    if not api_key:
        return

    product_name = html.escape(record["productName"])
    customer_name = html.escape(record["customerName"] or "Customer")
    email = html.escape(record["email"], quote=True)
    phone = html.escape(record["phone"] or "Not provided")
    requested_size = html.escape(record["requestedSize"] or "Not specified")
    message = html.escape(record["message"] or "No additional message.")
    measurements = "<br>".join(
        f"{html.escape(key)}: {html.escape(value)}"
        for key, value in record["measurements"].items()
    ) or "Not provided"
    sender = f'{current_app.config["EMAIL_FROM_NAME"]} <{current_app.config["EMAIL_FROM"]}>'
    operations_email = current_app.config.get("CUSTOM_ORDER_TO", "operations@chemo.in")

    resend.api_key = api_key
    try:
        resend.Emails.send({
            "from": sender,
            "to": [operations_email],
            "reply_to": [record["email"]],
            "subject": f"RK custom order request - {record['productName']}",
            "html": (
                "<div style='font-family:Arial,sans-serif;background:#f8f5ef;padding:28px'>"
                "<p style='letter-spacing:.24em;text-transform:uppercase;font-size:11px'>RASHI KAPOOR / CUSTOM ORDER</p>"
                f"<h1 style='font-family:Georgia,serif;font-weight:400'>{product_name}</h1>"
                f"<p><strong>Customer:</strong> {customer_name}<br><strong>Email:</strong> {email}<br>"
                f"<strong>Phone:</strong> {phone}<br><strong>Requested size:</strong> {requested_size}</p>"
                f"<p><strong>Measurements</strong><br>{measurements}</p>"
                f"<p><strong>Request</strong><br>{message}</p></div>"
            ),
        })
    except Exception:
        current_app.logger.exception("Unable to send custom order request to operations")

    try:
        resend.Emails.send({
            "from": sender,
            "to": [record["email"]],
            "subject": "We received your RK custom order request",
            "html": (
                "<div style='font-family:Arial,sans-serif;background:#f8f5ef;padding:32px;color:#27221d'>"
                "<p style='letter-spacing:.28em;text-transform:uppercase;font-size:11px'>RASHI KAPOOR</p>"
                "<h1 style='font-family:Georgia,serif;font-weight:400'>Your request is with the house.</h1>"
                f"<p>Dear {customer_name},</p>"
                f"<p>We received your custom order request for <strong>{product_name}</strong>. "
                "The RK team will review the request and get back to you by email.</p>"
                "<p>Yours sincerely,<br>The Rashi Kapoor Team</p></div>"
            ),
        })
    except Exception:
        current_app.logger.exception("Unable to send custom order acknowledgement")


@catalog_bp.post("/custom-order-requests")
@limiter.limit("8 per hour")
def create_custom_order_request():
    payload = request.get_json(silent=True) or {}
    product_id = _request_text(payload.get("productId"), 120)
    customer_name = _request_text(payload.get("name"), 120)
    email = _request_text(payload.get("email"), 160).lower()
    phone = _request_text(payload.get("phone"), 40)
    requested_size = _request_text(payload.get("requestedSize"), 40)
    message = _request_text(payload.get("message"), 2000)

    if not product_id:
        return jsonify({"error": "Product information is required."}), 400
    if not customer_name:
        return jsonify({"error": "Enter your name."}), 400
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return jsonify({"error": "Enter a valid email address."}), 400

    raw_measurements = payload.get("measurements") if isinstance(payload.get("measurements"), dict) else {}
    measurements = {
        _request_text(key, 80): _request_text(value, 40)
        for key, value in raw_measurements.items()
        if _request_text(key, 80) and _request_text(value, 40)
    }

    db = database()
    product = product_document(db, product_id)
    if not product:
        return jsonify({"error": "Product not found."}), 404

    record = {
        "productId": str(product["_id"]),
        "productName": _request_text(product.get("name"), 200) or "RK piece",
        "sku": _request_text(product.get("sku"), 120),
        "customerName": customer_name,
        "email": email,
        "phone": phone,
        "requestedSize": requested_size,
        "measurements": measurements,
        "message": message,
        "status": "new",
        "createdAt": datetime.now(timezone.utc),
    }
    result = db.custom_order_requests.insert_one(record)
    _send_custom_order_emails(record)
    return jsonify({
        "requestId": str(result.inserted_id),
        "message": "Request received. The RK team will get back to you by email.",
    }), 201


@catalog_bp.get("/collections/<slug>")
def storefront_collection(slug: str):
    db = database()
    ensure_catalog_seed_once(db)
    collection = collection_document(db, slug, STOREFRONT_COLLECTION_PROJECTION)
    if not collection:
        return jsonify({"error": "Collection not found."}), 404
    response = jsonify({"collection": collection_view(db, collection, product_media_limit=2, product_cards=True)})
    # Collection content is public and mostly editorial. A short edge cache
    # removes repeat DB work without allowing inventory status to go stale for
    # more than a few seconds; cart/checkout still revalidates stock.
    response.headers["Cache-Control"] = "public, max-age=0, s-maxage=15, stale-while-revalidate=30"
    return response, 200


@catalog_bp.get("/products/<product_id>")
def storefront_product(product_id: str):
    db = database()
    product = product_document(db, product_id)
    if not product:
        return jsonify({"error": "Product not found."}), 404
    object_id = product["_id"]
    collections = [
        collection_view(db, collection, include_products=False)
        for collection in db.collections.find({"productRefs.productId": object_id})
        if not is_excluded_collection(collection)
    ]
    return jsonify({"product": product_view(product), "collections": collections}), 200
