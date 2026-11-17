"""Diagnostic evidence must never become send authorization or expose secrets."""
from unittest.mock import patch

from app.whatsapp_diagnostics import application_diagnostics
from test_whatsapp_production_test import case, submit


def test_disabled_switch_and_missing_expiry_are_explained_without_enabling(case):
    c = case
    c.app.config.update(WHATSAPP_PRODUCTION_TEST_SEND_ENABLED=False, WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT='')
    rows = application_diagnostics(c.app.config, {})
    gate = next(row for row in rows if row['code'] == 'production_test_disabled')
    assert 'WHATSAPP_PRODUCTION_TEST_SEND_ENABLED' in gate['message']
    assert 'WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT' in gate['message']
    assert submit(c).json['reason'] == 'production_test_disabled'
    c.http.assert_not_called()


def test_billing_phone_and_subscription_diagnostics_preserve_evidence_boundaries(case):
    rows = application_diagnostics(case.app.config, {'phoneCodeVerificationStatus': 'NOT_VERIFIED', 'subscriptionStatus': 'not_subscribed'},
                                   {'failureDetails': {'errors': [{'code': 131042, 'message': 'synthetic-private-secret'}]}})
    codes = {row['code'] for row in rows}
    assert {'meta_billing_issue_recorded', 'meta_phone_code_status_review', 'meta_waba_not_subscribed'} <= codes
    assert 'synthetic-private-secret' not in str(rows)
    assert 'does not establish' in next(row['message'] for row in rows if row['code'] == 'meta_billing_issue_recorded')
    phone = next(row for row in rows if row['code'] == 'meta_phone_code_status_review')
    assert phone['severity'] == 'info' and 'does not justify removal or re-registration' in phone['message']
    assert case.db.orders.count_documents({}) == 0
    assert case.db.whatsapp_outbox.count_documents({}) == 0
    case.http.assert_not_called()


def test_connection_check_stores_phone_evidence_without_claiming_billing_clearance(case):
    c = case
    responses = [c.response(200, {'display_phone_number': '+1 4155552671', 'code_verification_status': 'NOT_VERIFIED', 'quality_rating': 'GREEN'}),
                 c.response(200, {'data': [{'whatsapp_business_api_data': {'id': c.app.config['WHATSAPP_APP_ID']}}]})]
    # A successful GET must not erase historical failure evidence from diagnostics.
    c.db.whatsapp_messages.insert_one({'_id': 'prior-billing-failure', 'error': {'code': 131042}})
    with patch('app.whatsapp_routes.requests.get', side_effect=responses):
        response = c.client.post('/api/admin/integrations/whatsapp/test-connection', headers=c.headers)
    assert response.status_code == 200
    assert response.json['phoneCodeVerificationStatus'] == 'NOT_VERIFIED'
    assert response.json['subscriptionStatus'] == 'subscribed'
    assert 'meta_billing_issue_recorded' in {row['code'] for row in response.json['diagnostics']}
    assert c.db.integrations.find_one({'_id': 'whatsapp'})['phoneStatusCheckedAt']
    c.http.assert_not_called()


def test_manual_utility_test_ignores_closed_service_window_and_never_modifies_an_order(case):
    from bson import ObjectId
    c = case
    order = {'_id': ObjectId(), 'orderNumber': 'fixture-order', 'paymentStatus': 'paid'}
    c.db.orders.insert_one(dict(order))
    with patch('app.whatsapp.customer_window', side_effect=AssertionError('Template tests must not require a service window')):
        assert submit(c).status_code == 200
    assert list(c.db.orders.find()) == [order]
    assert c.db.whatsapp_order_events.count_documents({}) == 0
    assert c.db.whatsapp_outbox.count_documents({}) == 0
    assert c.db.whatsapp_messages.find_one()['orderId'] is None
    c.http.assert_called_once()
