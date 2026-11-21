"""Fresh diagnostic evidence and dispatch authorization; all provider IO mocked."""
from datetime import timedelta
from unittest.mock import patch

import pytest
import requests

from app import whatsapp_checks as checks
from app.whatsapp import now
from test_whatsapp_production_test import case, submit

PATH = '/api/admin/integrations/whatsapp/diagnostics/refresh'


def guard(case):
    case.app.config.update(MONGO_DBNAME=case.db.name, MONGO_URI='mongodb://localhost/' + case.db.name,
                           WHATSAPP_EXPECTED_DATABASE=case.db.name)


def health(case, state='AVAILABLE'):
    return {'health_status': {'can_send_message': state, 'entities': [
        {'entity_type': kind, 'id': case.app.config[key] if key else '99999', 'can_send_message': state}
        for kind, key in [('PHONE_NUMBER', 'WHATSAPP_PHONE_NUMBER_ID'), ('WABA', 'WHATSAPP_BUSINESS_ACCOUNT_ID'), ('BUSINESS', 'WHATSAPP_BUSINESS_PORTFOLIO_ID'), ('APP', 'WHATSAPP_APP_ID')]]}}


@pytest.mark.parametrize('scope', [*checks.SCOPES, 'all'])
def test_refresh_scopes_request_fresh_evidence_with_guard_auth_and_no_dispatch(case, scope):
    guard(case)
    def fresh(db, config):
        return checks._result('templates', 'VERIFIED', 'fresh inventory', 'review', 'mocked Meta GET')
    with patch.object(checks, '_get', return_value=health(case)), patch.object(checks, '_templates', side_effect=fresh):
        response = case.client.post(PATH, headers=case.headers, json={'scope': scope})
    assert response.status_code == 200
    assert response.headers['Cache-Control'] == 'no-store'
    expected = set(checks.SCOPES) if scope == 'all' else {scope}
    saved = case.db.integrations.find_one({'_id': 'whatsapp'})['diagnosticChecks']
    assert expected <= saved.keys()
    for key in expected:
        assert saved[key]['checkedAt'] and saved[key]['status'] in checks.STATUSES
    assert '_scope' not in str(response.json)
    assert 'private-access-token' not in str(response.json)
    assert 'private-app-secret' not in str(response.json)
    assert case.db.orders.count_documents({}) == 0
    case.http.assert_not_called()


def test_refresh_requires_admin_valid_scope_database_guard_and_rate_limit(case):
    assert case.client.post(PATH, json={'scope': 'all'}).status_code == 401
    with patch('app.rbac.current_user', return_value={**case.admin, 'role': 'customer'}):
        assert case.client.post(PATH, headers=case.headers, json={'scope': 'all'}).status_code == 403
    assert case.client.post(PATH, headers=case.headers, json={'scope': 'invalid'}).status_code == 400
    assert case.client.post(PATH, headers=case.headers, json={'scope': 'configuration'}).status_code == 409
    guard(case)
    from app.extensions import limiter
    from flask import Flask
    from flask_jwt_extended import JWTManager
    from app.whatsapp_routes import admin_bp
    previous = limiter.enabled
    app = Flask('diagnostic-rate-test')
    app.config.update(case.app.config, RATELIMIT_ENABLED=True, RATELIMIT_STORAGE_URI='memory://')
    JWTManager(app)
    limiter.init_app(app)
    app.register_blueprint(admin_bp, url_prefix='/api/admin/integrations/whatsapp')
    try:
        limiter.reset()
        statuses = [app.test_client().post(PATH, headers=case.headers, json={'scope': 'configuration'}).status_code for _ in range(22)]
    finally:
        limiter.enabled = previous
    assert 200 in statuses and 429 in statuses
    case.http.assert_not_called()


@pytest.mark.parametrize('offset,expected', [(timedelta(hours=1), 'VERIFIED'), (timedelta(0), 'DISABLED BY CONFIGURATION'), (timedelta(hours=25), 'DISABLED BY CONFIGURATION')])
def test_configuration_gate_expiry_reports_without_activation(case, offset, expected):
    case.app.config['WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT'] = (now() + offset).isoformat()
    assert checks._configuration(case.db, case.app.config)['status'] == expected


def test_billing_unknown_replaces_previous_success_but_never_infers_ledger_clearance(case):
    guard(case)
    with patch.object(checks, '_get', return_value=health(case)):
        result = checks._billing(case.db, case.app.config)
    assert result['status'] == 'NOT VERIFIED'
    assert result['evidence']['providerEligibilityVerified'] is True
    assert result['evidence']['billingLedgerVerified'] is False
    with patch.object(checks, '_get', return_value=health(case, 'BLOCKED')):
        assert checks._billing(case.db, case.app.config)['status'] == 'BLOCKED'
    with patch.object(checks, '_get', side_effect=requests.RequestException('private-provider-detail')):
        checks.refresh_checks(case.db, case.app.config, 'billing')
    assert checks.public_checks(case.db, case.app.config)[0]['status'] == 'UNKNOWN'
    assert checks.production_provider_block(case.db, case.app.config) == 'production_test_provider_eligibility_unverified'
    assert 'private-provider-detail' not in str(checks.public_checks(case.db, case.app.config))


@pytest.mark.parametrize('code_status,registration,business_status,quality,tier,expected', [
    ('VERIFIED','CONNECTED','verified','GREEN','TIER_250','VERIFIED'),
    ('NOT_VERIFIED','CONNECTED','VERIFIED','GREEN','TIER_250','UNKNOWN'),
    ('VERIFIED','UNREGISTERED','VERIFIED','HIGH','TIER_250','BLOCKED'),
    (None,None,None,None,None,'UNKNOWN')])
def test_sender_separates_code_business_registration_quality_and_capacity(case, code_status, registration, business_status, quality, tier, expected):
    values = {'code_verification_status':code_status, 'status':registration, 'display_phone_number':'+14155552671', 'quality_rating':quality}
    def get(_config,path,fields):
        if path == case.app.config['WHATSAPP_BUSINESS_ACCOUNT_ID']:
            return {'business_verification_status':business_status,'whatsapp_business_manager_messaging_limit':tier}
        return {fields:values.get(fields)}
    with patch.object(checks, '_get', side_effect=get):
        result = checks._sender(case.db, case.app.config)
    assert result['status'] == expected
    assert result['evidence']['phoneMasked'] == '***2671'
    assert '+14155552671' not in str(result)
    if code_status == 'NOT_VERIFIED' and registration == 'CONNECTED':
        assert result['evidence']['codeVerificationStatus'] == 'NOT_VERIFIED'
        assert result['evidence']['phoneOwnershipOtpStatus'] == 'NOT_VERIFIED'
        assert 'inconsistent read' in result['evidence']['senderConnectionAndOtpEvidence']
        assert result['evidence']['businessVerificationStatus'] == 'VERIFIED'
        assert result['evidence']['messagingLimitTier'] == 'TIER_250'
        assert result['evidence']['qualityDisplay'] == 'HIGH'


@pytest.mark.parametrize('membership,callback,field,expected', [(True,True,True,'VERIFIED'), (False,True,True,'BLOCKED'), (True,False,True,'BLOCKED'), (True,True,False,'BLOCKED')])
def test_waba_membership_callback_and_messages_are_independent(case, membership, callback, field, expected):
    from app.whatsapp import CALLBACK
    waba = [{'whatsapp_business_api_data':{'id':case.app.config['WHATSAPP_APP_ID']}}] if membership else []
    app = [{'object':'whatsapp_business_account','active':True,'callback_url':CALLBACK if callback else 'https://invalid.example', 'fields':[{'name':'messages' if field else 'other'}]}]
    with patch.object(checks, '_edge', side_effect=[waba,app]):
        assert checks._webhook(case.db, case.app.config)['status'] == expected
    with patch.object(checks, '_edge', side_effect=[waba,requests.RequestException()]):
        assert checks._webhook(case.db, case.app.config)['status'] == ('UNKNOWN' if membership else 'BLOCKED')


@pytest.mark.parametrize('state,age,expected', [('complete',0,'VERIFIED'), ('stopped',0,'ACTION REQUIRED'), ('running',5,'ACTION REQUIRED')])
def test_worker_software_observation_is_not_host_or_dispatch_proof(case,state,age,expected):
    checks.record_worker_observation(case.db,case.app.config,state,0)
    case.db.integrations.update_one({'_id':'whatsapp'},{'$set':{'workerObservation.observedAt':now()-timedelta(minutes=age)}})
    result=checks._worker(case.db,case.app.config)
    assert result['status']==expected
    assert 'UNKNOWN' in result['evidence']['systemdService']
    case.db.integrations.update_one({'_id':'whatsapp'},{'$set':{'workerObservation.database':'other'}})
    assert checks._worker(case.db,case.app.config)['status']=='ACTION REQUIRED'


def test_outbox_snapshot_counts_without_claiming_or_reading_payloads(case):
    case.db.whatsapp_outbox.insert_one({'status':'pending','payload':'private-encrypted-value','retryCount':1,'expiresAt':now()-timedelta(seconds=1)})
    result=checks._outbox(case.db,case.app.config)
    assert result['status']=='ACTION REQUIRED'
    assert result['evidence']['pending']==result['evidence']['expiredPending']==result['evidence']['retryJobs']==1
    assert 'private-encrypted-value' not in str(result)
    assert case.db.whatsapp_outbox.find_one()['status']=='pending'


@pytest.mark.parametrize('mutation', ['stale','scope','sender','billing'])
def test_manual_test_rechecks_provider_proofs_before_dispatch_and_retry(case,mutation):
    def change(*_):
        path,value={'stale':('sender.checkedAt',now()-timedelta(minutes=16)), 'scope':('sender._scope','other'),
                    'sender':('sender.evidence.registration','UNREGISTERED'), 'billing':('billing.evidence.providerEligibilityVerified',False)}[mutation]
        case.db.integrations.update_one({'_id':'whatsapp'},{'$set':{'diagnosticChecks.'+path:value}})
    case.http.return_value=case.response(429,{'error':{'code':130429}},{'Retry-After':'1'})
    with patch('app.whatsapp.retry_sleep',side_effect=change):
        assert submit(case).status_code in {403,409}
    assert case.http.call_count==1
    case.http.reset_mock()
    assert submit(case,requestId='new-blocked-request-12345').status_code in {403,409}
    case.http.assert_not_called()


def test_provider_evidence_is_rechecked_after_claim_immediately_before_post(case):
    original=case.db.whatsapp_messages.update_one
    def revoke(*args,**kwargs):
        result=original(*args,**kwargs)
        case.db.integrations.update_one({'_id':'whatsapp'},{'$set':{'diagnosticChecks.sender.evidence.registration':'UNREGISTERED'}})
        return result
    with patch.object(case.db.whatsapp_messages,'update_one',side_effect=revoke):
        assert submit(case).status_code in {403,409}
    case.http.assert_not_called()


def test_code_verification_field_alone_does_not_override_connected_sender_or_provider_health(case):
    case.db.integrations.update_one({'_id':'whatsapp'}, {'$set': {
        'diagnosticChecks.sender.evidence.codeVerificationStatus':'NOT_VERIFIED',
        'diagnosticChecks.sender.evidence.registration':'CONNECTED',
        'diagnosticChecks.sender.evidence.businessVerificationStatus':'VERIFIED',
    }})
    assert checks.production_provider_block(case.db, case.app.config) is None
    # Meta's separate messaging health remains a required provider prerequisite.
    case.db.integrations.update_one({'_id':'whatsapp'}, {'$set': {
        'diagnosticChecks.billing.evidence.providerEligibilityVerified':False,
    }})
    assert checks.production_provider_block(case.db, case.app.config) == 'production_test_provider_eligibility_unverified'


@pytest.mark.parametrize('mutation', ['pending', 'language', 'components'])
def test_template_refresh_keeps_exact_approval_language_and_component_requirements(case, mutation):
    if mutation == 'pending':
        case.db.whatsapp_template_status.update_many({}, {'$set': {'status': 'PENDING'}})
    elif mutation == 'language':
        case.app.config['WHATSAPP_TEMPLATES']['order_confirmation']['language'] = 'en_GB'
    else:
        case.db.whatsapp_template_status.update_many({}, {'$set': {'componentsVerified': False}})
    with patch('app.whatsapp_routes.refresh_template_observations') as refresh:
        assert checks._templates(case.db, case.app.config)['status'] == 'ACTION REQUIRED'
    refresh.assert_called_once()
    case.http.assert_not_called()


def test_graph_get_uses_server_only_app_authorization_with_no_redirects(case):
    from unittest.mock import Mock
    response = Mock()
    response.json.return_value = {'data': []}
    with patch.object(checks.requests, 'get', return_value=response) as get:
        checks._get(case.app.config, '123/subscriptions', app=True)
    call = get.call_args
    assert call.kwargs['allow_redirects'] is False
    assert 'private-app-secret' in call.kwargs['headers']['Authorization']
    assert 'private-app-secret' not in call.args[0]
    assert 'access_token' not in call.kwargs['params']
