"""In-memory checkout-to-provider regressions; no live provider/database access."""
from contextlib import ExitStack
from unittest.mock import patch

import pytest
from app.phone_numbers import customer_phone
from app.checkout_whatsapp import checkout_recipient
from app.whatsapp import fingerprint, process_outbox
from app.whatsapp_consent import record_consent
from test_whatsapp_remediation import case
from test_whatsapp_order_mode import order_case, enqueue


@pytest.mark.parametrize('raw,country,expected', [
    ('9619888755', 'IN', '+919619888755'), ('+919619888755', 'IN', '+919619888755'),
    ('020 7946 0018', 'GB', '+442079460018'), ('4155552671', 'US', '+14155552671'),
    ('+442079460018', None, '+442079460018'),
])
def test_explicit_country_normalizes_legacy_and_international_numbers(raw, country, expected):
    assert customer_phone(raw, country)[0] == expected


@pytest.mark.parametrize('raw,country', [('9619888755', None), ('123', 'IN'), ('+14155552671', 'IN'), ('call +919619888755', 'IN'), ('+919619888755 ext 2', 'IN')])
def test_missing_ambiguous_or_invalid_country_never_guessed(raw, country):
    with pytest.raises(ValueError):
        customer_phone(raw, country)


def checkout(c, **choices):
    from app.blueprints.payments.routes import payments_bp
    if 'payments' not in c.app.blueprints:
        c.app.register_blueprint(payments_bp, url_prefix='/api/payments')
    mocks = {
        'database': c.db, 'current_user': c.db.users.find_one({'_id': c.user['_id']}),
        'authenticated_user_id': c.user['_id'], 'is_configured': True,
        'ensure_catalog_seed': None, '_checkout_items': ([], 1250),
        '_normalise_shipping': {'phone': '9619888755'}, 'razorpay_api_request': {'id': 'order_new'},
    }
    with ExitStack() as stack:
        for name, result in mocks.items():
            stack.enter_context(patch('app.blueprints.payments.routes.' + name, return_value=result))
        return c.client.post('/api/payments/razorpay/order', headers=c.headers, json={'checkoutAttemptId': 'repair-checkout-fixture', **choices})


@pytest.mark.parametrize('save', [False, True])
def test_alternate_snapshot_is_actual_provider_recipient_and_primary_save_is_optional(order_case, save):
    c = order_case
    original = c.user['phone']
    response = checkout(c, whatsappRecipient='+442079460018', whatsappCountry='GB', whatsappTransactionalConsent=True, saveWhatsappAsPrimary=save)
    assert response.status_code == 201, response.json
    order = c.db.orders.find_one({'checkoutAttemptId': 'repair-checkout-fixture'})
    assert order['whatsappRecipient'] == '+442079460018'
    assert order['shipping']['phone'] == '9619888755'
    assert order['whatsappConsent']['phone'] == order['whatsappRecipient']
    assert order['whatsappRecipientSource'] == 'alternate_checkout'
    assert c.db.users.find_one({'_id': c.user['_id']}).get('whatsappPhone', original) == ('+442079460018' if save else original)
    assert c.db.whatsapp_outbox.count_documents({}) == 0
    from app.blueprints.payments.routes import _fulfil_paid_order
    with c.app.app_context(), patch('app.order_confirmation.send_html_email', return_value={}):
        paid, _ = _fulfil_paid_order(c.db, order, 'pay_new', 'checkout')
        _fulfil_paid_order(c.db, paid, 'pay_new', 'webhook')
    assert c.db.whatsapp_outbox.count_documents({}) == 1
    process_outbox(c.db, c.app.config)
    assert c.http.call_args.kwargs['json']['to'] == '442079460018'
    message = c.db.whatsapp_messages.find_one({'providerId': 'wamid.TEST'})
    assert message['orderId'] == str(order['_id'])
    assert message['orderNumber'] == order['orderNumber']
    assert message['customerId'] == str(c.user['_id'])
    assert message['recipientSource'] == 'alternate_checkout'


def test_saved_primary_consent_is_snapshotted_without_repeated_checkbox(order_case):
    c = order_case
    record_consent(c.db, c.app.config, c.user['_id'], c.user['phone'], True, 'signup')
    assert checkout(c).status_code == 201
    order = c.db.orders.find_one({'checkoutAttemptId': 'repair-checkout-fixture'})
    assert order['whatsappRecipient'] == c.user['phone']
    assert order['whatsappConsent']['enabled'] is True
    assert order['whatsappConsent']['orderId'] == str(order['_id'])


def test_changed_number_never_inherits_consent_and_invalid_number_preserves_order_state(order_case):
    c = order_case
    assert checkout(c, whatsappRecipient='9619888755').status_code == 400
    assert c.db.orders.count_documents({'checkoutAttemptId': 'repair-checkout-fixture'}) == 0
    assert checkout(c, whatsappRecipient='+442079460018').status_code == 201
    order = c.db.orders.find_one({'checkoutAttemptId': 'repair-checkout-fixture'})
    assert order['whatsappConsent']['enabled'] is False
    assert checkout(c, whatsappRecipient='+14155552671').status_code == 409
    assert c.db.orders.find_one({'_id': order['_id']})['whatsappRecipient'] == '+442079460018'


def test_profile_optout_and_phone_level_stop_still_block_snapshots(order_case):
    c = order_case
    record_consent(c.db, c.app.config, c.user['_id'], c.user['phone'], True, 'signup')
    user = c.db.users.find_one({'_id': c.user['_id']})
    c.db.whatsapp_optouts.update_one({'_id': fingerprint(c.user['phone'], c.app.config)}, {'$set': {'active': True}}, upsert=True)
    selected = checkout_recipient(c.db, c.app.config, user, {}, {})
    assert selected['consent'] is None
    assert selected['reason'] == 'missing_or_withdrawn_consent'


@pytest.mark.parametrize('state', ['sent', 'delivered', 'read', 'failed'])
def test_order_status_webhooks_keep_correlation_and_monotonic_projection(order_case, state):
    c = order_case
    enqueue(c)
    process_outbox(c.db, c.app.config)
    event = c.webhook(statuses=[c.provider_status(state)])
    assert c.signed(event).status_code == 200
    assert c.signed(event).status_code == 200
    message = c.db.whatsapp_messages.find_one({'providerId': 'wamid.TEST'})
    assert message['status'] == state
    assert len(message['statusHistory']) == 1
    assert message['orderId'] == str(c.order['_id'])
    if state == 'read':
        c.signed(c.webhook(statuses=[c.provider_status('delivered')]))
        assert c.db.whatsapp_messages.find_one({'_id': message['_id']})['status'] == 'read'


@pytest.mark.parametrize('phone,country,expected', [('9619888755', 'IN', '+919619888755'), ('02079460018', 'GB', '+442079460018')])
def test_signup_stores_country_and_consent_for_exact_phone(case, phone, country, expected):
    c = case
    payload = dict(firstName='Test', lastName='Customer', username='signup_repair', email='signup@fixture.test',
                   phone=phone, phoneCountry=country, dob='1990-01-01', gender='female', region='asia-india',
                   password='synthetic-password', whatsappTransactionalConsent=True)
    sent = {}
    with patch('app.blueprints.auth.routes._database', return_value=c.db), patch('app.blueprints.auth.routes._send_otp_email', side_effect=lambda email, otp, purpose="signup": sent.update(otp=otp)):
        result = c.client.post('/api/auth/signup/request-otp', json=payload)
    assert result.status_code == 202, result.json
    challenge = c.db.otp_challenges.find_one({'email': payload['email']})
    assert challenge['phone'] == expected
    assert challenge['phoneCountry'] == country
    assert challenge['whatsappTransactionalConsent'] is True

    with patch('app.blueprints.auth.routes._database', return_value=c.db), patch('app.blueprints.auth.routes._create_shared_session', return_value=('synthetic-session', None)), patch('app.blueprints.auth.routes._shared_cookie', side_effect=lambda response, *_: response):
        verified = c.client.post('/api/auth/signup/verify-otp', json={'email': payload['email'], 'otp': sent['otp']})
    assert verified.status_code == 201, verified.json
    saved = c.db.users.find_one({'email': payload['email']})
    assert saved['whatsappPhone'] == expected
    assert saved['whatsappCountry'] == country
    assert saved['whatsappConsent']['phone'] == expected
    assert saved['whatsappConsent']['source'] == 'signup'
    assert saved['whatsappConsent']['version'] == 'transactional-v3'
    assert saved['whatsappConsent']['text'].startswith('I agree to receive transactional')
    assert 'whatsappMarketingConsent' not in saved
    assert c.db.whatsapp_outbox.count_documents({}) == 0
