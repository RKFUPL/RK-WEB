"""Synthetic account/channel tests. No MongoDB, Meta, payment or mail transport."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from bson import ObjectId

from app.blueprints.auth.routes import auth_bp, _public_user
from app.blueprints.admin.routes import SETTINGS_DEFAULTS
from app.communication_preferences import authentication_consent_valid, authentication_recipient, choice_completed, public_preferences, record_authentication_consent, record_choice
from app.whatsapp_consent import consent_phone, record_consent, withdraw_from_inbound
from app.whatsapp_marketing_consent import marketing_phone, record_marketing_consent
from test_manual_checkout import shop


@pytest.fixture
def preferences(shop):
    db, client, user, _, headers, payload, _ = shop
    client.application.register_blueprint(auth_bp, url_prefix='/api/auth')
    user.update(username='synthetic.customer', dob='1990-01-01', gender='female', whatsappPhone=user['phone'], whatsappCountry='US')
    db.users.update_one({'_id': user['_id']}, {'$set': user})
    with patch('app.blueprints.auth.routes._database', return_value=db), \
         patch('app.blueprints.auth.routes.authenticated_user_id', return_value=user['_id']), \
         patch('app.blueprints.auth.routes._send_otp_email'):
        yield shop


def mode(db):
    db.admin_settings.update_one({'_id': 'store'}, {'$set': {'whatsappConsentCollectionMode': 'onboarding'}})


def refresh(db, user):
    user.update(db.users.find_one({'_id': user['_id']}))


def profile(preferences, **changes):
    db, client, user, _, headers, _, _ = preferences
    response = client.put('/api/auth/profile', headers=headers, json=changes)
    refresh(db, user)
    return response


def choices(utility='email', otp='email'):
    return {'otpChannel': otp, 'utilityChannel': utility}


def test_collection_mode_default_validation_and_setting_preservation(preferences):
    db, client, _, _, headers, _, _ = preferences
    assert SETTINGS_DEFAULTS['whatsappConsentCollectionMode'] == 'checkout'
    db.admin_settings.update_one({'_id': 'store'}, {'$set': {'unrelatedSentinel': 'synthetic'}})
    body = {**SETTINGS_DEFAULTS, 'whatsappConsentCollectionMode': 'onboarding'}
    assert client.put('/api/admin/settings', headers=headers, json={**body, 'whatsappConsentCollectionMode': 'invalid'}).status_code == 400
    assert client.put('/api/admin/settings', headers=headers, json=body).status_code == 200
    assert db.admin_settings.find_one({'_id': 'store'})['unrelatedSentinel'] == 'synthetic'
    assert client.get('/api/storefront-settings').json['settings']['whatsappConsentCollectionMode'] == 'onboarding'
    assert client.put('/api/admin/settings', headers=headers, json={**body, 'requireWhatsappConsentForCheckout': True}).status_code == 400


def signup_body():
    return {'email': 'new.synthetic@example.test', 'firstName': 'Synthetic', 'lastName': 'Customer', 'username': 'new.synthetic',
            'phone': '+14155552671', 'phoneCountry': 'US', 'dob': '1990-01-01', 'gender': 'female', 'region': 'us', 'password': 'synthetic-password',
            'otpChannel': 'email', 'whatsappOtpConsent': False, 'whatsappTransactionalConsent': False}


@pytest.mark.parametrize('routing', ['email', 'whatsapp', 'both'])
def test_signup_routing_is_admin_owned_and_categories_remain_explicit(preferences, routing):
    db, client, _, _, _, _, _ = preferences
    mode(db)
    db.admin_settings.update_one({'_id': 'store'}, {'$set': {'authenticationDeliveryMode': routing}})
    body = signup_body()
    body.update(otpChannel='email', whatsappOtpConsent=True, whatsappTransactionalConsent=False)
    with patch('app.blueprints.auth.routes.enabled', return_value=True), patch('app.blueprints.auth.routes.template_registry', return_value={'signup_otp': {'enabled': True, 'approved': True}}), patch('app.blueprints.auth.routes._deliver_otp', return_value=({'email': 'sent'}, True)) as dispatch:
        response = client.post('/api/auth/signup/request-otp', json=body)
    assert response.status_code == 202, response.json
    assert dispatch.call_args.args[0] == routing
    challenge = db.otp_challenges.find_one({})
    assert challenge['whatsappOtpConsent'] is True and challenge['whatsappTransactionalConsent'] is False
    assert not challenge.get('communicationPreferences')
    assert db.communication_preferences.count_documents({}) == 0


def test_customer_cannot_override_admin_modes_and_whatsapp_requires_permission(preferences):
    db, client, _, _, _, _, _ = preferences
    db.admin_settings.update_one({'_id': 'store'}, {'$set': {'authenticationDeliveryMode': 'whatsapp'}})
    assert client.post('/api/auth/signup/request-otp', json={**signup_body(), 'otpChannel': 'email'}).status_code == 400
    assert db.otp_challenges.count_documents({}) == 0
    assert profile(preferences, authenticationDeliveryMode='email').status_code == 400
    assert profile(preferences, transactionalDeliveryMode='email').status_code == 400
    assert db.admin_settings.find_one({'_id': 'store'})['authenticationDeliveryMode'] == 'whatsapp'


def test_legacy_boolean_is_not_consent_or_completed_choice(preferences):
    db, _, user, _, _, _, _ = preferences
    user['whatsappNotifications'] = True
    db.users.update_one({'_id': user['_id']}, {'$set': {'whatsappNotifications': True}})
    public = _public_user(user)
    assert not public['communicationPreferences']['completed'] and not public['whatsappConsentValid']
    assert db.whatsapp_consents.count_documents({}) == 0
    assert db.communication_preferences.count_documents({}) == 0


def test_profile_link_does_not_grant_and_uses_actual_contact_country(preferences):
    db, _, user, _, _, _, _ = preferences
    response = profile(preferences, phone='+442079460018', whatsappSameAsContact=True, whatsappPhone='+14155552671')
    assert response.status_code == 200, response.json
    assert response.json['user']['whatsappPhone'] == '+442079460018'
    assert response.json['user']['whatsappCountry'] == 'GB'
    assert response.json['user']['whatsappSameAsContact'] is True
    assert not response.json['user']['whatsappConsentValid']
    assert db.whatsapp_consents.count_documents({'enabled': True}) == 0


def test_profile_boolean_shortcut_rejected_and_valid_grant_is_reused(preferences):
    db, _, user, _, _, _, _ = preferences
    assert profile(preferences, whatsappNotifications=True).status_code == 400
    granted = profile(preferences, whatsappTransactionalConsent=True)
    assert granted.status_code == 200, granted.json
    count = db.whatsapp_consents.count_documents({'enabled': True})
    again = profile(preferences, whatsappNotifications=True)
    assert again.status_code == 200
    assert db.whatsapp_consents.count_documents({'enabled': True}) == count
    changed = profile(preferences, whatsappPhone='+442079460018', whatsappCountry='GB', whatsappNotifications=True)
    assert changed.status_code == 400


def test_changed_linked_phone_withdraws_old_permission_without_granting_new(preferences):
    db, _, user, _, _, _, _ = preferences
    assert profile(preferences, whatsappSameAsContact=True, whatsappTransactionalConsent=True).status_code == 200
    response = profile(preferences, phone='+442079460018')
    assert response.status_code == 200
    assert not response.json['user']['whatsappConsentValid']
    assert consent_phone(db, {}, user, {}) is None
    assert db.whatsapp_consents.count_documents({'phone': '+442079460018', 'enabled': True}) == 0


def test_existing_account_email_choice_does_not_create_grant(preferences):
    db, _, user, _, _, _, _ = preferences
    mode(db)
    response = profile(preferences, communicationPreferences=choices(), whatsappPhone='', whatsappNotifications=False)
    assert response.status_code == 200, response.json
    assert not response.json['user']['communicationPreferences']['completed']
    assert db.whatsapp_consents.count_documents({'enabled': True}) == 0


def test_onboarding_checkout_needs_no_customer_routing_choice_or_whatsapp_grant(preferences):
    db, client, user, _, headers, payload, _ = preferences
    mode(db)
    db.admin_settings.update_one({'_id': 'store'}, {'$set': {'requireWhatsappConsentForCheckout': True}})
    payload.update(whatsappRecipient='', whatsappTransactionalConsent=False)
    response = client.post('/api/payments/razorpay/order', headers=headers, json=payload)
    assert response.status_code == 201, response.json
    assert db.whatsapp_consents.count_documents({'enabled': True}) == 0
    assert db.orders.find_one({})['whatsappConsent']['enabled'] is False


def test_onboarding_reuses_exact_grant_and_rejects_changed_recipient(preferences):
    db, client, user, _, headers, payload, _ = preferences
    mode(db)
    assert profile(preferences, whatsappTransactionalConsent=True).status_code == 200
    count = db.whatsapp_consents.count_documents({})
    payload.pop('whatsappTransactionalConsent')
    payload.update(whatsappRecipient='+442079460018', whatsappCountry='GB')
    assert client.post('/api/payments/razorpay/order', headers=headers, json=payload).status_code == 400
    payload.update(whatsappRecipient=user['phone'], whatsappCountry='US')
    response = client.post('/api/payments/razorpay/order', headers=headers, json=payload)
    assert response.status_code == 201, response.json
    assert db.orders.find_one({})['whatsappConsent']['enabled'] is True
    assert db.whatsapp_consents.count_documents({}) == count


def test_withdrawal_and_marketing_are_independent_and_stop_remains_effective(preferences):
    db, _, user, _, _, _, _ = preferences
    config = {'WHATSAPP_APP_SECRET': 'synthetic-consent-secret'}
    record_consent(db, config, user['_id'], user['phone'], True, 'synthetic')
    record_marketing_consent(db, config, user['_id'], user['phone'], True, 'synthetic')
    record_authentication_consent(db, config, user['_id'], user['phone'], True, 'synthetic')
    refresh(db, user)
    record_choice(db, user, choices('whatsapp', 'whatsapp'), 'synthetic')
    refresh(db, user)
    assert authentication_recipient(db, config, user) == user['phone']
    record_marketing_consent(db, config, user['_id'], user['phone'], False, 'synthetic')
    refresh(db, user)
    assert consent_phone(db, config, user, {}) and not marketing_phone(db, config, user)
    stopped_at = datetime.now(timezone.utc)
    withdraw_from_inbound(db, config, user['phone'], stopped_at)
    count = db.whatsapp_consents.count_documents({})
    withdraw_from_inbound(db, config, user['phone'], stopped_at)
    assert db.whatsapp_consents.count_documents({}) == count
    refresh(db, user)
    assert consent_phone(db, config, user, {}) is None
    assert not authentication_consent_valid(db, config, user)
    assert public_preferences(db, config, user)['effectiveUtilityChannel'] == 'email'
    assert db.whatsapp_outbox.count_documents({}) == 0


def test_authentication_withdrawal_fences_an_older_pending_challenge(preferences):
    db, _, user, _, _, _, _ = preferences
    config = {'WHATSAPP_APP_SECRET': 'synthetic-consent-secret'}
    from app.whatsapp import valid_auth_delivery
    old = datetime.now(timezone.utc) - timedelta(minutes=1)
    record = record_consent(db, config, user['_id'], user['phone'], True, 'explicit_login_otp', category='authentication', update_user=False)
    db.whatsapp_consents.update_one({'_id': ObjectId(record['consentId'])}, {'$set': {'timestamp': old, 'challengeId': str(user['_id'])}})
    context = {'consentId': record['consentId'], 'challengeId': str(user['_id']), 'purpose': 'login'}
    with patch('app.whatsapp.valid_auth_code', return_value=True):
        assert valid_auth_delivery(db, context, 'login_otp', '123456', user['phone'])
        record_authentication_consent(db, config, user['_id'], user['phone'], False, 'authenticated_profile')
        assert not valid_auth_delivery(db, context, 'login_otp', '123456', user['phone'])


def test_onboarding_cannot_create_primary_consent_from_checkout(preferences):
    db, client, user, _, headers, payload, _ = preferences
    mode(db)
    assert profile(preferences, whatsappTransactionalConsent=True).status_code == 200
    count = db.whatsapp_consents.count_documents({})
    payload.update(saveWhatsappAsPrimary=True, whatsappTransactionalConsent=True)
    assert client.post('/api/payments/razorpay/order', headers=headers, json=payload).status_code == 400
    assert db.whatsapp_consents.count_documents({}) == count
    assert db.orders.count_documents({}) == 0


def test_authentication_can_be_chosen_without_transactional_or_marketing_permission(preferences):
    db, client, user, _, _, _, _ = preferences
    response = profile(preferences, whatsappPhone='+442079460018', whatsappCountry='GB', whatsappOtpConsent=True,
                       whatsappTransactionalConsent=False)
    assert response.status_code == 200, response.json
    assert response.json['user']['whatsappOtpConsentValid'] is True
    assert response.json['user']['whatsappConsentValid'] is False
    assert response.json['user']['whatsappMarketingConsentValid'] is False
    assert authentication_recipient(db, client.application.config, user) == '+442079460018'
    assert user['phone'] == '+14155552671'
    with patch('app.blueprints.auth.routes.notify_auth_otp', return_value={'status': 'queued'}) as notify:
        from app.blueprints.auth.routes import _deliver_otp
        _deliver_otp('whatsapp', 'login_otp', user, {'_id': user['_id']}, '123456', 'login', user['email'])
    assert notify.call_args.args[2]['phone'] == '+442079460018'
    assert db.whatsapp_consents.count_documents({'category': 'transactional', 'enabled': True}) == 0


def test_narrow_withdrawal_never_downgrades_signed_or_unknown_phone_blocks(preferences):
    db, client, user, _, _, _, _ = preferences
    from app.whatsapp import fingerprint
    from app.whatsapp_consent import opted_out
    config = client.application.config
    key = fingerprint(user['phone'], config)
    for previous in ({'active': True, 'source': 'signed_inbound_stop', 'category': 'all'}, {'active': True}):
        db.whatsapp_optouts.replace_one({'_id': key}, {'_id': key, **previous}, upsert=True)
        record_consent(db, config, user['_id'], user['phone'], False, 'authenticated_profile')
        assert opted_out(db, config, user['phone'], category='authentication')
        assert db.whatsapp_optouts.find_one({'_id': key}) == {'_id': key, **previous}


def test_concurrent_stop_cannot_be_overwritten_by_a_category_withdrawal(preferences):
    db, client, user, _, _, _, _ = preferences
    from app.whatsapp import fingerprint
    from app.whatsapp_consent import opted_out
    config = client.application.config
    key = fingerprint(user['phone'], config)
    original = db.whatsapp_optouts.update_one
    def stop_first(query, update, **kwargs):
        if '$or' in query:
            original({'_id': key}, {'$set': {'active': True, 'source': 'signed_inbound_stop', 'category': 'all'}}, upsert=True)
        return original(query, update, **kwargs)
    with patch.object(db.whatsapp_optouts, 'update_one', side_effect=stop_first):
        record_consent(db, config, user['_id'], user['phone'], False, 'authenticated_profile')
    assert opted_out(db, config, user['phone'], category='authentication')
    assert db.whatsapp_optouts.find_one({'_id': key})['source'] == 'signed_inbound_stop'


def test_stale_profile_flags_cannot_regrant_withdrawn_categories(preferences):
    db, client, user, _, _, _, _ = preferences
    config = client.application.config
    record_consent(db, config, user['_id'], user['phone'], True, 'synthetic')
    record_authentication_consent(db, config, user['_id'], user['phone'], True, 'synthetic')
    record_marketing_consent(db, config, user['_id'], user['phone'], True, 'synthetic')
    record_consent(db, config, user['_id'], user['phone'], False, 'authenticated_profile')
    record_authentication_consent(db, config, user['_id'], user['phone'], False, 'authenticated_profile')
    record_marketing_consent(db, config, user['_id'], user['phone'], False, 'authenticated_profile')
    refresh(db, user)
    count = db.whatsapp_consents.count_documents({'enabled': True})
    assert profile(preferences, whatsappNotifications=True).status_code == 400
    assert profile(preferences, whatsappNotifications=True, communicationPreferences=choices('email', 'whatsapp')).status_code == 400
    assert profile(preferences, whatsappMarketingNotifications=True).status_code == 400
    assert db.whatsapp_consents.count_documents({'enabled': True}) == count


@pytest.mark.parametrize('auth', ['email', 'whatsapp', 'both'])
@pytest.mark.parametrize('utility', ['email', 'whatsapp', 'both'])
def test_admin_delivery_modes_persist_and_preserve_settings(preferences, auth, utility):
    db, client, _, _, headers, _, _ = preferences
    db.admin_settings.update_one({'_id': 'store'}, {'$set': {'sentinel': 'unchanged'}})
    body = {**SETTINGS_DEFAULTS, 'authenticationDeliveryMode': auth, 'transactionalDeliveryMode': utility}
    response = client.put('/api/admin/settings', headers=headers, json=body)
    assert response.status_code == 200, response.json
    stored = db.admin_settings.find_one({'_id': 'store'})
    assert (stored['authenticationDeliveryMode'], stored['transactionalDeliveryMode']) == (auth, utility)
    assert stored['sentinel'] == 'unchanged'
    public = client.get('/api/storefront-settings').json['settings']
    assert 'authenticationDeliveryMode' not in public and 'transactionalDeliveryMode' not in public
    assert db.whatsapp_outbox.count_documents({}) == 0
    assert db.whatsapp_consents.count_documents({}) == 0


@pytest.mark.parametrize('field', ['authenticationDeliveryMode', 'transactionalDeliveryMode'])
@pytest.mark.parametrize('invalid', [None, [], 'sms', 'EMAIL'])
def test_invalid_admin_routing_fails_without_mutation(preferences, field, invalid):
    db, client, _, _, headers, _, _ = preferences
    before = db.admin_settings.find_one({'_id': 'store'})
    response = client.put('/api/admin/settings', headers=headers, json={**SETTINGS_DEFAULTS, field: invalid})
    assert response.status_code == 400
    assert db.admin_settings.find_one({'_id': 'store'}) == before


@pytest.mark.parametrize('mode,permission,email_count,wa_count', [('email', True, 1, 0), ('whatsapp', False, 0, 0), ('whatsapp', True, 0, 1), ('both', False, 1, 0), ('both', True, 1, 1)])
def test_auth_independent_routing_and_missing_permission_outcomes(preferences, mode, permission, email_count, wa_count):
    db, client, user, _, _, _, _ = preferences
    from app.blueprints.auth.routes import _deliver_otp
    with patch('app.blueprints.auth.routes._send_otp_email') as email, patch('app.blueprints.auth.routes.notify_auth_otp', return_value={'status': 'queued'}) as wa:
        delivery, success = _deliver_otp(mode, 'login_otp', user, {'_id': user['_id'], 'whatsappOtpConsent': permission}, '123456', 'login', user['email'])
    assert email.call_count == email_count and wa.call_count == wa_count
    assert success == bool(email_count or wa_count)
    if mode != 'email' and not permission:
        assert delivery['whatsapp'] == 'blocked_permission_required'
    assert db.users.find_one({'_id': user['_id']})['otpDelivery'] == delivery


@pytest.mark.parametrize('failed', ['email', 'whatsapp'])
def test_both_auth_channels_are_independent_when_one_provider_fails(preferences, failed):
    _, _, user, _, _, _, _ = preferences
    from app.blueprints.auth.routes import _deliver_otp
    with patch('app.blueprints.auth.routes._send_otp_email', side_effect=RuntimeError('synthetic failure') if failed == 'email' else None), patch('app.blueprints.auth.routes.notify_auth_otp', side_effect=RuntimeError('synthetic failure') if failed == 'whatsapp' else None, return_value={'status': 'queued'}):
        delivery, success = _deliver_otp('both', 'login_otp', user, {'_id': user['_id'], 'whatsappOtpConsent': True}, '123456', 'login', user['email'])
    assert success
    assert delivery[failed] == 'unavailable'
    assert delivery['whatsapp' if failed == 'email' else 'email'] in {'sent', 'queued'}


@pytest.mark.parametrize('phone,country,expected', [('+919819887755', 'IN', '+919819887755'), ('9819887755', 'IN', '+919819887755'), ('+442079460018', 'IN', '+442079460018')])
def test_linked_legacy_contact_uses_stored_country_and_persists(preferences, phone, country, expected):
    db, _, user, _, _, _, _ = preferences
    db.users.update_one({'_id': user['_id']}, {'$set': {'phone': phone, 'phoneCountry': country}})
    response = profile(preferences, whatsappSameAsContact=True)
    assert response.status_code == 200, response.json
    assert response.json['user']['whatsappPhone'] == expected
    assert response.json['user']['whatsappSameAsContact'] is True
    assert not response.json['user']['whatsappConsentValid']
    assert db.users.find_one({'_id': user['_id']})['whatsappPhone'] == expected


def test_format_only_contact_change_preserves_same_recipient_consent(preferences):
    db, _, user, _, _, _, _ = preferences
    assert profile(preferences, whatsappSameAsContact=True, whatsappTransactionalConsent=True).status_code == 200
    count = db.whatsapp_consents.count_documents({})
    assert profile(preferences, phone='+1 (415) 555-2671').status_code == 200
    assert db.whatsapp_consents.count_documents({}) == count
    assert consent_phone(db, preferences[1].application.config, user, {}) == '+14155552671'


def test_customer_cannot_change_admin_routing_settings(preferences):
    db, client, user, _, headers, _, _ = preferences
    user['role'] = 'customer'
    db.users.update_one({'_id': user['_id']}, {'$set': {'role': 'customer'}})
    before = db.admin_settings.find_one({'_id': 'store'})
    response = client.put('/api/admin/settings', headers=headers, json={**SETTINGS_DEFAULTS, 'transactionalDeliveryMode': 'whatsapp'})
    assert response.status_code == 403
    assert db.admin_settings.find_one({'_id': 'store'}) == before


def test_whatsapp_only_does_not_verify_new_email_ownership(preferences):
    db, client, _, _, headers, _, _ = preferences
    db.admin_settings.update_one({'_id': 'store'}, {'$set': {'authenticationDeliveryMode': 'whatsapp'}})
    with patch('app.blueprints.auth.routes._send_otp_email') as email:
        response = client.post('/api/auth/profile/email/request', headers=headers, json={'email': 'new.synthetic@example.test'})
    assert response.status_code == 409
    assert 'email_ownership_verification_requires_email' in response.json['error']
    email.assert_not_called()
    assert db.email_change_challenges.count_documents({}) == 0


def test_saved_independent_recipient_survives_link_save_reload_and_unlink(preferences):
    _, _, _, _, _, _, _ = preferences
    assert profile(preferences, whatsappPhone='+442079460018', whatsappCountry='GB').status_code == 200
    linked = profile(preferences, whatsappSameAsContact=True)
    assert linked.status_code == 200
    assert linked.json['user']['whatsappPhone'] == '+14155552671'
    assert linked.json['user']['whatsappIndependentPhone'] == '+442079460018'
    separate = profile(preferences, whatsappSameAsContact=False)
    assert separate.status_code == 200
    assert separate.json['user']['whatsappPhone'] == '+442079460018'
    assert separate.json['user']['whatsappCountry'] == 'GB'
    assert separate.json['user']['whatsappConsentValid'] is False


@pytest.mark.parametrize('phone,country', [('+919819887755', None), ('09819887755', 'IN'), ('09819887755', 'in'), ('00919819887755', None)])
def test_already_linked_empty_whatsapp_profile_saves_from_contact(preferences, phone, country):
    db, client, user, _, _, _, _ = preferences
    db.users.update_one({'_id': user['_id']}, {'$set': {'phone': phone, 'phoneCountry': country, 'whatsappSameAsContact': True, 'whatsappPhone': '', 'whatsappIndependentPhone': ''}})
    result = profile(preferences, phone=phone, phoneCountry=country, whatsappSameAsContact=True, whatsappPhone='')
    assert result.status_code == 200, result.json
    assert result.json['user']['phone'] == '+919819887755'
    assert result.json['user']['phoneCountry'] == 'IN'
    assert result.json['user']['whatsappPhone'] == '+919819887755'
    assert result.json['user']['whatsappCountry'] == 'IN'
    assert result.json['user']['whatsappSameAsContact'] is True
    assert not result.json['user']['whatsappConsentValid']
    assert db.whatsapp_consents.count_documents({'enabled': True}) == 0


def test_linked_missing_country_requires_explicit_contact_country(preferences):
    db, _, user, _, _, _, _ = preferences
    db.users.update_one({'_id': user['_id']}, {'$set': {'phone': '09819887755', 'phoneCountry': None, 'whatsappSameAsContact': True, 'whatsappPhone': ''}})
    before = db.users.find_one({'_id': user['_id']})
    assert profile(preferences, phone='09819887755', whatsappSameAsContact=True).status_code == 400
    assert db.users.find_one({'_id': user['_id']}) == before
    result = profile(preferences, phoneCountry='IN')
    assert result.status_code == 200, result.json
    assert result.json['user']['whatsappPhone'] == '+919819887755'
    assert result.json['user']['phoneCountry'] == 'IN'


@pytest.mark.parametrize('phone', ['+919819887755', '09819887755', '9819887755'])
def test_exact_saved_india_region_me_payload_and_linked_save(preferences, phone):
    db, client, user, _, headers, _, _ = preferences
    db.users.update_one({'_id': user['_id']}, {'$set': {'phone': phone, 'phoneCountry': None, 'region': 'asia-india', 'whatsappSameAsContact': True, 'whatsappPhone': ''}})
    me = client.get('/api/auth/me', headers=headers)
    assert me.status_code == 200
    assert {field: me.json['user'][field] for field in ('phone', 'phoneCountry', 'region', 'whatsappSameAsContact', 'whatsappPhone')} == {'phone': phone, 'phoneCountry': None, 'region': 'asia-india', 'whatsappSameAsContact': True, 'whatsappPhone': None}
    result = profile(preferences, phone=phone, whatsappSameAsContact=True, whatsappPhone='')
    assert result.status_code == 200, result.json
    saved = client.get('/api/auth/me', headers=headers).json['user']
    assert saved['phone'] == saved['whatsappPhone'] == '+919819887755'
    assert saved['phoneCountry'] == saved['whatsappCountry'] == 'IN'
    assert saved['whatsappSameAsContact'] is True
    assert saved['whatsappConsentValid'] is False
    assert db.whatsapp_consents.count_documents({'enabled': True}) == 0


def test_saved_phone_country_overrides_region_and_other_countries_keep_trunk_zero(preferences):
    from app.phone_numbers import profile_contact_phone
    assert profile_contact_phone('02079460018', 'GB', 'asia-india') == ('+442079460018', 'GB')
    assert profile_contact_phone('0212345678', 'IT', 'asia-india') == ('+390212345678', 'IT')
    assert profile_contact_phone('+442079460018', 'IN', 'asia-india') == ('+442079460018', 'GB')
    for value in ('', '123', '0009819887755'):
        with pytest.raises(ValueError):
            profile_contact_phone(value, None, 'asia-india')
