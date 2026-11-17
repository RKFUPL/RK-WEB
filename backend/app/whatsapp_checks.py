"""Admin evidence refresh. Provider operations are GET-only; no dispatch/control writes."""
from datetime import timedelta
import hashlib
import hmac
import re
from pathlib import Path

import requests

from .time_utils import as_utc_datetime
from .whatsapp_health import CAPACITIES, DISPLAY_NAME_ACTION, health_error_codes, health_mode, normalize_health

SCOPES = ('configuration', 'billing', 'sender', 'templates', 'webhook', 'worker', 'outbox')
STATUSES = {'VERIFIED', 'BLOCKED', 'ACTION REQUIRED', 'NOT VERIFIED', 'UNKNOWN', 'DISABLED BY CONFIGURATION'}
FRESHNESS = timedelta(minutes=15)


def scope_key(config):
    value = ':'.join(str(config.get(k) or '') for k in ('WHATSAPP_APP_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID', 'WHATSAPP_BUSINESS_PORTFOLIO_ID', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_API_VERSION'))
    return hmac.new(str(config.get('WHATSAPP_APP_SECRET') or '').encode(), value.encode(), hashlib.sha256).hexdigest()


def code_version():
    root = Path(__file__).parent
    return hashlib.sha256(b''.join((root / name).read_bytes() for name in (
        'whatsapp.py', 'whatsapp_orders.py', 'whatsapp_consent.py', 'whatsapp_templates.py', 'whatsapp_checks.py', 'whatsapp_health.py',
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
    from .whatsapp import now
    body = _get(config, config['WHATSAPP_PHONE_NUMBER_ID'], 'health_status')
    checked = now()
    health = body.get('health_status')
    evidence = normalize_health(health if isinstance(health, dict) else {}, config, checked)
    failure = unresolved_payment_failure(db, config)
    evidence['unresolvedPaymentEligibilityFailure'] = failure
    overall = evidence['messagingHealth']
    mode = evidence['messagingEligibilityMode']
    limited = evidence['displayNameLimitedCandidate']
    status = ('BLOCKED' if failure or (overall == 'BLOCKED' and mode != 'AVAILABLE_SIP_ONLY') else
              'ACTION REQUIRED' if overall == 'LIMITED' else 'NOT VERIFIED')
    reason = ('Phone display name is not approved; current messaging capacity is limited. Only an otherwise eligible approved Utility manual test may use this specific limitation.' if limited else
              ('Meta aggregate messaging health is BLOCKED, but all four messaging entities are AVAILABLE and every reported error is SIP-only. This is not a messaging restriction; SIP calling remains blocked.'
               if mode == 'AVAILABLE_SIP_ONLY' else
               'Meta messaging health is ' + overall + '. Unknown limitations and messaging blocks cannot authorize a manual test.'))
    if evidence['providerEligibilityVerified']:
        reason = 'Messaging health is AVAILABLE. Billing-ledger verification is independent and remains unverified.'
    if failure:
        reason += ' An unresolved 131042 dispatch failure requires provider/billing reconciliation; it is not proof of an outstanding balance.'
    action = (DISPLAY_NAME_ACTION if limited else
              'No messaging action is indicated by SIP-only errors; review SIP calling separately if calling is needed.'
              if mode == 'AVAILABLE_SIP_ONLY' else
              'Review the exact entity messaging limitation in WhatsApp Manager. Do not re-register the sender.')
    action += ' Separately review Meta Billing & Payments > Messaging Accounts for ledger/account questions. SIP calling restrictions are separate from messaging.'
    result = _result('billing', status, reason, action, 'Fresh Meta phone health_status GET; ledger not queried', evidence)
    result['checkedAt'] = checked
    return result


def unresolved_payment_failure(db, config):
    """A connection GET or age never silently resolves a dispatch rejection.

    New records are account-scoped. Legacy unscoped failures remain conservative
    unresolved evidence; a delivery/read status on that record resolves dispatch
    uncertainty only, never verifies the billing ledger.
    """
    failure = db.whatsapp_messages.find_one({'$and': [
        {'$or': [{'error.code': 131042}, {'failureDetails.errors.code': 131042}]},
        {'status': {'$nin': ['delivered', 'read']}},
        {'$or': [{'_providerScope': scope_key(config)}, {'_providerScope': {'$exists': False}}]},
    ]}, {'updatedAt': 1, 'failedAt': 1, 'createdAt': 1}, sort=[('updatedAt', -1)])
    state = db.integrations.find_one({'_id': 'whatsapp'}, {'lastError.code': 1}) or {}
    if failure or (state.get('lastError') or {}).get('code') == 131042:
        return {'code': 131042, 'observedAt': (failure or {}).get('failedAt') or (failure or {}).get('updatedAt') or (failure or {}).get('createdAt'),
                'meaning': 'Unresolved dispatch eligibility/payment failure, not a verified current debt.'}
    return None


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
        'senderEvidenceVersion': 2,
        'codeVerificationMeaning': 'Phone number OTP-code state; not business verification or, by itself, registration state.',
        'phoneOwnershipOtpStatus': code_verification,
        'senderConnectionAndOtpEvidence': 'CONNECTED plus NOT_VERIFIED is an inconsistent read; it does not establish disconnection or justify re-registration.',
        'businessVerificationStatus': business_verification,
        'messagingLimitTier': messaging_tier,
        'messagingCapacity': {'uniqueRecipientsPer24Hours': CAPACITIES.get(messaging_tier), 'tierKnown': messaging_tier in CAPACITIES,
                              'providerEnforced': True, 'scope': 'Business capacity shared across phone numbers; local records cannot measure external usage.'},
        'messagingLimitDescription': (str(CAPACITIES[messaging_tier]) + ' unique recipients per rolling 24 hours') if messaging_tier in CAPACITIES and CAPACITIES[messaging_tier] is not None else 'Unlimited Meta tier' if messaging_tier == 'TIER_UNLIMITED' else 'Unknown messaging capacity; refresh sender evidence.',
        'apiAccessible': any(value is not None for value in values.values()),
        'nameStatus': values['name_status'] if isinstance(values['name_status'], str) and re.fullmatch(r'[A-Z_]{1,64}', values['name_status']) else 'UNKNOWN',
        'nameStatusUnsupported': values['name_status'] not in (
            None, '', 'APPROVED', 'AVAILABLE_WITHOUT_REVIEW', 'PENDING_REVIEW', 'DECLINED', 'EXPIRED', 'NONE', 'NON_EXISTS'),
        'displayNameStatus': values['name_status'] if isinstance(values['name_status'], str) and re.fullmatch(r'[A-Z_]{1,64}', values['name_status']) else 'UNKNOWN',
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


def production_provider_block(db, config, *, manual_utility_test=False, template=None, recipient=None):
    from .whatsapp import now
    state = db.integrations.find_one({'_id': 'whatsapp'}) or {}
    rows = state.get('diagnosticChecks') or {}
    for key in ('billing', 'sender'):
        row = rows.get(key) or {}
        at = as_utc_datetime(row.get('checkedAt'))
        if row.get('_scope') != scope_key(config) or not at or at > now() or now() - at > FRESHNESS:
            return 'production_test_provider_evidence_stale_or_missing'
    health = rows['billing'].get('evidence') or {}
    if 131042 in health_error_codes(health) or unresolved_payment_failure(db, config):
        return 'production_test_billing_restriction_unresolved'
    if (state.get('lastError') or {}).get('code') in {131031, 368}:
        return 'production_test_messaging_restriction_unresolved'
    mode = health_mode(health)
    if not mode or (mode == 'AVAILABLE' and health.get('providerEligibilityVerified') is not True):
        return 'production_test_provider_eligibility_unverified'
    if any(as_utc_datetime(entity.get('checkedAt')) != as_utc_datetime(rows['billing'].get('checkedAt')) for entity in health['entities']):
        return 'production_test_provider_evidence_stale_or_missing'
    sender = rows['sender'].get('evidence') or {}
    if sender.get('businessVerificationStatus') != 'VERIFIED':
        return 'production_test_business_verification_unverified'
    canonical, legacy = sender.get('senderStatus'), sender.get('registration')
    if canonical is not None and legacy is not None and canonical != legacy:
        return 'production_test_sender_evidence_conflict'
    if (canonical if canonical is not None else legacy) != 'CONNECTED':
        return 'production_test_sender_not_connected'
    if mode == 'DISPLAY_NAME_LIMITED':
        if not manual_utility_test or config.get('WHATSAPP_ENVIRONMENT') != 'production':
            return 'production_test_display_name_limited_utility_only'
        name_status = sender.get('nameStatus')
        if name_status == 'APPROVED':
            return 'production_test_display_name_evidence_conflict'
        # UNKNOWN is the diagnostic sentinel for an unavailable field, not proof
        # of approval. Exact health evidence and every other check still apply.
        if sender.get('nameStatusUnsupported') is True or name_status not in (
                None, '', 'UNKNOWN', 'PENDING_REVIEW', 'AVAILABLE_WITHOUT_REVIEW'):
            return 'production_test_display_name_status_ineligible'
        checked = as_utc_datetime((template or {}).get('approvalCheckedAt'))
        if (not template or template.get('category') != 'UTILITY' or not template.get('name') or not template.get('language')
                or not template.get('approved') or template.get('requiresMetaApproval') is not True
                or template.get('approvalSource') != 'meta_api_read' or template.get('componentsVerified') is not True
                or template.get('statusStale') or not checked or not now() - timedelta(hours=24) <= checked <= now()):
            return 'production_test_display_name_limited_utility_only'
        from .whatsapp_templates import component_signature, observation_is_stale
        observed = db.whatsapp_template_status.find_one({'_id': template['name'] + ':' + template['language']}) or {}
        if (observed.get('name') != template['name'] or observed.get('language') != template['language']
                or observed.get('status') != 'APPROVED' or observed.get('category') != 'UTILITY'
                or observed.get('source') != 'meta_api_read' or observed.get('presentInMeta') is not True
                or observed.get('componentsVerified') is not True
                or observed.get('componentSignature') != component_signature(template.get('components'))
                or observation_is_stale(observed, state.get('templateStatusSync') or {}, config.get('WHATSAPP_BUSINESS_ACCOUNT_ID'))):
            return 'production_test_display_name_limited_utility_only'
        tier = sender.get('messagingLimitTier')
        if tier not in CAPACITIES:
            return 'production_test_capacity_unverified'
        if recipient is not None and CAPACITIES[tier] is not None:
            from .whatsapp import fingerprint, normalize_phone
            try:
                if normalize_phone(recipient) != recipient:
                    return 'invalid_recipient'
            except ValueError:
                return 'invalid_recipient'
            # Existing message claims serve as conservative local reservations,
            # including ambiguous attempts. This cannot measure traffic outside
            # RK-WEB; Meta remains authoritative for its business-wide quota.
            used = set(db.whatsapp_messages.distinct('recipientHash', {
                'createdAt': {'$gte': now() - timedelta(hours=24)},
                'status': {'$in': ['sending', 'accepted', 'sent', 'delivered', 'read', 'unknown', 'failed']},
                '$or': [{'_providerScope': scope_key(config)}, {'_providerScope': {'$exists': False}}],
            })) - {None, ''}
            if len(used) > CAPACITIES[tier] or (len(used) >= CAPACITIES[tier] and fingerprint(recipient, config) not in used):
                return 'production_test_capacity_reached'
    return None


def provider_evidence_expiry(db, config):
    rows = (db.integrations.find_one({"_id": "whatsapp"}) or {}).get("diagnosticChecks") or {}
    times = [as_utc_datetime((rows.get(key) or {}).get("checkedAt")) for key in ("billing", "sender")]
    return min(times) + FRESHNESS if all(times) else None
