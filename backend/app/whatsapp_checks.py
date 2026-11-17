"""Admin evidence refresh. Provider operations are GET-only; no dispatch/control writes."""
from datetime import timedelta
import hashlib
import hmac
from pathlib import Path

import requests

from .time_utils import as_utc_datetime

SCOPES = ('configuration', 'billing', 'sender', 'templates', 'webhook', 'worker', 'outbox')
STATUSES = {'VERIFIED', 'BLOCKED', 'ACTION REQUIRED', 'NOT VERIFIED', 'UNKNOWN', 'DISABLED BY CONFIGURATION'}
FRESHNESS = timedelta(minutes=15)


def scope_key(config):
    value = ':'.join(str(config.get(k) or '') for k in ('WHATSAPP_APP_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_API_VERSION'))
    return hmac.new(str(config.get('WHATSAPP_APP_SECRET') or '').encode(), value.encode(), hashlib.sha256).hexdigest()


def code_version():
    root = Path(__file__).parent
    return hashlib.sha256(b''.join((root / name).read_bytes() for name in (
        'whatsapp.py', 'whatsapp_orders.py', 'whatsapp_consent.py', 'whatsapp_templates.py', 'whatsapp_checks.py',
    ))).hexdigest()[:16]


def _get(config, path, fields=None, *, app=False):
    token = config.get('WHATSAPP_ACCESS_TOKEN')
    if app:
        token = str(config.get('WHATSAPP_APP_ID') or '') + '|' + str(config.get('WHATSAPP_APP_SECRET') or '')
    response = requests.get('https://graph.facebook.com/' + str(config['WHATSAPP_API_VERSION']) + '/' + str(path),
        headers={'Authorization': 'Bearer ' + str(token or '')}, params={'fields': fields} if fields else {},
        timeout=(3.05, 10), allow_redirects=False)
    response.raise_for_status()
    body = response.json()
    if not isinstance(body, dict) or body.get('error'):
        raise ValueError('provider_read_failed')
    return body


def _enum(value, values):
    return value if isinstance(value, str) and value in values else 'UNKNOWN'


def _edge(config, path, *, app=False):
    # No partial first-page absence is reported as a definitive missing subscription.
    body = _get(config, path, app=app)
    if not isinstance(body.get('data'), list) or (body.get('paging') or {}).get('next'):
        raise ValueError('incomplete_subscription_read')
    return [row for row in body['data'] if isinstance(row, dict)]


def _result(key, status, reason, action, source, evidence=None):
    from .whatsapp import now
    return {'key': key, 'status': status, 'reason': reason, 'action': action, 'source': source,
            'checkedAt': now(), 'evidence': evidence or {}}


def _configuration(db, config):
    from .whatsapp import production_test_state, configuration_errors
    state = db.integrations.find_one({'_id': 'whatsapp'}) or {}
    test = production_test_state(config)
    keys = ('WHATSAPP_ENABLED', 'WHATSAPP_ORDER_NOTIFICATIONS_ENABLED', 'WHATSAPP_TEST_SEND_ENABLED',
            'WHATSAPP_PRODUCTION_TEST_SEND_ENABLED', 'WHATSAPP_MARKETING_ENABLED')
    return _result('configuration', 'VERIFIED' if test['enabled'] and not configuration_errors(config) else 'DISABLED BY CONFIGURATION',
        test['reason'] or ('configuration_incomplete' if configuration_errors(config) else 'Temporary manual test gate is open; provider checks are still required.'),
        'Authorize a short UTC test window through the protected backend environment; never enable unrelated workflows.',
        'Current backend process configuration and admin control',
        {**{key: config.get(key) is True for key in keys}, 'expiresAt': test['expiresAt'],
         'adminOrderControl': state.get('orderNotificationsEnabled') is True,
         'gateScopes': {
             'WHATSAPP_ENABLED': 'General automation/Authentication authority; not manual production tests.',
             'WHATSAPP_ORDER_NOTIFICATIONS_ENABLED': 'Permitted transactional order events only; also needs admin order control, each enabled mapping and saved consent.',
             'WHATSAPP_TEST_SEND_ENABLED': 'Development-only tests; free text additionally requires a verified service window.',
             'WHATSAPP_PRODUCTION_TEST_SEND_ENABLED': 'Temporary admin Utility template test only; fresh provider evidence and valid UTC expiry are mandatory.',
             'WHATSAPP_MARKETING_ENABLED': 'Marketing approval and marketing consent remain separate; this does not authorize a Utility test.',
         },
         'mappingEnablementScope': 'Individual template switches control automation, not manual tests.'})


def _billing(db, config):
    body = _get(config, config['WHATSAPP_PHONE_NUMBER_ID'], 'health_status')
    health = body.get('health_status') or {}
    overall = _enum(health.get('can_send_message'), {'AVAILABLE', 'LIMITED', 'BLOCKED'})
    entities = []
    matches = {}
    for row in health.get('entities', []):
        if not isinstance(row, dict):
            continue
        kind = _enum(row.get('entity_type'), {'PHONE_NUMBER', 'WABA', 'BUSINESS', 'APP'})
        state = _enum(row.get('can_send_message'), {'AVAILABLE', 'LIMITED', 'BLOCKED'})
        ident = str(row.get('id') or '')
        expected = {'PHONE_NUMBER': config['WHATSAPP_PHONE_NUMBER_ID'], 'WABA': config['WHATSAPP_BUSINESS_ACCOUNT_ID'], 'APP': config['WHATSAPP_APP_ID']}.get(kind)
        if expected is not None and ident == str(expected):
            matches[kind] = state
        codes = [e.get('error_code') for e in row.get('errors', []) if isinstance(e, dict) and isinstance(e.get('error_code'), int)]
        entities.append({'type': kind, 'idMasked': '***' + ident[-4:], 'messaging': state, 'errorCodes': codes[:10]})
    eligible = overall == 'AVAILABLE' and all(matches.get(key) == 'AVAILABLE' for key in ('PHONE_NUMBER', 'WABA', 'APP'))
    failure = db.whatsapp_messages.find_one({'$or': [{'error.code': 131042}, {'failureDetails.errors.code': 131042}]},
                                          {'updatedAt': 1, 'failedAt': 1}, sort=[('updatedAt', -1)])
    return _result('billing', 'BLOCKED' if overall == 'BLOCKED' else 'ACTION REQUIRED' if overall == 'LIMITED' else 'NOT VERIFIED',
        'Current provider messaging eligibility is available; the paid balance and Messaging Account billing relationship still require manual verification.' if eligible else
        'Meta messaging health is ' + overall + '. Billing ledger clearance and account relationship are not inferred from this result.',
        'Meta Business > Billing & Payments > Messaging Accounts: select the account linked to WABA ending ' + str(config['WHATSAPP_BUSINESS_ACCOUNT_ID'])[-4:] + '. Reconcile the charge, outstanding balance and restrictions. Call/SIP codes 138024/138025 do not prove a billing restriction.',
        'Fresh Meta phone health_status GET; no Ad Account billing query',
        {'messagingHealth': overall, 'providerEligibilityVerified': eligible, 'billingLedgerVerified': False, 'entities': entities,
         'recordedPaymentEligibilityFailure': {'code': 131042, 'observedAt': failure.get('failedAt') or failure.get('updatedAt'),
             'meaning': 'Historical payment/business-eligibility failure; current clearance requires fresh Meta review.'} if failure else None})


def _sender(db, config):
    values = {}
    # Keep unsupported/permission-limited fields independent; never guess a value.
    for field in ('code_verification_status', 'status', 'name_status', 'quality_rating', 'display_phone_number'):
        try:
            values[field] = _get(config, config['WHATSAPP_PHONE_NUMBER_ID'], field).get(field)
        except (requests.RequestException, ValueError, TypeError, KeyError):
            values[field] = None
    # This is the sender's OTP code status; it is not the WABA's business
    # verification and does not itself mean a connected sender is unregistered.
    code_verification = _enum(values['code_verification_status'], {'VERIFIED', 'NOT_VERIFIED', 'EXPIRED'})
    registration = _enum(values['status'], {'CONNECTED', 'PENDING', 'DISCONNECTED', 'UNREGISTERED', 'FLAGGED', 'RESTRICTED', 'BANNED'})
    try:
        business = _get(config, config['WHATSAPP_BUSINESS_ACCOUNT_ID'],
                        'business_verification_status,whatsapp_business_manager_messaging_limit')
    except (requests.RequestException, ValueError, TypeError, KeyError):
        business = {}
    business_verification = _enum(business.get('business_verification_status').upper() if isinstance(business.get('business_verification_status'), str) else None,
        {'EXPIRED', 'FAILED', 'INELIGIBLE', 'NOT_VERIFIED', 'PENDING', 'PENDING_NEED_MORE_INFO',
         'PENDING_SUBMISSION', 'REJECTED', 'REVOKED', 'VERIFIED'})
    messaging_tier = _enum(business.get('whatsapp_business_manager_messaging_limit').upper() if isinstance(business.get('whatsapp_business_manager_messaging_limit'), str) else None,
        {'TIER_50', 'TIER_250', 'TIER_2K', 'TIER_10K', 'TIER_100K', 'TIER_UNLIMITED', 'UNTIERED'})
    status = ('VERIFIED' if registration == 'CONNECTED' and code_verification == 'VERIFIED' else
              'UNKNOWN' if registration == 'CONNECTED' else
              'ACTION REQUIRED' if registration == 'PENDING' else
              'UNKNOWN' if registration == 'UNKNOWN' else 'BLOCKED')
    if registration in {'DISCONNECTED', 'UNREGISTERED', 'BANNED', 'RESTRICTED'}:
        status = 'BLOCKED'
    digits = ''.join(c for c in str(values.get('display_phone_number') or '') if c.isdigit())
    return _result('sender', status, 'Sender API status is ' + registration + '. Phone ownership OTP code status is ' + code_verification + '; these fields conflict when the sender is CONNECTED but its code status says NOT_VERIFIED. Business verification and messaging eligibility are separate fields.',
        'Review the CONNECTED sender and OTP code status together in WhatsApp Manager. Do not remove, re-add or request another code for a CONNECTED sender solely from this conflicting read. Use the WABA field for business verification and health_status for messaging eligibility.',
        'Fresh Meta Phone Number ID and configured WABA GETs', {'phoneNumberId': str(config['WHATSAPP_PHONE_NUMBER_ID']), 'phoneMasked': '***' + digits[-4:] if digits else 'Unknown',
        'senderStatus': registration, 'codeVerificationStatus': code_verification,
        'codeVerificationMeaning': 'Phone number OTP-code state; not business verification or, by itself, registration state.',
        'phoneOwnershipOtpStatus': code_verification,
        'senderConnectionAndOtpEvidence': 'CONNECTED plus NOT_VERIFIED is an inconsistent read; it does not establish disconnection or justify re-registration.',
        'businessVerificationStatus': business_verification,
        'messagingLimitTier': messaging_tier,
        'messagingLimitDescription': '250 unique recipients per rolling 24 hours' if messaging_tier == 'TIER_250' else 'Meta messaging capacity tier; not a sender-disconnection signal.',
        'apiAccessible': any(value is not None for value in values.values()),
        'displayNameStatus': _enum(values['name_status'], {'APPROVED', 'AVAILABLE_WITHOUT_REVIEW', 'PENDING_REVIEW', 'DECLINED', 'EXPIRED'}),
        'qualityRating': _enum(values['quality_rating'], {'GREEN', 'YELLOW', 'RED', 'HIGH', 'MEDIUM', 'LOW'}),
        'qualityDisplay': {'GREEN': 'HIGH', 'YELLOW': 'MEDIUM', 'RED': 'LOW'}.get(values['quality_rating'], _enum(values['quality_rating'], {'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'}))})


def _webhook(db, config):
    from .whatsapp import callback_configuration
    CALLBACK = callback_configuration(config)['callbackUrl']
    subscribed = _edge(config, str(config['WHATSAPP_BUSINESS_ACCOUNT_ID']) + '/subscribed_apps')
    membership = any(str((row.get('whatsapp_business_api_data') or {}).get('id')) == str(config['WHATSAPP_APP_ID']) for row in subscribed)
    evidence = {'wabaMembership': membership, 'appIdMasked': '***' + str(config['WHATSAPP_APP_ID'])[-4:], 'expectedCallback': CALLBACK,
                'signatureSecretConfigured': bool(config.get('WHATSAPP_APP_SECRET')), 'httpsExpected': CALLBACK.startswith('https://')}
    try:
        rows = _edge(config, str(config['WHATSAPP_APP_ID']) + '/subscriptions', app=True)
        active = [row for row in rows if row.get('object') == 'whatsapp_business_account' and row.get('active') is True]
        exact = [row for row in active if row.get('callback_url') == CALLBACK]
        evidence.update(callbackMatches=bool(exact), messagesField=any('messages' in [f.get('name') if isinstance(f, dict) else f for f in row.get('fields', [])] for row in exact))
        status = 'VERIFIED' if membership and evidence['callbackMatches'] and evidence['messagesField'] else 'BLOCKED'
        reason = 'Active app subscription, exact HTTPS callback and messages field match the configured WABA.' if status == 'VERIFIED' else 'Missing WABA membership, exact active production callback or messages field.'
    except (requests.RequestException, ValueError, TypeError, KeyError):
        status, reason = ('UNKNOWN' if membership else 'BLOCKED'), 'App-level subscription could not be read; WABA membership is not equivalent.'
    state = db.integrations.find_one({'_id': 'whatsapp'}) or {}
    receipt = db.whatsapp_events.find_one({'matched': True, 'status': {'$in': ['sent', 'delivered', 'read', 'failed']}}, {'receivedAt': 1}, sort=[('receivedAt', -1)])
    evidence.update(callbackChallengeObservedAt=state.get('verifiedAt'), signedStatusObservedAt=(receipt or {}).get('receivedAt'),
                    signatureHandling='Raw-body HMAC required by backend; real receipt execution is a separate observation.')
    return _result('webhook', status, reason, 'Meta Developers > exact app > WhatsApp/Webhooks: verify active production callback and messages field; WhatsApp Manager: verify app/WABA membership. Never auto-resubscribe. Check signed receipt evidence separately.', 'Fresh Meta app and WABA subscription GETs; persisted webhook observations', evidence)


def _templates(db, config):
    from .whatsapp_routes import refresh_template_observations
    from .whatsapp_templates import template_registry
    refresh_template_observations(db, config)
    rows = template_registry(db, config)
    item = rows.get('order_confirmation') or {}
    evidence = {'templates': [{key: row.get(key) for key in ('name', 'language', 'category', 'observedStatus', 'componentsVerified', 'qualityRating', 'approvalCheckedAt', 'statusStale', 'enabled')} for row in rows.values()]}
    valid = item.get('approved') and item.get('componentsVerified') and not item.get('statusStale')
    return _result('templates', 'VERIFIED' if valid else 'ACTION REQUIRED', 'Exact order-confirmation template approval/components verified.' if valid else 'Order-confirmation template has missing, stale or mismatched Meta evidence.',
        'Review exact name/language/category and component differences. Do not edit approved templates or enable mappings merely to test. Quality pending and a closed service window are separate from approval.', 'Fresh complete Meta inventory and backend mapping comparison', evidence)


def _outbox(db, config):
    from .whatsapp import now
    checked = now()
    counts = {state: db.whatsapp_outbox.count_documents({'status': state}) for state in ('pending', 'processing', 'held', 'unknown', 'failed', 'invalid_payload')}
    counts['expiredPending'] = db.whatsapp_outbox.count_documents({'status': 'pending', 'expiresAt': {'$lte': checked}})
    counts['retryJobs'] = db.whatsapp_outbox.count_documents({'retryCount': {'$gt': 0}})
    return _result('outbox', 'ACTION REQUIRED' if counts['pending'] or counts['processing'] or counts['held'] or counts['unknown'] else 'VERIFIED',
        'Fresh read-only queue counts; this is not a stable audit or backlog release approval.',
        'An authorized operator must pause the worker and audit exact existing jobs before any resume. Never replay, retag, delete or extend old jobs from this screen.', 'Current guarded MongoDB counts; payloads not read', counts)


def _worker(db, config):
    from .whatsapp import now, configuration_errors
    observation = (db.integrations.find_one({'_id': 'whatsapp'}) or {}).get('workerObservation') or {}
    at = as_utc_datetime(observation.get('observedAt'))
    fresh = bool(at and now() - timedelta(minutes=2) <= at <= now())
    same = (observation.get('codeVersion') == code_version() and observation.get('scope') == scope_key(config)
            and observation.get('database') == db.name and observation.get('environment') == config.get('WHATSAPP_ENVIRONMENT'))
    status = 'UNKNOWN' if not at else 'ACTION REQUIRED' if not fresh or not same or observation.get('state') in {'stopped', 'failed'} else 'VERIFIED'
    return _result('worker', status, 'Recent software-worker observation is available; it does not prove a send or the host timer state.' if fresh and same else 'Worker observation is missing, stale or inconsistent with this backend.',
        'Host operator: inspect systemctl show rk-whatsapp-worker.service and .timer, current image parity and protected environment continuity. Do not start/stop services from diagnostics.',
        'Persisted worker CLI observation and current backend code/config; no Docker socket access',
        {'executionObservedAt': at, 'executionState': observation.get('state', 'UNKNOWN'), 'processed': observation.get('processed'),
         'fresh': fresh, 'codeVersionMatches': same if at else None, 'backendCodeVersion': code_version(),
         'environmentDatabaseConsistency': observation.get('database') == db.name and observation.get('environment') == config.get('WHATSAPP_ENVIRONMENT') if at else None,
         'encryptionConfigurationAvailable': 'WHATSAPP_OUTBOX_KEY' not in configuration_errors(config),
         'pendingJobs': db.whatsapp_outbox.count_documents({'status': 'pending'}),
         'retryJobs': db.whatsapp_outbox.count_documents({'retryCount': {'$gt': 0}}),
         'failedJobs': db.whatsapp_outbox.count_documents({'status': 'failed'}),
         'systemdService': 'UNKNOWN (host access required)', 'systemdTimer': 'UNKNOWN (host access required)',
         'imageParity': 'UNKNOWN (host access required)'})


def refresh_checks(db, config, selected):
    from .whatsapp import now
    from .config import validate_database_maintenance_target
    validate_database_maintenance_target(config, config.get('WHATSAPP_EXPECTED_DATABASE'))
    if db.name != config.get('WHATSAPP_EXPECTED_DATABASE'):
        raise ValueError('database_target_mismatch')
    functions = dict(zip(SCOPES, (_configuration, _billing, _sender, _templates, _webhook, _worker, _outbox)))
    for key in SCOPES if selected == 'all' else (selected,):
        try:
            result = functions[key](db, config)
        except (requests.RequestException, ValueError, TypeError, KeyError, AttributeError):
            result = _result(key, 'UNKNOWN', 'Fresh diagnostic read unavailable; previous success does not count as current verification.',
                'Check provider permissions, configuration and the appropriate Meta Dashboard. Retry this check without changing sending gates.', 'Failed fresh backend/provider read')
        result['_scope'] = scope_key(config)
        db.integrations.update_one({'_id': 'whatsapp'}, {'$set': {'diagnosticChecks.' + key: result}}, upsert=True)
    return public_checks(db, config)


def public_checks(db, config):
    from .whatsapp import now
    rows = (db.integrations.find_one({"_id": "whatsapp"}) or {}).get("diagnosticChecks") or {}
    result = []
    for name in SCOPES:
        row = rows.get(name)
        if not isinstance(row, dict):
            continue
        public = {key: value for key, value in row.items() if not key.startswith("_")}
        at = as_utc_datetime(row.get("checkedAt"))
        if row.get("_scope") != scope_key(config) or not at or at > now() or now() - at > FRESHNESS:
            public.update(status="NOT VERIFIED", reason="Evidence is stale or belongs to different configured account/sender credentials. Refresh this check.")
        result.append(public)
    return result


def record_worker_observation(db, config, state, processed=None):
    from .whatsapp import now
    db.integrations.update_one({"_id": "whatsapp"}, {"$set": {"workerObservation": {
        "observedAt": now(), "state": state, "processed": processed,
        "scope": scope_key(config), "codeVersion": code_version(),
        "database": db.name, "environment": config.get("WHATSAPP_ENVIRONMENT"),
    }}}, upsert=True)


def production_provider_block(db, config):
    from .whatsapp import now
    rows = (db.integrations.find_one({'_id': 'whatsapp'}) or {}).get('diagnosticChecks') or {}
    for key in ('billing', 'sender'):
        row = rows.get(key) or {}
        at = as_utc_datetime(row.get('checkedAt'))
        if row.get('_scope') != scope_key(config) or not at or at > now() or now() - at > FRESHNESS:
            return 'production_test_provider_evidence_stale_or_missing'
    if not (rows['billing'].get('evidence') or {}).get('providerEligibilityVerified'):
        return 'production_test_provider_eligibility_unverified'
    sender = rows['sender'].get('evidence') or {}
    if sender.get('businessVerificationStatus') != 'VERIFIED':
        return 'production_test_business_verification_unverified'
    if sender.get('registration') != 'CONNECTED':
        return 'production_test_sender_not_connected'
    return None


def provider_evidence_expiry(db, config):
    rows = (db.integrations.find_one({"_id": "whatsapp"}) or {}).get("diagnosticChecks") or {}
    times = [as_utc_datetime((rows.get(key) or {}).get("checkedAt")) for key in ("billing", "sender")]
    return min(times) + FRESHNESS if all(times) else None
