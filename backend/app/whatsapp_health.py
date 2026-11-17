"""Allowlisted Meta health evidence; messaging and SIP calling remain separate."""
import re

DISPLAY_NAME_LIMITATION = ('Your display name has not been approved yet. Your message limit will increase '
                           'after the display name is approved.')
DISPLAY_NAME_ACTION = 'WhatsApp Manager > Phone numbers > select number > Profile > Display name: review the display-name approval.'
SIP_CODES = {138024, 138025}
CAPACITIES = {'TIER_50': 50, 'TIER_250': 250, 'TIER_2K': 2000, 'TIER_10K': 10000,
              'TIER_100K': 100000, 'TIER_UNLIMITED': None}
HEALTH_STATES = {'AVAILABLE', 'LIMITED', 'BLOCKED'}


def safe_text(value, config):
    if not isinstance(value, str):
        return ''
    for key in ('WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
                'WHATSAPP_OUTBOX_KEY', 'MONGO_URI', 'SECRET_KEY', 'JWT_SECRET_KEY'):
        secret = config.get(key)
        if isinstance(secret, str) and len(secret) >= 4:
            value = value.replace(secret, '[redacted]')
    value = re.sub(r'https?://\S+', '[link]', value)
    value = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '[email]', value)
    value = re.sub(r'\+?\d[\d ()-]{6,}\d', '[identifier]', value)
    return ''.join(c for c in value if c >= ' ' or c == '\n')[:500]


def safe_errors(values, config):
    if not isinstance(values, list):
        return [], False
    complete = len(values) <= 10
    errors = []
    for value in values[:10]:
        if not isinstance(value, dict) or type(value.get('error_code')) is not int:
            complete = False
            continue
        code = value['error_code']
        errors.append({'code': code, 'description': safe_text(value.get('error_description'), config),
                       'possibleSolution': safe_text(value.get('possible_solution'), config),
                       'channel': 'calling_sip' if code in SIP_CODES else 'messaging_or_unknown'})
    return errors, complete


def normalize_health(health, config, checked_at):
    entities = []
    raw_entities = health.get('entities')
    complete = isinstance(raw_entities, list) and len(raw_entities) == 4
    expected = {'PHONE_NUMBER': str(config['WHATSAPP_PHONE_NUMBER_ID']),
                'WABA': str(config['WHATSAPP_BUSINESS_ACCOUNT_ID']),
                'BUSINESS': str(config.get('WHATSAPP_BUSINESS_PORTFOLIO_ID') or ''),
                'APP': str(config['WHATSAPP_APP_ID'])}
    for row in (raw_entities if isinstance(raw_entities, list) else [])[:10]:
        if not isinstance(row, dict):
            complete = False
            continue
        kind = row.get('entity_type') if row.get('entity_type') in {*expected, 'BUSINESS'} else 'UNKNOWN'
        ident = str(row.get('id') or '')
        bound = bool(ident and expected.get(kind) and expected.get(kind) == ident)
        info = row.get('additional_info', [])
        info_complete = isinstance(info, list) and len(info) <= 10 and all(isinstance(item, str) and len(item) <= 500 for item in info)
        errors, errors_complete = safe_errors(row.get('errors', []), config)
        state = row.get('can_send_message') if row.get('can_send_message') in HEALTH_STATES else 'UNKNOWN'
        entities.append({'type': kind, 'idMasked': '***' + ident[-4:],
            'can_send_message': state, 'messaging': state,
            'can_receive_call_sip': row.get('can_receive_call_sip') if row.get('can_receive_call_sip') in HEALTH_STATES else 'UNKNOWN',
            'additional_info': [safe_text(item, config) for item in info[:10]] if isinstance(info, list) else [],
            'errors': errors, 'errorCodes': [error['code'] for error in errors], 'checkedAt': checked_at,
            'scope': {'sourcePhoneNumberIdMasked': '***' + str(config['WHATSAPP_PHONE_NUMBER_ID'])[-4:],
                      'entityIdMasked': '***' + ident[-4:], 'matchesConfiguredEntity': bound},
            'detailsComplete': info_complete and errors_complete})
    root_errors, root_complete = safe_errors(health.get('errors', []), config)
    result = {'healthEvidenceVersion': 2, 'messagingHealth': health.get('can_send_message') if health.get('can_send_message') in HEALTH_STATES else 'UNKNOWN',
              'entities': entities, 'healthErrors': root_errors, 'detailsComplete': bool(complete and root_complete),
              'billingLedgerVerified': False}
    result['messagingEligibilityMode'] = health_mode(result) or 'INELIGIBLE'
    # Preserve the old AVAILABLE-only indicator. The exception is never general
    # sending authority; it requires a separate manual Utility-template context.
    result['providerEligibilityVerified'] = result['messagingEligibilityMode'] == 'AVAILABLE'
    result['displayNameLimitedCandidate'] = result['messagingEligibilityMode'] == 'DISPLAY_NAME_LIMITED'
    return result


def health_mode(evidence):
    if evidence.get('healthEvidenceVersion') != 2 or not evidence.get('detailsComplete'):
        return None
    rows = evidence.get('entities') or []
    if not isinstance(rows, list) or len(rows) != 4 or any(not isinstance(row, dict) for row in rows) or {row.get('type') for row in rows} != {'PHONE_NUMBER', 'WABA', 'BUSINESS', 'APP'}:
        return None
    if (not isinstance(evidence.get('healthErrors'), list)
            or any(not isinstance(row.get('errors'), list) or not isinstance(row.get('additional_info'), list)
                   or any(not isinstance(value, str) for value in row['additional_info']) for row in rows)):
        return None
    all_errors = [*evidence.get('healthErrors', []), *(error for row in rows for error in row.get('errors', []))]
    if any(not isinstance(error, dict) or error.get('code') not in SIP_CODES for error in all_errors):
        return None
    if any(not row.get('detailsComplete') or not (row.get('scope') or {}).get('matchesConfiguredEntity') for row in rows):
        return None
    states = {row['type']: row.get('can_send_message') for row in rows}
    overall = evidence.get('messagingHealth')
    all_messaging_available = all(value == 'AVAILABLE' for value in states.values())
    if overall == 'AVAILABLE' and all_messaging_available:
        return 'AVAILABLE'
    # Meta's documented calling/SIP-only example may have aggregate BLOCKED
    # while all per-entity messaging states are AVAILABLE. This mode describes
    # messaging eligibility only; messagingHealth retains Meta's aggregate.
    if overall == 'BLOCKED' and all_messaging_available and not evidence.get('healthErrors'):
        sip_errors = []
        for row in rows:
            errors = row.get('errors') or []
            if errors and row.get('can_receive_call_sip') != 'BLOCKED':
                return None
            if any(error.get('code') not in SIP_CODES or error.get('channel') != 'calling_sip' for error in errors):
                return None
            sip_errors.extend(errors)
        if sip_errors:
            return 'AVAILABLE_SIP_ONLY'
    phone = next(row for row in rows if row['type'] == 'PHONE_NUMBER')
    info = phone.get('additional_info') or []
    known = ' '.join(DISPLAY_NAME_LIMITATION.split()).casefold()
    if (overall == 'LIMITED' and states['PHONE_NUMBER'] == 'LIMITED'
            and all(states[key] == 'AVAILABLE' for key in ('WABA', 'BUSINESS', 'APP'))
            and info and all(' '.join(value.split()).casefold() == known for value in info)
            and all(not row.get('additional_info') for row in rows if row['type'] != 'PHONE_NUMBER')):
        return 'DISPLAY_NAME_LIMITED'
    return None


def health_error_codes(evidence):
    errors = list(evidence.get('healthErrors') or []) if isinstance(evidence.get('healthErrors'), list) else []
    rows = evidence.get('entities')
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and isinstance(row.get('errors'), list):
            errors.extend(row['errors'])
    return {item['code'] for item in errors if isinstance(item, dict) and type(item.get('code')) is int}
