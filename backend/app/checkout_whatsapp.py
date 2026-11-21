"""Select and bind checkout messaging independently of the delivery telephone."""
from .phone_numbers import customer_phone
from .whatsapp_consent import consent_phone


def checkout_recipient(db, config, user, payload, shipping, *, mandatory=False):
    from .whatsapp import opted_out
    for key in ("whatsappTransactionalConsent", "saveWhatsappAsPrimary"):
        if key in payload and not isinstance(payload[key], bool):
            raise ValueError("WhatsApp choices must be boolean.")
    explicit = payload.get("whatsappTransactionalConsent") is True
    supplied = payload.get("whatsappRecipient")
    if (supplied == "" and not mandatory and not explicit
            and payload.get("whatsappMarketingConsent") is not True
            and payload.get("saveWhatsappAsPrimary") is not True):
        return {"phone": None, "country": None, "source": "not_selected", "consent": None, "reason": "not_selected"}
    # Older clients can grant consent to an explicitly international delivery
    # number. They never gain an inferred country from the delivery address.
    legacy = not mandatory and supplied is None and "whatsappTransactionalConsent" in payload
    primary = user.get("whatsappPhone") or user.get("phone")
    value = (shipping.get("phone") if legacy else supplied) if (legacy or supplied is not None) else primary
    try:
        phone, country = customer_phone(value, payload.get("whatsappCountry") if supplied is not None else None)
    except ValueError:
        if supplied is not None or explicit or payload.get("saveWhatsappAsPrimary"):
            raise
        return {"phone": None, "country": None, "source": "primary_account", "consent": None, "reason": "invalid_recipient"}
    try:
        existing = consent_phone(db, config, user, {})
    except ValueError:
        existing = None
    grant = user.get("whatsappConsent") if existing == phone else None
    if legacy and not explicit:
        grant = None
    # A fresh explicit grant can withdraw an older STOP; an unchecked box cannot.
    if not explicit and opted_out(db, config, phone):
        grant = None
    if payload.get("saveWhatsappAsPrimary") and not (explicit or grant):
        raise ValueError("Confirm transactional consent before saving this WhatsApp number.")
    return {"phone": phone, "country": country, "source": "primary_account" if phone == primary and not legacy else "alternate_checkout",
            "consent": grant, "reason": None if explicit or grant else "missing_or_withdrawn_consent"}
