"""Release checks use isolated storage and mocked provider calls only."""
from datetime import timedelta
from unittest.mock import patch

import pytest

from app.whatsapp import now, process_outbox
from app.whatsapp_orders import order_whatsapp_activity
from app.whatsapp_provider import audit_provider
from test_whatsapp_remediation import case
from test_whatsapp_order_mode import order_case, enqueue


def test_signed_read_without_delivered_updates_order_message_and_admin_log(order_case):
    c = order_case
    enqueue(c)
    process_outbox(c.db, c.app.config)
    # Meta may send read as the first receipt. Do not invent a delivery time.
    receipt = c.webhook(statuses=[c.provider_status('read', timestamp='1700000020')])
    assert c.signed(receipt).status_code == 200
    assert c.signed(receipt).status_code == 200
    saved = c.db.whatsapp_messages.find_one({'providerId': 'wamid.TEST'})
    assert saved['status'] == 'read'
    assert saved['orderId'] == str(c.order['_id'])
    assert saved['readAt'].isoformat() == '2023-11-14T22:13:40+00:00'
    assert 'deliveredAt' not in saved
    assert len(saved['statusHistory']) == 1
    result = c.client.get('/api/admin/integrations/whatsapp/messages', headers=c.headers)
    assert result.status_code == 200
    row = next(row for row in result.json['messages'] if row['providerId'] == 'wamid.TEST')
    assert row['readReceiptStatus'] == 'received'
    assert row['deliveryReceiptStatus'] == 'confirmed_by_read_receipt'
    assert row['orderNumber'] == c.order['orderNumber']
    assert order_whatsapp_activity(c.db, c.app.config, c.order)['activity'][0]['status'] == 'read'
    c.http.assert_called_once()


@pytest.mark.parametrize('change', ['expired', 'cancelled', 'recipient', 'withdrawn'])
def test_pending_order_job_rechecks_obsolete_authority_before_dispatch(order_case, change):
    c = order_case
    enqueue(c)
    if change == 'expired':
        c.db.whatsapp_outbox.update_one({}, {'$set': {'expiresAt': now() - timedelta(seconds=1)}})
    elif change == 'cancelled':
        c.db.orders.update_one({'_id': c.order['_id']}, {'$set': {'fulfillment.status': 'cancelled'}})
    elif change == 'recipient':
        c.db.orders.update_one({'_id': c.order['_id']}, {'$set': {'whatsappRecipient': '+442079460018'}})
    else:
        c.db.orders.update_one({'_id': c.order['_id']}, {'$set': {'whatsappConsent.enabled': False}})
    process_outbox(c.db, c.app.config)
    c.http.assert_not_called()


def test_unexpired_eligible_backlog_is_not_a_release_hold(order_case):
    c = order_case
    enqueue(c)
    c.db.whatsapp_outbox.update_one({}, {'$set': {'createdAt': now() - timedelta(hours=12)}})
    # Documents the operational blocker: startup is not permission to replay a
    # backlog, even though this otherwise authorized job remains dispatchable.
    assert process_outbox(c.db, c.app.config) == 1
    c.http.assert_called_once()


def test_subscription_fields_must_belong_to_the_production_callback(case):
    from app.whatsapp import CALLBACK
    c = case
    responses = [c.response(200, {'data': []}),
                 c.response(200, {'data': [{'whatsapp_business_api_data': {'id': c.app.config['WHATSAPP_APP_ID']}}]}),
                 c.response(200, {'data': [{'id': c.app.config['WHATSAPP_PHONE_NUMBER_ID']}]}),
                 c.response(200, {'data': [
                     {'object': 'whatsapp_business_account', 'active': True, 'callback_url': CALLBACK, 'fields': []},
                     {'object': 'whatsapp_business_account', 'active': True, 'callback_url': 'https://other.example/webhook', 'fields': ['messages']},
                 ]})]
    with patch('app.whatsapp_provider.requests.get', side_effect=responses):
        result = audit_provider(c.app.config, app_access_token='synthetic-app-token')
    assert result['wabaSubscription']['configuredAppSubscribed'] is True
    assert result['phone']['configuredPhoneBelongsToWaba'] is True
    assert result['appWebhook']['productionCallback'] is True
    assert result['appWebhook']['messagesField'] is False
    c.http.assert_not_called()
