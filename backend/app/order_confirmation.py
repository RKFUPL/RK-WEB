"""Premium, retryable order-confirmation email delivery."""

from __future__ import annotations

from datetime import datetime, timezone
import html
import re

import resend

from .rbac import effective_permissions


OPERATIONS_BCC = "operations@chemo.in"


def _text(value: object, maximum: int = 500) -> str:
    return str(value or "").strip()[:maximum]


def _email(value: object) -> str:
    candidate = _text(value, 160).lower()
    return candidate if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", candidate) else ""


def _money(value: object) -> str:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        amount = 0
    return f"&#8377;{amount:,.0f}"


def _date(value: object) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).strftime("%d %B %Y, %H:%M UTC")
    return html.escape(_text(value, 100) or "Not recorded")


def confirmation_bcc_recipients(database, configured: object = None) -> list[str]:
    recipients = [OPERATIONS_BCC]
    if isinstance(configured, str):
        recipients.extend(part.strip() for part in configured.split(","))
    elif isinstance(configured, (list, tuple, set)):
        recipients.extend(str(part).strip() for part in configured)
    users = database.users.find(
        {"role": {"$in": ["admin", "staff"]}, "isActive": {"$ne": False}},
        {"email": 1, "role": 1, "permissions": 1, "isActive": 1},
    )
    for user in users:
        if user.get("isActive") is False or user.get("role") not in {"admin", "staff"}:
            continue
        if user.get("role") == "admin" or "orders:manage" in effective_permissions(user):
            recipients.append(_email(user.get("email")))
    unique = []
    for recipient in recipients:
        valid = _email(recipient)
        if valid and valid not in unique:
            unique.append(valid)
    return unique[:49]


def _measurement_rows(item: dict) -> str:
    custom_size = item.get("customSize") if isinstance(item.get("customSize"), dict) else {}
    measurements = custom_size.get("measurements") if isinstance(custom_size.get("measurements"), dict) else {}
    if not measurements:
        return ""
    unit = html.escape(_text(custom_size.get("unit"), 10) or "cm")
    rows = "".join(
        f"<tr><td style='padding:3px 12px 3px 0;color:#777'>{html.escape(_text(label, 60))}</td>"
        f"<td style='padding:3px 0'>{html.escape(_text(value, 40))} {unit}</td></tr>"
        for label, value in measurements.items()
    )
    return f"<p style='margin:12px 0 5px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9a7a4d'>Custom Size</p><table style='font-size:12px;border-collapse:collapse'>{rows}</table>"


def _item_html(item: dict) -> str:
    image_url = _text(item.get("image"), 2048)
    image = ""
    if re.match(r"^https://", image_url, re.I):
        image = f"<img src='{html.escape(image_url, quote=True)}' alt='' width='116' style='display:block;width:116px;height:150px;object-fit:cover;border-radius:10px;background:#eee6da'>"
    name = html.escape(_text(item.get("name") or item.get("productCode"), 180) or "RK piece")
    code = html.escape(_text(item.get("productCode"), 120))
    sku = html.escape(_text(item.get("sku"), 140))
    collection = html.escape(_text(item.get("collection"), 120))
    colour = html.escape(_text(item.get("colour"), 120))
    size = html.escape(_text(item.get("size"), 30))
    try:
        quantity = max(1, int(item.get("quantity") or 1))
    except (TypeError, ValueError):
        quantity = 1
    unit_price = _money(item.get("unitPrice"))
    try:
        calculated_total = float(item.get("unitPrice") or 0) * quantity
    except (TypeError, ValueError):
        calculated_total = 0
    line_total = _money(item.get("lineTotal") if item.get("lineTotal") is not None else calculated_total)
    custom = _measurement_rows(item)
    size_line = "Custom Size" if custom else f"Size: {size or 'Not specified'}"
    details = "<br>".join(part for part in [
        f"Product code: {code}" if code else "",
        f"SKU: {sku}" if sku else "",
        f"Collection: {collection}" if collection else "",
        f"Colour: {colour}" if colour else "",
        size_line,
        f"Quantity: {quantity}",
        f"Unit price: {unit_price}",
    ] if part)
    return (
        "<tr><td style='padding:22px 0;border-bottom:1px solid #e3ddd3'>"
        "<table role='presentation' width='100%' style='border-collapse:collapse'><tr>"
        f"<td width='132' valign='top'>{image}</td>"
        f"<td valign='top'><h3 style='font-family:Georgia,serif;font-size:22px;font-weight:400;margin:0 0 10px'>{name}</h3>"
        f"<p style='font-size:12px;line-height:1.8;color:#625c54;margin:0'>{details}</p>{custom}</td>"
        f"<td width='105' valign='top' align='right' style='font-size:13px'>{line_total}</td>"
        "</tr></table></td></tr>"
    )


def render_order_confirmation(order: dict) -> str:
    customer = html.escape(_text(order.get("customerName"), 160) or "Customer")
    number = html.escape(_text(order.get("orderNumber"), 100))
    payment = order.get("payment") if isinstance(order.get("payment"), dict) else {}
    payment_status = html.escape(_text(payment.get("status") or order.get("paymentStatus"), 40).upper() or "PAID")
    items = order.get("items") if isinstance(order.get("items"), list) else []
    item_rows = "".join(_item_html(item) for item in items if isinstance(item, dict))
    shipping = order.get("shipping") if isinstance(order.get("shipping"), dict) else {}
    address_lines = [
        _text(shipping.get("fullName"), 160),
        _text(shipping.get("line1"), 240),
        _text(shipping.get("line2"), 240),
        ", ".join(filter(None, [_text(shipping.get("city"), 100), _text(shipping.get("state"), 100), _text(shipping.get("postalCode"), 30)])),
        _text(shipping.get("country"), 100),
        f"Phone: {_text(shipping.get('phone') or order.get('phone'), 40)}" if _text(shipping.get("phone") or order.get("phone"), 40) else "",
    ]
    address = "<br>".join(html.escape(line) for line in address_lines if line)
    subtotal = _money(order.get("subtotal"))
    shipping_charge = _money(order.get("shippingCharge"))
    total = _money(order.get("total"))
    return f"""
    <div style="margin:0;background:#f4f0e8;padding:34px 12px;color:#27221d;font-family:Arial,sans-serif">
      <table role="presentation" width="100%" style="max-width:760px;margin:auto;border-collapse:collapse;background:#fffdf9">
        <tr><td style="padding:38px 42px 26px;border-bottom:1px solid #e3ddd3">
          <p style="margin:0;font-size:11px;letter-spacing:.30em;color:#9a7a4d">RASHI KAPOOR</p>
          <h1 style="font-family:Georgia,serif;font-size:38px;font-weight:400;margin:16px 0 10px">Your order is confirmed.</h1>
          <p style="margin:0;color:#706960;font-size:14px;line-height:1.7">Dear {customer}, payment has been securely verified and your order is now with the house.</p>
        </td></tr>
        <tr><td style="padding:24px 42px;background:#faf7f1">
          <table role="presentation" width="100%" style="font-size:12px;line-height:1.8"><tr>
            <td><strong>Order</strong><br>{number}</td><td><strong>Order date</strong><br>{_date(order.get('createdAt'))}</td><td><strong>Payment</strong><br>{payment_status}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:8px 42px 0"><table role="presentation" width="100%" style="border-collapse:collapse">{item_rows}</table></td></tr>
        <tr><td style="padding:26px 42px"><table role="presentation" width="100%" style="border-collapse:collapse"><tr>
          <td valign="top" style="width:58%;padding-right:30px"><p style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9a7a4d;margin:0 0 12px">Shipping address</p><p style="font-size:13px;line-height:1.8;margin:0;color:#625c54">{address or 'Address not recorded'}</p></td>
          <td valign="top"><table role="presentation" width="100%" style="font-size:13px;line-height:2"><tr><td>Subtotal</td><td align="right">{subtotal}</td></tr><tr><td>Shipping</td><td align="right">{shipping_charge}</td></tr><tr style="font-size:16px"><td style="border-top:1px solid #d8d0c4;padding-top:8px"><strong>Total</strong></td><td align="right" style="border-top:1px solid #d8d0c4;padding-top:8px"><strong>{total}</strong></td></tr></table></td>
        </tr></table></td></tr>
        <tr><td style="padding:25px 42px;background:#27221d;color:#f8f3e9;font-size:12px;line-height:1.7">Yours sincerely,<br>The Rashi Kapoor Team</td></tr>
      </table>
    </div>"""


def send_order_confirmation(database, order: dict, config, logger, *, force: bool = False) -> bool:
    order_id = order.get("_id")
    recipient = _email(order.get("email"))
    if not order_id or not recipient:
        return False
    existing = order.get("confirmationEmail") if isinstance(order.get("confirmationEmail"), dict) else {}
    if existing.get("status") == "sent" and not force:
        return True
    now = datetime.now(timezone.utc)
    query = {"_id": order_id} if force else {"_id": order_id, "confirmationEmail.status": {"$nin": ["sent", "sending"]}}
    claimed = database.orders.update_one(query, {
        "$set": {"confirmationEmail.status": "sending", "confirmationEmail.lastAttemptAt": now, "confirmationEmail.error": None},
        "$inc": {"confirmationEmail.attempts": 1},
    })
    if claimed.modified_count != 1:
        current = database.orders.find_one({"_id": order_id}, {"confirmationEmail": 1}) or {}
        return (current.get("confirmationEmail") or {}).get("status") == "sent"
    api_key = _text(config.get("RESEND_API_KEY"), 300)
    if not api_key:
        database.orders.update_one({"_id": order_id}, {"$set": {"confirmationEmail.status": "failed", "confirmationEmail.error": "Email service is not configured."}})
        logger.warning("Order confirmation email is pending because RESEND_API_KEY is not configured")
        return False
    try:
        resend.api_key = api_key
        response = resend.Emails.send({
            "from": f'{config["EMAIL_FROM_NAME"]} <{config["EMAIL_FROM"]}>',
            "to": [recipient],
            "bcc": confirmation_bcc_recipients(database, config.get("ORDER_CONFIRMATION_BCC", "")),
            "subject": f"Rashi Kapoor order confirmed — {_text(order.get('orderNumber'), 100)}",
            "html": render_order_confirmation(order),
        })
        provider_id = _text((response or {}).get("id") if isinstance(response, dict) else "", 180)
        database.orders.update_one({"_id": order_id}, {
            "$set": {"confirmationEmail.status": "sent", "confirmationEmail.sentAt": datetime.now(timezone.utc), "confirmationEmail.providerId": provider_id, "confirmationEmail.error": None},
            "$push": {"notificationLog": {"key": "order_confirmation", "status": "sent", "timestamp": datetime.now(timezone.utc), "providerId": provider_id}},
        })
        return True
    except Exception as error:
        database.orders.update_one({"_id": order_id}, {
            "$set": {"confirmationEmail.status": "failed", "confirmationEmail.error": _text(error, 240)},
            "$push": {"notificationLog": {"key": "order_confirmation", "status": "failed", "timestamp": datetime.now(timezone.utc), "error": _text(error, 240)}},
        })
        logger.exception("Unable to send order confirmation email")
        return False
