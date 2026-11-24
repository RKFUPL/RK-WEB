"""Account-owned service channel choices. Channel selection never grants consent."""
from .phone_numbers import customer_phone
from .time_utils import as_utc_datetime

VERSION = 'service-channels-v1'
AUTH_TEXT = 'I request authentication codes from Rashi Kapoor on WhatsApp at my selected number. This does not enable order updates or marketing.'
OTP_REQUEST_TEXT = 'I request this verification code on WhatsApp at my provided account number. This request does not enable marketing.'


def collection_mode(db):
    settings = db.admin_settings.find_one({'_id': 'store'}) or {}
    return 'onboarding' if settings.get('whatsappConsentCollectionMode') == 'onboarding' else 'checkout'


def channel_choice(value):
    if not isinstance(value, dict) or any(value.get(key) not in ('email', 'whatsapp', 'both') for key in ('otpChannel', 'utilityChannel')) or value.get('utilityChannel') == 'both':
        raise ValueError('Choose Email or WhatsApp separately for authentication and order updates.')
    return {key: value[key] for key in ('otpChannel', 'utilityChannel')}


def choice_completed(user):
    choice = user.get('communicationPreferences') or {}
    try:
        channel_choice(choice)
    except ValueError:
        return False
    return bool(choice.get('version') == VERSION and choice.get('customerId') == str(user.get('_id')) and as_utc_datetime(choice.get('timestamp')) and choice.get('source'))


def authentication_consent_valid(db, config, user, phone=None):
    from .whatsapp_consent import opted_out
    record = user.get('whatsappOtpConsentRecord') or {}
    try:
        actual, _ = customer_phone(phone or user.get('whatsappPhone'))
    except ValueError:
        return False
    return bool(record.get('enabled') is True and record.get('category') == 'authentication'
                and record.get('customerId') == str(user.get('_id')) and record.get('phone') == actual
                and record.get('source') and as_utc_datetime(record.get('timestamp')) and not opted_out(db, config, actual, category='authentication'))


def record_authentication_consent(db, config, user_id, phone, enabled, source):
    from .whatsapp_consent import record_consent
    record = record_consent(db, config, user_id, phone, enabled, source, category='authentication', update_user=False)
    db.users.update_one({'_id': user_id}, {'$set': {'whatsappOtpConsentRecord': record}})
    return record


def authentication_recipient(db, config, user):
    # Existing per-challenge affirmative requests remain mandatory. A profile
    # preference only selects a verified recipient; it never authorizes a send.
    if authentication_consent_valid(db, config, user):
        return user.get('whatsappPhone')
    return user.get('phone')


def record_choice(db, user, choice, source):
    from .whatsapp import now
    record = {**channel_choice(choice), 'version': VERSION, 'customerId': str(user['_id']),
              'timestamp': now(), 'source': source, 'whatsappPhone': user.get('whatsappPhone'),
              'text': 'Choose supported channels separately for required authentication and order updates. WhatsApp requires explicit category-specific permission; Email is an alternative.',
              'whatsappCountry': user.get('whatsappCountry'),
              'transactionalConsentId': (user.get('whatsappConsent') or {}).get('consentId'),
              'authenticationConsentId': (user.get('whatsappOtpConsentRecord') or {}).get('consentId')}
    audit_id = db.communication_preferences.insert_one(dict(record)).inserted_id
    db.users.update_one({'_id': user['_id']}, {'$set': {'communicationPreferences': {**record, 'auditId': str(audit_id)}}})


def public_preferences(db, config, user):
    from .whatsapp_consent import consent_phone
    try:
        transactional = bool(consent_phone(db, config, user, {}))
    except ValueError:
        transactional = False
    auth = authentication_consent_valid(db, config, user)
    stored = user.get('communicationPreferences') if isinstance(user.get('communicationPreferences'), dict) else {}
    return {'completed': choice_completed(user), 'version': stored.get('version'),
            'otpChannel': stored.get('otpChannel', 'email'),
            'utilityChannel': stored.get('utilityChannel', 'whatsapp' if transactional else 'email'),
            'effectiveOtpChannel': 'whatsapp' if auth and stored.get('otpChannel') in ('whatsapp', 'both') else 'email',
            'effectiveUtilityChannel': 'whatsapp' if transactional and stored.get('utilityChannel', 'whatsapp') == 'whatsapp' else 'email'}


DELIVERY_MODES = ('email', 'whatsapp', 'both')


def delivery_mode(db, category):
    """Only persisted administrator policy selects operational delivery channels."""
    key, default = ('authenticationDeliveryMode', 'email') if category == 'authentication' else ('transactionalDeliveryMode', 'both')
    settings = db.admin_settings.find_one({'_id': 'store'}) or {}
    value = settings.get(key, default)
    return value if value in DELIVERY_MODES else 'email'


def channel_enabled(db, category, channel):
    return delivery_mode(db, category) in (channel, 'both')
