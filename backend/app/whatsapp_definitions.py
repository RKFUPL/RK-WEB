"""Additional submission drafts. This module never submits templates or grants approval."""
from copy import deepcopy
from urllib.parse import urlsplit
from .whatsapp_catalogue import CATALOGUE

MARKETING_CONSENT_TEXT = "I agree to receive optional WhatsApp collection launches and promotional offers from Rashi Kapoor at the number provided. I can unsubscribe from marketing at any time."
MARKETING_POLICY_VERSION = "whatsapp-marketing-v1"


def canonical_origin(config):
    value = str(config.get("WHATSAPP_CANONICAL_URL") or "").rstrip("/")
    parsed = urlsplit(value)
    if parsed.scheme != "https" or parsed.netloc != "rashikapoor.co.in" or parsed.path or parsed.query or parsed.fragment:
        raise ValueError("canonical_url_not_configured")
    return value


def definitions(config):
    result = deepcopy(CATALOGUE)
    try:
        origin = canonical_origin(config)
    except ValueError:
        origin = ""
    marketing = [
        ("rk_new_collection_drop", "new_collection_drop", ["first_name", "collection_name"], "A New Collection Has Arrived",
         "Hello {{1}},\nA new expression of Rashi Kapoor has arrived.\nDiscover {{2}}, our latest collection, thoughtfully curated and now available to explore.\nExplore the collection and discover pieces that speak to your style.", "Explore Collection"),
        ("rk_exclusive_offer", "exclusive_offer", ["first_name", "offer_description", "coupon_code", "expiry_date"], "A Special Offer for You",
         "Hello {{1}},\nA little something from Rashi Kapoor.\nEnjoy {{2}} on your next purchase with code {{3}}.\nOffer valid until {{4}}, subject to the applicable terms.\nExplore our collections and discover something you'll love.", "Shop Now"),
    ]
    for name, event, parameters, header, body, label in marketing:
        result[name] = {"name": name, "language": "en_US", "category": "MARKETING", "events": [event],
                        "parameters": parameters, "parameterTypes": ["text"] * len(parameters), "body": body,
                        "header": header, "footer": "Rashi Kapoor", "approvalStatus": "NOT_SUBMITTED",
                        "handler": "explicit authorized campaign", "buttonParameters": ["destination_path"],
                        "buttons": [{"type": "URL", "text": label, "url": origin + "/{{1}}" if origin else ""}]}
    labels = {"rk_order_confirmation": "View Order", "rk_payment_confirmation": "View Order", "rk_order_shipped": "Track Shipment",
              "rk_out_for_delivery": "Track Shipment", "rk_order_delivered": "View Order", "rk_order_cancelled": "View Order", "rk_refund_processed": "View Refund"}
    for original, label in labels.items():
        spec = deepcopy(CATALOGUE[original])
        spec.update(name=original + "_v2", versionOf=original, buttonParameters=["order_id"],
                    buttons=[{"type": "URL", "text": label, "url": origin + "/account/orders/{{1}}" if origin else ""}])
        result[spec["name"]] = spec
    return result


def definition_components(spec):
    if spec["category"] == "AUTHENTICATION":
        return deepcopy(spec["submissionComponents"])
    components = []
    if spec.get("header"):
        components.append({"type": "HEADER", "format": "TEXT", "text": spec["header"]})
    components.append({"type": "BODY", "text": spec["body"]})
    if spec.get("footer"):
        components.append({"type": "FOOTER", "text": spec["footer"]})
    if spec.get("buttons"):
        components.append({"type": "BUTTONS", "buttons": deepcopy(spec["buttons"])})
    return components


def order_button_parameters(template, order):
    from bson import ObjectId
    if not template.get("buttonParameters"):
        return {}
    if template["buttonParameters"] != ["order_id"] or not ObjectId.is_valid(str(order.get("_id"))):
        raise ValueError("invalid_order_button")
    if template.get("name") in {"rk_order_shipped_v2", "rk_out_for_delivery_v2"}:
        fulfillment = order.get("fulfillment") or {}
        if not fulfillment.get("courier") or not fulfillment.get("trackingNumber"):
            raise ValueError("shipment_not_recorded")
    return {"order_id": str(order["_id"])}
