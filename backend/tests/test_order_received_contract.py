"""Reported approved contract; synthetic Meta observations and no live sends."""
import pytest

from test_whatsapp_remediation import case
from test_whatsapp_order_mode import order_case
from test_meta_order_mappings import approve, saved_order
from app.whatsapp_catalogue import CATALOGUE
from app.whatsapp_definitions import definition_components
from app.whatsapp_events import event_values, template_event_values
from app.whatsapp_templates import component_signature, components_match, template_registry

APPROVED_COMPONENTS = [
    {'type': 'HEADER', 'format': 'TEXT', 'text': 'Order Received'},
    {'type': 'BODY', 'text': 'Dear {{1}},\n\nThank you for placing your order with Rashi Kapoor.\n\nWe have received your order {{2}} for {{3}}.\n\nOrder total: \u20b9{{4}}\n\nYour order is now awaiting review by our team. Payment has not yet been collected. Our team will contact you to confirm availability and arrange payment.\n\nWe will keep you updated here as your order progresses.'},
    {'type': 'FOOTER', 'text': 'Rashi Kapoor Official'},
]


def test_exact_four_variable_contract_has_static_rupee_and_no_buttons():
    spec = CATALOGUE['order_received']
    assert definition_components(spec) == APPROVED_COMPONENTS
    assert components_match(definition_components(spec), APPROVED_COMPONENTS)
    assert spec['parameters'] == ['customer_name', 'order_number', 'items_summary', 'order_total']
    assert spec['parameterTypes'] == ['text'] * 4
    assert spec['language'] == 'en_US' and spec['category'] == 'UTILITY'
    assert not spec.get('buttons') and 'Order total: \u20b9{{4}}' in spec['body']


def test_missing_static_rupee_remains_an_exact_component_mismatch():
    from copy import deepcopy
    missing = deepcopy(APPROVED_COMPONENTS)
    missing[1]['text'] = missing[1]['text'].replace('Order total: \u20b9{{4}}', 'Order total: {{4}}')
    assert not components_match(APPROVED_COMPONENTS, missing)
    assert not components_match(missing, APPROVED_COMPONENTS)


def test_legacy_draft_and_seven_variable_update_signatures_are_unchanged():
    assert component_signature(definition_components(CATALOGUE['rk_order_placed'])) == '2c2831ced9b169877826e63559c210c335767468336113b586e09d0e7ef295a8'
    assert 'Order total: \u20b9{{4}}' in CATALOGUE['rk_order_placed']['body']
    assert component_signature(definition_components(CATALOGUE['order_and_payment_update'])) == '6918da761ee4a79468bc74bae7c3ab75d3830fe7d0c292cd0e2993f8a92c67c0'


@pytest.mark.parametrize('amount,formatted', [(1, '1.00'), (1250, '1,250.00'), (1250.5, '1,250.50'), (99999.99, '99,999.99'), (128004, '128,004.00')])
def test_order_received_numeric_parameter_renders_exactly_one_currency_symbol(order_case, amount, formatted):
    order = saved_order(order_case, 'order_placed'); order['total'] = amount
    total = template_event_values('order_placed', order, {'catalogue': 'order_received'})['order_total']
    assert total == formatted and '\u20b9' not in total
    rendered = APPROVED_COMPONENTS[1]['text'].replace('{{4}}', total)
    assert rendered.count('\u20b9') == 1
    assert 'Order total: \u20b9' + formatted in rendered
    assert template_event_values('order_placed', order, {'catalogue': 'rk_order_placed'})['order_total'] == formatted
    assert event_values('order_placed', order)['order_total'] == formatted
    assert order['total'] == amount


def test_current_waba_refresh_verifies_the_exact_reported_components(order_case):
    c = order_case
    approve(c, 'order_placed', 'order_received', APPROVED_COMPONENTS)
    observed = c.db.whatsapp_template_status.find_one({'_id': 'order_received:en_US'})
    assert observed['businessAccountId'] == c.app.config['WHATSAPP_BUSINESS_ACCOUNT_ID']
    assert observed['componentsVerified'] is True
    template = template_registry(c.db, c.app.config)['order_placed']
    assert template['approved'] and template['componentsVerified'] and not template['statusStale']
    assert template['components'] == APPROVED_COMPONENTS
    c.http.assert_not_called()
