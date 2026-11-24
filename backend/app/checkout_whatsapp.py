"""Select and bind checkout messaging independently of the delivery telephone."""
from .phone_numbers import customer_phone
from .whatsapp_consent import consent_phone


def checkout_recipient(db, config, user, payload, shipping, *, mandatory=False):
    from .whatsapp import opted_out
    from .communication_preferences import collection_mode
    if collection_mode(db) == 'onboarding':
        if payload.get('saveWhatsappAsPrimary') is True:
            raise ValueError('Update your primary WhatsApp number and permission in Account Settings.')
        try:
            approved_phone = consent_phone(db, config, user, {})
        except ValueError:
            approved_phone = None
        supplied = payload.get('whatsappRecipient')
        if not approved_phone:
            if payload.get('whatsappTransactionalConsent') is True or payload.get('saveWhatsappAsPrimary') is True:
                raise ValueError('Update WhatsApp permission in Account Settings before selecting this recipient.')
            return {'phone': None, 'country': None, 'source': 'account_email', 'consent': None, 'reason': 'email_channel_selected'}
        if supplied:
            phone, _ = customer_phone(supplied, payload.get('whatsappCountry'))
            if phone != approved_phone:
                raise ValueError('Update your WhatsApp recipient and permission in Account Settings before checkout.')
        phone, country = customer_phone(approved_phone)
        return {'phone': phone, 'country': country, 'source': 'primary_account', 'consent': user['whatsappConsent'], 'reason': None}
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
