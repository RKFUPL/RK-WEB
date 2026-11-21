"""Manual Utility-only display-name exception; isolated Mongo and mocked Meta."""
from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch

import pytest

from app import whatsapp_checks as checks
from app.whatsapp import fingerprint, now, process_outbox, send, send_text
from app.whatsapp_health import DISPLAY_NAME_LIMITATION
from app.whatsapp_health import health_mode, normalize_health
from app.whatsapp_templates import template_registry
from test_whatsapp_production_test import case, submit


def meta_health(case, limited=True):
    return {'health_status': {'can_send_message': 'LIMITED' if limited else 'AVAILABLE', 'entities': [
        {'entity_type': kind, 'id': case.app.config[key] if key else '99999',
         'can_send_message': 'LIMITED' if kind == 'PHONE_NUMBER' and limited else 'AVAILABLE',
         'additional_info': [DISPLAY_NAME_LIMITATION] if kind == 'PHONE_NUMBER' and limited else [],
         **({'can_receive_call_sip': 'BLOCKED', 'errors': [{'error_code': code, 'error_description': 'SIP calling not configured'}]}
            if code else {})}
        for kind, key, code in [('PHONE_NUMBER', 'WHATSAPP_PHONE_NUMBER_ID', 138024), ('WABA', 'WHATSAPP_BUSINESS_ACCOUNT_ID', None),
                                ('BUSINESS', 'WHATSAPP_BUSINESS_PORTFOLIO_ID', None), ('APP', 'WHATSAPP_APP_ID', 138025)]]}}


def save_health(case, raw=None):
    with patch.object(checks, '_get', return_value=raw if raw is not None else meta_health(case)):
        result = checks._billing(case.db, case.app.config)
    result['_scope'] = checks.scope_key(case.app.config)
    case.db.integrations.update_one({'_id': 'whatsapp'}, {'$set': {'diagnosticChecks.billing': result}})
    return result


def manual_block(case, template=None, recipient=None):
    return checks.production_provider_block(case.db, case.app.config, manual_utility_test=True,
        template=template if template is not None else template_registry(case.db, case.app.config)['order_confirmation'], recipient=recipient)


def save_sender_name_status(case, name_status):
    def meta_get(config, path, fields):
        if path == config['WHATSAPP_BUSINESS_ACCOUNT_ID']:
            return {'business_verification_status': 'verified', 'whatsapp_business_manager_messaging_limit': 'TIER_250'}
        values = {'status': 'CONNECTED', 'code_verification_status': 'NOT_VERIFIED',
                  'quality_rating': 'GREEN'}
        if name_status is not None:
            values['name_status'] = name_status
        return {fields: values[fields]} if fields in values else {}

    with patch.object(checks, '_get', side_effect=meta_get):
        result = checks._sender(case.db, case.app.config)
    result['_scope'] = checks.scope_key(case.app.config)
    case.db.integrations.update_one({'_id': 'whatsapp'}, {'$set': {'diagnosticChecks.sender': result}})
    return result


@pytest.mark.parametrize('fields,expected', [
    ({'senderStatus': 'CONNECTED'}, None), ({'registration': 'CONNECTED'}, None),
    ({'senderStatus': 'CONNECTED', 'registration': 'CONNECTED'}, None),
    ({}, 'production_test_sender_not_connected'),
    ({'senderStatus': 'CONNECTED', 'registration': 'DISCONNECTED'}, 'production_test_sender_evidence_conflict'),
    ({'senderStatus': 'DISCONNECTED', 'registration': 'CONNECTED'}, 'production_test_sender_evidence_conflict'),
    *[({'senderStatus': status}, 'production_test_sender_not_connected') for status in
      ('DISCONNECTED', 'UNREGISTERED', 'BANNED', 'RESTRICTED', 'FLAGGED', 'PENDING', 'UNKNOWN')],
])
def test_sender_schema_migration_is_read_compatible_and_conflicts_are_closed(case, fields, expected):
    existing = case.db.integrations.find_one({'_id': 'whatsapp'})['diagnosticChecks']['sender']['evidence']
    existing.pop('senderStatus', None)
    existing.pop('registration', None)
    existing.update(fields)
    case.db.integrations.update_one({'_id': 'whatsapp'}, {'$set': {'diagnosticChecks.sender.evidence': existing}})
    assert checks.production_provider_block(case.db, case.app.config) == expected
    case.http.assert_not_called()


def test_real_sender_producer_and_consumer_use_the_same_connected_field(case):
    values = {'status': 'CONNECTED', 'code_verification_status': 'NOT_VERIFIED', 'name_status': 'PENDING_REVIEW', 'quality_rating': 'GREEN'}
    def get(config, path, fields):
        if path == config['WHATSAPP_BUSINESS_ACCOUNT_ID']:
            return {'business_verification_status': 'verified', 'whatsapp_business_manager_messaging_limit': 'TIER_250'}
        return {fields: values.get(fields)}
    with patch.object(checks, '_get', side_effect=get):
        result = checks._sender(case.db, case.app.config)
    assert result['evidence']['senderStatus'] == 'CONNECTED'
    assert 'registration' not in result['evidence']
    assert result['evidence']['nameStatus'] == 'PENDING_REVIEW'
    assert result['evidence']['codeVerificationStatus'] == 'NOT_VERIFIED'
    result['_scope'] = checks.scope_key(case.app.config)
    case.db.integrations.update_one({'_id': 'whatsapp'}, {'$set': {'diagnosticChecks.sender': result}})
    assert checks.production_provider_block(case.db, case.app.config) is None
    assert submit(case).status_code == 200


def test_documented_display_name_limit_preserves_details_and_sip_separation(case):
    evidence = save_health(case)['evidence']
    assert evidence['displayNameLimitedCandidate'] is True
    assert evidence['providerEligibilityVerified'] is False  # Never general authority.
    assert evidence['billingLedgerVerified'] is False
    assert {row['type'] for row in evidence['entities']} == {'PHONE_NUMBER', 'WABA', 'BUSINESS', 'APP'}
    phone = evidence['entities'][0]
    assert phone['additional_info'] == [DISPLAY_NAME_LIMITATION]
    assert phone['can_send_message'] == 'LIMITED'
    assert phone['can_receive_call_sip'] == 'BLOCKED'
    assert phone['errors'][0]['channel'] == 'calling_sip'
    assert all(row['checkedAt'] and row['scope']['matchesConfiguredEntity'] for row in evidence['entities'])
    assert checks.production_provider_block(case.db, case.app.config) == 'production_test_display_name_limited_utility_only'
    assert manual_block(case) is None
    response = submit(case)
    assert response.status_code == 200
    assert response.json['status'] == 'accepted'
    assert case.http.call_count == 1
    assert case.db.whatsapp_order_events.count_documents({}) == case.db.whatsapp_outbox.count_documents({}) == 0
    record = case.db.whatsapp_messages.find_one({})
    assert record['testSend'] is True and record['productionTestSend'] is True
    logs = case.client.get('/api/admin/integrations/whatsapp/messages', headers=case.headers)
    assert '_providerScope' not in str(logs.json)


def test_admin_status_exposes_per_template_exception_without_opening_any_gate(case):
    save_health(case)
    response = case.client.get('/api/admin/integrations/whatsapp', headers=case.headers)
    assert response.status_code == 200
    assert response.json['productionTest']['providerEligible'] is True
    item = response.json['templates']['order_confirmation']
    assert item['eligibleForTesting'] is True
    assert item['mappingEnabled'] is False and item['eligibleForAutomation'] is False
    case.app.config['WHATSAPP_PRODUCTION_TEST_SEND_ENABLED'] = False
    closed = case.client.get('/api/admin/integrations/whatsapp', headers=case.headers).json
    assert closed['productionTest']['enabled'] is False
    assert closed['templates']['order_confirmation']['eligibleForTesting'] is False
    assert closed['marketingEnabled'] is False and closed['orderNotificationsEnabled'] is False
    case.http.assert_not_called()


@pytest.mark.parametrize('info', [[], ['Generic limitation'], [DISPLAY_NAME_LIMITATION, 'Another restriction'], None,
                                 {'reason': DISPLAY_NAME_LIMITATION}, ['x' * 501]])
def test_missing_unknown_or_different_limited_reason_is_closed(case, info):
    raw = meta_health(case)
    raw['health_status']['entities'][0]['additional_info'] = info
    save_health(case, raw)
    assert submit(case).status_code == 403
    case.http.assert_not_called()


@pytest.mark.parametrize('entity', ['PHONE_NUMBER', 'WABA', 'BUSINESS', 'APP'])
@pytest.mark.parametrize('state', ['BLOCKED', 'UNKNOWN', 'LIMITED'])
def test_other_entity_limitation_or_any_blocked_entity_cannot_use_exception(case, entity, state):
    if entity == 'PHONE_NUMBER' and state == 'LIMITED':
        return  # Covered by the exact documented positive case.
    raw = meta_health(case)
    next(row for row in raw['health_status']['entities'] if row['entity_type'] == entity)['can_send_message'] = state
    save_health(case, raw)
    assert manual_block(case) == 'production_test_provider_eligibility_unverified'
    assert submit(case).status_code == 403
    case.http.assert_not_called()


def test_overall_blocked_or_missing_entity_or_wrong_scope_is_closed(case):
    for mutation in ('overall', 'missing', 'duplicate', 'wrong_scope'):
        raw = meta_health(case)
        if mutation == 'overall':
            raw['health_status']['can_send_message'] = 'BLOCKED'
        elif mutation == 'missing':
            raw['health_status']['entities'].pop()
        elif mutation == 'duplicate':
            raw['health_status']['entities'][-1] = deepcopy(raw['health_status']['entities'][0])
        else:
            raw['health_status']['entities'][0]['id'] = 'wrong-phone'
        save_health(case, raw)
        assert submit(case, requestId='bad-health-' + mutation.replace('_', '-') + '-123456').status_code == 403
    case.http.assert_not_called()


@pytest.mark.parametrize('kind', ['health', 'stored_failure', 'last_error'])
def test_explicit_billing_or_unresolved_dispatch_failure_blocks_exception(case, kind):
    raw = meta_health(case)
    if kind == 'health':
        raw['health_status']['entities'][1]['errors'] = [{'error_code': 131042}]
    elif kind == 'last_error':
        case.db.integrations.update_one({'_id': 'whatsapp'}, {'$set': {'lastError': {'code': 131042}}})
    else:
        case.db.whatsapp_messages.insert_one({'error': {'code': 131042}, 'status': 'failed', 'updatedAt': now(),
                                            '_providerScope': checks.scope_key(case.app.config)})
    save_health(case, raw)
    assert manual_block(case) == 'production_test_billing_restriction_unresolved'
    assert submit(case).status_code == 403
    case.http.assert_not_called()


def test_failed_dispatch_never_expires_into_automatic_billing_clearance(case):
    case.db.whatsapp_messages.insert_one({'error': {'code': 131042}, 'status': 'failed', 'updatedAt': now() - timedelta(days=90)})
    result = save_health(case)
    assert result['evidence']['unresolvedPaymentEligibilityFailure']['code'] == 131042
    assert result['evidence']['billingLedgerVerified'] is False
    assert manual_block(case) == 'production_test_billing_restriction_unresolved'


@pytest.mark.parametrize('code', [131031, 368])
def test_explicit_recorded_account_restriction_cannot_use_display_name_exception(case, code):
    save_health(case)
    case.db.integrations.update_one({'_id': 'whatsapp'}, {'$set': {'lastError': {'code': code}}})
    assert submit(case).json['reason'] == 'production_test_messaging_restriction_unresolved'
    case.http.assert_not_called()


@pytest.mark.parametrize('field', ['billing', 'sender'])
@pytest.mark.parametrize('mutation', ['stale', 'scope', 'future'])
def test_exception_requires_fresh_account_scoped_proofs(case, field, mutation):
    save_health(case)
    value = now() - timedelta(minutes=16) if mutation == 'stale' else now() + timedelta(minutes=1)
    path = 'checkedAt' if mutation != 'scope' else '_scope'
    case.db.integrations.update_one({'_id': 'whatsapp'}, {'$set': {f'diagnosticChecks.{field}.{path}': value if mutation != 'scope' else 'different'}})
    assert manual_block(case) == 'production_test_provider_evidence_stale_or_missing'
    assert submit(case).status_code == 403
    case.http.assert_not_called()


@pytest.mark.parametrize('changes', [{'category': 'MARKETING'}, {'category': 'AUTHENTICATION'}, {'approved': False},
    {'componentsVerified': False}, {'statusStale': True}, {'language': ''}, {'language': 'en_GB'}, {'name': 'different_template'},
    {'approvalCheckedAt': now()-timedelta(days=2)}, {'approvalCheckedAt': now()+timedelta(hours=1)}, {'approvalSource': 'operator_checkbox'}])
def test_exception_requires_exact_fresh_verified_utility_template(case, changes):
    save_health(case)
    template = {**template_registry(case.db, case.app.config)['order_confirmation'], **changes}
    assert manual_block(case, template) == 'production_test_display_name_limited_utility_only'
    case.http.assert_not_called()


@pytest.mark.parametrize('changes', [{'confirmed': False}, {'recipientConsentVerified': False}, {'recipient': '+123'}, {'recipient': ['+14155552671']}])
def test_limited_case_cannot_bypass_consent_or_recipient_validation(case, changes):
    save_health(case)
    assert submit(case, **changes).status_code == 400
    case.http.assert_not_called()


def test_opt_out_admin_auth_and_closed_production_gate_still_block(case):
    save_health(case)
    assert case.client.post('/api/admin/integrations/whatsapp/test-send', json={}).status_code == 401
    from app.whatsapp_consent import withdraw_from_inbound
    withdraw_from_inbound(case.db, case.app.config, case.user['phone'], now())
    assert submit(case).status_code == 409
    case.app.config['WHATSAPP_PRODUCTION_TEST_SEND_ENABLED'] = False
    assert submit(case).status_code == 403
    case.http.assert_not_called()


def test_exception_cannot_authorize_orders_marketing_authentication_or_free_text(case):
    save_health(case)
    assert process_outbox(case.db, case.app.config) == 0
    assert send(case.db, case.app.config, case.user['phone'], 'order_confirmation', {}, 'order-local', consent=True)['reason'] == 'disabled'
    for event in ('new_collection_drop', 'login_otp'):
        result = send(case.db, case.app.config, case.user['phone'], event, {}, 'wrong-kind-'+event,
                      test_send=True, production_test=True, consent=True, test_parameters={})
        assert result['reason'] == 'invalid_test_type'
    assert send_text(case.db, case.app.config, case.user['phone'], 'text', 'text-local', consent=True, test_send=True)['status'] == 'skipped'
    case.http.assert_not_called()


def test_current_tier_capacity_is_checked_before_claim_and_before_dispatch(case):
    save_health(case)
    case.db.whatsapp_messages.insert_many([{'recipientHash': 'reserved-' + str(index), 'createdAt': now(), 'status': 'accepted'} for index in range(250)])
    assert submit(case).json['reason'] == 'production_test_capacity_reached'
    case.http.assert_not_called()
    case.db.whatsapp_messages.update_one({'recipientHash': 'reserved-0'}, {'$set': {'recipientHash': fingerprint(case.user['phone'], case.app.config)}})
    assert submit(case).status_code == 200  # Same recipient does not consume a new unique slot.


def test_capacity_reservation_changed_after_claim_blocks_provider_dispatch(case):
    save_health(case)
    case.db.whatsapp_messages.insert_many([{'recipientHash': 'reserved-' + str(index), 'createdAt': now(), 'status': 'accepted'} for index in range(249)])
    original = case.db.whatsapp_messages.update_one
    def new_reservation(*args, **kwargs):
        result = original(*args, **kwargs)
        case.db.whatsapp_messages.insert_one({'recipientHash': 'other-new-recipient', 'createdAt': now(), 'status': 'sending'})
        return result
    with patch.object(case.db.whatsapp_messages, 'update_one', side_effect=new_reservation):
        assert submit(case).json['reason'] == 'production_test_capacity_reached'
    case.http.assert_not_called()


def test_fresh_health_read_cannot_clear_an_actual_131042_failure(case):
    save_health(case)
    case.http.return_value = case.response(400, {'error': {'code': 131042}})
    assert submit(case).status_code == 502
    assert case.db.whatsapp_messages.find_one({})['_providerScope'] == checks.scope_key(case.app.config)
    # Even clearing the connection-level lastError does not resolve the message.
    case.db.integrations.update_one({'_id': 'whatsapp'}, {'$set': {'lastError': None}})
    save_health(case)
    assert manual_block(case) == 'production_test_billing_restriction_unresolved'
    assert submit(case, requestId='still-unresolved-failure-12345').status_code == 403
    assert case.http.call_count == 1


def test_unverified_business_or_mixed_age_entity_evidence_remain_closed(case):
    save_health(case)
    case.db.integrations.update_one({'_id': 'whatsapp'}, {'$set': {'diagnosticChecks.sender.evidence.businessVerificationStatus': 'NOT_VERIFIED'}})
    assert manual_block(case) == 'production_test_business_verification_unverified'
    case.db.integrations.update_one({'_id': 'whatsapp'}, {'$set': {
        'diagnosticChecks.sender.evidence.businessVerificationStatus': 'VERIFIED',
        'diagnosticChecks.billing.evidence.entities.0.checkedAt': now() - timedelta(hours=1),
    }})
    assert manual_block(case) == 'production_test_provider_evidence_stale_or_missing'
    case.http.assert_not_called()


def test_unknown_tier_and_restrictions_changed_during_retry_remain_closed(case):
    save_health(case)
    case.db.integrations.update_one({'_id': 'whatsapp'}, {'$set': {'diagnosticChecks.sender.evidence.messagingLimitTier': 'UNKNOWN'}})
    assert submit(case).json['reason'] == 'production_test_capacity_unverified'
    case.http.assert_not_called()
    case.db.integrations.update_one({'_id': 'whatsapp'}, {'$set': {'diagnosticChecks.sender.evidence.messagingLimitTier': 'TIER_250'}})
    case.http.return_value = case.response(429, {'error': {'code': 130429}}, {'Retry-After': '1'})
    def changed(*_):
        raw = meta_health(case)
        raw['health_status']['entities'][0]['additional_info'] = ['New unknown restriction']
        save_health(case, raw)
    with patch('app.whatsapp.retry_sleep', side_effect=changed):
        assert submit(case, requestId='limited-retry-change-12345').status_code == 403
    assert case.http.call_count == 1


def test_health_details_redact_secrets_and_never_change_phone_name_status(case):
    raw = meta_health(case)
    raw['health_status']['entities'][0]['errors'][0]['error_description'] = 'SIP ' + case.app.config['WHATSAPP_ACCESS_TOKEN']
    result = save_health(case, raw)
    assert case.app.config['WHATSAPP_ACCESS_TOKEN'] not in str(result)
    assert '[redacted]' in str(result)
    assert result['evidence']['entities'][0]['additional_info'] == [DISPLAY_NAME_LIMITATION]
    assert 'nameStatus' not in result['evidence']  # Health text cannot invent the separate name_status.


def test_business_health_entity_must_match_configured_portfolio_id(case):
    raw = meta_health(case)
    raw['health_status']['entities'][2]['id'] = 'different-portfolio'
    result = save_health(case, raw)
    business = next(row for row in result['evidence']['entities'] if row['type'] == 'BUSINESS')
    assert business['scope']['matchesConfiguredEntity'] is False
    assert health_mode(result['evidence']) is None
    assert manual_block(case) == 'production_test_provider_eligibility_unverified'

    raw['health_status']['entities'][2]['id'] = case.app.config['WHATSAPP_BUSINESS_PORTFOLIO_ID']
    case.app.config['WHATSAPP_BUSINESS_PORTFOLIO_ID'] = ''
    result = save_health(case, raw)
    assert health_mode(result['evidence']) is None


def test_scope_key_is_bound_to_configured_portfolio_id(case):
    scope = checks.scope_key(case.app.config)
    changed = dict(case.app.config)
    changed['WHATSAPP_BUSINESS_PORTFOLIO_ID'] = 'another-portfolio'
    assert checks.scope_key(changed) != scope


def test_meta_documented_sip_only_block_preserves_aggregate_but_allows_messaging(case):
    raw = {'can_send_message': 'BLOCKED', 'entities': [
        {'entity_type': 'PHONE_NUMBER', 'id': case.app.config['WHATSAPP_PHONE_NUMBER_ID'],
         'can_send_message': 'AVAILABLE', 'can_receive_call_sip': 'BLOCKED',
         'errors': [{'error_code': 138024, 'error_description': 'WhatsApp Business calling cannot use SIP because it is not enabled',
                     'possible_solution': 'Configure SIP using {PHONE_NUMBER_ID}/settings API'}]},
        {'entity_type': 'WABA', 'id': case.app.config['WHATSAPP_BUSINESS_ACCOUNT_ID'], 'can_send_message': 'AVAILABLE'},
        {'entity_type': 'BUSINESS', 'id': case.app.config['WHATSAPP_BUSINESS_PORTFOLIO_ID'], 'can_send_message': 'AVAILABLE'},
        {'entity_type': 'APP', 'id': case.app.config['WHATSAPP_APP_ID'], 'can_send_message': 'AVAILABLE',
         'can_receive_call_sip': 'BLOCKED',
         'errors': [{'error_code': 138025, 'error_description': 'This app cannot use SIP for WhatsApp Business calling because it has not configured a SIP server for this business phone number',
                     'possible_solution': 'Configure SIP server using {PHONE_NUMBER_ID}/settings API'}]},
    ]}
    evidence = normalize_health(raw, case.app.config, now())
    assert evidence['messagingHealth'] == 'BLOCKED'  # Exact Meta aggregate remains visible.
    assert evidence['messagingEligibilityMode'] == 'AVAILABLE_SIP_ONLY'
    assert evidence['providerEligibilityVerified'] is False  # Not general sending authority.
    result = save_health(case, {'health_status': raw})
    assert result['status'] == 'NOT VERIFIED'  # Ledger remains unverified; SIP does not become a messaging block.
    assert 'not a messaging restriction' in result['reason']
    assert result['evidence']['messagingHealth'] == 'BLOCKED'
    assert manual_block(case) is None


def test_sip_errors_do_not_hide_actual_messaging_block_or_unknown_error(case):
    raw = {'can_send_message': 'BLOCKED', 'entities': [
        {'entity_type': 'PHONE_NUMBER', 'id': case.app.config['WHATSAPP_PHONE_NUMBER_ID'],
         'can_send_message': 'AVAILABLE', 'can_receive_call_sip': 'BLOCKED',
         'errors': [{'error_code': 138024}]},
        {'entity_type': 'WABA', 'id': case.app.config['WHATSAPP_BUSINESS_ACCOUNT_ID'], 'can_send_message': 'BLOCKED'},
        {'entity_type': 'BUSINESS', 'id': case.app.config['WHATSAPP_BUSINESS_PORTFOLIO_ID'], 'can_send_message': 'AVAILABLE'},
        {'entity_type': 'APP', 'id': case.app.config['WHATSAPP_APP_ID'], 'can_send_message': 'AVAILABLE'},
    ]}
    evidence = normalize_health(raw, case.app.config, now())
    assert health_mode(evidence) is None
    raw['entities'][0]['errors'][0]['error_code'] = 138024
    raw['entities'][1]['can_send_message'] = 'AVAILABLE'
    raw['errors'] = [{'error_code': 138024, 'error_description': 'unscoped SIP failure'}]
    evidence = normalize_health(raw, case.app.config, now())
    assert health_mode(evidence) is None
    raw.pop('errors')
    raw['entities'][0]['errors'][0]['error_code'] = 131031
    evidence = normalize_health(raw, case.app.config, now())
    assert health_mode(evidence) is None


def test_approved_name_status_conflicting_with_health_limitation_is_ineligible(case):
    save_health(case)
    case.db.integrations.update_one({'_id': 'whatsapp'}, {'$set': {'diagnosticChecks.sender.evidence.nameStatus': 'APPROVED'}})
    assert manual_block(case) == 'production_test_display_name_evidence_conflict'


@pytest.mark.parametrize('name_status,expected', [
    ('PENDING_REVIEW', None),
    ('APPROVED', 'production_test_display_name_evidence_conflict'),
    ('AVAILABLE_WITHOUT_REVIEW', None),
    *[(status, 'production_test_display_name_status_ineligible') for status in
      ('ACTIVE', 'DECLINED', 'EXPIRED', 'NONE', 'NON_EXISTS', 'FUTURE_UNKNOWN_VALUE')],
])
def test_explicit_meta_name_status_consistency_for_display_name_exception(case, name_status, expected):
    save_health(case)
    assert save_sender_name_status(case, name_status)['evidence']['nameStatus'] == name_status
    assert manual_block(case) == expected
    response = submit(case)
    if expected:
        assert response.status_code == 403
        assert response.json['reason'] == expected
        case.http.assert_not_called()
    else:
        assert response.status_code == 200
        assert response.json['status'] == 'accepted'
        assert case.http.call_count == 1  # Mocked transport only.


def test_missing_name_status_stays_unknown_and_does_not_decide_exception(case):
    save_health(case)
    result = save_sender_name_status(case, None)
    assert result['evidence']['nameStatus'] == 'UNKNOWN'
    assert result['evidence']['nameStatusUnsupported'] is False
    assert manual_block(case) is None
    assert submit(case).status_code == 200
    raw = meta_health(case)
    raw['health_status']['entities'][0]['additional_info'] = ['Unrecognized limitation']
    save_health(case, raw)
    assert manual_block(case) == 'production_test_provider_eligibility_unverified'


@pytest.mark.parametrize('name_status', ['UNKNOWN', 'pending_review', ' ', ['PENDING_REVIEW']])
def test_reported_unsupported_name_status_is_not_treated_as_missing(case, name_status):
    save_health(case)
    assert save_sender_name_status(case, name_status)['evidence']['nameStatusUnsupported'] is True
    assert manual_block(case) == 'production_test_display_name_status_ineligible'
    assert submit(case).status_code == 403
    case.http.assert_not_called()


def test_unknown_name_status_does_not_rescue_unknown_provider_health(case):
    raw = meta_health(case)
    raw['health_status']['entities'][0]['additional_info'] = ['A new, unrecognized limitation']
    save_health(case, raw)
    case.db.integrations.update_one({'_id': 'whatsapp'}, {'$set': {'diagnosticChecks.sender.evidence.nameStatus': 'FUTURE_UNKNOWN_VALUE'}})
    assert manual_block(case) == 'production_test_provider_eligibility_unverified'
    assert submit(case).status_code == 403
    case.http.assert_not_called()


@pytest.mark.parametrize('blocking_status', ['APPROVED', 'DECLINED', 'ACTIVE', 'FUTURE_UNKNOWN_VALUE'])
def test_name_status_change_after_claim_blocks_dispatch(case, blocking_status):
    save_health(case)
    save_sender_name_status(case, 'AVAILABLE_WITHOUT_REVIEW')
    messages = case.db.whatsapp_messages
    original_update = messages.update_one

    def change_name_status_after_claim(*args, **kwargs):
        result = original_update(*args, **kwargs)
        update = args[1] if len(args) > 1 else kwargs.get('update', {})
        if (update.get('$inc') or {}).get('attempts'):
            save_sender_name_status(case, blocking_status)
        return result

    with patch.object(messages, 'update_one', side_effect=change_name_status_after_claim):
        response = submit(case, requestId='name-status-dispatch-change-12345')
    assert response.status_code == 403
    assert response.json['reason'] == ('production_test_display_name_evidence_conflict' if blocking_status == 'APPROVED'
                                       else 'production_test_display_name_status_ineligible')
    case.http.assert_not_called()


@pytest.mark.parametrize('blocking_status', ['APPROVED', 'DECLINED', 'EXPIRED', 'FUTURE_UNKNOWN_VALUE'])
def test_name_status_change_during_retry_blocks_second_dispatch(case, blocking_status):
    save_health(case)
    save_sender_name_status(case, 'AVAILABLE_WITHOUT_REVIEW')
    case.http.return_value = case.response(429, {'error': {'code': 130429}}, {'Retry-After': '1'})

    def change_name_status(*_):
        save_sender_name_status(case, blocking_status)

    with patch('app.whatsapp.retry_sleep', side_effect=change_name_status):
        response = submit(case, requestId='name-status-retry-change-12345')
    assert response.status_code == 403
    assert response.json['reason'] == ('production_test_display_name_evidence_conflict' if blocking_status == 'APPROVED'
                                       else 'production_test_display_name_status_ineligible')
    assert case.http.call_count == 1
